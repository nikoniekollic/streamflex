// Explorateur + import du compte 1fichier (admin uniquement).
//  action 'ls'     : liste un dossier du compte (1 appel API régulé, voie « admin »)
//  action 'import' : crée un film + sa source par fichier ; fichiers déjà en base ignorés (aucun appel API)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient } from '../_shared/admin-client.ts'
import { denyIfBanned } from '../_shared/guard.ts'
import { background } from '../_shared/background.ts'
import { LANE_ADMIN, LANE_WATCH, OnefichierError, onefichierCall, type Lane } from '../_shared/onefichier.ts'

const VIDEO_EXT = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', '3gp', '3g2', 'vob', 'ogv', 'ogm', 'divx', 'xvid', 'f4v', 'asf', 'rm', 'rmvb', 'm2v', 'mpe', 'mxf', 'qt', 'hevc', 'h264', 'h265', '264', '265'])
const MAX_IMPORT = 100

type RemoteFile = { id: string; name: string; size: number | null; date: string | null; ctype?: string | null; checksum?: string | null }
type Result = { id: string; name: string; status: 'success' | 'ignored' | 'failed'; reason?: string }

function fileIdOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = url.match(/^https?:\/\/(?:([A-Za-z0-9]{4,32})\.1fichier\.com\/?|(?:www\.)?1fichier\.com\/\?([A-Za-z0-9]{4,32}))/)
  return m ? (m[1] ?? m[2]) : null
}

const ext = (name: string) => (name.includes('.') ? (name.trim().split('.').pop()?.trim().toLowerCase() ?? '') : '')
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

type Child = { id: number; name: string; date: string | null; files: number | null; size: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)

/**
 * Liste un dossier. UN SEUL appel : `files: 1` ajoute les fichiers à la réponse (avant, un second appel `file/ls` doublait le
 * temps, et sa limite de 12 s faisait répondre « 1fichier injoignable » sur les gros dossiers). Sans `files`, la réponse ne
 * contient que les sous-dossiers, avec leur nombre de fichiers et leur taille (signature de changement), très légère.
 */
async function listFolder(folderId: number, opts: { annotate?: boolean; lane?: Lane; files?: boolean } = {}) {
  const { annotate = true, lane = LANE_ADMIN, files: withFiles = true } = opts
  await guardFolder(folderId)
  const body = await onefichierCall('folder/ls.cgi', { folder_id: folderId, ...(withFiles ? { files: 1 } : {}) }, lane)
  let rawItems: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : Array.isArray(body.files) ? body.files : []
  const rawFolders: Record<string, unknown>[] = Array.isArray(body.sub_folders) ? body.sub_folders : Array.isArray(body.folders) ? body.folders : []
  // secours : si 1fichier a ignoré le drapeau `files` alors que le dossier contient des fichiers, un second appel dédié les liste
  let usedFallback = false
  if (withFiles && rawItems.length === 0 && (num(body.files) ?? 0) > 0) {
    try {
      const fb = await onefichierCall('file/ls.cgi', { folder_id: folderId }, lane)
      rawItems = Array.isArray(fb.items) ? fb.items : Array.isArray(fb.files) ? fb.files : []
      usedFallback = true
    } catch (e) {
      if (!(e instanceof OnefichierError) || e.failure !== 'offline') throw e
    }
  }
  const recognised = 'items' in body || 'sub_folders' in body || 'folders' in body || 'folder_id' in body || 'name' in body
  if (!recognised) {
    console.error('[onefichier-import] réponse inattendue', Object.keys(body))
    throw new OnefichierError('unavailable', `Réponse 1fichier inattendue (champs : ${Object.keys(body).join(', ') || 'aucun'})`, 502)
  }
  const capped = rawItems.length >= CAP
  const files = parseItems(rawItems)
  const folders: Child[] = rawFolders
    .map((f) => ({ id: Number(f.id), name: String(f.name ?? f.id), date: typeof f.create_date === 'string' ? f.create_date : null, files: num(f.files), size: num(f.size) }))
    .filter((f) => Number.isInteger(f.id))
  const known = annotate ? await knownIds(files.map((f) => f.id)) : new Set<string>()
  console.log('[onefichier-import] ls', folderId, JSON.stringify({ items: rawItems.length, withId: files.length, folders: folders.length, withFiles, usedFallback }))
  return {
    folderName: String(body.name ?? ''),
    folders,
    files: files.map((f) => ({ ...f, known: known.has(f.id), video: isVideo(f) })),
    capped,
    ownFiles: num(body.files),
    ownSize: num(body.size),
    debug: { keys: Object.keys(body), items: rawItems.length, withId: files.length, sampleKeys: rawItems[0] ? Object.keys(rawItems[0]) : [], sampleUrl: rawItems[0] ? String(rawItems[0].url ?? '').slice(0, 60) : null, foldersRaw: rawFolders.length, hadItems: 'items' in body },
  }
}

