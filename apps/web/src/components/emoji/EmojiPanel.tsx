import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadEmojis, recentEmojis, rememberEmoji, searchEmojis, supportedEmojis, type EmojiData } from '@/lib/emoji'

// Un emoji représentatif par catégorie pour les onglets
const TAB_ICONS = ['😀', '🧑', '🐶', '🍔', '✈️', '⚽', '💡', '❤️', '🏁']
const STEP = 400 // rendu par paquets : 3 900 boutons d'un coup ralentiraient l'ouverture
const FLAGS = 8 // groupe « drapeaux » (Windows n'affiche pas les drapeaux : lettres à la place)

/** Image Twemoji d'un emoji (affichage identique sur tous les appareils, y compris drapeaux et emojis trop récents pour la police). */
const twemoji = (e: string) => {
  const cps = [...e].map((c) => c.codePointAt(0)!.toString(16))
  const keep = cps.includes('200d')
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${(keep ? cps : cps.filter((c) => c !== 'fe0f')).join('-')}.svg`
}

function Glyph({ e, image }: { e: string; image: boolean }) {
  const [bad, setBad] = useState(false)
  if (!image) return <>{e}</>
  if (bad) return <span className="text-xs text-neutral-600">·</span>
  return <img src={twemoji(e)} alt={e} loading="lazy" draggable={false} onError={() => setBad(true)} className="size-6" />
}

type Entry = { h: string; g: number } | { e: string; label: string; img: boolean }

/** Sélecteur d'emojis façon Telegram : liste défilante de TOUS les emojis Unicode (≈ 3 960, teints de peau et drapeaux compris), récents, recherche en français. */
export function EmojiPanel({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) {
  const [data, setData] = useState<(EmojiData & { ok: Set<string> }) | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(STEP)
  const [jump, setJump] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const recents = useMemo(() => recentEmojis(), [])

  useEffect(() => {
    void loadEmojis().then(
      (d) =>
        setTimeout(() => {
          // les emojis que la police de l'appareil ne sait pas dessiner passent par une image au lieu d'un carré vide
          setData({ ...d, ok: supportedEmojis(d.items) })
        }, 0),
      () => setFailed(true),
    )
  }, [])

  const entries = useMemo<Entry[]>(() => {
    if (!data) return []
    const img = (e: string, g: number) => g === FLAGS || !data.ok.has(e)
    const out: Entry[] = []
    const known = new Map(data.items.map((i) => [i.e, i]))
    const rec = recents.filter((e) => known.has(e))
    if (rec.length) {
      out.push({ h: 'Récents', g: -1 })
      for (const e of rec) out.push({ e, label: '', img: img(e, known.get(e)!.group) })
    }
    let last = -2
    for (const i of data.items) {
      if (i.group !== last) {
        out.push({ h: data.groups[i.group]?.label ?? '', g: i.group })
        last = i.group
      }
      out.push({ e: i.e, label: i.label, img: img(i.e, i.group) })
    }
    return out
  }, [data, recents])

  const results = useMemo(() => (data && q.trim() ? searchEmojis(data, q).map((i) => ({ e: i.e, label: i.label, img: i.group === FLAGS || !data.ok.has(i.e) })) : []), [data, q])

  useEffect(() => {
    setShown(STEP)
    scroller.current?.scrollTo({ top: 0 })
  }, [q])

  // saut vers une catégorie : on affiche d'abord tout ce qui précède, puis on fait défiler jusqu'à son titre
  useEffect(() => {
    if (jump === null) return
    const idx = entries.findIndex((x) => 'h' in x && x.g === jump)
    if (idx < 0) return setJump(null)
    if (idx + STEP > shown) return setShown(idx + STEP)
    const el = scroller.current?.querySelector<HTMLElement>(`[data-sec="${jump}"]`)
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - scroller.current.offsetTop - 2 })
    setJump(null)
  }, [jump, shown, entries])

  const pick = (e: string) => {
    rememberEmoji(e)
    onPick(e)
  }
  const total = q.trim() ? results.length : entries.length

  return (
    <div data-emoji-panel data-no-emoji className={cn('flex h-[26rem] w-80 max-w-[92vw] flex-col overflow-hidden rounded-lg border border-white/15 bg-neutral-950 text-white shadow-2xl', className)}>
      <div className="relative border-b border-white/10 p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un emoji (ex. cœur, feu, rire)…"
          aria-label="Rechercher un emoji"
          data-no-emoji
          autoFocus
          className="h-9 w-full rounded-md bg-neutral-900 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-white/30"
        />
      </div>
      {!q.trim() && (
        <div className="flex border-b border-white/10 px-1 py-1" role="tablist" aria-label="Catégories d’emojis">
          {recents.length > 0 && (
            <button type="button" role="tab" title="Récents" onClick={() => setJump(-1)} className="flex size-8 flex-1 items-center justify-center rounded-md hover:bg-white/10">
              <Clock className="size-4" />
            </button>
          )}
          {TAB_ICONS.map((icon, i) => (
            <button key={i} type="button" role="tab" title={data?.groups[i]?.label} onClick={() => setJump(i)} className="flex size-8 flex-1 items-center justify-center rounded-md text-base hover:bg-white/10">
              {icon}
            </button>
          ))}
        </div>
      )}
      <div
        ref={scroller}
        className="relative flex-1 overflow-y-auto overscroll-contain p-1.5"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) setShown((n) => Math.min(n + STEP, total))
        }}
      >
        {!data && !failed && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-neutral-400" />
          </div>
        )}
        {failed && <p className="p-4 text-center text-sm text-neutral-400">Liste d’emojis indisponible. Réessaie dans un instant.</p>}
        {data && q.trim() && results.length === 0 && <p className="p-4 text-center text-sm text-neutral-400">Aucun emoji trouvé.</p>}
        <div className="grid grid-cols-8 gap-0.5">
          {(q.trim() ? results : entries).slice(0, shown).map((it, i) =>
            'h' in it ? (
              <p key={`h${it.g}`} data-sec={it.g} className="sticky top-[-6px] z-10 col-span-8 -mx-1.5 bg-neutral-950 px-2.5 py-1.5 text-xs font-semibold text-neutral-400 first-letter:uppercase">
                {it.h}
              </p>
            ) : (
              <button key={`${it.e}-${i}`} type="button" title={it.label} onClick={() => pick(it.e)} className="flex size-9 items-center justify-center rounded-md text-2xl leading-none hover:bg-white/15">
                <Glyph e={it.e} image={it.img} />
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
