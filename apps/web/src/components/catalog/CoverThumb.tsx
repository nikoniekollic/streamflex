import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { cancelWarm, directPreview, invalidatePreview, peekPreviewUrl, warmPreview } from '@/lib/preview'
import { acquireSlot, attachSlot, detachSlot } from '@/lib/video-pool'
import { SnapImage, useSnap } from '@/components/catalog/SnapImage'

/**
 * Visuel d'un film = l'image de SA vidéo à son moment enregistré (cover_pos), au lieu de l'image du modèle commune à
 * tous ses films. Utilisé dans l'admin (liste du catalogue) et sur les cartes de modèles. `fallback` s'affiche en attendant
 * (ou si la vidéo est indisponible).
 */
export function CoverThumb({ titleId, coverPos, fallback, className, order = 0, direct = false }: { titleId: string; coverPos: number | null; fallback?: ReactNode; className?: string; order?: number; direct?: boolean }) {
  const { activeProfile } = useActiveProfile()
  const profileId = activeProfile?.id
  // le lien appartient à UN film : quand la vignette change de film (recapture d'un modèle), l'ancien lien ne doit pas servir
  const [got, setGot] = useState<{ id: string; url: string | null }>(() => ({ id: titleId, url: peekPreviewUrl(titleId) }))
  const url = got.id === titleId ? got.url : peekPreviewUrl(titleId)
  const setUrl = (u: string | null) => setGot({ id: titleId, url: u })
  const [ready, setReady] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  // image figée déjà en mémoire (vue plus tôt dans la session) : affichée tout de suite, sans vidéo à charger
  const snap = useSnap(titleId)
  const needVideo = !snap
  const retried = useRef(false)
  useEffect(() => {
    retried.current = false
  }, [titleId])
  // seules les vignettes proches de l'écran sont préparées (48 cartes de modèles = 48 liens à débrider sinon)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  const [rank, setRank] = useState(order) // rang dans la page (ligne puis colonne) : la première ligne est préparée en premier
  useEffect(() => {
    const el = host.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setRank(order || Math.round((e.boundingClientRect.top + window.scrollY) / 20) * 10_000 + Math.round(e.boundingClientRect.left))
        setNear(true)
      },
      { rootMargin: '500px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (url || !profileId || !near || !needVideo) return
    let alive = true
    const wanted = { cancelled: false }
    void warmPreview(supabase, profileId, titleId, rank)
      .then((u) => (u || !direct || !alive ? u : directPreview(supabase, profileId, titleId, wanted))) // Alldebrid indisponible : lien direct 1fichier (jaquettes de modèles)
      .then((u) => alive && u && setUrl(u))
    return () => {
      alive = false
      wanted.cancelled = true
      cancelWarm(titleId)
    }
  }, [url, profileId, titleId, rank, near, direct, needVideo])

  useEffect(() => {
    const h = host.current
    if (!h || !url || !near || !needVideo) return
    const slot = acquireSlot(titleId, url, 30, rank, coverPos)
    slot.el.style.objectFit = 'cover'
    attachSlot(slot, h)
    const sync = () => {
      setReady(slot.ready)
      if (slot.failed && !retried.current) {
        // lien probablement expiré : un lien neuf, une fois
        retried.current = true
        invalidatePreview(titleId)
        setUrl(null)
      }
    }
    slot.subs.add(sync)
    setReady(slot.ready)
    return () => {
      slot.subs.delete(sync)
      detachSlot(slot)
    }
  }, [url, titleId, coverPos, rank, near, needVideo])

  return (
    <div className={cn('relative overflow-hidden bg-neutral-900', className)}>
      {fallback}
      {snap && <SnapImage bitmap={snap} />}
      <div ref={host} aria-hidden className={cn('pointer-events-none absolute inset-0 bg-black transition-opacity duration-500', ready && needVideo ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}
