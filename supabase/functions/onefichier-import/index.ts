// Explorateur + import du compte 1fichier (admin uniquement).
//  action 'ls'     : liste un dossier du compte (1 appel API régulé, voie « admin »)
//  action 'import' : crée un film + sa source par fichier ; fichiers déjà en base ignorés (aucun appel API)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned } from '../_shared/guard.ts'
import { LANE_ADMIN, OnefichierError, onefichierCall } from '../_shared/onefichier.ts'

const VIDEO_EXT = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts'])
const MAX_IMPORT = 100

type RemoteFile = { id: string; name: string; size: number | null; date: string | null; ctype?: string | null }
type Result = { id: string; name: string; status: 'success' | 'ignored' | 'failed'; reason?: string }

function fileIdOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = url.match(/^https?:\/\/(?:([A-Za-z0-9]{4,32})\.1fichier\.com\/?|(?:www\.)?1fichier\.com\/\?([A-Za-z0-9]{4,32}))/)
  return m ? (m[1] ?? m[2]) : null
}

const ext = (name: string) => (name.includes('.') ? (name.split('.').pop()?.toLowerCase() ?? '') : '')
const isVideo = (f: { name: string; ctype?: string | null }) => VIDEO_EXT.has(ext(f.name)) || /^video\//i.test(f.ctype ?? '')

function cleanTitle(filename: string): string {
  const base = filename.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (base || filename).slice(0, 200)
}

function slugFor(title: string, fileId: string): string {
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  const tail = fileId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  return `${base || 'video'}-${tail}`
}

function guessQuality(name: string): '480p' | '720p' | '1080p' | '2160p' {
  const n = name.toLowerCase()
  if (/2160|\b4k\b|uhd/.test(n)) return '2160p'
  if (/1080/.test(n)) return '1080p'
  if (/720/.test(n)) return '720p'
  if (/480|576/.test(n)) return '480p'
  return '1080p'
}

async function knownIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (ids.length === 0) return out
  const { data } = await adminClient().from('media_sources').select('file_id').eq('provider', 'onefichier').in('file_id', ids)
  for (const r of data ?? []) if (r.file_id) out.add(r.file_id)
  return out
}

async function listFolder(folderId: number) {
  // 1) sous-dossiers (et fichiers si l'API les inclut déjà)
  const body = await onefichierCall('folder/ls.cgi', { folder_id: folderId }, LANE_ADMIN)
  let rawItems: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : Array.isArray(body.files) ? body.files : []
  const rawFolders: Record<string, unknown>[] = Array.isArray(body.sub_folders) ? body.sub_folders : Array.isArray(body.folders) ? body.folders : []
  const hadItems = 'items' in body || 'files' in body
  const filesBody: { keys: string[] } = { keys: [] }
  // 2) fichiers du dossier : appel dédié (file/ls.cgi) seulement si le premier n'en contenait pas
  if (!hadItems) {
    try {
      const fb = await onefichierCall('file/ls.cgi', { folder_id: folderId }, LANE_ADMIN)
      filesBody.keys = Object.keys(fb)
      rawItems = Array.isArray(fb.items) ? fb.items : Array.isArray(fb.files) ? fb.files : []
    } catch (e) {
      // dossier sans fichier : 1fichier peut répondre « KO » plutôt qu'une liste vide
      if (!(e instanceof OnefichierError) || e.failure !== 'offline') throw e
    }
  }
  if (!hadItems && filesBody.keys.length === 0 && rawFolders.length === 0 && !('sub_folders' in body) && !('folders' in body)) {
    console.error('[onefichier-import] réponse inattendue', Object.keys(body))
    throw new OnefichierError('unavailable', `Réponse 1fichier inattendue (champs : ${Object.keys(body).join(', ') || 'aucun'})`, 502)
  }
  const files: RemoteFile[] = []
  for (const it of rawItems) {
    const id = fileIdOf(it.url)
    if (!id) continue
    const ct = it['content-type'] ?? it.content_type ?? it.contentType
    files.push({ id, name: String(it.filename ?? it.name ?? id), size: Number(it.size) > 0 ? Number(it.size) : null, date: typeof it.date === 'string' ? it.date : null, ctype: typeof ct === 'string' ? ct : null })
  }
  const folders = rawFolders
    .map((f) => ({ id: Number(f.id), name: String(f.name ?? f.id), date: typeof f.create_date === 'string' ? f.create_date : null }))
    .filter((f) => Number.isInteger(f.id))
  const known = await knownIds(files.map((f) => f.id))
  const debug = {
    keys: [...Object.keys(body), ...filesBody.keys.map((k) => `file/ls:${k}`)],
    items: rawItems.length,
    withId: files.length,
    sampleKeys: rawItems[0] ? Object.keys(rawItems[0]) : [],
    sampleUrl: rawItems[0] ? String(rawItems[0].url ?? '').slice(0, 60) : null,
  }
  console.log('[onefichier-import] ls', folderId, JSON.stringify(debug))
  return { folderName: String(body.name ?? ''), folders, files: files.map((f) => ({ ...f, known: known.has(f.id), video: isVideo(f) })), debug }
}

