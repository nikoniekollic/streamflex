import { useContext, type ReactNode } from 'react'
import { PlayerButtonCls } from '@/lib/player-ui'
import { AudioLines, Captions, CaptionsOff, Loader2, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { languageName, type SubtitleTrack } from '@/lib/subtitles'
import type { Quality } from '@/lib/stream'

const CONTENT = 'min-w-48 border-white/10 bg-black/95 text-white'
const ITEM = 'focus:bg-white/10 focus:text-white'

type Common = { container: HTMLElement | null; onOpenChange: (open: boolean) => void }

function Trigger({ label, active, children }: { label: string; active?: boolean; children: ReactNode }) {
  const cls = useContext(PlayerButtonCls) // style des boutons choisi dans l'admin (Design du lecteur)
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          cls || 'rounded-full p-2 transition hover:scale-110 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-6 md:[&_svg]:size-7',
          'data-[state=open]:bg-white/15',
          active && 'text-[var(--pl-accent,var(--primary))]',
        )}
      >
        {children}
      </button>
    </DropdownMenuTrigger>
  )
}

// ───────── Sous-titres
export function SubtitlesMenu({
  tracks,
  active,
  loadingId,
  failed,
  onSelect,
  ...c
}: Common & {
  tracks: SubtitleTrack[]
  active: string | null
  loadingId: string | null
  failed: ReadonlySet<string>
  onSelect: (id: string | null) => void
}) {
  if (tracks.length === 0) return null
  return (
    <DropdownMenu modal={false} onOpenChange={c.onOpenChange}>
      <Trigger label="Sous-titres (C)" active={!!active}>
        {active ? <Captions /> : <CaptionsOff />}
      </Trigger>
      <DropdownMenuContent side="top" align="end" container={c.container} className={CONTENT}>
        <DropdownMenuLabel>Sous-titres</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuRadioGroup value={active ?? 'off'} onValueChange={(v) => onSelect(v === 'off' ? null : v)}>
          <DropdownMenuRadioItem value="off" className={ITEM}>
            Désactivés
          </DropdownMenuRadioItem>
          {tracks.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} disabled={failed.has(t.id)} className={ITEM}>
              <span className="flex-1">
                {t.label}
                {t.is_forced && <span className="ml-1 text-xs text-neutral-400">(forcés)</span>}
              </span>
              <span className="text-xs text-neutral-400">{failed.has(t.id) ? 'indisponible' : languageName(t.language)}</span>
              {loadingId === t.id && <Loader2 className="size-3.5 animate-spin" />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ───────── Audio : pistes natives (audioTracks, Safari) sinon sources alternatives par langue
export type NativeAudio = { id: string; label: string; language: string; enabled: boolean }

export function AudioMenu({
  native,
  onNative,
  languages,
  current,
  onLanguage,
  ...c
}: Common & {
  native: NativeAudio[]
  onNative: (id: string) => void
  languages: string[]
  current: string[]
  onLanguage?: (lang: string) => void
}) {
  const useNative = native.length > 1
  if (!useNative && (languages.length < 2 || !onLanguage)) return null
  const value = useNative ? (native.find((a) => a.enabled)?.id ?? '') : (languages.find((l) => current.includes(l)) ?? '')

  return (
    <DropdownMenu modal={false} onOpenChange={c.onOpenChange}>
      <Trigger label="Langue audio">
        <AudioLines />
      </Trigger>
      <DropdownMenuContent side="top" align="end" container={c.container} className={CONTENT}>
        <DropdownMenuLabel>Audio</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => (useNative ? onNative(v) : onLanguage?.(v))}>
          {useNative
            ? native.map((a) => (
                <DropdownMenuRadioItem key={a.id} value={a.id} className={ITEM}>
                  {a.label || (a.language ? languageName(a.language) : `Piste ${a.id}`)}
                </DropdownMenuRadioItem>
              ))
            : languages.map((l) => (
                <DropdownMenuRadioItem key={l} value={l} className={ITEM}>
                  {languageName(l)}
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ───────── Roue crantée : qualité, vitesse, ajustement de l'image
export type FitMode = 'contain' | 'cover' | 'stretch'
const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '2']

export function SettingsMenu({
  qualities,
  quality,
  onQuality,
  speed,
  onSpeed,
  fit,
  onFit,
  ...c
}: Common & {
  qualities: Quality[]
  quality?: Quality
  onQuality?: (q: Quality) => void
  speed: number
  onSpeed: (v: number) => void
  fit: FitMode
  onFit: (f: FitMode) => void
}) {
  const several = qualities.length > 1
  return (
    <DropdownMenu modal={false} onOpenChange={c.onOpenChange}>
      <Trigger label="Paramètres (qualité, vitesse, image)">
        <Settings />
      </Trigger>
      <DropdownMenuContent side="top" align="end" container={c.container} className={cn(CONTENT, 'max-h-[70vh] overflow-y-auto')}>
        <DropdownMenuLabel>Qualité</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={quality ?? ''} onValueChange={(v) => v !== quality && onQuality?.(v as Quality)}>
          {(qualities.length ? qualities : quality ? [quality] : []).map((q) => (
            <DropdownMenuRadioItem key={q} value={q} disabled={!several} className={ITEM}>
              {q}
              {q === '2160p' && <span className="ml-1 text-xs text-neutral-400">4K</span>}
              {q === qualities[0] && <span className="ml-auto text-xs text-neutral-400">la plus haute</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <p className="px-2 pb-1 text-xs text-neutral-400">{several ? 'La plus haute qualité est choisie par défaut.' : 'Une seule qualité disponible : la plus haute.'}</p>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuLabel>Vitesse</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(speed)} onValueChange={(v) => onSpeed(Number(v))}>
          {SPEEDS.map((v) => (
            <DropdownMenuRadioItem key={v} value={v} className={ITEM}>
              {v === '1' ? 'Normale' : `${v}×`}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuLabel>Image</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={fit} onValueChange={(v) => onFit(v as FitMode)}>
          <DropdownMenuRadioItem value="contain" className={ITEM}>
            Adaptée (bandes noires)
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="cover" className={ITEM}>
            Remplir (rogne)
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="stretch" className={ITEM}>
            Étirer
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
