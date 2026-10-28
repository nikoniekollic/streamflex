// Webhook appelé par la BDD (pg_net, triggers sur titles/title_genres/genres) → purge du cache catalogue.
// Déployé SANS vérification JWT (voir supabase/config.toml) : authentifié par secret partagé (Vault).
import { getSecret } from '../_shared/secrets.ts'
import { invalidateCatalog } from '../_shared/catalog-cache.ts'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  const secret = await getSecret('CATALOG_WEBHOOK_SECRET')
  const given = req.headers.get('x-webhook-secret') ?? ''
  if (!secret || secret.length < 16 || !timingSafeEqual(given, secret)) return new Response('forbidden', { status: 403 })

  const version = await invalidateCatalog()
  let source = ''
  try {
    source = ((await req.json()) as { table?: string }).table ?? ''
  } catch {
    /* corps optionnel */
  }
  console.log('[catalog-webhook] cache purgé', { source, version })
  return new Response(JSON.stringify({ ok: true, version }), { headers: { 'Content-Type': 'application/json' } })
})
