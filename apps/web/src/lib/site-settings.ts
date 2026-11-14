import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { DEFAULT_PLAYER_UI, normalizePlayerUi, type PlayerUi } from '@/lib/player-ui'

// Réglages d'apparence modifiables par l'admin (table site_settings, ligne unique) : thème, nom des modèles, aperçus.
// Table ajoutée après la génération de database.ts → client non typé.
const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

export type Fit = 'auto' | 'cover' | 'stretch'
export type CardFit = 'cover' | 'contain' | 'stretch'
/** point de la jaquette en % (0/0 = coin haut gauche, 100/100 = coin bas droit) */
export type Point = { x: number; y: number }
/** cadrage de la vidéo dans son cadre : centré, calé en haut ou en bas */
export type Pos = 'center' | 'top' | 'bottom'
export const CSS_POS: Record<Pos, string> = { center: 'center', top: 'center top', bottom: 'center bottom' }

/** Formats proposés partout (jaquettes, modèles, bannière, lecteur) ; « w:h » libre accepté aussi. */
export const RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:16', '4:3', '3:2', '16:10', '16:9', '21:9', '2:1', '3:1'] as const
const RATIO_RE = /^\d{1,2}:\d{1,2}$/
const okRatio = (v: unknown, d: string) => (typeof v === 'string' && RATIO_RE.test(v) && !v.split(':').includes('0') ? v : d)
/** « 16:9 » → « 16 / 9 » (propriété CSS aspect-ratio) */
export const ratioCss = (r: string) => r.replace(':', ' / ')

/** Aspect de la durée affichée sur les jaquettes (la position est dans cards.durationPos) */
export type DurationStyle = { show: boolean; format: 'clock' | 'text'; size: number; color: string; bg: string; bgOpacity: number; radius: number; bold: boolean; padX: number }
const DEFAULT_DURATION: DurationStyle = { show: true, format: 'clock', size: 11, color: '#ffffff', bg: '#000000', bgOpacity: 75, radius: 4, bold: true, padX: 6 }

/** Style CSS de la pastille de durée (jaquettes et simulation de l'admin) */
export const durationCss = (d: DurationStyle): CSSProperties => {
  const n = parseInt(d.bg.slice(1), 16)
  return {
    fontSize: d.size,
    color: d.color,
    background: `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${d.bgOpacity / 100})`,
    borderRadius: d.radius,
    fontWeight: d.bold ? 700 : 400,
    padding: `2px ${d.padX}px`,
    lineHeight: 1.25,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  }
}

export type SiteSettings = {
  theme: { preset: string; primary: string | null; background: string | null; font: string; radius: number }
  names: { show: boolean; font: string; colorMode: 'auto' | 'palette' | 'fixed'; palette: string; color: string; stroke: string; glow: boolean; size: number; upper: 'auto' | 'on' | 'off'; x: number; y: number }
  preview: {
    // jaquette survolée
    fit: Fit
    hoverPos: Pos
    clipSeconds: number
    volume: number
    pauseButton: boolean
    // jaquette au repos
    cardFit: CardFit
    restPos: Pos
    ambient: boolean
    ambientMax: number
    // bannière d'accueil et fond des pages de titre
    bannerVideo: boolean
    bannerFit: Fit
    bannerPos: Pos
    bannerClip: number
  }
  /** lecteur en premier plan : fenêtre centrée sur un fond flou transparent, ou plein écran */
  player: { mode: 'window' | 'full'; size: number; backdrop: number; blur: number; radius: number; fit: 'contain' | 'cover' | 'stretch'; ratio: string }
  /** formats des jaquettes de films et de modèles, icônes rondes en bas des jaquettes */
  cards: { ratio: string; modelRatio: string; icons: boolean; modelEmoji: string; videoEmoji: string; emojiFromName: boolean; modelPos: Point; videoPos: Point; durationPos: Point; duration: DurationStyle }
  /** bannière d'accueil : hauteur (en % de la hauteur de l'écran) ou format fixe */
  hero: { ratio: string; height: number; radius: number }
  /** jaquettes de modèles : photo, image capturée d'une de leurs vidéos, ou photo puis capture si absente */
  models: { image: 'auto' | 'photo' | 'capture' }
  /** design du lecteur : couleurs, barre de progression, boutons, sous-titres, comportement */
  playerUi: PlayerUi
  /** halo lumineux autour des jaquettes (survol ou permanent) et du lecteur */
  glow: Glow
}

