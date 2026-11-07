// Explorateur + import du compte 1fichier (admin uniquement).
//  action 'ls'     : liste un dossier du compte (1 appel API régulé, voie « admin »)
//  action 'import' : crée un film + sa source par fichier ; fichiers déjà en base ignorés (aucun appel API)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned } from '../_shared/guard.ts'
import { background } from '../_shared/background.ts'
import { LANE_ADMIN, LANE_WATCH, OnefichierError, onefichierCall, type Lane } from '../_shared/onefichier.ts'

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
  const db = adminClient()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('media_sources').select('file_id').eq('provider', 'onefichier').in('file_id', ids.slice(i, i + 200))
    for (const r of data ?? []) if (r.file_id) out.add(r.file_id)
  }
  return out
}

const CAP = 5000 // 1fichier : « listing limité à 5 000 résultats et 1 requête par dossier toutes les 30 s » (sans pagination)
const FOLDER_GAP_S = 30

/** Garde 1fichier : au plus 1 listing par dossier toutes les 30 s (partagé entre instances). */
async function guardFolder(folderId: number) {
  const db = adminClient()
  const name = `ls:${folderId}`
  const { data } = await db.from('api_governor').select('last_call_at').eq('name', name).maybeSingle()
  const last = data?.last_call_at ? new Date(data.last_call_at).getTime() : 0
  const wait = Math.ceil((last + FOLDER_GAP_S * 1000 - Date.now()) / 1000)
  if (wait > 0) throw new OnefichierError('host_busy', `Ce dossier vient d'être listé : 1fichier n'autorise qu'une requête par dossier toutes les 30 s. Réessaie dans ${wait} s.`, 429)
  await db.from('api_governor').upsert({ name, last_call_at: new Date().toISOString() })
}

