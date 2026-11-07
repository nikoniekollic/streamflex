import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react'
import { Link } from '@tanstack/react-router'
import { Pause, Play } from 'lucide-react'
import { useSiteSettings, type CardFit } from '@/lib/site-settings'
import type { CatalogTitle } from '@/lib/catalog'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import {
  ambientAllowed,
  getAmbientVersion,
  getPreviewUrl,
  invalidatePreview,
  isAmbientSlot,
  isStillSlot,
  markAmbientFailed,
  peekPreviewUrl,
  setAmbientVisible,
  setStillVisible,
  subscribeAmbient,
  warmPreview,
  type Wanted,
} from '@/lib/preview'

type ClipProps = {
  titleId: string
  active: boolean
  /** extrait lu en boucle, en secondes */
  clipSeconds?: number
  /** attente avant de lancer quoi que ce soit */
  delayMs?: number
  /** son activé (aperçu au survol) ou muet (fond de la page d'un titre) */
  audio?: boolean
  /** prépare le lien dès que l'élément est visible, et autorise la lecture silencieuse d'ambiance (quelques cartes seulement) */
  warm?: boolean
  className?: string
}

const AMBIENT_CLIP_S = 30 // même durée partout : ~30 s par affiche

/** Extrait vidéo d'un instant aléatoire du film (lien Alldebrid débridé dans le navigateur), lu en boucle. */
export function PreviewClip({ titleId, active, clipSeconds = 30, delayMs = 700, audio = false, warm = false, className }: ClipProps) {
  const { activeProfile } = useActiveProfile()
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const start = useRef(0)
  const profileId = activeProfile?.id
  const sentinel = useRef<HTMLSpanElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  // Image figée tirée de la vidéo (lue par le navigateur, sans rien stocker) : distingue les films entre eux
  const [stillUrl, setStillUrl] = useState<string | null>(null)
  const [stillReady, setStillReady] = useState(false)

  // Ce titre a-t-il une place parmi les quelques cartes qui jouent en silence ?
  useSyncExternalStore(subscribeAmbient, getAmbientVersion)
  const ambient = warm && !active && isAmbientSlot(titleId)
  const mode: 'hover' | 'ambient' | null = active ? 'hover' : ambient ? 'ambient' : null

  // Visibilité : ≥ 1,2 s à l'écran → lien préparé ; ≥ 60 % visible → candidat à la lecture d'ambiance
  useEffect(() => {
    const el = sentinel.current
    if (!warm || !el || !profileId || !('IntersectionObserver' in window)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let alive = true
    const io = new IntersectionObserver(
      ([entry]) => {
        if (timer) clearTimeout(timer)
        timer = null
        if (entry.isIntersecting) {
          timer = setTimeout(() => {
            void warmPreview(supabase, profileId, titleId).then((url) => {
              if (url && alive) setStillUrl(url)
            })
          }, 1200)
        } else {
          setStillUrl(null) // hors écran : on libère la connexion
          setStillReady(false)
        }
        setAmbientVisible(titleId, entry.isIntersecting && entry.intersectionRatio >= 0.6 && ambientAllowed())
      },
      { rootMargin: '100px', threshold: [0, 0.6] },
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
      if (timer) clearTimeout(timer)
      setAmbientVisible(titleId, false)
    }
  }, [warm, profileId, titleId])

  // Résolution du lien selon le mode
  useEffect(() => {
    if (!mode || !profileId) {
      setSrc(null)
      setPlaying(false)
      return
    }
    const ready = peekPreviewUrl(titleId)
    if (ready) {
      setSrc(ready) // lien déjà préparé : démarrage immédiat
      return () => {
        setSrc(null)
        setPlaying(false)
      }
    }
    const wanted: Wanted = { cancelled: false }
    const t = setTimeout(
      () => {
        const job = mode === 'hover' ? getPreviewUrl(supabase, profileId, titleId, wanted) : warmPreview(supabase, profileId, titleId)
        void job.then((url) => {
          if (wanted.cancelled) return
          if (url) setSrc(url)
          else if (mode === 'ambient') markAmbientFailed(titleId) // laisse sa place à une autre carte
        })
      },
      mode === 'hover' ? delayMs : 0,
    )
    return () => {
      wanted.cancelled = true
      clearTimeout(t)
      setSrc(null)
      setPlaying(false)
    }
  }, [mode, profileId, titleId, delayMs])

  // Onglet masqué : on met en pause
  useEffect(() => {
    const on = () => {
      const v = video.current
      if (!v) return
      if (document.hidden) v.pause()
      else void v.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const withSound = mode === 'hover' && audio
  const clip = mode === 'ambient' ? AMBIENT_CLIP_S : clipSeconds
  const sentinelEl = warm ? <span ref={sentinel} aria-hidden className="pointer-events-none absolute inset-0" /> : null

  // Structure stable : le repère observé ne doit jamais être recréé quand la vidéo apparaît
  return (
    <>
      {sentinelEl}
      {stillUrl && warm && !(src && playing) && (
        <video
          key={stillUrl}
          src={stillUrl}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (Number.isFinite(v.duration) && v.duration > 20) v.currentTime = v.duration * (0.1 + Math.random() * 0.75)
          }}
          onSeeked={() => setStillReady(true)}
          onError={() => setStillUrl(null)}
          className={cn('pointer-events-none absolute inset-0 z-[1] size-full object-cover transition-opacity duration-500', stillReady ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {src && mode && (
        <video
          key={mode}
          ref={video}
          src={src}
          playsInline
          preload="auto"
          aria-hidden
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            v.muted = !withSound
            v.volume = withSound ? 0.7 : 0
            const d = v.duration
            // début aléatoire, assez tôt pour qu'il reste de quoi remplir l'extrait
            start.current = Number.isFinite(d) && d > clip * 2 ? Math.min(d * (0.08 + Math.random() * 0.7), d - clip - 1) : 0
            if (start.current > 0) v.currentTime = start.current
          }}
          onCanPlay={(e) => {
            const v = e.currentTarget
            // Son refusé par le navigateur (aucune interaction préalable) : on retombe en muet plutôt que de ne rien montrer
            void v.play().catch(() => {
              v.muted = true
              return v.play().catch(() => undefined)
            })
          }}
          onPlaying={() => setPlaying(true)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            if (v.currentTime >= start.current + clip) v.currentTime = start.current
          }}
          onEnded={(e) => {
            e.currentTarget.currentTime = start.current
            void e.currentTarget.play().catch(() => undefined)
          }}
          onError={() => {
            console.warn('[StreamFlex][preview] la vidéo ne se charge pas')
            if (mode === 'ambient') markAmbientFailed(titleId)
            setSrc(null)
          }}
          className={cn('pointer-events-none size-full object-cover transition-opacity duration-300', playing ? 'opacity-100' : 'opacity-0', className)}
        />
      )}
    </>
  )
}

// ───────── Jaquette du catalogue : UN seul élément <video> par carte
//  • visible à l'écran → image figée de la vidéo (instant aléatoire, lue par le navigateur, sans stockage)
//  • quelques cartes visibles → la même vidéo joue en silence
//  • survol → le MÊME élément (déjà chargé, déjà positionné) passe en lecture avec le son dans un panneau dont le
//    format, l'ajustement (adapté / remplir / étirer), la durée et le volume se règlent dans l'admin (Apparence)
const INFO_H = 84
const KEEP_SLOT_MS = 3000 // une carte qui sort de l'écran garde sa vidéo 3 s (défilement aller-retour sans recharger)

type PanelRect = { left: number; top: number; width: number; height: number; videoH: number }

function parseRatio(r: string): number | null {
  const m = r.match(/^(\d+):(\d+)$/)
  return m ? Number(m[1]) / Number(m[2]) : null
}

function computeRect(card: DOMRect, aspect: number, widthPref: number): PanelRect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(Math.max(widthPref, card.width * 1.4), vw - 16)
  const videoH = Math.min(width / aspect, vh * 0.62)
  const height = Math.max(videoH + INFO_H, card.height)
  return {
    left: Math.min(Math.max(card.left + card.width / 2 - width / 2, 8), vw - width - 8),
    top: Math.min(Math.max(card.top + card.height / 2 - height / 2, 8), vh - height - 8),
    width,
    height,
    videoH,
  }
}

const FIT_CLASS = { cover: 'object-cover', contain: 'object-contain', stretch: 'object-fill' } as const

export function HoverPreview({ title, active, cardRef }: { title: CatalogTitle; active: boolean; cardRef: RefObject<HTMLDivElement | null> }) {
  const titleId = title.id
  const { activeProfile } = useActiveProfile()
  const profileId = activeProfile?.id
  const { preview: cfg } = useSiteSettings()
  const [url, setUrl] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [videoAspect, setVideoAspect] = useState(16 / 9)
  const [rect, setRect] = useState<PanelRect | null>(null)
  const [paused, setPaused] = useState(false)
  const sentinel = useRef<HTMLSpanElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const anchor = useRef(0)
  const retries = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useSyncExternalStore(subscribeAmbient, getAmbientVersion)
  const slot = isStillSlot(titleId)
  const show = !!url && (active || slot)
  const mode: 'hover' | 'ambient' | 'still' = active ? 'hover' : cfg.ambient && isAmbientSlot(titleId) ? 'ambient' : 'still'

  // Ratio du panneau : celui de la vidéo, ou imposé par l'admin
  const forced = parseRatio(cfg.ratio)
  const aspect = forced ?? videoAspect
  const panelFit: CardFit = cfg.fit === 'auto' ? 'contain' : cfg.fit === 'cover' ? 'cover' : 'stretch'

  const warm = (delay = 0) => {
    if (!profileId) return
    const t = setTimeout(() => {
      void warmPreview(supabase, profileId, titleId).then((u) => {
        if (u) setUrl(u)
      })
    }, delay)
    return t
  }

  // Visibilité : lien préparé dès 0,35 s à l'écran (ou aussitôt s'il est déjà connu) ; ≥ 60 % → candidat à la lecture d'ambiance
  useEffect(() => {
    const el = sentinel.current
    if (!el || !profileId || !('IntersectionObserver' in window)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let leave: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(timer)
        if (entry.isIntersecting) {
          clearTimeout(leave)
          setStillVisible(titleId, true)
          const known = peekPreviewUrl(titleId)
          if (known) setUrl(known)
          else timer = warm(350)
        } else {
          leave = setTimeout(() => {
            if (activeRef.current) return
            setStillVisible(titleId, false)
            setUrl(null) // hors écran depuis 3 s : on libère la connexion
            setReady(false)
          }, KEEP_SLOT_MS)
        }
        setAmbientVisible(titleId, entry.isIntersecting && entry.intersectionRatio >= 0.6 && ambientAllowed())
      },
      { rootMargin: '200px', threshold: [0, 0.6] },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      clearTimeout(timer)
      clearTimeout(leave)
      setAmbientVisible(titleId, false)
      setStillVisible(titleId, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, titleId])

  useEffect(() => {
    if (!show) setReady(false)
  }, [show])

  // Survol : lien tout de suite (prioritaire) si la carte n'était pas encore préparée
  useEffect(() => {
    if (!active || !profileId) return
    if (url) return
    const wanted: Wanted = { cancelled: false }
    void getPreviewUrl(supabase, profileId, titleId, wanted).then((u) => {
      if (!wanted.cancelled && u) setUrl(u)
    })
    return () => {
      wanted.cancelled = true
    }
  }, [active, profileId, titleId, url])

  // La pause ne dure que le temps du survol
  useEffect(() => {
    if (!active) setPaused(false)
  }, [active])

  // Panneau : position calculée depuis la carte, suit le défilement / redimensionnement
  useEffect(() => {
    if (!active) {
      setRect(null)
      return
    }
    const update = () => {
      const c = cardRef.current
      if (c) setRect(computeRect(c.getBoundingClientRect(), aspect, cfg.width))
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [active, aspect, cardRef, cfg.width])

  // Lecture selon le mode : le son seulement au survol
  useEffect(() => {
    const v = video.current
    if (!v || !show) return
    if (mode === 'still') {
      v.pause()
      v.muted = true
      return
    }
    v.muted = mode !== 'hover'
    v.volume = mode === 'hover' ? cfg.volume : 0
    v.preload = 'auto'
    anchor.current = v.currentTime
    const go = () => {
      if (pausedRef.current) return
      void v.play().catch(() => {
        v.muted = true // son refusé par le navigateur : muet plutôt que rien
        return v.play().catch(() => undefined)
      })
    }
    if (v.readyState >= 2) go()
    else v.addEventListener('canplay', go, { once: true })
    return () => v.removeEventListener('canplay', go)
  }, [mode, show, cfg.volume])

  // Bouton pause / reprise de l'aperçu
  useEffect(() => {
    const v = video.current
    if (!v || mode !== 'hover') return
    if (paused) v.pause()
    else void v.play().catch(() => undefined)
  }, [paused, mode])

  // Onglet masqué : pause
  useEffect(() => {
    const on = () => {
      const v = video.current
      if (!v || mode === 'still') return
      if (document.hidden) v.pause()
      else if (!pausedRef.current) void v.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [mode])

  const popup = active && rect
  const videoStyle: CSSProperties | undefined = popup
    ? { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.videoH, zIndex: 61, background: '#000', borderRadius: '8px 8px 0 0' }
    : undefined

  const onError = () => {
    console.warn('[StreamFlex][preview] la vidéo ne se charge pas')
    setReady(false)
    if (retries.current < 1) {
      // lien probablement expiré : on en demande un neuf une fois
      retries.current++
      invalidatePreview(titleId)
      setUrl(null)
      warm(400)
      return
    }
    if (mode === 'ambient') markAmbientFailed(titleId)
    setUrl(null)
  }

  const togglePause = (e: React.MouseEvent) => {
    e.preventDefault() // le bouton est dans la carte-lien : pas de navigation
    e.stopPropagation()
    setPaused((p) => !p)
  }

  return (
    <>
      <span ref={sentinel} aria-hidden className="pointer-events-none absolute inset-0" />
      {show && (
        <video
          key={url}
          ref={video}
          src={url!}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight)
            const d = v.duration
            if (Number.isFinite(d) && d > cfg.clipSeconds * 2) v.currentTime = Math.min(d * (0.1 + Math.random() * 0.7), d - cfg.clipSeconds - 1)
          }}
          onSeeked={(e) => {
            anchor.current = e.currentTarget.currentTime
            retries.current = 0
            setReady(true)
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            if (mode !== 'still' && v.currentTime >= anchor.current + cfg.clipSeconds) v.currentTime = anchor.current
          }}
          onEnded={(e) => {
            e.currentTarget.currentTime = anchor.current
            if (!pausedRef.current) void e.currentTarget.play().catch(() => undefined)
          }}
          onError={onError}
          style={videoStyle}
          className={cn(
            'pointer-events-none',
            popup ? FIT_CLASS[panelFit] : cn('absolute inset-0 z-[1] size-full bg-black transition-opacity duration-500', FIT_CLASS[cfg.cardFit]),
            popup || ready ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {popup && (
        <div
          className="fixed z-[60] flex flex-col overflow-hidden rounded-lg bg-neutral-900 shadow-2xl shadow-black/80 ring-1 ring-white/20"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <Link to="/title/$slug" params={{ slug: title.slug }} aria-label={title.title} className="relative z-[62] block w-full" style={{ height: rect.videoH }} />
          <div className="flex flex-1 flex-col justify-center gap-1.5 px-3 py-2">
            <div className="flex items-center gap-2">
              <Link to="/watch/$id" params={{ id: titleId }} aria-label={`Lire ${title.title}`} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-black hover:bg-white/80">
                <Play className="size-4 fill-current" />
              </Link>
              {cfg.pauseButton && (
                <button
                  type="button"
                  onClick={togglePause}
                  aria-label={paused ? "Reprendre l'aperçu" : "Mettre l'aperçu en pause"}
                  aria-pressed={paused}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/50 text-white hover:bg-white/20"
                >
                  {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
                </button>
              )}
              <span className="line-clamp-2 text-sm leading-tight font-semibold">{title.title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-neutral-300">
              {title.maturity_rating && <span className="rounded-sm border border-neutral-500 px-1">{title.maturity_rating}</span>}
              {title.release_year && <span>{title.release_year}</span>}
              {title.genres.slice(0, 2).map((g) => (
                <span key={g.slug}>• {g.name}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
