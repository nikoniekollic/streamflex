import { Link } from '@tanstack/react-router'
import { Info, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FavoriteButton } from '@/components/catalog/FavoriteButton'
import type { CatalogTitle } from '@/lib/catalog'

export function HeroBanner({ title }: { title: CatalogTitle }) {
  const bg = title.backdrop_url ?? title.poster_url
  return (
    <section className="relative -mt-16 flex h-[56.25vw] max-h-[85vh] min-h-[460px] w-full items-end overflow-hidden">
      {bg && (
        <img
          src={bg}
          alt=""
          aria-hidden
          fetchPriority="high"
          className="absolute inset-0 size-full object-cover object-top"
        />
      )}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />

      <div className="relative z-10 flex max-w-2xl flex-col gap-4 px-6 pb-[12%] md:px-12 md:pb-[8%]">
        {title.logo_url ? (
          <img src={title.logo_url} alt={title.title} className="max-h-36 w-auto max-w-[80%] object-contain object-left" />
        ) : (
          <h1 className="text-4xl font-black tracking-tight drop-shadow-lg md:text-6xl">{title.title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-200">
          {title.maturity_rating && <span className="rounded-sm border border-neutral-400 px-1.5">{title.maturity_rating}</span>}
          {title.release_year && <span>{title.release_year}</span>}
          {title.type === 'series' ? <span>Série</span> : title.runtime_minutes ? <span>{title.runtime_minutes} min</span> : null}
          {title.genres.slice(0, 3).map((g) => (
            <span key={g.slug}>• {g.name}</span>
          ))}
        </div>
        {title.synopsis && <p className="line-clamp-3 text-sm text-neutral-200 drop-shadow md:text-lg">{title.synopsis}</p>}
        <div className="mt-2 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-11 bg-white px-6 text-base font-semibold text-black hover:bg-white/80 md:h-12 md:px-8">
            <Link to="/watch/$id" params={{ id: title.id }}>
              <Play className="size-6 fill-current" /> Lecture
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="h-11 bg-neutral-500/60 px-6 text-base font-semibold text-white hover:bg-neutral-500/40 md:h-12 md:px-8">
            <Link to="/title/$slug" params={{ slug: title.slug }}>
              <Info className="size-6" /> Plus d'infos
            </Link>
          </Button>
          <FavoriteButton title={title} variant="button" />
        </div>
      </div>
    </section>
  )
}

export function HeroBannerSkeleton() {
  return <section className="-mt-16 h-[56.25vw] max-h-[85vh] min-h-[460px] w-full animate-pulse bg-neutral-900" />
}
