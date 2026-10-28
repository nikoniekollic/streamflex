// Côté client : la base ne stocke que (provider, file_id). Les URL sont reconstruites à la volée.
// La lecture passe par l'Edge `resolve-stream` (débridage serveur) ; ces helpers servent à l'admin
// (aperçu, test de débridage) et à la saisie (extraction d'un ID depuis une URL collée).
export type Hoster = 'pixeldrain' | 'onefichier'

export const FILE_ID_RE = /^[A-Za-z0-9_-]{4,32}$/
export const isHoster = (p: string): p is Hoster => p === 'pixeldrain' || p === 'onefichier'

export const PIXELDRAIN_BYPASS = 'https://pixeldrain-bypass.gamedrive.org'

export function buildStreamUrl(provider: Hoster, fileId: string): string {
  const id = encodeURIComponent(fileId)
  return provider === 'pixeldrain' ? `${PIXELDRAIN_BYPASS}/${id}` : `https://1fichier.com/?${id}`
}

export function buildHosterPageUrl(provider: Hoster, fileId: string): string {
  const id = encodeURIComponent(fileId)
  return provider === 'pixeldrain' ? `https://pixeldrain.com/u/${id}` : `https://1fichier.com/?${id}`
}

/** Accepte un ID brut ou une URL complète (pixeldrain.com/u/…, /api/file/…, 1fichier.com/?…&af=…) → ID seul. */
export function extractFileId(provider: Hoster, value: string): string {
  const v = value.trim()
  if (provider === 'pixeldrain') return v.match(/pixeldrain\.com\/(?:u|l|api\/file)\/([A-Za-z0-9]+)/)?.[1] ?? v
  return v.match(/1fichier\.com\/\?([A-Za-z0-9]+)/)?.[1] ?? v.match(/^([A-Za-z0-9]+)(?:&.*)?$/)?.[1] ?? v
}
