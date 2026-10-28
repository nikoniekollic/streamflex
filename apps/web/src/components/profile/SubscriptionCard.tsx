import type React from 'react'
import { useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertCircle, CalendarClock, CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dateFr, daysLeft, formatCode, isSubscriptionActive, normalizeCode, redeemCode } from '@/lib/subscription'

export function SubscriptionCard() {
  const { supabase, subscription, isAdmin } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = isSubscriptionActive(subscription)
  const remaining = daysLeft(subscription)
  const complete = normalizeCode(code).length === 25

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete) return
    setPending(true)
    setError(null)
    const r = await redeemCode(supabase, code)
    setPending(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    setCode('')
    await router.invalidate()
    toast.success(`+${r.days} jours d'abonnement`, { description: `Actif jusqu'au ${dateFr.format(new Date(r.ends_at))}` })
  }

  return (
    <Card id="subscription" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Abonnement
          {isAdmin ? (
            <Badge variant="secondary">Accès admin</Badge>
          ) : active ? (
            <Badge>Actif</Badge>
          ) : subscription?.status === 'suspended' ? (
            <Badge variant="destructive">Suspendu</Badge>
          ) : (
            <Badge variant="outline">Inactif</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {subscription ? (
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-4" />
              {active
                ? `Jusqu'au ${dateFr.format(new Date(subscription.ends_at))} · ${remaining} jour${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''}`
                : `Expiré le ${dateFr.format(new Date(subscription.ends_at))}`}
            </span>
          ) : (
            'Aucun abonnement. Active un code pour accéder aux vidéos.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <Label htmlFor="activation-code">Code d'activation</Label>
          <Input
            id="activation-code"
            value={formatCode(code)}
            onChange={(e) => {
              setCode(e.target.value)
              setError(null)
            }}
            onPaste={(e) => {
              e.preventDefault()
              setCode(e.clipboardData.getData('text'))
            }}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            spellCheck={false}
            maxLength={29}
            aria-invalid={!!error}
            className="font-mono tracking-wider uppercase"
          />
          <p className="text-xs text-muted-foreground">{normalizeCode(code).length}/25 caractères</p>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Activation refusée</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={!complete || pending}>
            {pending ? <Loader2 className="animate-spin" /> : complete ? <CheckCircle2 /> : <KeyRound />} Activer le code
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
