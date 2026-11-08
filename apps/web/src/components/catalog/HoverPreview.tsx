import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play } from 'lucide-react'
import type { CatalogTitle } from '@/lib/catalog'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { CSS_POS, useSiteSettings, type CardFit, type Fit } from '@/lib/site-settings'
import {
  ambientAllowed,
  cancelWarm,
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
import { acquireSlot, attachSlot, detachSlot, dropSlot, peekSlot, type PoolSlot } from '@/lib/video-pool'
import { prefetchWatch } from '@/lib/prefetch'

export const CSS_FIT: Record<CardFit, 'cover' | 'contain' | 'fill'> = { cover: 'cover', contain: 'contain', stretch: 'fill' }
/** Réglage « ajustement » de l'admin → mode CSS (adapté = vidéo entière, remplir = rogne, étirer = déforme) */
export const hoverFit = (f: Fit): CardFit => (f === 'auto' ? 'contain' : f === 'cover' ? 'cover' : 'stretch')

// ───────── Fond vidéo d'une page (titre) : extrait en boucle, sans son, réglages de l'admin (Apparence)
export function PreviewClip({ titleId, active, delayMs = 400, className }: { titleId: string; active: boolean; delayMs?: number; className?: string }) {
  const { activeProfile } = useActiveProfile()
  const { preview: cfg } = useSiteSettings()
  const profileId = activeProfile?.id
  const [src, setSrc] = useState<string | null>(() => peekPreviewUrl(titleId))
  const [playing, setPlaying] = useState(false)
  const start = useRef(0)

  useEffect(() => {
    if (!active || !profileId) return
    if (src) return
    const wanted: Wanted = { cancelled: false }
    const t = setTimeout(() => void getPreviewUrl(supabase, profileId, titleId, wanted).then((u) => !wanted.cancelled && u && setSrc(u)), delayMs)
    return () => {
      wanted.cancelled = true
      clearTimeout(t)
    }
  }, [active, profileId, titleId, delayMs, src])

  if (!src || !active) return null
  return (
    <video
      src={src}
      muted
      playsInline
      autoPlay
      preload="auto"
      aria-hidden
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        const d = v.duration
        start.current = Number.isFinite(d) && d > cfg.bannerClip * 2 ? Math.min(d * (0.08 + Math.random() * 0.7), d - cfg.bannerClip - 1) : 0
        if (start.current > 0) v.currentTime = start.current
      }}
      onPlaying={() => setPlaying(true)}
      onTimeUpdate={(e) => {
        const v = e.currentTarget
        if (v.currentTime >= start.current + cfg.bannerClip) v.currentTime = start.current
      }}
      onEnded={(e) => {
        e.currentTarget.currentTime = start.current
        void e.currentTarget.play().catch(() => undefined)
      }}
      onError={() => {
        invalidatePreview(titleId)
        setSrc(null)
      }}
      style={{ objectFit: CSS_FIT[hoverFit(cfg.bannerFit)], objectPosition: CSS_POS[cfg.bannerPos] }}
      className={cn('pointer-events-none size-full transition-opacity duration-500', playing ? 'opacity-100' : 'opacity-0', className)}
    />
  )
}

// ───────── Jaquette du catalogue : l'aperçu reste DANS la miniature (cœur et liste de lecture restent cliquables)
//  • visible → image figée de la vidéo ; quelques jaquettes visibles → lecture silencieuse (réglable)
//  • survol → même élément, avec le son ; bouton pause
//  • l'élément vidéo de chaque jaquette est gardé en mémoire (lib/video-pool) : retour sur une page = rien à relire
const KEEP_SLOT_MS = 3000 // une carte qui sort de l'écran garde sa place 3 s (défilement aller-retour)

/** Rang d'une jaquette dans la page : ligne par ligne, de gauche à droite (première ligne = chargée en premier). */
const pageOrder = (r: DOMRect) => Math.round((r.top + window.scrollY) / 20) * 10_000 + Math.round(r.left)

