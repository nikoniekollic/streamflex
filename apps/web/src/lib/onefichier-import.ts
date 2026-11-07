import { FunctionsHttpError } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'

export type RemoteFolder = { id: number; name: string; date: string | null }
export type RemoteFile = { id: string; name: string; size: number | null; date: string | null; known: boolean; video: boolean; ctype?: string | null }
export type ListingDebug = { keys: string[]; items: number; withId: number; sampleKeys: string[]; sampleUrl: string | null }
export type Listing = { folderName: string; folders: RemoteFolder[]; files: RemoteFile[]; debug?: ListingDebug }
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
