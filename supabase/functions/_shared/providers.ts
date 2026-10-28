import { DebridError, isDebridHost, unlock, type DebridFailure } from './alldebrid.ts'
import { getSecret } from './secrets.ts'
import { buildStreamUrl, pixeldrainApiFileUrl, pixeldrainInfoUrl } from './stream-url.ts'

export type Provider = 'pixeldrain' | 'onefichier' | 'alist' | 'other'

export type MediaSource = {
  id: string
  provider: Provider
  /** ID hébergeur seul (pixeldrain / onefichier) — l'URL est reconstruite ici, au moment de la lecture */
  file_id: string | null
  /** uniquement alist / other */
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

// ───────── Pixeldrain : vérification via l'API officielle, lecture via le bypass (pas de débridage Alldebrid)
function pixeldrainId(src: MediaSource): string {
  if (!src.file_id) throw new ResolveError('Pixeldrain: file_id manquant', 422, 'invalid_source')
  return src.file_id
}

async function resolvePixeldrain(src: MediaSource): Promise<Resolved> {
  const id = pixeldrainId(src)
  const PIXELDRAIN_KEY = await getSecret('PIXELDRAIN_API_KEY')
  const headers: HeadersInit = PIXELDRAIN_KEY ? { Authorization: `Basic ${btoa(`:${PIXELDRAIN_KEY}`)}` } : {}
  let info: Response
  try {
    info = await fetch(pixeldrainInfoUrl(id), {
      headers,
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new ResolveError('Pixeldrain injoignable', 502, 'unavailable')
  }
  if (info.status === 404) throw new ResolveError('Pixeldrain: fichier supprimé', 404, 'offline')
  if (!info.ok) throw new ResolveError(`Pixeldrain: HTTP ${info.status}`, 502, info.status === 429 ? 'host_busy' : 'unavailable')
  const meta = (await info.json()) as { name?: string }
  const bypassUrl = buildStreamUrl('pixeldrain', id)
  const direct = await extractBypassVideo(bypassUrl)
  // Repli : flux officiel Pixeldrain (lisible par <video>, limites de débit du compte gratuit)
  const url = direct ?? pixeldrainApiFileUrl(id)
  console.log('[resolve-stream] pixeldrain', id, direct ? '→ bypass' : '→ repli API officielle', url)
  return { url, ttl: direct ? 3600 : 6 * 3600, filename: meta.name, debrid: false }
}

const VIDEO_CT = /^(video\/|application\/(octet-stream|vnd\.apple\.mpegurl|x-mpegurl))/i
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** Le bypass renvoie soit le flux, soit une page HTML : on y cherche le lien vidéo direct. null si rien d'exploitable. */
async function extractBypassVideo(pageUrl: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetch(pageUrl, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,video/*;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(8000) })
  } catch (e) {
    console.warn('[resolve-stream] bypass injoignable', (e as Error).message)
    return null
  }
  const ct = res.headers.get('content-type') ?? ''
  if (res.ok && VIDEO_CT.test(ct)) {
    await res.body?.cancel()
    return res.url
  }
  if (!res.ok || !ct.includes('text/html')) {
    console.warn('[resolve-stream] bypass', res.status, ct)
    await res.body?.cancel()
    return null
  }
  const html = (await res.text()).slice(0, 500_000)
  console.log('[resolve-stream] bypass HTML (extrait)', html.replace(/\s+/g, ' ').slice(0, 400))

  const patterns = [
    /<video[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
    /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/gi,
    /["'](https?:\/\/[^"'\s<>]+?\.(?:mp4|webm|mkv|m3u8)(?:\?[^"'\s<>]*)?)["']/gi,
    /["']((?:https?:\/\/[^"'\s<>]+)?\/api\/file\/[A-Za-z0-9_-]+(?:\?[^"'\s<>]*)?)["']/gi,
    /["'](?:url|src|file|stream|download)["']\s*:\s*["'](https?:\/\/[^"'\s]+)["']/gi,
  ]
  const seen = new Set<string>([res.url, pageUrl])
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      let cand: string
      try {
        cand = new URL(m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&'), res.url).toString()
      } catch {
        continue
      }
      if (!cand.startsWith('https://') || seen.has(cand)) continue
      seen.add(cand)
      if (await isPlayable(cand)) {
        console.log('[resolve-stream] lien vidéo extrait du bypass', cand)
        return cand
      }
    }
  }
  console.warn('[resolve-stream] aucun lien vidéo lisible dans la page du bypass')
  return null
}

/** Vérifie qu'une URL sert bien un flux vidéo (1er octet). */
async function isPlayable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0', 'User-Agent': BROWSER_UA }, redirect: 'follow', signal: AbortSignal.timeout(6000) })
    await r.body?.cancel()
    return (r.status === 206 || r.ok) && VIDEO_CT.test(r.headers.get('content-type') ?? '')
  } catch {
    return false
  }
}

// ───────── Débridage Alldebrid (1fichier + tout hébergeur reconnu)
function debridLink(src: MediaSource): string | null {
  if (src.provider === 'onefichier') {
    if (!src.file_id) throw new ResolveError('1fichier: file_id manquant', 422, 'invalid_source')
    return buildStreamUrl('onefichier', src.file_id)
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
