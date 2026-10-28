// Débridage d'un lien brut — RÉSERVÉ AUX ADMINS (test de source dans le panel).
// Les utilisateurs passent par resolve-stream (lien brut jamais exposé au navigateur).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { DEBRID_MESSAGES, DebridError, isDebridHost, unlock } from '../_shared/alldebrid.ts'
import { denyIfBanned } from '../_shared/guard.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const banned = await denyIfBanned(req)
  if (banned) return banned

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await client.auth.getUser()
  if (!auth.user) return json({ error: 'unauthorized' }, 401)
  const { data: isAdmin } = await client.rpc('is_admin')
  if (!isAdmin) return json({ error: 'forbidden' }, 403)

  let link: unknown
  try {
    ;({ link } = await req.json())
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (typeof link !== 'string' || !/^https?:\/\/\S+$/i.test(link) || link.length > 2048) {
    return json({ error: 'invalid_link' }, 400)
  }
  if (!isDebridHost(link)) return json({ error: 'unsupported', message: DEBRID_MESSAGES.unsupported }, 422)

  try {
    const u = await unlock(link)
    return json({ url: u.url, filename: u.filename ?? null, filesize: u.filesize ?? null, host: u.host ?? null })
  } catch (e) {
    const d = e instanceof DebridError ? e : new DebridError('unknown', 'EXCEPTION', String(e))
    return json({ error: d.failure, code: d.code, message: DEBRID_MESSAGES[d.failure] }, d.failure === 'offline' ? 404 : 502)
  }
})
