import type React from 'react'
import { useEffect, useState } from 'react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { AVATAR_PRESETS, type ProfileInput, type ViewerProfile } from '@/lib/viewer-profiles'

export type ProfileFormResult = { input: ProfileInput; newPin: string | null }

type Props = {
  open: boolean
  profile: ViewerProfile | null // null = création
  canDelete: boolean
  onSubmit: (r: ProfileFormResult) => Promise<string | null>
  onDelete: () => Promise<string | null>
  onClose: () => void
}

export function ProfileFormDialog({ open, profile, canDelete, onSubmit, onDelete, onClose }: Props) {
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>('preset:red')
  const [customUrl, setCustomUrl] = useState('')
  const [isKids, setIsKids] = useState(false)
  const [pinMode, setPinMode] = useState<'keep' | 'set' | 'remove'>('keep')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)

  useEffect(() => {
    if (!open) return
    setName(profile?.name ?? '')
    const url = profile?.avatar_url ?? `preset:${AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)].key}`
    setAvatar(url)
    setCustomUrl(url.startsWith('https://') ? url : '')
    setIsKids(profile?.is_kids_profile ?? false)
    setPinMode(profile ? 'keep' : 'remove')
    setPin('')
    setError(null)
  }, [open, profile])

  const effectiveAvatar = customUrl.trim() ? customUrl.trim() : avatar
  const urlValid = !customUrl.trim() || /^https:\/\/\S+$/.test(customUrl.trim())
  const pinValid = pinMode !== 'set' || /^\d{4}$/.test(pin)
  const valid = name.trim().length >= 1 && name.trim().length <= 30 && urlValid && pinValid

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy('save')
    setError(null)
    const newPin = pinMode === 'set' ? pin : pinMode === 'remove' && profile?.has_pin ? '' : null
    const err = await onSubmit({ input: { name: name.trim(), avatar_url: effectiveAvatar, is_kids: isKids }, newPin })
    setBusy(null)
    if (err) setError(err)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{profile ? 'Modifier le profil' : 'Ajouter un profil'}</DialogTitle>
          <DialogDescription>Chaque profil a son historique, sa liste et ses recommandations.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-5" noValidate>
          <div className="flex items-center gap-4">
            <ProfileAvatar name={name || '?'} avatarUrl={effectiveAvatar} isKids={isKids} className="size-20 shrink-0" textClassName="text-3xl" />
            <div className="grid flex-1 gap-2">
              <Label htmlFor="pf-name">Nom</Label>
              <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoFocus placeholder="Prénom" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Avatar</Label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_PRESETS.map((p) => {
                const key = `preset:${p.key}`
                const selected = !customUrl.trim() && avatar === key
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-label={`Avatar ${p.key}`}
                    aria-pressed={selected}
                    onClick={() => {
                      setAvatar(key)
                      setCustomUrl('')
                    }}
                    className={cn('relative size-10 rounded-md bg-gradient-to-br ring-offset-2 ring-offset-background transition', p.className, selected && 'ring-2 ring-white')}
                  >
                    {selected && <Check className="absolute inset-0 m-auto size-4 text-white" />}
                  </button>
                )
              })}
            </div>
            <Input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="…ou URL d'image https://" aria-invalid={!urlValid} />
          </div>

          <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">Profil Enfants</span>
              <span className="block text-xs text-muted-foreground">Uniquement les contenus tous publics / familiaux.</span>
            </span>
            <Switch checked={isKids} onCheckedChange={setIsKids} />
          </label>

          <div className="grid gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Verrouillage par code PIN</p>
              <p className="text-xs text-muted-foreground">
                Un PIN sur un profil adulte active le contrôle parental (requis pour créer un profil adulte ou retirer « Enfants »).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.has_pin && (
                <Button type="button" size="sm" variant={pinMode === 'keep' ? 'default' : 'outline'} onClick={() => setPinMode('keep')}>
                  Conserver
                </Button>
              )}
              <Button type="button" size="sm" variant={pinMode === 'set' ? 'default' : 'outline'} onClick={() => setPinMode('set')}>
                {profile?.has_pin ? 'Changer le PIN' : 'Définir un PIN'}
              </Button>
              <Button type="button" size="sm" variant={pinMode === 'remove' ? 'default' : 'outline'} onClick={() => setPinMode('remove')}>
                {profile?.has_pin ? 'Supprimer le PIN' : 'Sans PIN'}
              </Button>
            </div>
            {pinMode === 'set' && (
              <InputOTP maxLength={4} pattern={REGEXP_ONLY_DIGITS} value={pin} onChange={setPin} inputMode="numeric" aria-label="Nouveau PIN">
                <InputOTPGroup className="gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <InputOTPSlot key={i} index={i} className="size-11 rounded-md border text-lg first:rounded-md last:rounded-md" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="items-center sm:justify-between">
            {profile && canDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={!!busy}
                onClick={async () => {
                  setBusy('delete')
                  const err = await onDelete()
                  setBusy(null)
                  if (err) setError(err)
                }}
              >
                {busy === 'delete' ? <Loader2 className="animate-spin" /> : <Trash2 />} Supprimer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={!!busy}>
                Annuler
              </Button>
              <Button type="submit" disabled={!valid || !!busy}>
                {busy === 'save' && <Loader2 className="animate-spin" />} {profile ? 'Enregistrer' : 'Créer'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
