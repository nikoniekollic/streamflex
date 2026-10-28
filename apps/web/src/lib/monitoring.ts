import type { TypedSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

export type ColdSource = Database['public']['Functions']['admin_cold_sources']['Returns'][number]
export type ColdSummary = Database['public']['Functions']['admin_cold_sources_summary']['Returns'][number]
export type MonitoringSearch = {
  days?: number
  provider?: 'pixeldrain' | 'onefichier'
  status?: 'never' | 'offline'
  page?: number
}

export const DEFAULT_DAYS = 25
export const THRESHOLDS = [15, 25, 45, 60]
export const MONITOR_PAGE = 50
/** Seuil « critique » = seuil + 20 j (cohérent avec admin_cold_sources_summary) */
export const CRITICAL_MARGIN = 20

export function validateMonitoringSearch(s: Record<string, unknown>): MonitoringSearch {
  const out: MonitoringSearch = {}
  const days = Number(s.days)
  if (THRESHOLDS.includes(days) && days !== DEFAULT_DAYS) out.days = days
  if (s.provider === 'pixeldrain' || s.provider === 'onefichier') out.provider = s.provider
  if (s.status === 'never' || s.status === 'offline') out.status = s.status
  const page = Number(s.page)
  if (Number.isInteger(page) && page > 1) out.page = page
  return out
}

export async function fetchMonitoring(supabase: TypedSupabaseClient, q: MonitoringSearch) {
  const days = q.days ?? DEFAULT_DAYS
  const [list, summary] = await Promise.all([
    supabase.rpc('admin_cold_sources', {
      p_days: days,
      p_provider: q.provider ?? null,
      p_status: q.status ?? null,
      p_limit: MONITOR_PAGE,
      p_offset: ((q.page ?? 1) - 1) * MONITOR_PAGE,
    }),
    supabase.rpc('admin_cold_sources_summary', { p_days: days }),
  ])
  if (list.error) throw list.error
  if (summary.error) throw summary.error
  const rows = list.data ?? []
  const total = rows[0]?.total_count ?? 0
  return { rows, total, pageCount: Math.max(1, Math.ceil(total / MONITOR_PAGE)), summary: summary.data ?? [], days }
}

// ───────── Maintenance (Edge `source-maintenance`)
export type MaintenanceAction = 'info' | 'touch'
export type MaintenanceOutcome = {
  id: string
  ok: boolean
  status: number
  state: 'online' | 'offline' | 'error'
  name?: string | null
  size?: number | null
  views?: number | null
  downloads?: number | null
  lastViewAt?: string | null
  bytesRead?: number
  message?: string
}

export const MAX_BATCH: Record<MaintenanceAction, number> = { info: 25, touch: 5 }

export async function runMaintenance(
  supabase: TypedSupabaseClient,
  ids: string[],
  action: MaintenanceAction,
): Promise<MaintenanceOutcome[]> {
  const out: MaintenanceOutcome[] = []
  for (let i = 0; i < ids.length; i += MAX_BATCH[action]) {
    const { data, error } = await supabase.functions.invoke<{ results: MaintenanceOutcome[] }>('source-maintenance', {
      body: { ids: ids.slice(i, i + MAX_BATCH[action]), action },
    })
    if (error || !data) throw new Error('Fonction source-maintenance indisponible')
    out.push(...data.results)
  }
  return out
}

export type Severity = 'critical' | 'risk' | 'never' | 'offline'

export function severity(r: Pick<ColdSource, 'last_streamed_at' | 'idle_days' | 'last_status'>, days: number): Severity {
  if (r.last_status === 404 || r.last_status === 410) return 'offline'
  if (r.idle_days >= days + CRITICAL_MARGIN) return 'critical'
  if (!r.last_streamed_at) return 'never'
  return 'risk'
}

export const fmtSize = (n: number | null) =>
  n == null ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} Go` : `${Math.round(n / 1024 ** 2)} Mo`
