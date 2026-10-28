import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getMyProfile } from '@/lib/profile'
import { getMySubscription, isSubscriptionActive } from '@/lib/subscription'
import { listViewerProfiles, resolveActiveProfile } from '@/lib/viewer-profiles'
import { ActiveProfileProvider } from '@/components/profile/ActiveProfileContext'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href }, replace: true })
    }
    const user = context.session.user
    const [profile, subscription, viewerProfiles] = await Promise.all([
      getMyProfile(context.supabase, user.id),
      getMySubscription(context.supabase, user.id),
      listViewerProfiles(context.supabase, user.id).catch(() => []),
    ])
    const isAdmin = profile?.role === 'admin'
    const activeProfile = resolveActiveProfile(user.id, viewerProfiles)
    return {
      session: context.session,
      user,
      profile,
      isAdmin,
      subscription,
      hasAccess: isAdmin || isSubscriptionActive(subscription),
      viewerProfiles,
      activeProfile,
      isKids: !!activeProfile?.is_kids_profile,
    }
  },
  component: () => (
    <ActiveProfileProvider>
      <Outlet />
    </ActiveProfileProvider>
  ),
})

