import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useRouteContext } from '@tanstack/react-router'
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SORT_OPTIONS, type SortKey } from '@/lib/sort'
import { formatSpan, parseSpan, type VideoFilters } from '@/lib/search'

export type PanelValue = VideoFilters & { model?: string; kind?: 'videos' | 'models'; q?: string }

// Crans du curseur de durée : fins pour les vidéos courtes, plus larges ensuite ; le dernier = « 2 h et plus » (sans limite)
const STOPS = [0, 15, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1500, 1800, 2400, 3000, 3600, 4500, 5400, 7200]
const LAST = STOPS.length - 1
const nearest = (s: number | undefined, d: number) => (s ? STOPS.reduce((best, v, i) => (Math.abs(v - s) < Math.abs(STOPS[best] - s) ? i : best), 0) : d)

let modelsCache: Promise<{ id: string; name: string; n: number }[]> | null = null
function loadModels(s: SupabaseClient) {
  modelsCache ??= Promise.resolve(s.rpc('catalog_models', { p_limit: 200, p_offset: 0, p_sort: 'az' })).then(({ data, error }) => {
    if (error) {
      modelsCache = null
      return []
    }
    return ((data ?? []) as { id: string; name: string; titles_count: number }[]).map((m) => ({ id: m.id, name: m.name, n: Number(m.titles_count) }))
  })
  return modelsCache
}

const selectCls = 'h-10 w-full rounded-md border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white/40'
const inputCls = 'h-10 w-full rounded-md border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-white/40'

/**
 * Panneau de filtres (façon « Filtres de base / Filtres de recherche ») : tri, type, modèle, durée (curseur double + saisie),
 * recherche dans la page, correspondance exacte. Les choix ne s'appliquent qu'au clic sur « Appliquer » (ou Entrée).
 */