/** Fichiers d'une réponse 1fichier, avec leurs métadonnées (taille, date d'envoi, type, empreinte). */
function parseItems(rawItems: Record<string, unknown>[]): RemoteFile[] {
  const files: RemoteFile[] = []
  for (const it of rawItems) {
    const link = it.url ?? it.link ?? it.download_url ?? Object.values(it).find((v) => typeof v === 'string' && /1fichier\.com/.test(v))
    const id = fileIdOf(link)
    if (!id) continue
    const ct = it['content-type'] ?? it.content_type ?? it.contentType
    const sum = it.checksum ?? it.hash ?? it.whirlpool ?? it.sha256 ?? it.md5
    files.push({
      id,
      name: String(it.filename ?? it.name ?? id),
      size: Number(it.size) > 0 ? Number(it.size) : null,
      date: typeof it.date === 'string' ? it.date : null,
      ctype: typeof ct === 'string' ? ct : null,
      checksum: typeof sum === 'string' && /^[A-Za-z0-9+/=:_-]{16,200}$/.test(sum) ? sum : null,
    })
  }
  return files
}

/**
 * Dossiers de plus de 5 000 fichiers : 1fichier tronque la liste. On relit alors le dossier par tranches de dates d'envoi
 * (file/ls.cgi, date_start / date_end). Si 1fichier ignore le filtre (dates hors tranche dans la réponse), on le note et on
 * n'insiste pas : renvoie null.
 */
async function listWindow(folderId: number, start: Date, end: Date) {
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19)
  const a = fmt(start)
  const b = fmt(end)
  await guardFolder(folderId)
  const body = await onefichierCall('file/ls.cgi', { folder_id: folderId, date_start: a, date_end: b }, LANE_WATCH)
  const raw: Record<string, unknown>[] = Array.isArray(body.items) ? body.items : Array.isArray(body.files) ? body.files : []
  const files = parseItems(raw)
  // marge d'un jour : 1fichier donne ses dates à l'heure de Paris, nos bornes sont en UTC
  const lo = fmt(new Date(start.getTime() - 86_400_000))
  const hi = fmt(new Date(end.getTime() + 86_400_000))
  const outside = files.some((f) => f.date && (f.date.slice(0, 19) < lo || f.date.slice(0, 19) > hi))
  console.log('[onefichier-import] tranche', folderId, a, b, JSON.stringify({ items: raw.length, outside }))
  if (outside) return null
  return { files: files.map((f) => ({ ...f, video: isVideo(f) })), capped: raw.length >= CAP }
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

/**
 * Synchronise les vidéos d'UN dossier avec la base (par lots de 500) : nouveaux fichiers importés, fichiers renommés (titre mis à
 * jour s'il n'avait pas été modifié à la main), fichiers déplacés (modèle suivi), fichiers revenus (republiés). `complete` = la
 * liste est entière (non plafonnée) : les fichiers de ce dossier qui n'y figurent plus sont marqués « manquants ».
 */
