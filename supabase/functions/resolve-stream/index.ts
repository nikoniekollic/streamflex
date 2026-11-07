import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { cache } from '../_shared/redis.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned, denyIfNoSubscription } from '../_shared/guard.ts'
import { background } from '../_shared/background.ts'
import { ResolveError, resolveSource, type FailureKind, type MediaSource } from '../_shared/providers.ts'

type Body = { profileId?: string; titleId?: string; titleIds?: unknown; episodeId?: string | null; quality?: string; audio?: string; refresh?: boolean; exclude?: string[]; preview?: boolean }
type CachedStream = { url: string; expiresAt: number }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const QUALITY_ORDER = ['2160p', '1080p', '720p', '480p'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Aperçus : résout jusqu'à 24 films d'un coup (une seule vérification d'identité / d'abonnement, deux requêtes SQL),
 * au lieu d'un appel complet par jaquette. Source choisie : la plus légère (qualité la plus basse), sans compter de lecture.
 */
async function handleBatch(userClient: ReturnType<typeof createClient>, profileId: string, raw: unknown[]): Promise<Response> {
  const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 24)
  if (ids.length === 0) return json({ items: [] })

  const { data: prof } = await userClient.from('viewer_profiles').select('is_kids_profile').eq('id', profileId).maybeSingle()
  if (!prof) return json({ error: 'profile_required' }, 403)

  // Titres visibles par l'utilisateur (RLS = publiés), films seulement
  const { data: titles } = await userClient.from('titles').select('id').in('id', ids).eq('type', 'movie')
  let allowed = (titles ?? []).map((t: { id: string }) => t.id)
  if (prof.is_kids_profile) {
    const verdicts = await Promise.all(allowed.map((id) => userClient.rpc('can_profile_watch', { p_profile_id: profileId, p_title_id: id })))
    allowed = allowed.filter((_, i) => verdicts[i].data !== 'kids_restricted' && verdicts[i].data !== 'profile_not_found')
  }
  if (allowed.length === 0) return json({ items: [] })

  const { data: rows, error } = await adminClient()
    .from('media_sources')
    .select('id, title_id, provider, file_id, raw_url, quality, priority, audio_languages')
    .in('title_id', allowed)
    .or('is_active.is.null,is_active.eq.true')
    .order('priority', { ascending: true })
    .range(0, 499)
  if (error) return json({ error: 'db_error' }, 500)

  const best = new Map<string, MediaSource & { title_id: string }>()
  for (const r of (rows ?? []) as (MediaSource & { title_id: string })[]) {
    const cur = best.get(r.title_id)
    // priorité à la qualité la plus basse (aperçu plus léger), puis à la priorité de la source
    if (!cur || QUALITY_ORDER.indexOf(r.quality) > QUALITY_ORDER.indexOf(cur.quality)) best.set(r.title_id, r)
  }

  const items = (
    await Promise.all(
      [...best.values()].map(async (src) => {
        try {
          const r = await resolveSource(src)
          return [{ titleId: src.title_id, sourceId: src.id, url: r.url, clientDebrid: r.clientDebrid ?? null }]
        } catch (e) {
          console.warn('[resolve-stream] aperçu ignoré', src.title_id, (e as Error).message)
          return []
        }
      }),
    )
  ).flat()
  return json({ items })
}

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
  const { profileId, titleId, episodeId = null, quality, audio, refresh = false, exclude = [], preview = false } = body
  if (audio !== undefined && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(audio)) return json({ error: 'invalid_audio' }, 400)
  if (!profileId || !UUID.test(profileId)) return json({ error: 'profile_required' }, 400)
  if (Array.isArray(body.titleIds)) return await handleBatch(userClient, profileId, body.titleIds)
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

  // Toutes les sources ont été exclues par le lecteur : on réessaie la liste complète (pas de 409).
  // Le lecteur plafonne lui-même ses réessais, donc aucune boucle possible.
  if (ordered.length === 0) {
    console.warn('[resolve-stream] exclusion de toutes les sources → nouvelle tentative sur la liste complète', { titleId, episodeId })
    ordered.push(...sources.slice().sort((a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality) || a.priority - b.priority))
  }

  // 5. Résolution avec cache + fallback multi-provider
  const errors: string[] = []
  const kinds: FailureKind[] = []
  for (const src of ordered) {
    const key = `stream:v6:${src.id}`
    if (!refresh) {
      const hit = await cache.get<CachedStream>(key)
      if (hit && hit.expiresAt > Date.now() + 60_000) {
        if (!preview) await background(admin.rpc('mark_source_streamed', { p_source_id: src.id })) // activité du fichier (monitoring)
        return json({ url: hit.url, provider: src.provider, quality: src.quality, sourceId: src.id, qualities, audios, audio: src.audio_languages ?? [], expiresAt: hit.expiresAt, cached: true })
      }
    } else {
      await cache.del(key)
    }
    try {
      const r = await resolveSource(src, { refresh })
      if (r.clientDebrid) {
        // Débridage côté navigateur : rien à mettre en cache (la clé ne doit pas traîner dans Redis)
        if (!preview) await background(admin.rpc('mark_source_streamed', { p_source_id: src.id }))
        return json({ url: '', clientDebrid: r.clientDebrid, provider: src.provider, quality: src.quality, sourceId: src.id, qualities, audios, audio: src.audio_languages ?? [], expiresAt: Date.now() + 2 * 3600 * 1000, cached: false })
      }
      const expiresAt = Date.now() + r.ttl * 1000
      await cache.set(key, { url: r.url, expiresAt } satisfies CachedStream, r.ttl - 120)
      if (!preview) await background(admin.rpc('mark_source_streamed', { p_source_id: src.id })) // activité du fichier (monitoring)
      await admin.from('media_sources').update({ last_checked_at: new Date().toISOString(), last_status: 200 }).eq('id', src.id)
      return json({ url: r.url, provider: src.provider, quality: src.quality, sourceId: src.id, qualities, audios, audio: src.audio_languages ?? [], expiresAt, cached: false })
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
    : kinds.some((k) => k === 'auth' || k === 'unavailable')
      ? 'source_unavailable'
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
