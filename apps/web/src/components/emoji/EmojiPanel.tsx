import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadEmojis, recentEmojis, rememberEmoji, searchEmojis, type EmojiData } from '@/lib/emoji'

// Un emoji représentatif par catégorie pour les onglets
const TAB_ICONS = ['😀', '🧑', '🐶', '🍔', '✈️', '⚽', '💡', '❤️', '🏁']
const STEP = 320 // rendu par paquets : 3 800 boutons d'un coup ralentiraient l'ouverture

/** Sélecteur d'emojis façon Telegram : récents, catégories, recherche en français (≈ 3 800 emojis, teints de peau compris). */
export function EmojiPanel({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) {
  const [data, setData] = useState<EmojiData | null>(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<number>(() => (recentEmojis().length ? -1 : 0))
  const [shown, setShown] = useState(STEP)
  const scroller = useRef<HTMLDivElement>(null)
  const recents = useMemo(() => recentEmojis(), [])

  useEffect(() => {
    void loadEmojis().then(setData, () => setFailed(true))
  }, [])

  useEffect(() => {
    setShown(STEP)
    scroller.current?.scrollTo({ top: 0 })
  }, [tab, q])

  const list = useMemo(() => {
    if (!data) return []
    if (q.trim()) return searchEmojis(data, q).map((i) => ({ e: i.e, label: i.label }))
    if (tab === -1) return recents.map((e) => ({ e, label: '' }))
    return data.items.filter((i) => i.group === tab).map((i) => ({ e: i.e, label: i.label }))
  }, [data, q, tab, recents])

  const pick = (e: string) => {
    rememberEmoji(e)
    onPick(e)
  }

  return (
    <div data-emoji-panel data-no-emoji className={cn('flex h-96 w-80 max-w-[92vw] flex-col overflow-hidden rounded-lg border border-white/15 bg-neutral-950 text-white shadow-2xl', className)}>
      <div className="relative border-b border-white/10 p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un emoji (ex. cœur, feu, rire)…"
          aria-label="Rechercher un emoji"
          data-no-emoji
          className="h-9 w-full rounded-md bg-neutral-900 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-white/30"
        />
      </div>
      {!q.trim() && (
        <div className="flex border-b border-white/10 px-1 py-1" role="tablist" aria-label="Catégories d’emojis">
          <button type="button" role="tab" aria-selected={tab === -1} title="Récents" onClick={() => setTab(-1)} className={cn('flex size-8 flex-1 items-center justify-center rounded-md hover:bg-white/10', tab === -1 && 'bg-white/15')}>
            <Clock className="size-4" />
          </button>
          {TAB_ICONS.map((icon, i) => (
            <button key={i} type="button" role="tab" aria-selected={tab === i} title={data?.groups[i]?.label} onClick={() => setTab(i)} className={cn('flex size-8 flex-1 items-center justify-center rounded-md text-base hover:bg-white/10', tab === i && 'bg-white/15')}>
              {icon}
            </button>
          ))}
        </div>
      )}
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto overscroll-contain p-1.5"
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) setShown((n) => Math.min(n + STEP, list.length))
        }}
      >
        {!data && !failed && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-neutral-400" />
          </div>
        )}
        {failed && <p className="p-4 text-center text-sm text-neutral-400">Liste d’emojis indisponible. Réessaie dans un instant.</p>}
        {data && list.length === 0 && <p className="p-4 text-center text-sm text-neutral-400">{q.trim() ? 'Aucun emoji trouvé.' : 'Aucun emoji récent.'}</p>}
        <div className="grid grid-cols-8 gap-0.5">
          {list.slice(0, shown).map((it, i) => (
            <button key={`${it.e}-${i}`} type="button" title={it.label} onClick={() => pick(it.e)} className="flex size-9 items-center justify-center rounded-md text-2xl leading-none hover:bg-white/15">
              {it.e}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
