import { useRouteContext, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Tables } from '@/types/database'
import { clearSubscriptionCache } from '@/lib/subscription'

export type MyProfile = Pick<Tables<'profiles'>, 'id' | 'username' | 'display_name' | 'avatar_url' | 'role' | 'created_at'>

// ───────── Cache par utilisateur (lu dans _authed.beforeLoad à chaque navigation)
const cache = new Map<string, MyProfile | null>()

export async function getMyProfile(supabase: TypedSupabaseClient, userId: string): Promise<MyProfile | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, role, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) return null // pas de mise en cache d'une erreur réseau
  cache.set(userId, data)
  return data
}

export function clearProfileCache() {
  cache.clear()
}

// ───────── Formulaire
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/\S+$/i.test(v), 'URL https:// requise')

export const profileSchema = z.object({
  display_name: z.string().trim().max(60, '60 caractères maximum'),
  username: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[a-zA-Z0-9_]{3,30}$/.test(v), '3 à 30 caractères : lettres, chiffres, _'),
  avatar_url: optionalUrl,
})
export type ProfileValues = z.infer<typeof profileSchema>

export function toFormValues(p: MyProfile | null): ProfileValues {
  return { display_name: p?.display_name ?? '', username: p?.username ?? '', avatar_url: p?.avatar_url ?? '' }
}

export async function updateMyProfile(supabase: TypedSupabaseClient, userId: string, v: ProfileValues): Promise<MyProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      display_name: v.display_name || null,
      username: v.username || null,
      avatar_url: v.avatar_url || null,
    })
    .eq('id', userId)
    .select('id, username, display_name, avatar_url, role, created_at')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error("Ce nom d'utilisateur est déjà pris.")
    if (error.code === '23514') throw new Error('Valeur refusée (format invalide).')
    if (error.code === 'PGRST116') throw new Error('Profil introuvable.')
    throw new Error(error.message)
  }
  cache.set(userId, data)
  return data
}

export function initials(name: string | null | undefined, fallback: string): string {
  const src = (name || fallback).trim()
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

// ───────── Déconnexion propre
export function useSignOut() {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  return async (scope: 'local' | 'global' = 'local') => {
    const { error } = await supabase.auth.signOut({ scope })
    if (error && scope === 'global') throw error
    clearProfileCache()
    clearSubscriptionCache()
    await router.navigate({ to: '/login', replace: true })
  }
}
