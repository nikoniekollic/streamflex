// Lecture des durées réelles côté serveur (admin uniquement) : pour chaque lien débridé fourni par le navigateur, lit l'en-tête du fichier MP4
// (quelques octets par requête Range : boîtes ftyp / moov / mvhd) et enregistre la durée. Bien plus rapide que de faire lire chaque
// vidéo par le navigateur (qui télécharge bien plus que les métadonnées). Le débridage reste fait dans le navigateur (Alldebrid refuse les
// adresses de centres de données) ; les liens débridés, eux, ne sont pas liés à l'adresse IP.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { denyIfBanned } from '../_shared/guard.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 60
const PARALLEL = 24
const TIMEOUT_MS = 15_000
const ALLOWED_HOST = /\.(debrid\.it|alldebrid\.com)$/i

/** Lit au plus `len` octets à partir de `start` (une réponse 200 qui ignore Range est coupée, jamais lue en entier). */
async function range(url: string, start: number, len: number): Promise<Uint8Array | null> {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + len - 1}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (r.status !== 206 && r.status !== 200) {
    await r.body?.cancel()
    throw new Error(`HTTP ${r.status}`)
  }
  if (r.status === 200 && start > 0) {
    await r.body?.cancel() // Range ignoré : on ne parcourt pas le fichier
    throw new Error('Range ignoré par l’hébergeur')
  }
  const reader = r.body!.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < len) {
    const { done, value } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    total += value.length
  }
  await reader.cancel().catch(() => undefined)
  const out = new Uint8Array(Math.min(total, len))
  let o = 0
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - o)
    out.set(c.subarray(0, n), o)
    o += n
    if (o >= out.length) break
  }
  return out
}

type Box = { type: string; size: number; header: number }
function readBox(b: Uint8Array): Box | null {
  if (b.length < 8) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let size = dv.getUint32(0)
  const type = String.fromCharCode(b[4], b[5], b[6], b[7])
  let header = 8
  if (size === 1) {
    if (b.length < 16) return null
    size = Number(dv.getBigUint64(8))
    header = 16
  } else if (size === 0) return null // « jusqu'à la fin du fichier » : pas de moov après
  if (size < header) return null
  return { type, size, header }
}

/** Durée en secondes d'un fichier MP4 / M4V / MOV (null si illisible). */
async function mp4Seconds(url: string): Promise<number | null> {
  let pos = 0
  for (let hop = 0; hop < 14; hop++) {
    const h = await range(url, pos, 16)
    const box = h && readBox(h)
    if (!h || !box) return null
    if (box.type === 'moov') {
      // enfants de moov : mvhd est presque toujours le premier
      let child = pos + box.header
      const end = pos + box.size
      for (let i = 0; i < 12 && child < end; i++) {
        const c = await range(url, child, 48)
        const cb = c && readBox(c)
        if (!c || !cb) return null
        if (cb.type === 'mvhd') {
          const dv = new DataView(c.buffer, c.byteOffset, c.byteLength)
          const version = c[cb.header]
          let timescale: number
          let duration: number
          if (version === 1) {
            if (c.length < cb.header + 32) return null
            timescale = dv.getUint32(cb.header + 20)
            duration = Number(dv.getBigUint64(cb.header + 24))
          } else {
            if (c.length < cb.header + 20) return null
            timescale = dv.getUint32(cb.header + 12)
            duration = dv.getUint32(cb.header + 16)
          }
          if (!timescale || !duration || duration === 0xffffffff) return null
          const s = duration / timescale
          return s > 0 && s < 86_400 ? Math.round(s) : null
        }
        child += cb.size
      }
      return null
    }
    pos += box.size
  }
  return null
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const banned = await denyIfBanned(req)
  if (banned) return banned

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin } = await user.rpc('is_admin')
  if (isAdmin !== true) return json({ error: 'forbidden' }, 403)

  const body = await req.json().catch(() => null)
  const input: unknown[] = Array.isArray(body?.items) ? body.items : []
  if (input.length === 0 || input.length > MAX_ITEMS) return json({ error: 'invalid_items', max: MAX_ITEMS }, 400)
  const items: { id: string; url: string }[] = []
  for (const x of input as Record<string, unknown>[]) {
    try {
      const u = new URL(String(x.url))
      if (u.protocol !== 'https:' || !ALLOWED_HOST.test(u.hostname) || typeof x.id !== 'string' || !UUID.test(x.id)) continue
      items.push({ id: x.id, url: u.toString() })
    } catch {
      /* lien invalide : ignoré */
    }
  }

  const results = await mapLimit(items, PARALLEL, async (it) => {
    try {
      const s = await mp4Seconds(it.url)
      return { id: it.id, s, why: s == null ? 'en-tête MP4 illisible' : null }
    } catch (e) {
      return { id: it.id, s: null, why: (e as Error).name === 'TimeoutError' ? 'délai dépassé' : (e as Error).message.slice(0, 80) }
    }
  })
  const ok = results.filter((r): r is { id: string; s: number } => r.s != null)
  if (ok.length) {
    const { error } = await user.rpc('admin_set_durations', { p_items: ok })
    if (error) return json({ error: 'save_failed', message: error.message }, 500)
  }
  return json({ results })
})
