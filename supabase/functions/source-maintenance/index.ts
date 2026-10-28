// Maintenance des fichiers hébergés (admin) : métadonnées officielles (info) ou téléchargement partiel de maintenance (touch).
// Pixeldrain : GET /api/file/{id}/info · GET /api/file/{id} (Range 1 Mio)
// 1fichier   : POST /v1/file/info.cgi · POST /v1/download/get_token.cgi → GET lien (Range 1 Mio)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned } from '../_shared/guard.ts'
import { getSecret } from '../_shared/secrets.ts'
import { buildHosterPageUrl, buildStreamUrl, pixeldrainInfoUrl } from '../_shared/stream-url.ts'

type Action = 'info' | 'touch'
type Source = { id: string; provider: 'pixeldrain' | 'onefichier'; file_id: string; size_bytes: number | null }
type Outcome = {
  id: string
  ok: boolean
  status: number
  state: 'online' | 'offline' | 'error'
  name?: string | null
  size?: number | null
  views?: number | null
  downloads?: number | null
  lastViewAt?: string | null
  bytesRead?: number
  message?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOUCH_BYTES = 1024 * 1024
const ONEFICHIER_API = 'https://api.1fichier.com/v1'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function readPartial(url: string, headers: HeadersInit = {}): Promise<{ status: number; bytes: number }> {
  const res = await fetch(url, { headers: { ...headers, Range: `bytes=0-${TOUCH_BYTES - 1}` }, signal: AbortSignal.timeout(20_000) })
  let bytes = 0
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes >= TOUCH_BYTES) {
        await reader.cancel()
        break
      }
    }
  }
  return { status: res.status, bytes }
}

// ───────── Pixeldrain
async function pixeldrain(src: Source, action: Action): Promise<Outcome> {
  const key = await getSecret('PIXELDRAIN_API_KEY')
  const headers: HeadersInit = key ? { Authorization: `Basic ${btoa(`:${key}`)}` } : {}
  const res = await fetch(pixeldrainInfoUrl(src.file_id), { headers, signal: AbortSignal.timeout(10_000) })
  if (res.status === 404) return { id: src.id, ok: false, status: 404, state: 'offline', message: 'Fichier supprimé chez Pixeldrain' }
  if (!res.ok) return { id: src.id, ok: false, status: res.status, state: 'error', message: `Pixeldrain HTTP ${res.status}` }
  const info = (await res.json()) as { name?: string; size?: number; views?: number; downloads?: number; date_last_view?: string }
  const out: Outcome = {
    id: src.id,
    ok: true,
    status: 200,
    state: 'online',
    name: info.name ?? null,
    size: info.size ?? null,
    views: info.views ?? null,
    downloads: info.downloads ?? null,
    lastViewAt: info.date_last_view ?? null,
  }
  if (action === 'touch') {
    const r = await readPartial(buildStreamUrl('pixeldrain', src.file_id), headers)
    out.bytesRead = r.bytes
    if (r.status >= 400) Object.assign(out, { ok: false, status: r.status, state: 'error', message: `Téléchargement HTTP ${r.status}` })
  }
  return out
}

// ───────── 1fichier (API officielle, Bearer ; ~1 requête / 2 s recommandée)
async function onefichier(src: Source, action: Action): Promise<Outcome> {
  const key = await getSecret('ONEFICHIER_API_KEY')
  if (!key) return { id: src.id, ok: false, status: 500, state: 'error', message: 'ONEFICHIER_API_KEY non configurée' }
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const url = buildHosterPageUrl('onefichier', src.file_id)

  const res = await fetch(`${ONEFICHIER_API}/file/info.cgi`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => ({}))) as { filename?: string; size?: number; status?: string; message?: string }
  if (res.status === 404 || /not found|introuvable|supprim/i.test(body.message ?? '')) {
    return { id: src.id, ok: false, status: 404, state: 'offline', message: body.message ?? 'Fichier introuvable chez 1fichier' }
  }
  if (!res.ok || body.status === 'KO') {
    return { id: src.id, ok: false, status: res.status || 502, state: 'error', message: body.message ?? `1fichier HTTP ${res.status}` }
  }
  const out: Outcome = { id: src.id, ok: true, status: 200, state: 'online', name: body.filename ?? null, size: body.size ?? null }

  if (action === 'touch') {
    await sleep(2000) // anti-flood API 1fichier
    const t = await fetch(`${ONEFICHIER_API}/download/get_token.cgi`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(10_000),
    })
    const tok = (await t.json().catch(() => ({}))) as { url?: string; message?: string }
    if (!t.ok || !tok.url) return { ...out, ok: false, status: t.status || 502, state: 'error', message: tok.message ?? 'Jeton de téléchargement refusé' }
    const r = await readPartial(tok.url)
    out.bytesRead = r.bytes
    if (r.status >= 400) Object.assign(out, { ok: false, status: r.status, state: 'error', message: `Téléchargement HTTP ${r.status}` })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const banned = await denyIfBanned(req)
  if (banned) return banned

  // Admin uniquement
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin } = await user.rpc('is_admin')
  if (isAdmin !== true) return json({ error: 'forbidden' }, 403)

  let body: { ids?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const action: Action = body.action === 'touch' ? 'touch' : 'info'
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : []
  if (ids.length === 0 || ids.length > (action === 'touch' ? 5 : 25)) {
    return json({ error: 'invalid_ids', max: action === 'touch' ? 5 : 25 }, 400)
  }

  const db = adminClient()
  const { data: rows, error } = await db
    .from('media_sources')
    .select('id, provider, file_id, size_bytes')
    .in('id', ids)
    .in('provider', ['pixeldrain', 'onefichier'])
  if (error) return json({ error: 'db_error' }, 500)

  const results: Outcome[] = []
  for (const src of (rows ?? []) as Source[]) {
    let out: Outcome
    try {
      out = src.provider === 'pixeldrain' ? await pixeldrain(src, action) : await onefichier(src, action)
    } catch (e) {
      out = { id: src.id, ok: false, status: 502, state: 'error', message: `Hébergeur injoignable : ${(e as Error).name}` }
    }
    results.push(out)
    await db
      .from('media_sources')
      .update({
        last_checked_at: new Date().toISOString(),
        last_status: out.state === 'offline' ? 404 : out.status,
        ...(out.size && !src.size_bytes ? { size_bytes: out.size } : {}),
      })
      .eq('id', src.id)
    if (src.provider === 'onefichier') await sleep(1500) // espacement API 1fichier
  }
  return json({ action, results })
})
