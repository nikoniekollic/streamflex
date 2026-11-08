// Emojis : ~3 800 (avec teints de peau), noms et mots-clés en français — données Unicode/CLDR (emojibase), chargées à la demande
// depuis /emoji-fr.json (≈ 60 Ko compressé), jamais dans le bundle principal.
export type EmojiItem = { e: string; label: string; group: number; tags: string }
export type EmojiData = { groups: { key: string; label: string }[]; items: EmojiItem[] }

let promise: Promise<EmojiData> | null = null

export function loadEmojis(): Promise<EmojiData> {
  promise ??= fetch('/emoji-fr.json?v=18')
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
  const starts: EmojiItem[] = [] // un mot du nom commence par la recherche (« feu » → 🔥) : en premier
  const inside: EmojiItem[] = [] // la recherche est au milieu d'un mot (« golfeur ») : ensuite
  for (const it of data.items) {
    const hay = norm(`${it.label} ${it.tags}`)
    if (!words.every((w) => hay.includes(w))) continue
    const tokens = hay.split(/[^a-z0-9]+/)
    ;(words.every((w) => tokens.some((t) => t.startsWith(w))) ? starts : inside).push(it)
  }
  return [...starts, ...inside].slice(0, limit)
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

// ───────── Emojis réellement affichables sur cet appareil
// Les emojis récents (Unicode 16-18) apparaissent comme un carré vide sur un système dont la police est ancienne : on les écarte
// du sélecteur plutôt que d'afficher des cases vides. Test : dessin sur canvas, comparé au « carré vide » du système.
let supported: Set<string> | null = null

export function supportedEmojis(items: EmojiItem[]): Set<string> {
  if (supported) return supported
  const out = new Set<string>()
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas')
    ctx.font = '22px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif'
    ctx.textBaseline = 'top'
    const sig = (t: string) => {
      ctx.clearRect(0, 0, 32, 32)
      ctx.fillText(t, 2, 2)
      const d = ctx.getImageData(0, 0, 32, 32).data
      let h = 0
      let ink = 0
      for (let i = 0; i < d.length; i += 4) {
        h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) | 0
        if (d[i + 3] > 0) ink++
      }
      return { h, ink }
    }
    const tofu = sig(String.fromCodePoint(0x10fffe))
    const base = ctx.measureText('😀').width || 28
    for (const it of items) {
      const w = ctx.measureText(it.e).width
      if (w > base * 1.7) continue // séquence non reconnue : dessinée en plusieurs morceaux
      const s2 = sig(it.e)
      if (s2.ink === 0 || (s2.h === tofu.h && s2.ink === tofu.ink)) continue
      out.add(it.e)
    }
  } catch {
    items.forEach((i) => out.add(i.e)) // pas de canvas : on montre tout
  }
  supported = out
  return out
}
