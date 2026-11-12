import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { NAME_FONTS, modelNameStyle } from '@/lib/cover'
import { nameBox } from '@/components/catalog/ModelName'
import { EmojiPickerButton } from '@/components/emoji/EmojiPickerButton'
import { EmojiView } from '@/lib/emoji-media'
import { PlayerDesignPanel } from '@/components/admin/PlayerDesignPanel'
import {
  CSS_POS,
  DEFAULT_SETTINGS,
  pin,
  RATIOS,
  durationCss,
  ratioCss,
  NAME_PALETTES,
  SITE_FONTS,
  THEME_PRESETS,
  getSiteSettings,
  loadSiteSettings,
  previewSettings,
  reloadSiteSettings,
  saveSiteSettings,
  type Fit,
  type Pos,
  type SiteSettings,
} from '@/lib/site-settings'

export const Route = createFileRoute('/_authed/_shell/admin/appearance')({
  component: AppearanceAdmin,
})

const SAMPLE_NAMES = ['Alice', 'Jessica Rose', 'Marie-Charlotte Dubois']
const selectCls = 'h-9 rounded-md border bg-background px-2 text-sm'

// Image de démonstration 16:9 (cadre, croix, cercle) : montre ce que l'ajustement rogne ou déforme
const DEMO = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#6d28d9'/><stop offset='1' stop-color='#0ea5e9'/></linearGradient></defs><rect width='320' height='180' fill='url(#g)'/><rect x='4' y='4' width='312' height='172' fill='none' stroke='white' stroke-width='4'/><circle cx='160' cy='90' r='48' fill='none' stroke='white' stroke-width='6'/><path d='M0 0L320 180M320 0L0 180' stroke='white' stroke-opacity='.5' stroke-width='2'/></svg>",
)}`

const fitCss = (f: Fit) => (f === 'auto' ? 'contain' : f === 'cover' ? 'cover' : 'fill')
const cardFitCss = (f: SiteSettings['preview']['cardFit']) => (f === 'stretch' ? 'fill' : f)

function FitSelect({ value, onChange }: { value: Fit; onChange: (v: Fit) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value as Fit)}>
      <option value="auto">Adapté (vidéo entière, bandes noires)</option>
      <option value="cover">Remplir (rogne les bords)</option>
      <option value="stretch">Étirer (déforme l’image)</option>
    </select>
  )
}

function PosSelect({ value, onChange }: { value: Pos; onChange: (v: Pos) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value as Pos)}>
      <option value="center">Centré</option>
      <option value="top">Calé en haut</option>
      <option value="bottom">Calé en bas</option>
    </select>
  )
}

/** Simulation avec une vidéo 16:9 (cadre blanc = bords, croix = centre) */
function Demo({ label, width, ratio, fit, pos }: { label: string; width: number; ratio: string; fit: string; pos: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label} — simulation avec une vidéo 16:9</p>
      <div className="overflow-hidden rounded-md bg-black ring-1 ring-white/20" style={{ width, aspectRatio: ratio }}>
        <img src={DEMO} alt="" className="size-full" style={{ objectFit: fit as 'cover', objectPosition: pos }} />
      </div>
    </div>
  )
}

/** Format : liste de formats usuels, « auto » (si permis) ou format libre largeur:hauteur. */
function RatioField({ value, onChange, allowAuto }: { value: string; onChange: (v: string) => void; allowAuto?: boolean }) {
  const known = value === 'auto' || (RATIOS as readonly string[]).includes(value)
  const [w, h] = value.split(':')
  return (
    <div className="flex items-center gap-2">
      <select
        className={selectCls}
        value={known ? value : 'custom'}
        onChange={(e) => (e.target.value === 'custom' ? onChange(known && value !== 'auto' ? value : '16:9') : onChange(e.target.value))}
        aria-label="Format"
      >
        {allowAuto && <option value="auto">Auto (selon la hauteur)</option>}
        {RATIOS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value="custom">Personnalisé…</option>
      </select>
      {!known && (
        <span className="flex items-center gap-1 text-sm">
          <input type="number" min={1} max={99} value={w} onChange={(e) => onChange(`${Math.min(99, Math.max(1, Number(e.target.value) || 1))}:${h || 1}`)} className="h-9 w-14 rounded-md border bg-background px-2" aria-label="Largeur du format" />:
          <input type="number" min={1} max={99} value={h} onChange={(e) => onChange(`${w || 1}:${Math.min(99, Math.max(1, Number(e.target.value) || 1))}`)} className="h-9 w-14 rounded-md border bg-background px-2" aria-label="Hauteur du format" />
        </span>
      )}
    </div>
  )
}

/** Position d'un élément sur la jaquette : 9 positions prédéfinies + deux curseurs (même principe que le nom du modèle). */
function PositionPicker({ label, value, onChange }: { label: string; value: { x: number; y: number }; onChange: (p: { x: number; y: number }) => void }) {
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-3">
        <div className="grid w-fit grid-cols-3 gap-1" role="group" aria-label={`Positions prédéfinies : ${label}`}>
          {[8, 50, 93].flatMap((y) =>
            [8, 50, 92].map((x) => (
              <button
                key={`${x}-${y}`}
                type="button"
                aria-label={`${label} à ${x} % / ${y} %`}
                aria-pressed={value.x === x && value.y === y}
                onClick={() => onChange({ x, y })}
                className={cn('size-7 rounded-md border hover:bg-accent', value.x === x && value.y === y && 'border-primary bg-primary/30')}
              />
            )),
          )}
        </div>
        <div className="grid gap-1.5">
          <Range value={value.x} min={0} max={100} step={1} onChange={(x) => onChange({ ...value, x })} format={(v) => `← ${v} % →`} />
          <Range value={value.y} min={0} max={100} step={1} onChange={(y) => onChange({ ...value, y })} format={(v) => `↑ ${v} % ↓`} />
        </div>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Range({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
      <span className="w-14 text-right text-xs tabular-nums">{format ? format(value) : value}</span>
    </div>
  )
}

function Color({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5" />
      <code className="text-xs text-muted-foreground">{value}</code>
    </div>
  )
}

function AppearanceAdmin() {
  const { supabase } = Route.useRouteContext()
  const [draft, setDraft] = useState<SiteSettings>(getSiteSettings())
  const [saved, setSaved] = useState<SiteSettings>(getSiteSettings())
  const [busy, setBusy] = useState(false)

  // Valeur enregistrée côté serveur (le cache local peut dater)
  useEffect(() => {
    void loadSiteSettings().then(() => {
      setSaved(getSiteSettings())
      setDraft(getSiteSettings())
    })
    // sortie de page sans enregistrer : on revient à la version enregistrée
    return () => void reloadSiteSettings()
  }, [])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])

  const edit = <K extends keyof SiteSettings>(group: K, patch: Partial<SiteSettings[K]>) => {
    const next = { ...draft, [group]: { ...draft[group], ...patch } }
    setDraft(next)
    previewSettings(next) // effet visible tout de suite sur tout le site, sans enregistrer
  }

  const save = async () => {
    setBusy(true)
    try {
      await saveSiteSettings(supabase, draft)
      setSaved(draft)
      toast.success('Apparence enregistrée pour tous les utilisateurs')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  const reset = (group: keyof SiteSettings) => edit(group, DEFAULT_SETTINGS[group] as never)

  const { theme, names, preview, player, models, cards, hero } = draft

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-16 z-30 -mx-1 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-3 backdrop-blur">
        <p className="text-sm text-muted-foreground">Les changements s’affichent tout de suite ici ; ils ne deviennent publics qu’une fois enregistrés.</p>
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            disabled={busy || !dirty}
            onClick={async () => {
              await reloadSiteSettings()
              setDraft(getSiteSettings())
            }}
          >
            <RotateCcw className="size-4" /> Annuler
          </Button>
          <Button onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Enregistrer
          </Button>
        </div>
      </div>

      <Section title="Thème du site" hint="Couleur principale (boutons, logo, accents), fond et police de toutes les pages.">
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => edit('theme', { preset: p.key, primary: p.primary, background: p.background })}
              aria-pressed={theme.preset === p.key}
              className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent', theme.preset === p.key && 'border-primary bg-accent')}
            >
              <span className="flex overflow-hidden rounded-full ring-1 ring-white/30">
                <span className="size-5" style={{ background: p.swatch[0] }} />
                <span className="size-5" style={{ background: p.swatch[1] }} />
              </span>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Couleur principale">
            <Color label="Couleur principale" value={theme.primary ?? '#e5322d'} onChange={(v) => edit('theme', { primary: v, preset: 'custom' })} />
          </Field>
          <Field label="Couleur de fond">
            <Color label="Couleur de fond" value={theme.background ?? '#141414'} onChange={(v) => edit('theme', { background: v, preset: 'custom' })} />
          </Field>
          <Field label="Police du site">
            <select className={selectCls} value={theme.font} onChange={(e) => edit('theme', { font: e.target.value })}>
              {SITE_FONTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Arrondi des éléments">
            <Range value={theme.radius} min={0} max={1.5} step={0.05} onChange={(v) => edit('theme', { radius: v })} format={(v) => `${v.toFixed(2)} rem`} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Bouton principal</Button>
          <Button size="sm" variant="secondary">
            Secondaire
          </Button>
          <Button size="sm" variant="outline">
            Contour
          </Button>
          <Button size="sm" variant="ghost" onClick={() => reset('theme')}>
            <RotateCcw className="size-4" /> Thème par défaut
          </Button>
        </div>
      </Section>

      <Section title="Nom des modèles sur les jaquettes" hint="Police, couleurs, taille et position du nom affiché sur chaque jaquette (les polices installées sur l’appareil du visiteur uniquement).">
        <div className="grid grid-cols-3 gap-3">
          {SAMPLE_NAMES.map((n, i) => {
            const st = modelNameStyle(n, names)
            return (
              <div key={n} className="relative aspect-[2/3] overflow-hidden rounded-md" style={{ background: ['linear-gradient(160deg,#4c1d95,#0f172a)', 'linear-gradient(160deg,#9f1239,#1c1917)', 'linear-gradient(160deg,#065f46,#0c0a09)'][i] }}>
                {names.show && (
                  <span
                    className="line-clamp-3 leading-tight break-words"
                    style={{
                      ...nameBox(names).style,
                      fontFamily: st.fontFamily,
                      fontWeight: st.fontWeight,
                      fontStyle: st.fontStyle,
                      textTransform: st.textTransform,
                      letterSpacing: st.letterSpacing,
                      fontSize: st.fontSize,
                      color: st.color,
                      WebkitTextStroke: `1.5px ${st.stroke}`,
                      paintOrder: 'stroke fill',
                      textShadow: `0 2px 10px rgba(0,0,0,.85), 0 0 18px ${st.glow}`,
                    }}
                  >
                    {n}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={names.show} onChange={(e) => edit('names', { show: e.target.checked })} /> Afficher le nom du modèle sur les jaquettes
        </label>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Police">
            <select className={selectCls} value={names.font} onChange={(e) => edit('names', { font: e.target.value })}>
              <option value="auto">Différente pour chaque modèle</option>
              {NAME_FONTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Majuscules">
            <select className={selectCls} value={names.upper} onChange={(e) => edit('names', { upper: e.target.value as SiteSettings['names']['upper'] })}>
              <option value="auto">Selon la police</option>
              <option value="on">Toujours</option>
              <option value="off">Jamais</option>
            </select>
          </Field>
          <Field label="Taille">
            <Range value={names.size} min={0.6} max={1.8} step={0.05} onChange={(v) => edit('names', { size: v })} format={(v) => `${Math.round(v * 100)} %`} />
          </Field>
          <Field label="Halo lumineux">
            <label className="flex h-9 items-center gap-2">
              <input type="checkbox" checked={names.glow} onChange={(e) => edit('names', { glow: e.target.checked })} /> Activé
            </label>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr_1fr]">
          <Field label="Position du nom sur la jaquette">
            <div className="grid w-fit grid-cols-3 gap-1" role="group" aria-label="Positions prédéfinies">
              {[10, 50, 90].flatMap((y) =>
                [14, 50, 86].map((x) => (
                  <button
                    key={`${x}-${y}`}
                    type="button"
                    aria-label={`Nom à ${x} % / ${y} %`}
                    aria-pressed={names.x === x && names.y === y}
                    onClick={() => edit('names', { x, y })}
                    className={cn('size-8 rounded-md border hover:bg-accent', names.x === x && names.y === y && 'border-primary bg-primary/30')}
                  />
                )),
              )}
            </div>
          </Field>
          <Field label="Horizontale (gauche → droite)">
            <Range value={names.x} min={0} max={100} step={1} onChange={(v) => edit('names', { x: v })} format={(v) => `${v} %`} />
          </Field>
          <Field label="Verticale (haut → bas)">
            <Range value={names.y} min={0} max={100} step={1} onChange={(v) => edit('names', { y: v })} format={(v) => `${v} %`} />
          </Field>
        </div>

        <Field label="Couleurs">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['auto', 'Automatiques (une teinte par modèle)'],
                ['palette', 'Palette choisie'],
                ['fixed', 'Une seule couleur'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={names.colorMode === k}
                onClick={() => edit('names', { colorMode: k })}
                className={cn('rounded-md border px-3 py-1.5 text-sm hover:bg-accent', names.colorMode === k && 'border-primary bg-accent')}
              >
                {l}
              </button>
            ))}
          </div>
        </Field>

        {names.colorMode === 'palette' && (
          <div className="flex flex-wrap gap-2">
            {NAME_PALETTES.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={names.palette === p.key}
                onClick={() => edit('names', { palette: p.key })}
                className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent', names.palette === p.key && 'border-primary bg-accent')}
              >
                <span className="flex">
                  {p.colors.map((c) => (
                    <span key={c} className="-ml-1 size-4 rounded-full ring-1 ring-black/40 first:ml-0" style={{ background: c }} />
                  ))}
                </span>
                {p.label}
              </button>
            ))}
          </div>
        )}
        {names.colorMode === 'fixed' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Couleur du texte">
              <Color label="Couleur du texte" value={names.color} onChange={(v) => edit('names', { color: v })} />
            </Field>
            <Field label="Couleur du contour">
              <Color label="Couleur du contour" value={names.stroke} onChange={(v) => edit('names', { stroke: v })} />
            </Field>
          </div>
        )}
        <div>
          <Button size="sm" variant="ghost" onClick={() => reset('names')}>
            <RotateCcw className="size-4" /> Réglages par défaut
          </Button>
        </div>
      </Section>

      <Section title="Bannière d’accueil" hint="Le grand bloc des nouveautés en haut de l’accueil, et le fond vidéo des pages de titre.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={preview.bannerVideo} onChange={(e) => edit('preview', { bannerVideo: e.target.checked })} /> Vidéo en fond de la bannière
          </label>
          <Field label="Ajustement">
            <FitSelect value={preview.bannerFit} onChange={(v) => edit('preview', { bannerFit: v })} />
          </Field>
          <Field label="Cadrage">
            <PosSelect value={preview.bannerPos} onChange={(v) => edit('preview', { bannerPos: v })} />
          </Field>
          <Field label="Durée de l’extrait en boucle">
            <Range value={preview.bannerClip} min={10} max={90} step={5} onChange={(v) => edit('preview', { bannerClip: v })} format={(v) => `${v} s`} />
          </Field>
        </div>
        <Demo label="Bannière" width={320} ratio="21 / 9" fit={fitCss(preview.bannerFit)} pos={CSS_POS[preview.bannerPos]} />
      </Section>

      <Section title="Jaquette au repos" hint="Ce qu’on voit sans survoler : l’image de la vidéo, et la lecture silencieuse de quelques jaquettes.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Ajustement">
            <select className={selectCls} value={preview.cardFit} onChange={(e) => edit('preview', { cardFit: e.target.value as SiteSettings['preview']['cardFit'] })}>
              <option value="cover">Remplir la jaquette (rogne)</option>
              <option value="contain">Adapté (bandes noires)</option>
              <option value="stretch">Étirer</option>
            </select>
          </Field>
          <Field label="Cadrage">
            <PosSelect value={preview.restPos} onChange={(v) => edit('preview', { restPos: v })} />
          </Field>
          <Field label="Jaquettes qui jouent en silence au chargement">
            <Range value={preview.ambientMax} min={0} max={12} step={1} onChange={(v) => edit('preview', { ambientMax: v })} format={(v) => (v === 0 ? 'aucune' : String(v))} />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={preview.ambient} onChange={(e) => edit('preview', { ambient: e.target.checked })} /> Lecture silencieuse sans survol
          </label>
        </div>
        <Demo label="Jaquette au repos" width={120} ratio="2 / 3" fit={cardFitCss(preview.cardFit)} pos={CSS_POS[preview.restPos]} />
      </Section>

      <Section title="Jaquette survolée" hint="Ce qu’on voit en passant la souris : l’aperçu avec le son, dans la miniature.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Ajustement">
            <FitSelect value={preview.fit} onChange={(v) => edit('preview', { fit: v })} />
          </Field>
          <Field label="Cadrage">
            <PosSelect value={preview.hoverPos} onChange={(v) => edit('preview', { hoverPos: v })} />
          </Field>
          <Field label="Durée de l’extrait en boucle">
            <Range value={preview.clipSeconds} min={10} max={90} step={5} onChange={(v) => edit('preview', { clipSeconds: v })} format={(v) => `${v} s`} />
          </Field>
          <Field label="Volume">
            <Range value={preview.volume} min={0} max={1} step={0.05} onChange={(v) => edit('preview', { volume: v })} format={(v) => `${Math.round(v * 100)} %`} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={preview.pauseButton} onChange={(e) => edit('preview', { pauseButton: e.target.checked })} /> Bouton pause / reprise
          </label>
        </div>
        <Demo label="Jaquette survolée" width={120} ratio="2 / 3" fit={fitCss(preview.fit)} pos={CSS_POS[preview.hoverPos]} />
        <div>
          <Button size="sm" variant="ghost" onClick={() => reset('preview')}>
            <RotateCcw className="size-4" /> Réglages d’aperçu par défaut
          </Button>
        </div>
      </Section>

      <Section title="Lecteur vidéo" hint="Le lecteur qui s’ouvre au clic sur une jaquette : une fenêtre centrée sur la page floutée, au lieu de tout l’écran.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Affichage">
            <select className={selectCls} value={player.mode} onChange={(e) => edit('player', { mode: e.target.value as SiteSettings['player']['mode'] })}>
              <option value="window">Fenêtre sur la page (fond transparent)</option>
              <option value="full">Plein écran</option>
            </select>
          </Field>
          <Field label="Ajustement de la vidéo dans le lecteur">
            <select className={selectCls} value={player.fit} onChange={(e) => edit('player', { fit: e.target.value as SiteSettings['player']['fit'] })}>
              <option value="contain">Adapté (vidéo entière, bandes noires)</option>
              <option value="cover">Remplir (rogne les bords)</option>
              <option value="stretch">Étirer (déforme l’image)</option>
            </select>
          </Field>
          <Field label="Format de la fenêtre">
            <RatioField value={player.ratio} onChange={(v) => edit('player', { ratio: v })} />
          </Field>
          <Field label="Taille de la fenêtre">
            <Range value={player.size} min={40} max={100} step={1} onChange={(v) => edit('player', { size: v })} format={(v) => `${v} %`} />
          </Field>
          <Field label="Arrondi des coins">
            <Range value={player.radius} min={0} max={32} step={1} onChange={(v) => edit('player', { radius: v })} format={(v) => `${v} px`} />
          </Field>
          <Field label="Assombrissement du fond">
            <Range value={player.backdrop} min={0} max={95} step={1} onChange={(v) => edit('player', { backdrop: v })} format={(v) => `${v} %`} />
          </Field>
          <Field label="Flou du fond">
            <Range value={player.blur} min={0} max={40} step={1} onChange={(v) => edit('player', { blur: v })} format={(v) => `${v} px`} />
          </Field>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Simulation (page derrière la fenêtre)</p>
            <div className="relative h-44 w-80 overflow-hidden rounded-md ring-1 ring-white/20">
              <div className="absolute inset-0 grid grid-cols-6 gap-1 p-1">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="rounded-sm" style={{ background: `hsl(${(i * 47) % 360} 55% 40%)` }} />
                ))}
              </div>
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: `rgba(0,0,0,${player.backdrop / 100})`, backdropFilter: player.blur ? `blur(${player.blur / 4}px)` : undefined }}
              >
                <div
                  className="grid place-items-center bg-black text-[10px] text-neutral-300 shadow-xl ring-1 ring-white/10"
                  style={player.mode === 'full' ? { width: '100%', height: '100%' } : { width: `${player.size}%`, aspectRatio: ratioCss(player.ratio), maxHeight: `${player.size}%`, borderRadius: player.radius / 2 }}
                >
                  Lecteur
                </div>
              </div>
            </div>
          </div>
          <div>
            <Button size="sm" variant="ghost" onClick={() => reset('player')}>
              <RotateCcw className="size-4" /> Lecteur par défaut
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Design du lecteur" hint="Couleurs, boutons, barre de progression, sous-titres et comportement du lecteur vidéo. Choisis un style prêt à l’emploi puis ajuste chaque détail ; la simulation suit en direct.">
        <PlayerDesignPanel value={draft.playerUi} onChange={(patch) => edit('playerUi', patch)} />
      </Section>

      <Section title="Jaquettes de modèles" hint="L’image des cartes de la page Modèles et de la rangée « Modèles » de l’accueil.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Image">
            <select className={selectCls} value={models.image} onChange={(e) => edit('models', { image: e.target.value as SiteSettings['models']['image'] })}>
              <option value="auto">Photo du modèle, ou image capturée d’une de ses vidéos s’il n’en a pas</option>
              <option value="capture">Toujours l’image capturée d’une de ses vidéos</option>
              <option value="photo">Toujours la photo (jaquette colorée s’il n’en a pas)</option>
            </select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">L’image capturée est celle de la vidéo la plus récente du modèle, à son moment enregistré (admin → Jaquettes) : elle distingue les modèles entre eux.</p>
      </Section>

      <Section title="Icônes rondes en bas des jaquettes" hint="Deux boutons ronds dans la bande du bas de chaque jaquette : le premier mène à la page du modèle, le second à la page de la vidéo.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cards.icons} onChange={(e) => edit('cards', { icons: e.target.checked })} /> Afficher les deux icônes
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Emoji du bouton « page du modèle » (par défaut)">
            <div className="flex items-center gap-3">
              <EmojiPickerButton value={cards.modelEmoji} onChange={(v) => edit('cards', { modelEmoji: v })} label="Choisir l’emoji du modèle" />
              <span className="text-xs text-muted-foreground">Plus de 3 700 emojis, recherche en français. Un modèle peut avoir le sien (Admin → Modèles).</span>
            </div>
          </Field>
          <Field label="Emoji du bouton « page de la vidéo »">
            <div className="flex items-center gap-3">
              <EmojiPickerButton value={cards.videoEmoji} onChange={(v) => edit('cards', { videoEmoji: v })} label="Choisir l’emoji de la vidéo" />
            </div>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cards.emojiFromName} onChange={(e) => edit('cards', { emojiFromName: e.target.checked })} /> Reprendre l’emoji présent dans le nom du modèle ou dans le titre de la vidéo, s’il y en a un
        </label>
        <div className="grid gap-3 lg:grid-cols-3">
          <PositionPicker label="Icône « page du modèle »" value={cards.modelPos} onChange={(p) => edit('cards', { modelPos: p })} />
          <PositionPicker label="Icône « page de la vidéo »" value={cards.videoPos} onChange={(p) => edit('cards', { videoPos: p })} />
          <PositionPicker label="Durée de la vidéo" value={cards.durationPos} onChange={(p) => edit('cards', { durationPos: p })} />
        </div>
        <div className="flex items-end gap-3">
          <div className="relative w-36 overflow-hidden rounded-md bg-gradient-to-br from-fuchsia-900 to-slate-900 ring-1 ring-white/20" style={{ aspectRatio: ratioCss(cards.ratio) }}>
            {cards.icons && (
              <>
                <span className="z-[5] flex size-7 items-center justify-center rounded-full bg-black/75 text-base ring-1 ring-white/25" style={pin(cards.modelPos)}><EmojiView value={cards.modelEmoji} /></span>
                <span className="z-[5] flex size-7 items-center justify-center rounded-full bg-black/75 text-base ring-1 ring-white/25" style={pin(cards.videoPos)}><EmojiView value={cards.videoEmoji} /></span>
              </>
            )}
            {cards.duration.show && (
              <span className="z-[5]" style={{ ...durationCss(cards.duration), ...pin(cards.durationPos) }}>
                {cards.duration.format === 'clock' ? '1:23:45' : '1 h 23 min 45 s'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Simulation (les icônes restent toujours dans le cadre, à 8 px des bords)</p>
        </div>
      </Section>

      <Section title="Durée de la vidéo sur les jaquettes" hint="Durée réelle du fichier, lue dans la vidéo (à la seconde). Aucune estimation n’est affichée : tant que la durée n’est pas connue, rien ne s’affiche. La position se règle plus haut.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cards.duration.show} onChange={(e) => edit('cards', { duration: { ...cards.duration, show: e.target.checked } })} /> Afficher la durée
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Format">
            <select className={selectCls} value={cards.duration.format} onChange={(e) => edit('cards', { duration: { ...cards.duration, format: e.target.value as 'clock' | 'text' } })}>
              <option value="clock">1:23:45</option>
              <option value="text">1 h 23 min 45 s</option>
            </select>
          </Field>
          <Field label="Taille du texte">
            <Range value={cards.duration.size} min={8} max={28} step={1} onChange={(v) => edit('cards', { duration: { ...cards.duration, size: v } })} format={(v) => `${v} px`} />
          </Field>
          <Field label="Marge latérale">
            <Range value={cards.duration.padX} min={2} max={16} step={1} onChange={(v) => edit('cards', { duration: { ...cards.duration, padX: v } })} format={(v) => `${v} px`} />
          </Field>
          <Field label="Opacité du fond">
            <Range value={cards.duration.bgOpacity} min={0} max={100} step={5} onChange={(v) => edit('cards', { duration: { ...cards.duration, bgOpacity: v } })} format={(v) => `${v} %`} />
          </Field>
          <Field label="Arrondi du fond">
            <Range value={cards.duration.radius} min={0} max={16} step={1} onChange={(v) => edit('cards', { duration: { ...cards.duration, radius: v } })} format={(v) => `${v} px`} />
          </Field>
          <Field label="Couleurs (texte / fond)">
            <div className="flex items-center gap-3">
              <input type="color" value={cards.duration.color} onChange={(e) => edit('cards', { duration: { ...cards.duration, color: e.target.value } })} aria-label="Couleur du texte" className="h-9 w-12 rounded border bg-background" />
              <input type="color" value={cards.duration.bg} onChange={(e) => edit('cards', { duration: { ...cards.duration, bg: e.target.value } })} aria-label="Couleur du fond" className="h-9 w-12 rounded border bg-background" />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={cards.duration.bold} onChange={(e) => edit('cards', { duration: { ...cards.duration, bold: e.target.checked } })} /> Gras
              </label>
            </div>
          </Field>
        </div>
      </Section>

      <Section title="Formats et bannière d’accueil" hint="Format (ratio) des jaquettes, des cartes de modèles et de la bannière ; la bannière se règle avec un aperçu en temps réel.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Jaquettes de films">
            <RatioField value={cards.ratio} onChange={(v) => edit('cards', { ratio: v })} />
          </Field>
          <Field label="Cartes de modèles">
            <RatioField value={cards.modelRatio} onChange={(v) => edit('cards', { modelRatio: v })} />
          </Field>
          <Field label="Bannière d’accueil : format">
            <RatioField value={hero.ratio} onChange={(v) => edit('hero', { ratio: v })} allowAuto />
          </Field>
          <Field label="Bannière d’accueil : hauteur (format « auto »)">
            <Range value={hero.height} min={25} max={95} step={1} onChange={(v) => edit('hero', { height: v })} format={(v) => `${v} % de l’écran`} />
          </Field>
          <Field label="Bannière d’accueil : arrondi">
            <Range value={hero.radius} min={0} max={40} step={1} onChange={(v) => edit('hero', { radius: v })} format={(v) => `${v} px`} />
          </Field>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Aperçu en direct de la bannière (écran d’ordinateur 16:9 en miniature)</p>
            <div className="relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-md bg-neutral-950 ring-1 ring-white/20">
              <div className="flex h-5 items-center bg-neutral-900 px-2 text-[8px] text-neutral-400">STREAMFLEX</div>
              <div className="p-2">
                <div
                  className="relative w-full overflow-hidden bg-gradient-to-br from-violet-800 via-fuchsia-900 to-slate-900"
                  style={{ borderRadius: hero.radius / 3, ...(hero.ratio === 'auto' ? { height: `${hero.height * 0.9}%`, minHeight: 24, aspectRatio: undefined } : { aspectRatio: ratioCss(hero.ratio), maxHeight: '88%' }) }}
                >
                  <div className="absolute bottom-2 left-3 text-[9px] font-bold text-white">Titre de la bannière</div>
                  <div className="absolute bottom-2 left-3 mt-1 h-2 w-8 translate-y-3 rounded-full bg-white/80" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Jaquette de film</p>
              <div className="rounded-md bg-gradient-to-br from-sky-800 to-slate-900 ring-1 ring-white/20" style={{ width: 80, aspectRatio: ratioCss(cards.ratio) }} />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Carte de modèle</p>
              <div className="rounded-md bg-gradient-to-br from-rose-800 to-slate-900 ring-1 ring-white/20" style={{ width: 80, aspectRatio: ratioCss(cards.modelRatio) }} />
            </div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { reset('cards'); reset('hero') }}>
          <RotateCcw className="size-4" /> Formats par défaut
        </Button>
      </Section>
    </div>
  )
}
