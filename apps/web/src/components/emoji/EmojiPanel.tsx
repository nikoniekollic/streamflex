import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadEmojis, recentEmojis, rememberEmoji, searchEmojis, supportedEmojis, type EmojiData } from '@/lib/emoji'
import { ANIM_PREFIX, ICON_PREFIX, animUrl, iconUrl, loadAnimated, searchIcons, type AnimatedEmoji, type IconHit } from '@/lib/emoji-media'

// Un emoji représentatif par catégorie pour les onglets
const TAB_ICONS = ['😀', '🧑', '🐶', '🍔', '✈️', '⚽', '💡', '❤️', '🏁']
const STEP = 400 // rendu par paquets : 3 900 boutons d'un coup ralentiraient l'ouverture
const FLAGS = 8 // groupe « drapeaux » (Windows n'affiche pas les drapeaux : lettres à la place)

// Sections thématiques placées en tête de la liste (emojis Unicode standard, déjà présents plus bas dans leur catégorie)
const MONEY = ['💰', '💵', '💴', '💶', '💷', '💸', '💳', '🪙', '🤑', '💎', '💲', '💱', '🏦', '🏧', '🧾', '💹', '📈', '📉', '🪪', '🧧', '🎰', '🎲', '💼', '🤝', '🏆', '👑']
const ADULT = ['🔞', '🍑', '🍆', '💦', '👅', '👄', '🫦', '💋', '🍒', '🍌', '🍓', '🌶️', '🥒', '🍾', '🥂', '🍷', '🍸', '🍹', '🍻', '🔥', '😈', '👿', '😏', '🥵', '🥴', '😘', '😍', '🤤', '🫣', '🙈', '🙊', '👙', '🩱', '🩲', '🩳', '👠', '👗', '👢', '🛁', '🚿', '🛏️', '🧴', '⛓️', '🔒', '🔑', '🎭', '💃', '🕺', '❤️‍🔥', '💘', '💝', '💞', '😻', '🍩', '🌭']
const MONEY_G = 100
const ADULT_G = 101

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
type Kind = 'emoji' | 'anim' | 'icon'

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const bare = (s: string) => s.replace(/️/g, '')

const SUGGESTIONS = ['argent', 'billets', 'pièces', 'diamant', 'adulte', 'baiser', 'lèvres', 'pêche', 'aubergine', 'maillot', 'cœur', 'feu', 'couronne', 'casino', 'alcool', 'diable']

/**
 * Sélecteur façon Telegram : liste défilante de TOUS les emojis Unicode (≈ 3 960, teints de peau et drapeaux compris), sections
 * Argent et Adulte, récents, recherche en français. Avec `rich` : onglets « Animés » (881 emojis animés Google Noto) et
 * « Icônes » (recherche dans la base Iconify : argent, adulte, etc.) pour les boutons ronds des jaquettes.
 * Un emoji animé ou une icône est renvoyé sous la forme « a:… » / « i:… » (voir lib/emoji-media).
 */
