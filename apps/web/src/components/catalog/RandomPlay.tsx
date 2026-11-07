import { useState } from 'react'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, Play, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startQueue, startRandomQueue } from '@/lib/queue'

/** Lecture aléatoire infinie : catalogue entier, ou un seul modèle. */
export function RandomPlayButton({ label, modelId, size = 'sm' }: { label: string; modelId?: string; size?: 'sm' | 'default' }) {
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    try {
      const first = await startRandomQueue(supabase, { label, modelId, kids: !!activeProfile?.is_kids_profile })
      if (!first) return void toast.error('Aucune vidéo à lire.')
      await navigate({ to: '/watch/$id', params: { id: first }, search: { t: 0 } })
    } catch (e) {
      toast.error('Lecture impossible', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size={size} onClick={() => void go()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Shuffle />} Lecture aléatoire
    </Button>
  )
}

/** Lance une liste connue (playlist, Ma liste) : dans l'ordre ou mélangée. */
export function PlayListButtons({ label, ids }: { label: string; ids: string[] }) {
  const navigate = useNavigate()
  const run = async (shuffle: boolean) => {
    const first = startQueue({ label, ids, shuffle })
    if (first) await navigate({ to: '/watch/$id', params: { id: first }, search: { t: 0 } })
  }
  if (ids.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => void run(false)}>
        <Play className="fill-current" /> Lecture
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void run(true)}>
        <Shuffle /> Aléatoire
      </Button>
    </div>
  )
}
