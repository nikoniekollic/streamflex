import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { fetchWatch, setWatch, watchNow, type WatchConfig, type WatchStats } from '@/lib/watch'
import type { TypedSupabaseClient } from '@/lib/supabase'

const ago = (iso: string | null) => {
  if (!iso) return 'jamais'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`
}

/** Surveillance automatique du compte 1fichier : nouveaux fichiers, dossiers mis à jour, nouveaux dossiers. */
export function WatchPanel({ supabase }: { supabase: TypedSupabaseClient }) {
  const [cfg, setCfg] = useState<WatchConfig | null>(null)
  const [stats, setStats] = useState<WatchStats>({ folders: 0, due: 0, hot: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetchWatch(supabase)
      setCfg(r.config)
      setStats(r.stats)
      setErr(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [supabase])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  const save = async (patch: Partial<Pick<WatchConfig, 'enabled' | 'publish' | 'model_per_folder'>>) => {
    const next = { enabled: cfg?.enabled ?? false, publish: cfg?.publish ?? false, model_per_folder: cfg?.model_per_folder ?? true, ...patch }
    setBusy(true)
    try {
      await setWatch(supabase, next.enabled, next.publish, next.model_per_folder)
      toast.success(next.enabled ? 'Surveillance activée' : 'Surveillance désactivée')
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scanNow = async () => {
    setBusy(true)
    try {
      await watchNow(supabase)
      toast.success('Analyse lancée')
      setTimeout(() => void load(), 15_000)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Eye className="size-5" /> Surveillance automatique
      </h2>
      <p className="text-xs text-muted-foreground">
        Toutes les 5 minutes, quelques dossiers « échus » sont relus (budget dédié : 60 appels / h, ≥ 8 s d'écart). Un dossier où il y a du neuf est revu toutes les 15 min ; sans nouveauté, l'intervalle double jusqu'à 24 h. Les nouveaux
        dossiers et fichiers sont importés seuls. La surveillance se met en pause pendant un import en arrière-plan.
      </p>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save({ enabled: !cfg?.enabled })} disabled={busy || !cfg} variant={cfg?.enabled ? 'secondary' : 'default'}>
          {busy && <Loader2 className="size-4 animate-spin" />} {cfg?.enabled ? 'Désactiver' : 'Activer la surveillance'}
        </Button>
        <Button variant="outline" onClick={() => void scanNow()} disabled={busy || !cfg?.enabled}>
          Analyser maintenant
        </Button>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={cfg?.publish ?? false} onChange={(e) => void save({ publish: e.target.checked })} disabled={busy || !cfg} /> Publier directement
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={cfg?.model_per_folder ?? true} onChange={(e) => void save({ model_per_folder: e.target.checked })} disabled={busy || !cfg} /> Un modèle par dossier
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        {cfg?.enabled ? <span className="text-green-500">Active</span> : 'Inactive'} · {stats.folders} dossiers suivis · {stats.due} à relire · {stats.hot} avec du neuf (24 h) · dernier passage {ago(cfg?.last_tick_at ?? null)}
      </p>
      {cfg?.last_message && <p className="text-xs text-muted-foreground">{cfg.last_message}</p>}
    </section>
  )
}