export function EmojiPanel({ onPick, className, rich = false }: { onPick: (emoji: string) => void; className?: string; rich?: boolean }) {
  const [data, setData] = useState<(EmojiData & { ok: Set<string> }) | null>(null)
  const [failed, setFailed] = useState(false)
  const [kind, setKind] = useState<Kind>('emoji')
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

  // ───── onglet Emojis
  const entries = useMemo<Entry[]>(() => {
    if (!data) return []
    const img = (e: string, g: number) => g === FLAGS || !data.ok.has(e)
    const out: Entry[] = []
    const known = new Map(data.items.map((i) => [i.e, i]))
    const section = (title: string, g: number, list: string[]) => {
      const ok = list.filter((e) => known.has(e))
      if (!ok.length) return
      out.push({ h: title, g })
      for (const e of ok) out.push({ e, label: known.get(e)!.label, img: img(e, known.get(e)!.group) })
    }
    section('Récents', -1, recents)
    section('Argent', MONEY_G, MONEY)
    section('Adulte (18+)', ADULT_G, ADULT)
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

  // ───── onglet Animés
  const [anim, setAnim] = useState<AnimatedEmoji[] | null>(null)
  const [animFailed, setAnimFailed] = useState(false)
  useEffect(() => {
    if (kind !== 'anim' || anim) return
    loadAnimated().then(setAnim, () => setAnimFailed(true))
  }, [kind, anim])
  const animList = useMemo(() => {
    if (!anim) return []
    const words = norm(q.trim()).split(/\s+/).filter(Boolean)
    if (!words.length) return anim
    const label = new Map((data?.items ?? []).map((i) => [bare(i.e), `${i.label} ${i.tags}`]))
    return anim.filter((a) => {
      const hay = norm(`${label.get(bare(a.char)) ?? ''} ${a.tags}`)
      return words.every((w) => hay.includes(w))
    })
  }, [anim, data, q])

  // ───── onglet Icônes (Iconify)
  const [icons, setIcons] = useState<IconHit[]>([])
  const [iconBusy, setIconBusy] = useState(false)
  const [iconErr, setIconErr] = useState(false)
  useEffect(() => {
    if (kind !== 'icon') return
    if (!q.trim()) {
      setIcons([])
      return
    }
    setIconBusy(true)
    setIconErr(false)
    const ctl = new AbortController()
    const t = setTimeout(() => {
      searchIcons(q, ctl.signal).then(
        (r) => {
          setIcons(r)
          setIconBusy(false)
        },
        (e) => {
          if ((e as Error).name === 'AbortError') return
          setIconErr(true)
          setIconBusy(false)
        },
      )
    }, 350)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [kind, q])

  useEffect(() => {
    setShown(STEP)
    scroller.current?.scrollTo({ top: 0 })
  }, [q, kind])

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
    if (!e.startsWith(ANIM_PREFIX) && !e.startsWith(ICON_PREFIX)) rememberEmoji(e)
    onPick(e)
  }
  const total = kind === 'anim' ? animList.length : kind === 'icon' ? icons.length : q.trim() ? results.length : entries.length

  const kinds: { k: Kind; label: string }[] = [
    { k: 'emoji', label: 'Emojis' },
    { k: 'anim', label: 'Animés' },
    { k: 'icon', label: 'Icônes' },
  ]

  return (
    <div data-emoji-panel data-no-emoji className={cn('flex h-[26rem] w-80 max-w-[92vw] flex-col overflow-hidden rounded-lg border border-white/15 bg-neutral-950 text-white shadow-2xl', className)}>
      {rich && (
        <div className="flex gap-1 border-b border-white/10 p-1.5" role="tablist" aria-label="Type d’icône">
          {kinds.map(({ k, label }) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn('h-7 flex-1 rounded-md text-xs font-medium hover:bg-white/10', kind === k && 'bg-white/20')}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="relative border-b border-white/10 p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === 'icon' ? 'Rechercher une icône (ex. argent, adulte, couronne)…' : 'Rechercher un emoji (ex. cœur, feu, rire)…'}
          aria-label="Rechercher"
          data-no-emoji
          autoFocus
          className="h-9 w-full rounded-md bg-neutral-900 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-white/30"
        />
      </div>
      {kind === 'emoji' && !q.trim() && (
        <div className="flex border-b border-white/10 px-1 py-1" role="tablist" aria-label="Catégories d’emojis">
          {recents.length > 0 && (
            <button type="button" role="tab" title="Récents" onClick={() => setJump(-1)} className="flex size-7 flex-1 items-center justify-center rounded-md hover:bg-white/10">
              <Clock className="size-4" />
            </button>
          )}
          <button type="button" role="tab" title="Argent" onClick={() => setJump(MONEY_G)} className="flex size-7 flex-1 items-center justify-center rounded-md text-sm hover:bg-white/10">
            💰
          </button>
          <button type="button" role="tab" title="Adulte (18+)" onClick={() => setJump(ADULT_G)} className="flex size-7 flex-1 items-center justify-center rounded-md text-sm hover:bg-white/10">
            🔞
          </button>
          {TAB_ICONS.map((icon, i) => (
            <button key={i} type="button" role="tab" title={data?.groups[i]?.label} onClick={() => setJump(i)} className="flex size-7 flex-1 items-center justify-center rounded-md text-sm hover:bg-white/10">
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
        {kind === 'emoji' && (
          <>
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
          </>
        )}

        {kind === 'anim' && (
          <>
            {!anim && !animFailed && (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-neutral-400" />
              </div>
            )}
            {animFailed && <p className="p-4 text-center text-sm text-neutral-400">Emojis animés indisponibles. Réessaie dans un instant.</p>}
            {anim && animList.length === 0 && <p className="p-4 text-center text-sm text-neutral-400">Aucun emoji animé trouvé.</p>}
            {anim && <p className="px-1 pb-1 text-[10px] text-neutral-500">{animList.length} emojis animés Google Noto (CC BY 4.0)</p>}
            <div className="grid grid-cols-6 gap-1">
              {animList.slice(0, shown).map((a) => (
                <button key={a.cp} type="button" title={a.tags} onClick={() => pick(`${ANIM_PREFIX}${a.cp}`)} className="flex size-12 items-center justify-center rounded-md hover:bg-white/15">
                  <img src={animUrl(a.cp)} alt={a.char} loading="lazy" draggable={false} className="size-9" />
                </button>
              ))}
            </div>
          </>
        )}

        {kind === 'icon' && (
          <>
            {!q.trim() && (
              <div className="p-1">
                <p className="mb-2 text-xs text-neutral-400">Base d’icônes Iconify : emojis colorés (Microsoft Fluent, Google Noto, Twemoji…) et icônes simples. Tape un mot ou choisis une idée :</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => setQ(s)} className="rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {iconBusy && (
              <div className="flex justify-center p-4">
                <Loader2 className="size-5 animate-spin text-neutral-400" />
              </div>
            )}
            {iconErr && <p className="p-4 text-center text-sm text-neutral-400">Recherche d’icônes indisponible. Réessaie dans un instant.</p>}
            {!iconBusy && !iconErr && q.trim() && icons.length === 0 && <p className="p-4 text-center text-sm text-neutral-400">Aucune icône trouvée (essaie le mot en anglais).</p>}
            <div className="grid grid-cols-6 gap-1">
              {icons.slice(0, shown).map((ic) => (
                <button key={ic.id} type="button" title={ic.id} onClick={() => pick(`${ICON_PREFIX}${ic.id}`)} className="flex size-12 items-center justify-center rounded-md hover:bg-white/15">
                  <img src={iconUrl(ic.id)} alt={ic.id} loading="lazy" draggable={false} className="size-8" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
