// Jaquettes générées : couleurs et symbole déterministes (aléatoires d'un fichier à l'autre, stables pour un même fichier).
export const MODEL_MARK = '#model'

export const isModelCover = (url: string | null | undefined): url is string => !!url && url.endsWith(MODEL_MARK)
export const stripModelMark = (url: string) => url.slice(0, -MODEL_MARK.length)

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type CoverStyle = { from: string; to: string; accent: string; angle: number; symbol: number }

export const SYMBOLS = ['circle', 'triangle', 'diamond', 'star', 'bolt', 'heart', 'moon', 'square'] as const

export function coverStyle(seed: string): CoverStyle {
  const h = hash(seed)
  const h1 = h % 360
  const h2 = (h1 + 40 + ((h >>> 9) % 140)) % 360
  const h3 = (h1 + 180 + ((h >>> 17) % 60)) % 360
  return {
    from: `hsl(${h1} 70% 32%)`,
    to: `hsl(${h2} 75% 20%)`,
    accent: `hsl(${h3} 90% 58%)`,
    angle: (h >>> 4) % 360,
    symbol: (h >>> 13) % SYMBOLS.length,
  }
}
