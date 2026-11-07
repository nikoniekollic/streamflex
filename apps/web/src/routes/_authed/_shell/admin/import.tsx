import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, ChevronRight, CircleSlash, FileVideo, Folder, FolderDown, Loader2, Square, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { importFiles, listFolder, type ImportResult, type Listing, type RemoteFile, type RemoteFolder } from '@/lib/onefichier-import'

export const Route = createFileRoute('/_authed/_shell/admin/import')({
  component: ImportAdmin,
})

type Crumb = { id: number; name: string }
type Tab = 'success' | 'ignored' | 'failed'
const CHUNK = 50
const fmtSize = (n: number | null) => (n ? (n >= 1e9 ? `${(n / 1e9).toFixed(2)} Go` : `${(n / 1e6).toFixed(0)} Mo`) : '')

function ImportAdmin() {
  const { supabase } = Route.useRouteContext()
  const [path, setPath] = useState<Crumb[]>([{ id: 0, name: 'Racine' }])
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedFolders, setPickedFolders] = useState<ReadonlyMap<number, string>>(new Map())
  const [pickedFiles, setPickedFiles] = useState<ReadonlySet<string>>(new Set())
  const [publish, setPublish] = useState(false)
  const [asModels, setAsModels] = useState(true)

  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [logs, setLogs] = useState<Record<Tab, ImportResult[]>>({ success: [], ignored: [], failed: [] })
  const [tab, setTab] = useState<Tab>('success')
  const stop = useRef(false)

  const open = async (crumbs: Crumb[]) => {
    setLoading(true)
    setError(null)
    try {
      const l = await listFolder(supabase, crumbs[crumbs.length - 1].id)
      setListing(l)
      setPath(crumbs)
      setPickedFiles(new Set())
      setPickedFolders(new Map())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const record = (rs: ImportResult[]) =>
    setLogs((p) => ({
      success: [...p.success, ...rs.filter((r) => r.status === 'success')],
      ignored: [...p.ignored, ...rs.filter((r) => r.status === 'ignored')],
      failed: [...p.failed, ...rs.filter((r) => r.status === 'failed')],
    }))

  /** model = nom du dossier contenant (null pour la racine ou si l'option est décochée) */
  const pushFiles = async (files: Pick<RemoteFile, 'id' | 'name' | 'size' | 'ctype'>[], where: string, model: string | null) => {
    for (let i = 0; i < files.length && !stop.current; i += CHUNK) {
      setStatus(`${where} — fichiers ${i + 1}–${Math.min(i + CHUNK, files.length)} / ${files.length}`)
      const chunk = files.slice(i, i + CHUNK)
      try {
        record(await importFiles(supabase, chunk, publish, asModels ? model : null))
      } catch (e) {
        record(chunk.map((f) => ({ id: f.id, name: f.name, status: 'failed' as const, reason: (e as Error).message })))
      }
    }
  }

  /** Parcours récursif : 1 appel 1fichier (régulé) par dossier. Un blocage/pause 1fichier arrête tout. */
  const walk = async (folder: Crumb, trail: string): Promise<void> => {
    if (stop.current) return
    setStatus(`Lecture du dossier ${trail}…`)
    const l = await listFolder(supabase, folder.id)
    await pushFiles(l.files, trail, folder.id === 0 ? null : folder.name)
    for (const sub of l.folders) {
      if (stop.current) return
      await walk({ id: sub.id, name: sub.name }, `${trail}/${sub.name}`)
    }
  }

  const run = async (job: () => Promise<void>) => {
    stop.current = false
    setRunning(true)
    setLogs({ success: [], ignored: [], failed: [] })
    try {
      await job()
      toast.success(stop.current ? 'Import arrêté' : 'Import terminé')
    } catch (e) {
      toast.error((e as Error).message)
      setStatus(`Arrêté : ${(e as Error).message}`)
    } finally {
      setRunning(false)
      if (!stop.current) setStatus('Terminé')
    }
  }

  const importSelection = () =>
    run(async () => {
      const files = (listing?.files ?? []).filter((f) => pickedFiles.has(f.id))
      const here = path[path.length - 1]
      await pushFiles(files, path.map((c) => c.name).join('/'), here.id === 0 ? null : here.name)
      for (const [id, name] of pickedFolders) {
        if (stop.current) break
        await walk({ id, name }, name)
      }
    })

  const importCurrentFolder = () => run(() => walk(path[path.length - 1], path.map((c) => c.name).join('/')))

  const toggleFile = (id: string) => setPickedFiles((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleFolder = (f: RemoteFolder) =>
    setPickedFolders((p) => { const n = new Map(p); n.has(f.id) ? n.delete(f.id) : n.set(f.id, f.name); return n })

  const total = logs.success.length + logs.ignored.length + logs.failed.length
  const selCount = pickedFiles.size + pickedFolders.size

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <FolderDown className="size-5" /> Explorateur du compte 1fichier
        </h2>
        <p className="text-xs text-muted-foreground">
          Chaque dossier ouvert = 1 appel à l’API 1fichier, espacé automatiquement (≥ 4 s, 240 / h max) pour ne pas bloquer ton compte pendant que ton script tourne. L’import lui-même n’appelle pas 1fichier.
        </p>
        {!listing && (
          <Button className="self-start" onClick={() => open(path)} disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />} Charger mon compte
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {listing && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Chemin">
            {path.map((c, i) => (
              <span key={`${c.id}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
                <button type="button" disabled={loading || running || i === path.length - 1} onClick={() => open(path.slice(0, i + 1))} className="rounded px-1.5 py-0.5 hover:bg-accent disabled:font-semibold disabled:hover:bg-transparent">
                  {c.name}
                </button>
              </span>
            ))}
            {loading && <Loader2 className="ml-2 size-4 animate-spin" />}
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={importSelection} disabled={running || loading || selCount === 0}>
              Importer la sélection ({selCount})
            </Button>
            <Button variant="secondary" onClick={importCurrentFolder} disabled={running || loading}>
              Importer ce dossier et ses sous-dossiers
            </Button>
            <label className="ml-2 flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} disabled={running} /> Publier directement
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={asModels} onChange={(e) => setAsModels(e.target.checked)} disabled={running} /> Un modèle par dossier
            </label>
          </div>

          {listing.debug && (
            <p className="text-xs text-muted-foreground">
              {listing.folders.length} dossier(s), {listing.files.length} fichier(s) reconnu(s) sur {listing.debug.items} reçu(s) de 1fichier.
              {listing.debug.items > 0 && listing.debug.withId === 0 && ` Format de lien inattendu : ${listing.debug.sampleUrl}`}
              {listing.debug.items === 0 && ` Champs reçus : ${listing.debug.keys.join(', ')}`}
            </p>
          )}
          <ul className="max-h-[28rem] divide-y overflow-y-auto rounded-md border">
            {listing.folders.map((f) => (
              <li key={`d${f.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
                <input type="checkbox" aria-label={`Sélectionner le dossier ${f.name}`} checked={pickedFolders.has(f.id)} onChange={() => toggleFolder(f)} disabled={running} />
                <Folder className="size-4 text-amber-400" />
                <button type="button" className="min-w-0 flex-1 truncate text-left" disabled={loading || running} onClick={() => open([...path, { id: f.id, name: f.name }])}>
                  {f.name}
                </button>
              </li>
            ))}
            {listing.files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
                <input type="checkbox" aria-label={`Sélectionner ${f.name}`} checked={pickedFiles.has(f.id)} onChange={() => toggleFile(f.id)} disabled={running} />
                <FileVideo className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{fmtSize(f.size)}</span>
                {!f.video && <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">non vidéo</span>}
                {f.known && <span className="rounded bg-primary/20 px-1.5 text-xs text-primary">déjà importé</span>}
              </li>
            ))}
            {listing.folders.length === 0 && listing.files.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Dossier vide.</li>}
          </ul>
        </section>
      )}

      {(running || total > 0) && (
        <section className="flex flex-col gap-3 rounded-lg border p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['success', 'Réussis', CheckCircle2, 'text-green-400'],
                ['ignored', 'Ignorés', CircleSlash, 'text-amber-400'],
                ['failed', 'Échecs', XCircle, 'text-destructive'],
              ] as const
            ).map(([key, label, Icon, color]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', tab === key && 'border-primary bg-accent')}>
                <Icon className={cn('size-4', color)} /> {label}
                <span className="font-semibold tabular-nums">{logs[key].length}</span>
              </button>
            ))}
            {running && (
              <Button variant="ghost" className="ml-auto text-destructive" onClick={() => { stop.current = true; setStatus('Arrêt en cours…') }}>
                <Square className="size-4" /> Arrêter
              </Button>
            )}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {running && <Loader2 className="size-3.5 animate-spin" />} {status}
          </p>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
            {logs[tab].length === 0 && <li className="p-4 text-center text-muted-foreground">Rien dans cette catégorie.</li>}
            {logs[tab].slice(-300).reverse().map((r, i) => (
              <li key={`${r.id}-${i}`} className="flex gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.reason && <span className="max-w-[50%] truncate text-xs text-muted-foreground" title={r.reason}>{r.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