export type Glow = {
  cards: 'off' | 'hover' | 'always'
  models: boolean
  player: boolean
  source: 'accent' | 'custom' | 'rainbow'
  color: string
  size: number
  strength: number
  pulse: boolean
}
export const DEFAULT_GLOW: Glow = { cards: 'hover', models: true, player: true, source: 'custom', color: '#e50914', size: 22, strength: 60, pulse: false }

export const DEFAULT_SETTINGS: SiteSettings = {
  theme: { preset: 'default', primary: null, background: null, font: 'system', radius: 0.625 },
  names: { show: true, font: 'auto', colorMode: 'auto', palette: 'neon', color: '#ffffff', stroke: '#1a0a0a', glow: true, size: 1, upper: 'auto', x: 50, y: 50 },
  preview: {
    fit: 'auto',
    hoverPos: 'center',
    clipSeconds: 30,
    volume: 0.7,
    pauseButton: true,
    cardFit: 'cover',
    restPos: 'center',
    ambient: true,
    ambientMax: 6,
    bannerVideo: true,
    bannerFit: 'cover',
    bannerPos: 'center',
    bannerClip: 30,
  },
  player: { mode: 'window', size: 72, backdrop: 55, blur: 14, radius: 16, fit: 'contain', ratio: '16:9' },
  cards: { ratio: '2:3', modelRatio: '2:3', icons: true, modelEmoji: '😀', videoEmoji: '▶️', emojiFromName: true, modelPos: { x: 8, y: 93 }, videoPos: { x: 92, y: 93 }, durationPos: { x: 50, y: 93 }, duration: DEFAULT_DURATION },
  hero: { ratio: 'auto', height: 62, radius: 16 },
  models: { image: 'auto' },
  playerUi: DEFAULT_PLAYER_UI,
  glow: DEFAULT_GLOW,
}

export const THEME_PRESETS = [
  { key: 'default', label: 'StreamFlex', primary: null, background: null, swatch: ['#e5322d', '#141414'] },
  { key: 'ocean', label: 'Océan', primary: '#0ea5e9', background: '#0b1220', swatch: ['#0ea5e9', '#0b1220'] },
  { key: 'forest', label: 'Forêt', primary: '#22c55e', background: '#0c1510', swatch: ['#22c55e', '#0c1510'] },
  { key: 'violet', label: 'Violet', primary: '#a855f7', background: '#140d1f', swatch: ['#a855f7', '#140d1f'] },
  { key: 'gold', label: 'Or', primary: '#f59e0b', background: '#17130a', swatch: ['#f59e0b', '#17130a'] },
  { key: 'rose', label: 'Rose', primary: '#ec4899', background: '#1a0c14', swatch: ['#ec4899', '#1a0c14'] },
  { key: 'mono', label: 'Monochrome', primary: '#e5e5e5', background: '#0a0a0a', swatch: ['#e5e5e5', '#0a0a0a'] },
] as const

export const NAME_PALETTES = [
  { key: 'neon', label: 'Néon', colors: ['#ff6ec7', '#7df9ff', '#faff5c', '#7dff7d', '#ffa64d', '#c792ff'] },
  { key: 'pastel', label: 'Pastel', colors: ['#ffd1dc', '#c1e1ff', '#fdfd96', '#b5ead7', '#e2c2ff', '#ffdac1'] },
  { key: 'warm', label: 'Chaud', colors: ['#ff8a5c', '#ffd166', '#ef476f', '#f78c6b', '#ffe29a', '#ff5d73'] },
  { key: 'cold', label: 'Froid', colors: ['#8ecae6', '#48cae4', '#90e0ef', '#b8c0ff', '#a2d2ff', '#6fffe9'] },
  { key: 'gold', label: 'Doré', colors: ['#ffd700', '#f5c542', '#ffe08a', '#e6b800', '#fff0b3', '#d4a017'] },
  { key: 'mono', label: 'Blanc & gris', colors: ['#ffffff', '#e5e5e5', '#d4d4d4', '#f5f5f5'] },
] as const