async function syncFolder(folderId: number, videos: RemoteFile[], modelName: string | null, publish: boolean, reassign = false, complete = true) {
  const db = adminClient()
  let imported = 0
  let ignored = 0
  let failed = 0
  let fixed = 0
  let renamed = 0
  let restored = 0
  let missing = 0
  let suspect = false
  let duplicates = 0
  const model = modelName && videos.length > 0 && modelName !== 'Racine' ? await ensureModel(modelName) : null
  for (let i = 0; i < videos.length; i += BATCH_ROWS) {
    const rows = videos.slice(i, i + BATCH_ROWS).map((f) => {
      const title = cleanTitle(f.name)
      return { id: f.id, slug: slugFor(title, f.id), title, name: f.name, quality: guessQuality(f.name), size: f.size, container: ext(f.name), checksum: f.checksum ?? null, ctype: f.ctype ?? null, date: f.date }
    })
    const { data, error } = await db.rpc('sync_onefichier_folder', {
      p_folder: folderId,
      p_files: rows,
      p_publish: publish,
      p_model_id: model?.id ?? null,
      p_poster: model?.image_url ? `${model.image_url}#model` : null,
      p_reassign: reassign,
    })
    if (error) {
      console.error('[onefichier-import] sync', folderId, error.message)
      failed += rows.length
    } else {
      imported += Number(data?.imported ?? 0)
      duplicates += Number(data?.duplicates ?? 0)
      ignored += Number(data?.ignored ?? 0)
      fixed += Number(data?.moved ?? 0)
      renamed += Number(data?.renamed ?? 0)
      restored += Number(data?.restored ?? 0)
    }
  }
  if (complete && failed === 0) {
    const { data, error } = await db.rpc('sync_onefichier_missing', { p_folder: folderId, p_ids: videos.map((v) => v.id) })
    if (!error) {
      missing = Number(data?.missing ?? 0)
      suspect = data?.suspect === true
    }
  }
  return { imported, ignored, failed, fixed, renamed, restored, missing, suspect, duplicates }
}

const JOB_PARALLEL = 4 // dossiers listés en même temps (le régulateur espace les appels : 1,4 requête/s au plus)

type JobRow = { model_per_folder: boolean; publish: boolean; reassign: boolean; model_mode: string }
type Outcome =
  | { ok: true; entry: QueueEntry; listing: Awaited<ReturnType<typeof listFolder>>; r: Awaited<ReturnType<typeof syncFolder>>; subs: QueueEntry[] }
  | { ok: false; entry: QueueEntry; kind: 'auth' | 'transient' | 'skip'; msg: string }

/** Liste et synchronise UN dossier de l'import. */
async function scanForJob(entry: QueueEntry, job: JobRow): Promise<Outcome> {
  try {
    const listing = await listFolder(entry.id, { annotate: false })
    const videos = listing.files.filter((f) => f.video)
    const r = await syncFolder(entry.id, videos, job.model_per_folder ? entry.model : null, job.publish === true, job.reassign === true, !listing.capped)
    const subs: QueueEntry[] = listing.folders.map((f) => ({ id: f.id, name: f.name, model: childModel(entry, f.name, job.model_mode), depth: (entry.depth ?? 0) + 1 }))
    return { ok: true, entry, listing, r, subs }
  } catch (e) {
    const msg = (e as Error).message
    if (e instanceof OnefichierError && e.failure === 'auth') return { ok: false, entry, kind: 'auth', msg }
    const transient = e instanceof OnefichierError && (e.failure === 'host_busy' || e.failure === 'unavailable')
    if (transient && (entry.tries ?? 0) + 1 < MAX_TRIES * 3) return { ok: false, entry, kind: 'transient', msg }
    console.error('[onefichier-import] dossier ignoré', entry.id, msg)
    return { ok: false, entry, kind: 'skip', msg }
  }
}

