// Reconstruction des URL à partir de (provider, file_id) — rien n'est stocké en base hormis l'ID.
export type Hoster = 'onefichier'

const FILE_ID = /^[A-Za-z0-9_-]{4,32}$/

export function assertFileId(fileId: string | null | undefined): string {
  if (!fileId || !FILE_ID.test(fileId)) throw new Error(`file_id invalide: ${fileId}`)
  return fileId
}

/** Page publique 1fichier d'un fichier (utilisée pour l'API du compte). */
export function buildStreamUrl(_provider: Hoster, fileId: string): string {
  return `https://1fichier.com/?${encodeURIComponent(assertFileId(fileId))}`
}

/** Page publique de l'hébergeur (admin / logs). */
export const buildHosterPageUrl = buildStreamUrl
