import type { TypedSupabaseClient } from '@/lib/supabase'
import { DebridClientError } from '@/lib/alldebrid'

// Fichiers effacés chez 1fichier : le navigateur qui tombe dessus (Alldebrid : lien supprimé) le signale au serveur.
// La surveillance relit alors son dossier (ou vérifie le fichier auprès de 1fichier) au passage suivant, ≤ 5 min, et le retire
// du site : plus de lecteur noir sur un fichier qui n'existe plus. Rien n'est retiré sur ce seul signalement.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// LINK_TEMPORARY_UNAVAILABLE : hébergeur momentanément indisponible, pas un fichier supprimé
const GONE_CODES = /^LINK_DOWN$|^LINK_NOT_FOUND|^LINK_ERROR$|^DELAYED_FAILED$/

const sent = new Set<string>()
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

/** L'erreur de débridage dit-elle que le fichier n'existe plus ? */
export const isGoneError = (e: unknown): boolean => e instanceof DebridClientError && e.failure === 'offline' && GONE_CODES.test(e.code)

/** Signale un film dont le fichier semble supprimé (une fois par session, envoyés par lots). */
export function reportDeadTitle(s: TypedSupabaseClient, titleId: string) {
  if (!UUID.test(titleId) || sent.has(titleId)) return
  sent.add(titleId)
  queue.add(titleId)
  schedule(s)
}

function schedule(s: TypedSupabaseClient) {
  timer ??= setTimeout(() => {
    timer = null
    const ids = [...queue].slice(0, 30)
    ids.forEach((id) => queue.delete(id))
    void (s as unknown as { rpc: (n: string, a: object) => PromiseLike<{ error: unknown }> })
      .rpc('report_dead_titles', { p_titles: ids })
      .then(({ error }) => error && console.warn('[StreamFlex] signalement de fichiers supprimés impossible', error))
    if (queue.size) schedule(s) // reste : lot suivant
  }, 3000)
}