/** Traite un lot de dossiers (jusqu'à JOB_PARALLEL à la fois). Retourne true s'il reste du travail à enchaîner tout de suite. */
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
  const batch = queue.slice(0, JOB_PARALLEL)
  const rest = queue.slice(JOB_PARALLEL)
  const outcomes = await Promise.all(batch.map((entry) => scanForJob(entry, job as JobRow)))

  let imported = 0
  let ignored = 0
  let failed = 0
  let seen = 0
  let foldersDone = 0
  let fixed = 0
  let removedHint = 0
  let authMsg: string | null = null
  let waitS = 0
  let waitMsg = ''
  const retry: QueueEntry[] = []
  const subs: QueueEntry[] = []
  const lines: string[] = []
  for (const o of outcomes) {
    if (o.ok) {
      const nonVideo = o.listing.files.length - o.listing.files.filter((f) => f.video).length
      foldersDone++
      seen += o.listing.files.length
      imported += o.r.imported
      ignored += nonVideo + o.r.ignored
      failed += o.r.failed
      fixed += o.r.fixed + o.r.renamed
      removedHint += o.r.missing
      subs.push(...o.subs)
      lines.push(`${o.entry.name}${o.entry.model && o.entry.model !== o.entry.name ? ` (modèle ${o.entry.model})` : ''} : ${o.r.imported} importés${o.r.fixed || o.r.renamed ? `, ${o.r.fixed + o.r.renamed} corrigés` : ''}${o.listing.capped ? ' — ⚠ plafonné à 5 000 (répartis en sous-dossiers)' : ''}`)
    } else if (o.kind === 'auth') authMsg = o.msg
    else if (o.kind === 'transient') {
      retry.push({ ...o.entry, tries: (o.entry.tries ?? 0) + 1 })
      waitS = Math.max(waitS, retrySeconds(o.msg))
      waitMsg = `${o.entry.name} : ${o.msg}`
    } else {
      foldersDone++
      failed++
      lines.push(`${o.entry.name} : ignoré — ${o.msg}`)
    }
  }
  const next = [...retry, ...rest, ...subs]
  const progress = {
    queue: next,
    folders_done: job.folders_done + foldersDone,
    files_seen: Number(job.files_seen) + seen,
    imported: Number(job.imported) + imported,
    ignored: Number(job.ignored) + ignored,
    failed: Number(job.failed) + failed,
  }
  if (authMsg) {
    await done({ ...progress, status: 'error', last_message: authMsg }) // disjoncteur / clé invalide : on s'arrête
    return false
  }
  if (retry.length > 0 && foldersDone === 0) {
    await done({ ...progress, status: 'waiting', resume_at: new Date(Date.now() + waitS * 1000).toISOString(), last_message: `en attente de 1fichier (${waitS} s) — ${waitMsg}` })
    return false // repris par le battement de cœur de l'interface (job_status)
  }
  const finished = next.length === 0
  await done({
    ...progress,
    status: finished ? 'completed' : 'running',
    completed_at: finished ? new Date().toISOString() : null,
    current_folder: finished ? null : next[0].name,
    resume_at: null,
    last_message: `${lines.slice(0, 3).join(' · ')}${lines.length > 3 ? ` · +${lines.length - 3} dossiers` : ''}${fixed ? ` · ${fixed} fichiers mis à jour` : ''}${removedHint ? ` · ${removedHint} absents` : ''}`,
  })
  return !finished
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

// ───────── Surveillance permanente : signature des dossiers, relevés ciblés, synchronisation (suppression / déplacement / renommage)
//  • un dossier qui a des sous-dossiers est relu toutes les 10 min SANS ses fichiers (réponse légère : sous-dossiers + leur nombre de
//    fichiers et leur taille) ; un sous-dossier dont la signature a changé est marqué « à relire en entier » ;
//  • un dossier sans sous-dossier n'est relu en entier que s'il a changé, ou une fois par jour (filet de sécurité : renommages) ;
//  • chaque relevé complet synchronise la base : nouveaux, renommés, déplacés ; les fichiers absents sont retirés après un délai de grâce.
const STRUCTURE_MIN = 10
const FULL_MAX_H = 6 // filet de sécurité : chaque dossier est relu en entier au moins toutes les 6 h (avant : 24 h)
const GRACE_MIN = 90
const WATCH_BUDGET_MS = 100_000
const WATCH_PARALLEL = 3

