// Emojis : ~3 800 (avec teints de peau), noms et mots-clés en français — données Unicode/CLDR (emojibase), chargées à la demande
// depuis /emoji-fr.json (≈ 60 Ko compressé), jamais dans le bundle principal.
export type EmojiItem = { e: string; label: string; group: number; tags: string }
export type EmojiData = { groups: { key: string; label: string }[]; items: EmojiItem[] }

let promise: Promise<EmojiData> | null = null

export function loadEmojis(): Promise<EmojiData> {
  promise ??= fetch('/emoji-fr.json')
    .then((r) => {
      if (!r.ok) throw new Error('emoji')
      return r.json() as Promise<{ groups: EmojiData['groups']; items: [string, string, number, string][] }>
    })
    .then((d) => ({ groups: d.groups, items: d.items.map(([e, label, group, tags]) => ({ e, label, group, tags })) }))
    .catch((err) => {
      promise = null // on réessaiera à la prochaine ouverture
      throw err
    })
  return promise
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Recherche par nom ou mot-clé (sans accents), au plus `limit` résultats. */
export function searchEmojis(data: EmojiData, query: string, limit = 400): EmojiItem[] {
  const q = norm(query.trim())
  if (!q) return []
  const words = q.split(/\s+/)
  const out: EmojiItem[] = []
  for (const it of data.items) {
    const hay = norm(`${it.label} ${it.tags}`)
    if (words.every((w) => hay.includes(w))) {
      out.push(it)
      if (out.length >= limit) break
    }
  }
  return out
}

// ───────── Récents (appareil)
const RECENT_KEY = 'sf:emoji-recent'
export function recentEmojis(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? (v as string[]).slice(0, 32) : []
  } catch {
    return []
  }
}
export function rememberEmoji(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmojis().filter((x) => x !== e)].slice(0, 32)))
  } catch {
    /* stockage indisponible */
  }
}

// ───────── Détection dans un texte (titre, nom de modèle…)
const EMOJI_RE = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*/u

/** Premier emoji d'un texte, ou null : un emoji présent dans un titre ou un nom de modèle est repris sur la jaquette. */
export function firstEmoji(text: string | null | undefined): string | null {
  return text?.match(EMOJI_RE)?.[0] ?? null
}
