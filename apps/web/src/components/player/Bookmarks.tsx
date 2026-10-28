import { useEffect, useState, type FormEvent } from 'react'
import { BookmarkPlus, Globe, Loader2, Lock, Play, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { bookmarkSchema, formatTimestamp, type NewBookmark, type VideoBookmark } from '@/lib/bookmarks'
import { cn } from '@/lib/utils'

// ───────── Modale « Marquer ce moment »
export function BookmarkDialog({
  at,
  container,
  onSubmit,
  onClose,
}: {
  /** seconde capturée ; null = fermée */
  at: number | null
  container: HTMLElement | null
  onSubmit: (b: NewBookmark) => Promise<void>
  onClose: () => void
}) {
  const [label, setLabel] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (at !== null) {
      setLabel('')
      setError(null)
    }
  }, [at])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (at === null) return
    const parsed = bookmarkSchema.safeParse({ label, is_public: isPublic })
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setSaving(true)
    try {
      await onSubmit({ timestamp_seconds: Math.floor(at), ...parsed.data })
      onClose()
    } catch (err) {
      setError((err as Error).message || 'Enregistrement impossible.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={at !== null} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent container={container} className="border-white/10 bg-neutral-900 text-white sm:max-w-md" onPointerDown={(e) => e.stopPropagation()}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookmarkPlus className="size-5 text-primary" /> Marquer ce moment
            </DialogTitle>
            <DialogDescription>
              À <span className="font-semibold text-white tabular-nums">{formatTimestamp(at ?? 0)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="bm-label">Ton texte</Label>
            <Input
              id="bm-label"
              autoFocus
              value={label}
              maxLength={120}
              placeholder="Ex. : la scène du toit"
              onChange={(e) => (setLabel(e.target.value), setError(null))}
              disabled={saving}
              aria-invalid={!!error}
              className="border-white/15 bg-black/40"
            />
            <div className="flex justify-between text-xs text-neutral-400">
              <span className="text-destructive">{error}</span>
              <span>{label.trim().length}/120</span>
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-3 text-sm">
            <span className="flex items-center gap-2">
              {isPublic ? <Globe className="size-4" /> : <Lock className="size-4" />}
              {isPublic ? 'Partagé avec la communauté' : 'Visible par moi seul'}
            </span>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} disabled={saving} aria-label="Marque-page public" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving || !label.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ───────── Panneau latéral
export function BookmarkPanel({
  open,
  bookmarks,
  current,
  onJump,
  onDelete,
  onClose,
}: {
  open: boolean
  bookmarks: VideoBookmark[]
  current: number
  onJump: (seconds: number) => void
  onDelete?: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [deleting, setDeleting] = useState<string | null>(null)
  const list = filter === 'mine' ? bookmarks.filter((b) => b.is_mine) : bookmarks
  // marque-page « en cours » : le dernier dépassé
  const activeId = [...list].reverse().find((b) => b.timestamp_seconds <= current + 0.5)?.id

  return (
    <aside
      aria-label="Marque-pages"
      aria-hidden={!open}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'absolute top-20 right-0 bottom-32 z-20 flex w-full max-w-sm flex-col overflow-hidden border border-white/10 bg-neutral-950/95 backdrop-blur transition-all duration-300 sm:right-4 sm:rounded-lg',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0',
      )}
    >
      <header className="flex items-center gap-2 border-b border-white/10 p-4">
        <h2 className="flex-1 text-lg font-semibold">Marque-pages</h2>
        <div className="flex rounded-md bg-white/5 p-0.5 text-xs">
          {(['all', 'mine'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn('rounded px-2 py-1', filter === f ? 'bg-white/15 text-white' : 'text-neutral-400 hover:text-white')}
            >
              {f === 'all' ? 'Tous' : 'Les miens'}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer les marque-pages" className="rounded-full p-1.5 hover:bg-white/10" tabIndex={open ? 0 : -1}>
          <X className="size-5" />
        </button>
      </header>

      {list.length === 0 ? (
        <p className="p-6 text-center text-sm text-neutral-400">
          Aucun marque-page. Appuie sur <kbd className="rounded bg-white/10 px-1.5">B</kbd> pour marquer un moment.
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ol className="flex flex-col p-2">
            {list.map((b) => (
              <li key={b.id} className="group relative">
                <button
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => onJump(b.timestamp_seconds)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md p-2.5 pr-10 text-left transition-colors hover:bg-white/10',
                    b.id === activeId && 'bg-primary/15',
                  )}
                >
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                    <Play className="size-3 fill-current" />
                    {formatTimestamp(b.timestamp_seconds)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm break-words">{b.label}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                      <ProfileAvatar name={b.author_name} avatarUrl={b.author_avatar} className="size-4 rounded-sm" textClassName="text-[9px]" />
                      {b.is_mine ? 'Toi' : b.author_name}
                      {!b.is_public && <Lock className="size-3" aria-label="Privé" />}
                    </span>
                  </span>
                </button>
                {b.is_mine && onDelete && (
                  <button
                    type="button"
                    tabIndex={open ? 0 : -1}
                    aria-label={`Supprimer « ${b.label} »`}
                    disabled={deleting === b.id}
                    onClick={async () => {
                      setDeleting(b.id)
                      try {
                        await onDelete(b.id)
                      } finally {
                        setDeleting(null)
                      }
                    }}
                    className="absolute top-2.5 right-2 rounded p-1.5 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-destructive focus-visible:opacity-100"
                  >
                    {deleting === b.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </aside>
  )
}
