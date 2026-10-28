import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Loader2, Megaphone, Send, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { Database } from '@/types/database'

type NType = Database['public']['Enums']['notification_type']
type Sent = Pick<Database['public']['Tables']['notifications']['Row'], 'id' | 'type' | 'message' | 'link' | 'created_at'>

const TYPES: { value: NType; label: string }[] = [
  { value: 'info', label: 'Information' },
  { value: 'warning', label: 'Avertissement' },
  { value: 'system', label: 'Annonce système' },
  { value: 'new_content', label: 'Nouveau contenu' },
]

export function BroadcastNotificationCard() {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [message, setMessage] = useState('')
  const [type, setType] = useState<NType>('info')
  const [link, setLink] = useState('')
  const [pending, setPending] = useState(false)
  const [recent, setRecent] = useState<Sent[]>([])

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, message, link, created_at')
      .is('user_id', null)
      .order('created_at', { ascending: false })
      .range(0, 4)
    setRecent(data ?? [])
  }, [supabase])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  const linkValid = link.trim() === '' || /^\/[^/]/.test(link.trim())
  const canSend = message.trim().length > 0 && message.length <= 500 && linkValid && !pending

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    setPending(true)
    const { error } = await supabase.rpc('admin_send_notification', {
      p_message: message.trim(),
      p_type: type,
      p_link: link.trim() || null,
      p_user: null,
    })
    setPending(false)
    if (error) {
      toast.error("Envoi impossible", { description: error.message })
      return
    }
    toast.success('Notification envoyée à tous les utilisateurs')
    setMessage('')
    setLink('')
    void loadRecent()
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    if (error) toast.error(error.message)
    else setRecent((r) => r.filter((n) => n.id !== id))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-5" /> Notification globale
        </CardTitle>
        <CardDescription>Diffusée instantanément (temps réel) à tous les utilisateurs connectés, et visible dans leur historique.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <form onSubmit={send} className="grid gap-3" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="bn-message">Message</Label>
            <Textarea
              id="bn-message"
              rows={3}
              maxLength={500}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Maintenance prévue ce soir de 23 h à minuit…"
            />
            <span className="text-right text-xs text-muted-foreground tabular-nums">{message.length}/500</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="bn-type">Type</Label>
              <NativeSelect id="bn-type" value={type} onChange={(e) => setType(e.target.value as NType)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bn-link">Lien interne (optionnel)</Label>
              <Input id="bn-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="/title/mon-film" aria-invalid={!linkValid} />
            </div>
          </div>
          {!linkValid && <p className="text-sm text-destructive">Chemin interne attendu (ex. /search?genre=action).</p>}
          <Button type="submit" disabled={!canSend} className="justify-self-start">
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Envoyer à tous
          </Button>
        </form>

        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Dernières alertes globales</p>
          {recent.length === 0 && <p className="text-sm text-muted-foreground">Aucune.</p>}
          <ul className="grid gap-2">
            {recent.map((n) => (
              <li key={n.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2">{n.message}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{TYPES.find((t) => t.value === n.type)?.label ?? n.type}</Badge>
                    {new Date(n.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label="Supprimer" onClick={() => void remove(n.id)}>
                  <Trash2 className="text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
