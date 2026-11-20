// Travailleur autonome (programme sur le PC de l'admin : pipelines/worker/media_worker.py)
// Alldebrid et 1fichier refusent les IP de serveurs : seul un appareil sur une connexion de particulier peut lire les vidéos.
// Ce point d'entrée lui distribue le travail et reçoit les résultats ; il est protégé par la clé WORKER_SECRET (en-tête
// x-worker-secret), sans session utilisateur (verify_jwt = false).
//  • claim  : lot de vidéos à traiter (durée inconnue / pas d'image de jaquette) + clé Alldebrid pour les débrider ;
//  • report : durées lues, fichiers supprimés (vérifiés ensuite par la surveillance 1fichier), échecs (réessayés plus tard) ;
//  • still  : image de jaquette (WebP, 60 Ko au plus) → bucket « stills », devient la jaquette par défaut du film.
import { json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { getSecret } from '../_shared/secrets.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STILLS_MAX_MB = 850 // offre gratuite Supabase : 1 Go de stockage ; au-delà, durées seulement
const STILL_MAX_BYTES = 60_000
const STATS_TTL_MS = 2 * 60_000

let stats: { at: number; data: Record<string, number> } | null = null
async function getStats(): Promise<Record<string, number>> {
  if (stats && Date.now() - stats.at < STATS_TTL_MS) return stats.data
  const { data } = await adminClient().rpc('media_worker_stats')
  stats = { at: Date.now(), data: (data ?? {}) as Record<string, number> }
  return stats.data
}

/** Comparaison à temps constant (la clé ne se devine pas caractère par caractère). */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Vrai fichier WebP (en-tête RIFF....WEBP) : rien d'autre n'entre dans le bucket public. */
const isWebp = (b: Uint8Array) =>
  b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const secret = await getSecret('WORKER_SECRET')
  if (!secret || secret.length < 32 || !sameSecret(req.headers.get('x-worker-secret') ?? '', secret)) return json({ error: 'forbidden' }, 403)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const db = adminClient()
  try {
    switch (body?.action) {
      case 'claim': {
        const st = await getStats()
        const stills = Number(st.stills_mb ?? 0) < STILLS_MAX_MB
        const n = Math.min(50, Math.max(1, Number(body.n) || 12))
        const { data, error } = await db.rpc('media_worker_claim', { p_n: n, p_stills: stills })
        if (error) return json({ error: 'db_error', message: error.message }, 500)
        const items = (data ?? []) as unknown[]
        const key = items.length ? await getSecret('ALLDEBRID_API_KEY') : undefined
        const agent = (await getSecret('ALLDEBRID_AGENT')) ?? 'streamflex'
        return json({ items, debrid: key ? { key, agent } : null, stills, stats: st })
      }
      case 'report': {
        const items = Array.isArray(body.items) ? body.items.slice(0, 100) : []
        if (!items.length) return json({ ok: true })
        const { data, error } = await db.rpc('media_worker_report', { p_items: items })
        if (error) return json({ error: 'db_error', message: error.message }, 500)
        return json({ ok: true, ...(data as object) })
      }
      case 'still': {
        const id = String(body.id ?? '')
        if (!UUID.test(id) || typeof body.image !== 'string') return json({ error: 'invalid' }, 400)
        const pos = typeof body.pos === 'number' && body.pos >= 0 && body.pos <= 0.95 ? body.pos : null
        let bytes: Uint8Array
        try {
          bytes = b64ToBytes(body.image)
        } catch {
          return json({ error: 'invalid_image' }, 400)
        }
        if (bytes.length > STILL_MAX_BYTES || !isWebp(bytes)) return json({ error: 'invalid_image' }, 400)
        const path = `${id.toLowerCase()}.webp`
        const up = await db.storage.from('stills').upload(path, bytes, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' })
        if (up.error) return json({ error: 'storage_error', message: up.error.message }, 500)
        // ?v= : une image refaite (autre moment choisi dans l'admin) n'est pas servie depuis le cache du navigateur
        const url = `${db.storage.from('stills').getPublicUrl(path).data.publicUrl}?v=${Date.now().toString(36)}`
        const { data, error } = await db.rpc('media_worker_still', { p_title: id, p_url: url, p_pos: pos })
        if (error) return json({ error: 'db_error', message: error.message }, 500)
        return json({ ok: true, applied: data === true })
      }
      default:
        return json({ error: 'unknown_action' }, 400)
    }
  } catch (e) {
    console.error('[media-worker]', e)
    return json({ error: 'exception' }, 500)
  }
})
