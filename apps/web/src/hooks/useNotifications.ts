import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

export type NotificationItem = Database['public']['Functions']['my_notifications']['Returns'][number]
type Row = Database['public']['Tables']['notifications']['Row']

const LIMIT = 50

export function useNotifications() {
  const { supabase, user } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const firstSubscribe = useRef(true)

  // ── Historique
  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('my_notifications', { p_limit: LIMIT })
    if (err) setError(err.message)
    else {
      setError(null)
      setItems(data ?? [])
    }
    setLoading(false)
  }, [supabase])

  // ── Temps réel : nouvelles insertions (RLS appliquée côté Realtime : les siennes + les globales)
  useEffect(() => {
    void load()
    const channel = supabase
      .channel('custom-insert-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as Row
        if (n.user_id && n.user_id !== user.id) return
        const item: NotificationItem = {
          id: n.id,
          type: n.type,
          message: n.message,
          link: n.link,
          is_global: n.user_id === null,
          read: false,
          created_at: n.created_at,
        }
        setItems((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev].slice(0, LIMIT)))
        toast(item.message, {
          action: item.link ? { label: 'Voir', onClick: () => void router.history.push(item.link!) } : undefined,
        })
      })
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED')
        // reconnexion : rattrape ce qui a pu être manqué
        if (status === 'SUBSCRIBED' && !firstSubscribe.current) void load()
        if (status === 'SUBSCRIBED') firstSubscribe.current = false
      })

    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [supabase, user.id, load, router])

  // ── Lecture
  const markRead = useCallback(
    async (id: string) => {
      const target = items.find((i) => i.id === id)
      if (!target || target.read) return
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)))
      const { error: err } = await supabase.rpc('mark_notification_read', { p_id: id })
      if (err) setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: false } : i)))
    },
    [items, supabase],
  )

  const markAllRead = useCallback(async () => {
    const snapshot = items
    setItems((prev) => prev.map((i) => ({ ...i, read: true })))
    const { error: err } = await supabase.rpc('mark_all_notifications_read')
    if (err) {
      setItems(snapshot)
      toast.error('Impossible de tout marquer comme lu')
    }
  }, [items, supabase])

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items])

  return { items, unreadCount, loading, error, live, markRead, markAllRead, reload: load }
}
