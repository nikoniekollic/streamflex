import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

let admin: SupabaseClient | null = null

/** Client service_role (singleton) — jamais exposé au navigateur. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}
