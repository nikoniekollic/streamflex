import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Loader2, RotateCcw, Unplug, WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { RETRYABLE_STREAM_ERRORS, STREAM_ERROR_MESSAGES, STREAM_ERROR_TITLES, type StreamErrorCode } from '@/lib/stream'

type Props = {
  title: string
  backdrop?: string | null
  onBack: () => void
} & ({ phase: 'resolving'; attempt?: number } | { phase: 'error'; code: StreamErrorCode; onRetry: () => void })

const STEPS = ['Recherche de la meilleure source…', 'Débridage du lien via Alldebrid…', 'Préparation du flux…']

export function StreamStatus(props: Props) {
  const { title, backdrop, onBack } = props
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black px-6">
      {backdrop && <img src={backdrop} alt="" aria-hidden className="absolute inset-0 size-full object-cover opacity-20 blur-sm" />}
      <button
        type="button"
        onClick={onBack}
        aria-label="Retour"
        className="absolute top-4 left-4 rounded-full p-2 text-white hover:bg-white/10 md:top-6 md:left-6"
      >
        <ArrowLeft className="size-7" />
      </button>

      <div className="relative w-full max-w-md">
        <p className="mb-4 text-center text-xl font-semibold text-white">{title}</p>
        {props.phase === 'resolving' ? <Resolving attempt={props.attempt ?? 1} /> : <Failure code={props.code} onRetry={props.onRetry} />}
      </div>
    </div>
  )
}

function Resolving({ attempt }: { attempt: number }) {
  return (
    <Alert className="border-white/10 bg-black/70 backdrop-blur" aria-live="polite" aria-busy="true">
      <Loader2 className="animate-spin text-primary" />
      <AlertTitle>{attempt > 1 ? `Nouvelle tentative (${attempt})…` : 'Chargement de la vidéo'}</AlertTitle>
      <AlertDescription>
        <ol className="mt-1 grid gap-1">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2 animate-in fade-in" style={{ animationDelay: `${i * 600}ms`, animationFillMode: 'both' }}>
              <span className="size-1.5 rounded-full bg-primary" /> {s}
            </li>
          ))}
        </ol>
      </AlertDescription>
    </Alert>
  )
}

function Failure({ code, onRetry }: { code: StreamErrorCode; onRetry: () => void }) {
  const Icon = code === 'network' ? WifiOff : code === 'debrid_unavailable' ? Unplug : AlertTriangle
  const retryable = RETRYABLE_STREAM_ERRORS.includes(code)
  return (
    <div className="grid gap-4">
      <Alert variant="destructive" className="border-destructive/40 bg-black/80 backdrop-blur">
        <Icon />
        <AlertTitle>{STREAM_ERROR_TITLES[code]}</AlertTitle>
        <AlertDescription>{STREAM_ERROR_MESSAGES[code]}</AlertDescription>
      </Alert>
      <div className="flex justify-center gap-3">
        {retryable && (
          <Button onClick={onRetry}>
            <RotateCcw /> Réessayer
          </Button>
        )}
        {code === 'subscription_required' ? (
          <Button asChild>
            <Link to="/profile" hash="subscription">
              Activer un code
            </Link>
          </Button>
        ) : code === 'unauthorized' ? (
          <Button asChild variant="secondary">
            <Link to="/login">Se reconnecter</Link>
          </Button>
        ) : (
          <Button asChild variant="secondary">
            <Link to="/">Accueil</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