async function listFolder(folderId: number, annotate = true, lane: Lane = LANE_ADMIN) {
  await guardFolder(folderId)
  // 1) sous-dossiers (et fichiers si l'API les inclut déjà)
  const body = await onefichierCall('folder/ls.cgi', { folder_id: folderId }, lane)
  let rawItems: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : Array.isArray(body.files) ? body.files : []
  const rawFolders: Record<string, unknown>[] = Array.isArray(body.sub_folders) ? body.sub_folders : Array.isArray(body.folders) ? body.folders : []
  const hadItems = 'items' in body || 'files' in body
  const filesBody: { keys: string[] } = { keys: [] }
  // 2) fichiers du dossier : appel dédié (file/ls.cgi) seulement si le premier n'en contenait pas
  if (rawItems.length === 0) {
    try {
      const fb = await onefichierCall('file/ls.cgi', { folder_id: folderId }, lane)
      filesBody.keys = Object.keys(fb)
      rawItems = Array.isArray(fb.items) ? fb.items : Array.isArray(fb.files) ? fb.files : []
    } catch (e) {
      // dossier sans fichier : 1fichier peut répondre « KO » plutôt qu'une liste vide
      if (!(e instanceof OnefichierError) || e.failure !== 'offline') throw e
    }
  }
  const capped = rawItems.length >= CAP
  if (!hadItems && filesBody.keys.length === 0 && rawFolders.length === 0 && !('sub_folders' in body) && !('folders' in body)) {
    console.error('[onefichier-import] réponse inattendue', Object.keys(body))
    throw new OnefichierError('unavailable', `Réponse 1fichier inattendue (champs : ${Object.keys(body).join(', ') || 'aucun'})`, 502)
  }
  const files: RemoteFile[] = []
  for (const it of rawItems) {
    const link = it.url ?? it.link ?? it.download_url ?? Object.values(it).find((v) => typeof v === 'string' && /1fichier\.com/.test(v))
    const id = fileIdOf(link)
    if (!id) continue
    const ct = it['content-type'] ?? it.content_type ?? it.contentType
    files.push({ id, name: String(it.filename ?? it.name ?? id), size: Number(it.size) > 0 ? Number(it.size) : null, date: typeof it.date === 'string' ? it.date : null, ctype: typeof ct === 'string' ? ct : null })
  }
  const folders = rawFolders
    .map((f) => ({ id: Number(f.id), name: String(f.name ?? f.id), date: typeof f.create_date === 'string' ? f.create_date : null }))
    .filter((f) => Number.isInteger(f.id))
  const known = annotate ? await knownIds(files.map((f) => f.id)) : new Set<string>()
  const debug = {
    keys: [...Object.keys(body), ...filesBody.keys.map((k) => `file/ls:${k}`)],
    items: rawItems.length,
    withId: files.length,
    sampleKeys: rawItems[0] ? Object.keys(rawItems[0]) : [],
    sampleUrl: rawItems[0] ? String(rawItems[0].url ?? '').slice(0, 60) : null,
    sample: rawItems[0] ? JSON.stringify(rawItems[0]).slice(0, 400) : null,
    foldersRaw: rawFolders.length,
    hadItems,
  }
  console.log('[onefichier-import] ls', folderId, JSON.stringify(debug))
  return { folderName: String(body.name ?? ''), folders, files: files.map((f) => ({ ...f, known: known.has(f.id), video: isVideo(f) })), debug, capped }
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

// ───────── Import récursif : job persistant, UN dossier par « tick », relance automatique
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const BATCH_ROWS = 500
const MAX_TRIES = 3

type QueueEntry = { id: number; name: string; model: string | null; depth?: number; tries?: number }

// Dossiers « génériques » (video, photos…) : jamais un modèle, ils héritent du dossier parent (miroir SQL : is_generic_folder)
const GENERIC_FOLDER =
  /^(videos?|vid[eé]os?|vids?|clips?|movies?|films?|photos?|pics?|images?|media|medias|m[eé]dias?|new|news|nouveau|nouveaux|nouveaut[eé]s?|hd|fhd|uhd|4k|1080p?|720p?|480p?|full ?hd|originaux?|originals?|sources?|exclusive?s?|bonus|divers|autres?|misc|other|archives?|old|part ?[0-9]+|[0-9]{4})$/i

/** Nom du modèle d'un sous-dossier : seul le dossier situé juste sous la racine est un modèle, le reste en hérite. */
function childModel(parent: QueueEntry, childName: string, mode: string): string | null {
  const depth = parent.depth ?? 0
  if (GENERIC_FOLDER.test(childName.trim()) || mode === 'inherit' || depth >= 1) return parent.model
  return childName
}

/** Relance le job : le tick répond 202 tout de suite, donc aucun appel imbriqué. */
function kick(jobId: string): Promise<void> {
  return background(
    fetch(`${SUPABASE_URL}/functions/v1/onefichier-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: ANON_KEY },
      body: JSON.stringify({ action: 'job_tick', job_id: jobId }),
    }).then((r) => r.body?.cancel()),
  )
}

function retrySeconds(message: string): number {
  const m = message.match(/(\d+)\s*s\b/)
  return Math.min(Math.max(m ? Number(m[1]) + 2 : 60, 10), 600)
}

/** Importe les vidéos d'un dossier par lots (titres + sources) ; les fichiers déjà connus sont ignorés. */
async function importVideos(videos: { id: string; name: string; size: number | null }[], modelName: string | null, publish: boolean, reassign = false) {
  const db = adminClient()
  let imported = 0
  let ignored = 0
  let failed = 0
  let fixed = 0
  const model = modelName && videos.length > 0 && modelName !== 'Racine' ? await ensureModel(modelName) : null
  for (let i = 0; i < videos.length; i += BATCH_ROWS) {
    const rows = videos.slice(i, i + BATCH_ROWS).map((f) => {
      const title = cleanTitle(f.name)
      return { id: f.id, slug: slugFor(title, f.id), title, quality: guessQuality(f.name), size: f.size, container: ext(f.name) }
    })
    const { data, error } = await db.rpc('import_onefichier_batch', {
      p_files: rows,
      p_publish: publish,
      p_model_id: model?.id ?? null,
      p_poster: model?.image_url ? `${model.image_url}#model` : null,
      p_reassign: reassign,
    })
    if (error) failed += rows.length
    else {
      imported += Number(data?.imported ?? 0)
      ignored += Number(data?.ignored ?? 0)
      fixed += Number(data?.fixed ?? 0)
    }
  }
  return { imported, ignored, failed, fixed }
}

