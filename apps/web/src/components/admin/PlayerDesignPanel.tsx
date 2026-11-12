import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  AudioLines,
  Captions,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SITE_FONTS } from '@/lib/site-settings'
import { buttonClass, controlsBar, DEFAULT_PLAYER_UI, PLAYER_PRESETS, playerVars, PlayerSpinner, type PlayerButtons, type PlayerUi } from '@/lib/player-ui'

const selectCls = 'h-9 rounded-md border bg-background px-2 text-sm'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Range({ value, min, max, step = 1, onChange, unit = '' }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
      <span className="w-14 text-right text-xs tabular-nums">
        {value}
        {unit}
      </span>
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

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  )
}

const BUTTON_LABELS: Record<keyof PlayerButtons, string> = {
  skip: 'Reculer / avancer',
  volume: 'Volume',
  time: 'Temps écoulé / durée',
  settings: 'Réglages (qualité, vitesse, cadrage)',
  bookmarks: 'Marque-pages',
  subtitles: 'Sous-titres',
  audio: 'Langue audio',
  fullscreen: 'Plein écran',
  arrows: 'Flèches précédent / suivant sur les côtés',
}

// Image de démonstration (scène) derrière la simulation
const SCENE = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#1e1b4b'/><stop offset='.6' stop-color='#9d174d'/><stop offset='1' stop-color='#f59e0b'/></linearGradient></defs><rect width='640' height='360' fill='url(#s)'/><circle cx='470' cy='210' r='70' fill='#fde68a' opacity='.85'/><path d='M0 290 L120 220 L230 280 L360 200 L500 270 L640 230 L640 360 L0 360Z' fill='#111827'/></svg>",
)}`

type MockState = 'playing' | 'paused' | 'loading'

/** Simulation du lecteur avec les réglages en cours (mêmes fonctions de style que le vrai lecteur) */
function PlayerMock({ ui, state }: { ui: PlayerUi; state: MockState }) {
  const font = ui.font === 'site' ? null : (SITE_FONTS.find((f) => f.key === ui.font)?.family ?? null)
  const top = controlsBar(ui, 'top')
  const bottom = controlsBar(ui, 'bottom')
  const btn = buttonClass(ui)
  const B = ui.buttons
  const r = ui.barRound ? 9999 : 0
  const s = ui.subs
  const n = parseInt(s.bg.slice(1), 16)
  const time = ui.time === 'remaining' ? '-14:12' : ui.time === 'elapsed' ? '9:48' : '9:48 / 24:00'
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black ring-1 ring-white/15 select-none" style={playerVars(ui, font)}>
      <img src={SCENE} alt="" className="absolute inset-0 size-full object-cover" />
      {/* sous-titre */}
      <div className="absolute inset-x-0 bottom-[30%] flex justify-center px-6">
        <span
          className="rounded px-1.5 text-center leading-snug"
          style={{
            fontSize: `${(s.size / 100) * 0.95}rem`,
            color: s.color,
            background: `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${s.bgOpacity / 100})`,
            fontWeight: s.bold ? 700 : 400,
            textShadow: s.shadow ? '0 0 4px #000, 0 2px 3px #000' : undefined,
          }}
        >
          Exemple de sous-titre affiché ici
        </span>
      </div>
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PlayerSpinner kind={ui.spinner} size={52} />
        </div>
      )}
      {state === 'paused' && ui.bigPlay && (
        <div className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--pl-accent)] text-white shadow-2xl">
          <Play className="ml-0.5 size-7 fill-current" />
        </div>
      )}
      {state === 'paused' && !ui.bigPlay && ui.flash && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3">
          <Pause className="size-8 fill-current" />
        </div>
      )}
      {B.arrows && (
        <>
          <span className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/55 p-1.5">
            <ChevronLeft className="size-5" />
          </span>
          <span className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/55 p-1.5">
            <ChevronRight className="size-5" />
          </span>
        </>
      )}
      <div className={cn('absolute inset-x-0 top-0 flex items-center gap-2 px-3', top.className)} style={top.style}>
        <span className={btn}>
          <ArrowLeft />
        </span>
        {ui.showTitle && (
          <span className="truncate font-semibold" style={{ fontSize: ui.titleSize * 0.7 }}>
            Titre de la vidéo
          </span>
        )}
      </div>
      <div className={cn('absolute inset-x-0 bottom-0 px-3', bottom.className)} style={bottom.style}>
        <div className="flex items-center gap-3">
          <div className="relative flex h-4 flex-1 items-center">
            <div className="relative w-full" style={{ height: ui.barHeight, borderRadius: r, background: `rgba(255,255,255,${ui.trackOpacity / 100})` }}>
              <div className="absolute inset-y-0 left-0" style={{ width: '62%', borderRadius: r, background: `rgba(255,255,255,${ui.bufferedOpacity / 100})` }} />
              <div className="absolute inset-y-0 left-0 bg-[var(--pl-accent)]" style={{ width: '41%', borderRadius: r }} />
            </div>
            {ui.thumb !== 'hidden' && (
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--pl-accent)] shadow" style={{ left: '41%', width: ui.thumbSize, height: ui.thumbSize, opacity: ui.thumb === 'always' ? 1 : 0.55 }} />
            )}
          </div>
          <span className="text-xs tabular-nums opacity-90">{time}</span>
        </div>
        <div className="mt-1 flex items-center gap-0.5 [&_svg]:!size-[calc(var(--pl-icon)*0.75)]">
          <span className={btn}>{state === 'playing' ? <Pause className="fill-current" /> : <Play className="fill-current" />}</span>
          {B.skip && (
            <>
              <span className={btn}>
                <RotateCcw />
              </span>
              <span className={btn}>
                <RotateCw />
              </span>
            </>
          )}
          {B.volume && (
            <span className={btn}>
              <Volume2 />
            </span>
          )}
          {B.time && <span className="ml-1 hidden text-xs tabular-nums opacity-80 sm:inline">9:48 / 24:00</span>}
          <span className="ml-auto flex items-center gap-0.5">
            {B.settings && (
              <span className={btn}>
                <Settings />
              </span>
            )}
            {B.bookmarks && (
              <>
                <span className={btn}>
                  <BookmarkPlus />
                </span>
                <span className={btn}>
                  <Bookmark />
                </span>
              </>
            )}
            {B.subtitles && (
              <span className={cn(btn, 'text-[var(--pl-accent)]')}>
                <Captions />
              </span>
            )}
            {B.audio && (
              <span className={btn}>
                <AudioLines />
              </span>
            )}
            {B.fullscreen && (
              <span className={btn}>
                <Maximize />
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Admin → Apparence : design complet du lecteur, avec simulation en direct */
export function PlayerDesignPanel({ value: ui, onChange }: { value: PlayerUi; onChange: (patch: Partial<PlayerUi>) => void }) {
  const [state, setState] = useState<MockState>('paused')
  const set = (patch: Partial<PlayerUi>) => onChange({ ...patch, preset: 'custom' })
  const setBtn = (k: keyof PlayerButtons, v: boolean) => set({ buttons: { ...ui.buttons, [k]: v } })
  const setSubs = (patch: Partial<PlayerUi['subs']>) => set({ subs: { ...ui.subs, ...patch } })

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="flex flex-col gap-4">
        <Group title="Style prêt à l’emploi">
          <div className="flex flex-wrap gap-2">
            {PLAYER_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={ui.preset === p.key}
                onClick={() => onChange({ ...DEFAULT_PLAYER_UI, ...p.patch, preset: p.key })}
                className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent', ui.preset === p.key && 'border-primary bg-accent')}
              >
                <span className="size-4 rounded-full ring-1 ring-white/30" style={{ background: p.swatch }} />
                {p.label}
              </button>
            ))}
            {ui.preset === 'custom' && <span className="self-center text-xs text-muted-foreground">Personnalisé</span>}
          </div>
        </Group>

        <Group title="Couleurs et texte">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Couleur d’accent (progression, curseur, chargement)">
              <div className="flex items-center gap-2">
                <Color label="Couleur d’accent" value={ui.accent ?? '#e5322d'} onChange={(v) => set({ accent: v })} />
                {ui.accent && (
                  <Button size="sm" variant="ghost" onClick={() => set({ accent: null })}>
                    Celle du site
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Couleur des icônes et textes">
              <Color label="Couleur des icônes" value={ui.iconColor} onChange={(v) => set({ iconColor: v })} />
            </Field>
            <Field label="Police du lecteur">
              <select className={selectCls} value={ui.font} onChange={(e) => set({ font: e.target.value })}>
                <option value="site">Celle du site</option>
                {SITE_FONTS.filter((f) => f.family).map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Taille du titre">
              <Range value={ui.titleSize} min={12} max={36} onChange={(v) => set({ titleSize: v })} unit=" px" />
            </Field>
            <div className="flex items-end">
              <Check checked={ui.showTitle} onChange={(v) => set({ showTitle: v })}>
                Afficher le titre en haut
              </Check>
            </div>
          </div>
        </Group>

        <Group title="Barres de commandes">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Fond des barres">
              <select className={selectCls} value={ui.controlsBg} onChange={(e) => set({ controlsBg: e.target.value as PlayerUi['controlsBg'] })}>
                <option value="gradient">Dégradé</option>
                <option value="solid">Bandeau plein</option>
                <option value="glass">Verre dépoli (flou)</option>
                <option value="none">Aucun (transparent)</option>
              </select>
            </Field>
            <Field label="Opacité du fond">
              <Range value={ui.controlsOpacity} min={0} max={100} onChange={(v) => set({ controlsOpacity: v })} unit=" %" />
            </Field>
            <Field label="Masquage automatique après">
              <Range value={ui.hideDelay} min={1} max={10} step={0.5} onChange={(v) => set({ hideDelay: v })} unit=" s" />
            </Field>
          </div>
        </Group>

        <Group title="Boutons">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Style des boutons">
              <select className={selectCls} value={ui.buttonStyle} onChange={(e) => set({ buttonStyle: e.target.value as PlayerUi['buttonStyle'] })}>
                <option value="plain">Icônes seules</option>
                <option value="circle">Pastilles rondes sombres</option>
                <option value="glass">Pastilles en verre</option>
              </select>
            </Field>
            <Field label="Taille des icônes">
              <Range value={ui.iconSize} min={16} max={44} onChange={(v) => set({ iconSize: v })} unit=" px" />
            </Field>
            <Field label="Saut des boutons et des flèches du clavier">
              <select className={selectCls} value={ui.seekStep} onChange={(e) => set({ seekStep: Number(e.target.value) })}>
                {[5, 10, 15, 30, 60].map((v) => (
                  <option key={v} value={v}>
                    {v} secondes
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(BUTTON_LABELS) as (keyof PlayerButtons)[]).map((k) => (
              <Check key={k} checked={ui.buttons[k]} onChange={(v) => setBtn(k, v)}>
                {BUTTON_LABELS[k]}
              </Check>
            ))}
          </div>
        </Group>

        <Group title="Barre de progression">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Épaisseur">
              <Range value={ui.barHeight} min={2} max={12} onChange={(v) => set({ barHeight: v })} unit=" px" />
            </Field>
            <Field label="Curseur">
              <select className={selectCls} value={ui.thumb} onChange={(e) => set({ thumb: e.target.value as PlayerUi['thumb'] })}>
                <option value="hover">Visible au survol</option>
                <option value="always">Toujours visible</option>
                <option value="hidden">Masqué</option>
              </select>
            </Field>
            <Field label="Taille du curseur">
              <Range value={ui.thumbSize} min={8} max={26} onChange={(v) => set({ thumbSize: v })} unit=" px" />
            </Field>
            <Field label="Opacité du fond de la barre">
              <Range value={ui.trackOpacity} min={5} max={80} onChange={(v) => set({ trackOpacity: v })} unit=" %" />
            </Field>
            <Field label="Opacité de la partie chargée">
              <Range value={ui.bufferedOpacity} min={0} max={90} onChange={(v) => set({ bufferedOpacity: v })} unit=" %" />
            </Field>
            <Field label="Temps affiché au bout de la barre">
              <select className={selectCls} value={ui.time} onChange={(e) => set({ time: e.target.value as PlayerUi['time'] })}>
                <option value="remaining">Temps restant (-14:12)</option>
                <option value="elapsed">Temps écoulé (9:48)</option>
                <option value="both">Écoulé / durée (9:48 / 24:00)</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Check checked={ui.barRound} onChange={(v) => set({ barRound: v })}>
                Bords arrondis
              </Check>
            </div>
          </div>
        </Group>

        <Group title="Sous-titres">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Taille">
              <Range value={ui.subs.size} min={50} max={250} step={5} onChange={(v) => setSubs({ size: v })} unit=" %" />
            </Field>
            <Field label="Couleur du texte">
              <Color label="Couleur des sous-titres" value={ui.subs.color} onChange={(v) => setSubs({ color: v })} />
            </Field>
            <Field label="Couleur du fond">
              <Color label="Fond des sous-titres" value={ui.subs.bg} onChange={(v) => setSubs({ bg: v })} />
            </Field>
            <Field label="Opacité du fond">
              <Range value={ui.subs.bgOpacity} min={0} max={100} onChange={(v) => setSubs({ bgOpacity: v })} unit=" %" />
            </Field>
            <div className="flex flex-col justify-end gap-2">
              <Check checked={ui.subs.shadow} onChange={(v) => setSubs({ shadow: v })}>
                Ombre autour du texte
              </Check>
              <Check checked={ui.subs.bold} onChange={(v) => setSubs({ bold: v })}>
                Texte en gras
              </Check>
            </div>
          </div>
        </Group>

        <Group title="Animations et comportement">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Indicateur de chargement">
              <select className={selectCls} value={ui.spinner} onChange={(e) => set({ spinner: e.target.value as PlayerUi['spinner'] })}>
                <option value="ring">Anneau</option>
                <option value="dots">Points rebondissants</option>
                <option value="bars">Barres</option>
              </select>
            </Field>
            <Field label="Double clic sur la vidéo">
              <select className={selectCls} value={ui.doubleClick} onChange={(e) => set({ doubleClick: e.target.value as PlayerUi['doubleClick'] })}>
                <option value="fullscreen">Plein écran</option>
                <option value="seek">Côtés : reculer / avancer · centre : plein écran</option>
              </select>
            </Field>
            <div className="flex flex-col justify-end gap-2">
              <Check checked={ui.bigPlay} onChange={(v) => set({ bigPlay: v })}>
                Grand bouton lecture au centre en pause
              </Check>
              <Check checked={ui.flash} onChange={(v) => set({ flash: v })}>
                Animation lecture / pause au centre
              </Check>
            </div>
          </div>
        </Group>

        <div>
          <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_PLAYER_UI)}>
            <RotateCcw className="size-4" /> Design du lecteur par défaut
          </Button>
        </div>
      </div>

      <div className="xl:sticky xl:top-36 xl:self-start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Simulation en direct</p>
          <div className="flex gap-1" role="group" aria-label="État simulé">
            {(['playing', 'paused', 'loading'] as const).map((k) => (
              <Button key={k} size="sm" variant={state === k ? 'secondary' : 'ghost'} onClick={() => setState(k)} aria-pressed={state === k}>
                {k === 'playing' ? 'Lecture' : k === 'paused' ? 'Pause' : 'Chargement'}
              </Button>
            ))}
          </div>
        </div>
        <PlayerMock ui={ui} state={state} />
        <p className="mt-2 text-xs text-muted-foreground">Ouvre une vidéo dans un autre onglet pour voir le vrai lecteur : les changements s’y appliquent dès l’enregistrement.</p>
      </div>
    </div>
  )
}
