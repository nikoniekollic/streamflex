import { DEFAULT_SETTINGS, NAME_PALETTES, type SiteSettings } from '@/lib/site-settings'

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

// ───────── Nom du modèle au centre de la jaquette : police et couleurs propres à chaque modèle
// (polices système uniquement : la CSP interdit les polices distantes). Réglable depuis l'admin (Apparence).
export const NAME_FONTS = [
  { key: 'impact', label: 'Impact', family: "Impact, 'Arial Narrow', sans-serif", weight: 400, style: 'normal', upper: true, spacing: '0.04em' },
  { key: 'georgia', label: 'Georgia italique', family: "Georgia, 'Times New Roman', serif", weight: 700, style: 'italic', upper: false, spacing: '0' },
  { key: 'courier', label: 'Machine à écrire', family: "'Courier New', monospace", weight: 700, style: 'normal', upper: true, spacing: '0.02em' },
  { key: 'trebuchet', label: 'Trebuchet', family: "'Trebuchet MS', Helvetica, sans-serif", weight: 800, style: 'normal', upper: false, spacing: '0' },
  { key: 'script', label: 'Manuscrit', family: "'Brush Script MT', 'Segoe Script', cursive", weight: 700, style: 'italic', upper: false, spacing: '0.02em' },
  { key: 'palatino', label: 'Palatino', family: "'Palatino Linotype', Palatino, serif", weight: 700, style: 'normal', upper: true, spacing: '0.12em' },
  { key: 'verdana', label: 'Verdana espacée', family: 'Verdana, Geneva, sans-serif', weight: 700, style: 'normal', upper: true, spacing: '0.18em' },
  { key: 'comic', label: 'Comic', family: "'Comic Sans MS', 'Chalkboard SE', cursive", weight: 700, style: 'normal', upper: false, spacing: '0' },
  { key: 'arialblack', label: 'Arial Black', family: "'Arial Black', Gadget, sans-serif", weight: 900, style: 'normal', upper: true, spacing: '0' },
  { key: 'lucida', label: 'Lucida', family: "'Lucida Console', Monaco, monospace", weight: 700, style: 'normal', upper: false, spacing: '0.05em' },
] as const

export type ModelNameStyle = {
  fontFamily: string
  fontWeight: number
  fontStyle: string
  textTransform: 'uppercase' | 'none'
  letterSpacing: string
  color: string
  stroke: string
  glow: string
  fontSize: string
}

export function modelNameStyle(name: string, cfg: SiteSettings['names'] = DEFAULT_SETTINGS.names): ModelNameStyle {
  const h = hash(name.toLowerCase())
  const f = NAME_FONTS.find((x) => x.key === cfg.font) ?? NAME_FONTS[h % NAME_FONTS.length]
  const hue = (h >>> 8) % 360
  const len = name.length
  const px = (len <= 8 ? 1.7 : len <= 14 ? 1.35 : len <= 22 ? 1.1 : 0.95) * cfg.size
  let color = `hsl(${hue} 95% 80%)`
  let stroke = `hsl(${(hue + 180) % 360} 85% 14%)`
  let glow = `hsl(${(hue + 30) % 360} 100% 55%)`
  if (cfg.colorMode === 'palette') {
    const colors = NAME_PALETTES.find((p) => p.key === cfg.palette)?.colors ?? NAME_PALETTES[0].colors
    color = colors[(h >>> 8) % colors.length]
    stroke = '#0d0d0dcc'
    glow = color
  } else if (cfg.colorMode === 'fixed') {
    color = cfg.color
    stroke = cfg.stroke
    glow = cfg.color
  }
  return {
    fontFamily: f.family,
    fontWeight: f.weight,
    fontStyle: f.style,
    textTransform: cfg.upper === 'auto' ? (f.upper ? 'uppercase' : 'none') : cfg.upper === 'on' ? 'uppercase' : 'none',
    letterSpacing: f.spacing,
    color,
    stroke,
    glow: cfg.glow ? glow : 'transparent',
    fontSize: `${px.toFixed(2)}rem`,
  }
}