type WatchRow = {
  folder_id: number
  parent_id: number | null
  name: string
  model_name: string | null
  has_children: boolean
  force_full: boolean
  full_at: string | null
  files_count: number | null
  size_bytes: number | null
  parent_files: number | null
  parent_size: number | null
  imported_total: number
  capped: boolean | null
  win_turn: boolean
  win_unsupported: boolean
  win_cursor: string | null
  win_span_days: number
  recent_at: string | null
}
type WatchStats = { scanned: number; full: number; imported: number; fresh: number; updated: number; missing: number; suspect: boolean; stopped: string | null }

/** Un listage par dossier toutes les 30 s au plus (règle 1fichier) : un dossier listé trop récemment attend la passe suivante. */
async function folderReady(folderId: number): Promise<boolean> {
  const { data } = await adminClient().from('api_governor').select('last_call_at').eq('name', `ls:${folderId}`).maybeSingle()
  return !data?.last_call_at || Date.now() - new Date(data.last_call_at).getTime() > (FOLDER_GAP_S + 2) * 1000
}

async function scanWatched(f: WatchRow, cfg: { model_per_folder: boolean; publish: boolean }, st: WatchStats) {
  const db = adminClient()
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
  if (!(await folderReady(f.folder_id))) return
  if (f.win_turn && f.capped && !f.win_unsupported) return scanWindow(f, cfg, st)
  const sigChanged = (f.parent_files ?? -1) !== (f.files_count ?? -1) || (f.parent_size ?? -1) !== (f.size_bytes ?? -1)
  const stale = !f.full_at || Date.now() - new Date(f.full_at).getTime() > FULL_MAX_H * 3_600_000
  const full = f.force_full || stale || sigChanged || !f.has_children
  try {
    const listing = await listFolder(f.folder_id, { annotate: false, lane: LANE_WATCH, files: full })
    const { data: ch } = await db.rpc('watch_apply_children', {
      p_parent: f.folder_id,
      p_children: listing.folders.map((c) => ({ id: c.id, name: c.name, files: c.files, size: c.size })),
    })
    st.fresh += Number(ch?.fresh ?? 0)
    st.scanned++
    const isRoot = f.folder_id === 0 || f.parent_id == null
    const hasChildren = listing.folders.length > 0
    if (full) {
      const videos = listing.files.filter((x) => x.video)
      const r = await syncFolder(f.folder_id, videos, cfg.model_per_folder ? f.model_name : null, cfg.publish === true, false, !listing.capped)
      // signature relevée : celle annoncée par le parent (la racine n'a que la sienne)
      const { data: cur } = await db.from('watch_folders').select('parent_files, parent_size').eq('folder_id', f.folder_id).single()
      const sig = isRoot ? { files: listing.ownFiles, size: listing.ownSize } : { files: cur?.parent_files ?? null, size: cur?.parent_size ?? null }
      await db
        .from('watch_folders')
        .update({
          files_count: sig.files,
          size_bytes: sig.size,
          ...(isRoot ? { parent_files: sig.files, parent_size: sig.size } : {}),
          full_at: new Date().toISOString(),
          force_full: false,
          has_children: hasChildren,
          capped: listing.capped,
          files_seen: listing.files.length,
          imported_total: Number(f.imported_total) + r.imported,
          last_scanned_at: new Date().toISOString(),
          ...(r.imported > 0 ? { last_new_at: new Date().toISOString() } : {}),
          interval_min: hasChildren ? STRUCTURE_MIN : FULL_MAX_H * 60,
          // dossier tronqué : une tranche de dates suit 35 s plus tard (règle 1fichier : un listage par dossier toutes les 30 s)
          next_scan_at: listing.capped && !f.win_unsupported ? iso((FOLDER_GAP_S + 5) * 1000) : iso((hasChildren ? STRUCTURE_MIN : FULL_MAX_H * 60) * 60_000),
          win_turn: listing.capped && !f.win_unsupported,
        })
        .eq('folder_id', f.folder_id)
      st.full++
      st.imported += r.imported
      st.updated += r.renamed + r.fixed + r.restored
      st.missing += r.missing
      st.suspect ||= r.suspect
    } else {
      // relevé léger : seul le dossier racine annonce lui-même sa signature
      let force = false
      if (isRoot && listing.ownFiles != null) {
        force = listing.ownFiles !== f.files_count || listing.ownSize !== f.size_bytes
        await db.from('watch_folders').update({ parent_files: listing.ownFiles, parent_size: listing.ownSize }).eq('folder_id', f.folder_id)
      }
      await db
        .from('watch_folders')
        .update({
          has_children: hasChildren,
          last_scanned_at: new Date().toISOString(),
          next_scan_at: force || (f.capped && !f.win_unsupported) ? iso((FOLDER_GAP_S + 8) * 1000) : iso(STRUCTURE_MIN * 60_000),
          ...(force ? { force_full: true } : {}),
          ...(f.capped && !f.win_unsupported && !force ? { win_turn: true } : {}),
        })
        .eq('folder_id', f.folder_id)
    }
  } catch (e) {
    const msg = (e as Error).message
    if (e instanceof OnefichierError && e.failure === 'auth') {
      st.stopped = msg
      return
    }
    if (e instanceof OnefichierError && e.failure === 'offline') {
      // dossier introuvable (supprimé) : une seule fois (les 404 répétés font bannir) ; le balayage retire ses fichiers après le délai de grâce
      await db.from('watch_folders').update({ missing_since: new Date().toISOString(), next_scan_at: iso(24 * 3_600_000) }).eq('folder_id', f.folder_id).is('missing_since', null)
      return
    }
    await db.from('watch_folders').update({ next_scan_at: iso(10 * 60_000) }).eq('folder_id', f.folder_id) // occupé / injoignable : on décale
    if (e instanceof OnefichierError && e.failure === 'host_busy') st.stopped = msg
  }
}

