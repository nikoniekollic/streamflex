import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Film, Pencil, Plus, Search, Tv } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeleteTitleButton } from '@/components/admin/DeleteTitleButton'
import { adminErrorMessage, deleteTitle, fetchAdminList, setPublished, type AdminListSearch } from '@/lib/admin'

export const Route = createFileRoute('/_authed/_shell/admin/')({
  validateSearch: (s: Record<string, unknown>): AdminListSearch => {
    const page = Number(s.page)
    return {
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      q: typeof s.q === 'string' && s.q.trim() ? s.q.trim() : undefined,
      type: s.type === 'movie' || s.type === 'series' ? s.type : undefined,
      status: s.status === 'published' || s.status === 'draft' ? s.status : undefined,
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => fetchAdminList(context.supabase, deps),
  component: AdminList,
})

function AdminList() {
  const { rows, total, pageCount } = Route.useLoaderData()
  const search = Route.useSearch()
  const page = search.page ?? 1
  const navigate = Route.useNavigate()
  const { supabase } = Route.useRouteContext()
  const router = useRouter()
  const [q, setQ] = useState(search.q ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<AdminListSearch>) =>
    navigate({ search: (prev) => ({ ...prev, page: undefined, ...patch }), replace: true })

  const togglePublish = async (id: string, value: boolean) => {
    setBusy(id)
    setError(null)
    try {
      await setPublished(supabase, id, value)
      await router.invalidate()
    } catch (e) {
      setError(adminErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            update({ q: q.trim() || undefined })
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un titre…" className="pl-9" />
        </form>
        <div className="w-36">
          <NativeSelect
            aria-label="Type"
            value={search.type ?? ''}
            onChange={(e) => update({ type: (e.target.value || undefined) as AdminListSearch['type'] })}
          >
            <option value="">Tous types</option>
            <option value="movie">Films</option>
            <option value="series">Séries</option>
          </NativeSelect>
        </div>
        <div className="w-36">
          <NativeSelect
            aria-label="Statut"
            value={search.status ?? ''}
            onChange={(e) => update({ status: (e.target.value || undefined) as AdminListSearch['status'] })}
          >
            <option value="">Tous statuts</option>
            <option value="published">Publiés</option>
            <option value="draft">Brouillons</option>
          </NativeSelect>
        </div>
        <Button asChild>
          <Link to="/admin/new">
            <Plus /> Ajouter
          </Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Titre</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Année</TableHead>
              <TableHead>Catégories</TableHead>
              <TableHead className="text-center">Sources</TableHead>
              <TableHead>Publié</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  Aucun contenu.{' '}
                  <Link to="/admin/new" className="text-primary hover:underline">
                    Ajouter le premier titre
                  </Link>
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.poster_url ? (
                    <img src={r.poster_url} alt="" loading="lazy" className="h-14 w-10 rounded object-cover" />
                  ) : (
                    <div className="h-14 w-10 rounded bg-muted" />
                  )}
                </TableCell>
                <TableCell className="max-w-72">
                  <Link to="/admin/$id" params={{ id: r.id }} className="block truncate font-medium hover:underline">
                    {r.title}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">{r.slug}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {r.type === 'movie' ? <Film /> : <Tv />}
                    {r.type === 'movie' ? 'Film' : 'Série'}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{r.release_year ?? '—'}</TableCell>
                <TableCell className="max-w-56">
                  <div className="flex flex-wrap gap-1">
                    {r.genres.length ? r.genres.map((g) => <Badge key={g} variant="outline">{g}</Badge>) : '—'}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={r.sourceCount ? 'outline' : 'destructive'}>{r.sourceCount}</Badge>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={r.is_published}
                    disabled={busy === r.id}
                    onCheckedChange={(v) => void togglePublish(r.id, v)}
                    aria-label="Publié"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="icon" aria-label="Modifier">
                    <Link to="/admin/$id" params={{ id: r.id }}>
                      <Pencil />
                    </Link>
                  </Button>
                  <DeleteTitleButton
                    title={r.title}
                    onConfirm={async () => {
                      try {
                        await deleteTitle(supabase, r.id)
                      } catch (e) {
                        throw new Error(adminErrorMessage(e))
                      }
                      await router.invalidate()
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} titre{total > 1 ? 's' : ''} · page {page}/{pageCount}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => navigate({ search: (p) => ({ ...p, page: page - 1 > 1 ? page - 1 : undefined }) })}
          >
            <ChevronLeft /> Précédent
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => navigate({ search: (p) => ({ ...p, page: page + 1 }) })}
          >
            Suivant <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
