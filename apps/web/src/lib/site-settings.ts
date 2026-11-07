import { useEffect, useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'

// Réglages d'apparence modifiables par l'admin (table site_settings, ligne unique) : thème, nom des modèles, aperçus.
// Table ajoutée après la génération de database.ts → client non typé.
const raw = (s: TypedSupabaseClient) => s as unknown as SupabaseClient

export type Fit = 'auto' | 'cover' | 'stretch'
export type CardFit = 'cover' | 'contain' | 'stretch'

export type SiteSettings = {
  theme: { preset: string; primary: string | null; background: string | null; font: string; radius: number }
  names: { show: boolean; font: string; colorMode: 'auto' | 'palette' | 'fixed'; palette: string; color: string; stroke: string; glow: boolean; size: number; upper: 'auto' | 'on' | 'off' }
  preview: { fit: Fit; ratio: string; width: number; clipSeconds: number; volume: number; pauseButton: boolean; ambient: boolean; cardFit: CardFit }
}

export const DEFAULT_SETTINGS: SiteSettings = {
  theme: { preset: 'default', primary: null, background: null, font: 'system', radius: 0.625 },
  names: { show: true, font: 'auto', colorMode: 'auto', palette: 'neon', color: '#ffffff', stroke: '#1a0a0a', glow: true, size: 1, upper: 'auto' },
  preview: { fit: 'auto', ratio: 'auto', width: 440, clipSeconds: 30, volume: 0.7, pauseButton: true, ambient: true, cardFit: 'cover' },
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
    },
    preview: {
      fit: oneOf(p.fit, ['auto', 'cover', 'stretch'] as const, 'auto'),
      ratio: oneOf(p.ratio, ['auto', '16:9', '4:3', '1:1', '3:4', '9:16'] as const, 'auto'),
      width: clamp(p.width, 300, 640, d.preview.width),
      clipSeconds: clamp(p.clipSeconds, 10, 90, d.preview.clipSeconds),
      volume: clamp(p.volume, 0, 1, d.preview.volume),
      pauseButton: p.pauseButton !== false,
      ambient: p.ambient !== false,
      cardFit: oneOf(p.cardFit, ['cover', 'contain', 'stretch'] as const, 'cover'),
    },
  }
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

if (typeof document !== 'undefined') applyTheme(current.theme)

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
