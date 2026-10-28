import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

export const PERIODS = [7, 30, 90] as const
export type Period = (typeof PERIODS)[number]

export type StatsOverview = {
  days: number
  total_watch_seconds: number
  period_watch_seconds: number
  prev_period_watch_seconds: number
  active_viewers_7d: number
  active_viewers_prev_7d: number
  active_signins_7d: number
  total_users: number
  active_subscriptions: number
  published_titles: number
  completions_period: number
  series: { day: string; seconds: number; viewers: number }[]
}
export type TopTitle = Database['public']['Functions']['admin_stats_top_titles']['Returns'][number]
export type TopUser = Database['public']['Functions']['admin_stats_user_watch_time']['Returns'][number]

export async function fetchStats(supabase: TypedSupabaseClient, days: Period) {
  const [overview, titles, users] = await Promise.all([
    supabase.rpc('admin_stats_overview', { p_days: days }),
    supabase.rpc('admin_stats_top_titles', { p_days: days, p_limit: 10 }),
    supabase.rpc('admin_stats_user_watch_time', { p_days: days, p_limit: 10 }),
  ])
  if (overview.error) throw overview.error
  if (titles.error) throw titles.error
  if (users.error) throw users.error
  return { overview: overview.data as unknown as StatsOverview, topTitles: titles.data, topUsers: users.data }
}

/** 3 725 s → « 1 h 02 », 59 s → « 59 s », 90 000 s → « 25 h » */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m} min`
  if (h >= 100) return `${new Intl.NumberFormat('fr-FR').format(h)} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

export const hours = (seconds: number) => Math.round((seconds / 3600) * 10) / 10

/** Variation relative ; null si pas de base de comparaison. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0
  return (current - previous) / previous
}

export const nf = new Intl.NumberFormat('fr-FR')
export const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
export const dayLongFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