export const SITE_FONTS = [
  { key: 'system', label: 'Système (défaut)', family: null },
  { key: 'humanist', label: 'Humaniste', family: "'Segoe UI', Candara, 'Trebuchet MS', sans-serif" },
  { key: 'geometric', label: 'Géométrique', family: "Verdana, Geneva, sans-serif" },
  { key: 'serif', label: 'Serif', family: "Georgia, 'Times New Roman', serif" },
  { key: 'mono', label: 'Monospace', family: "'Cascadia Code', 'Courier New', monospace" },
] as const

const point = (v: unknown, d: Point): Point => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { x: clamp(o.x, 0, 100, d.x), y: clamp(o.y, 0, 100, d.y) }
}
/** Style de placement : l'élément est posé au point (x %, y %) de la jaquette, sans jamais sortir du cadre (marge de 8 px aux bords). */
export const pin = (p: Point): CSSProperties => ({
  position: 'absolute',
  left: `calc(${p.x}% + ${(50 - p.x) * 0.16}px)`,
  top: `calc(${p.y}% + ${(50 - p.y) * 0.16}px)`,
  transform: `translate(-${p.x}%, -${p.y}%)`,
})

const clamp = (n: unknown, min: number, max: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d)
const HEX = /^#[0-9a-f]{6}$/i
const hex = (v: unknown, d: string | null) => (typeof v === 'string' && HEX.test(v) ? v : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)

