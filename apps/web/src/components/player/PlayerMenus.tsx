import type { ReactNode } from 'react'
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
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          'rounded-full p-2 transition hover:scale-110 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none data-[state=open]:bg-white/15 [&_svg]:size-6 md:[&_svg]:size-7',
          active && 'text-primary',
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

// ───────── Qualité
export function QualityMenu({
  qualities,
  quality,
  onSelect,
  ...c
}: Common & { qualities: Quality[]; quality?: Quality; onSelect: (q: Quality) => void }) {
  if (qualities.length < 2) return null
  return (
    <DropdownMenu modal={false} onOpenChange={c.onOpenChange}>
      <Trigger label="Qualité">
        <Settings />
      </Trigger>
      <DropdownMenuContent side="top" align="end" container={c.container} className={CONTENT}>
        <DropdownMenuLabel>Qualité</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuRadioGroup value={quality ?? ''} onValueChange={(v) => v !== quality && onSelect(v as Quality)}>
          {qualities.map((q) => (
            <DropdownMenuRadioItem key={q} value={q} className={ITEM}>
              {q}
              {q === '2160p' && <span className="ml-auto text-xs text-neutral-400">4K</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
