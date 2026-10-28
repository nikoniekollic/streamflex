import { redirect } from '@tanstack/react-router'

/** À appeler dans le beforeLoad des routes qui exigent un profil de visionnage actif. */
export function requireActiveProfile(ctx: { activeProfile: unknown }, href: string) {
  if (!ctx.activeProfile) throw redirect({ to: '/profiles', search: { redirect: href }, replace: true })
}
