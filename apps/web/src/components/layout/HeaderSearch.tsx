import { useEffect, useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SEARCH_DEBOUNCE_MS, type SearchParams } from '@/lib/search'

export function HeaderSearch() {
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })
  const onSearchPage = location.pathname === '/search'
  const urlQ = onSearchPage ? ((location.search as { q?: string }).q ?? '') : ''

  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [value, setValue] = useState(urlQ)
  const [open, setOpen] = useState(onSearchPage)
  const expanded = open || onSearchPage || value !== ''

  // URL → champ (navigation arrière, filtres…)
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setValue(urlQ)
  }, [urlQ])

  // Quitte /search → referme
  useEffect(() => {
    if (!onSearchPage) {
      setValue('')
      setOpen(false)
    }
  }, [onSearchPage])

  // Raccourci « / »
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key !== '/' || el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      e.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const push = (q: string) => {
    const trimmed = q.trim()
    if (!onSearchPage && !trimmed) return
    const current = (onSearchPage ? location.search : {}) as SearchParams
    void navigate({
      to: '/search',
      search: { ...current, q: trimmed || undefined, page: undefined },
      replace: onSearchPage,
    })
  }

  const onChange = (q: string) => {
    setValue(q)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => push(q), SEARCH_DEBOUNCE_MS)
  }

  const clear = () => {
    window.clearTimeout(timer.current)
    setValue('')
    if (onSearchPage) push('')
    inputRef.current?.focus()
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        window.clearTimeout(timer.current)
        push(value)
      }}
      className={cn(
        'flex h-9 items-center overflow-hidden rounded-md border transition-all duration-300',
        expanded ? 'w-44 border-white/70 bg-black/80 sm:w-64 md:w-72' : 'w-9 border-transparent',
      )}
    >
      <button
        type="button"
        aria-label="Rechercher"
        className="flex size-9 shrink-0 items-center justify-center"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <Search className="size-5" />
      </button>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value && !onSearchPage) setOpen(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            if (value) clear()
            else {
              setOpen(false)
              inputRef.current?.blur()
            }
          }
        }}
        placeholder="Titres, descriptions…"
        aria-label="Rechercher un film ou une série"
        tabIndex={expanded ? 0 : -1}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400 [&::-webkit-search-cancel-button]:hidden"
      />
      {expanded && value && (
        <button type="button" aria-label="Effacer" onClick={clear} className="flex size-8 shrink-0 items-center justify-center">
          <X className="size-4" />
        </button>
      )}
    </form>
  )
}
