import { Outlet, createRootRouteWithContext, redirect } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import type { Session } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { Toaster } from '@/components/ui/sonner'
import { getIpStatus, type IpStatus } from '@/lib/security'

export interface RouterContext {
  supabase: TypedSupabaseClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Middleware global : session + contrôle d'IP à chaque navigation (statut IP mis en cache 60 s)
  beforeLoad: async ({ context, location }): Promise<{ session: Session | null; ip: IpStatus }> => {
    const [{ data }, ip] = await Promise.all([context.supabase.auth.getSession(), getIpStatus(context.supabase)])
    if (ip.banned && location.pathname !== '/banned') throw redirect({ to: '/banned', replace: true })
    return { session: data.session, ip }
  },
  component: () => (
    <div className="min-h-dvh">
      <Outlet />
      <Toaster position="bottom-right" closeButton />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </div>
  ),
})
