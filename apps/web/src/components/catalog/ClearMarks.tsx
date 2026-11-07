import { useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EyeOff, HeartOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { reloadFavorites } from '@/lib/favorites'

type What = 'watched' | 'favorites'

const TEXT: Record<What, { button: string; title: string; done: string; icon: typeof EyeOff }> = {
  watched: { button: 'Effacer les vidéos vues', title: 'Effacer les vidéos déjà vues', done: 'vidéo(s) retirée(s) de l’historique', icon: EyeOff },
  favorites: { button: 'Effacer les favoris', title: 'Effacer les favoris', done: 'favori(s) retiré(s) de Ma liste', icon: HeartOff },
}

/** Boutons « effacer vus » / « effacer favoris » : pour tout le catalogue, ou pour un seul modèle si `modelId` est donné. */
export function ClearMarks({ modelId, modelName }: { modelId?: string; modelName?: string }) {
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const [busy, setBusy] = useState<What | null>(null)
  const scope = modelName ? `de « ${modelName} »` : 'de tout le catalogue'

  const run = async (what: What) => {
    if (!activeProfile) return
    setBusy(what)
    try {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc('clear_my_marks', { p_profile: activeProfile.id, p_what: what, p_model: modelId ?? null })
      if (error) throw error
      if (what === 'favorites') await reloadFavorites(supabase, activeProfile.id)
      await router.invalidate() // accueil, historique, Ma liste : relus au prochain affichage
      toast.success(`${data ?? 0} ${TEXT[what].done}`)
    } catch (e) {
      toast.error('Impossible d’effacer', { description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(['watched', 'favorites'] as const).map((what) => {
        const t = TEXT[what]
        const Icon = t.icon
        return (
          <AlertDialog key={what}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null}>
                {busy === what ? <Loader2 className="animate-spin" /> : <Icon />} {t.button}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.title} ?</AlertDialogTitle>
                <AlertDialogDescription>
                  {what === 'watched'
                    ? `Toutes les vidéos ${scope} que ce profil a commencées ou terminées seront retirées de l’historique et de « Reprendre la lecture ».`
                    : `Tous les titres ${scope} seront retirés de Ma liste pour ce profil.`}{' '}
                  Cette action est définitive.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => void run(what)}>Effacer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      })}
    </div>
  )
}
