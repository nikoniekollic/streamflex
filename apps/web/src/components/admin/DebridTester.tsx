import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { debridLinkFor, testDebridLink, type DebridTestResult, type SourceFormValues } from '@/lib/admin'

const size = (n: number | null) => (n ? `${(n / 1024 ** 3).toFixed(2)} Go` : null)

export function DebridTester({ source }: { source: Pick<SourceFormValues, 'provider' | 'external_id' | 'raw_url'> }) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<DebridTestResult | null>(null)
  const link = debridLinkFor(source)
  if (!link) return null

  const run = async () => {
    setPending(true)
    setResult(null)
    setResult(await testDebridLink(supabase, link))
    setPending(false)
  }

  return (
    <div className="grid gap-2 sm:col-span-6">
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => void run()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Zap />} Tester le débridage Alldebrid
      </Button>
      {result?.ok && (
        <Alert>
          <CheckCircle2 className="text-green-500" />
          <AlertTitle>Lien débridé</AlertTitle>
          <AlertDescription className="break-all">
            {[result.filename, size(result.filesize), result.host].filter(Boolean).join(' · ')}
          </AlertDescription>
        </Alert>
      )}
      {result && !result.ok && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Échec du débridage</AlertTitle>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
