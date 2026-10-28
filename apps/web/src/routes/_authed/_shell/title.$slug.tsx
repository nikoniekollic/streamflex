import { useState } from 'react'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Baby, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/native-select'
import { FavoriteButton } from '@/components/catalog/FavoriteButton'
import { fetchTitleDetail, type SeasonItem } from '@/lib/title'

export const Route = createFileRoute('/_authed/_shell/title/$slug')({
  loader: async ({ context, params }) => {
    const t = await fetchTitleDetail(context.supabase, params.slug, context.activeProfile!)
    if (!t) throw notFound()
    return t
  },
  staleTime: 10_000,
  notFoundComponent: () => (
    <div className="px-6 py-24 text-center md:px-12">
      <h1 className="text-2xl font-bold">Titre introuvable</h1>
      <Button asChild variant="secondary" className="mt-6">
        <Link to="/">Retour à l'accueil</Link>
      </Button>
    </div>
  ),
  component: TitlePage,
})

function TitlePage() {
  const t = Route.useLoaderData()
  if (t.restricted) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-24 text-center md:px-12">
        <Baby className="size-14 text-neutral-500" />
        <h1 className="text-2xl font-bold">Contenu non disponible sur un profil Enfants</h1>
        <p className="max-w-md text-muted-foreground">« {t.title} » n'est pas classé tous publics.</p>
        <Button asChild variant="secondary">
          <Link to="/">Retour à l'accueil</Link>
        </Button>
      </div>
    )
  }
  const bg = t.backdrop_url ?? t.poster_url
  const resumeEpisode = t.resume?.episodeId ?? undefined

  return (
    <div className="pb-16">
      <section className="relative -mt-16 flex min-h-[70vh] items-end overflow-hidden">
        {bg && <img src={bg} alt="" aria-hidden className="absolute inset-0 size-full object-cover object-top" />}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent" />
        <div className="relative z-10 flex max-w-3xl flex-col gap-4 px-6 pt-32 pb-12 md:px-12">
          {t.logo_url ? (
            <img src={t.logo_url} alt={t.title} className="max-h-36 w-auto max-w-[80%] object-contain object-left" />
          ) : (
            <h1 className="text-4xl font-black tracking-tight md:text-6xl">{t.title}</h1>
          )}
          {t.original_title && t.original_title !== t.title && <p className="text-neutral-400 italic">{t.original_title}</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-200">
            {t.maturity_rating && <span className="rounded-sm border border-neutral-400 px-1.5">{t.maturity_rating}</span>}
            {t.release_year && <span>{t.release_year}</span>}
            {t.type === 'series' ? (
              <span>
                {t.seasons.length} saison{t.seasons.length > 1 ? 's' : ''}
              </span>
            ) : t.runtime_minutes ? (
              <span>
                {Math.floor(t.runtime_minutes / 60) ? `${Math.floor(t.runtime_minutes / 60)} h ` : ''}
                {t.runtime_minutes % 60} min
              </span>
            ) : null}
          </div>
          {t.synopsis && <p className="text-base text-neutral-200 md:text-lg">{t.synopsis}</p>}
          <div className="flex flex-wrap gap-2">
            {t.genres.map((g) => (
              <Badge key={g.slug} asChild variant="outline" className="border-white/30 text-neutral-200">
                <Link to="/search" search={{ genre: g.slug }}>
                  {g.name}
                </Link>
              </Badge>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 bg-white px-6 text-base font-semibold text-black hover:bg-white/80 md:h-12 md:px-8">
              <Link to="/watch/$id" params={{ id: t.id }} search={resumeEpisode ? { episode: resumeEpisode } : {}}>
                {t.resume ? <RotateCcw className="size-6" /> : <Play className="size-6 fill-current" />}
                {t.resume ? 'Reprendre' : 'Lecture'}
              </Link>
            </Button>
            <FavoriteButton title={t} variant="button" />
          </div>
          {t.resume && t.resume.ratio > 0 && (
            <div className="h-1 w-64 overflow-hidden rounded-full bg-neutral-600">
              <div className="h-full bg-primary" style={{ width: `${t.resume.ratio * 100}%` }} />
            </div>
          )}
        </div>
      </section>

      {t.type === 'series' && t.seasons.length > 0 && <Episodes titleId={t.id} seasons={t.seasons} />}
    </div>
  )
}

function Episodes({ titleId, seasons }: { titleId: string; seasons: SeasonItem[] }) {
  const [seasonId, setSeasonId] = useState(seasons[0].id)
  const season = seasons.find((s) => s.id === seasonId) ?? seasons[0]

  return (
    <section className="px-6 md:px-12">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">Épisodes</h2>
        {seasons.length > 1 && (
          <div className="w-44">
            <NativeSelect value={seasonId} onChange={(e) => setSeasonId(e.target.value)} aria-label="Saison">
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? `Saison ${s.season_number}`}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
      <ol className="divide-y divide-white/10 rounded-lg border border-white/10">
        {season.episodes.length === 0 && <li className="p-6 text-muted-foreground">Aucun épisode.</li>}
        {season.episodes.map((e) => (
          <li key={e.id}>
            <Link
              to="/watch/$id"
              params={{ id: titleId }}
              search={{ episode: e.id }}
              className="group flex items-center gap-4 p-4 transition-colors hover:bg-white/5"
            >
              <span className="w-6 shrink-0 text-center text-xl text-neutral-400">{e.episode_number}</span>
              <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded bg-neutral-800">
                {e.still_url && <img src={e.still_url} alt="" loading="lazy" className="size-full object-cover" />}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="size-8 fill-white" />
                </span>
                {e.progress !== null && (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-neutral-600">
                    <span className="block h-full bg-primary" style={{ width: `${e.progress * 100}%` }} />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-medium">{e.name ?? `Épisode ${e.episode_number}`}</p>
                  {e.runtime_minutes && <span className="shrink-0 text-sm text-neutral-400">{e.runtime_minutes} min</span>}
                </div>
                {e.overview && <p className="mt-1 line-clamp-2 text-sm text-neutral-400">{e.overview}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
