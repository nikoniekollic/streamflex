// Sert un sous-titre en WebVTT (CORS, conversion SRT) — évite crossorigin sur <video> et les hôtes sans CORS.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { denyIfBanned } from '../_shared/guard.ts'
import { ensureVtt } from '../_shared/subtitles.ts'

const MAX_BYTES = 2 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const banned = await denyIfBanned(req)
  if (banned) return banned

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await client.auth.getUser()
  if (!auth.user) return json({ error: 'unauthorized' }, 401)

  let id: unknown
  try {
    ;({ id } = await req.json())
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'invalid_id' }, 400)

  // RLS : titre publié (ou admin)
  const { data: sub } = await client.from('subtitles').select('url, format').eq('id', id).maybeSingle()
  if (!sub) return json({ error: 'not_found' }, 404)

  let url: URL
  try {
    url = new URL(sub.url)
  } catch {
    return json({ error: 'invalid_url' }, 422)
  }
  if (!/^https?:$/.test(url.protocol) || PRIVATE_HOST.test(url.hostname)) return json({ error: 'forbidden_host' }, 422)

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
  } catch {
    return json({ error: 'upstream_unreachable' }, 502)
  }
  if (!res.ok || !res.body) return json({ error: 'upstream_error', status: res.status }, 502)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return json({ error: 'too_large' }, 413)

  // lecture bornée
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      return json({ error: 'too_large' }, 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    bytes.set(c, off)
    off += c.byteLength
  }
  // UTF-8 par défaut, repli Windows-1252 (fréquent pour les .srt FR)
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes)

  return new Response(ensureVtt(text, sub.format as 'vtt' | 'srt'), {
    headers: { ...corsHeaders, 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, max-age=3600' },
  })
})
