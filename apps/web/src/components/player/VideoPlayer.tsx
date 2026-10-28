import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  BookmarkPlus,
  Bookmark as BookmarkIcon,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime, type Quality } from '@/lib/stream'
import { pickInitialTrack, setSubtitlePref, type SubtitleTrack } from '@/lib/subtitles'
import { AudioMenu, QualityMenu, SubtitlesMenu, type NativeAudio } from '@/components/player/PlayerMenus'
import { BookmarkDialog, BookmarkPanel } from '@/components/player/Bookmarks'
import { formatTimestamp, type NewBookmark, type VideoBookmark } from '@/lib/bookmarks'

export type VideoPlayerProps = {
  src: string
  poster?: string | null
  title: string
  subtitle?: string
  startAt?: number
  qualities?: Quality[]
  quality?: Quality
  nextLabel?: string
  onQualityChange?: (q: Quality, currentTime: number) => void
  /** Sous-titres disponibles + chargeur (renvoie une URL WebVTT, idéalement blob même origine) */
  subtitles?: SubtitleTrack[]
  loadSubtitle?: (id: string) => Promise<string>
  /** Langues audio disponibles (sources alternatives) et langues de la source courante */
  audios?: string[]
  audio?: string[]
  onAudioChange?: (lang: string, currentTime: number) => void
  onTimeUpdate?: (position: number, duration: number) => void
  onPause?: () => void
  onEnded?: () => void
  onNext?: () => void
  onBack?: () => void
  onError?: (currentTime: number) => void
  /** Marque-pages partagés (timestamps) */
  bookmarks?: VideoBookmark[]
  onCreateBookmark?: (b: NewBookmark) => Promise<void>
  onDeleteBookmark?: (id: string) => Promise<void>
}

const HIDE_DELAY_MS = 3000
const VOLUME_KEY = 'sf:volume'

function readVolume(): { volume: number; muted: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null') as { volume: number; muted: boolean } | null
    if (v && typeof v.volume === 'number') return v
  } catch {
    /* ignore */
  }
  return { volume: 1, muted: false }
}

