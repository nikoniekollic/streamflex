// Côté client : la base ne stocke que (provider, file_id). Les URL sont reconstruites à la volée.
// La lecture passe par l'Edge `resolve-stream` ; ces helpers servent à l'admin (lien de contrôle)
// et à la saisie (extraction d'un ID depuis une URL collée).
export type Hoster = 'onefichier'

export const FILE_ID_RE = /^[A-Za-z0-9_-]{4,32}$/
export const isHoster = (p: string): p is Hoster => p === 'onefichier'

export function buildStreamUrl(_provider: Hoster, fileId: string): string {
  return `https://1fichier.com/?${encodeURIComponent(fileId)}`
}

export const buildHosterPageUrl = buildStreamUrl

/** Accepte un ID brut ou une URL complète (1fichier.com/?…&af=…) → ID seul. */
export function extractFileId(_provider: Hoster, value: string): string {
  const v = value.trim()
  return v.match(/1fichier\.com\/\?([A-Za-z0-9]+)/)?.[1] ?? v.match(/^([A-Za-z0-9]+)(?:&.*)?$/)?.[1] ?? v
}