/** Traite UN dossier. Retourne true s'il reste du travail à enchaîner tout de suite. */
async function tickOnce(jobId: string): Promise<boolean> {
  const db = adminClient()
  const { data: locked } = await db.rpc('import_job_lock', { p_job: jobId, p_seconds: 150 })
  if (locked !== true) return false
  const { data: job } = await db.from('import_jobs').select('*').eq('id', jobId).single()
  if (!job) return false
  const queue = (Array.isArray(job.queue) ? job.queue : []) as QueueEntry[]
  const done = (patch: Record<string, unknown>) =>
    db.from('import_jobs').update({ locked_until: null, updated_at: new Date().toISOString(), ...patch }).eq('id', jobId)

  if (queue.length === 0) {
    await done({ status: 'completed', completed_at: new Date().toISOString(), current_folder: null, last_message: 'Terminé' })
    return false
  }
  const entry = queue[0]
  const rest = queue.slice(1)
  try {
    const listing = await listFolder(entry.id, false)
    const videos = listing.files.filter((f) => f.video)
    const r = await importVideos(videos, job.model_per_folder ? entry.model : null, job.publish === true, job.reassign === true)
    const imported = r.imported
    const ignored = listing.files.length - videos.length + r.ignored
    const failed = r.failed
    const subs: QueueEntry[] = listing.folders.map((f) => ({ id: f.id, name: f.name, model: childModel(entry, f.name, job.model_mode), depth: (entry.depth ?? 0) + 1 }))
    const next = [...rest, ...subs]
    const finished = next.length === 0
    await done({
      queue: next,
      status: finished ? 'completed' : 'running',
      completed_at: finished ? new Date().toISOString() : null,
      folders_done: job.folders_done + 1,
      files_seen: Number(job.files_seen) + listing.files.length,
      imported: Number(job.imported) + imported,
      ignored: Number(job.ignored) + ignored,
      failed: Number(job.failed) + failed,
      current_folder: finished ? null : next[0].name,
      resume_at: null,
      last_message: `${entry.name}${entry.model && entry.model !== entry.name ? ` (modèle ${entry.model})` : ''} : ${imported} importés${r.fixed ? `, ${r.fixed} corrigés` : ''}, ${ignored} ignorés${listing.capped ? ' — ⚠ dossier plafonné à 5 000 (répartis en sous-dossiers)' : ''}${failed ? `, ${failed} échecs` : ''}`,
    })
    return !finished
  } catch (e) {
    const msg = (e as Error).message
    if (e instanceof OnefichierError && e.failure === 'auth') {
      await done({ status: 'error', last_message: msg }) // disjoncteur / clé invalide : on s'arrête
      return false
    }
    const tries = (entry.tries ?? 0) + 1
    const transient = e instanceof OnefichierError && (e.failure === 'host_busy' || e.failure === 'unavailable')
    if (transient && tries < MAX_TRIES * 3) {
      const wait = retrySeconds(msg)
      await done({
        queue: [{ ...entry, tries }, ...rest],
        status: 'waiting',
        resume_at: new Date(Date.now() + wait * 1000).toISOString(),
        last_message: `${entry.name} : en attente de 1fichier (${wait} s) — ${msg}`,
      })
      return false // repris par le battement de cœur de l'interface (job_status)
    }
    console.error('[onefichier-import] dossier ignoré', entry.id, msg)
    await done({
      queue: rest,
      status: rest.length ? 'running' : 'completed',
      completed_at: rest.length ? null : new Date().toISOString(),
      folders_done: job.folders_done + 1,
      failed: Number(job.failed) + 1,
      last_message: `${entry.name} : ignoré — ${msg}`,
    })
    return rest.length > 0
  }
}

