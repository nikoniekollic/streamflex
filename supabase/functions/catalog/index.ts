// Catalogue mis en cache (Redis, TTL 1 h) : accueil + recherche ; invalidation (admin ou webhook BDD).
import { corsHeaders } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned } from '../_shared/guard.ts'
import { catalogKey, invalidateCatalog, remember } from '../_shared/catalog-cache.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const HOME_LIMIT = 60
const SEARCH_PAGE = 30

type Op =
  | { op: 'home'; kids?: boolean }
  | { op: 'search'; q?: string; type?: 'movie' | 'series'; genre?: string; page?: number; kids?: boolean }
  | { op: 'invalidate' }

function respond(body: unknown, status = 200, cacheState?: 'HIT' | 'MISS') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Expose-Headers': 'X-Cache',
      ...(cacheState ? { 'X-Cache': cacheState } : {}),
    },
  })
}

/** Rôle du JWT (signature déjà vérifiée par la passerelle Supabase — ne PAS déployer avec --no-verify-jwt). */
function jwtRole(req: Request): string | null {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const part = token?.split('.')[1]
  if (!part) return null
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

// ───────── Chargeurs (service_role + filtre explicite is_published : jamais de brouillon en cache)
async function loadHome(kids: boolean) {
  const db = adminClient()
  // catalog_titles filtre is_published (+ is_kids_safe si kids) en dur
  const [titles, genres] = await Promise.all([
    db.rpc('catalog_titles', { p_kids: kids, p_limit: HOME_LIMIT }),
    kids
      ? db.from('genres').select('slug, name').eq('is_family', true).order('name').range(0, 199)
      : db.from('genres').select('slug, name').order('name').range(0, 199),
  ])
  if (titles.error) throw titles.error
  if (genres.error) throw genres.error
  return { titles: titles.data, genres: genres.data }
}

async function loadSearch(p: { q: string | null; type: string | null; genre: string | null; page: number; kids: boolean }) {
  const db = adminClient()
  const { data, error } = await db.rpc('search_titles', {
    p_q: p.q,
    p_type: p.type,
    p_genre: p.genre,
    p_limit: p.page * SEARCH_PAGE,
    p_offset: 0,
    p_kids: p.kids,
  })
  if (error) throw error
  const genres = await db.from('genres').select('slug, name').order('name').range(0, 199)
  return { rows: data, genres: genres.data ?? [] } // search_titles filtre `t.is_published` en dur
}

function normSearch(b: Extract<Op, { op: 'search' }>) {
  const q = typeof b.q === 'string' ? b.q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100) : ''
  const page = Number.isInteger(b.page) && (b.page as number) >= 1 && (b.page as number) <= 20 ? (b.page as number) : 1
  return {
    q: q || null,
    type: b.type === 'movie' || b.type === 'series' ? b.type : null,
    genre: typeof b.genre === 'string' && /^[a-z0-9-]{1,60}$/.test(b.genre) ? b.genre : null,
    page,
    kids: b.kids === true,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'method_not_allowed' }, 405)

  let body: Op
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'invalid_body' }, 400)
  }

  // ── Invalidation manuelle : admin connecté (le webhook BDD passe par `catalog-webhook`)
  if (body.op === 'invalidate') {
    let allowed = false
    if (jwtRole(req) === 'authenticated') {
      const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization')! } },
      })
      const { data } = await user.rpc('is_admin')
      allowed = data === true
    }
    if (!allowed) return respond({ error: 'forbidden' }, 403)
    const version = await invalidateCatalog()
    return respond({ ok: true, version })
  }

  // ── Lecture : utilisateurs connectés uniquement, IP non bannie
  if (jwtRole(req) !== 'authenticated') return respond({ error: 'unauthorized' }, 401)
  const banned = await denyIfBanned(req)
  if (banned) return banned

  try {
    if (body.op === 'home') {
      const kids = body.kids === true
      const { data, hit } = await remember(await catalogKey(kids ? 'home-kids' : 'home'), () => loadHome(kids))
      return respond(data, 200, hit ? 'HIT' : 'MISS')
    }
    if (body.op === 'search') {
      const p = normSearch(body)
      const { data, hit } = await remember(await catalogKey('search', p), () => loadSearch(p))
      return respond(data, 200, hit ? 'HIT' : 'MISS')
    }
  } catch (e) {
    console.error('[catalog]', e)
    return respond({ error: 'db_error' }, 500)
  }
  return respond({ error: 'unknown_op' }, 400)
})
