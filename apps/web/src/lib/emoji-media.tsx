import { cn } from '@/lib/utils'

// Une « icône d'emoji » enregistrée (bouton rond des jaquettes, emoji d'un modèle) peut être :
//  • un emoji Unicode ordinaire                 « 💰 »
//  • un emoji ANIMÉ Google Noto (881, licence CC BY 4.0)   « a:1f4b0 » / « a:2764_fe0f »
//  • une icône de la base Iconify (colorée ou monochrome)  « i:fluent-emoji-flat:money-bag »
// Les deux derniers sont des images : ils ne s'insèrent pas dans un texte (champs de formulaire), seulement dans les boutons ronds.

export const ANIM_PREFIX = 'a:'
export const ICON_PREFIX = 'i:'

export const animUrl = (cp: string) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.webp`
export const iconUrl = (id: string) => {
  const [prefix, ...name] = id.split(':')
  return `https://api.iconify.design/${prefix}/${name.join(':')}.svg?color=%23ffffff`
}

export const isRich = (v: string | null | undefined): v is string => !!v && (v.startsWith(ANIM_PREFIX) || v.startsWith(ICON_PREFIX))

/** « 1f468_200d_1f4bb » → le caractère emoji correspondant */
export const charOfCodepoint = (cp: string) => String.fromCodePoint(...cp.split('_').map((h) => parseInt(h, 16)))

/** Emoji texte équivalent (pour un champ de formulaire) ; vide pour une icône sans équivalent Unicode. */
export const plainEmoji = (v: string) => (v.startsWith(ANIM_PREFIX) ? charOfCodepoint(v.slice(ANIM_PREFIX.length)) : v.startsWith(ICON_PREFIX) ? '' : v)

/** Affiche une icône d'emoji (texte, animée ou Iconify) à la taille de la police courante. */
export function EmojiView({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return null
  if (value.startsWith(ANIM_PREFIX)) return <img src={animUrl(value.slice(ANIM_PREFIX.length))} alt="" draggable={false} className={cn('inline-block size-[1.15em] object-contain', className)} />
  if (value.startsWith(ICON_PREFIX)) return <img src={iconUrl(value.slice(ICON_PREFIX.length))} alt="" draggable={false} className={cn('inline-block size-[1.15em] object-contain', className)} />
  return <span className={className}>{value}</span>
}

// ───────── Emojis animés : liste officielle Noto (chargée à la demande)
export type AnimatedEmoji = { cp: string; char: string; tags: string }
let animated: Promise<AnimatedEmoji[]> | null = null

export function loadAnimated(): Promise<AnimatedEmoji[]> {
  animated ??= fetch('https://googlefonts.github.io/noto-emoji-animation/data/api.json')
    .then((r) => {
      if (!r.ok) throw new Error('anim')
      return r.json() as Promise<{ icons: { codepoint: string; tags: string[]; popularity: number }[] }>
    })
    .then((d) =>
      d.icons
        .slice()
        .sort((a, b) => b.popularity - a.popularity)
        .map((i) => ({ cp: i.codepoint, char: charOfCodepoint(i.codepoint), tags: i.tags.join(' ').replace(/[:-]/g, ' ') })),
    )
    .catch((err) => {
      animated = null
      throw err
    })
  return animated
}

// ───────── Icônes Iconify (recherche)
// Jeux colorés « emoji » d'abord, puis icônes monochromes ; sites d'origine : Microsoft Fluent Emoji, Google Noto, Twemoji, Material Design…
const PREFIXES = 'fluent-emoji-flat,fluent-emoji,noto,twemoji,streamline-emojis,openmoji,emojione,line-md,mdi'

/** Mots courants français → anglais (Iconify est en anglais) ; un mot inconnu est cherché tel quel. */
const FR: Record<string, string> = {
  argent: 'money',
  billet: 'cash',
  billets: 'cash',
  piece: 'coin',
  pieces: 'coin',
  pièce: 'coin',
  pièces: 'coin',
  dollar: 'dollar',
  euro: 'euro',
  diamant: 'diamond',
  banque: 'bank',
  carte: 'credit card',
  or: 'gold',
  riche: 'rich',
  adulte: 'adult',
  adultes: 'adult',
  sexy: 'kiss',
  baiser: 'kiss',
  levres: 'lips',
  lèvres: 'lips',
  bouche: 'mouth',
  langue: 'tongue',
  fesses: 'peach',
  peche: 'peach',
  pêche: 'peach',
  aubergine: 'eggplant',
  gouttes: 'sweat droplets',
  eau: 'water',
  maillot: 'bikini',
  lingerie: 'bikini',
  coeur: 'heart',
  cœur: 'heart',
  amour: 'love',
  feu: 'fire',
  etoile: 'star',
  étoile: 'star',
  couronne: 'crown',
  diable: 'devil',
  demon: 'devil',
  alcool: 'cocktail',
  champagne: 'champagne',
  fete: 'party',
  fête: 'party',
  jeu: 'game',
  casino: 'slot machine',
  cadenas: 'lock',
  secret: 'shushing',
  video: 'video',
  vidéo: 'video',
  camera: 'camera',
  caméra: 'camera',
  film: 'film',
  lecture: 'play',
  chat: 'cat',
  chien: 'dog',
  fleur: 'flower',
  soleil: 'sun',
  lune: 'moon',
}

export type IconHit = { id: string; animated: boolean }

/** Recherche dans Iconify : « argent » → money… ; renvoie des identifiants « prefixe:nom ». */
export async function searchIcons(query: string, signal?: AbortSignal): Promise<IconHit[]> {
  const q = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => FR[w] ?? w)
    .join(' ')
  if (!q) return []
  const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=120&prefixes=${PREFIXES}`, { signal })
  if (!r.ok) throw new Error('icons')
  const d = (await r.json()) as { icons: string[] }
  return d.icons.map((id) => ({ id, animated: id.startsWith('line-md:') }))
}
