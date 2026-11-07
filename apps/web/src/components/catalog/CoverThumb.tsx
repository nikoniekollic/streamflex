import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { cancelWarm, invalidatePreview, peekPreviewUrl, warmPreview } from '@/lib/preview'
import { acquireSlot, attachSlot, detachSlot } from '@/lib/video-pool'

/**
 * Visuel d'un film = l'image de SA vidéo à son moment enregistré (cover_pos), au lieu de l'image du modèle commune à
 * tous ses films. Utilisé dans l'admin (liste du catalogue) et sur les cartes de modèles. `fallback` s'affiche en attendant
 * (ou si la vidéo est indisponible).
 */
export function CoverThumb({ titleId, coverPos, fallback, className, order = 0 }: { titleId: string; coverPos: number | null; fallback?: ReactNode; className?: string; order?: number }) {
  const { activeProfile } = useActiveProfile()
  const profileId = activeProfile?.id
  const [url, setUrl] = useState<string | null>(() => peekPreviewUrl(titleId))
  const [ready, setReady] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const retried = useRef(false)

  useEffect(() => {
    if (url || !profileId) return
    let alive = true
    void warmPreview(supabase, profileId, titleId, order).then((u) => alive && u && setUrl(u))
    return () => {
      alive = false
      cancelWarm(titleId)
    }
  }, [url, profileId, titleId, order])

  useEffect(() => {
    const h = host.current
    if (!h || !url) return
    const slot = acquireSlot(titleId, url, 30, order, coverPos)
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
  }, [url, titleId, coverPos, order])

  return (
    <div className={cn('relative overflow-hidden bg-neutral-900', className)}>
      {fallback}
      <div ref={host} aria-hidden className={cn('pointer-events-none absolute inset-0 bg-black transition-opacity duration-500', ready ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}