/**
 * Dossier tronqué (> 5 000 fichiers) : une tranche de dates par passage. D'abord les fichiers récents (depuis la dernière tranche
 * récente, 1 jour de recouvrement), puis on remonte le temps tranche par tranche (rattrapage des fichiers jamais vus).
 */
async function scanWindow(f: WatchRow, cfg: { model_per_folder: boolean; publish: boolean }, st: WatchStats) {
  const db = adminClient()
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
  const DAY = 86_400_000
  const now = Date.now()
  const recentDue = !f.recent_at || now - new Date(f.recent_at).getTime() > STRUCTURE_MIN * 60_000
  const cursor = f.win_cursor ? new Date(f.win_cursor).getTime() : now - 30 * DAY
  const backfillDone = cursor < Date.UTC(2008, 0, 1)
  const span = Math.max(1, f.win_span_days || 60)
  const recent = recentDue || backfillDone
  const start = recent ? new Date((f.recent_at ? new Date(f.recent_at).getTime() : now - 30 * DAY) - DAY) : new Date(cursor - span * DAY)
  const end = recent ? new Date(now + DAY) : new Date(cursor)
  try {
    const w = await listWindow(f.folder_id, start, end)
    if (!w) {
      await db.from('watch_folders').update({ win_unsupported: true, win_turn: false, next_scan_at: iso(STRUCTURE_MIN * 60_000) }).eq('folder_id', f.folder_id)
      return
    }
    st.scanned++
    // tranche encore tronquée : on la coupe en deux (le rattrapage reprend avec une tranche plus courte)
    if (w.capped && !recent && span > 1) {
      await db.from('watch_folders').update({ win_span_days: Math.max(1, Math.floor(span / 2)), next_scan_at: iso((FOLDER_GAP_S + 5) * 1000) }).eq('folder_id', f.folder_id)
      return
    }
    const r = await syncFolder(f.folder_id, w.files.filter((x) => x.video), cfg.model_per_folder ? f.model_name : null, cfg.publish === true, false, false)
    st.imported += r.imported
    st.updated += r.renamed + r.fixed + r.restored
    const more = !recent || !backfillDone // rattrapage en cours : on enchaîne les tranches
    await db
      .from('watch_folders')
      .update({
        ...(recent ? { recent_at: new Date(now).toISOString() } : { win_cursor: start.toISOString(), win_span_days: w.files.length < CAP / 4 ? Math.min(span * 2, 365) : span }),
        win_turn: more,
        imported_total: Number(f.imported_total) + r.imported,
        last_scanned_at: new Date().toISOString(),
        ...(r.imported > 0 ? { last_new_at: new Date().toISOString() } : {}),
        next_scan_at: more ? iso((FOLDER_GAP_S + 5) * 1000) : iso(STRUCTURE_MIN * 60_000),
      })
      .eq('folder_id', f.folder_id)
  } catch (e) {
    const msg = (e as Error).message
    if (e instanceof OnefichierError && e.failure === 'auth') {
      st.stopped = msg
      return
    }
    // paramètre refusé par 1fichier (réponse KO) : le filtre par dates n'est pas disponible, on n'insiste pas
    const refused = e instanceof OnefichierError && e.failure === 'unavailable' && /param|date|invalid/i.test(msg)
    await db
      .from('watch_folders')
      .update({ ...(refused ? { win_unsupported: true, win_turn: false } : {}), next_scan_at: iso(10 * 60_000) })
      .eq('folder_id', f.folder_id)
  }
}

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
    .select('folder_id, parent_id, name, model_name, has_children, force_full, full_at, files_count, size_bytes, parent_files, parent_size, imported_total, capped, win_turn, win_unsupported, win_cursor, win_span_days, recent_at')
    .eq('active', true)
    .is('missing_since', null)
    .lte('next_scan_at', new Date().toISOString())
    .order('force_full', { ascending: false })
    .order('next_scan_at', { ascending: true })
    .limit(cfg.folders_per_tick)
  const st: WatchStats = { scanned: 0, full: 0, imported: 0, fresh: 0, updated: 0, missing: 0, suspect: false, stopped: null }
  const list = (due ?? []) as WatchRow[]
  const t0 = Date.now()
  let i = 0
  const worker = async () => {
    while (!st.stopped && Date.now() - t0 < WATCH_BUDGET_MS) {
      const f = list[i++]
      if (!f) return
      await scanWatched(f, cfg, st)
    }
  }
  await Promise.all(Array.from({ length: WATCH_PARALLEL }, worker))

  // balayage : retire du site ce qui manque depuis plus de GRACE_MIN minutes (dépublié, jamais effacé : revient si le fichier revient)
  let swept = ''
  if (!st.stopped) {
    const { data: sw } = await db.rpc('sync_onefichier_sweep', { p_grace_min: GRACE_MIN })
    const removed = Number(sw?.files_removed ?? 0)
    const gone = Number(sw?.folders_gone ?? 0)
    if (removed || gone) swept = `, ${removed} fichier(s) retiré(s)${gone ? ` (${gone} dossier(s) disparu(s))` : ''}`
  }
  if (list.length === 0) return note(`Rien à relire pour le moment${swept}`)
  return note(
    st.stopped
      ? `Arrêt : ${st.stopped}`
      : `${st.scanned} dossier(s) relu(s) (${st.full} en entier), ${st.imported} nouveau(x), ${st.updated} mis à jour, ${st.missing} absent(s), ${st.fresh} nouveau(x) dossier(s)${swept}${st.suspect ? ' — ⚠ liste douteuse ignorée' : ''}`,
  )
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
