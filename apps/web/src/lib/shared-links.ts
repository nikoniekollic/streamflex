import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypedSupabaseClient } from '@/lib/supabase'

// Dépôt des liens débridés dans le cache partagé du serveur (table unlocked_links) : les abonnés suivants les reçoivent
// directement, sans nouveau débridage. Envoi groupé (un appel pour tous les liens obtenus dans la même demi-seconde).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const queue = new Map<string, { title_id: string; url: string; replace: boolean }>()
let timer: ReturnType<typeof setTimeout> | null = null
let client: TypedSupabaseClient | null = null

async function flush() {
  timer = null
  const s = client
  const items = [...queue.values()].slice(0, 50)
  items.forEach((i) => queue.delete(i.title_id))
  if (!s || items.length === 0) return
  // erreur silencieuse : le partage est une optimisation, jamais une condition de lecture
  await (s as unknown as SupabaseClient).rpc('share_unlocked_links', { p_items: items })
  if (queue.size) timer = setTimeout(() => void flush(), 500)
}

/** `replace` : le lien précédemment partagé s'est révélé mort, celui-ci le remplace. */
export function shareLink(s: TypedSupabaseClient, titleId: string, url: string, replace = false) {
  if (!UUID.test(titleId) || !url.startsWith('https://')) return
  client = s
  const cur = queue.get(titleId)
  queue.set(titleId, { title_id: titleId, url, replace: replace || !!cur?.replace })
  timer ??= setTimeout(() => void flush(), 500)
}
