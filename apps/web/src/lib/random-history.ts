// Historique des vidéos lancées par « Aléatoire » : elles ne reviennent pas dans les listes suivantes (gardé par profil, sur cet appareil).
const MAX = 6000
const key = (profileId: string) => `sf:random-played:${profileId}`

export function playedIds(profileId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(profileId)) ?? '[]')
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

export function markPlayed(profileId: string, titleId: string) {
  const list = playedIds(profileId).filter((i) => i !== titleId)
  list.push(titleId)
  try {
    localStorage.setItem(key(profileId), JSON.stringify(list.slice(-MAX)))
  } catch {
    /* stockage plein ou indisponible */
  }
}

/** Plus rien à tirer : on repart de zéro. */
export function resetPlayed(profileId: string) {
  try {
    localStorage.removeItem(key(profileId))
  } catch {
    /* ignoré */
  }
}
