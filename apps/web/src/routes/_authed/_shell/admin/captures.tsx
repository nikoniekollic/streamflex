import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Camera, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRequiredProfile } from '@/components/profile/ActiveProfileContext'
import { CaptureError, captureTitle, countCaptureTargets, fetchCaptureTargets } from '@/lib/captures'

export const Route = createFileRoute('/_authed/_shell/admin/captures')({
  component: CapturesAdmin,
})

const GAP_MS = 1500 // espacement entre deux films (Alldebrid + Edge Function)
const MAX_CONSECUTIVE_CORS = 3

function CapturesAdmin() {
  const { supabase } = Route.useRouteContext()
  const profile = useRequiredProfile()
  const [remaining, setRemaining] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState(0)
  const [current, setCurrent] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [halt, setHalt] = useState<string | null>(null)
  const stop = useRef(false)

  useEffect(() => {
    void countCaptureTargets(supabase).then(setRemaining)
  }, [supabase])

  const addLog = (line: string) => setLog((l) => [line, ...l].slice(0, 40))

  const run = async () => {
    stop.current = false
    setRunning(true)
    setHalt(null)
    let failures = 0
    let corsStreak = 0
    try {
      while (!stop.current) {
        const batch = await fetchCaptureTargets(supabase, failures)
        if (batch.length === 0) break
        for (const t of batch) {
          if (stop.current) break
          setCurrent(t.title)
          try {
            await captureTitle(supabase, profile.id, t)
            corsStreak = 0
            setDone((n) => n + 1)
            setRemaining((n) => (n === null ? n : Math.max(0, n - 1)))
          } catch (e) {
            failures++
            setFailed((n) => n + 1)
            const kind = e instanceof CaptureError ? e.kind : 'load'
            corsStreak = kind === 'cors' || kind === 'load' ? corsStreak + 1 : 0
            addLog(`${t.title.slice(0, 60)} : ${(e as Error).message}`)
            if (corsStreak >= MAX_CONSECUTIVE_CORS) {
              setHalt(
                "Trois échecs de suite : le serveur vidéo d'Alldebrid n'autorise sans doute pas la lecture d'images depuis le navigateur (CORS). Les jaquettes générées restent en place.",
              )
              stop.current = true
              break
            }
          }
          await new Promise((r) => setTimeout(r, GAP_MS))
        }
      }
    } catch (e) {
      setHalt((e as Error).message)
    } finally {
      setRunning(false)
      setCurrent(null)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Camera className="size-5" /> Captures de jaquettes
        </h2>
        <p className="text-xs text-muted-foreground">
          Pour chaque film sans vraie jaquette, la vidéo est débridée (Alldebrid, depuis ce navigateur), une image est prise à un instant aléatoire, puis enregistrée comme jaquette. Garde cet onglet ouvert pendant le traitement ; tu peux
          l'arrêter et le reprendre à tout moment.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <Button variant="ghost" className="text-destructive" onClick={() => (stop.current = true)}>
              <Square className="size-4" /> Arrêter
            </Button>
          ) : (
            <Button onClick={() => void run()} disabled={remaining === 0}>
              Lancer les captures
            </Button>
          )}
          {running && <Loader2 className="size-4 animate-spin" />}
          <span className="text-sm text-muted-foreground">
            {remaining === null ? '…' : remaining.toLocaleString('fr-FR')} film(s) à traiter · <span className="text-green-500">{done} réussi(s)</span> · {failed} échec(s)
          </span>
        </div>
        {current && <p className="text-xs text-muted-foreground">En cours : {current}</p>}
        {halt && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">{halt}</p>}
      </div>
      {log.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border p-3 text-xs text-muted-foreground">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
