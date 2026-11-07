import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Pages affichées : 1 … p-2 p-1 [p] p+1 p+2 … N */
export function pageWindow(page: number, pages: number): (number | '…')[] {
  const set = new Set<number>([1, pages, page - 2, page - 1, page, page + 1, page + 2])
  const list = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) out.push('…')
    out.push(n)
  })
  return out
}

export function PaginationBar({ page, pages, onPage, className }: { page: number; pages: number; onPage: (p: number) => void; className?: string }) {
  if (pages <= 1) return null
  const btn = 'flex h-9 min-w-9 items-center justify-center rounded-md border border-neutral-700 px-2 text-sm transition-colors hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-40'
  return (
    <nav className={cn('mt-8 flex flex-wrap items-center justify-center gap-1.5', className)} aria-label="Pagination">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(1)} aria-label="Première page">
        <ChevronsLeft className="size-4" />
      </button>
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Page précédente">
        <ChevronLeft className="size-4" />
      </button>
      {pageWindow(page, pages).map((n, i) =>
        n === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-neutral-500">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            aria-current={n === page ? 'page' : undefined}
            className={cn(btn, n === page && 'border-primary bg-primary text-primary-foreground hover:bg-primary')}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Page suivante">
        <ChevronRight className="size-4" />
      </button>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Dernière page">
        <ChevronsRight className="size-4" />
      </button>
    </nav>
  )
}
