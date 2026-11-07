import { FunctionsHttpError } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'

export type RemoteFolder = { id: number; name: string; date: string | null }
export type RemoteFile = { id: string; name: string; size: number | null; date: string | null; known: boolean; video: boolean; ctype?: string | null }
export type ListingDebug = { keys: string[]; items: number; withId: number; sampleKeys: string[]; sampleUrl: string | null; sample?: string | null; foldersRaw?: number; hadItems?: boolean }
export type Listing = { folderName: string; folders: RemoteFolder[]; files: RemoteFile[]; debug?: ListingDebug; capped?: boolean }
export type ImportResult = { id: string; name: string; status: 'success' | 'ignored' | 'failed'; reason?: string }

const MESSAGES: Record<string, string> = {
  forbidden: 'Action réservée aux administrateurs.',
  host_busy: '1fichier est en pause pour protéger ton compte (cadence ou plafond atteint). Réessaie plus tard.',
  auth: 'Clé API 1fichier refusée ou compte non premium (appels suspendus par sécurité).',
  unavailable: '1fichier est injoignable ou a répondu de façon inattendue.',
  offline: 'Dossier introuvable sur 1fichier.',
}

async function call<T>(supabase: TypedSupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('onefichier-import', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const b = (await error.context.json().catch(() => ({}))) as { error?: string; message?: string }
      throw new Error(b.message ?? MESSAGES[b.error ?? ''] ?? b.error ?? 'Erreur du serveur')
    }
    throw new Error('Serveur injoignable')
  }
  return data as T
}

export const listFolder = (s: TypedSupabaseClient, folderId: number) => call<Listing>(s, { action: 'ls', folder_id: folderId })

export async function importFiles(s: TypedSupabaseClient, files: Pick<RemoteFile, 'id' | 'name' | 'size' | 'ctype'>[], publish: boolean, model: string | null) {
  const { results } = await call<{ results: ImportResult[] }>(s, { action: 'import', files, publish, model })
  return results
}

export type ImportJob = {
  id: string
  root_name: string | null
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'error'
  publish: boolean
  folders_done: number
  folders_left: number
  files_seen: number
  imported: number
  ignored: number
  failed: number
  current_folder: string | null
  last_message: string | null
  resume_at: string | null
  created_at: string
  completed_at: string | null
}

export type ModelMode = 'children' | 'inherit'

/** modelMode : « children » = chaque sous-dossier direct est un modèle ; « inherit » = le dossier choisi est LE modèle. reassign = corrige aussi les fichiers déjà importés. */
export const startImportJob = (
  s: TypedSupabaseClient,
  folderId: number,
  name: string,
  publish: boolean,
  modelPerFolder: boolean,
  modelMode: ModelMode = 'children',
  reassign = false,
) => call<{ job_id: string }>(s, { action: 'job_start', folder_id: folderId, name, publish, model_per_folder: modelPerFolder, model_mode: modelMode, reassign })

/** Avancement des derniers jobs ; relance aussi ceux qui sont bloqués (battement de cœur). */
export const fetchImportJobs = async (s: TypedSupabaseClient) => (await call<{ jobs: ImportJob[] }>(s, { action: 'job_status' })).jobs

export const cancelImportJob = (s: TypedSupabaseClient, jobId: string) => call<{ ok: boolean }>(s, { action: 'job_cancel', job_id: jobId })