export function FilterPanel({
  value,
  onApply,
  showModel = false,
  showKind = false,
  showQuery = false,
  queryPlaceholder = 'Rechercher une vidéo…',
  defaultOpen = false,
}: {
  value: PanelValue
  onApply: (v: PanelValue) => void
  showModel?: boolean
  showKind?: boolean
  showQuery?: boolean
  queryPlaceholder?: string
  defaultOpen?: boolean
}) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [open, setOpen] = useState(defaultOpen)
  const [d, setD] = useState<PanelValue>(value)
  const [minTxt, setMinTxt] = useState('')
  const [maxTxt, setMaxTxt] = useState('')
  const [models, setModels] = useState<{ id: string; name: string; n: number }[]>([])
  const key = JSON.stringify(value)

  // valeur de l'adresse → brouillon (retour arrière, lien partagé)
  useEffect(() => {
    setD(value)
    setMinTxt(value.min ? formatSpan(value.min) : '')
    setMaxTxt(value.max ? formatSpan(value.max) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (showModel && open) void loadModels(supabase as unknown as SupabaseClient).then(setModels)
  }, [showModel, open, supabase])

  const active = [value.sort, value.min || value.max, value.exact, value.model, value.kind].filter(Boolean).length
  const lo = nearest(d.min, 0)
  const hi = nearest(d.max, LAST)
  const setSpan = (a: number, b: number) => {
    const min = a > 0 ? STOPS[a] : undefined
    const max = b < LAST ? STOPS[b] : undefined
    setD((x) => ({ ...x, min, max }))
    setMinTxt(min ? formatSpan(min) : '')
    setMaxTxt(max ? formatSpan(max) : '')
  }
  const apply = () => {
    const min = parseSpan(minTxt)
    const max = parseSpan(maxTxt)
    onApply({ ...d, min, max: max && (!min || max >= min) ? max : undefined, q: d.q?.trim() || undefined })
  }
  const clear = () => {
    setMinTxt('')
    setMaxTxt('')
    setD({ q: value.q })
    onApply({ q: value.q })
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        {showQuery && (
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-500" aria-hidden />
            <input
              type="search"
              value={d.q ?? ''}
              onChange={(e) => setD((x) => ({ ...x, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              placeholder={queryPlaceholder}
              aria-label={queryPlaceholder}
              className={cn(inputCls, 'pl-9')}
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn('ml-auto flex h-10 items-center gap-2 rounded-md border border-white/10 bg-neutral-900 px-3 text-sm font-medium transition hover:border-white/30', open && 'border-white/30')}
        >
          <SlidersHorizontal className="size-4" /> Filtres
          {active > 0 && <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{active}</span>}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <form
          className="mt-2 rounded-lg border border-white/10 bg-neutral-950/95 p-4 shadow-xl"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <fieldset className="grid content-start gap-4">
              <legend className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-sm font-semibold">
                <SlidersHorizontal className="size-4" /> Filtres de base
              </legend>
              <div className={cn('grid gap-4', showKind && 'sm:grid-cols-2')}>
                <label className="grid gap-1.5 text-xs text-neutral-400">
                  Trier par
                  <select className={selectCls} value={d.sort ?? ''} onChange={(e) => setD((x) => ({ ...x, sort: (e.target.value || undefined) as SortKey | undefined }))}>
                    <option value="">{showKind && d.q ? 'Pertinence' : 'Plus récent'}</option>
                    {SORT_OPTIONS.filter((o) => (showKind && d.q ? true : o.value !== 'recent')).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {showKind && (
                  <label className="grid gap-1.5 text-xs text-neutral-400">
                    Type
                    <select className={selectCls} value={d.kind ?? ''} onChange={(e) => setD((x) => ({ ...x, kind: (e.target.value || undefined) as PanelValue['kind'] }))}>
                      <option value="">Vidéos et modèles</option>
                      <option value="videos">Vidéos seulement</option>
                      <option value="models">Modèles seulement</option>
                    </select>
                  </label>
                )}
              </div>
            </fieldset>

            <fieldset className="grid content-start gap-4">
              <legend className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3 text-sm font-semibold">
                <Search className="size-4" /> Filtres de recherche
              </legend>
              {showModel && (
                <label className="grid gap-1.5 text-xs text-neutral-400">
                  Modèle
                  <select className={selectCls} value={d.model ?? ''} onChange={(e) => setD((x) => ({ ...x, model: e.target.value || undefined }))}>
                    <option value="">Tous les modèles</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.n})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span>Durée de la vidéo</span>
                  <span className="text-neutral-300">{lo === 0 && hi === LAST ? 'Toutes durées' : `${lo === 0 ? '0 s' : formatSpan(STOPS[lo])} – ${hi === LAST ? '2 h et +' : formatSpan(STOPS[hi])}`}</span>
                </div>
                <DualRange lo={lo} hi={hi} max={LAST} onChange={setSpan} />
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <span>0 s</span>
                  <span>2 h +</span>
                </div>
                <div className="flex items-center gap-2">
                  <SpanInput label="Min" value={minTxt} onChange={setMinTxt} />
                  <span className="text-neutral-500">–</span>
                  <SpanInput label="Max" value={maxTxt} onChange={setMaxTxt} />
                </div>
                <p className="text-[11px] text-neutral-500">Ex. : 45 s, 5 min, 1:30, 1 h 15 (un nombre seul = minutes)</p>
              </div>
              {(showQuery || showKind) && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!d.exact} onChange={(e) => setD((x) => ({ ...x, exact: e.target.checked || undefined }))} className="size-4 accent-[var(--primary)]" />
                  Correspondance exacte
                </label>
              )}
            </fieldset>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
            <button type="button" onClick={clear} className="flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-neutral-300 hover:text-white">
              <X className="size-4" /> Effacer
            </button>
            <button type="submit" className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Check className="size-4" /> Appliquer
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function SpanInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex h-10 flex-1 items-center gap-2 rounded-md border border-white/10 bg-neutral-900 px-3 text-sm focus-within:ring-2 focus-within:ring-white/40">
      <span className="text-xs text-neutral-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Toutes" aria-label={`Durée ${label.toLowerCase()}`} className="min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-neutral-500" />
    </label>
  )
}

/** Curseur à deux poignées (deux curseurs natifs superposés : clavier et tactile gérés par le navigateur). */
function DualRange({ lo, hi, max, onChange }: { lo: number; hi: number; max: number; onChange: (lo: number, hi: number) => void }) {
  const pct = (v: number) => `${(v / max) * 100}%`
  const thumb =
    'pointer-events-none absolute inset-x-0 top-1/2 h-0 w-full -translate-y-1/2 appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--primary)] [&::-webkit-slider-thumb]:bg-neutral-950 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--primary)] [&::-moz-range-thumb]:bg-neutral-950'
  return (
    <div className="relative h-5">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--primary)]" style={{ left: pct(lo), right: `calc(100% - ${pct(hi)})` }} />
      <input type="range" min={0} max={max} step={1} value={lo} aria-label="Durée minimale" onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)} className={thumb} />
      <input type="range" min={0} max={max} step={1} value={hi} aria-label="Durée maximale" onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))} className={thumb} />
    </div>
  )
}
