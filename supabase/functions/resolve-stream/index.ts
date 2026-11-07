import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { cache } from '../_shared/redis.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned, denyIfNoSubscription } from '../_shared/guard.ts'
import { background } from '../_shared/background.ts'
import { ResolveError, resolveSource, type FailureKind, type MediaSource } from '../_shared/providers.ts'

type Body = { profileId?: string; titleId?: string; titleIds?: unknown; refreshIds?: unknown; episodeId?: string | null; quality?: string; audio?: string; refresh?: boolean; exclude?: string[]; preview?: boolean }
type CachedStream = { url: string; expiresAt: number }

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const QUALITY_ORDER = ['2160p', '1080p', '720p', '480p'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Aperçus : résout jusqu'à 24 films d'un coup (une seule vérification d'identité / d'abonnement, deux requêtes SQL),
 * au lieu d'un appel complet par jaquette. Source choisie : la plus légère (qualité la plus basse), sans compter de lecture.
 */
const SHARED_MARGIN_MS = 5 * 60_000 // un lien partagé qui expire dans moins de 5 min n'est plus servi

/** Liens déjà débridés par un autre abonné (table unlocked_links) : aucun nouveau débridage nécessaire. */
async function sharedLinks(ids: string[]): Promise<Map<string, { url: string; expiresAt: number }>> {
  const out = new Map<string, { url: string; expiresAt: number }>()
  if (ids.length === 0) return out
  const { data } = await adminClient()
    .from('unlocked_links')
    .select('title_id, url, expires_at')
    .in('title_id', ids)
    .gt('expires_at', new Date(Date.now() + SHARED_MARGIN_MS).toISOString())
  for (const r of (data ?? []) as { title_id: string; url: string; expires_at: string }[]) out.set(r.title_id, { url: r.url, expiresAt: Date.parse(r.expires_at) })
  return out
}

async function handleBatch(userClient: ReturnType<typeof createClient>, profileId: string, raw: unknown[], refreshIds: unknown): Promise<Response> {
  const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 24)
  if (ids.length === 0) return json({ items: [] })

  // Profil, titres visibles (RLS = publiés, films) et sources : trois requêtes indépendantes, lancées ensemble
  const refresh = new Set(Array.isArray(refreshIds) ? refreshIds.filter((x): x is string => typeof x === 'string') : [])
  const [profRes, titlesRes, srcRes, shared] = await Promise.all([
    userClient.from('viewer_profiles').select('is_kids_profile').eq('id', profileId).maybeSingle(),
    userClient.from('titles').select('id').in('id', ids).eq('type', 'movie'),
    adminClient()
      .from('media_sources')
      .select('id, title_id, provider, file_id, raw_url, quality, priority, audio_languages')
      .in('title_id', ids)
      .or('is_active.is.null,is_active.eq.true')
      .order('priority', { ascending: true })
      .range(0, 499),
    sharedLinks(ids.filter((id) => !refresh.has(id))), // ceux dont le client a vu le lien mourir sont re-débridés
  ])
  const prof = profRes.data
  if (!prof) return json({ error: 'profile_required' }, 403)
  let allowed = (titlesRes.data ?? []).map((t: { id: string }) => t.id)
  if (prof.is_kids_profile) {
    const verdicts = await Promise.all(allowed.map((id) => userClient.rpc('can_profile_watch', { p_profile_id: profileId, p_title_id: id })))
    allowed = allowed.filter((_, i) => verdicts[i].data !== 'kids_restricted' && verdicts[i].data !== 'profile_not_found')
  }
  if (allowed.length === 0) return json({ items: [] })

  if (srcRes.error) return json({ error: 'db_error' }, 500)

  const best = new Map<string, MediaSource & { title_id: string }>()
  const okIds = new Set(allowed)
  const qualitiesOf = new Map<string, string[]>() // toutes les qualités disponibles par film, de la plus haute à la plus basse
  for (const r of ((srcRes.data ?? []) as (MediaSource & { title_id: string })[]).filter((x) => okIds.has(x.title_id))) {
    qualitiesOf.set(r.title_id, [...new Set([...(qualitiesOf.get(r.title_id) ?? []), r.quality])].sort((a, b) => QUALITY_ORDER.indexOf(a as (typeof QUALITY_ORDER)[number]) - QUALITY_ORDER.indexOf(b as (typeof QUALITY_ORDER)[number])))
    const cur = best.get(r.title_id)
    // priorité à la qualité la plus basse (aperçu plus léger), puis à la priorité de la source
    if (!cur || QUALITY_ORDER.indexOf(r.quality) > QUALITY_ORDER.indexOf(cur.quality)) best.set(r.title_id, r)
  }

  const items = (
    await Promise.all(
      [...best.values()].map(async (src) => {
        const hit = shared.get(src.title_id)
        const meta = { quality: src.quality, qualities: qualitiesOf.get(src.title_id) ?? [src.quality] }
        if (hit) return [{ titleId: src.title_id, sourceId: src.id, url: hit.url, clientDebrid: null, shared: true, ...meta }]
        try {
          const r = await resolveSource(src)
          return [{ titleId: src.title_id, sourceId: src.id, url: r.url, clientDebrid: r.clientDebrid ?? null, ...meta }]
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

  // 0-2. IP bannie ? session ? abonnement actif ? corps de la requête ? — quatre vérifications INDÉPENDANTES lancées ensemble
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const [banned, authRes, noSub, parsed] = await Promise.all([
    denyIfBanned(req),
    userClient.auth.getUser(),
    denyIfNoSubscription(userClient),
    req.json().then((b: Body) => b, () => null),
  ])
  if (banned) return banned
  if (!authRes.data.user) return json({ error: 'unauthorized' }, 401)
  if (noSub) return noSub
  if (!parsed) return json({ error: 'invalid_body' }, 400)
  const body: Body = parsed
  const { profileId, titleId, episodeId = null, quality, audio, refresh = false, exclude = [], preview = false } = body
  if (audio !== undefined && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(audio)) return json({ error: 'invalid_audio' }, 400)
  if (!profileId || !UUID.test(profileId)) return json({ error: 'profile_required' }, 400)
  if (Array.isArray(body.titleIds)) return await handleBatch(userClient, profileId, body.titleIds, body.refreshIds)
  if (!titleId || !UUID.test(titleId) || (episodeId && !UUID.test(episodeId))) return json({ error: 'invalid_ids' }, 400)

  // 3. Titre visible par l'utilisateur (RLS) → publié ; droits du profil (Enfants) ; sources — en parallèle pour un film
  const admin = adminClient()
  const sourcesQuery = () =>
    admin
      .from('media_sources')
      .select('id, provider, file_id, raw_url, quality, priority, audio_languages')
      .or('is_active.is.null,is_active.eq.true')
      .eq(episodeId ? 'episode_id' : 'title_id', (episodeId ?? titleId) as string)
      .order('priority', { ascending: true })
      .range(0, 49)
  const [titleRes, verdictRes, earlySources] = await Promise.all([
    userClient.from('titles').select('id, type').eq('id', titleId).maybeSingle(),
    userClient.rpc('can_profile_watch', { p_profile_id: profileId, p_title_id: titleId }),
    episodeId ? Promise.resolve(null) : sourcesQuery(),
  ])
  const title = titleRes.data
  if (!title) return json({ error: 'title_not_found' }, 404)
  const verdict = verdictRes.data
  if (verdict === 'profile_not_found') return json({ error: 'profile_required' }, 403)
  if (verdict === 'kids_restricted') return json({ error: 'kids_restricted' }, 403)

  if (title.type === 'series' && !episodeId) return json({ error: 'episode_required' }, 400)
  if (episodeId) {
    const { data: ep } = await userClient.from('episodes').select('id').eq('id', episodeId).eq('title_id', titleId).maybeSingle()
    if (!ep) return json({ error: 'episode_not_found' }, 404)
  }

  // 4. Sources (service_role : media_sources invisible aux clients) — déjà lues pour un film, après la vérification de l'épisode sinon
  const { data: rows, error } = earlySources ?? (await sourcesQuery())
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

  // 4b. Film : un autre abonné a peut-être déjà débridé ce fichier (lien partagé, sans lien à l'IP) → rien à débrider
  if (!episodeId && !refresh && ordered.length > 0) {
    const hit = (await sharedLinks([titleId])).get(titleId)
    if (hit) {
      const src = ordered[0]
      if (!preview) await background(admin.rpc('mark_source_streamed', { p_source_id: src.id }))
      return json({ url: hit.url, provider: src.provider, quality: src.quality, sourceId: src.id, qualities, audios, audio: src.audio_languages ?? [], expiresAt: hit.expiresAt, cached: true, shared: true })
    }
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
