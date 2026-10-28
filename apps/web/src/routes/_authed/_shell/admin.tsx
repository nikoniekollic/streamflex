import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { BarChart3, CreditCard, Film, Shield, ShieldCheck, Users } from 'lucide-react'

export const Route = createFileRoute('/_authed/_shell/admin')({
  beforeLoad: ({ context }) => {
    if (!context.isAdmin || context.isKids) throw redirect({ to: '/', replace: true })
  },
  component: AdminLayout,
})

const TABS = [
  { to: '/admin', label: 'Catalogue', icon: Film, exact: true },
  { to: '/admin/stats', label: 'Statistiques', icon: BarChart3, exact: false },
  { to: '/admin/users', label: 'Utilisateurs', icon: Users, exact: false },
  { to: '/admin/billing', label: 'Abonnements', icon: CreditCard, exact: false },
  { to: '/admin/security', label: 'Sécurité', icon: Shield, exact: false },
] as const

function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
      <div className="mb-4 flex items-center gap-3">
        <ShieldCheck className="size-6 text-primary" />
        <h1 className="text-2xl font-bold">Administration</h1>
      </div>
      <nav className="scrollbar-none mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Sections admin">
        {TABS.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact, includeSearch: false }}
            className="-mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: 'border-primary! text-foreground! font-medium' }}
          >
            <Icon className="size-4" /> {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
