import type { TypedSupabaseClient } from '@/lib/supabase'
import { resolveStream } from '@/lib/stream'

// Aperçu au survol : lien Alldebrid débridé dans le navigateur, mis en cache, en file unique et espacée
// pour ne jamais marteler l'API (Edge Function + Alldebrid) quand on balaie la souris sur le catalogue.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_GAP_MS = 1200
const OK_TTL_MS = 90 * 60_000 // les liens Alldebrid valent ~2 h
const FAIL_TTL_MS = 10 * 60_000
const BREAKER_AFTER = 5
const BREAKER_MS = 5 * 60_000

const cache = new Map<string, { url: string | null; until: number }>()
const inflight = new Map<string, Promise<string | null>>()
let chain: Promise<unknown> = Promise.resolve()
let lastAt = 0
let failStreak = 0
let pausedUntil = 0

export type Wanted = { cancelled: boolean }

export function getPreviewUrl(s: TypedSupabaseClient, profileId: string, titleId: string, wanted: Wanted): Promise<string | null> {
  if (!UUID.test(titleId)) return Promise.resolve(null)
  const hit = cache.get(titleId)
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url)
  if (Date.now() < pausedUntil) return Promise.resolve(null)
  const running = inflight.get(titleId)
  if (running) return running

  const job = chain.then(async () => {
    if (wanted.cancelled) return null // la souris est déjà partie : aucun appel
    const wait = lastAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    if (wanted.cancelled) return null
    lastAt = Date.now()
    try {
      const info = await resolveStream(s, { profileId, titleId, episodeId: null, preview: true })
      failStreak = 0
      cache.set(titleId, { url: info.url, until: Date.now() + OK_TTL_MS })
      return info.url
    } catch {
      cache.set(titleId, { url: null, until: Date.now() + FAIL_TTL_MS })
      if (++failStreak >= BREAKER_AFTER) {
        pausedUntil = Date.now() + BREAKER_MS
        failStreak = 0
      }
      return null
    }
  })
  chain = job.then(
    () => undefined,
    () => undefined,
  )
  inflight.set(titleId, job)
  void job.finally(() => inflight.delete(titleId))
  return job
}
