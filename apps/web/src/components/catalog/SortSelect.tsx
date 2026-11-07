import { ArrowDownUp } from 'lucide-react'
import { SORT_OPTIONS, type SortKey } from '@/lib/sort'

/** Menu « Trier par » : `value` vide = ordre par défaut de la page. */
export function SortSelect({ value, onChange, defaultLabel = 'Plus récent', className }: { value: SortKey | undefined; onChange: (v: SortKey | undefined) => void; defaultLabel?: string; className?: string }) {
  return (
    <label className={`flex items-center gap-2 text-sm text-neutral-300 ${className ?? ''}`}>
      <ArrowDownUp className="size-4" aria-hidden />
      <span className="sr-only sm:not-sr-only">Trier par</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as SortKey | undefined)}
        className="h-9 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm text-white"
        aria-label="Trier par"
      >
        <option value="">{defaultLabel}</option>
        {SORT_OPTIONS.filter((o) => o.label !== defaultLabel).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
