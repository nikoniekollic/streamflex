import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Défilement infini pendant la sélection : à partir de la page affichée, les pages suivantes s'ajoutent en bas dès qu'on
 * approche de la fin, pour cocher beaucoup de vidéos d'affilée sans changer de page. `key` = filtres et page de départ :
 * s'il change (ou si le mode s'arrête), on repart de la page normale. `drop` retire des vidéos de la liste (déplacées
 * vers un autre modèle, supprimées).
 */
export function useInfiniteTitles<T extends { id: string }>(on: boolean, base: T[], page: number, pages: number, key: string, fetchPage: (p: number) => Promise<T[]>) {
  const fresh = () => ({ key, items: [] as T[], next: page + 1, gone: new Set<string>() })
  const [st, setSt] = useState(fresh)
  const cur = on && st.key === key ? st : fresh()
  useEffect(() => {
    if (!on || st.key !== key) setSt(fresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key])
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const busy = useRef(false)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const done = cur.next > pages
  useEffect(() => {
    const el = sentinel.current
    if (!on || done || !el || typeof IntersectionObserver === 'undefined') return
    const p = cur.next
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting || busy.current) return
        busy.current = true
        setLoading(true)
        fetchRef
          .current(p)
          .then((items) => setSt((x) => (x.key === key && x.next === p ? { ...x, items: [...x.items, ...items], next: p + 1 } : x)))
          .catch(() => undefined)
          .finally(() => {
            busy.current = false
            setLoading(false)
          })
      },
      { rootMargin: '1500px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [on, done, key, cur.next])
  const items = useMemo(() => {
    if (!on) return base
    const seen = new Set<string>()
    const out: T[] = []
    for (const t of [...base, ...cur.items]) {
      if (seen.has(t.id) || cur.gone.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
    return out
  }, [on, base, cur.items, cur.gone])
  const drop = (ids: string[]) => setSt((x) => ({ ...x, gone: new Set([...x.gone, ...ids]) }))
  return { items, sentinel, loading, done, drop }
}
