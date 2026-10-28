import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { activeProfileStore, clearViewerProfilesCache, setActiveProfileId, type ViewerProfile } from '@/lib/viewer-profiles'
import { resetFavorites } from '@/lib/favorites'

type Ctx = {
  profiles: ViewerProfile[]
  activeProfile: ViewerProfile | null
  isKids: boolean
  /** Active un profil (PIN déjà vérifié par l'appelant) puis navigue */
  selectProfile: (id: string, redirectTo?: string) => Promise<void>
  /** Revient à l'écran « Qui est-ce ? » */
  switchProfile: () => Promise<void>
  /** Recharge la liste après création / modification / suppression */
  refreshProfiles: () => Promise<void>
}

const ActiveProfileContext = createContext<Ctx | null>(null)

export function ActiveProfileProvider({ children }: { children: ReactNode }) {
  const { user, viewerProfiles, activeProfile, isKids } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  useSyncExternalStore(activeProfileStore.subscribe, activeProfileStore.getVersion) // re-rendu au changement

  const selectProfile = useCallback(
    async (id: string, redirectTo = '/') => {
      setActiveProfileId(user.id, id)
      resetFavorites() // favoris propres au profil
      await router.invalidate()
      router.history.replace(redirectTo)
    },
    [router, user.id],
  )

  const switchProfile = useCallback(async () => {
    setActiveProfileId(user.id, null)
    resetFavorites()
    await router.navigate({ to: '/profiles' })
  }, [router, user.id])

  const refreshProfiles = useCallback(async () => {
    clearViewerProfilesCache()
    await router.invalidate()
  }, [router])

  const value = useMemo(
    () => ({ profiles: viewerProfiles, activeProfile, isKids, selectProfile, switchProfile, refreshProfiles }),
    [viewerProfiles, activeProfile, isKids, selectProfile, switchProfile, refreshProfiles],
  )
  return <ActiveProfileContext.Provider value={value}>{children}</ActiveProfileContext.Provider>
}

export function useActiveProfile(): Ctx {
  const ctx = useContext(ActiveProfileContext)
  if (!ctx) throw new Error('useActiveProfile doit être utilisé sous <ActiveProfileProvider>')
  return ctx
}

/** Profil actif garanti (routes protégées par requireActiveProfile) */
export function useRequiredProfile(): ViewerProfile {
  const { activeProfile } = useActiveProfile()
  if (!activeProfile) throw new Error('Aucun profil actif')
  return activeProfile
}
