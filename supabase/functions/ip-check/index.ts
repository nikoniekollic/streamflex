// Statut IP du visiteur (utilisé par le middleware TanStack Router à la navigation).
import { corsHeaders, json } from '../_shared/cors.ts'
import { clientIp, lookupBan } from '../_shared/guard.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const ip = clientIp(req)
  const ban = await lookupBan(ip)
  return json({ ip, banned: !!ban, reason: ban?.reason ?? null, expires_at: ban?.expires_at ?? null })
})
