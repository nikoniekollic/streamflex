import { useState } from 'react'
import { Link, createFileRoute, useRouter, useRouterState } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Film, Loader2, RotateCcw, Search, Tv, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RequestActionDialog } from '@/components/admin/RequestActionDialog'
import { STATUS_LABEL, TYPE_LABEL, fetchAdminRequests, setRequestStatus, type AdminRequest, type RequestStatus } from '@/lib/requests'

type Search = { status?: RequestStatus | 'all'; q?: string; page?: number }

export const Route = createFileRoute('/_authed/_shell/admin/requests')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const page = Number(s.page)
    return {
      status: s.status === 'added' || s.status === 'rejected' || s.status === 'all' ? s.status : undefined, // défaut : en attente
      q: typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 100) : undefined,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    fetchAdminRequests(context.supabase, {
      status: deps.status === 'all' ? undefined : (deps.status ?? 'pending'),
      q: deps.q,
      page: deps.page,
    }),
  staleTime: 0,
  component: RequestsAdmin,
})

const TABS: { value: Search['status']; label: string }[] = [
  { value: undefined, label: 'En attente' },
  { value: 'added', label: 'Ajoutées' },
  { value: 'rejected', label: 'Refusées' },
  { value: 'all', label: 'Toutes' },
]

const STATUS_CLASS: Record<RequestStatus, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  added: 'border-green-500/40 bg-green-500/10 text-green-400',
  rejected: 'border-neutral-600 bg-neutral-800 text-neutral-300',
}

function RequestsAdmin() {
  const { rows, total, pageCount } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const { supabase } = Route.useRouteContext()
  const loading = useRouterState({ select: (s) => s.isLoading })
  const page = search.page ?? 1

  const [q, setQ] = useState(search.q ?? '')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [dialog, setDialog] = useState<{ mode: 'added' | 'rejected'; ids: string[]; query: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const update = (patch: Partial<Search>) => {
    setSelected(new Set())
    void navigate({ search: (p) => ({ ...p, page: undefined, ...patch }), replace: true })
  }

  const apply = async (ids: string[], status: RequestStatus, opts: { note?: string; titleId?: string | null } = {}) => {
    setBusy(ids.length === 1 ? ids[0] : 'bulk')
    try {
      const n = await setRequestStatus(supabase, ids, status, opts)
      toast.success(
        status === 'pending'
          ? `${n} demande(s) remise(s) en attente`
          : `${n} demande(s) ${status === 'added' ? 'marquée(s) comme ajoutée(s)' : 'refusée(s)'} — demandeur(s) notifié(s)`,
      )
      setSelected(new Set())
      setDialog(null)
      await router.invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** « Marquer comme ajouté » : traite aussi les demandes identiques en attente visibles */
  const similarIds = (r: AdminRequest) =>
    rows
      .filter((x) => x.status === 'pending' && x.media_type === r.media_type && norm(x.title) === norm(r.title))
      .map((x) => x.id)

  const sel = [...selected]
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))

  return (
    <div className={cn('grid gap-4 transition-opacity', loading && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Statut" className="inline-flex rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={search.status === t.value}
              onClick={() => update({ status: t.value })}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', search.status === t.value ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            update({ q: q.trim() || undefined })
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre ou e-mail…" className="pl-9" />
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {total} demande{total > 1 ? 's' : ''}
          {sel.length > 0 && ` · ${sel.length} sélectionnée${sel.length > 1 ? 's' : ''}`}
        </span>
        <div className="flex gap-2">
          <Button size="sm" disabled={!sel.length || !!busy} onClick={() => setDialog({ mode: 'added', ids: sel, query: rows.find((r) => r.id === sel[0])?.title ?? '' })}>
            <Check /> Marquer comme ajouté
          </Button>
          <Button size="sm" variant="outline" disabled={!sel.length || !!busy} onClick={() => setDialog({ mode: 'rejected', ids: sel, query: '' })}>
            <X /> Refuser
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={allOnPage}
                  onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                  className="size-4 accent-[var(--primary)]"
                />
              </TableHead>
              <TableHead>Demande</TableHead>
              <TableHead>Demandeur</TableHead>
              <TableHead className="text-center">Demandes similaires</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  Aucune demande.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} data-state={selected.has(r.id) ? 'selected' : undefined}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${r.title}`}
                    checked={selected.has(r.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s)
                        if (n.has(r.id)) n.delete(r.id)
                        else n.add(r.id)
                        return n
                      })
                    }
                    className="size-4 accent-[var(--primary)]"
                  />
                </TableCell>
                <TableCell className="max-w-72">
                  <p className="flex items-center gap-2 truncate font-medium">
                    {r.media_type === 'movie' ? <Film className="size-4 shrink-0 text-muted-foreground" /> : <Tv className="size-4 shrink-0 text-muted-foreground" />}
                    {r.title}
                    {r.release_year && <span className="text-muted-foreground">({r.release_year})</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {TYPE_LABEL[r.media_type]}
                    {r.note && ` · « ${r.note} »`}
                  </p>
                  {r.title_slug && (
                    <Link to="/title/$slug" params={{ slug: r.title_slug }} className="text-xs text-primary hover:underline">
                      Titre lié →
                    </Link>
                  )}
                </TableCell>
                <TableCell className="max-w-48">
                  <p className="truncate">{r.user_name ?? '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.user_email}</p>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={r.similar_count > 1 ? 'default' : 'outline'} className="tabular-nums">
                    {r.similar_count}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleDateString('fr-FR')}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_CLASS[r.status]}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  {r.admin_note && r.status !== 'pending' && <p className="mt-1 max-w-40 truncate text-xs text-muted-foreground">{r.admin_note}</p>}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {r.status === 'pending' ? (
                    <>
                      <Button size="sm" disabled={!!busy} onClick={() => setDialog({ mode: 'added', ids: similarIds(r), query: r.title })}>
                        {busy === r.id ? <Loader2 className="animate-spin" /> : <Check />} Marquer comme ajouté
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Refuser" disabled={!!busy} onClick={() => setDialog({ mode: 'rejected', ids: [r.id], query: '' })}>
                        <X className="text-destructive" />
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void apply([r.id], 'pending')}>
                      <RotateCcw /> Remettre en attente
                    </Button>
                  )}
                </TableCell>
              </TableRow>
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

      <RequestActionDialog
        mode={dialog?.mode ?? null}
        count={dialog?.ids.length ?? 0}
        defaultQuery={dialog?.query ?? ''}
        onClose={() => setDialog(null)}
        onConfirm={({ note, titleId }) => apply(dialog!.ids, dialog!.mode, { note, titleId })}
      />
    </div>
  )
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
