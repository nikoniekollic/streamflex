import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

export type NotificationItem = Database['public']['Functions']['my_notifications']['Returns'][number]
type Row = Database['public']['Tables']['notifications']['Row']

const LIMIT = 50
const FLUSH_MS = 1200 // les notifications arrivées ensemble sont regroupées en UNE bulle
const TOAST_ID = 'sf-live-notifications'

export function useNotifications() {
  const { supabase, user } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const firstSubscribe = useRef(true)
  const buffer = useRef<NotificationItem[]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const updates = useRef(new Map<string, Row>())

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
    // Arrivées groupées : une seule mise à jour de la liste et UNE bulle (remplacée, jamais empilée) toutes les 1,2 s,
    // même si des centaines de notifications arrivent d'un coup (import massif)
    const flush = () => {
      flushTimer.current = undefined
      const batch = buffer.current
      buffer.current = []
      const changed = [...updates.current.values()]
      updates.current.clear()
      if (changed.length)
        setItems((prev) => prev.map((p) => {
          const n = changed.find((c) => c.id === p.id)
          return n ? { ...p, message: n.message, link: n.link, read: false } : p
        }))
      if (!batch.length) return
      setItems((prev) => {
        const known = new Set(prev.map((p) => p.id))
        return [...batch.filter((b) => !known.has(b.id)).reverse(), ...prev].slice(0, LIMIT)
      })
      if (document.visibilityState !== 'visible') return // onglet caché : la cloche suffit
      const one = batch.length === 1 ? batch[0] : null
      const link = one ? one.link : '/browse?sort=recent'
      toast(one ? one.message : `${batch.length} nouvelles notifications`, {
        id: TOAST_ID,
        action: link ? { label: 'Voir', onClick: () => void router.history.push(link) } : undefined,
      })
    }
    const toItem = (n: Row): NotificationItem => ({ id: n.id, type: n.type, message: n.message, link: n.link, is_global: n.user_id === null, read: false, created_at: n.created_at })
    const channel = supabase
      .channel('custom-insert-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as Row
        if (n.user_id && n.user_id !== user.id) return
        buffer.current.push(toItem(n))
        if (buffer.current.length > 200) buffer.current = buffer.current.slice(-LIMIT)
        flushTimer.current ??= setTimeout(flush, FLUSH_MS)
      })
      // notification regroupée mise à jour (« 245 nouvelles vidéos ») : la liste suit, sans nouvelle bulle
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
        const n = payload.new as Row
        if (n.user_id && n.user_id !== user.id) return
        updates.current.set(n.id, n) // regroupé avec le reste (une mise à jour par vidéo importée sinon)
        flushTimer.current ??= setTimeout(flush, FLUSH_MS)
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
      clearTimeout(flushTimer.current)
      flushTimer.current = undefined
      buffer.current = []
      updates.current.clear()
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
