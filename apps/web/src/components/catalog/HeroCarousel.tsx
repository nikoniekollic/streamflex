import { openPlayer } from '@/lib/player-overlay'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Info, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FavoriteButton } from '@/components/catalog/FavoriteButton'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { supabase } from '@/lib/supabase'
import { getPreviewUrl, peekPreviewUrl, type Wanted } from '@/lib/preview'
import { CSS_POS, ratioCss, useSiteSettings } from '@/lib/site-settings'
import { CSS_FIT, hoverFit } from '@/components/catalog/HoverPreview'
import { coverStyle } from '@/lib/cover'
import { stripModelMark, isModelCover } from '@/lib/cover'
import type { CatalogTitle } from '@/lib/catalog'

const SLIDE_MS = 8000
const FRESH_DAYS = 14

const isFresh = (t: CatalogTitle) => !!t.published_at && Date.now() - new Date(t.published_at).getTime() < FRESH_DAYS * 86_400_000
const imageOf = (t: CatalogTitle) => {
  const src = t.backdrop_url ?? t.poster_url
  return src ? (isModelCover(src) ? stripModelMark(src) : src) : null
}

/** Extrait vidéo muet derrière la slide active (écrans larges, mouvement autorisé) — via le même circuit espacé que l'aperçu au survol. */
function SlideVideo({ titleId, active, paused }: { titleId: string; active: boolean; paused: boolean }) {
  const { activeProfile } = useActiveProfile()
  const { preview: cfg } = useSiteSettings()
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)
  const start = useRef(0)
  const profileId = activeProfile?.id

  useEffect(() => {
    const ok = cfg.bannerVideo && window.matchMedia('(min-width: 768px)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || !profileId || !ok) {
      setSrc(null)
      setPlaying(false)
      return
    }
    const wanted: Wanted = { cancelled: false }
    const cached = peekPreviewUrl(titleId)
    if (cached) setSrc(cached)
    const t = cached
      ? undefined
      : setTimeout(() => {
          void getPreviewUrl(supabase, profileId, titleId, wanted).then((url) => {
            if (!wanted.cancelled && url) setSrc(url)
          })
        }, 200)
    return () => {
      wanted.cancelled = true
      clearTimeout(t)
      setSrc(null)
      setPlaying(false)
    }
  }, [active, profileId, titleId, cfg.bannerVideo])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (paused) v.pause()
    else if (v.readyState >= 3) void v.play().catch(() => undefined)
  }, [paused, src])

  if (!src) return null
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        const d = v.duration
        if (Number.isFinite(d) && d > cfg.bannerClip * 2) {
          start.current = Math.min(d * (0.1 + Math.random() * 0.6), d - cfg.bannerClip - 1)
          v.currentTime = start.current
        }
      }}
      onTimeUpdate={(e) => {
        const v = e.currentTarget
        if (v.currentTime >= start.current + cfg.bannerClip) v.currentTime = start.current
      }}
      onEnded={(e) => {
        e.currentTarget.currentTime = start.current
        void e.currentTarget.play().catch(() => undefined)
      }}
      onCanPlay={(e) => void e.currentTarget.play().catch(() => undefined)}
      onPlaying={() => setPlaying(true)}
      onError={() => setSrc(null)}
      style={{ objectFit: CSS_FIT[hoverFit(cfg.bannerFit)], objectPosition: CSS_POS[cfg.bannerPos] }}
      className={cn('absolute inset-0 size-full transition-opacity duration-700', playing ? 'opacity-100' : 'opacity-0')}
    />
  )
}

