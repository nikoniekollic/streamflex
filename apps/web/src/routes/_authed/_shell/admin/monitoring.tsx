import { useState } from 'react'
import { Link, createFileRoute, useRouter, useRouterState } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Activity, ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buildHosterPageUrl } from '@/lib/stream-url'
import { dateFr, dateTimeFr } from '@/lib/subscription'
import {
  DEFAULT_DAYS,
  MAX_BATCH,
  THRESHOLDS,
  fetchMonitoring,
  fmtSize,
  runMaintenance,
  severity,
  validateMonitoringSearch,
  type ColdSource,
  type MaintenanceAction,
  type MaintenanceOutcome,
  type MonitoringSearch,
  type Severity,
} from '@/lib/monitoring'

export const Route = createFileRoute('/_authed/_shell/admin/monitoring')({
  validateSearch: validateMonitoringSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => fetchMonitoring(context.supabase, deps),
  staleTime: 0,
  component: MonitoringPage,
})

const PROVIDER_LABEL = { pixeldrain: 'Pixeldrain', onefichier: '1fichier', alist: 'AList', other: 'Autre' } as const

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  critical: { label: 'Critique', className: 'bg-destructive text-white border-transparent' },
  risk: { label: 'À risque', className: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  never: { label: 'Jamais lu', className: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  offline: { label: 'Hors ligne', className: 'bg-neutral-700 text-neutral-200 border-transparent' },
}

function MonitoringPage() {
  const { rows, total, pageCount, summary, days } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const { supabase } = Route.useRouteContext()
  const loading = useRouterState({ select: (s) => s.isLoading })
  const page = search.page ?? 1

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [results, setResults] = useState<Record<string, MaintenanceOutcome>>({})
  const [confirmTouch, setConfirmTouch] = useState<string[] | null>(null)

  const update = (patch: Partial<MonitoringSearch>) => {
    setSelected(new Set())
    void navigate({ search: (p) => ({ ...p, page: undefined, ...patch }), replace: true })
  }

  const run = async (ids: string[], action: MaintenanceAction) => {
    if (!ids.length) return
    setBusy((b) => new Set([...b, ...ids]))
    try {
      const out = await runMaintenance(supabase, ids, action)
      setResults((r) => ({ ...r, ...Object.fromEntries(out.map((o) => [o.id, o])) }))
      const offline = out.filter((o) => o.state === 'offline').length
      const failed = out.filter((o) => o.state === 'error').length
      const label = action === 'touch' ? 'Téléchargement de maintenance' : 'Rafraîchissement'
      if (failed || offline) toast.warning(`${label} : ${out.length - failed - offline} OK · ${offline} hors ligne · ${failed} en erreur`)
      else toast.success(`${label} : ${out.length} fichier(s) OK`)
      await router.invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy((b) => new Set([...b].filter((id) => !ids.includes(id))))
    }
  }

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const sel = [...selected]

  return (
    <div className={cn('grid gap-6 transition-opacity', loading && 'opacity-60')}>
      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Seuil d'inactivité" className="inline-flex rounded-lg bg-muted p-1">
          {THRESHOLDS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === days}
              onClick={() => update({ days: d === DEFAULT_DAYS ? undefined : d })}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', d === days ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground')}
            >
              ≥ {d} j
            </button>
          ))}
        </div>
        <div className="w-40">
          <NativeSelect aria-label="Hébergeur" value={search.provider ?? ''} onChange={(e) => update({ provider: (e.target.value || undefined) as MonitoringSearch['provider'] })}>
            <option value="">Tous hébergeurs</option>
            <option value="pixeldrain">Pixeldrain</option>
            <option value="onefichier">1fichier</option>
          </NativeSelect>
        </div>
        <div className="w-44">
          <NativeSelect aria-label="Statut" value={search.status ?? ''} onChange={(e) => update({ status: (e.target.value || undefined) as MonitoringSearch['status'] })}>
            <option value="">Tous les fichiers à risque</option>
            <option value="never">Jamais lus</option>
            <option value="offline">Hors ligne (404)</option>
          </NativeSelect>
        </div>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Synthèse */}
      <div className="grid gap-4 md:grid-cols-2">
        {summary.length === 0 && (
          <Card className="md:col-span-2">
            <CardContent className="py-6 text-sm text-muted-foreground">Aucune source Pixeldrain / 1fichier active.</CardContent>
          </Card>
        )}
        {summary.map((s) => (
          <Card key={s.provider} className="gap-3 py-5">
            <CardHeader className="px-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4" /> {PROVIDER_LABEL[s.provider]}
              </CardTitle>
              <CardDescription>{s.active.toLocaleString('fr-FR')} fichiers actifs</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-4 gap-2 px-5 text-center">
              <Stat label={`≥ ${days} j`} value={s.at_risk} tone={s.at_risk ? 'warn' : undefined} />
              <Stat label={`≥ ${days + 20} j`} value={s.critical} tone={s.critical ? 'bad' : undefined} />
              <Stat label="Jamais lus" value={s.never_streamed} />
              <Stat label="Hors ligne" value={s.offline} tone={s.offline ? 'bad' : undefined} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions groupées */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString('fr-FR')} fichier{total > 1 ? 's' : ''} sans lecture depuis ≥ {days} jours ou jamais lus
          {sel.length > 0 && ` · ${sel.length} sélectionné${sel.length > 1 ? 's' : ''}`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!sel.length || busy.size > 0} onClick={() => void run(sel, 'info')}>
            <RefreshCw /> Rafraîchir la sélection
          </Button>
          <Button variant="outline" size="sm" disabled={!sel.length || busy.size > 0} onClick={() => setConfirmTouch(sel)}>
            <Download /> Maintenance
          </Button>
        </div>
      </div>

      {/* Tableau */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input type="checkbox" aria-label="Tout sélectionner" checked={allOnPage} onChange={toggleAll} className="size-4 accent-[var(--primary)]" />
              </TableHead>
              <TableHead>Contenu</TableHead>
              <TableHead>Fichier</TableHead>
              <TableHead>Dernière lecture</TableHead>
              <TableHead>Inactivité</TableHead>
              <TableHead>Dernier contrôle</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  Aucun fichier à risque pour ce seuil.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <SourceRow
                key={r.id}
                row={r}
                days={days}
                checked={selected.has(r.id)}
                onCheck={() => toggle(r.id)}
                busy={busy.has(r.id)}
                result={results[r.id]}
                onRefresh={() => void run([r.id], 'info')}
                onTouch={() => setConfirmTouch([r.id])}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page}/{pageCount}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => navigate({ search: (p) => ({ ...p, page: page - 1 > 1 ? page - 1 : undefined }) })}>
            <ChevronLeft /> Précédent
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => navigate({ search: (p) => ({ ...p, page: page + 1 }) })}>
            Suivant <ChevronRight />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        « Rafraîchir » interroge l'API officielle (métadonnées, statut en ligne). « Maintenance » télécharge le premier Mio du fichier
        ({MAX_BATCH.touch} max. par appel). L'effet sur la politique d'expiration de l'hébergeur n'est pas garanti : seule une lecture réelle
        met à jour « Dernière lecture ».
      </p>

      <AlertDialog open={confirmTouch !== null} onOpenChange={(o) => !o && setConfirmTouch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Téléchargement de maintenance</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTouch?.length} fichier(s) : téléchargement partiel (1 Mio) via l'API de l'hébergeur. Les fichiers 1fichier sont traités
              lentement (limite de l'API).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button
              onClick={() => {
                const ids = confirmTouch ?? []
                setConfirmTouch(null)
                void run(ids, 'touch')
              }}
            >
              <Download /> Lancer
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-2">
      <p className={cn('text-xl font-bold tabular-nums', tone === 'warn' && 'text-amber-300', tone === 'bad' && 'text-destructive')}>
        {value.toLocaleString('fr-FR')}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function SourceRow({
  row: r,
  days,
  checked,
  onCheck,
  busy,
  result,
  onRefresh,
  onTouch,
}: {
  row: ColdSource
  days: number
  checked: boolean
  onCheck: () => void
  busy: boolean
  result?: MaintenanceOutcome
  onRefresh: () => void
  onTouch: () => void
}) {
  const sev = severity(r, days)
  const hoster = r.provider === 'pixeldrain' || r.provider === 'onefichier' ? r.provider : null
  return (
    <TableRow data-state={checked ? 'selected' : undefined}>
      <TableCell>
        <input type="checkbox" aria-label={`Sélectionner ${r.title}`} checked={checked} onChange={onCheck} className="size-4 accent-[var(--primary)]" />
      </TableCell>
      <TableCell className="max-w-56">
        <Link to="/admin/$id" params={{ id: r.title_id }} className="block truncate font-medium hover:underline">
          {r.title}
        </Link>
        <span className="text-xs text-muted-foreground">
          {r.episode_label ? `${r.episode_label} · ` : ''}
          {r.quality} · {fmtSize(r.size_bytes)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{PROVIDER_LABEL[r.provider]}</Badge>
        {hoster && (
          <a
            href={buildHosterPageUrl(hoster, r.file_id)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 flex items-center gap-1 font-mono text-xs text-muted-foreground hover:underline"
          >
            {r.file_id} <ExternalLink className="size-3" />
          </a>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {r.last_streamed_at ? dateFr.format(new Date(r.last_streamed_at)) : <span className="text-muted-foreground">Jamais</span>}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={SEVERITY[sev].className}>
          {r.idle_days} j · {SEVERITY[sev].label}
        </Badge>
      </TableCell>
      <TableCell className="max-w-56 text-xs">
        {result ? (
          <span className={cn(result.state === 'online' ? 'text-green-400' : result.state === 'offline' ? 'text-destructive' : 'text-amber-300')}>
            {result.state === 'online'
              ? [
                  'En ligne',
                  result.views != null && `${result.views} vues`,
                  result.lastViewAt && `vu ${dateFr.format(new Date(result.lastViewAt))}`,
                  result.bytesRead != null && `${Math.round(result.bytesRead / 1024)} Kio lus`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : (result.message ?? `HTTP ${result.status}`)}
          </span>
        ) : r.last_checked_at ? (
          <span className="text-muted-foreground">
            {dateTimeFr.format(new Date(r.last_checked_at))} · HTTP {r.last_status ?? '—'}
          </span>
        ) : (
          <span className="text-muted-foreground">Jamais contrôlé</span>
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh} title="Métadonnées via l'API officielle">
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rafraîchir
        </Button>
        <Button size="icon" variant="ghost" disabled={busy} onClick={onTouch} aria-label="Téléchargement de maintenance" title="Téléchargement de maintenance (1 Mio)">
          <Download />
        </Button>
      </TableCell>
    </TableRow>
  )
}
