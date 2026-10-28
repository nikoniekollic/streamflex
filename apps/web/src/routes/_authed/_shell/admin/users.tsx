import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Search, ShieldCheck, WalletCards } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ManageSubscriptionDialog } from '@/components/admin/ManageSubscriptionDialog'
import { BroadcastNotificationCard } from '@/components/admin/BroadcastNotificationCard'
import { listUsers, type AdminUser, type UserFilter } from '@/lib/admin-ops'
import { clearSubscriptionCache, dateFr } from '@/lib/subscription'

type Search = { q?: string; filter?: UserFilter; page?: number }

export const Route = createFileRoute('/_authed/_shell/admin/users')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const page = Number(s.page)
    return {
      q: typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 100) : undefined,
      filter: ['active', 'expired', 'suspended', 'admin'].includes(s.filter as string) ? (s.filter as UserFilter) : undefined,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => listUsers(context.supabase, deps),
  staleTime: 0,
  component: UsersPage,
})

function SubBadge({ u }: { u: AdminUser }) {
  if (!u.sub_status) return <Badge variant="outline">Aucun</Badge>
  if (u.sub_status !== 'active') return <Badge variant="destructive">{u.sub_status === 'suspended' ? 'Suspendu' : 'Annulé'}</Badge>
  const live = u.sub_ends_at && new Date(u.sub_ends_at) > new Date()
  return live ? <Badge>Actif</Badge> : <Badge variant="secondary">Expiré</Badge>
}

function UsersPage() {
  const data = Route.useLoaderData()
  const rows = (data.rows || []) as AdminUser[]
  const { total, pageCount } = data
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [q, setQ] = useState(search.q ?? '')
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const page = search.page ?? 1

  const update = (patch: Partial<Search>) => navigate({ search: (p) => ({ ...p, page: undefined, ...patch }), replace: true })

  // ligne à jour après invalidation (badge, date de fin dans la modale)
  const current = selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null

  return (
    <div className="grid gap-4">
      <BroadcastNotificationCard />
      <div className="flex flex-wrap gap-3">
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            update({ q: q.trim() || undefined })
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="E-mail, nom, pseudo…" className="pl-9" />
        </form>
        <div className="w-44">
          <NativeSelect value={search.filter ?? ''} onChange={(e) => update({ filter: (e.target.value || undefined) as UserFilter | undefined })} aria-label="Filtre">
            <option value="">Tous</option>
            <option value="active">Abonnés actifs</option>
            <option value="expired">Sans abonnement / expirés</option>
            <option value="suspended">Suspendus</option>
            <option value="admin">Admins</option>
          </NativeSelect>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utilisateur</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Abonnement</TableHead>
              <TableHead>Fin</TableHead>
              <TableHead>Inscrit</TableHead>
              <TableHead>Dernière connexion</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Aucun utilisateur.
                </TableCell>
              </TableRow>
            )}
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="max-w-64">
                  <p className="truncate font-medium">{u.display_name || u.username || '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </TableCell>
                <TableCell>
                  {u.role === 'admin' ? (
                    <Badge variant="secondary">
                      <ShieldCheck /> Admin
                    </Badge>
                  ) : (
                    'Utilisateur'
                  )}
                </TableCell>
                <TableCell>
                  <SubBadge u={u} />
                </TableCell>
                <TableCell className="tabular-nums">{u.sub_ends_at ? dateFr.format(new Date(u.sub_ends_at)) : '—'}</TableCell>
                <TableCell className="text-muted-foreground">{dateFr.format(new Date(u.created_at))}</TableCell>
                <TableCell className="text-muted-foreground">{u.last_sign_in_at ? dateFr.format(new Date(u.last_sign_in_at)) : '—'}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setSelected(u)}>
                    <WalletCards /> Gérer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} utilisateur{total > 1 ? 's' : ''} · page {page}/{pageCount}
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

      <ManageSubscriptionDialog
        user={current}
        onClose={() => setSelected(null)}
        onChanged={async () => {
          clearSubscriptionCache()
          await router.invalidate()
        }}
      />
    </div>
  )
}
