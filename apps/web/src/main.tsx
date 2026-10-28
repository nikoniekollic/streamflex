import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { supabase } from '@/lib/supabase'
import { clearProfileCache } from '@/lib/profile'
import { clearSubscriptionCache } from '@/lib/subscription'
import { clearAllActiveProfiles, clearViewerProfilesCache } from '@/lib/viewer-profiles'
import { resetFavorites } from '@/lib/favorites'
import './index.css'

const router = createRouter({
  routeTree,
  context: { supabase },
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
    clearProfileCache()
    clearSubscriptionCache()
    if (event === 'SIGNED_OUT') resetFavorites()
    clearViewerProfilesCache()
    if (event === 'SIGNED_OUT') clearAllActiveProfiles()
    setTimeout(() => void router.invalidate(), 0)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
