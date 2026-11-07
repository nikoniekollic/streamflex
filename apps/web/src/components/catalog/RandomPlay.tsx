import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Dices, Loader2, Play, Shuffle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RANDOM_LIST_SIZE, drawRandomIds, startQueue, startRandomQueue } from '@/lib/queue'
import { prefetchAround, prefetchWatch } from '@/lib/prefetch'
import { openPlayer } from '@/lib/player-overlay'

// Au survol du bouton : la liste de 100 est déjà tirée et les 2 premières vidéos sont préparées (lien débridé, données) → le clic démarre presque aussitôt
let prepared: { key: string; ids: string[]; at: number } | null = null
const PREPARED_TTL_MS = 90_000

/**
 * Bouton « Aléatoire » (deux dés) : lance, en premier plan, une liste de 100 vidéos tirées au hasard
 * (catalogue entier ou un seul modèle), sans jamais reprendre une vidéo déjà lancée par ce bouton.
 */
export function RandomPlayButton({
  label,
  modelId,
  size = 'sm',
  variant = 'secondary',
  className,
}: {
  label: string
  modelId?: string
  size?: 'sm' | 'default'
  variant?: 'secondary' | 'ghost' | 'default' | 'outline'
  className?: string
}) {
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const [busy, setBusy] = useState(false)

  const key = `${activeProfile?.id}:${modelId ?? ''}`
  const prepare = () => {
    if (!activeProfile || (prepared?.key === key && Date.now() - prepared.at < PREPARED_TTL_MS)) return
    prepared = { key, ids: [], at: Date.now() }
    void drawRandomIds(supabase, { profileId: activeProfile.id, modelId, kids: !!activeProfile.is_kids_profile })
      .then((ids) => {
        prepared = { key, ids, at: Date.now() }
        ids.slice(0, 2).forEach((id) => prefetchWatch(supabase, activeProfile.id, id, 'zero'))
        void prefetchAround(supabase, activeProfile.id, ids.slice(0, 2))
      })
      .catch(() => (prepared = null))
  }

  const go = async () => {
    if (!activeProfile) return
    setBusy(true)
    try {
      const ready = prepared?.key === key && Date.now() - prepared.at < PREPARED_TTL_MS ? prepared.ids : []
      prepared = null // une liste tirée ne sert qu'une fois : le prochain clic en tire une nouvelle (sans reprendre ce qui vient d'être lancé)
      const first = await startRandomQueue(supabase, { profileId: activeProfile.id, label, modelId, kids: !!activeProfile.is_kids_profile, ids: ready })
      if (!first) return void toast.error('Aucune vidéo à lire.')
      openPlayer({ titleId: first, t: 0 })
    } catch (e) {
      toast.error('Lecture impossible', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => void go()}
      onPointerEnter={prepare}
      onFocus={prepare}
      disabled={busy}
      className={cn(className)}
      title={`Lance ${RANDOM_LIST_SIZE} vidéos au hasard, sans reprendre celles déjà lancées`}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Dices />} Aléatoire
    </Button>
  )
}

/** Lance une liste connue (playlist, Ma liste) : dans l'ordre ou mélangée, en premier plan. */
export function PlayListButtons({ label, ids }: { label: string; ids: string[] }) {
  const run = (shuffle: boolean) => {
    const first = startQueue({ label, ids, shuffle })
    if (first) openPlayer({ titleId: first, t: 0 })
  }
  if (ids.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => run(false)}>
        <Play className="fill-current" /> Lecture
      </Button>
      <Button size="sm" variant="secondary" onClick={() => run(true)}>
        <Shuffle /> Mélanger
      </Button>
    </div>
  )
}
