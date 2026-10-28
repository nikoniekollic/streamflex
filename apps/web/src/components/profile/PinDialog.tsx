import { useEffect, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

type Props = {
  open: boolean
  title: string
  description?: string
  /** renvoie un message d'erreur, ou null si OK */
  onSubmit: (pin: string) => Promise<string | null>
  onClose: () => void
}

/** Saisie d'un PIN à 4 chiffres (Shadcn InputOTP) — validation automatique au 4e chiffre. */
export function PinDialog({ open, title, description, onSubmit, onClose }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setPin('')
      setError(null)
    }
  }, [open])

  const submit = async (value: string) => {
    setPending(true)
    const err = await onSubmit(value)
    setPending(false)
    if (err) {
      setError(err)
      setPin('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-sm bg-neutral-950 text-center sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
            <Lock className="size-5" />
          </span>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <InputOTP
            maxLength={4}
            pattern={REGEXP_ONLY_DIGITS}
            value={pin}
            onChange={(v) => {
              setPin(v)
              setError(null)
            }}
            onComplete={(v: string) => void submit(v)}
            autoFocus
            disabled={pending}
            inputMode="numeric"
            aria-label="Code PIN à 4 chiffres"
          >
            <InputOTPGroup className="gap-3">
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  aria-invalid={!!error}
                  className="size-14 rounded-md border text-2xl first:rounded-md last:rounded-md [-webkit-text-security:disc]"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <div className="h-5 text-sm" aria-live="polite">
            {pending ? <Loader2 className="size-4 animate-spin" /> : error ? <span className="text-destructive">{error}</span> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
