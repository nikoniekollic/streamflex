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
    const pending = getIpStatus(context.supabase)
    // Le contrôle d'IP (~0,4 s) ne retarde plus l'affichage : le blocage réel est fait côté serveur (chaque Edge Function)
    // et une IP bannie est renvoyée vers /banned dès que la réponse arrive. Les pages admin / bannie attendent la réponse.
    const wait = location.pathname.startsWith('/admin') || location.pathname === '/banned'
    const fallback: IpStatus = { ip: null, banned: false, reason: null, expires_at: null }
    const [{ data }, ip] = await Promise.all([context.supabase.auth.getSession(), wait ? pending : Promise.race([pending, Promise.resolve(fallback)])])
    if (ip.banned && location.pathname !== '/banned') throw redirect({ to: '/banned', replace: true })
    if (!wait) void pending.then((v) => v.banned && location.pathname !== '/banned' && window.location.replace('/banned'))
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
