import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Clock, Loader2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { resolveMany } from '@/lib/preview'
import { setExactLength } from '@/lib/model-names'
import type { TypedSupabaseClient } from '@/lib/supabase'

const BATCH = 24 // liens résolus en un seul appel serveur, puis lus par le serveur
const WORKERS = 4 // lots traités en même temps (le débridage Alldebrid, ≈ 6 liens/s, est le vrai plafond)
const MAX_EMPTY_BATCHES = 5 // lots entiers sans aucune durée d'affilée : on s'arrête (liens refusés, Alldebrid en pause…)

type Stats = { total: number; missing: number }
type Progress = { read: number; failed: number; note: string }

/**
 * Lecture complète des durées : les vidéos publiées SANS durée connue sont lues une à une (métadonnées seulement), la durée réelle
 * est enregistrée dans la base. Les vidéos qui en ont déjà une sont ignorées : relancer après un nouveau scan ne lit que les nouvelles.
 */
export function DurationScanPanel({ supabase }: { supabase: TypedSupabaseClient }) {
  const db = supabase as unknown as SupabaseClient
  const { activeProfile } = useActiveProfile()
  const [stats, setStats] = useState<Stats | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress>({ read: 0, failed: 0, note: '' })
  const alive = useRef(false)

  const loadStats = useCallback(async () => {
    const base = () => db.from('titles').select('id', { count: 'exact', head: true }).eq('type', 'movie').eq('is_published', true)
    const [all, missing] = await Promise.all([base(), base().is('duration_s', null)])
    setStats({ total: all.count ?? 0, missing: missing.count ?? 0 })
  }, [db])

  useEffect(() => {
    void loadStats()
    return () => {
      alive.current = false // quitter la page arrête la lecture (reprise possible : tout est enregistré au fil de l'eau)
    }
  }, [loadStats])

  /** Lot suivant : identifiants + liens (la résolution du lot suivant démarre pendant la lecture du lot courant) */
  const nextBatch = useCallback(
    async (after: string) => {
      let q = db.from('titles').select('id').eq('type', 'movie').eq('is_published', true).is('duration_s', null)
      if (after) q = q.gt('id', after)
      const { data, error } = await q.order('id').limit(BATCH)
      if (error) throw new Error(error.message)
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
      return { ids, urls: ids.length && activeProfile ? resolveMany(supabase, activeProfile.id, ids) : Promise.resolve([] as (string | null)[]) }
    },
    [db, supabase, activeProfile],
  )

  const start = async () => {
    if (!activeProfile || alive.current) return
    alive.current = true
    setRunning(true)
    let read = 0
    let failed = 0
    let empty = 0
    let note = ''
    let exhausted = false
    let cursor = ''
    // le curseur est partagé : un seul lot à la fois est demandé à la base, chaque lot est ensuite traité par son propre travailleur
    let chain: Promise<unknown> = Promise.resolve()
    const take = () => {
      const p = chain.then(async () => {
        if (exhausted || !alive.current) return null
        const b = await nextBatch(cursor)
        if (b.ids.length === 0) {
          exhausted = true
          return null
        }
        cursor = b.ids[b.ids.length - 1]
        return b
      })
      chain = p.catch(() => null)
      return p
    }
    const refresh = setInterval(() => void loadStats(), 8000)
    const worker = async () => {
      let cur = await take()
      while (cur && alive.current) {
        const nxt = take() // le lot suivant se résout pendant qu'on lit celui-ci
        const urls = await cur.urls
        // le serveur lit l'en-tête de chaque fichier et enregistre les durées (admin_set_durations)
        const { data, error } = await supabase.functions.invoke<{ results: { id: string; s: number | null }[] }>('probe-durations', {
          body: { items: cur.ids.map((id, i) => ({ id, url: urls[i] ?? '' })).filter((x) => x.url) },
        })
        if (error) {
          note = `Lecture impossible : ${error.message}`
          alive.current = false
          break
        }
        const got = data?.results ?? []
        const ok = got.filter((r): r is { id: string; s: number } => r.s != null)
        ok.forEach((r) => setExactLength(r.id, r.s))
        const res = cur.ids // lot entier (liens absents = illisibles)
        read += ok.length
        failed += res.length - ok.length
        empty = ok.length === 0 ? empty + 1 : 0
        if (empty >= MAX_EMPTY_BATCHES) {
          note = 'Arrêt : aucune durée lisible sur les derniers lots (liens refusés ou Alldebrid en pause). Réessaie dans quelques minutes.'
          alive.current = false
          break
        }
        setProgress({ read, failed, note })
        cur = await nxt
      }
    }
    try {
      await Promise.all(Array.from({ length: WORKERS }, worker))
      if (!note && alive.current) note = 'Terminé : toutes les vidéos lisibles ont maintenant leur durée.'
    } catch (e) {
      note = `Erreur : ${(e as Error).message}`
    } finally {
      clearInterval(refresh)
      alive.current = false
      setRunning(false)
      setProgress({ read, failed, note })
      void loadStats()
    }
  }

  const stop = () => {
    alive.current = false
  }

  const done = stats ? stats.total - stats.missing : 0
  const pct = stats && stats.total > 0 ? Math.round((done / stats.total) * 100) : 0

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Clock className="size-5" /> Durées réelles des vidéos
      </h2>
      <p className="text-xs text-muted-foreground">
        « Lecture » ouvre chaque vidéo qui n’a pas encore de durée (métadonnées seulement, quelques Ko) et enregistre sa durée réelle dans la base, pour l’affichage sur les jaquettes et le tri. Les vidéos qui en ont déjà une sont ignorées : après un nouveau scan, relance la
        lecture, seules les nouvelles seront lues. Garde cet onglet ouvert pendant la lecture ; elle se reprend où elle en était.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <Button variant="secondary" onClick={stop}>
            <Pause className="size-4" /> Arrêter
          </Button>
        ) : (
          <Button onClick={() => void start()} disabled={!activeProfile || !stats || stats.missing === 0}>
            <Play className="size-4" /> Lecture
          </Button>
        )}
        {running && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {stats && (
          <span className="text-sm text-muted-foreground">
            {done.toLocaleString('fr-FR')} / {stats.total.toLocaleString('fr-FR')} durées connues ({pct} %) · {stats.missing.toLocaleString('fr-FR')} à lire
          </span>
        )}
      </div>
      {stats && stats.total > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(running || progress.read > 0 || progress.failed > 0) && (
        <p className="text-xs text-muted-foreground">
          Cette lecture : {progress.read.toLocaleString('fr-FR')} durée(s) enregistrée(s), {progress.failed.toLocaleString('fr-FR')} illisible(s) (fichier absent ou lien refusé : relues à la prochaine lecture).
        </p>
      )}
      {progress.note && <p className="text-sm">{progress.note}</p>}
      {!activeProfile && <p className="text-xs text-destructive">Choisis un profil pour lancer la lecture.</p>}
    </section>
  )
}
