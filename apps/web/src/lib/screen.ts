// Mise en page adaptée à l'écran du visiteur
// Avant : 6 colonnes au plus, quelle que soit la résolution. Sur un écran 1440p ou 4K, chaque jaquette faisait 400 à 600 px de
// large (aperçus lourds, une ligne et demie visible) ; sur un petit portable, 48 jaquettes étaient chargées d'un coup.
// Maintenant les jaquettes gardent une taille constante (--sf-card-w, voir index.css) : un grand écran affiche PLUS de colonnes,
// et chaque page charge un nombre de vidéos adapté au nombre de colonnes réellement affichées (lignes complètes).

const GAP = 12 // gap-3

/** Largeur d'une jaquette (pixels CSS) : identique à --sf-card-w dans index.css. */
export function cardWidth(viewport = typeof window === 'undefined' ? 1440 : window.innerWidth): number {
  return Math.min(230, Math.max(150, viewport * 0.105))
}

/** Nombre de colonnes de jaquettes affichées sur cet écran (marges de page comprises). */
export function gridColumns(viewport = typeof window === 'undefined' ? 1440 : window.innerWidth): number {
  const pad = viewport >= 768 ? 96 : 48 // px-6 md:px-12
  const content = Math.max(0, viewport - pad)
  const half = (content - GAP) / 2 // jamais moins de 2 colonnes (téléphone)
  const w = Math.min(cardWidth(viewport), half)
  return Math.max(2, Math.floor((content + GAP) / (w + GAP)))
}

/**
 * Taille d'une page de jaquettes : environ `target` vidéos, arrondi à des lignes complètes.
 * Téléphone (2 colonnes) : 24 au plus. Grand écran : plus de colonnes, autant de lignes qu'il faut pour remplir l'écran.
 */
export function gridPageSize(target = 48): number {
  const cols = gridColumns()
  const rows = Math.max(4, Math.min(12, Math.round(target / cols)))
  return cols * rows
}
