import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { cache } from '../_shared/redis.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned, denyIfNoSubscription } from '../_shared/guard.ts'
import { background } from '../_shared/background.ts'
import { ResolveError, resolveSource, type FailureKind, type MediaSource } from '../_shared/providers.ts'

type Body = { profileId?: string; titleId?: string; episodeId?: string | null; quality?: string; audio?: string; refresh?: boolean; exclude?: string[] }
type CachedStream = { url: string; expiresAt: number; debrid: boolean }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const QUALITY_ORDER = ['2160p', '1080p', '720p', '480p'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // 0. Middleware IP
  const banned = await denyIfBanned(req)
  if (banned) return banned

  // 1. Auth utilisateur
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: auth } = await userClient.auth.getUser()
  if (!auth.user) return json({ error: 'unauthorized' }, 401)

  // 1b. Abonnement actif requis pour lire
  const noSub = await denyIfNoSubscription(userClient)
  if (noSub) return noSub

  // 2. Entrée
  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const { profileId, titleId, episodeId = null, quality, audio, refresh = false, exclude = [] } = body
  if (audio !== undefined && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(audio)) return json({ error: 'invalid_audio' }, 400)
  if (!profileId || !UUID.test(profileId)) return json({ error: 'profile_required' }, 400)
  if (!titleId || !UUID.test(titleId) || (episodeId && !UUID.test(episodeId))) return json({ error: 'invalid_ids' }, 400)

  // 3. Titre visible par l'utilisateur (RLS) → publié
  const { data: title } = await userClient.from('titles').select('id, type').eq('id', titleId).maybeSingle()
  if (!title) return json({ error: 'title_not_found' }, 404)
  // Profil du compte + restriction Enfants (contenus familiaux uniquement)
  const { data: verdict } = await userClient.rpc('can_profile_watch', { p_profile_id: profileId, p_title_id: titleId })
  if (verdict === 'profile_not_found') return json({ error: 'profile_required' }, 403)
  if (verdict === 'kids_restricted') return json({ error: 'kids_restricted' }, 403)

  if (title.type === 'series' && !episodeId) return json({ error: 'episode_required' }, 400)
  if (episodeId) {
    const { data: ep } = await userClient.from('episodes').select('id').eq('id', episodeId).eq('title_id', titleId).maybeSingle()
    if (!ep) return json({ error: 'episode_not_found' }, 404)
  }

  // 4. Sources (service_role : media_sources invisible aux clients)
  const admin = adminClient()
  let q = admin
    .from('media_sources')
    .select('id, provider, file_id, raw_url, quality, priority, audio_languages')
    .or('is_active.is.null,is_active.eq.true')
  q = episodeId ? q.eq('episode_id', episodeId) : q.eq('title_id', titleId)
  const { data: rows, error } = await q.order('priority', { ascending: true }).range(0, 49)
  if (error) return json({ error: 'db_error' }, 500)

  const sources = (rows ?? []) as MediaSource[]
  const qualities = QUALITY_ORDER.filter((qq) => sources.some((s) => s.quality === qq))
  if (sources.length === 0) return json({ error: 'no_source', qualities }, 404)

  const audios = [...new Set(sources.flatMap((s) => s.audio_languages ?? []))].sort()
  const hasAudio = (s: MediaSource) => (audio ? (s.audio_languages ?? []).includes(audio) : true)
  const wanted = quality && qualities.includes(quality as (typeof QUALITY_ORDER)[number]) ? quality : qualities[0]
  const ordered = sources
    .filter((s) => !exclude.includes(s.id))
    .sort((a, b) => {
      const aa = hasAudio(a) ? 0 : 1
      const ab = hasAudio(b) ? 0 : 1
      const qa = a.quality === wanted ? 0 : 1
      const qb = b.quality === wanted ? 0 : 1
      return aa - ab || qa - qb || QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) || a.priority - b.priority
    })

  // Le lecteur a déjà essayé (et exclu) toutes les sources : 409 volontaire = « plus aucune source à tenter »
  if (ordered.length === 0) {
    console.warn('[resolve-stream] aucune source restante après exclusion', { titleId, episodeId, exclude })
    return json({ error: 'all_sources_failed', qualities, reasons: ['excluded'] }, 409)
  }

  // 5. Résolution avec cache + fallback multi-provider
  const errors: string[] = []
  const kinds: FailureKind[] = []
  for (const src of ordered) {
    const key = `stream:v3:${src.id}` // v3 : invalide les URL de bypass HTML mises en cache
    if (!refresh) {
      const hit = await cache.get<CachedStream>(key)
      if (hit && hit.expiresAt > Date.now() + 60_000) {
        await background(admin.rpc('mark_source_streamed', { p_source_id: src.id })) // activité du fichier (monitoring)
        return json({ url: hit.url, provider: src.provider, quality: src.quality, sourceId: src.id, qualities, audios, audio: src.audio_languages ?? [], expiresAt: hit.expiresAt, debrid: !!hit.debrid, cached: true })
      }
    } else {
      await cache.del(key)
    }
    try {
      const r = await resolveSource(src)
      const expiresAt = Date.now() + r.ttl * 1000
      await cache.set(key, { url: r.url, expiresAt, debrid: r.debrid } satisfies CachedStream, r.ttl - 120)
      await background(admin.rpc('mark_source_streamed', { p_source_id: src.id })) // activité du fichier (monitoring)
      await admin.from('media_sources').update({ last_checked_at: new Date().toISOString(), last_status: 200 }).eq('id', src.id)
      return json({ url: r.url, provider: src.provider, quality: src.quality, sourceId: src.id, qualities, audios, audio: src.audio_languages ?? [], expiresAt, debrid: r.debrid, cached: false })
    } catch (e) {
      const status = e instanceof ResolveError ? e.status : 500
      kinds.push(e instanceof ResolveError ? e.kind : 'unknown')
      errors.push(`${src.provider}/${src.quality}: ${(e as Error).message}`)
      await admin.from('media_sources').update({ last_checked_at: new Date().toISOString(), last_status: status }).eq('id', src.id)
    }
  }

  console.error('[resolve-stream] all sources failed', { titleId, episodeId, errors })
  // Code d'erreur le plus parlant pour l'UI
  const code = kinds.length && kinds.every((k) => k === 'offline')
    ? 'source_offline'
    : kinds.some((k) => k === 'auth' || k === 'server_blocked' || k === 'unavailable')
      ? 'debrid_unavailable'
      : kinds.some((k) => k === 'host_busy')
        ? 'host_busy'
        : 'all_sources_failed'
  return json({ error: code, qualities, reasons: [...new Set(kinds)] }, code === 'source_offline' ? 404 : 503)
}

// Toute exception imprévue → réponse JSON 500 avec CORS (jamais de crash nu)
Deno.serve(async (req) => {
  try {
    return await handle(req)
  } catch (e) {
    console.error('[resolve-stream] exception', e)
    return json({ error: 'all_sources_failed', reasons: ['exception'] }, 500)
  }
})
