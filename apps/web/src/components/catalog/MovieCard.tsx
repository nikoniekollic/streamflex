import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Info, Play } from 'lucide-react'
import { openPlayer } from '@/lib/player-overlay'
import { cn } from '@/lib/utils'
import type { CatalogTitle } from '@/lib/catalog'
import { FavoriteButton } from '@/components/catalog/FavoriteButton'
import { GeneratedCover, ModelCover } from '@/components/catalog/GeneratedCover'
import { isModelCover, stripModelMark } from '@/lib/cover'
import { ModelName } from '@/components/catalog/ModelName'
import { HoverPreview } from '@/components/catalog/HoverPreview'
import { PlaylistMenu } from '@/components/catalog/PlaylistMenu'
import { formatMinutes, useCoverPos, useTitleLength } from '@/lib/model-names'

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
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()
  const isMovie = title.type === 'movie'
  const length = useTitleLength(title.id, title.runtime_minutes)
  const coverPos = useCoverPos(title.id)
  const src = isBackdrop ? (title.backdrop_url ?? title.poster_url) : (title.poster_url ?? title.backdrop_url)

  const content = (
    <>
      {isModelCover(src) ? (
        <ModelCover seed={title.id} label={title.title} src={stripModelMark(src)} />
      ) : src ? (
        <img
          src={src}
          alt={title.title}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover transition-transform duration-500 group-hover/card:scale-110"
        />
      ) : (
        <GeneratedCover seed={title.id} label={title.title} />
      )}

      <ModelName titleId={title.id} />
      {isMovie && <HoverPreview title={title} active={hovered} coverPos={coverPos} />}

      <div className="absolute inset-0 z-[3] flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-300 group-focus-within/card:opacity-100 group-hover/card:opacity-100">
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

      {isMovie && length && (
        <span
          className="pointer-events-none absolute right-1.5 bottom-1.5 z-[4] rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums"
          title={length.estimated ? 'Durée estimée d’après la taille du fichier' : 'Durée'}
        >
          {length.estimated ? '≈ ' : ''}
          {formatMinutes(length.minutes)}
        </span>
      )}

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

  const linkClass = 'block size-full cursor-pointer outline-none select-none'
  // Clic simple : le lecteur s'ouvre en premier plan (croix pour revenir où on était). Ctrl/Maj/clic milieu : comportement du lien.
  const plain = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  let link
  if (watch) {
    const search: { episode?: string; t?: number } = {}
    if (watch.episode) search.episode = watch.episode
    if (watch.t !== undefined) search.t = watch.t
    link = (
      <Link
        to="/watch/$id"
        params={{ id: title.id }}
        search={search}
        preload={false}
        className={linkClass}
        aria-label={`Lire ${title.title}`}
        onClick={(e) => {
          if (!plain(e)) return
          e.preventDefault()
          openPlayer({ titleId: title.id, episodeId: watch.episode, t: watch.t })
        }}
      >
        {content}
      </Link>
    )
  } else {
    link = (
      <Link
        to="/title/$slug"
        params={{ slug: title.slug }}
        preload={isMovie ? false : 'intent'} // film : le clic ouvre le lecteur, inutile de précharger la page de détail
        className={linkClass}
        aria-label={isMovie ? `Lire ${title.title}` : title.title}
        onClick={(e) => {
          if (!isMovie || !plain(e)) return
          e.preventDefault()
          openPlayer({ titleId: title.id })
        }}
      >
        {content}
      </Link>
    )
  }

  return (
    <div
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        'group/card relative overflow-hidden rounded-md bg-neutral-900',
        // Films : aucun transform sur la carte (le panneau d'aperçu en position fixe doit pouvoir sortir du carrousel)
        isMovie ? 'transition-shadow duration-300' : 'transition-all duration-300 ease-out will-change-transform',
        isMovie ? 'hover:z-10 hover:ring-2 hover:ring-white/80' : 'hover:z-10 hover:scale-105 hover:shadow-2xl hover:ring-2 hover:shadow-black/70 hover:ring-white/80',
        isMovie ? 'focus-within:z-10 focus-within:ring-2 focus-within:ring-white' : 'focus-within:z-10 focus-within:scale-105 focus-within:ring-2 focus-within:ring-white',
        isBackdrop ? 'aspect-video' : 'aspect-[2/3]',
        className,
      )}
    >
      {link}
      {favorite && (
        <>
          {isMovie && (
            <button
              type="button"
              aria-label={`Détails de ${title.title}`}
              title="Détails"
              onClick={() => void navigate({ to: '/title/$slug', params: { slug: title.slug } })}
              className="absolute top-2 left-2 z-[5] flex size-8 items-center justify-center rounded-full border-2 border-neutral-300 bg-black/60 text-white opacity-0 backdrop-blur-sm transition-all group-focus-within/card:opacity-100 group-hover/card:opacity-100 hover:scale-110 hover:border-white max-md:opacity-100"
            >
              <Info className="size-4" strokeWidth={2.5} />
            </button>
          )}
        <div className="absolute top-2 right-2 z-[5] flex gap-1.5">
          {isMovie && <PlaylistMenu titleId={title.id} />}
          <FavoriteButton title={title} />
        </div>
        </>
      )}
    </div>
  )
}

export function MovieCardSkeleton({ variant = 'poster' }: { variant?: 'poster' | 'backdrop' }) {
  return <div className={cn('animate-pulse rounded-md bg-neutral-800', variant === 'backdrop' ? 'aspect-video' : 'aspect-[2/3]')} />
}