/** Enchaîne les dossiers pendant ~90 s, puis relance un nouveau tick pour la suite. */
async function runTick(jobId: string) {
  const t0 = Date.now()
  while (Date.now() - t0 < 90_000) {
    if (!(await tickOnce(jobId))) return
  }
  await kick(jobId)
}

/** Relance les jobs actifs bloqués (aucun tick en cours, pause terminée). */
async function resumeStalled() {
  const nowIso = new Date().toISOString()
  const { data } = await adminClient()
    .from('import_jobs')
    .select('id')
    .in('status', ['pending', 'running', 'waiting'])
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .or(`resume_at.is.null,resume_at.lte.${nowIso}`)
    .lt('updated_at', new Date(Date.now() - 45_000).toISOString())
    .limit(3)
  for (const j of data ?? []) await background(runTick(j.id))
}

// ───────── Surveillance automatique : quelques dossiers « échus » par passage, fréquence adaptative
async function watchTick(): Promise<string> {
  const db = adminClient()
  const note = async (message: string) => {
    await db.from('watch_config').update({ last_tick_at: new Date().toISOString(), last_message: message.slice(0, 400) }).eq('id', 1)
    return message
  }
  const { data: cfg } = await db.from('watch_config').select('enabled, publish, model_per_folder, folders_per_tick').eq('id', 1).single()
  if (!cfg?.enabled) return 'désactivée'
  const { count: busy } = await db.from('import_jobs').select('id', { count: 'exact', head: true }).in('status', ['pending', 'running', 'waiting'])
  if ((busy ?? 0) > 0) return note('Import en cours : surveillance en pause')

  const { data: due } = await db
    .from('watch_folders')
    .select('folder_id, parent_id, name, model_name, interval_min')
    .eq('active', true)
    .lte('next_scan_at', new Date().toISOString())
    .order('next_scan_at', { ascending: true })
    .limit(cfg.folders_per_tick)
  if (!due || due.length === 0) return note('Rien à analyser pour le moment')

  let imported = 0
  let newFolders = 0
  let scanned = 0
  let stopped: string | null = null
  for (const f of due) {
    try {
      const listing = await listFolder(f.folder_id, false, LANE_WATCH)
      const videos = listing.files.filter((x) => x.video)
      const r = await importVideos(videos, cfg.model_per_folder ? f.model_name : null, cfg.publish === true)
      let fresh = 0
      if (listing.folders.length > 0) {
        const { data } = await db
          .from('watch_folders')
          .upsert(
            listing.folders.map((x) => ({
              folder_id: x.id,
              parent_id: f.folder_id,
              name: x.name,
              // juste sous la racine : le dossier est un modèle ; plus bas (ou dossier générique) : il hérite
              model_name: f.folder_id === 0 || f.parent_id == null ? (GENERIC_FOLDER.test(x.name.trim()) ? null : x.name) : f.model_name,
            })),
            { onConflict: 'folder_id', ignoreDuplicates: true })
          .select('folder_id')
        fresh = data?.length ?? 0
      }
      const hot = r.imported > 0 || fresh > 0
      const interval = hot ? 15 : Math.min(f.interval_min * 2, 1440)
      const { data: row } = await db.from('watch_folders').select('imported_total').eq('folder_id', f.folder_id).single()
      await db
        .from('watch_folders')
        .update({
          interval_min: interval,
          next_scan_at: new Date(Date.now() + interval * 60_000).toISOString(),
          last_scanned_at: new Date().toISOString(),
          ...(hot ? { last_new_at: new Date().toISOString() } : {}),
          files_seen: listing.files.length,
          imported_total: Number(row?.imported_total ?? 0) + r.imported,
        })
        .eq('folder_id', f.folder_id)
      imported += r.imported
      newFolders += fresh
      scanned++
    } catch (e) {
      const msg = (e as Error).message
      if (e instanceof OnefichierError && e.failure === 'auth') {
        stopped = msg
        break
      }
      // occupé / injoignable / dossier disparu : on décale ce dossier, sans insister
      const gone = e instanceof OnefichierError && e.failure === 'offline'
      await db
        .from('watch_folders')
        .update({ next_scan_at: new Date(Date.now() + (gone ? 1440 : 20) * 60_000).toISOString(), ...(gone ? { active: false } : {}) })
        .eq('folder_id', f.folder_id)
      if (e instanceof OnefichierError && e.failure === 'host_busy') {
        stopped = msg
        break
      }
    }
  }
  return note(stopped ? `Arrêt : ${stopped}` : `${scanned} dossier(s) analysé(s), ${imported} nouveau(x) fichier(s), ${newFolders} nouveau(x) dossier(s)`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // Tick interne (relance automatique) : authentifié par la clé service_role, répond tout de suite
  if (req.headers.get('Authorization') === `Bearer ${SERVICE_KEY}`) {
    const b = await req.json().catch(() => ({}))
    if (b.action === 'job_tick' && typeof b.job_id === 'string') {
      await background(runTick(b.job_id))
      return json({ accepted: true }, 202)
    }
    return json({ error: 'forbidden' }, 403)
  }

  // Réveil par pg_cron : le secret de la table watch_config authentifie l'appel
  const watchSecret = req.headers.get('x-watch-secret')
  if (watchSecret) {
    const { data: ok } = await adminClient().rpc('watch_verify', { p_secret: watchSecret })
    if (ok !== true) return json({ error: 'forbidden' }, 403)
    await background(watchTick())
    return json({ accepted: true }, 202)
  }

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
    if (body.action === 'watch_now') {
      await background(watchTick())
      return json({ accepted: true }, 202)
    }
    if (body.action === 'job_start') {
      const folderId = Number(body.folder_id ?? 0)
      if (!Number.isInteger(folderId) || folderId < 0) return json({ error: 'invalid_folder' }, 400)
      const name = String(body.name ?? 'Racine').slice(0, 120)
      const { data: uid } = await user.auth.getUser()
      const { data: job, error } = await adminClient()
        .from('import_jobs')
        .insert({
          created_by: uid.user?.id,
          root_folder_id: folderId,
          root_name: name,
          publish: body.publish === true,
          model_per_folder: body.model_per_folder !== false,
          model_mode: body.model_mode === 'inherit' ? 'inherit' : 'children',
          reassign: body.reassign === true,
          queue: [{ id: folderId, name, model: name, depth: 0 }],
          last_message: 'Démarrage…',
        })
        .select('id')
        .single()
      if (error || !job) return json({ error: 'internal', message: error?.message }, 500)
      await background(runTick(job.id)) // directement, sans appel interne
      return json({ job_id: job.id })
    }
    if (body.action === 'job_status') {
      await resumeStalled()
      const { data } = await adminClient()
        .from('import_jobs')
        .select('id, root_name, status, publish, folders_done, files_seen, imported, ignored, failed, current_folder, last_message, resume_at, created_at, completed_at, queue')
        .order('created_at', { ascending: false })
        .limit(5)
      return json({ jobs: (data ?? []).map(({ queue, ...j }) => ({ ...j, folders_left: Array.isArray(queue) ? queue.length : 0 })) })
    }
    if (body.action === 'job_cancel' && typeof body.job_id === 'string') {
      await adminClient().from('import_jobs').update({ status: 'cancelled', completed_at: new Date().toISOString(), last_message: 'Arrêté' }).eq('id', body.job_id).in('status', ['pending', 'running', 'waiting'])
      return json({ ok: true })
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
