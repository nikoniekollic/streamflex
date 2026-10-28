import { Link, Outlet, createFileRoute, useRouteContext } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { AppHeader } from '@/components/layout/AppHeader'
import { requireActiveProfile } from '@/lib/route-guards'

export const Route = createFileRoute('/_authed/_shell')({
  beforeLoad: ({ context, location }) => requireActiveProfile(context, location.href),
  component: Shell,
})

function Shell() {
  const { hasAccess, subscription } = useRouteContext({ from: '/_authed' })
  return (
    <>
      <AppHeader />
      <main className="pt-16">
        {!hasAccess && (
          <div className="relative z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary/90 px-4 py-2 text-center text-sm text-primary-foreground">
            <KeyRound className="size-4" />
            {subscription?.status === 'suspended'
              ? 'Ton abonnement est suspendu.'
              : subscription
                ? 'Ton abonnement a expiré.'
                : 'Aucun abonnement actif : la lecture est désactivée.'}
            <Link to="/profile" hash="subscription" className="font-semibold underline underline-offset-2">
              Activer un code
            </Link>
          </div>
        )}
        <Outlet />
      </main>
    </>
  )
}
