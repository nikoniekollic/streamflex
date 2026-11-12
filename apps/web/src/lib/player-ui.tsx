import { createContext, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/** Classes des boutons de la barre du lecteur (style choisi dans l'admin), lues par les boutons et les menus */
export const PlayerButtonCls = createContext('')

// Personnalisation complète du lecteur vidéo (admin → Apparence → « Design du lecteur ») : couleurs, barre de progression,
// boutons, barres de commandes, sous-titres, comportement. Partagé par le lecteur et la simulation de l'admin.

export type PlayerButtons = {
  skip: boolean
  volume: boolean
  time: boolean
  settings: boolean
  bookmarks: boolean
  subtitles: boolean
  audio: boolean
  fullscreen: boolean
  arrows: boolean
}

export type PlayerSubs = { size: number; color: string; bg: string; bgOpacity: number; shadow: boolean; bold: boolean }

export type PlayerUi = {
  preset: string
  /** couleur de la progression, du curseur, du chargement, des boutons actifs (null = couleur principale du site) */
  accent: string | null
  iconColor: string
  /** police des textes du lecteur : 'site' = celle du site, sinon une clé de SITE_FONTS */
  font: string
  iconSize: number
  buttonStyle: 'plain' | 'circle' | 'glass'
  controlsBg: 'gradient' | 'solid' | 'glass' | 'none'
  controlsOpacity: number
  barHeight: number
  barRound: boolean
  thumb: 'hover' | 'always' | 'hidden'
  thumbSize: number
  trackOpacity: number
  bufferedOpacity: number
  hideDelay: number
  time: 'remaining' | 'elapsed' | 'both'
  showTitle: boolean
  titleSize: number
  spinner: 'ring' | 'dots' | 'bars'
  flash: boolean
  bigPlay: boolean
  seekStep: number
  doubleClick: 'fullscreen' | 'seek'
  buttons: PlayerButtons
  subs: PlayerSubs
}

export const DEFAULT_PLAYER_UI: PlayerUi = {
  preset: 'streamflex',
  accent: null,
  iconColor: '#ffffff',
  font: 'site',
  iconSize: 26,
  buttonStyle: 'plain',
  controlsBg: 'gradient',
  controlsOpacity: 90,
  barHeight: 4,
  barRound: true,
  thumb: 'hover',
  thumbSize: 14,
  trackOpacity: 25,
  bufferedOpacity: 40,
  hideDelay: 3,
  time: 'remaining',
  showTitle: true,
  titleSize: 20,
  spinner: 'ring',
  flash: true,
  bigPlay: false,
  seekStep: 10,
  doubleClick: 'fullscreen',
  buttons: { skip: true, volume: true, time: true, settings: true, bookmarks: true, subtitles: true, audio: true, fullscreen: true, arrows: true },
  subs: { size: 100, color: '#ffffff', bg: '#000000', bgOpacity: 60, shadow: true, bold: false },
}

/** Styles prêts à l'emploi (appliqués par-dessus les réglages par défaut) */
export const PLAYER_PRESETS: { key: string; label: string; swatch: string; patch: Partial<PlayerUi> }[] = [
  { key: 'streamflex', label: 'StreamFlex', swatch: 'var(--primary)', patch: {} },
  { key: 'cinema', label: 'Cinéma', swatch: '#e50914', patch: { accent: '#e50914', iconSize: 30, barHeight: 5, thumb: 'always', thumbSize: 16, time: 'remaining', titleSize: 24, bigPlay: true } },
  { key: 'classic', label: 'Classique', swatch: '#ff3b30', patch: { accent: '#ff3b30', iconSize: 24, barHeight: 3, thumbSize: 13, time: 'both', titleSize: 18, spinner: 'ring' } },
  { key: 'glass', label: 'Verre', swatch: '#7df9ff', patch: { accent: '#7df9ff', controlsBg: 'glass', controlsOpacity: 45, buttonStyle: 'glass', barHeight: 6, thumb: 'always', thumbSize: 16, spinner: 'dots', bigPlay: true } },
  { key: 'neon', label: 'Néon', swatch: '#ff6ec7', patch: { accent: '#ff6ec7', iconColor: '#7df9ff', buttonStyle: 'circle', barHeight: 5, thumb: 'always', spinner: 'bars', subs: { ...DEFAULT_PLAYER_UI.subs, color: '#faff5c' } } },
  { key: 'gold', label: 'Doré', swatch: '#f5c542', patch: { accent: '#f5c542', iconColor: '#fff0b3', controlsBg: 'solid', controlsOpacity: 70, barHeight: 4, thumb: 'hover', font: 'serif', time: 'both' } },
  {
    key: 'minimal',
    label: 'Minimal',
    swatch: '#e5e5e5',
    patch: {
      accent: '#ffffff',
      controlsBg: 'none',
      iconSize: 22,
      barHeight: 2,
      thumb: 'hidden',
      flash: false,
      hideDelay: 2,
      buttons: { ...DEFAULT_PLAYER_UI.buttons, skip: false, bookmarks: false, audio: false, arrows: false },
    },
  },
]

const clamp = (n: unknown, min: number, max: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d)
const HEX = /^#[0-9a-f]{6}$/i
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>

export function normalizePlayerUi(input: unknown): PlayerUi {
  const d = DEFAULT_PLAYER_UI
  const o = obj(input)
  const b = obj(o.buttons)
  const s = obj(o.subs)
  return {
    preset: typeof o.preset === 'string' ? o.preset.slice(0, 20) : d.preset,
    accent: typeof o.accent === 'string' && HEX.test(o.accent) ? o.accent : null,
    iconColor: hex(o.iconColor, d.iconColor),
    font: typeof o.font === 'string' && /^[a-z]{1,20}$/.test(o.font) ? o.font : d.font,
    iconSize: Math.round(clamp(o.iconSize, 16, 44, d.iconSize)),
    buttonStyle: oneOf(o.buttonStyle, ['plain', 'circle', 'glass'] as const, d.buttonStyle),
    controlsBg: oneOf(o.controlsBg, ['gradient', 'solid', 'glass', 'none'] as const, d.controlsBg),
    controlsOpacity: Math.round(clamp(o.controlsOpacity, 0, 100, d.controlsOpacity)),
    barHeight: Math.round(clamp(o.barHeight, 2, 12, d.barHeight)),
    barRound: bool(o.barRound, d.barRound),
    thumb: oneOf(o.thumb, ['hover', 'always', 'hidden'] as const, d.thumb),
    thumbSize: Math.round(clamp(o.thumbSize, 8, 26, d.thumbSize)),
    trackOpacity: Math.round(clamp(o.trackOpacity, 5, 80, d.trackOpacity)),
    bufferedOpacity: Math.round(clamp(o.bufferedOpacity, 0, 90, d.bufferedOpacity)),
    hideDelay: clamp(o.hideDelay, 1, 10, d.hideDelay),
    time: oneOf(o.time, ['remaining', 'elapsed', 'both'] as const, d.time),
    showTitle: bool(o.showTitle, d.showTitle),
    titleSize: Math.round(clamp(o.titleSize, 12, 36, d.titleSize)),
    spinner: oneOf(o.spinner, ['ring', 'dots', 'bars'] as const, d.spinner),
    flash: bool(o.flash, d.flash),
    bigPlay: bool(o.bigPlay, d.bigPlay),
    seekStep: [5, 10, 15, 30, 60].includes(o.seekStep as number) ? (o.seekStep as number) : d.seekStep,
    doubleClick: oneOf(o.doubleClick, ['fullscreen', 'seek'] as const, d.doubleClick),
    buttons: Object.fromEntries(Object.entries(d.buttons).map(([k, v]) => [k, bool(b[k], v)])) as PlayerButtons,
    subs: {
      size: Math.round(clamp(s.size, 50, 250, d.subs.size)),
      color: hex(s.color, d.subs.color),
      bg: hex(s.bg, d.subs.bg),
      bgOpacity: Math.round(clamp(s.bgOpacity, 0, 100, d.subs.bgOpacity)),
      shadow: bool(s.shadow, d.subs.shadow),
      bold: bool(s.bold, d.subs.bold),
    },
  }
}

const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** Variables CSS posées sur le conteneur du lecteur */
export function playerVars(ui: PlayerUi, fontFamily: string | null): CSSProperties {
  return {
    ['--pl-accent' as string]: ui.accent ?? 'var(--primary)',
    ['--pl-icon' as string]: `${ui.iconSize}px`,
    color: ui.iconColor,
    fontFamily: fontFamily ?? undefined,
  }
}

/** Fond d'une barre de commandes (haut ou bas) */
export function controlsBar(ui: PlayerUi, side: 'top' | 'bottom'): { style: CSSProperties; className: string } {
  const a = ui.controlsOpacity / 100
  if (ui.controlsBg === 'none') return { style: {}, className: side === 'top' ? 'pt-4 pb-4' : 'pt-6 pb-4' }
  if (ui.controlsBg === 'gradient') {
    const dir = side === 'top' ? 'to bottom' : 'to top'
    return { style: { backgroundImage: `linear-gradient(${dir}, rgba(0,0,0,${a}), rgba(0,0,0,${a * 0.55}) 50%, transparent)` }, className: side === 'top' ? 'pt-4 pb-12' : 'pt-16 pb-4' }
  }
  return {
    style: { background: `rgba(0,0,0,${a})`, backdropFilter: ui.controlsBg === 'glass' ? 'blur(14px) saturate(1.4)' : undefined },
    className: cn(side === 'top' ? 'pt-3 pb-3' : 'pt-3 pb-3', ui.controlsBg === 'glass' && (side === 'top' ? 'border-b border-white/10' : 'border-t border-white/10')),
  }
}

/** Classes d'un bouton rond de la barre (taille d'icône réglable) */
export function buttonClass(ui: PlayerUi): string {
  return cn(
    'rounded-full p-2 transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-[var(--pl-icon)]',
    ui.buttonStyle === 'plain' && 'hover:bg-white/10',
    ui.buttonStyle === 'circle' && 'bg-black/45 hover:bg-black/70',
    ui.buttonStyle === 'glass' && 'bg-white/10 ring-1 ring-white/20 backdrop-blur-md hover:bg-white/20',
  )
}

/** Feuille de style des sous-titres (::cue) du lecteur */
export function subsCss(ui: PlayerUi, scope: string): string {
  const s = ui.subs
  return `${scope} video::cue{font-size:${(s.size / 100) * 1.1}em;color:${s.color};background:${rgba(s.bg, s.bgOpacity / 100)};font-weight:${s.bold ? 700 : 400};${s.shadow ? 'text-shadow:0 0 4px #000,0 2px 3px #000;' : ''}}`
}

/** Indicateur de chargement (trois styles) */
export function PlayerSpinner({ kind, size = 64 }: { kind: PlayerUi['spinner']; size?: number }) {
  if (kind === 'dots')
    return (
      <span className="flex items-center gap-2" style={{ height: size }} aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="animate-bounce rounded-full bg-[var(--pl-accent)]" style={{ width: size / 5, height: size / 5, animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
    )
  if (kind === 'bars')
    return (
      <span className="flex items-end gap-1.5" style={{ height: size * 0.7 }} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="animate-pulse rounded-sm bg-[var(--pl-accent)]" style={{ width: size / 8, height: `${40 + ((i * 23) % 60)}%`, animationDelay: `${i * 0.12}s` }} />
        ))}
      </span>
    )
  return <span className="block animate-spin rounded-full border-4 border-white/20 border-t-[var(--pl-accent)]" style={{ width: size * 0.8, height: size * 0.8 }} aria-hidden />
}