type Model = { id: string; image_url: string | null }

/** Trouve ou crée le modèle portant le nom du dossier. */
async function ensureModel(name: string): Promise<Model | null> {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!clean) return null
  const db = adminClient()
  await db.from('models').upsert({ name: clean }, { onConflict: 'name', ignoreDuplicates: true })
  const { data } = await db.from('models').select('id, image_url').eq('name', clean).maybeSingle()
  return data ?? null
}

async function importOne(f: RemoteFile, publish: boolean, model: Model | null): Promise<Result> {
  const db = adminClient()
  const title = cleanTitle(f.name)
  const { data: t, error: te } = await db
    .from('titles')
    .insert({
      type: 'movie',
      slug: slugFor(title, f.id),
      title,
      is_published: publish,
      published_at: publish ? new Date().toISOString() : null,
      ...(model ? { model_id: model.id, poster_url: model.image_url ? `${model.image_url}#model` : null } : {}),
    })
    .select('id')
    .single()
  if (te || !t) return { id: f.id, name: f.name, status: 'failed', reason: te?.message ?? 'création du titre impossible' }
  const { error: se } = await db.from('media_sources').insert({
    title_id: t.id,
    provider: 'onefichier',
    file_id: f.id,
    quality: guessQuality(f.name),
    size_bytes: f.size,
    container: ext(f.name).slice(0, 8) || null,
    priority: 10,
    is_active: true,
  })
  if (se) {
    await db.from('titles').delete().eq('id', t.id) // pas de titre orphelin
    // doublon créé en parallèle = ignoré, pas un échec
    return se.code === '23505' ? { id: f.id, name: f.name, status: 'ignored', reason: 'déjà importé' } : { id: f.id, name: f.name, status: 'failed', reason: se.message }
  }
  return { id: f.id, name: f.name, status: 'success' }
}

async function importFiles(files: RemoteFile[], publish: boolean, modelName: string | null): Promise<Result[]> {
  const model = modelName ? await ensureModel(modelName) : null
  const known = await knownIds(files.map((f) => f.id))
  const seen = new Set<string>()
  const results: Result[] = []
  for (const f of files) {
    if (known.has(f.id) || seen.has(f.id)) {
      results.push({ id: f.id, name: f.name, status: 'ignored', reason: 'déjà importé' })
      continue
    }
    seen.add(f.id)
    if (!isVideo(f)) {
      results.push({ id: f.id, name: f.name, status: 'ignored', reason: `fichier non vidéo (${ext(f.name) || 'sans extension'})` })
      continue
    }
    results.push(await importOne(f, publish, model))
  }
  return results
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const banned = await denyIfBanned(req)
  if (banned) return banned

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin } = await user.rpc('is_admin')
  if (isAdmin !== true) return json({ error: 'forbidden' }, 403)

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  try {
    if (body.action === 'ls') {
      const folderId = Number(body.folder_id ?? 0)
      if (!Number.isInteger(folderId) || folderId < 0) return json({ error: 'invalid_folder' }, 400)
      return json(await listFolder(folderId))
    }
    if (body.action === 'import') {
      const input: unknown[] = Array.isArray(body.files) ? body.files : []
      if (input.length === 0 || input.length > MAX_IMPORT) return json({ error: 'invalid_files', max: MAX_IMPORT }, 400)
      const files: RemoteFile[] = []
      for (const x of input as Record<string, unknown>[]) {
        const id = typeof x.id === 'string' && /^[A-Za-z0-9]{4,32}$/.test(x.id) ? x.id : null
        if (!id) return json({ error: 'invalid_file_id' }, 400)
        files.push({ id, name: String(x.name ?? id).slice(0, 300), size: Number(x.size) > 0 ? Number(x.size) : null, date: null, ctype: typeof x.ctype === 'string' ? x.ctype : null })
      }
      const modelName = typeof body.model === 'string' && body.model.trim() ? body.model : null
      return json({ results: await importFiles(files, body.publish === true, modelName) })
    }
    return json({ error: 'invalid_action' }, 400)
  } catch (e) {
    if (e instanceof OnefichierError) return json({ error: e.failure, message: e.message }, e.status)
    console.error('[onefichier-import]', e)
    return json({ error: 'internal', message: (e as Error).message }, 500)
  }
})