/** Fusionne ce qui vient de la base avec les valeurs par défaut (champ absent ou invalide → défaut). */
export function normalizeSettings(input: unknown): SiteSettings {
  const d = DEFAULT_SETTINGS
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, Record<string, unknown> | undefined>
  const t = o.theme ?? {}
  const n = o.names ?? {}
  const p = o.preview ?? {}
  const pl = o.player ?? {}
  const md = o.models ?? {}
  const cd = o.cards ?? {}
  const hr = o.hero ?? {}
  const POS = ['center', 'top', 'bottom'] as const
  return {
    theme: {
      preset: typeof t.preset === 'string' ? t.preset : d.theme.preset,
      primary: hex(t.primary, null),
      background: hex(t.background, null),
      font: oneOf(t.font, SITE_FONTS.map((f) => f.key), 'system'),
      radius: clamp(t.radius, 0, 1.5, d.theme.radius),
    },
    names: {
      show: n.show !== false,
      font: typeof n.font === 'string' ? n.font : 'auto',
      colorMode: oneOf(n.colorMode, ['auto', 'palette', 'fixed'] as const, 'auto'),
      palette: oneOf(n.palette, NAME_PALETTES.map((x) => x.key), 'neon'),
      color: hex(n.color, d.names.color)!,
      stroke: hex(n.stroke, d.names.stroke)!,
      glow: n.glow !== false,
      size: clamp(n.size, 0.6, 1.8, 1),
      upper: oneOf(n.upper, ['auto', 'on', 'off'] as const, 'auto'),
      // anciens réglages (haut / centre / bas, gauche / centre / droite) convertis en coordonnées
      x: clamp(n.x, 0, 100, n.hpos === 'left' ? 10 : n.hpos === 'right' ? 90 : 50),
      y: clamp(n.y, 0, 100, n.vpos === 'top' ? 16 : n.vpos === 'bottom' ? 80 : 50),
    },
    preview: {
      fit: oneOf(p.fit, ['auto', 'cover', 'stretch'] as const, 'auto'),
      hoverPos: oneOf(p.hoverPos, POS, 'center'),
      clipSeconds: clamp(p.clipSeconds, 10, 90, d.preview.clipSeconds),
      volume: clamp(p.volume, 0, 1, d.preview.volume),
      pauseButton: p.pauseButton !== false,
      ambient: p.ambient !== false,
      ambientMax: Math.round(clamp(p.ambientMax, 0, 12, d.preview.ambientMax)),
      cardFit: oneOf(p.cardFit, ['cover', 'contain', 'stretch'] as const, 'cover'),
      restPos: oneOf(p.restPos, POS, 'center'),
      bannerVideo: p.bannerVideo !== false,
      // anciens réglages : la bannière reprenait « fit » et « clipSeconds » (valeurs par défaut propres à la bannière si absentes)
      bannerFit: oneOf(p.bannerFit, ['auto', 'cover', 'stretch'] as const, 'cover'),
      bannerPos: oneOf(p.bannerPos, POS, 'center'),
      bannerClip: clamp(p.bannerClip, 10, 90, d.preview.bannerClip),
    },
    player: {
      mode: oneOf(pl.mode, ['window', 'full'] as const, 'window'),
      size: clamp(pl.size, 40, 100, d.player.size),
      backdrop: clamp(pl.backdrop, 0, 95, d.player.backdrop),
      blur: clamp(pl.blur, 0, 40, d.player.blur),
      radius: clamp(pl.radius, 0, 32, d.player.radius),
      fit: oneOf(pl.fit, ['contain', 'cover', 'stretch'] as const, 'contain'),
      ratio: okRatio(pl.ratio, '16:9'),
    },
    models: { image: oneOf(md.image, ['auto', 'photo', 'capture'] as const, 'auto') },
    cards: {
      ratio: okRatio(cd.ratio, '2:3'),
      modelRatio: okRatio(cd.modelRatio, '2:3'),
      icons: cd.icons !== false,
      modelEmoji: typeof cd.modelEmoji === 'string' && cd.modelEmoji ? cd.modelEmoji.slice(0, 64) : d.cards.modelEmoji,
      videoEmoji: typeof cd.videoEmoji === 'string' && cd.videoEmoji ? cd.videoEmoji.slice(0, 64) : d.cards.videoEmoji,
      emojiFromName: cd.emojiFromName !== false,
      modelPos: point(cd.modelPos, d.cards.modelPos),
      videoPos: point(cd.videoPos, d.cards.videoPos),
      durationPos: point(cd.durationPos, d.cards.durationPos),
      duration: ((du: Record<string, unknown>): DurationStyle => ({
        show: du.show !== false,
        format: oneOf(du.format, ['clock', 'text'] as const, 'clock'),
        size: Math.round(clamp(du.size, 8, 28, DEFAULT_DURATION.size)),
        color: hex(du.color, DEFAULT_DURATION.color)!,
        bg: hex(du.bg, DEFAULT_DURATION.bg)!,
        bgOpacity: Math.round(clamp(du.bgOpacity, 0, 100, DEFAULT_DURATION.bgOpacity)),
        radius: Math.round(clamp(du.radius, 0, 16, DEFAULT_DURATION.radius)),
        bold: du.bold !== false,
        padX: Math.round(clamp(du.padX, 2, 16, DEFAULT_DURATION.padX)),
      }))((cd.duration && typeof cd.duration === 'object' ? cd.duration : {}) as Record<string, unknown>),
    },
    hero: {
      ratio: hr.ratio === 'auto' ? 'auto' : okRatio(hr.ratio, 'auto'),
      height: clamp(hr.height, 25, 95, d.hero.height),
      radius: clamp(hr.radius, 0, 40, d.hero.radius),
    },
    playerUi: normalizePlayerUi(o.playerUi),
    glow: ((g: Record<string, unknown>) => ({
      cards: oneOf(g.cards, ['off', 'hover', 'always'] as const, DEFAULT_GLOW.cards),
      models: g.models !== false,
      player: g.player !== false,
      source: oneOf(g.source, ['accent', 'custom', 'rainbow'] as const, DEFAULT_GLOW.source),
      color: hex(g.color, DEFAULT_GLOW.color)!,
      size: Math.round(clamp(g.size, 4, 80, DEFAULT_GLOW.size)),
      strength: Math.round(clamp(g.strength, 5, 100, DEFAULT_GLOW.strength)),
      pulse: g.pulse === true,
    }))((o.glow && typeof o.glow === 'object' ? o.glow : {}) as Record<string, unknown>),
  }
}