export function HoverPreview({ title, active, coverPos }: { title: CatalogTitle; active: boolean; coverPos?: number | null }) {
  const titleId = title.id
  // Un même film peut apparaître dans plusieurs rangées : visibilité et élément vidéo sont propres à chaque carte
  const visKey = `${titleId}#${useId()}`
  const { activeProfile } = useActiveProfile()
  const profileId = activeProfile?.id
  const { preview: cfg } = useSiteSettings()
  const [url, setUrl] = useState<string | null>(() => peekPreviewUrl(titleId))
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const sentinel = useRef<HTMLSpanElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const slotRef = useRef<PoolSlot | null>(null)
  const retries = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const coverRef = useRef(coverPos)
  coverRef.current = coverPos

  useSyncExternalStore(subscribeAmbient, getAmbientVersion)
  const known = peekSlot(titleId, url)
  const show = !!url && (active || isStillSlot(visKey) || !!known)
  const mode: 'hover' | 'ambient' | 'still' = active ? 'hover' : cfg.ambient && isAmbientSlot(visKey, cfg.ambientMax) ? 'ambient' : 'still'

  // Visibilité : lien préparé (par lots avec les autres jaquettes) ; ≥ 60 % visible → candidate à la lecture d'ambiance
  useEffect(() => {
    const el = sentinel.current
    if (!el || !profileId || !('IntersectionObserver' in window)) return
    let alive = true
    let leave: ReturnType<typeof setTimeout> | undefined
    // 1) Préparation du lien : zone élargie (700 px sous l'écran) → les jaquettes du bas sont prêtes avant d'arriver
    const warmIo = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const cached = peekPreviewUrl(titleId)
          if (cached) setUrl(cached)
          else
            void warmPreview(supabase, profileId, titleId, pageOrder(entry.boundingClientRect)).then((u) => {
              if (u && alive) setUrl(u)
            })
        } else cancelWarm(titleId)
      },
      { rootMargin: '700px 0px', threshold: 0 },
    )
    // 2) Ce qui est réellement à l'écran : image figée, lecture silencieuse (≥ 60 % visible)
    const viewIo = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          clearTimeout(leave)
          setStillVisible(visKey, true)
        } else leave = setTimeout(() => !activeRef.current && setStillVisible(visKey, false), KEEP_SLOT_MS)
        setAmbientVisible(visKey, entry.isIntersecting && entry.intersectionRatio >= 0.6 && ambientAllowed())
      },
      { rootMargin: '0px', threshold: [0, 0.6] },
    )
    warmIo.observe(el)
    viewIo.observe(el)
    return () => {
      alive = false
      warmIo.disconnect()
      viewIo.disconnect()
      clearTimeout(leave)
      cancelWarm(titleId)
      setAmbientVisible(visKey, false)
      setStillVisible(visKey, false)
    }
  }, [profileId, titleId, visKey])

  // Survol : les données de la page de lecture (titre, position, sous-titres) sont demandées d'avance → le clic ouvre le lecteur sans attente
  useEffect(() => {
    if (!active || !profileId) return
    const t = setTimeout(() => prefetchWatch(supabase, profileId, titleId, 'saved'), 150)
    return () => clearTimeout(t)
  }, [active, profileId, titleId])

  // Survol d'une jaquette dont le lien n'est pas encore prêt : prioritaire
  useEffect(() => {
    if (!active || !profileId || url) return
    const wanted: Wanted = { cancelled: false }
    void getPreviewUrl(supabase, profileId, titleId, wanted).then((u) => {
      if (!wanted.cancelled && u) setUrl(u)
    })
    return () => {
      wanted.cancelled = true
    }
  }, [active, profileId, titleId, url])

  // L'élément vidéo de la jaquette est posé dans la carte (créé, ou repris tel quel de la réserve)
  useEffect(() => {
    const h = host.current
    // on attend le moment enregistré de la jaquette : sinon la vidéo se placerait au hasard avant de le connaître
    if (!show || !url || !h || coverRef.current === undefined) return
    const slot = acquireSlot(titleId, url, cfg.clipSeconds, pageOrder(h.getBoundingClientRect()), coverRef.current)
    slotRef.current = slot
    attachSlot(slot, h)
    const sync = () => {
      setReady(slot.ready)
      if (slot.failed) {
        // lien probablement expiré : un lien neuf, une seule fois
        dropSlot(slot)
        invalidatePreview(titleId)
        setUrl(null)
        if (retries.current++ < 1 && profileId) {
          setTimeout(() => void warmPreview(supabase, profileId, titleId).then((u) => u && setUrl(u)), 400)
        } else markAmbientFailed(visKey)
      } else if (slot.ready) retries.current = 0
    }
    slot.subs.add(sync)
    setReady(slot.ready)
    return () => {
      slot.subs.delete(sync)
      detachSlot(slot)
      if (slotRef.current === slot) slotRef.current = null
    }
  }, [show, url, titleId, cfg.clipSeconds, profileId, visKey, coverPos !== undefined])

  useEffect(() => {
    if (!active) setPaused(false)
  }, [active])

  // Lecture selon le mode : le son seulement au survol
  useEffect(() => {
    const slot = slotRef.current
    if (!slot || !show) return
    const el = slot.el
    el.style.objectFit = CSS_FIT[mode === 'hover' ? hoverFit(cfg.fit) : cfg.cardFit]
    el.style.objectPosition = CSS_POS[mode === 'hover' ? cfg.hoverPos : cfg.restPos]
    if (!ready) return
    if (mode === 'still' || (mode === 'hover' && paused)) {
      el.pause()
      return
    }
    el.muted = mode !== 'hover'
    el.volume = mode === 'hover' ? cfg.volume : 0
    el.preload = 'auto'
    void el.play().catch(() => {
      el.muted = true // son refusé par le navigateur : muet plutôt que rien
      return el.play().catch(() => undefined)
    })
  }, [mode, show, ready, paused, url, cfg.volume, cfg.fit, cfg.cardFit, cfg.hoverPos, cfg.restPos])

  // Onglet masqué : pause
  useEffect(() => {
    const on = () => {
      const el = slotRef.current?.el
      if (!el) return
      if (document.hidden) el.pause()
      else if (mode !== 'still' && !paused) void el.play().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [mode, paused])

  return (
    <>
      <span ref={sentinel} aria-hidden className="pointer-events-none absolute inset-0" />
      <div ref={host} aria-hidden className={cn('pointer-events-none absolute inset-0 z-[1] bg-black transition-opacity duration-500', show && ready ? 'opacity-100' : 'opacity-0')} />
      {active && show && ready && cfg.pauseButton && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault() // dans la carte-lien : ni ouverture du lecteur ni navigation
            e.stopPropagation()
            setPaused((p) => !p)
          }}
          aria-label={paused ? "Reprendre l'aperçu" : "Mettre l'aperçu en pause"}
          aria-pressed={paused}
          className="absolute top-2 left-2 z-[6] flex size-8 items-center justify-center rounded-full border-2 border-neutral-300 bg-black/60 text-white backdrop-blur-sm hover:scale-110 hover:border-white"
        >
          {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
        </button>
      )}
    </>
  )
}
