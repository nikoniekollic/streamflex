import { cn } from '@/lib/utils'
import { SYMBOLS, coverStyle } from '@/lib/cover'

const PATHS: Record<(typeof SYMBOLS)[number], string> = {
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  triangle: 'M12 3 22 20H2z',
  diamond: 'M12 2 22 12 12 22 2 12z',
  star: 'm12 2 3 7 7.5.6-5.7 4.9 1.8 7.3L12 17.8 5.4 21.8l1.8-7.3L1.5 9.6 9 9z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  heart: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  square: 'M4 4h16v16H4z',
}

/** Symbole coloré (pastille) — propre à chaque fichier. */
export function CoverSymbol({ seed, className }: { seed: string; className?: string }) {
  const s = coverStyle(seed)
  return (
    <span className={cn('flex items-center justify-center rounded-full shadow-lg ring-2 ring-white/70', className)} style={{ backgroundColor: s.accent }}>
      <svg viewBox="0 0 24 24" className="size-[58%] fill-white" aria-hidden>
        <path d={PATHS[SYMBOLS[s.symbol]]} />
      </svg>
    </span>
  )
}

/** Jaquette sans image : dégradé aléatoire stable + symbole + nom du fichier. */
export function GeneratedCover({ seed, label }: { seed: string; label: string }) {
  const s = coverStyle(seed)
  return (
    <div className="relative size-full select-none overflow-hidden" style={{ backgroundImage: `linear-gradient(${s.angle}deg, ${s.from}, ${s.to})` }}>
      <div className="absolute -top-8 -right-8 size-32 rounded-full opacity-40 blur-2xl" style={{ backgroundColor: s.accent }} />
      <CoverSymbol seed={seed} className="absolute top-2 left-2 size-9" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10">
        <span className="line-clamp-4 text-sm leading-tight font-bold break-words drop-shadow">{label}</span>
      </div>
    </div>
  )
}

/** Image du modèle + symbole coloré superposé + nom du fichier. */
export function ModelCover({ seed, label, src }: { seed: string; label: string; src: string }) {
  const s = coverStyle(seed)
  return (
    <div className="relative size-full select-none overflow-hidden bg-neutral-900">
      <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover transition-transform duration-500 group-hover/card:scale-110" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-1/3 opacity-60 mix-blend-multiply" style={{ backgroundImage: `linear-gradient(180deg, ${s.accent}, transparent)` }} />
      <CoverSymbol seed={seed} className="absolute top-2 left-2 size-9" />
      <div className="absolute inset-x-0 bottom-0 p-2.5 pt-12" style={{ backgroundImage: `linear-gradient(to top, ${s.to}, transparent)` }}>
        <span className="line-clamp-3 text-xs leading-tight font-bold break-words drop-shadow">{label}</span>
      </div>
    </div>
  )
}
