// Profils de visionnage (façon Netflix) : API + store du profil actif (lisible hors React, ex. beforeLoad)
import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

export type ViewerProfile = Database['public']['Functions']['my_viewer_profiles']['Returns'][number]
export const MAX_PROFILES = 5

// ───────── Liste (cache par utilisateur)
const listCache = new Map<string, ViewerProfile[]>()

export async function listViewerProfiles(supabase: TypedSupabaseClient, userId: string, force = false): Promise<ViewerProfile[]> {
  if (!force && listCache.has(userId)) return listCache.get(userId)!
  const { data, error } = await supabase.rpc('my_viewer_profiles')
  if (error) throw error
  listCache.set(userId, data ?? [])
  return data ?? []
}

export function clearViewerProfilesCache() {
  listCache.clear()
}

// ───────── Profil actif (localStorage, par compte ; effacé à chaque connexion/déconnexion → « Qui est-ce ? »)
const KEY = (userId: string) => `sf:active-profile:${userId}`
const listeners = new Set<() => void>()
let version = 0

export function getActiveProfileId(userId: string): string | null {
  try {
    return localStorage.getItem(KEY(userId))
  } catch {
    return null
  }
}

export function setActiveProfileId(userId: string, profileId: string | null) {
  try {
    if (profileId) localStorage.setItem(KEY(userId), profileId)
    else localStorage.removeItem(KEY(userId))
  } catch {
    /* stockage indisponible : profil actif limité à la session mémoire */
  }
  version++
  listeners.forEach((l) => l())
}

export function clearAllActiveProfiles() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sf:active-profile:'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
  version++
  listeners.forEach((l) => l())
}

export const activeProfileStore = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  getVersion: () => version,
}

export function resolveActiveProfile(userId: string, profiles: ViewerProfile[]): ViewerProfile | null {
  const id = getActiveProfileId(userId)
  return profiles.find((p) => p.id === id) ?? null
}

// ───────── Mutations (réponses JSON {ok, error})
type Result = { ok: true; id?: string } | { ok: false; error: string; message: string }

const ERRORS: Record<string, string> = {
  wrong_pin: 'Code PIN incorrect.',
  pin_locked: 'Trop de tentatives. Réessaie dans 15 minutes.',
  parental_pin_required: 'Le contrôle parental est actif : saisis le PIN d’un profil adulte.',
  max_profiles: `Maximum ${MAX_PROFILES} profils par compte.`,
  name_taken: 'Un profil porte déjà ce nom.',
  invalid_pin: 'Le PIN doit comporter 4 chiffres.',
  invalid_values: 'Nom (1 à 30 caractères) ou avatar invalide.',
  last_profile: 'Impossible de supprimer le dernier profil.',
  not_found: 'Profil introuvable.',
  unauthorized: 'Session expirée.',
}

async function call(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Result> {
  const { data, error } = await p
  if (error) return { ok: false, error: 'network', message: error.message }
  const r = data as { ok: boolean; error?: string; id?: string }
  if (r.ok) return { ok: true, id: r.id }
  return { ok: false, error: r.error ?? 'unknown', message: ERRORS[r.error ?? ''] ?? 'Opération impossible.' }
}

export const unlockProfile = (s: TypedSupabaseClient, id: string, pin?: string) =>
  call(s.rpc('unlock_viewer_profile', { p_id: id, p_pin: pin ?? null }))

export type ProfileInput = { name: string; avatar_url: string | null; is_kids: boolean }

export const createProfile = (s: TypedSupabaseClient, v: ProfileInput, newPin: string | null, parentalPin?: string) =>
  call(
    s.rpc('create_viewer_profile', {
      p_name: v.name,
      p_avatar_url: v.avatar_url,
      p_is_kids: v.is_kids,
      p_new_pin: newPin,
      p_parental_pin: parentalPin ?? null,
    }),
  )

/** newPin : null = inchangé, '' = supprimer, '1234' = définir */
export const updateProfile = (s: TypedSupabaseClient, id: string, v: ProfileInput, newPin: string | null, pin?: string) =>
  call(
    s.rpc('update_viewer_profile', {
      p_id: id,
      p_name: v.name,
      p_avatar_url: v.avatar_url,
      p_is_kids: v.is_kids,
      p_new_pin: newPin,
      p_pin: pin ?? null,
    }),
  )

export const deleteProfile = (s: TypedSupabaseClient, id: string, pin?: string) =>
  call(s.rpc('delete_viewer_profile', { p_id: id, p_pin: pin ?? null }))

/** Erreurs pour lesquelles redemander un PIN a du sens */
export const NEEDS_PIN = new Set(['wrong_pin', 'parental_pin_required'])

// ───────── Avatars prédéfinis
export const AVATAR_PRESETS: { key: string; className: string }[] = [
  { key: 'red', className: 'from-red-500 to-red-800' },
  { key: 'blue', className: 'from-sky-400 to-blue-700' },
  { key: 'green', className: 'from-emerald-400 to-green-700' },
  { key: 'yellow', className: 'from-amber-300 to-orange-500' },
  { key: 'purple', className: 'from-fuchsia-400 to-purple-700' },
  { key: 'teal', className: 'from-teal-300 to-cyan-700' },
  { key: 'pink', className: 'from-pink-300 to-rose-600' },
  { key: 'slate', className: 'from-slate-400 to-slate-700' },
]
