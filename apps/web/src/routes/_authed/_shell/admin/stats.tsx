import { createFileRoute, Link, useRouterState } from '@tanstack/react-router'
import { Activity, Clock, CreditCard, Hourglass, Loader2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KpiCard, TopTitlesTable, TopUsersTable, ViewersChart, WatchTimeChart } from '@/components/admin/StatsCharts'
import { PERIODS, delta, fetchStats, formatDuration, nf, type Period } from '@/lib/stats'

export const Route = createFileRoute('/_authed/_shell/admin/stats')({
  validateSearch: (s: Record<string, unknown>): { period?: Period } => {
    const p = Number(s.period)
    return (PERIODS as readonly number[]).includes(p) && p !== 30 ? { period: p as Period } : {}
  },
  loaderDeps: ({ search }) => ({ period: search.period ?? 30 }),
  loader: ({ context, deps }) => fetchStats(context.supabase, deps.period as Period),
  staleTime: 60_000,
  component: StatsPage,
})

function StatsPage() {
  const { overview: o, topTitles, topUsers } = Route.useLoaderData()
  const { period = 30 } = Route.useSearch()
  const loading = useRouterState({ select: (s) => s.isLoading })

  return (
    <div className={cn('grid gap-6 transition-opacity', loading && 'opacity-60')}>
      {/* Filtre de période (une seule rangée, au-dessus de tout) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Période" className="inline-flex rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <Link
              key={p}
              role="tab"
              aria-selected={p === period}
              to="/admin/stats"
              search={p === 30 ? {} : { period: p }}
              replace
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                p === period ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p} jours
            </Link>
          ))}
        </div>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Temps de visionnage total"
          value={formatDuration(o.total_watch_seconds)}
          hint="depuis le lancement"
          icon={<Hourglass />}
        />
        <KpiCard
          label={`Visionnage — ${o.days} jours`}
          value={formatDuration(o.period_watch_seconds)}
          change={delta(o.period_watch_seconds, o.prev_period_watch_seconds)}
          hint={`vs ${o.days} j précédents`}
          icon={<Clock />}
        />
        <KpiCard
          label="Spectateurs actifs (7 j)"
          value={nf.format(o.active_viewers_7d)}
          change={delta(o.active_viewers_7d, o.active_viewers_prev_7d)}
          hint={`${nf.format(o.active_signins_7d)} connexions · ${nf.format(o.total_users)} inscrits`}
          icon={<Activity />}
        />
        <KpiCard
          label="Abonnements actifs"
          value={nf.format(o.active_subscriptions)}
          hint={`${o.total_users ? Math.round((o.active_subscriptions / o.total_users) * 100) : 0} % des inscrits · ${nf.format(o.completions_period)} contenus terminés`}
          icon={<CreditCard />}
        />
      </div>

      {/* Tendances */}
      <div className="grid gap-6 xl:grid-cols-2">
        <WatchTimeChart series={o.series} />
        <ViewersChart series={o.series} />
      </div>

      {/* Classements */}
      <TopTitlesTable rows={topTitles} days={o.days} />
      <TopUsersTable rows={topUsers} days={o.days} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="size-3.5" /> Temps mesuré à la lecture (progression réelle, plafonnée au temps écoulé) ; historique antérieur à la
        mise en place estimé à partir de la position atteinte.
      </p>
    </div>
  )
}
