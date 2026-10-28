import type React from 'react'
import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Ban, Copy, Download, KeyRound, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DURATION_PRESETS, downloadCodesCsv, generateCodes, listCodes, setCodeStatus } from '@/lib/admin-ops'
import { dateFr, dateTimeFr } from '@/lib/subscription'
import type { Enums } from '@/types/database'

type CodeStatus = Enums<'activation_code_status'>
type Search = { status?: CodeStatus }

export const Route = createFileRoute('/_authed/_shell/admin/billing')({
  validateSearch: (s: Record<string, unknown>): Search =>
    ['active', 'used', 'revoked'].includes(s.status as string) ? { status: s.status as CodeStatus } : {},
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => listCodes(context.supabase, deps.status),
  staleTime: 0,
  component: BillingPage,
})

const STATUS_BADGE: Record<CodeStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  active: { label: 'Disponible', variant: 'default' },
  used: { label: 'Utilisé', variant: 'secondary' },
  revoked: { label: 'Désactivé', variant: 'destructive' },
}

function BillingPage() {
  const data = Route.useLoaderData()
  const rows = data.rows || []
  const total = data.total || 0
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const { supabase } = Route.useRouteContext()

  const [count, setCount] = useState('10')
  const [days, setDays] = useState('30')
  const [label, setLabel] = useState('')
  const [expires, setExpires] = useState('')
  const [pending, setPending] = useState(false)
  const [generated, setGenerated] = useState<{ codes: { code: string }[]; days: number; label: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const n = Number(count)
  const d = Number(days)
  const valid = Number.isInteger(n) && n >= 1 && n <= 500 && Number.isInteger(d) && d >= 1 && d <= 3650

  const generate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setPending(true)
    try {
      const codes = ((await generateCodes(supabase, n, d, label, expires ? new Date(`${expires}T23:59:59`).toISOString() : null)) || []) as { id: string; code: string }[]
      setGenerated({ codes, days: d, label })
      toast.success(`${codes.length} code(s) générés`)
      await router.invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  const toggle = async (id: string, status: 'active' | 'revoked') => {
    setBusyId(id)
    try {
      await setCodeStatus(supabase, id, status)
      await router.invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5" /> Générer des codes
            </CardTitle>
            <CardDescription>Codes de 25 caractères (alphabet sans 0/O/1/I), à usage unique.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={generate} className="grid gap-4" noValidate>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="g-count">Quantité</Label>
                  <Input id="g-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="g-days">Durée (jours)</Label>
                  <Input id="g-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((p) => (
                  <Button key={p.days} type="button" size="sm" variant={String(p.days) === days ? 'default' : 'outline'} onClick={() => setDays(String(p.days))}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="g-label">Libellé (optionnel)</Label>
                <Input id="g-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="ex. Promo Noël" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="g-exp">Expiration du code (optionnel)</Label>
                <Input id="g-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </div>
              <Button type="submit" disabled={!valid || pending}>
                {pending && <Loader2 className="animate-spin" />} Générer {valid ? `${n} code${n > 1 ? 's' : ''} de ${d} j` : ''}
              </Button>
            </form>
          </CardContent>
        </Card>

        {generated && (
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle>Codes générés</CardTitle>
              <Alert>
                <TriangleAlert />
                <AlertTitle>Affichés une seule fois</AlertTitle>
                <AlertDescription>Seule une empreinte est stockée : copie ou télécharge-les maintenant.</AlertDescription>
              </Alert>
            </CardHeader>
            <CardContent className="grid gap-3">
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-6 select-all">
                {generated.codes.map((c) => c.code).join('\n')}
              </pre>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(generated.codes.map((c) => c.code).join('\n')).then(() => toast.success('Copié'))}
                >
                  <Copy /> Copier
                </Button>
                <Button type="button" variant="secondary" onClick={() => downloadCodesCsv(generated.codes, generated.days, generated.label)}>
                  <Download /> CSV
                </Button>
                <Button type="button" variant="ghost" onClick={() => setGenerated(null)}>
                  Masquer
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Codes d'activation</CardTitle>
            <CardDescription>{total} code(s){search.status ? ` · ${STATUS_BADGE[search.status].label.toLowerCase()}` : ''} — 100 plus récents</CardDescription>
          </div>
          <div className="w-40">
            <NativeSelect
              aria-label="Statut"
              value={search.status ?? ''}
              onChange={(e) => navigate({ search: { status: (e.target.value || undefined) as CodeStatus | undefined }, replace: true })}
            >
              <option value="">Tous</option>
              <option value="active">Disponibles</option>
              <option value="used">Utilisés</option>
              <option value="revoked">Désactivés</option>
            </NativeSelect>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Durée</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Créé</TableHead>
                <TableHead>Expire / utilisé</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Aucun code.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code_hint}</TableCell>
                  <TableCell>{c.duration_days} j</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[c.status].variant}>{STATUS_BADGE[c.status].label}</Badge>
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{c.label ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{dateFr.format(new Date(c.created_at))}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.used_at ? `utilisé ${dateTimeFr.format(new Date(c.used_at))}` : c.expires_at ? `expire ${dateFr.format(new Date(c.expires_at))}` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === 'active' && (
                      <Button size="sm" variant="ghost" disabled={busyId === c.id} onClick={() => void toggle(c.id, 'revoked')}>
                        <Ban className="text-destructive" /> Désactiver
                      </Button>
                    )}
                    {c.status === 'revoked' && (
                      <Button size="sm" variant="ghost" disabled={busyId === c.id} onClick={() => void toggle(c.id, 'active')}>
                        <RotateCcw /> Réactiver
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
