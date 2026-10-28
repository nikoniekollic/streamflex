import { Link } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CatalogTitle } from '@/lib/catalog'
import { FavoriteButton } from '@/components/catalog/FavoriteButton'

type MovieCardProps = {
  title: CatalogTitle
  variant?: 'poster' | 'backdrop'
  progress?: number
  /** Si défini : lien direct vers le lecteur (Reprendre la lecture) */
  watch?: { episode?: string | null; t?: number }
  /** Affiche le bouton Ma liste (défaut : oui) */
  favorite?: boolean
  /** Ligne secondaire (variante backdrop) — ex. épisode */
  caption?: string | null
  className?: string
}

export function MovieCard({ title, variant = 'poster', progress, watch, favorite = true, caption, className }: MovieCardProps) {
  const isBackdrop = variant === 'backdrop'
  const src = isBackdrop ? (title.backdrop_url ?? title.poster_url) : (title.poster_url ?? title.backdrop_url)

  const content = (
    <>
      {src ? (
        <img
          src={src}
          alt={title.title}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover transition-transform duration-500 group-hover/card:scale-110"
        />
      ) : (
        <div className="flex size-full items-center justify-center p-3 text-center text-sm font-semibold">{title.title}</div>
      )}

      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-300 group-focus-within/card:opacity-100 group-hover/card:opacity-100">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-black">
            <Play className="size-4 fill-current" />
          </span>
          <span className="line-clamp-2 text-sm leading-tight font-semibold">{title.title}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-300">
          {title.maturity_rating && <span className="rounded-sm border border-neutral-500 px-1">{title.maturity_rating}</span>}
          {title.release_year && <span>{title.release_year}</span>}
          {title.genres.slice(0, 2).map((g) => (
            <span key={g.slug}>• {g.name}</span>
          ))}
        </div>
      </div>

      {isBackdrop && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pt-6 pb-1.5 group-hover/card:opacity-0">
          <span className="line-clamp-1 text-xs font-medium">{title.title}</span>
          {caption && <span className="line-clamp-1 text-[11px] text-neutral-300">{caption}</span>}
        </div>
      )}

      {progress !== undefined && (
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-neutral-600/80"
          role="progressbar"
          aria-label="Progression"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(100, Math.max(0, progress * 100)))}
        >
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </div>
      )}
    </>
  )

  const linkClass = 'block size-full outline-none'
  let link
  if (watch) {
    const search: { episode?: string; t?: number } = {}
    if (watch.episode) search.episode = watch.episode
    if (watch.t !== undefined) search.t = watch.t
    link = (
      <Link to="/watch/$id" params={{ id: title.id }} search={search} className={linkClass} aria-label={`Lire ${title.title}`}>
        {content}
      </Link>
    )
  } else {
    link = (
      <Link to="/title/$slug" params={{ slug: title.slug }} className={linkClass} aria-label={title.title}>
        {content}
      </Link>
    )
  }

  return (
    <div
      className={cn(
        'group/card relative overflow-hidden rounded-md bg-neutral-900',
        'transition-all duration-300 ease-out will-change-transform',
        'hover:z-10 hover:scale-105 hover:shadow-2xl hover:ring-2 hover:shadow-black/70 hover:ring-white/80',
        'focus-within:z-10 focus-within:scale-105 focus-within:ring-2 focus-within:ring-white',
        isBackdrop ? 'aspect-video' : 'aspect-[2/3]',
        className,
      )}
    >
      {link}
      {favorite && (
        <FavoriteButton
          title={title}
          className="absolute top-2 right-2 opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 aria-pressed:opacity-100 max-md:opacity-100"
        />
      )}
    </div>
  )
}

export function MovieCardSkeleton({ variant = 'poster' }: { variant?: 'poster' | 'backdrop' }) {
  return <div className={cn('animate-pulse rounded-md bg-neutral-800', variant === 'backdrop' ? 'aspect-video' : 'aspect-[2/3]')} />
}
