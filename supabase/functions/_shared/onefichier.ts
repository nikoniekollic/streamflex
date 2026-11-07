// Appels à l'API officielle 1fichier du compte (https://api.1fichier.com/v1).
// Le même compte est utilisé par un script sur le PC de l'admin : budget d'appels volontairement bas,
// partagé entre toutes les instances (Postgres), une « voie » par usage, disjoncteur commun de 24 h
// au moindre signe de blocage. Aucun réessai automatique.
import { adminClient } from './admin-client.ts'
import { getSecret } from './secrets.ts'

const API = 'https://api.1fichier.com/v1'
const LINK_TTL_S = 180 // un lien déjà obtenu est réutilisé 3 min (relectures, reprises, seek)
const BREAKER_HOURS = 24

export type Lane = { name: 'onefichier' | 'onefichier_admin'; gapMs: number; cap: number }
/** Lecture vidéo : ≥ 8 s entre deux appels, 120 / h */
export const LANE_PLAY: Lane = { name: 'onefichier', gapMs: 8_000, cap: 120 }
/** Explorateur / import admin : ≥ 4 s entre deux appels, 240 / h */
export const LANE_ADMIN: Lane = { name: 'onefichier_admin', gapMs: 4_000, cap: 240 }

export type OnefichierFailure = 'offline' | 'host_busy' | 'auth' | 'unavailable'
export class OnefichierError extends Error {
  constructor(readonly failure: OnefichierFailure, message: string, readonly status = 502) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LOCK = /locked|account|#2\d\d|#4\d\d|blocked|banned|flood|too many|invalid.*(key|api)|api.*invalid|unauthori[sz]ed/i
const GONE = /not found|introuvable|no such|deleted|supprim|invalid.*(url|link)|file.*(not|n'existe)/i

// deno-lint-ignore no-explicit-any
export async function onefichierCall(path: string, payload: Record<string, unknown>, lane: Lane): Promise<any> {
  const admin = adminClient()
  const key = await getSecret('ONEFICHIER_API_KEY')
  if (!key) throw new OnefichierError('auth', 'ONEFICHIER_API_KEY non configurée', 503)

  const { data: slot, error } = await admin.rpc('onefichier_acquire', { p_min_gap_ms: lane.gapMs, p_hourly_cap: lane.cap, p_max_wait_ms: 9000, p_name: lane.name })
  if (error || !slot) throw new OnefichierError('unavailable', 'Régulateur 1fichier indisponible', 503)
  if (!slot.ok) throw new OnefichierError('host_busy', `1fichier en pause (${slot.reason}, ${slot.retry_s}s)`, 503)
  if (slot.wait_ms > 0) await sleep(slot.wait_ms)

  let res: Response
  try {
    res = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(path.startsWith('folder/') ? 40_000 : 12_000),
    })
  } catch {
    throw new OnefichierError('unavailable', '1fichier injoignable', 502)
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok && body?.status !== 'KO') return body

  const msg: string = body?.message ?? `HTTP ${res.status}`
  if (/#236|must be a customer|premium/i.test(msg)) {
    await admin.rpc('onefichier_trip', { p_hours: 1, p_reason: `${res.status} ${msg}` })
    throw new OnefichierError('auth', `1fichier: ${msg} — le compte de la clé API n'est pas premium`, 503)
  }
  if (res.status === 401 || res.status === 403 || res.status === 429 || LOCK.test(msg)) {
    await admin.rpc('onefichier_trip', { p_hours: BREAKER_HOURS, p_reason: `${res.status} ${msg}` })
    throw new OnefichierError('auth', `1fichier: ${msg} — appels serveur suspendus ${BREAKER_HOURS} h`, 503)
  }
  if (res.status === 404 || GONE.test(msg)) throw new OnefichierError('offline', `1fichier: ${msg}`, 404)
  throw new OnefichierError('unavailable', `1fichier: ${msg}`, 502)
}

export async function onefichierLink(fileId: string): Promise<{ url: string; ttl: number }> {
  const admin = adminClient()
  const now = new Date().toISOString()

  // 1. Cache (aucun appel API)
  const { data: hit } = await admin.from('onefichier_links').select('url, expires_at').eq('file_id', fileId).gt('expires_at', now).maybeSingle()
  if (hit) return { url: hit.url, ttl: Math.max(30, Math.floor((new Date(hit.expires_at).getTime() - Date.now()) / 1000)) }

  // 2. Un seul appel régulé
  const body = await onefichierCall('download/get_token.cgi', { url: `https://1fichier.com/?${fileId}`, inline: 1 }, LANE_PLAY)
  if (!body?.url) throw new OnefichierError('unavailable', '1fichier: réponse sans lien', 502)
  await admin.from('onefichier_links').upsert({ file_id: fileId, url: body.url, expires_at: new Date(Date.now() + LINK_TTL_S * 1000).toISOString() })
  return { url: body.url, ttl: LINK_TTL_S }
}