/** Halo : variables CSS et attributs posés sur <html>, lus par la feuille de style (index.css, « Halo lumineux »). */
export function applyGlow(g: Glow, primary: string | null) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  const color = g.source === 'accent' ? (primary ?? 'var(--primary)') : g.color
  el.style.setProperty('--sf-glow-color', color)
  el.style.setProperty('--sf-glow-size', `${g.size}px`)
  el.style.setProperty('--sf-glow-alpha', `${g.strength}%`)
  el.dataset.glowCards = g.cards
  el.dataset.glowModels = g.models ? 'on' : 'off'
  el.dataset.glowPlayer = g.player ? 'on' : 'off'
  el.dataset.glowPulse = g.pulse ? 'on' : 'off'
  el.dataset.glowRainbow = g.source === 'rainbow' ? 'on' : 'off'
}

// ───────── Thème : variables CSS posées sur <html>
function luminance(h: string): number {
  const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

export function applyTheme(t: SiteSettings['theme']) {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  const set = (k: string, v: string | null) => (v ? root.setProperty(k, v) : root.removeProperty(k))
  set('--primary', t.primary)
  set('--ring', t.primary)
  set('--primary-foreground', t.primary ? (luminance(t.primary) > 0.45 ? '#111111' : '#fafafa') : null)
  set('--background', t.background)
  set('--radius', t.radius === DEFAULT_SETTINGS.theme.radius ? null : `${t.radius}rem`)
  const font = SITE_FONTS.find((f) => f.key === t.font)?.family ?? null
  document.body.style.fontFamily = font ?? ''
}

// ───────── Magasin partagé (chargé une fois, mis en cache local pour éviter le flash au rechargement)
const KEY = 'sf:site-settings'
let current: SiteSettings = DEFAULT_SETTINGS
let loading: Promise<void> | null = null
let version = 0
const listeners = new Set<() => void>()

try {
  const cached = localStorage.getItem(KEY)
  if (cached) current = normalizeSettings(JSON.parse(cached))
} catch {
  /* stockage indisponible */
}

if (typeof document !== 'undefined') {
  applyTheme(current.theme)
  applyGlow(current.glow, current.theme.primary)
}

function publish(next: SiteSettings, persist = true) {
  current = next
  version++
  if (persist) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* ignoré */
    }
  }
  applyTheme(next.theme)
  applyGlow(next.glow, next.theme.primary)
  listeners.forEach((l) => l())
}

export function loadSiteSettings(): Promise<void> {
  loading ??= (async () => {
    const { data, error } = await raw(supabase).from('site_settings').select('data').eq('id', 1).maybeSingle()
    if (error) {
      loading = null // on réessaiera au prochain montage
      return
    }
    publish(normalizeSettings(data?.data))
  })()
  return loading
}

export async function saveSiteSettings(s: TypedSupabaseClient, next: SiteSettings): Promise<void> {
  const { error } = await raw(s).rpc('admin_save_site_settings', { p_data: next })
  if (error) throw new Error(error.message.includes('forbidden') ? 'Action réservée aux administrateurs.' : error.message)
  publish(next)
}

/** Aperçu immédiat d'un réglage en cours d'édition (sans l'enregistrer). */
export const previewSettings = (next: SiteSettings) => publish(next, false)

/** Recharge la version enregistrée (annule un aperçu non sauvegardé). */
export function reloadSiteSettings(): Promise<void> {
  loading = null
  return loadSiteSettings()
}
export const getSiteSettings = () => current

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useSiteSettings(): SiteSettings {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => void loadSiteSettings(), [])
  return current
}
