import { useCallback, useEffect, useState } from 'react'
import { Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cancelImportJob, fetchImportJobs, type ImportJob } from '@/lib/onefichier-import'
import type { TypedSupabaseClient } from '@/lib/supabase'

const LABELS: Record<ImportJob['status'], string> = {
  pending: 'En attente',
  running: 'En cours',
  waiting: 'Pause 1fichier',
  completed: 'Terminé',
  cancelled: 'Arrêté',
  error: 'Erreur',
}
const ACTIVE = new Set<ImportJob['status']>(['pending', 'running', 'waiting'])

/** Jobs d'import serveur : continuent même si l'onglet est fermé ; cette page sert aussi de battement de cœur. */
export function ImportJobsPanel({ supabase, refreshKey }: { supabase: TypedSupabaseClient; refreshKey: number }) {
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setJobs(await fetchImportJobs(supabase))
      setErr(null)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [supabase])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
  }, [load, refreshKey])

  if (jobs.length === 0 && !err) return null
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="font-semibold">Imports en arrière-plan</h2>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {jobs.map((j) => (
        <div key={j.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {ACTIVE.has(j.status) && <Loader2 className="size-4 animate-spin" />}
            <span className="font-medium">{j.root_name ?? 'Racine'}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{LABELS[j.status]}</span>
            {ACTIVE.has(j.status) && (
              <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => void cancelImportJob(supabase, j.id).then(load)}>
                <Square className="size-3.5" /> Arrêter
              </Button>
            )}
          </div>
          <p className="text-muted-foreground">
            {j.folders_done} dossiers traités · {j.folders_left} en file · {j.files_seen.toLocaleString('fr-FR')} fichiers vus
          </p>
          <p>
            <span className="text-green-500">{Number(j.imported).toLocaleString('fr-FR')} importés</span> ·{' '}
            {Number(j.ignored).toLocaleString('fr-FR')} ignorés · <span className={j.failed ? 'text-destructive' : ''}>{Number(j.failed)} échecs</span>
          </p>
          {j.current_folder && ACTIVE.has(j.status) && <p className="text-xs text-muted-foreground">Prochain dossier : {j.current_folder}</p>}
          {j.last_message && <p className="text-xs text-muted-foreground">{j.last_message}</p>}
        </div>
      ))}
    </section>
  )
}
