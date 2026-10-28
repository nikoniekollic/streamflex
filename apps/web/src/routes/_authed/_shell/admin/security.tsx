import type React from 'react'
import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Ban, DatabaseZap, Eye, EyeOff, KeyRound, Loader2, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  API_KEYS,
  BAN_PRESETS,
  banIp,
  deleteApiKey,
  generateSecret,
  isValidIpOrCidr,
  listApiKeys,
  listBans,
  setApiKey,
  unbanIp,
} from '@/lib/admin-ops'
import { clearIpStatus } from '@/lib/security'
import { invalidateCatalogCache } from '@/lib/catalog-api'
import { dateTimeFr } from '@/lib/subscription'

export const Route = createFileRoute('/_authed/_shell/admin/security')({
  loader: async ({ context }) => {
    const [bans, keys] = await Promise.all([listBans(context.supabase), listApiKeys(context.supabase)])
    return { bans, keys }
  },
  staleTime: 0,
  component: SecurityPage,
})

function SecurityPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="grid content-start gap-6">
        <IpBans />
        <CatalogCache />
      </div>
      <ApiKeys />
    </div>
  )
}

// ───────── Liste noire IP
function IpBans() {
  const bans = Route.useLoaderData().bans || []
  const { supabase, user, ip: myIp } = Route.useRouteContext()
  const router = useRouter()
  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('')
  const [preset, setPreset] = useState('1440')
  const [pending, setPending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const value = ip.trim()
  const valid = isValidIpOrCidr(value)
  const self = !!myIp.ip && (value === myIp.ip || value === `${myIp.ip}/32`)
  const now = Date.now()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || self) return
    setPending(true)
    try {
      const minutes = preset === 'permanent' ? null : Number(preset)
      await banIp(supabase, value, reason, minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null, user.id)
      toast.success(`${value} bloquée`)
      setIp('')
      setReason('')
      await router.invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  const remove = async (id: string, label: string) => {
    setBusyId(id)
    try {
      await unbanIp(supabase, id)
      clearIpStatus()
      toast.success(`${label} débloquée`)
      await router.invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-5" /> Liste noire IP
        </CardTitle>
        <CardDescription>
          Bloque toutes les requêtes API (middleware PostgREST) et Edge Functions. Ton IP : <code>{myIp.ip ?? 'inconnue'}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="grid gap-2">
              <Label htmlFor="ban-ip">IP ou plage CIDR</Label>
              <Input id="ban-ip" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7 ou 203.0.113.0/24" aria-invalid={!!value && (!valid || self)} className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ban-dur">Durée</Label>
              <NativeSelect id="ban-dur" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {BAN_PRESETS.map((p) => (
                  <option key={p.label} value={p.minutes ?? 'permanent'}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (affiché à l'utilisateur bloqué)" maxLength={300} />
          {self && <p className="text-sm text-destructive">Impossible de bloquer ta propre IP.</p>}
          {value && !valid && <p className="text-sm text-destructive">Format IP / CIDR invalide.</p>}
          <Button type="submit" variant="destructive" disabled={!valid || self || pending} className="justify-self-start">
            {pending ? <Loader2 className="animate-spin" /> : <Ban />} {preset === 'permanent' ? 'Bannir' : 'Suspendre temporairement'}
          </Button>
        </form>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IP</TableHead>
              <TableHead>Motif</TableHead>
              <TableHead>Expiration</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bans.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Aucune IP bloquée.
                </TableCell>
              </TableRow>
            )}
            {bans.map((b) => {
              const expired = !!b.expires_at && new Date(b.expires_at).getTime() <= now
              return (
                <TableRow key={b.id} className={expired ? 'opacity-50' : undefined}>
                  <TableCell className="font-mono text-xs">{b.ip}</TableCell>
                  <TableCell className="max-w-48 truncate">{b.reason ?? '—'}</TableCell>
                  <TableCell>
                    {!b.expires_at ? (
                      <Badge variant="destructive">Permanent</Badge>
                    ) : expired ? (
                      <Badge variant="outline">Expiré</Badge>
                    ) : (
                      <span className="text-sm">{dateTimeFr.format(new Date(b.expires_at))}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" aria-label={`Débloquer ${b.ip}`} disabled={busyId === b.id} onClick={() => void remove(b.id, b.ip)}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ───────── Cache Redis du catalogue
function CatalogCache() {
  const { supabase } = Route.useRouteContext()
  const [pending, setPending] = useState(false)
  const purge = async () => {
    setPending(true)
    const ok = await invalidateCatalogCache(supabase)
    setPending(false)
    if (ok) toast.success('Cache du catalogue purgé')
    else toast.error('Purge impossible (fonction `catalog` non déployée ou Redis non configuré ?)')
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZap className="size-5" /> Cache Redis du catalogue
        </CardTitle>
        <CardDescription>
          Accueil et recherche servis depuis Redis (TTL 1 h). Purge automatique à chaque modification du catalogue (webhook BDD) ; purge
          manuelle ci-dessous.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => void purge()} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <DatabaseZap />} Purger le cache maintenant
        </Button>
      </CardContent>
    </Card>
  )
}

// ───────── Clés API (Supabase Vault)
function ApiKeys() {
  const keys = Route.useLoaderData().keys || []
  const configured = new Map(keys.map((k) => [k.name, k]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" /> Clés API
        </CardTitle>
        <CardDescription>Chiffrées dans Supabase Vault, lues uniquement par les Edge Functions (prise en compte sous 5 min).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Alert>
          <ShieldAlert />
          <AlertTitle>Écriture seule</AlertTitle>
          <AlertDescription>Les valeurs ne sont jamais renvoyées au navigateur : seuls les 4 derniers caractères sont affichés.</AlertDescription>
        </Alert>
        {API_KEYS.map((k) => (
          <ApiKeyRow key={k.name} def={k} current={configured.get(k.name)} />
        ))}
      </CardContent>
    </Card>
  )
}

function ApiKeyRow({
  def,
  current,
}: {
  def: (typeof API_KEYS)[number]
  current?: { last4: string | null; updated_at: string; updated_by_email: string | null }
}) {
  const { supabase } = Route.useRouteContext()
  const router = useRouter()
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim().length < 3) return
    setBusy('save')
    try {
      await setApiKey(supabase, def.name, value)
      setValue('')
      toast.success(`${def.label} mise à jour`)
      await router.invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('delete')
    try {
      await deleteApiKey(supabase, def.name)
      toast.success(`${def.label} supprimée (fallback variable d'environnement)`)
      await router.invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-2 rounded-lg border p-4" autoComplete="off">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={`k-${def.name}`} className="font-medium">
          {def.label}
        </Label>
        {current ? (
          <Badge variant="secondary" className="font-mono">
            ••••{current.last4}
          </Badge>
        ) : (
          <Badge variant="outline">Non configurée</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <code>{def.name}</code> · {def.help}
        {current && ` · modifiée ${dateTimeFr.format(new Date(current.updated_at))}${current.updated_by_email ? ` par ${current.updated_by_email}` : ''}`}
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={`k-${def.name}`}
            type={def.secret && !show ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={current ? 'Nouvelle valeur…' : 'Valeur…'}
            autoComplete="new-password"
            spellCheck={false}
            className="pr-10 font-mono"
          />
          {def.secret && (
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Masquer' : 'Afficher'} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
        {def.name === 'CATALOG_WEBHOOK_SECRET' && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Générer un secret"
            title="Générer un secret aléatoire"
            onClick={() => {
              setValue(generateSecret())
              setShow(true)
            }}
          >
            <Sparkles />
          </Button>
        )}
        <Button type="submit" disabled={value.trim().length < 3 || !!busy}>
          {busy === 'save' && <Loader2 className="animate-spin" />} Enregistrer
        </Button>
        {current && (
          <Button type="button" variant="ghost" size="icon" aria-label="Supprimer" disabled={!!busy} onClick={() => void remove()}>
            <Trash2 className="text-destructive" />
          </Button>
        )}
      </div>
    </form>
  )
}
