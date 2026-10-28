import { useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CalendarClock, Loader2, Minus, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DURATION_PRESETS, adjustSubscription, setSubscription, userEvents, type AdminUser } from '@/lib/admin-ops'
import { dateFr, dateTimeFr } from '@/lib/subscription'

type Props = { user: AdminUser | null; onClose: () => void; onChanged: () => Promise<unknown> }
type Event = Awaited<ReturnType<typeof userEvents>>[number]

const SOURCE_LABEL: Record<string, string> = {
  code: 'Code',
  admin_adjust: 'Ajustement',
  admin_set: 'Date fixée',
  admin_status: 'Statut',
}

export function ManageSubscriptionDialog({ user, onClose, onChanged }: Props) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [amount, setAmount] = useState('30')
  const [unit, setUnit] = useState<'days' | 'years'>('days')
  const [note, setNote] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    if (!user) return
    setDate(user.sub_ends_at ? user.sub_ends_at.slice(0, 10) : '')
    setNote('')
    void userEvents(supabase, user.id).then(setEvents, () => setEvents([]))
  }, [user, supabase])

  if (!user) return null

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(success, { description: user.email })
      await onChanged()
      setEvents(await userEvents(supabase, user.id))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const days = () => {
    const n = Number(amount)
    return Number.isFinite(n) && n > 0 ? Math.round(unit === 'years' ? n * 365 : n) : 0
  }

  const adjust = (sign: 1 | -1, d = days()) =>
    act(`adj${sign}${d}`, () => adjustSubscription(supabase, user.id, sign * d, note), `${sign > 0 ? '+' : '−'}${d} jour(s)`)

  const active = user.sub_status === 'active' && !!user.sub_ends_at && new Date(user.sub_ends_at) > new Date()

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Abonnement — {user.display_name || user.email}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {user.email}
            {active ? <Badge>Actif</Badge> : user.sub_status === 'suspended' ? <Badge variant="destructive">Suspendu</Badge> : <Badge variant="outline">Inactif</Badge>}
            {user.sub_ends_at && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" /> {active ? 'jusqu’au' : 'expiré le'} {dateFr.format(new Date(user.sub_ends_at))}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-3">
          <Label>Activation rapide</Label>
          <div className="flex flex-wrap gap-2">
            {DURATION_PRESETS.map((p) => (
              <Button key={p.days} type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => void adjust(1, p.days)}>
                {busy === `adj1${p.days}` ? <Loader2 className="animate-spin" /> : <Plus />} {p.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border p-4">
          <Label htmlFor="adj-amount">Ajouter / retirer</Label>
          <div className="flex gap-2">
            <Input id="adj-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} className="w-24" />
            <div className="w-32">
              <NativeSelect value={unit} onChange={(e) => setUnit(e.target.value as 'days' | 'years')} aria-label="Unité">
                <option value="days">jour(s)</option>
                <option value="years">année(s)</option>
              </NativeSelect>
            </div>
            <Button type="button" disabled={!days() || !!busy} onClick={() => void adjust(1)}>
              <Plus /> Ajouter
            </Button>
            <Button type="button" variant="outline" disabled={!days() || !!busy} onClick={() => void adjust(-1)}>
              <Minus /> Retirer
            </Button>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note interne (optionnel)" maxLength={500} />
        </section>

        <section className="grid gap-3 rounded-lg border p-4">
          <Label htmlFor="set-date">Fixer la date de fin</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="set-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button
              type="button"
              variant="secondary"
              disabled={!date || !!busy}
              onClick={() =>
                void act('set', () => setSubscription(supabase, user.id, new Date(`${date}T23:59:59`).toISOString(), 'active', note), 'Date de fin mise à jour')
              }
            >
              Appliquer
            </Button>
            {user.sub_status === 'suspended' || user.sub_status === 'canceled' ? (
              <Button type="button" variant="outline" disabled={!!busy} onClick={() => void act('st', () => setSubscription(supabase, user.id, null, 'active', note), 'Abonnement réactivé')}>
                Réactiver
              </Button>
            ) : (
              user.sub_status && (
                <Button type="button" variant="destructive" disabled={!!busy} onClick={() => void act('st', () => setSubscription(supabase, user.id, null, 'suspended', note), 'Abonnement suspendu')}>
                  Suspendre
                </Button>
              )
            )}
          </div>
        </section>

        {events.length > 0 && (
          <section className="grid gap-2">
            <Label>Historique</Label>
            <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{SOURCE_LABEL[e.source] ?? e.source}</Badge>
                    {e.delta_days !== null && <span className={e.delta_days > 0 ? 'text-green-500' : 'text-destructive'}>{e.delta_days > 0 ? '+' : ''}{e.delta_days} j</span>}
                    {e.status && <span>{e.status}</span>}
                    {e.note && <span className="truncate text-muted-foreground">— {e.note}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{dateTimeFr.format(new Date(e.created_at))}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
