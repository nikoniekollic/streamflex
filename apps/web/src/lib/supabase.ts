import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { env } from './env'

export type TypedSupabaseClient = SupabaseClient<Database>

const BANNED_PATH = '/banned'

/**
 * fetch « middleware » : toute réponse 403 `ip_banned` (PostgREST pre-request `check_request`
 * ou Edge Functions) redirige vers /banned, quelle que soit la page.
 */
const guardedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  if (res.status === 403 && typeof window !== 'undefined' && window.location.pathname !== BANNED_PATH) {
    try {
      const body = (await res.clone().json()) as { message?: string; error?: string }
      if (body?.message === 'ip_banned' || body?.error === 'ip_banned') window.location.replace(BANNED_PATH)
    } catch {
      /* corps non JSON */
    }
  }
  return res
}

export const supabase: TypedSupabaseClient = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  global: { fetch: guardedFetch },
})
