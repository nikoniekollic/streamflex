import { useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Loader2, RotateCcw, Unplug, WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { directNoticeStore, RETRYABLE_STREAM_ERRORS, STREAM_ERROR_MESSAGES, STREAM_ERROR_TITLES, type StreamErrorCode } from '@/lib/stream'

type Props = {
  title: string
  backdrop?: string | null
  onBack: () => void
  /** posé dans la fenêtre du lecteur (et non plein écran) */
  embedded?: boolean
} & ({ phase: 'resolving'; attempt?: number } | { phase: 'error'; code: StreamErrorCode; detail?: string; onRetry: () => void })

export function StreamStatus(props: Props) {
  const { title, backdrop, onBack } = props
  return (
    <div className={`${props.embedded ? 'absolute' : 'fixed z-50'} inset-0 flex items-center justify-center bg-black px-6`}>
      {backdrop && props.phase === 'error' && <img src={backdrop} alt="" aria-hidden className="absolute inset-0 size-full object-cover opacity-20 blur-sm" />}
      <button
        type="button"
        onClick={onBack}
        aria-label="Retour"
        className="absolute top-4 left-4 rounded-full p-2 text-white hover:bg-white/10 md:top-6 md:left-6"
      >
        <ArrowLeft className="size-7" />
      </button>

      <div className="relative w-full max-w-md">
        {props.phase === 'error' && <p className="mb-4 text-center text-xl font-semibold text-white">{title}</p>}
        {props.phase === 'resolving' ? <Resolving /> : <Failure code={props.code} detail={props.detail} onRetry={props.onRetry} />}
      </div>
    </div>
  )
}

function Resolving() {
  // Aucun texte en temps normal : une petite roue n'apparaît qu'au bout d'une seconde si la résolution traîne.
  // Quand Alldebrid a atteint ses limites, on l'indique : le lien est obtenu directement chez 1fichier (un peu plus long).
  const direct = useSyncExternalStore(directNoticeStore.subscribe, directNoticeStore.get)
  return (
    <div className="flex flex-col items-center gap-3" aria-live="polite" aria-busy="true">
      <Loader2 className="size-9 animate-spin text-white/60 animate-in fade-in" style={{ animationDelay: '1000ms', animationFillMode: 'both' }} />
      {direct && <p className="text-center text-sm text-white/70 animate-in fade-in">Alldebrid indisponible : connexion directe via 1fichier…</p>}
    </div>
  )
}

function Failure({ code, detail, onRetry }: { code: StreamErrorCode; detail?: string; onRetry: () => void }) {
  const Icon = code === 'network' ? WifiOff : code === 'source_unavailable' ? Unplug : AlertTriangle
  const retryable = RETRYABLE_STREAM_ERRORS.includes(code)
  return (
    <div className="grid gap-4">
      <Alert variant="destructive" className="border-destructive/40 bg-black/80 backdrop-blur">
        <Icon />
        <AlertTitle>{STREAM_ERROR_TITLES[code]}</AlertTitle>
        <AlertDescription>
          {STREAM_ERROR_MESSAGES[code]}
          {detail && <span className="mt-1 block text-xs opacity-70">Détail technique : {detail}</span>}
        </AlertDescription>
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
