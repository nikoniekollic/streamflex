import { createFileRoute } from '@tanstack/react-router'
import { fetchHome } from '@/lib/catalog'
import { HeroBanner, HeroBannerSkeleton } from '@/components/catalog/HeroBanner'
import {
  CategoryCarousel,
  CategoryCarouselSkeleton,
  ContinueWatchingCarousel,
} from '@/components/catalog/CategoryCarousel'

export const Route = createFileRoute('/_authed/_shell/')({
  loader: ({ context }) => fetchHome(context.supabase, context.activeProfile!),
  staleTime: 60_000,
  pendingComponent: HomeSkeleton,
  component: Home,
})

function Home() {
  const { hero, continueWatching, rows, isMock } = Route.useLoaderData()
  const [trending, ...others] = rows

  if (!hero && rows.length === 0 && continueWatching.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-32 text-center">
        <h1 className="text-2xl font-bold">Le catalogue est vide pour le moment</h1>
        <p className="max-w-md text-muted-foreground">Les premiers films et séries arrivent bientôt.</p>
      </div>
    )
  }

  return (
    <div className="pb-16">
      {hero && <HeroBanner title={hero} />}
      <div className="relative z-10 -mt-24 flex flex-col gap-4 md:-mt-32 md:gap-6">
        <ContinueWatchingCarousel items={continueWatching} />
        {trending && <CategoryCarousel label={trending.label} titles={trending.titles} />}
        {others.map((r) => (
          <CategoryCarousel key={r.key} label={r.label} titles={r.titles} />
        ))}
      </div>
      {isMock && (
        <p className="mt-10 px-6 text-xs text-neutral-500 md:px-12">
          Données de démonstration — la table <code>titles</code> ne contient aucun titre publié.
        </p>
      )}
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="pb-16">
      <HeroBannerSkeleton />
      <div className="relative z-10 -mt-24 flex flex-col gap-6 md:-mt-32">
        <CategoryCarouselSkeleton />
        <CategoryCarouselSkeleton />
        <CategoryCarouselSkeleton />
      </div>
    </div>
  )
}
