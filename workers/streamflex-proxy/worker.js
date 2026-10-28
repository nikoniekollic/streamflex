/**
 * StreamFlex — Cloudflare Worker (proxy)
 *
 *   GET  /pixeldrain/<FILE_ID>   → flux vidéo Pixeldrain (Range / seek supportés)
 *   POST /alldebrid/unlock       → débridage Alldebrid, body JSON { "token": "<jeton signé par resolve-stream>" }
 *
 * Variables (Settings → Variables and Secrets) :
 *   ALLDEBRID_API_KEY      (secret)  clé API Alldebrid — ne quitte jamais le Worker
 *   DEBRID_SIGNING_SECRET  (secret)  identique au secret Supabase du même nom
 *   ALLDEBRID_AGENT        (texte)   ex. streamflex
 *   ALLOWED_ORIGIN         (texte)   ex. https://ton-site.vercel.app (plusieurs : séparés par des virgules)
 *   PIXELDRAIN_API_KEY     (secret, optionnel)
 *
 * Sécurité : le Worker ne débride QUE des liens 1fichier signés par l'Edge Function resolve-stream
 * (HMAC-SHA256, valables 10 min, liés à l'utilisateur). Impossible de s'en servir comme proxy Alldebrid ouvert.
 */

const FILE_ID = /^[A-Za-z0-9_-]{4,32}$/
const ONEFICHIER = /^https:\/\/(?:www\.)?1fichier\.com\/\?[A-Za-z0-9]+/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      if (url.pathname.startsWith('/pixeldrain/') && (request.method === 'GET' || request.method === 'HEAD')) {
        return await proxyPixeldrain(request, env, url, cors)
      }
      if (url.pathname === '/alldebrid/unlock' && request.method === 'POST') {
        return await alldebridUnlock(request, env, cors)
      }
      return json({ error: 'not_found' }, 404, cors)
    } catch (e) {
      console.error('worker exception', e && e.stack ? e.stack : e)
      return json({ error: 'worker_exception' }, 500, cors)
    }
  },
}

// ───────── CORS
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

// ───────── /pixeldrain/<FILE_ID>
async function proxyPixeldrain(request, env, url, cors) {
  const id = url.pathname.slice('/pixeldrain/'.length).split('/')[0]
  if (!FILE_ID.test(id)) return json({ error: 'invalid_file_id' }, 400, cors)

  const headers = new Headers()
  for (const h of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (env.PIXELDRAIN_API_KEY) headers.set('Authorization', 'Basic ' + btoa(':' + env.PIXELDRAIN_API_KEY))

  const upstream = await fetch(`https://pixeldrain.com/api/file/${id}`, { method: request.method, headers })
  const out = new Headers(cors)
  for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  if (!out.has('Accept-Ranges')) out.set('Accept-Ranges', 'bytes')
  out.set('Content-Disposition', 'inline')
  out.set('Cache-Control', 'private, max-age=3600')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

// ───────── /alldebrid/unlock
async function alldebridUnlock(request, env, cors) {
  if (!env.ALLDEBRID_API_KEY || !env.DEBRID_SIGNING_SECRET) return json({ error: 'worker_not_configured' }, 500, cors)

  let token
  try {
    token = (await request.json()).token
  } catch {
    return json({ error: 'invalid_body' }, 400, cors)
  }
  const claims = await verifyToken(token, env.DEBRID_SIGNING_SECRET)
  if (!claims) return json({ error: 'invalid_token' }, 401, cors)
  if (claims.exp < Math.floor(Date.now() / 1000)) return json({ error: 'token_expired' }, 401, cors)
  if (!ONEFICHIER.test(claims.link)) return json({ error: 'host_not_allowed' }, 403, cors)

  const agent = env.ALLDEBRID_AGENT || 'streamflex'
  const auth = { Authorization: `Bearer ${env.ALLDEBRID_API_KEY}` }
  const res = await fetch(`https://api.alldebrid.com/v4/link/unlock?agent=${encodeURIComponent(agent)}&link=${encodeURIComponent(claims.link)}`, { headers: auth })
  const body = await res.json().catch(() => null)
  if (!body || body.status !== 'success') {
    const err = (body && body.error) || { code: `HTTP_${res.status}`, message: 'Réponse Alldebrid invalide' }
    console.warn('alldebrid error', err.code, err.message)
    return json({ error: 'alldebrid_error', code: err.code, message: err.message }, 502, cors)
  }

  let data = body.data
  // Lien « différé » : Alldebrid prépare le fichier, on interroge /link/delayed (≤ 20 s)
  if (!data.link && data.delayed) {
    for (let i = 0; i < 10 && !data.link; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const d = await fetch(`https://api.alldebrid.com/v4/link/delayed?agent=${encodeURIComponent(agent)}&id=${encodeURIComponent(data.delayed)}`, { headers: auth }).then((r) => r.json()).catch(() => null)
      if (d && d.status === 'success' && d.data && d.data.status === 2) data = { ...data, link: d.data.link }
      else if (d && d.status === 'success' && d.data && d.data.status === 3) return json({ error: 'alldebrid_error', code: 'DELAYED_FAILED', message: 'Génération du lien échouée' }, 502, cors)
    }
  }
  if (!data.link) return json({ error: 'alldebrid_error', code: 'NO_LINK', message: 'Lien non disponible' }, 502, cors)

  return json({ url: data.link, filename: data.filename || null, filesize: data.filesize || null, host: data.host || null }, 200, cors)
}

// ───────── Jeton HMAC-SHA256 : base64url(payload).base64url(signature)
async function verifyToken(token, secret) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const [p, s] = token.split('.')
  if (!p || !s) return null
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(s), new TextEncoder().encode(p))
  } catch {
    return null
  }
  if (!ok) return null
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(p)))
  } catch {
    return null
  }
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
