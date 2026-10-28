import { DebridError, isDebridHost, unlock, type DebridFailure } from './alldebrid.ts'
import { getSecret } from './secrets.ts'

export type Provider = 'pixeldrain' | 'onefichier' | 'alist' | 'other'

export type MediaSource = {
  id: string
  provider: Provider
  external_id: string | null
  raw_url: string | null
  quality: '480p' | '720p' | '1080p' | '2160p'
  priority: number
  audio_languages: string[]
}

export type Resolved = { url: string; ttl: number; filename?: string; debrid: boolean }

export type FailureKind = DebridFailure | 'invalid_source'

export class ResolveError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly kind: FailureKind = 'unknown',
  ) {
    super(message)
  }
}

// ───────── Pixeldrain : URL directe /api/file/{id} (Range supporté, pas de débridage)
function pixeldrainId(src: MediaSource): string {
  if (src.external_id) return src.external_id
  const m = src.raw_url?.match(/pixeldrain\.com\/(?:u|api\/file)\/([A-Za-z0-9]+)/)
  if (!m) throw new ResolveError('Pixeldrain: identifiant introuvable', 422, 'invalid_source')
  return m[1]
}

async function resolvePixeldrain(src: MediaSource): Promise<Resolved> {
  const id = pixeldrainId(src)
  const PIXELDRAIN_KEY = await getSecret('PIXELDRAIN_API_KEY')
  const headers: HeadersInit = PIXELDRAIN_KEY ? { Authorization: `Basic ${btoa(`:${PIXELDRAIN_KEY}`)}` } : {}
  let info: Response
  try {
    info = await fetch(`https://pixeldrain.com/api/file/${encodeURIComponent(id)}/info`, {
      headers,
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new ResolveError('Pixeldrain injoignable', 502, 'unavailable')
  }
  if (info.status === 404) throw new ResolveError('Pixeldrain: fichier supprimé', 404, 'offline')
  if (!info.ok) throw new ResolveError(`Pixeldrain: HTTP ${info.status}`, 502, info.status === 429 ? 'host_busy' : 'unavailable')
  const meta = (await info.json()) as { name?: string }
  return { url: `https://pixeldrain.com/api/file/${encodeURIComponent(id)}`, ttl: 6 * 3600, filename: meta.name, debrid: false }
}

// ───────── Débridage Alldebrid (1fichier + tout hébergeur reconnu)
function debridLink(src: MediaSource): string | null {
  if (src.provider === 'onefichier') {
    if (src.raw_url) return src.raw_url
    if (src.external_id) return `https://1fichier.com/?${src.external_id}`
    throw new ResolveError('1fichier: lien introuvable', 422, 'invalid_source')
  }
  if (src.raw_url && isDebridHost(src.raw_url)) return src.raw_url
  return null
}

async function resolveDebrid(link: string): Promise<Resolved> {
  try {
    const u = await unlock(link)
    return { url: u.url, ttl: u.ttl, filename: u.filename, debrid: true }
  } catch (e) {
    if (e instanceof DebridError) {
      const status = e.failure === 'offline' ? 404 : e.failure === 'auth' || e.failure === 'server_blocked' ? 503 : 502
      throw new ResolveError(`Alldebrid ${e.code}: ${e.message}`, status, e.failure)
    }
    throw e
  }
}

// ───────── Point d'entrée : identifie l'origine puis résout
export async function resolveSource(src: MediaSource): Promise<Resolved> {
  if (src.provider === 'pixeldrain') return resolvePixeldrain(src)
  const link = debridLink(src)
  if (link) return resolveDebrid(link)
  if (!src.raw_url) throw new ResolveError(`${src.provider}: raw_url manquant`, 422, 'invalid_source')
  return { url: src.raw_url, ttl: 3600, debrid: false } // AList signé / URL directe
}
