import type { ReactNode } from 'react'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { MovieCard, MovieCardSkeleton } from '@/components/catalog/MovieCard'
import type { CatalogTitle, ContinueItem } from '@/lib/catalog'

const POSTER_ITEM = 'basis-[38%] sm:basis-[28%] md:basis-[22%] lg:basis-[16.66%] xl:basis-[14.28%] 2xl:basis-[12.5%]'
const BACKDROP_ITEM = 'basis-[70%] sm:basis-[45%] md:basis-[33.33%] lg:basis-[25%] xl:basis-[20%]'

export function Row({ label, children, memoryKey, action }: { label: string; children: ReactNode; memoryKey?: string; action?: ReactNode }) {
  return (
    <section className="relative">
      <div className="mb-2 flex items-baseline gap-4 px-6 md:px-12">
        <h2 className="text-lg font-semibold text-neutral-100 md:text-xl">{label}</h2>
        {action}
      </div>
      <Carousel memoryKey={memoryKey}>
        {/* py/px laissent la place au scale du hover */}
        <CarouselContent className="gap-2 px-6 py-4 md:px-12">{children}</CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </section>
  )
}

export function CategoryCarousel({ label, titles }: { label: string; titles: CatalogTitle[] }) {
  if (titles.length === 0) return null
  return (
    <Row label={label} memoryKey={`home:${label}`}>
      {titles.map((t) => (
        <CarouselItem key={t.id} className={POSTER_ITEM}>
          <MovieCard title={t} />
        </CarouselItem>
      ))}
    </Row>
  )
}

export function ContinueWatchingCarousel({ items }: { items: ContinueItem[] }) {
  if (items.length === 0) return null
  return (
    <Row label="Reprendre la lecture" memoryKey="home:continue">
      {items.map((i) => (
        <CarouselItem key={i.id} className={BACKDROP_ITEM}>
          <MovieCard
            title={i.title}
            variant="backdrop"
            watch={{ episode: i.episode_id, t: i.position_seconds }}
            caption={i.caption}
            favorite={false}
            progress={i.duration_seconds ? i.position_seconds / i.duration_seconds : undefined}
          />
        </CarouselItem>
      ))}
    </Row>
  )
}

export function CategoryCarouselSkeleton({ label }: { label?: string }) {
  return (
    <section>
      <div className="mb-2 px-6 md:px-12">
        {label ? <h2 className="text-lg font-semibold md:text-xl">{label}</h2> : <div className="h-6 w-48 animate-pulse rounded bg-neutral-800" />}
      </div>
      <div className="flex gap-2 overflow-hidden px-6 py-4 md:px-12">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`shrink-0 ${POSTER_ITEM}`}>
            <MovieCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  )
}
