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

/** Texte sûr pour la base : sans caractères de contrôle ni demi-caractères Unicode isolés (qui rendent la requête illisible). */
function safeText(v: string): string {
  // deno-lint-ignore no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '').trim() || 'Sans titre'
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
async function syncFolder(folderId: number, videos: RemoteFile[], modelName: string | null, publish: boolean, reassign = false, complete = true, detach = false, trusted = false) {
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
  type SyncResult = Record<string, number | undefined>
  // Un lot refusé (requête vide ou illisible côté base, coupure réseau) n'est plus perdu : nouvel essai, puis le lot est coupé en
  // deux jusqu'à isoler l'éventuel fichier en cause (seul celui-ci est alors compté en échec).
  const syncRows = async (rows: Record<string, unknown>[], attempt = 0): Promise<SyncResult[]> => {
    const { data, error } = await db.rpc('sync_onefichier_folder', {
      p_folder: folderId,
      p_files: rows,
      p_publish: publish,
      p_model_id: model?.id ?? null,
      p_poster: model?.image_url ? `${model.image_url}#model` : null,
      p_reassign: reassign,
      // dossier sans modèle (racine, dossier générique) : un fichier arrivé d'un dossier de modèle n'y est plus rattaché
      p_detach: detach && !model,
    })
    if (!error) return [(data ?? {}) as SyncResult]
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500))
      return syncRows(rows, 1)
    }
    if (rows.length > 1) {
      const half = Math.ceil(rows.length / 2)
      return [...(await syncRows(rows.slice(0, half), 1)), ...(await syncRows(rows.slice(half), 1))]
    }
    console.error('[onefichier-import] sync', folderId, rows[0]?.id, error.message)
    failed += rows.length
    return []
  }
  for (let i = 0; i < videos.length; i += BATCH_ROWS) {
    const rows = videos.slice(i, i + BATCH_ROWS).map((f) => {
      const name = safeText(f.name)
      const title = safeText(cleanTitle(name))
      return { id: f.id, slug: slugFor(title, f.id), title, name, quality: guessQuality(f.name), size: f.size, container: ext(f.name), checksum: f.checksum ?? null, ctype: f.ctype ?? null, date: f.date }
    })
    for (const data of await syncRows(rows)) {
      imported += Number(data.imported ?? 0)
      duplicates += Number(data.duplicates ?? 0)
      ignored += Number(data.ignored ?? 0)
      fixed += Number(data.moved ?? 0)
      renamed += Number(data.renamed ?? 0)
      restored += Number(data.restored ?? 0)
    }
  }
  if (complete && failed === 0) {
    // par lots de 1 000 (limite de 8 s du serveur) : rappel tant qu'il en reste à marquer
    const ids = videos.map((v) => v.id)
    for (let round = 0; round < 30; round++) {
      const { data, error } = await db.rpc('sync_onefichier_missing', { p_folder: folderId, p_ids: ids, p_trusted: trusted })
      if (error) {
        console.error('[onefichier-import] manquants', folderId, error.message)
        break
      }
      missing = Number(data?.missing ?? 0)
      suspect = data?.suspect === true
      if (data?.more !== true) break
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
    const trusted = !listing.capped && listing.ownFiles != null && listing.ownFiles === listing.files.length
    const r = await syncFolder(entry.id, videos, job.model_per_folder ? entry.model : null, job.publish === true, job.reassign === true, !listing.capped, false, trusted)
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
//  • un dossier sans sous-dossier n'est relu en entier que s'il a changé, ou toutes les 3 h (filet de sécurité : renommages) ;
//  • chaque relevé complet synchronise la base : nouveaux, renommés, déplacés ; les fichiers absents sont retirés après un délai de grâce.
const STRUCTURE_MIN = 10
const FULL_MAX_H = 3 // filet de sécurité : chaque dossier est relu en entier au moins toutes les 3 h (avant : 6 h)
const GRACE_MIN = 20 // absent d'un relevé complet depuis 20 min : retiré du site (avant : 90 min)
const VERIFY_PER_TICK = 8 // fichiers signalés morts vérifiés un par un auprès de 1fichier par passage (gros dossiers tronqués)
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
  reassign_pending: boolean
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
      // dossier qui a changé de modèle : toutes ses vidéos sont reclassées ; sinon seuls les fichiers arrivés d'un autre dossier
      const reassign = cfg.model_per_folder && f.reassign_pending
      // relevé confirmé par 1fichier : le nombre de fichiers qu'il annonce pour ce dossier (le sien pour la racine, celui donné
      // par le parent sinon) = le nombre reçu. Un dossier vidé pour de bon (ex. la racine) est alors vu tout de suite.
      const announced = isRoot ? listing.ownFiles : (listing.ownFiles ?? f.parent_files)
      const trusted = !listing.capped && announced != null && announced === listing.files.length
      const r = await syncFolder(f.folder_id, videos, cfg.model_per_folder ? f.model_name : null, cfg.publish === true, reassign, !listing.capped, cfg.model_per_folder, trusted)
      // des fichiers ont quitté ce dossier (déplacés vers un autre modèle ?) : le parent est relu tout de suite pour repérer
      // le dossier qui les a reçus (sa signature change) et le relire en entier, au lieu d'attendre jusqu'à 10 min
      if (r.missing > 0 && f.parent_id != null) await db.from('watch_folders').update({ next_scan_at: new Date().toISOString() }).eq('folder_id', f.parent_id)
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
          ...(r.failed === 0 ? { reassign_pending: false } : {}),
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
    const r = await syncFolder(f.folder_id, w.files.filter((x) => x.video), cfg.model_per_folder ? f.model_name : null, cfg.publish === true, false, false, cfg.model_per_folder)
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

/**
 * Fichiers signalés morts par le lecteur d'un abonné (report_dead_titles) :
 *  • dossier ordinaire : il a été relu en entier depuis le signalement et le fichier y figurait → fausse alerte, signalement effacé
 *    (absent, il est déjà marqué manquant et le balayage le retire tout de suite) ;
 *  • dossier tronqué (> 5 000 fichiers, comme la racine) ou inconnu : aucun relevé ne peut prouver l'absence → vérification du
 *    fichier auprès de l'API 1fichier (file/info.cgi), quelques-uns par passage seulement (les 404 répétés font bannir).
 */
async function verifySuspects(): Promise<number> {
  const db = adminClient()
  const { data } = await db
    .from('media_sources')
    .select('id, file_id, folder_id, suspect_at')
    .eq('provider', 'onefichier')
    .is('removed_at', null)
    .is('missing_since', null)
    .not('suspect_at', 'is', null)
    .gt('suspect_at', new Date(Date.now() - 86_400_000).toISOString())
    .order('suspect_at', { ascending: true })
    .limit(200)
  const rows = (data ?? []) as { id: string; file_id: string | null; folder_id: number | null; suspect_at: string }[]
  if (!rows.length) return 0
  const folderIds = [...new Set(rows.map((r) => r.folder_id).filter((x): x is number => x != null))]
  const { data: fs } = folderIds.length
    ? await db.from('watch_folders').select('folder_id, full_at, capped, active').in('folder_id', folderIds)
    : { data: [] }
  const folders = new Map((fs ?? []).map((f) => [Number(f.folder_id), f as { full_at: string | null; capped: boolean | null; active: boolean }]))
  const cleared: string[] = []
  const check: typeof rows = []
  for (const r of rows) {
    const f = r.folder_id != null ? folders.get(Number(r.folder_id)) : undefined
    const listable = f && f.active && !f.capped
    if (listable) {
      if (f.full_at && new Date(f.full_at).getTime() > new Date(r.suspect_at).getTime()) cleared.push(r.id) // relu depuis : présent
    } else if (check.length < VERIFY_PER_TICK && r.file_id) {
      check.push(r)
    }
  }
  let gone = 0
  for (const r of check) {
    try {
      await onefichierCall('file/info.cgi', { url: `https://1fichier.com/?${r.file_id}` }, LANE_WATCH)
      cleared.push(r.id) // en ligne : fausse alerte (lien Alldebrid momentanément refusé)
    } catch (e) {
      if (e instanceof OnefichierError && e.failure === 'offline') {
        await db.from('media_sources').update({ missing_since: new Date().toISOString(), last_checked_at: new Date().toISOString(), last_status: 404 }).eq('id', r.id).is('missing_since', null)
        gone++
      } else if (e instanceof OnefichierError && (e.failure === 'auth' || e.failure === 'host_busy')) {
        break // compte en pause : on réessaiera au passage suivant
      }
    }
  }
  for (let i = 0; i < cleared.length; i += 200) {
    await db.from('media_sources').update({ suspect_at: null }).in('id', cleared.slice(i, i + 200))
  }
  return gone
}

/** Retire du site ce qui manque (dépublié, jamais effacé : revient si le fichier revient). */
async function sweep(): Promise<string> {
  const { data: sw } = await adminClient().rpc('sync_onefichier_sweep', { p_grace_min: GRACE_MIN })
  const removed = Number(sw?.files_removed ?? 0)
  const gone = Number(sw?.folders_gone ?? 0)
  return removed || gone ? `, ${removed} fichier(s) retiré(s)${gone ? ` (${gone} dossier(s) disparu(s))` : ''}` : ''
}

// ───────── Suppression depuis le site : le fichier part dans la corbeille 1fichier (récupérable 30 jours depuis le panneau
// 1fichier), PUIS le film est effacé de la base. Dans cet ordre : un film effacé dont le fichier resterait chez 1fichier serait
// réimporté par la surveillance au relevé suivant. Un fichier que 1fichier refuse de supprimer garde son film (signalé à l'admin).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RM_CHUNK = 50

async function deleteTitles(ids: string[]) {
  const db = adminClient()
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
  // fichiers 1fichier encore présents : sources du film et de ses épisodes
  const files = new Map<string, string[]>() // titre → fichiers
  const add = (tid: string, fid: string | null) => fid && files.set(tid, [...(files.get(tid) ?? []), fid])
  for (const c of chunk(ids, 100)) {
    const { data: direct, error } = await db.from('media_sources').select('title_id, file_id').eq('provider', 'onefichier').is('removed_at', null).in('title_id', c)
    if (error) throw new Error(error.message)
    for (const r of direct ?? []) add(r.title_id as string, r.file_id as string | null)
    const { data: eps } = await db.from('episodes').select('id, title_id').in('title_id', c)
    const epTitle = new Map((eps ?? []).map((e) => [e.id as string, e.title_id as string]))
    for (const ec of chunk([...epTitle.keys()], 100)) {
      const { data: es } = await db.from('media_sources').select('episode_id, file_id').eq('provider', 'onefichier').is('removed_at', null).in('episode_id', ec)
      for (const r of es ?? []) add(epTitle.get(r.episode_id as string) as string, r.file_id as string | null)
    }
  }
  const all = [...new Set([...files.values()].flat())]
  const removed = new Set<string>()
  const failed = new Map<string, string>() // fichier → raison
  for (const c of chunk(all, RM_CHUNK)) {
    try {
      const body = await onefichierCall('file/rm.cgi', { files: c.map((f) => ({ url: `https://1fichier.com/?${f}` })) }, LANE_ADMIN, { acceptKo: true })
      if (Array.isArray(body?.urls)) {
        for (const u of body.urls) {
          const id = fileIdOf(u)
          if (id) removed.add(id)
        }
        if (body.status === 'KO') {
          for (const f of c) if (!removed.has(f)) failed.set(f, String(body.message ?? 'refusé par 1fichier'))
        } else {
          for (const f of c) removed.add(f) // OK : tout le lot est supprimé
        }
      } else {
        for (const f of c) removed.add(f)
      }
    } catch (e) {
      // déjà absent chez 1fichier : rien à supprimer, le film peut partir
      if (e instanceof OnefichierError && e.failure === 'offline') for (const f of c) removed.add(f)
      else {
        for (const f of c) failed.set(f, (e as Error).message)
        if (e instanceof OnefichierError && e.failure === 'auth') break
      }
    }
  }
  const ok: string[] = []
  const kept: { id: string; reason: string }[] = []
  for (const id of ids) {
    const bad = (files.get(id) ?? []).find((f) => failed.has(f))
    if (bad) kept.push({ id, reason: failed.get(bad) ?? 'refusé par 1fichier' })
    else ok.push(id)
  }
  for (const c of chunk(ok, 100)) {
    const { error } = await db.from('titles').delete().in('id', c)
    if (error) throw new Error(error.message)
  }
  console.log('[onefichier-import] suppression', JSON.stringify({ titles: ok.length, files: removed.size, kept: kept.length }))
  return { deleted: ok.length, filesRemoved: removed.size, kept }
}

// ───────── Vérification ciblée (admin) : UN modèle ou UN dossier (ex. le répertoire de base après y avoir supprimé des fichiers).
// Seuls les fichiers de ce modèle / de ce dossier sont comparés au relevé 1fichier ; ceux des autres modèles, même rangés dans
// le même dossier, ne sont jamais marqués. Un fichier absent du relevé est vérifié un par un (file/info.cgi) avant d'être retiré :
// un fichier simplement déplacé vers un autre dossier reste en ligne et n'est pas retiré. Au plus VERIFY_CONFIRM_MAX vérifications
// par passage (les erreurs 404 répétées font bannir le compte) ; le reste est retiré par la surveillance après son délai de grâce
// (dossier complet) ou attend une nouvelle vérification (dossier tronqué à 5 000 fichiers, comme la racine).
const VERIFY_CONFIRM_MAX = 40
const VERIFY_BUDGET_MS = 130_000

type ScopeRow = { id: string; file_id: string; folder_id: number | null }

async function scopeSources(scope: 'model' | 'folder', target: string): Promise<ScopeRow[]> {
  const db = adminClient()
  const out: ScopeRow[] = []
  for (let from = 0; from < 50_000; from += 1000) {
    const q =
      scope === 'model'
        ? db.from('media_sources').select('id, file_id, folder_id, titles!inner(model_id)').eq('titles.model_id', target)
        : db.from('media_sources').select('id, file_id, folder_id').eq('folder_id', Number(target))
    const { data, error } = await q.eq('provider', 'onefichier').is('removed_at', null).not('file_id', 'is', null).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as Record<string, unknown>[]) out.push({ id: r.id as string, file_id: r.file_id as string, folder_id: r.folder_id == null ? null : Number(r.folder_id) })
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

async function runVerify(runId: string, scope: 'model' | 'folder', target: string) {
  const db = adminClient()
  const t0 = Date.now()
  const upd = (patch: Record<string, unknown>) => db.from('verify_runs').update(patch).eq('id', runId)
  try {
    const rows = await scopeSources(scope, target)
    await upd({ total: rows.length, message: `${rows.length} fichier(s) à comparer avec 1fichier…` })
    const byFolder = new Map<number | null, ScopeRow[]>()
    for (const r of rows) byFolder.set(r.folder_id, [...(byFolder.get(r.folder_id) ?? []), r])

    const confirmQueue: { row: ScopeRow; complete: boolean }[] = [] // absents du relevé, à vérifier un par un
    const skipped: string[] = []
    let absent = 0
    let folderLeft = byFolder.size
    for (const [folderId, list] of byFolder) {
      if (Date.now() - t0 > VERIFY_BUDGET_MS - 40_000) {
        skipped.push(`${folderLeft} dossier(s) pas encore relu(s) : relance la vérification`)
        break
      }
      folderLeft--
      if (folderId == null) {
        // dossier inconnu (fichier d'avant le suivi) : vérification une par une seulement
        for (const row of list) confirmQueue.push({ row, complete: false })
        absent += list.length
        continue
      }
      // 1fichier : un relevé par dossier toutes les 30 s ; on attend son tour au lieu d'abandonner
      let listing: Awaited<ReturnType<typeof listFolder>> | null = null
      let folderGone = false
      for (let i = 0; i < 3 && !listing && !folderGone; i++) {
        try {
          listing = await listFolder(folderId, { annotate: false, lane: LANE_ADMIN, files: true })
        } catch (e) {
          if (e instanceof OnefichierError && e.failure === 'host_busy' && /30 s/.test(e.message) && i < 2) {
            await new Promise((r) => setTimeout(r, 31_000))
            continue
          }
          if (e instanceof OnefichierError && e.failure === 'offline') {
            folderGone = true // dossier entier supprimé : chaque fichier est vérifié un par un
            break
          }
          throw e
        }
      }
      if (folderGone) {
        for (const row of list) confirmQueue.push({ row, complete: false })
        absent += list.length
        continue
      }
      if (!listing) continue
      const present = new Set(listing.files.map((f) => f.id))
      const missing = list.filter((r) => !present.has(r.file_id))
      // relevé douteux (réponse partielle de 1fichier ?) : on ne retire rien de ce dossier
      if (!listing.capped && missing.length > 20 && missing.length > list.length / 2) {
        skipped.push(`dossier ${folderId} : ${missing.length}/${list.length} absents, relevé douteux ignoré`)
        continue
      }
      absent += missing.length
      for (const row of missing) confirmQueue.push({ row, complete: !listing.capped })
      await upd({ absent })
    }

    // vérification une par une des absents (dans la limite du passage)
    const gone: string[] = []
    let confirmed = 0
    let stopped: string | null = null
    const left: { row: ScopeRow; complete: boolean }[] = []
    for (const item of confirmQueue) {
      if (stopped || confirmed >= VERIFY_CONFIRM_MAX || Date.now() - t0 > VERIFY_BUDGET_MS) {
        left.push(item)
        continue
      }
      try {
        await onefichierCall('file/info.cgi', { url: `https://1fichier.com/?${item.row.file_id}` }, LANE_ADMIN)
        // en ligne : déplacé vers un autre dossier (la surveillance le rattache), pas supprimé
      } catch (e) {
        if (e instanceof OnefichierError && e.failure === 'offline') gone.push(item.row.id)
        else {
          if (e instanceof OnefichierError && (e.failure === 'auth' || e.failure === 'host_busy')) stopped = e.message
          left.push(item)
          continue
        }
      }
      confirmed++
      if (confirmed % 5 === 0) await upd({ confirmed, removed: gone.length })
      await new Promise((r) => setTimeout(r, 500)) // en douceur : pas de rafale de 404
    }

    let removed = 0
    for (let i = 0; i < gone.length; i += 500) {
      const { data, error } = await db.rpc('verify_remove_sources', { p_ids: gone.slice(i, i + 500) })
      if (error) throw new Error(error.message)
      removed += Number(data ?? 0)
    }
    // non vérifiés, absents d'un relevé COMPLET : marqués manquants, retirés par la surveillance après le délai de grâce (20 min)
    const later = left.filter((x) => x.complete).map((x) => x.row.id)
    for (let i = 0; i < later.length; i += 200) {
      await db.from('media_sources').update({ missing_since: new Date().toISOString() }).in('id', later.slice(i, i + 200)).is('missing_since', null)
    }
    const recheck = left.length - later.length
    const parts = [
      removed ? `${removed} fichier(s) supprimé(s) chez 1fichier retiré(s) du site` : 'aucun fichier supprimé trouvé',
      confirmed - gone.length > 0 ? `${confirmed - gone.length} déplacé(s) (toujours en ligne, conservé(s))` : '',
      later.length ? `${later.length} retiré(s) dans 20 min environ (non vérifié(s) un par un)` : '',
      recheck ? `${recheck} à revérifier : relance la vérification` : '',
      stopped ? `1fichier a demandé une pause : ${stopped}` : '',
      ...skipped,
    ].filter(Boolean)
    await upd({ status: 'done', absent, confirmed, removed, pending: left.length, message: parts.join(' · '), finished_at: new Date().toISOString() })
  } catch (e) {
    await upd({ status: 'error', message: (e as Error).message.slice(0, 400), finished_at: new Date().toISOString() })
  }
}

// ───────── Déplacement vers un modèle (admin) : les fichiers partent d'abord dans le dossier 1fichier du modèle (file/mv.cgi),
// PUIS les vidéos sont rattachées au modèle sur le site. Dans cet ordre : la surveillance, qui range chaque fichier selon son
// dossier, retrouve ensuite exactement la même chose. Dossier du modèle : celui qui contient déjà le plus de ses fichiers, sinon
// le dossier portant son nom ; un modèle sans dossier en reçoit un, créé à la racine du compte à son nom.
const MV_CHUNK = 50

async function modelFolder(modelId: string): Promise<{ folderId: number; name: string; created: boolean }> {
  const db = adminClient()
  const { data: model, error } = await db.from('models').select('id, name').eq('id', modelId).maybeSingle()
  if (error || !model) throw new OnefichierError('unavailable', 'Modèle introuvable', 404)
  const name = String(model.name)
  if (name === 'Racine') return { folderId: 0, name, created: false }
  // dossier qui contient déjà le plus de fichiers du modèle (ex. « Posts / Videos »)
  const { data: rows } = await db
    .from('media_sources')
    .select('folder_id, titles!inner(model_id)')
    .eq('titles.model_id', modelId)
    .eq('provider', 'onefichier')
    .is('removed_at', null)
    .not('folder_id', 'is', null)
    .limit(1000)
  const counts = new Map<number, number>()
  for (const r of (rows ?? []) as { folder_id: number }[]) counts.set(Number(r.folder_id), (counts.get(Number(r.folder_id)) ?? 0) + 1)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (ranked.length) {
    const ids = ranked.map(([id]) => id)
    const { data: ws } = await db.from('watch_folders').select('folder_id, active, missing_since').in('folder_id', ids.slice(0, 20))
    const ok = new Set(((ws ?? []) as { folder_id: number; active: boolean; missing_since: string | null }[]).filter((w) => w.active && !w.missing_since).map((w) => Number(w.folder_id)))
    const best = ids.find((id) => ok.has(id))
    if (best != null) return { folderId: best, name, created: false }
  }
  // sinon le dossier au nom du modèle
  const { data: named } = await db.from('watch_folders').select('folder_id, name').eq('model_name', name).eq('active', true).is('missing_since', null).limit(20)
  const top = ((named ?? []) as { folder_id: number; name: string }[]).find((w) => w.name === name) ?? (named ?? [])[0]
  if (top) return { folderId: Number(top.folder_id), name, created: false }
  // aucun dossier : création à la racine (la surveillance le découvre et le rattache au modèle grâce à son nom)
  const made = await onefichierCall('folder/mkdir.cgi', { name: name.slice(0, 250), folder_id: 0 }, LANE_ADMIN)
  const fid = Number(made?.folder_id)
  if (!Number.isInteger(fid) || fid <= 0) throw new OnefichierError('unavailable', `1fichier n'a pas créé le dossier « ${name} »`, 502)
  await db.from('watch_folders').update({ next_scan_at: new Date().toISOString() }).eq('folder_id', 0) // la racine est relue : nouveau dossier repéré
  return { folderId: fid, name, created: true }
}

// deno-lint-ignore no-explicit-any
async function moveTitles(ids: string[], modelId: string | null, user: any) {
  const db = adminClient()
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
  // « Détacher du modèle » : rien ne bouge chez 1fichier (aucun dossier de destination)
  const dest = modelId ? await modelFolder(modelId) : null
  const files = new Map<string, { sid: string; fid: string }[]>() // titre → fichiers à déplacer
  if (dest) {
    for (const c of chunk(ids, 100)) {
      const { data, error } = await db.from('media_sources').select('id, title_id, file_id, folder_id').eq('provider', 'onefichier').is('removed_at', null).not('file_id', 'is', null).in('title_id', c)
      if (error) throw new Error(error.message)
      for (const r of (data ?? []) as { id: string; title_id: string; file_id: string; folder_id: number | null }[]) {
        if (r.folder_id != null && Number(r.folder_id) === dest.folderId) continue // déjà dans le dossier du modèle
        files.set(r.title_id, [...(files.get(r.title_id) ?? []), { sid: r.id, fid: r.file_id }])
      }
    }
  }
  const all = [...files.values()].flat()
  const moved = new Set<string>()
  const failed = new Map<string, string>()
  for (const c of chunk(all, MV_CHUNK)) {
    try {
      const body = await onefichierCall('file/mv.cgi', { urls: c.map((f) => `https://1fichier.com/?${f.fid}`), destination_folder_id: dest!.folderId }, LANE_ADMIN, { acceptKo: true })
      if (Array.isArray(body?.urls)) {
        for (const u of body.urls) {
          const id = fileIdOf(u)
          if (id) moved.add(id)
        }
        if (body.status === 'KO') {
          for (const f of c) if (!moved.has(f.fid)) failed.set(f.fid, String(body.message ?? 'refusé par 1fichier'))
        } else {
          for (const f of c) moved.add(f.fid)
        }
      } else {
        for (const f of c) moved.add(f.fid)
      }
    } catch (e) {
      for (const f of c) failed.set(f.fid, (e as Error).message)
      if (e instanceof OnefichierError && (e.failure === 'auth' || e.failure === 'host_busy')) break
    }
  }
  // le site suit : nouveau dossier des fichiers déplacés (la surveillance ne les croira pas disparus de l'ancien)
  const movedSids = all.filter((f) => moved.has(f.fid)).map((f) => f.sid)
  for (const c of chunk(movedSids, 200)) {
    await db.from('media_sources').update({ folder_id: dest!.folderId, missing_since: null, suspect_at: null }).in('id', c)
  }
  const ok: string[] = []
  const kept: { id: string; reason: string }[] = []
  for (const id of ids) {
    const bad = (files.get(id) ?? []).find((f) => failed.has(f.fid))
    if (bad) kept.push({ id, reason: failed.get(bad.fid) ?? 'refusé par 1fichier' })
    else ok.push(id)
  }
  // rattachement au modèle sur le site (même règle que la liste « Modèle » de l'admin, avec les droits de l'admin connecté)
  let attached = 0
  for (const c of chunk(ok, 500)) {
    const { data, error } = await user.rpc('admin_attach_titles', { p_model: modelId, p_title_ids: c })
    if (error) throw new Error(error.message)
    attached += Number(data ?? 0)
  }
  if (dest && moved.size) {
    // dossiers concernés relus au prochain passage : leur contenu a changé
    await db.from('watch_folders').update({ force_full: true, next_scan_at: new Date().toISOString() }).eq('folder_id', dest.folderId)
  }
  console.log('[onefichier-import] déplacement', JSON.stringify({ titles: ok.length, files: moved.size, kept: kept.length, folder: dest?.folderId }))
  return { moved: ok.length, attached, filesMoved: moved.size, kept, folder: dest ? { id: dest.folderId, created: dest.created } : null }
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
  if ((busy ?? 0) > 0) {
    // import en cours : pas de relevé de dossiers, mais les fichiers signalés morts sont quand même vérifiés et retirés
    const dead = await verifySuspects().catch(() => 0)
    const swept = await sweep().catch(() => '')
    return note(`Import en cours : surveillance en pause${dead ? `, ${dead} fichier(s) supprimé(s) chez 1fichier` : ''}${swept}`)
  }

  const { data: due } = await db
    .from('watch_folders')
    .select('folder_id, parent_id, name, model_name, has_children, force_full, full_at, files_count, size_bytes, parent_files, parent_size, imported_total, capped, win_turn, win_unsupported, win_cursor, win_span_days, recent_at, reassign_pending')
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

  // fichiers signalés morts par les lecteurs, puis balayage : retire du site ce qui manque
  let swept = ''
  if (!st.stopped) {
    const dead = await verifySuspects().catch((e) => (console.error('[onefichier-import] vérification', (e as Error).message), 0))
    if (dead) swept = `, ${dead} fichier(s) supprimé(s) chez 1fichier`
    swept += await sweep()
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
    if (body.action === 'verify_start') {
      const scope: 'model' | 'folder' = body.model_id ? 'model' : 'folder'
      const target = scope === 'model' ? String(body.model_id) : String(Number(body.folder_id ?? 0))
      const valid = scope === 'model' ? UUID_RE.test(target) : Number.isInteger(Number(target)) && Number(target) >= 0
      if (!valid) return json({ error: 'invalid_scope' }, 400)
      const db = adminClient()
      // une vérification à la fois (1fichier : débit limité)
      const { data: busy } = await db.from('verify_runs').select('id').eq('status', 'running').gt('created_at', new Date(Date.now() - 5 * 60_000).toISOString()).limit(1)
      if (busy?.length) return json({ error: 'busy', message: 'Une vérification est déjà en cours, patiente une minute.', run_id: busy[0].id }, 409)
      const { data: uid } = await user.auth.getUser()
      const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null
      const { data: run, error } = await db.from('verify_runs').insert({ scope, target, label, created_by: uid.user?.id, message: 'Démarrage…' }).select('id').single()
      if (error || !run) return json({ error: 'internal', message: error?.message }, 500)
      await background(runVerify(run.id, scope, target))
      return json({ run_id: run.id })
    }
    if (body.action === 'verify_status' && typeof body.run_id === 'string' && UUID_RE.test(body.run_id)) {
      const { data } = await adminClient().from('verify_runs').select('id, status, message, total, absent, confirmed, removed, pending, created_at, finished_at').eq('id', body.run_id).maybeSingle()
      if (!data) return json({ error: 'not_found' }, 404)
      // passage interrompu (fonction arrêtée) : signalé au lieu de tourner sans fin
      if (data.status === 'running' && Date.now() - new Date(data.created_at).getTime() > 5 * 60_000) {
        const message = 'Vérification interrompue : relance-la.'
        await adminClient().from('verify_runs').update({ status: 'error', message, finished_at: new Date().toISOString() }).eq('id', data.id)
        return json({ ...data, status: 'error', message })
      }
      return json(data)
    }
    if (body.action === 'move_titles') {
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x)))] : []
      if (ids.length === 0 || ids.length > 500) return json({ error: 'invalid_ids', max: 500 }, 400)
      const modelId = body.model_id == null ? null : String(body.model_id)
      if (modelId != null && !UUID_RE.test(modelId)) return json({ error: 'invalid_model' }, 400)
      return json(await moveTitles(ids as string[], modelId, user))
    }
    if (body.action === 'delete_titles') {
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x)))] : []
      if (ids.length === 0 || ids.length > 500) return json({ error: 'invalid_ids', max: 500 }, 400)
      return json(await deleteTitles(ids))
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
