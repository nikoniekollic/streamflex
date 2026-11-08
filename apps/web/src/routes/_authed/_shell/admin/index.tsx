import { useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Film, Loader2, Pencil, Plus, Search, Tag, Trash2, Tv, UserRound, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeleteTitleButton } from '@/components/admin/DeleteTitleButton'
import { CoverThumb } from '@/components/catalog/CoverThumb'
import {
  adminErrorMessage,
  bulkDelete,
  bulkGenre,
  bulkSetPublished,
  deleteTitle,
  fetchAdminIds,
  fetchAdminList,
  fetchGenres,
  setPublished,
  type AdminListSearch,
} from '@/lib/admin'
import { attachTitles, listModels } from '@/lib/models'

export const Route = createFileRoute('/_authed/_shell/admin/')({
  validateSearch: (s: Record<string, unknown>): AdminListSearch => {
    const page = Number(s.page)
    return {
      page: Number.isInteger(page) && page > 1 ? page : undefined,
      q: typeof s.q === 'string' && s.q.trim() ? s.q.trim() : undefined,
      type: s.type === 'movie' || s.type === 'series' ? s.type : undefined,
      status: s.status === 'published' || s.status === 'draft' ? s.status : undefined,
      genre: typeof s.genre === 'string' && /^(none|\d+)$/.test(s.genre) ? s.genre : undefined,
      model: typeof s.model === 'string' && /^(none|[0-9a-f-]{36})$/i.test(s.model) ? s.model : undefined,
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const [list, genres, models] = await Promise.all([
      fetchAdminList(context.supabase, deps),
      fetchGenres(context.supabase).catch(() => []),
      listModels(context.supabase).catch(() => []),
    ])
    return { ...list, genres, models }
  },
  component: AdminList,
})

function AdminList() {
  const { rows, total, pageCount, genres, models } = Route.useLoaderData()
  const search = Route.useSearch()
  const page = search.page ?? 1
  const navigate = Route.useNavigate()
  const { supabase } = Route.useRouteContext()
  const router = useRouter()
  const [q, setQ] = useState(search.q ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ───── sélection (conservée d'une page à l'autre)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [working, setWorking] = useState(false)
  const [bulkGenreId, setBulkGenreId] = useState('')
  const [bulkModelId, setBulkModelId] = useState('')
  const pageIds = useMemo(() => rows.map((r) => r.id), [rows])
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const someOnPage = pageIds.some((id) => selected.has(id))

  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s)
      for (const id of pageIds) {
        if (allOnPage) n.delete(id)
        else n.add(id)
      }
      return n
    })

  const selectAllResults = async () => {
    setWorking(true)
    try {
      const ids = await fetchAdminIds(supabase, search)
      setSelected(new Set(ids))
      toast.success(`${ids.length} titre${ids.length > 1 ? 's' : ''} sélectionné${ids.length > 1 ? 's' : ''}`)
    } catch (e) {
      toast.error(adminErrorMessage(e))
    } finally {
      setWorking(false)
    }
  }

  const runBulk = async (label: string, fn: (ids: string[]) => Promise<unknown>, confirm?: string) => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (confirm && !window.confirm(confirm.replace('{n}', String(ids.length)))) return
    setWorking(true)
    setError(null)
    try {
      await fn(ids)
      toast.success(`${label} : ${ids.length} titre${ids.length > 1 ? 's' : ''}`)
      setSelected(new Set())
      await router.invalidate()
    } catch (e) {
      setError(adminErrorMessage(e))
    } finally {
      setWorking(false)
    }
  }

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

  const hasFilters = !!(search.q || search.type || search.status || search.genre || search.model)

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
          <NativeSelect aria-label="Type" value={search.type ?? ''} onChange={(e) => update({ type: (e.target.value || undefined) as AdminListSearch['type'] })}>
            <option value="">Tous types</option>
            <option value="movie">Vidéos</option>
            <option value="series">Séries</option>
          </NativeSelect>
        </div>
        <div className="w-36">
          <NativeSelect aria-label="Statut" value={search.status ?? ''} onChange={(e) => update({ status: (e.target.value || undefined) as AdminListSearch['status'] })}>
            <option value="">Tous statuts</option>
            <option value="published">Publiés</option>
            <option value="draft">Brouillons</option>
          </NativeSelect>
        </div>
        <div className="w-44">
          <NativeSelect aria-label="Catégorie" value={search.genre ?? ''} onChange={(e) => update({ genre: e.target.value || undefined })}>
            <option value="">Toutes catégories</option>
            <option value="none">Sans catégorie</option>
            {genres.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-48">
          <NativeSelect aria-label="Modèle" value={search.model ?? ''} onChange={(e) => update({ model: e.target.value || undefined })}>
            <option value="">Tous modèles</option>
            <option value="none">Sans modèle</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.titles_count})
              </option>
            ))}
          </NativeSelect>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('')
              navigate({ search: {}, replace: true })
            }}
          >
            <X /> Effacer les filtres
          </Button>
        )}
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

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/50 bg-background/95 p-3 backdrop-blur">
          <span className="text-sm font-medium">
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          {allOnPage && selected.size < total && (
            <Button size="sm" variant="link" disabled={working} onClick={() => void selectAllResults()}>
              Sélectionner les {total} résultats
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={working}>
            Tout désélectionner
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button size="sm" variant="secondary" disabled={working} onClick={() => void runBulk('Publiés', (ids) => bulkSetPublished(supabase, ids, true))}>
            <Eye /> Publier
          </Button>
          <Button size="sm" variant="secondary" disabled={working} onClick={() => void runBulk('Dépubliés', (ids) => bulkSetPublished(supabase, ids, false))}>
            <EyeOff /> Dépublier
          </Button>
          <div className="flex items-center gap-1">
            <div className="w-40">
              <NativeSelect aria-label="Catégorie à appliquer" value={bulkGenreId} onChange={(e) => setBulkGenreId(e.target.value)}>
                <option value="">Catégorie…</option>
                {genres.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button size="sm" variant="secondary" disabled={working || !bulkGenreId} onClick={() => void runBulk('Catégorie ajoutée', (ids) => bulkGenre(supabase, ids, Number(bulkGenreId), true))}>
              <Tag /> Ajouter
            </Button>
            <Button size="sm" variant="outline" disabled={working || !bulkGenreId} onClick={() => void runBulk('Catégorie retirée', (ids) => bulkGenre(supabase, ids, Number(bulkGenreId), false))}>
              Retirer
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-44">
              <NativeSelect aria-label="Modèle à rattacher" value={bulkModelId} onChange={(e) => setBulkModelId(e.target.value)}>
                <option value="">Modèle…</option>
                <option value="__none">Détacher du modèle</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={working || !bulkModelId}
              onClick={() => void runBulk('Modèle mis à jour', (ids) => attachTitles(supabase, bulkModelId === '__none' ? null : bulkModelId, ids))}
            >
              <UserRound /> Appliquer
            </Button>
          </div>
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            disabled={working}
            onClick={() => void runBulk('Supprimés', (ids) => bulkDelete(supabase, ids), 'Supprimer définitivement {n} titre(s) et leurs sources ? Cette action est irréversible.')}
          >
            {working ? <Loader2 className="animate-spin" /> : <Trash2 />} Supprimer
          </Button>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Sélectionner tous les titres de la page"
                  checked={allOnPage}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOnPage && someOnPage
                  }}
                  onChange={togglePage}
                  disabled={rows.length === 0}
                />
              </TableHead>
              <TableHead className="w-16">Visuel</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Modèle</TableHead>
              <TableHead>Catégories</TableHead>
              <TableHead className="text-center">Sources</TableHead>
              <TableHead>Publié</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                  Aucun contenu.{' '}
                  <Link to="/admin/new" className="text-primary hover:underline">
                    Ajouter le premier titre
                  </Link>
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.id} data-state={selected.has(r.id) ? 'selected' : undefined}>
                <TableCell>
                  <input type="checkbox" aria-label={`Sélectionner ${r.title}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                </TableCell>
                <TableCell>
                  {/* visuel = image de la vidéo elle-même (moment enregistré), pour distinguer les films d'un même modèle */}
                  <CoverThumb
                    titleId={r.id}
                    coverPos={r.cover_pos}
                    order={i}
                    className="h-[5.25rem] w-14 rounded"
                    fallback={r.poster_url ? <img src={r.poster_url.replace(/#model$/, '')} alt="" loading="lazy" className="size-full object-cover opacity-60" /> : null}
                  />
                </TableCell>
                <TableCell className="max-w-72">
                  <Link to="/admin/$id" params={{ id: r.id }} className="block truncate font-medium hover:underline">
                    {r.title}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.slug}
                    {r.release_year ? ` · ${r.release_year}` : ''}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {r.type === 'movie' ? <Film /> : <Tv />}
                    {r.type === 'movie' ? 'Vidéo' : 'Série'}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-40 truncate text-sm">{r.model ?? '—'}</TableCell>
                <TableCell className="max-w-56">
                  <div className="flex flex-wrap gap-1">{r.genres.length ? r.genres.map((g) => <Badge key={g} variant="outline">{g}</Badge>) : '—'}</div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={r.sourceCount ? 'outline' : 'destructive'}>{r.sourceCount}</Badge>
                </TableCell>
                <TableCell>
                  <Switch checked={r.is_published} disabled={busy === r.id} onCheckedChange={(v) => void togglePublish(r.id, v)} aria-label="Publié" />
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => navigate({ search: (p) => ({ ...p, page: page - 1 > 1 ? page - 1 : undefined }) })}>
            <ChevronLeft /> Précédent
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => navigate({ search: (p) => ({ ...p, page: page + 1 }) })}>
            Suivant <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
