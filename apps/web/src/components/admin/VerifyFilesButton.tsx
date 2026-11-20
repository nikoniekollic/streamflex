// Vérification ciblée (admin) : compare les fichiers d'UN modèle ou d'UN dossier 1fichier (ex. le répertoire de base) avec
// 1fichier et retire du site ceux qui y ont été supprimés. Les fichiers des autres modèles ne sont jamais touchés.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { invalidateCatalogCache } from '@/lib/catalog-api'

type Scope = { modelId: string } | { folderId: number }
type Run = { id: string; status: 'running' | 'done' | 'error'; message: string | null; total: number; absent: number; confirmed: number; removed: number; pending: number }

async function call<T>(supabase: TypedSupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('onefichier-import', { body })
  if (error) {
    // message lisible renvoyé par la fonction (ex. « Une vérification est déjà en cours »)
    const ctx = (error as { context?: Response }).context
    const j = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw Object.assign(new Error(j?.message ?? error.message), { runId: j?.run_id as string | undefined })
  }
  return data as T
}

export function VerifyFilesButton({ supabase, scope, label, size = 'sm' }: { supabase: TypedSupabaseClient; scope: Scope; label: string; size?: 'sm' | 'default' }) {
  const router = useRouter()
  const [run, setRun] = useState<Run | null>(null)
  const [starting, setStarting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await call<Run>(supabase, { action: 'verify_status', run_id: id })
        setRun(r)
        if (r.status === 'running') return poll(id)
        if (r.status === 'error') toast.error(`Vérification : ${r.message ?? 'échec'}`)
        else toast.success(`Vérification terminée : ${r.message ?? ''}`, { duration: 12_000 })
        if (r.removed > 0) {
          await invalidateCatalogCache(supabase)
          await router.invalidate()
        }
      } catch {
        poll(id) // réseau momentané : on réessaie
      }
    }, 3000)
  }

  const start = async () => {
    const what = 'modelId' in scope ? `les fichiers de « ${label} »` : `les fichiers du dossier « ${label} »`
    if (!window.confirm(`Comparer ${what} avec 1fichier et retirer du site ceux qui y ont été supprimés ?\n\nSeuls ces fichiers-là sont vérifiés : ceux des autres modèles ne sont pas touchés.`)) return
    setStarting(true)
    try {
      const r = await call<{ run_id: string }>(supabase, { action: 'verify_start', label, ...('modelId' in scope ? { model_id: scope.modelId } : { folder_id: scope.folderId }) })
      setRun({ id: r.run_id, status: 'running', message: 'Démarrage…', total: 0, absent: 0, confirmed: 0, removed: 0, pending: 0 })
      poll(r.run_id)
    } catch (e) {
      const err = e as Error & { runId?: string }
      toast.error(err.message)
      if (err.runId) poll(err.runId) // déjà en cours : on suit celle-là
    } finally {
      setStarting(false)
    }
  }

  const running = run?.status === 'running'
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" size={size} disabled={starting || running} onClick={() => void start()}>
        {starting || running ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Vérifier les fichiers
      </Button>
      {running && (
        <span className="text-xs text-muted-foreground">
          {run.message}
          {run.absent > 0 && ` — ${run.absent} absent(s) du relevé, ${run.confirmed} vérifié(s), ${run.removed} supprimé(s)`}
        </span>
      )}
      {run && !running && <span className="max-w-xl text-xs text-muted-foreground">{run.message}</span>}
    </span>
  )
}