/** Bloc des nouveautés : slides en fondu, défilement automatique, points de progression, pause / lecture. */
export function HeroCarousel({ titles }: { titles: CatalogTitle[] }) {
  const { hero } = useSiteSettings()
  const [index, setIndex] = useState(0)
  const [userPaused, setUserPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const paused = userPaused || hovered || reduced
  const touchX = useRef<number | null>(null)
  const count = titles.length

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count])
  const next = useCallback(() => go(index + 1), [go, index])

  // Onglet masqué : on met le défilement en pause
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const running = !paused && !hidden && count > 1

  if (count === 0) return null
  return (
    <section
      aria-roledescription="carrousel"
      aria-label="Nouveautés"
      className="group/hero relative mx-4 mt-4 min-h-[260px] overflow-hidden bg-neutral-900 shadow-2xl shadow-black/60 md:mx-10"
      style={{ borderRadius: hero.radius, ...(hero.ratio === 'auto' ? { height: `${hero.height}vh`, maxHeight: 760 } : { aspectRatio: ratioCss(hero.ratio), maxHeight: '92vh' }) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(index - 1)
        if (e.key === 'ArrowRight') go(index + 1)
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1))
      }}
    >
      {titles.map((t, i) => {
        const active = i === index
        const img = imageOf(t)
        const s = coverStyle(t.id)
        return (
          <div
            key={t.id}
            aria-hidden={!active}
            inert={!active}
            className={cn('absolute inset-0 transition-opacity duration-700', active ? 'z-10 opacity-100' : 'pointer-events-none opacity-0')}
          >
            {img ? (
              <img src={img} alt="" draggable={false} fetchPriority={i === 0 ? 'high' : 'low'} loading={i === 0 ? 'eager' : 'lazy'} className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(${s.angle}deg, ${s.from}, ${s.to})` }} />
            )}
            {t.type === 'movie' && <SlideVideo titleId={t.id} active={active} paused={!running} />}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

            <div className="absolute inset-0 flex flex-col justify-end gap-3 p-6 pb-16 md:max-w-3xl md:p-10 md:pb-16">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wide text-neutral-100 uppercase">
                {isFresh(t) && <span className="rounded-full bg-primary px-2 py-0.5">Nouveau</span>}
                <span className="rounded-full bg-white/15 px-2 py-0.5 backdrop-blur">{t.type === 'series' ? 'Série' : 'Film'}</span>
                {t.release_year && <span className="rounded-full bg-white/15 px-2 py-0.5 backdrop-blur">{t.release_year}</span>}
                {t.maturity_rating && <span className="rounded-full bg-white/15 px-2 py-0.5 backdrop-blur">{t.maturity_rating}</span>}
              </div>
              {t.logo_url ? (
                <img src={t.logo_url} alt={t.title} className="max-h-28 w-auto max-w-[75%] object-contain object-left md:max-h-36" />
              ) : (
                <h2 className="line-clamp-2 text-3xl leading-tight font-black tracking-[0.12em] uppercase drop-shadow-lg md:text-5xl">{t.title}</h2>
              )}
              {t.synopsis && <p className="line-clamp-3 max-w-xl text-xs text-neutral-200 drop-shadow md:text-sm">{t.synopsis}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button asChild size="sm" className="h-9 bg-white px-5 font-semibold text-black hover:bg-white/80">
                  <Link
                    to="/watch/$id"
                    params={{ id: t.id }}
                    tabIndex={active ? 0 : -1}
                    onClick={(e) => {
                   if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
                   e.preventDefault()
                   openPlayer({ titleId: t.id })
                   }}
                  >
                    <Play className="size-4 fill-current" /> Lecture
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary" className="h-9 bg-white/20 px-4 font-semibold text-white backdrop-blur hover:bg-white/30">
                  <Link to="/title/$slug" params={{ slug: t.slug }} tabIndex={active ? 0 : -1}>
                    <Info className="size-4" /> Plus d'infos
                  </Link>
                </Button>
                <FavoriteButton title={t} variant="icon" className="static" />
              </div>
            </div>
          </div>
        )
      })}

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Précédent"
            onClick={() => go(index - 1)}
            className="absolute top-1/2 left-2 z-20 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition-opacity group-hover/hero:opacity-100 hover:bg-black/60 focus-visible:opacity-100 md:flex"
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            aria-label="Suivant"
            onClick={() => go(index + 1)}
            className="absolute top-1/2 right-2 z-20 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition-opacity group-hover/hero:opacity-100 hover:bg-black/60 focus-visible:opacity-100 md:flex"
          >
            <ChevronRight className="size-6" />
          </button>

          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/55 px-4 py-2 backdrop-blur">
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Diapositives">
              {titles.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={`${i + 1} sur ${count} : ${t.title}`}
                  onClick={() => go(i)}
                  className={cn('relative h-1.5 overflow-hidden rounded-full bg-white/35 transition-all duration-300', i === index ? 'w-8' : 'w-1.5 hover:bg-white/60')}
                >
                  {i === index && (
                    <span
                      key={index}
                      className="hero-progress absolute inset-y-0 left-0 bg-white"
                      style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: running ? 'running' : 'paused' }}
                      onAnimationEnd={next}
                    />
                  )}
                </button>
              ))}
            </div>
            <button type="button" aria-label={userPaused ? 'Reprendre le défilement' : 'Mettre en pause'} onClick={() => setUserPaused((p) => !p)} className="text-white/90 hover:text-white">
              {userPaused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