export function VideoPlayer({
  src,
  poster,
  title,
  subtitle,
  startAt = 0,
  qualities = [],
  quality,
  nextLabel,
  onQualityChange,
  subtitles = [],
  loadSubtitle,
  audios = [],
  audio = [],
  onAudioChange,
  onTimeUpdate,
  onPause,
  onEnded,
  onNext,
  onBack,
  onError,
  bookmarks = [],
  onCreateBookmark,
  onDeleteBookmark,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const seekRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)

  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [{ volume, muted }, setVol] = useState(readVolume)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuOpenRef = useRef(false)
  // sous-titres
  const [activeSub, setActiveSub] = useState<string | null>(() => pickInitialTrack(subtitles, audio))
  const [subUrls, setSubUrls] = useState<Record<string, string>>({})
  const [subLoading, setSubLoading] = useState<string | null>(null)
  const [subFailed, setSubFailed] = useState<ReadonlySet<string>>(new Set())
  const lastSub = useRef<string | null>(activeSub ?? subtitles.find((t) => !t.is_forced)?.id ?? null)
  const trackEls = useRef(new Map<string, HTMLTrackElement>())
  // audio natif (HTMLMediaElement.audioTracks — Safari / flag Chrome)
  const [nativeAudio, setNativeAudio] = useState<NativeAudio[]>([])
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)
  // marque-pages
  const [markAt, setMarkAt] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const resumeAfterMark = useRef(false)
  const overlayRef = useRef(false)
  overlayRef.current = markAt !== null || panelOpen

  // ── Contrôles auto-masqués
  const showControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused && !menuOpenRef.current && !overlayRef.current) setControlsVisible(false)
    }, HIDE_DELAY_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  // ── Volume persistant
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = volume
    v.muted = muted
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }))
    } catch {
      /* ignore */
    }
  }, [volume, muted])

  // ── Actions
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play().catch(() => undefined)
      setFlash('play')
    } else {
      v.pause()
      setFlash('pause')
    }
    showControls()
  }, [showControls])

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    v.currentTime = Math.min(Math.max(0, t), v.duration - 0.5)
    setCurrent(v.currentTime)
  }, [])

  const skip = useCallback((delta: number) => {
    const v = videoRef.current
    if (v) seekTo(v.currentTime + delta)
    showControls()
  }, [seekTo, showControls])

  const toggleMute = useCallback(() => setVol((s) => ({ volume: s.volume || 1, muted: !s.muted })), [])

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen({ navigationUI: 'hide' })
    } catch {
      /* iOS Safari : fallback natif */
      const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
      v?.webkitEnterFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(() => setFlash(null), 500)
    return () => window.clearTimeout(id)
  }, [flash])

  // ── Sous-titres : chargement à la demande + bascule des modes de pistes
  const activeSubRef = useRef(activeSub)
  activeSubRef.current = activeSub

  const selectSub = useCallback(
    (id: string | null) => {
      setActiveSub(id)
      if (id) lastSub.current = id
      const t = subtitles.find((x) => x.id === id)
      setSubtitlePref(t ? t.language : null)
    },
    [subtitles],
  )

  useEffect(() => {
    if (!activeSub || subUrls[activeSub] || !loadSubtitle || subFailed.has(activeSub)) return
    let cancelled = false
    setSubLoading(activeSub)
    loadSubtitle(activeSub)
      .then((url) => !cancelled && setSubUrls((m) => ({ ...m, [activeSub]: url })))
      .catch(() => {
        if (cancelled) return
        setSubFailed((f) => new Set(f).add(activeSub))
        setActiveSub(null)
      })
      .finally(() => !cancelled && setSubLoading(null))
    return () => {
      cancelled = true
    }
  }, [activeSub, subUrls, loadSubtitle, subFailed])

  useEffect(() => {
    for (const [id, el] of trackEls.current) {
      el.track.mode = id === activeSub ? 'showing' : 'disabled'
    }
  }, [activeSub, subUrls])

  // ── Audio natif
  const readNativeAudio = useCallback(() => {
    const list = (videoRef.current as (HTMLVideoElement & { audioTracks?: ArrayLike<{ id: string; label: string; language: string; enabled: boolean }> }) | null)?.audioTracks
    if (!list) return
    setNativeAudio(Array.from(list, (t, i) => ({ id: t.id || String(i), label: t.label, language: t.language, enabled: t.enabled })))
  }, [])

  const selectNativeAudio = (id: string) => {
    const list = (videoRef.current as (HTMLVideoElement & { audioTracks?: ArrayLike<{ id: string; enabled: boolean }> }) | null)?.audioTracks
    if (!list) return
    Array.from(list).forEach((t, i) => (t.enabled = (t.id || String(i)) === id))
    readNativeAudio()
  }

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      menuOpenRef.current = open
      setMenuOpen(open)
      if (open) setControlsVisible(true)
      else showControls()
    },
    [showControls],
  )

  // ── Marque-pages
  const markMoment = useCallback(() => {
    const v = videoRef.current
    if (!v || !onCreateBookmark) return
    const at = v.currentTime // capturé AVANT la pause
    resumeAfterMark.current = !v.paused
    v.pause()
    setMarkAt(at)
    setControlsVisible(true)
  }, [onCreateBookmark])

  const closeMark = useCallback(() => {
    setMarkAt(null)
    if (resumeAfterMark.current) void videoRef.current?.play().catch(() => undefined)
    resumeAfterMark.current = false
  }, [])

  const createBookmark = useCallback(
    async (b: NewBookmark) => {
      await onCreateBookmark?.(b)
      setPanelOpen(true)
    },
    [onCreateBookmark],
  )

  const jumpTo = useCallback(
    (seconds: number) => {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Number.isFinite(v.duration) ? Math.min(seconds, Math.max(0, v.duration - 0.5)) : seconds
      setCurrent(v.currentTime)
      void v.play().catch(() => undefined)
      setFlash('play')
      showControls()
    },
    [showControls],
  )

  // ── Raccourcis clavier
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (markAt !== null) return // la modale gère ses touches
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
        case 'j':
          e.preventDefault()
          skip(-10)
          break
        case 'ArrowRight':
        case 'l':
          e.preventDefault()
          skip(10)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVol((s) => ({ volume: Math.min(1, s.volume + 0.1), muted: false }))
          showControls()
          break
        case 'ArrowDown':
          e.preventDefault()
          setVol((s) => ({ ...s, volume: Math.max(0, s.volume - 0.1) }))
          showControls()
          break
        case 'm':
          toggleMute()
          showControls()
          break
        case 'f':
          void toggleFullscreen()
          break
        case 'c':
          if (subtitles.length) selectSub(activeSubRef.current ? null : lastSub.current)
          showControls()
          break
        case 'b':
          e.preventDefault()
          markMoment()
          break
        case 'p':
          if (onCreateBookmark || bookmarks.length) setPanelOpen((o) => !o)
          showControls()
          break
        case 'Escape':
          if (panelOpen) setPanelOpen(false)
          else if (!document.fullscreenElement) onBack?.()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, skip, toggleMute, toggleFullscreen, showControls, onBack, subtitles.length, selectSub, markAt, markMoment, panelOpen, onCreateBookmark, bookmarks.length])

  // ── Barre de progression (pointer events)
  const timeFromPointer = (clientX: number) => {
    const r = seekRef.current?.getBoundingClientRect()
    if (!r || !duration) return { x: 0, time: 0 }
    const x = Math.min(Math.max(0, clientX - r.left), r.width)
    return { x, time: (x / r.width) * duration }
  }

  const onSeekDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrubbing(true)
    const { time } = timeFromPointer(e.clientX)
    setCurrent(time)
  }
  const onSeekMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = timeFromPointer(e.clientX)
    setHover(p)
    if (scrubbing) setCurrent(p.time)
  }
  const onSeekUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    setScrubbing(false)
    seekTo(timeFromPointer(e.clientX).time)
  }

  // ── Événements <video>
  const onLoadedMetadata = () => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration)
    if (startAt > 5 && startAt < v.duration - 10) v.currentTime = startAt
    readNativeAudio()
  }

  const onTimeUpdateInternal = () => {
    const v = videoRef.current
    if (!v) return
    if (!scrubbing) setCurrent(v.currentTime)
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
    onTimeUpdate?.(v.currentTime, v.duration)
  }

  const pct = (n: number) => (duration ? `${Math.min(100, (n / duration) * 100)}%` : '0%')
  const remaining = duration - current
  const showNext = !!onNext && duration > 0 && remaining < 30
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const visible = controlsVisible || !playing || menuOpen || panelOpen || markAt !== null
  const hasBookmarks = !!onCreateBookmark || bookmarks.length > 0

  return (
    <div
      ref={containerRef}
      className={cn('fixed inset-0 z-50 bg-black text-white select-none', !visible && 'cursor-none')}
      onPointerMove={showControls}
      onPointerDown={showControls}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        autoPlay
        playsInline
        preload="auto"
        className="absolute inset-0 size-full bg-black object-contain"
        onClick={togglePlay}
        onDoubleClick={() => void toggleFullscreen()}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
        onTimeUpdate={onTimeUpdateInternal}
        onProgress={onTimeUpdateInternal}
        onPlay={() => {
          setPlaying(true)
          showControls()
        }}
        onPause={() => {
          setPlaying(false)
          setControlsVisible(true)
          onPause?.()
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          setPlaying(false)
          onEnded?.()
        }}
        onError={() => {
          const v = videoRef.current
          const err = v?.error
          // MediaError : 1 abandon, 2 réseau, 3 décodage, 4 source non supportée (404, page HTML, format)
          console.error('[StreamFlex] erreur <video>', {
            src: v?.currentSrc || src,
            code: err?.code,
            message: err?.message,
            networkState: v?.networkState,
            readyState: v?.readyState,
          })
          onError?.(v?.currentTime ?? 0)
        }}
      >
        {subtitles.map((t) =>
          subUrls[t.id] ? (
            <track
              key={t.id}
              ref={(el) => {
                if (el) {
                  trackEls.current.set(t.id, el)
                  el.track.mode = t.id === activeSubRef.current ? 'showing' : 'disabled'
                } else trackEls.current.delete(t.id)
              }}
              kind="subtitles"
              src={subUrls[t.id]}
              srcLang={t.language}
              label={t.label}
            />
          ) : null,
        )}
      </video>

      {/* Spinner / flash */}
      {waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-16 animate-spin text-primary" />
        </div>
      )}
      {flash && !waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="animate-in fade-in zoom-in-75 rounded-full bg-black/50 p-5 duration-200">
            {flash === 'play' ? <Play className="size-12 fill-current" /> : <Pause className="size-12 fill-current" />}
          </span>
        </div>
      )}

      {/* Haut */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/80 to-transparent px-4 pt-4 pb-12 transition-opacity duration-300 md:px-8',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Retour" className="rounded-full p-2 hover:bg-white/10">
            <ArrowLeft className="size-7" />
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold md:text-xl">{title}</p>
          {subtitle && <p className="truncate text-sm text-neutral-300">{subtitle}</p>}
        </div>
      </div>

      {/* Épisode suivant */}
      {showNext && (
        <button
          type="button"
          onClick={onNext}
          className="absolute right-6 bottom-28 flex items-center gap-2 rounded-md bg-white px-5 py-3 font-semibold text-black shadow-lg transition hover:bg-white/85 md:right-10"
        >
          <SkipForward className="size-5 fill-current" /> {nextLabel ?? 'Épisode suivant'}
        </button>
      )}

      {/* Bas */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-16 pb-4 transition-opacity duration-300 md:px-8',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {/* Progression */}
        <div className="flex items-center gap-4">
          <div
            ref={seekRef}
            role="slider"
            aria-label="Progression"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(current)}
            aria-valuetext={formatTime(current)}
            tabIndex={0}
            className="group/seek relative flex h-5 flex-1 cursor-pointer touch-none items-center"
            onPointerDown={onSeekDown}
            onPointerMove={onSeekMove}
            onPointerUp={onSeekUp}
            onPointerLeave={() => setHover(null)}
          >
            <div className="relative h-1 w-full rounded-full bg-white/25 transition-[height] group-hover/seek:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: pct(buffered) }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: pct(current) }} />
              {duration > 0 &&
                bookmarks.map((b) => (
                  <span
                    key={b.id}
                    aria-hidden
                    title={`${formatTimestamp(b.timestamp_seconds)} — ${b.label}`}
                    className={cn(
                      'absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm',
                      b.is_mine ? 'bg-amber-400' : 'bg-white/80',
                    )}
                    style={{ left: pct(b.timestamp_seconds) }}
                  />
                ))}
            </div>
            <div
              className={cn(
                'absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-transform',
                scrubbing ? 'scale-125' : 'scale-0 group-hover/seek:scale-100',
              )}
              style={{ left: pct(current) }}
            />
            {hover && (
              <div
                className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded bg-black/90 px-2 py-0.5 text-xs tabular-nums"
                style={{ left: hover.x }}
              >
                {formatTime(hover.time)}
              </div>
            )}
          </div>
          <span className="w-16 text-right text-sm tabular-nums text-neutral-200">-{formatTime(remaining)}</span>
        </div>

        {/* Boutons */}
        <div className="mt-2 flex items-center gap-1 md:gap-3">
          <IconButton label={playing ? 'Pause' : 'Lecture'} onClick={togglePlay}>
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </IconButton>
          <IconButton label="Reculer de 10 s" onClick={() => skip(-10)}>
            <RotateCcw />
          </IconButton>
          <IconButton label="Avancer de 10 s" onClick={() => skip(10)}>
            <RotateCw />
          </IconButton>

          <div className="group/vol flex items-center">
            <IconButton label={muted ? 'Activer le son' : 'Couper le son'} onClick={toggleMute}>
              <VolumeIcon />
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => setVol({ volume: Number(e.target.value), muted: Number(e.target.value) === 0 })}
              className="h-1 w-0 cursor-pointer accent-white opacity-0 transition-all duration-200 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:w-24 focus:opacity-100"
            />
          </div>

          <span className="ml-2 hidden text-sm tabular-nums text-neutral-300 sm:inline">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1 md:gap-3">
            {onCreateBookmark && (
              <IconButton label="Marquer ce moment (B)" onClick={markMoment}>
                <BookmarkPlus />
              </IconButton>
            )}
            {hasBookmarks && (
              <IconButton label={`Marque-pages (${bookmarks.length})`} onClick={() => setPanelOpen((o) => !o)} active={panelOpen}>
                <span className="relative">
                  <BookmarkIcon className={cn(panelOpen && 'fill-current')} />
                  {bookmarks.length > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-bold">
                      {bookmarks.length > 99 ? '99+' : bookmarks.length}
                    </span>
                  )}
                </span>
              </IconButton>
            )}
            {onNext && (
              <IconButton label={nextLabel ?? 'Épisode suivant'} onClick={onNext}>
                <SkipForward />
              </IconButton>
            )}
            <SubtitlesMenu
              tracks={subtitles}
              active={activeSub}
              loadingId={subLoading}
              failed={subFailed}
              onSelect={selectSub}
              container={containerRef.current}
              onOpenChange={onMenuOpenChange}
            />
            <AudioMenu
              native={nativeAudio}
              onNative={selectNativeAudio}
              languages={audios}
              current={audio}
              onLanguage={onAudioChange ? (l) => onAudioChange(l, videoRef.current?.currentTime ?? 0) : undefined}
              container={containerRef.current}
              onOpenChange={onMenuOpenChange}
            />
            {onQualityChange && (
              <QualityMenu
                qualities={qualities}
                quality={quality}
                onSelect={(q) => onQualityChange(q, videoRef.current?.currentTime ?? 0)}
                container={containerRef.current}
                onOpenChange={onMenuOpenChange}
              />
            )}
            <IconButton label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'} onClick={() => void toggleFullscreen()}>
              {fullscreen ? <Minimize /> : <Maximize />}
            </IconButton>
          </div>
        </div>
      </div>

      {hasBookmarks && (
        <BookmarkPanel
          open={panelOpen}
          bookmarks={bookmarks}
          current={current}
          onJump={jumpTo}
          onDelete={onDeleteBookmark}
          onClose={() => setPanelOpen(false)}
        />
      )}
      {onCreateBookmark && <BookmarkDialog at={markAt} container={containerRef.current} onSubmit={createBookmark} onClose={closeMark} />}
    </div>
  )
}

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className="rounded-full p-2 transition hover:scale-110 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none [&_svg]:size-6 md:[&_svg]:size-7"
    >
      {children}
    </button>
  )
}
