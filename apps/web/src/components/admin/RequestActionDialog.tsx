import { useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { Check, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { searchCatalogForLink } from '@/lib/requests'

type Mode = 'added' | 'rejected'
type Props = {
  mode: Mode | null
  count: number
  defaultQuery: string
  onClose: () => void
  onConfirm: (opts: { note: string; titleId: string | null }) => Promise<void>
}

export function RequestActionDialog({ mode, count, defaultQuery, onClose, onConfirm }: Props) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchCatalogForLink>>>([])
  const [titleId, setTitleId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!mode) return
    setNote('')
    setQ(defaultQuery)
    setTitleId(null)
  }, [mode, defaultQuery])

  useEffect(() => {
    if (mode !== 'added') return
    const t = window.setTimeout(() => void searchCatalogForLink(supabase, q).then(setResults), 300)
    return () => window.clearTimeout(t)
  }, [q, mode, supabase])

  const confirm = async () => {
    setPending(true)
    try {
      await onConfirm({ note, titleId })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'added' ? 'Marquer comme ajouté' : 'Refuser la demande'}</DialogTitle>
          <DialogDescription>
            {count} demande{count > 1 ? 's' : ''} · chaque demandeur reçoit une notification.
          </DialogDescription>
        </DialogHeader>

        {mode === 'added' && (
          <div className="grid gap-2">
            <Label htmlFor="ra-search">Lier au titre du catalogue (recommandé)</Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="ra-search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" placeholder="Rechercher un titre…" />
            </div>
            <ul className="grid max-h-48 gap-1 overflow-y-auto">
              {results.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setTitleId(titleId === t.id ? null : t.id)}
                    className={cn('flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent', titleId === t.id && 'border-primary bg-primary/10')}
                  >
                    <span className="truncate">
                      {t.title} {t.release_year && <span className="text-muted-foreground">({t.release_year})</span>}
                      {!t.is_published && <span className="ml-2 text-xs text-amber-400">brouillon</span>}
                    </span>
                    {titleId === t.id && <Check className="size-4 text-primary" />}
                  </button>
                </li>
              ))}
              {q.trim().length >= 2 && results.length === 0 && <li className="text-sm text-muted-foreground">Aucun titre trouvé — la notification pointera vers la recherche.</li>}
            </ul>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="ra-note">{mode === 'rejected' ? 'Motif (envoyé au demandeur)' : 'Note (optionnelle)'}</Label>
          <Textarea id="ra-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button variant={mode === 'rejected' ? 'destructive' : 'default'} onClick={() => void confirm()} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {mode === 'added' ? 'Marquer comme ajouté' : 'Refuser'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
