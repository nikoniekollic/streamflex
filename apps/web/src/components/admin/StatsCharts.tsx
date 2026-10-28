import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { Film, TrendingDown, TrendingUp, Tv } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dayFmt, dayLongFmt, formatDuration, hours, nf, type StatsOverview, type TopTitle, type TopUser } from '@/lib/stats'

// Série unique → couleur de marque (--primary, validée sur la surface sombre) ; grille et axes récessifs
const SERIES = 'var(--primary)'
const AXIS = { fontSize: 12, fill: 'var(--muted-foreground)' }

// ───────── KPI
export function KpiCard({
  label,
  value,
  hint,
  change,
  icon,
}: {
  label: string
  value: string
  hint?: string
  change?: number | null
  icon: ReactNode
}) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-5">
        <CardDescription className="text-sm font-medium text-muted-foreground">{label}</CardDescription>
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent className="grid gap-1 px-5">
        <p className="text-3xl font-bold tracking-tight tabular-nums">{value}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {change !== undefined && change !== null && (
            <span className={cn('inline-flex items-center gap-1 font-medium', change >= 0 ? 'text-foreground' : 'text-muted-foreground')}>
              {change >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {change >= 0 ? '+' : ''}
              {Math.round(change * 100)} %
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

// ───────── Tooltip commun
function ChartTooltip({ active, payload, kind }: TooltipProps<number, string> & { kind: 'time' | 'viewers' }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as StatsOverview['series'][number]
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 text-xs text-muted-foreground capitalize">{dayLongFmt.format(new Date(row.day))}</p>
      <p className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: SERIES }} aria-hidden />
        <span className="font-semibold tabular-nums">
          {kind === 'time' ? formatDuration(row.seconds) : `${nf.format(row.viewers)} spectateur${row.viewers > 1 ? 's' : ''}`}
        </span>
      </p>
    </div>
  )
}

const tickDay = (v: string) => dayFmt.format(new Date(v))

// ───────── Temps de visionnage par jour (aire)
export function WatchTimeChart({ series }: { series: StatsOverview['series'] }) {
  const data = series.map((d) => ({ ...d, hours: hours(d.seconds) }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Temps de visionnage par jour</CardTitle>
        <CardDescription>Heures regardées, tous utilisateurs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64" role="img" aria-label="Graphique du temps de visionnage quotidien">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="sf-watch-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickFormatter={tickDay} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v} h`} allowDecimals={false} />
              <Tooltip content={<ChartTooltip kind="time" />} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }} />
              <Area
                type="monotone"
                dataKey="hours"
                stroke={SERIES}
                strokeWidth={2}
                fill="url(#sf-watch-fill)"
                activeDot={{ r: 5, fill: SERIES, stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <DataTable series={series} />
      </CardContent>
    </Card>
  )
}

// ───────── Spectateurs actifs par jour (barres)
export function ViewersChart({ series }: { series: StatsOverview['series'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spectateurs actifs par jour</CardTitle>
        <CardDescription>Utilisateurs ayant regardé au moins un contenu</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64" role="img" aria-label="Graphique des spectateurs actifs quotidiens">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickFormatter={tickDay} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip content={<ChartTooltip kind="viewers" />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
              <Bar dataKey="viewers" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function DataTable({ series }: { series: StatsOverview['series'] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Voir les données</summary>
      <div className="mt-2 max-h-56 overflow-y-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jour</TableHead>
              <TableHead className="text-right">Temps</TableHead>
              <TableHead className="text-right">Spectateurs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...series].reverse().map((d) => (
              <TableRow key={d.day}>
                <TableCell>{dayFmt.format(new Date(d.day))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatDuration(d.seconds)}</TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(d.viewers)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  )
}

// ───────── Barre de progression native (part relative au 1er)
function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SERIES }} />
      </div>
      <span className="w-20 shrink-0 text-right text-sm tabular-nums">{label}</span>
    </div>
  )
}

// ───────── Top 10 contenus
export function TopTitlesTable({ rows, days }: { rows: TopTitle[]; days: number }) {
  const maxSeconds = Math.max(0, ...rows.map((r) => r.watch_seconds))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 des contenus les plus vus</CardTitle>
        <CardDescription>Classés par spectateurs uniques sur {days} jours</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Contenu</TableHead>
              <TableHead className="text-right">Spectateurs</TableHead>
              <TableHead className="min-w-56">Temps cumulé</TableHead>
              <TableHead className="text-right">Terminés</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Aucun visionnage sur la période.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.title_id}>
                <TableCell className="text-lg font-bold text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {r.poster_url ? (
                      <img src={r.poster_url} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded object-cover" />
                    ) : (
                      <div className="h-12 w-8 shrink-0 rounded bg-muted" />
                    )}
                    <div className="min-w-0">
                      <Link to="/admin/$id" params={{ id: r.title_id }} className="block max-w-56 truncate font-medium hover:underline">
                        {r.title}
                      </Link>
                      <Badge variant="outline" className="mt-1">
                        {r.type === 'movie' ? <Film /> : <Tv />}
                        {r.type === 'movie' ? 'Film' : 'Série'}
                      </Badge>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{nf.format(r.viewers)}</TableCell>
                <TableCell>
                  <Meter value={r.watch_seconds} max={maxSeconds} label={formatDuration(r.watch_seconds)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(r.completions)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ───────── Temps par utilisateur
export function TopUsersTable({ rows, days }: { rows: TopUser[]; days: number }) {
  const max = Math.max(0, ...rows.map((r) => r.watch_seconds))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Temps de visionnage par utilisateur</CardTitle>
        <CardDescription>10 plus gros consommateurs sur {days} jours</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utilisateur</TableHead>
              <TableHead className="min-w-56">Temps</TableHead>
              <TableHead className="text-right">Contenus</TableHead>
              <TableHead className="text-right">Dernier jour</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Aucune donnée.
                </TableCell>
              </TableRow>
            )}
            {rows.map((u) => (
              <TableRow key={u.user_id}>
                <TableCell className="max-w-56">
                  <p className="truncate font-medium">{u.display_name || u.email}</p>
                  {u.display_name && <p className="truncate text-xs text-muted-foreground">{u.email}</p>}
                </TableCell>
                <TableCell>
                  <Meter value={u.watch_seconds} max={max} label={formatDuration(u.watch_seconds)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(u.titles_watched)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{dayFmt.format(new Date(u.last_day))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
