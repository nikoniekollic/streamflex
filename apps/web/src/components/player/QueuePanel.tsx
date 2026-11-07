import { useEffect, useRef, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isModelCover, stripModelMark } from '@/lib/cover'
import type { Queue } from '@/lib/queue'
import { CoverThumb } from '@/components/catalog/CoverThumb'

type Item = { id: string; title: string; poster_url: string | null; cover_pos: number | null }
const known = new Map<string, Item>()

/** Liste de lecture à droite du lecteur : la vidéo en cours est surlignée, un clic saute à la vidéo choisie. */
export function QueuePanel({ queue, currentId, onSelect }: { queue: Queue; currentId: string; onSelect: (id: string) => void }) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [, setTick] = useState(0)
  const currentRef = useRef<HTMLButtonElement>(null)

  // Titres de la liste, par lots de 100, en commençant par ceux qui vont passer
  const ids = queue.order
  const from = Math.max(0, queue.index - 2)
  useEffect(() => {
    const wanted = ids.slice(from, from + 200).filter((id) => !known.has(id))
    if (wanted.length === 0) return
    let alive = true
    ;(async () => {
      for (let i = 0; i < wanted.length; i += 100) {
        const { data } = await (supabase as unknown as SupabaseClient).from('titles').select('id, title, poster_url, cover_pos').in('id', wanted.slice(i, i + 100))
        for (const r of (data ?? []) as Item[]) known.set(r.id, r)
        if (alive) setTick((t) => t + 1)
      }
    })()
    return () => {
      alive = false
    }
  }, [ids, from, supabase])

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [currentId])

  return (
    <div className="flex h-full flex-col bg-neutral-950/95">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="truncate font-semibold">{queue.label}</p>
        <p className="text-xs text-neutral-400">
          {queue.index + 1} / {ids.length} · {queue.shuffle ? 'aléatoire' : 'dans l’ordre'}
        </p>
      </div>
      <ol className="flex-1 overflow-y-auto overscroll-contain">
        {ids.map((id, i) => {
          const it = known.get(id)
          const current = id === currentId
          const img = it?.poster_url ? (isModelCover(it.poster_url) ? stripModelMark(it.poster_url) : it.poster_url) : null
          return (
            <li key={`${id}:${i}`}>
              <button
                ref={current ? currentRef : undefined}
                type="button"
                onClick={() => onSelect(id)}
                aria-current={current ? 'true' : undefined}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/10', current && 'bg-white/15')}
              >
                <span className="w-6 shrink-0 text-center text-xs text-neutral-400 tabular-nums">{current ? <Play className="mx-auto size-4 fill-current text-primary" /> : i + 1}</span>
                {it ? (
                  <CoverThumb
                    titleId={id}
                    coverPos={it.cover_pos}
                    order={i}
                    className="h-14 w-10 shrink-0 rounded"
                    fallback={img ? <img src={img} alt="" loading="lazy" className="size-full object-cover opacity-50" /> : null}
                  />
                ) : (
                  <span className="h-14 w-10 shrink-0 rounded bg-neutral-800" />
                )}
                <span className={cn('line-clamp-2 min-w-0 text-sm leading-tight', i < queue.index && 'text-neutral-500')}>{it?.title ?? '…'}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
