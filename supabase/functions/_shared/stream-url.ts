// Reconstruction des URL à partir de (provider, file_id) — rien n'est stocké en base hormis l'ID.
export type Hoster = 'pixeldrain' | 'onefichier'

const FILE_ID = /^[A-Za-z0-9_-]{4,32}$/

export function assertFileId(fileId: string | null | undefined): string {
  if (!fileId || !FILE_ID.test(fileId)) throw new Error(`file_id invalide: ${fileId}`)
  return fileId
}

/** URL directe lisible par <video> (Pixeldrain) ou lien hébergeur à débrider (1fichier). */
export function buildStreamUrl(provider: Hoster, fileId: string): string {
  const id = encodeURIComponent(assertFileId(fileId))
  switch (provider) {
    case 'pixeldrain':
      return `https://pixeldrain.com/api/file/${id}`
    case 'onefichier':
      return `https://1fichier.com/?${id}`
  }
}

/** Page publique de l'hébergeur (admin / logs). */
export function buildHosterPageUrl(provider: Hoster, fileId: string): string {
  const id = encodeURIComponent(assertFileId(fileId))
  return provider === 'pixeldrain' ? `https://pixeldrain.com/u/${id}` : `https://1fichier.com/?${id}`
}

export const pixeldrainInfoUrl = (fileId: string) => `${buildStreamUrl('pixeldrain', fileId)}/info`
