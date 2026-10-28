import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Ban, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getIpStatus } from '@/lib/security'
import { dateTimeFr } from '@/lib/subscription'

export const Route = createFileRoute('/banned')({
  loader: ({ context }) => getIpStatus(context.supabase, true),
  staleTime: 0,
  component: BannedPage,
})

function BannedPage() {
  const status = Route.useLoaderData()
  const router = useRouter()

  return (
    <main className="flex min-h-dvh items-center justify-center bg-black px-6">
      <div className="grid w-full max-w-md gap-6 text-center">
        <span className="text-3xl font-extrabold tracking-tight text-primary">STREAMFLEX</span>
        {status.banned ? (
          <Alert variant="destructive" className="text-left">
            <Ban />
            <AlertTitle>Accès bloqué</AlertTitle>
            <AlertDescription>
              <p>L'accès à la plateforme est bloqué depuis ton adresse IP{status.ip ? ` (${status.ip})` : ''}.</p>
              {status.reason && <p>Motif : {status.reason}</p>}
              <p>{status.expires_at ? `Levée prévue le ${dateTimeFr.format(new Date(status.expires_at))}.` : 'Blocage permanent.'}</p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="text-left">
            <AlertTitle>Accès rétabli</AlertTitle>
            <AlertDescription>Ton adresse IP n'est plus bloquée.</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-center gap-3">
          {status.banned ? (
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              <RotateCcw /> Vérifier à nouveau
            </Button>
          ) : (
            <Button asChild>
              <Link to="/">Revenir à l'accueil</Link>
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
