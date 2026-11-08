import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { openPlayer } from '@/lib/player-overlay'
import { usePlayList } from '@/components/catalog/PlayList'
import { startQueue, stopQueue } from '@/lib/queue'
import { cn } from '@/lib/utils'
import type { CatalogTitle } from '@/lib/catalog'
import { FavoriteButton } from '@/components/catalog/FavoriteButton'
import { GeneratedCover, ModelCover } from '@/components/catalog/GeneratedCover'
import { isModelCover, stripModelMark } from '@/lib/cover'
import { ModelName } from '@/components/catalog/ModelName'
import { HoverPreview } from '@/components/catalog/HoverPreview'
import { PlaylistMenu } from '@/components/catalog/PlaylistMenu'
import { formatDuration, useCoverPos, useModelInfo, useTitleLength } from '@/lib/model-names'
import { durationCss, pin, ratioCss, useSiteSettings } from '@/lib/site-settings'
import { firstEmoji } from '@/lib/emoji'

const ICON = 'flex size-7 items-center justify-center rounded-full bg-black/75 text-base leading-none ring-1 ring-white/25 backdrop-blur-sm transition hover:scale-110 hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none'

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
  const list = usePlayList()
  /** lance la vidéo cliquée ET la suite de la liste affichée (rangée, page) : suivant / précédent et lecture enchaînée */
  const play = () => {
    if (list && list.ids.length > 1 && list.ids.includes(title.id)) startQueue({ label: list.label, ids: list.ids, startId: title.id })
    else stopQueue()
    openPlayer({ titleId: title.id })
  }
  const isMovie = title.type === 'movie'
  const length = useTitleLength(title.id, title.runtime_minutes)
  const coverPos = useCoverPos(title.id)
  const { cards } = useSiteSettings()
  const modelInfo = useModelInfo(title.id)
  // emoji du bouton « page du modèle » : celui du modèle, sinon celui de son nom, sinon l'emoji par défaut (Apparence)
  const modelEmoji = modelInfo?.emoji || (cards.emojiFromName ? firstEmoji(modelInfo?.name) : null) || cards.modelEmoji
  // emoji du bouton « page de la vidéo » : celui du titre s'il en contient un, sinon celui choisi dans Apparence
  const videoEmoji = (cards.emojiFromName ? firstEmoji(title.title) : null) || cards.videoEmoji
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

      {isMovie && length && cards.duration.show && (
        <span className="pointer-events-none z-[4]" style={{ ...durationCss(cards.duration), ...pin(cards.durationPos) }} title="Durée du fichier">
          {formatDuration(length.seconds, cards.duration.format)}
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
          play()
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
        isBackdrop && 'aspect-video',
        className,
      )}
      style={isBackdrop ? undefined : { aspectRatio: ratioCss(cards.ratio) }}
    >
      {link}
      {favorite && (
        <>
          {/* deux icônes rondes, chacune à sa place (réglable dans Apparence) : page du modèle / page de la vidéo */}
          {cards.icons && modelInfo && (
            <button
              type="button"
              aria-label={`Page du modèle ${modelInfo.name}`}
              title={`Page du modèle : ${modelInfo.name}`}
              onClick={() => void navigate({ to: '/models/$id', params: { id: modelInfo.id } })}
              className={`${ICON} z-[5]`}
              style={pin(cards.modelPos)}
            >
              {modelEmoji}
            </button>
          )}
          {cards.icons && (
            <button
              type="button"
              aria-label={`Page de la vidéo ${title.title}`}
              title="Page de la vidéo"
              onClick={() => void navigate({ to: '/title/$slug', params: { slug: title.slug } })}
              className={`${ICON} z-[5]`}
              style={pin(cards.videoPos)}
            >
              {videoEmoji}
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
