import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AlertTriangle, Bell, CheckCheck, CreditCard, Film, Info, Megaphone, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useNotifications, type NotificationItem } from '@/hooks/useNotifications'

const ICONS: Record<NotificationItem['type'], LucideIcon> = {
  info: Info,
  new_content: Film,
  subscription: CreditCard,
  warning: AlertTriangle,
  system: Megaphone,
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
function timeAgo(iso: string): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return rtf.format(Math.round(s), 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(iso).toLocaleDateString('fr-FR')
}

export function NotificationBell() {
  const { items, unreadCount, loading, error, live, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const openItem = (n: NotificationItem) => {
    void markRead(n.id)
    if (n.link) {
      setOpen(false)
      router.history.push(n.link)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Notifications'}
          className="relative flex size-9 items-center justify-center rounded-full text-neutral-200 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <Bell key={unreadCount} className={cn('size-5', unreadCount > 0 && 'animate-[wiggle_1s_ease-in-out_1]')} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground ring-2 ring-black tabular-nums">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="font-semibold">Notifications</p>
            <span
              className={cn('size-2 rounded-full', live ? 'bg-green-500' : 'bg-neutral-500')}
              title={live ? 'Temps réel connecté' : 'Temps réel déconnecté'}
              aria-hidden
            />
          </div>
          <Button variant="ghost" size="sm" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
            <CheckCheck /> Tout lire
          </Button>
        </div>
        <ScrollArea className="h-[min(24rem,60vh)]">
          {loading ? (
            <ul className="grid gap-1 p-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="h-14 animate-pulse rounded-md bg-muted" />
              ))}
            </ul>
          ) : error ? (
            <p className="p-6 text-center text-sm text-destructive">Impossible de charger les notifications.</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Bell className="size-8 opacity-40" />
              Aucune notification pour le moment.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = ICONS[n.type] ?? Info
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                        !n.read && 'bg-primary/5',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                          n.type === 'warning' ? 'bg-amber-500/15 text-amber-400' : 'bg-muted text-foreground',
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm', !n.read && 'font-medium')}>{n.message}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {timeAgo(n.created_at)}
                          {n.is_global && ' · tous les utilisateurs'}
                        </span>
                      </span>
                      {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Non lue" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
