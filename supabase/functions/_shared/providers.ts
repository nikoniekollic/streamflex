import { onefichierLink, OnefichierError, type OnefichierFailure } from './onefichier.ts'
import type { DebridFailure } from './alldebrid.ts'
import { getSecret } from './secrets.ts'
import { buildStreamUrl } from './stream-url.ts'

// 'pixeldrain' reste dans l'enum de la base mais n'est plus lu : ces sources sont refusées (invalid_source).
export type Provider = 'pixeldrain' | 'onefichier' | 'alist' | 'other'

export type MediaSource = {
  id: string
  provider: Provider
  /** ID 1fichier seul — l'URL est reconstruite ici, au moment de la lecture */
  file_id: string | null
  /** uniquement alist / other */
  raw_url: string | null
  quality: '480p' | '720p' | '1080p' | '2160p'
  priority: number
  audio_languages: string[]
}

/** clientDebrid : Alldebrid refuse les IP de serveurs (NO_SERVER) → le navigateur de l'abonné débride lui-même. */
export type Resolved = { url: string; ttl: number; filename?: string; clientDebrid?: { link: string; key: string; agent: string } }

export type FailureKind = OnefichierFailure | DebridFailure | 'invalid_source' | 'unknown'

export class ResolveError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly kind: FailureKind = 'unknown',
  ) {
    super(message)
  }
}

// ───────── 1fichier : Alldebrid via le navigateur (si clé configurée), sinon lien direct de l'API du compte
async function resolveOnefichier(src: MediaSource, refresh: boolean, direct: boolean): Promise<Resolved> {
  if (!src.file_id) throw new ResolveError('1fichier: file_id manquant', 422, 'invalid_source')

  // direct : Alldebrid a atteint ses limites (MAX_DAILY_DOWNLOAD…), le navigateur demande le lien directement à l'API 1fichier du compte
  const key = direct ? null : await getSecret('ALLDEBRID_API_KEY')
  if (key) {
    const agent = (await getSecret('ALLDEBRID_AGENT')) ?? 'streamflex'
    return { url: '', ttl: 0, clientDebrid: { link: buildStreamUrl('onefichier', src.file_id), key, agent } }
  }

  try {
    const l = await onefichierLink(src.file_id, refresh)
    return { url: l.url, ttl: l.ttl }
  } catch (e) {
    if (e instanceof OnefichierError) throw new ResolveError(e.message, e.status, e.failure)
    throw e
  }
}

// ───────── Point d'entrée : identifie l'origine puis résout
export async function resolveSource(src: MediaSource, opts: { refresh?: boolean; direct?: boolean } = {}): Promise<Resolved> {
  if (src.provider === 'onefichier') return resolveOnefichier(src, opts.refresh === true, opts.direct === true)
  if (src.provider === 'pixeldrain') throw new ResolveError('Hébergeur non pris en charge', 422, 'invalid_source')
  if (!src.raw_url) throw new ResolveError(`${src.provider}: raw_url manquant`, 422, 'invalid_source')
  return { url: src.raw_url, ttl: 3600 } // AList signé / URL directe
}
