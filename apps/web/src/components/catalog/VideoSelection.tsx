// Sélection de vidéos pour les supprimer (admin) : pages Catalogue et Modèle.
// La sélection est gardée d'une page à l'autre (voir lib/selection) : on coche page après page, le compteur s'additionne,
// puis « Supprimer » efface tout d'un coup, sur le site ET chez 1fichier (corbeille 30 jours).
import { useEffect, useState } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, ChevronRight, Circle, FolderInput, ListChecks, Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { addSelectionHost, setSelectMode, useHasSelectionHost, useSelectMode, useSelection } from '@/lib/selection'
import { holdDurations } from '@/lib/duration-probe'
import { adminErrorMessage, bulkDelete, moveToModel } from '@/lib/admin'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { displayModelName } from '@/lib/cover'

export type VideoSelection = ReturnType<typeof useVideoSelection>

/** Mode sélection actif (admin) ? Utilisable avant de connaître la liste affichée (défilement infini). */
export function useSelecting(): boolean {
  const { isAdmin, isKids } = useRouteContext({ from: '/_authed' })
  return useSelectMode() && isAdmin && !isKids
}

type Gone = (ids: string[], how: { deleted: boolean; modelId: string | null }) => void

/** État de la sélection pour les vidéos affichées sur cette page. `onGone` : après un déplacement / une suppression. */
export function useVideoSelection(titles: { id: string }[], onGone?: Gone) {
  const { supabase, isAdmin, isKids } = useRouteContext({ from: '/_authed' })
  const router = useRouter()
  const canSelect = isAdmin && !isKids
  const mode = useSelectMode()
  const selecting = canSelect && mode
  // cette page sait afficher la sélection : le bouton dossier des jaquettes y apparaît
  useEffect(() => (canSelect ? addSelectionHost() : undefined), [canSelect])
  // pendant la sélection, la lecture des durées (et l'analyse complète de l'admin) est en pause : connexions laissées aux aperçus
  useEffect(() => (selecting ? holdDurations() : undefined), [selecting])
  const [selected, setSelected] = useSelection()
  const [working, setWorking] = useState(false)
  const allOnPage = titles.length > 0 && titles.every((t) => selected.has(t.id))
  return {
    canSelect,
    selecting,
    selected,
    working,
    allOnPage,
    pageCount: titles.length,
    setMode: setSelectMode,
    clear: () => setSelected(new Set()),
    toggle: (id: string) =>
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    togglePage: () =>
      setSelected((s) => {
        const n = new Set(s)
        for (const t of titles) {
          if (allOnPage) n.delete(t.id)
          else n.add(t.id)
        }
        return n
      }),
    move: async (modelId: string | null, modelName: string) => {
      const ids = [...selected]
      if (!ids.length) return
      const q = modelId
        ? `Déplacer ${ids.length} vidéo(s) vers « ${modelName} » ? Leurs fichiers sont aussi déplacés chez 1fichier, dans le dossier de ce modèle.`
        : `Détacher ${ids.length} vidéo(s) de leur modèle ? (rien ne bouge chez 1fichier)`
      if (!window.confirm(q)) return
      setWorking(true)
      try {
        const r = await moveToModel(supabase, ids, modelId)
        toast.success(
          modelId
            ? `${r.moved} vidéo${r.moved > 1 ? 's' : ''} déplacée${r.moved > 1 ? 's' : ''} vers « ${modelName} » (${r.filesMoved} fichier${r.filesMoved > 1 ? 's' : ''} déplacé${r.filesMoved > 1 ? 's' : ''} chez 1fichier${r.created ? ', dossier créé' : ''})`
            : `${r.moved} vidéo${r.moved > 1 ? 's' : ''} détachée${r.moved > 1 ? 's' : ''}`,
        )
        onGone?.(ids, { deleted: false, modelId })
        setSelected(new Set())
      } catch (e) {
        toast.error(adminErrorMessage(e))
      } finally {
        await router.invalidate()
        setWorking(false)
      }
    },
    remove: async () => {
      const ids = [...selected]
      if (!ids.length) return
      if (!window.confirm(`Supprimer ${ids.length} vidéo(s) du site ET leurs fichiers chez 1fichier ? Les fichiers restent 30 jours dans la corbeille 1fichier ; sur le site, c’est définitif.`)) return
      setWorking(true)
      try {
        await bulkDelete(supabase, ids)
        toast.success(`Supprimé${ids.length > 1 ? 's' : ''} : ${ids.length} vidéo${ids.length > 1 ? 's' : ''}`)
        onGone?.(ids, { deleted: true, modelId: null })
        setSelected(new Set())
      } catch (e) {
        toast.error(adminErrorMessage(e))
      } finally {
        await router.invalidate()
        setWorking(false)
      }
    },
  }
}

/** Bouton « Sélectionner » / « Terminer la sélection » (admin seulement). */
export function SelectModeButton({ sel }: { sel: VideoSelection }) {
  if (!sel.canSelect) return null
  return (
    <Button variant={sel.selecting ? 'secondary' : 'outline'} size="sm" onClick={() => sel.setMode(!sel.selecting)}>
      {sel.selecting ? <X /> : <ListChecks />} {sel.selecting ? 'Terminer la sélection' : 'Sélectionner'}
    </Button>
  )
}

/** Barre de sélection (reste visible en défilant) : tout sélectionner, compteur cumulé, supprimer. */
export function SelectionBar({ sel }: { sel: VideoSelection }) {
  if (!sel.selecting) return null
  const n = sel.selected.size
  return (
    <div className="sticky top-16 z-40 mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-3 backdrop-blur">
      <Button size="sm" variant="outline" disabled={sel.pageCount === 0 || sel.working} onClick={sel.togglePage}>
        {sel.allOnPage ? `Désélectionner les ${sel.pageCount} affichées` : `Tout sélectionner (${sel.pageCount} affichées)`}
      </Button>
      <span className="text-sm text-muted-foreground">
        {n > 0
          ? `${n} vidéo${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''} au total — fais défiler pour en ajouter`
          : 'Clique sur les vidéos pour les sélectionner (durées en pause, aperçus prioritaires)'}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <MoveToModel sel={sel} />
        {n > 0 && (
          <Button size="sm" variant="ghost" disabled={sel.working} onClick={sel.clear}>
            Tout désélectionner
          </Button>
        )}
        <Button size="sm" variant="destructive" disabled={sel.working || n === 0} onClick={() => void sel.remove()}>
          {sel.working ? <Loader2 className="animate-spin" /> : <Trash2 />} Supprimer ({n})
        </Button>
      </div>
    </div>
  )
}

/** Calque posé sur une vignette en mode sélection : un clic coche / décoche au lieu de lancer la vidéo. */
export function SelectOverlay({ sel, id, title }: { sel: VideoSelection; id: string; title: string }) {
  if (!sel.selecting) return null
  const on = sel.selected.has(id)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${on ? 'Désélectionner' : 'Sélectionner'} ${title}`}
      onClick={() => sel.toggle(id)}
      className={cn('absolute inset-0 z-30 rounded-md ring-inset transition', on ? 'bg-primary/25 ring-4 ring-primary' : 'bg-black/10 hover:bg-black/30')}
    >
      <span className="absolute left-2 top-2 rounded-full bg-black/70 p-0.5">
        {on ? <CheckCircle2 className="size-6 text-primary" /> : <Circle className="size-6 text-white" />}
      </span>
    </button>
  )
}

// modèles chargés une fois (nom seulement : lecture directe, rapide), partagés par toutes les barres de sélection
type ModelLite = { id: string; name: string }
let modelsCache: Promise<ModelLite[]> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadModels(supabase: any): Promise<ModelLite[]> {
  modelsCache ??= (async () => {
    const { data, error } = await supabase.from('models').select('id, name').order('name').limit(2000)
    if (error) throw error
    return ((data ?? []) as ModelLite[]).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
  })().catch((e: unknown) => {
    modelsCache = null // nouvel essai à la prochaine ouverture
    throw e
  })
  return modelsCache
}

// modèles utilisés pour les derniers déplacements : remontés en tête de liste (dernier utilisé en premier)
const RECENT_KEY = 'sf:move-recent-models:v1'
const RECENT_MAX = 8
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function pushRecent(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)))
  } catch {
    /* stockage indisponible : ordre alphabétique seulement */
  }
}

/** « Déplacer vers un modèle » : ouvre à droite la liste des modèles (avec recherche) ; un clic sur un modèle lance le
 *  déplacement — vidéos ET fichiers 1fichier vont dans le dossier de ce modèle. */
function MoveToModel({ sel }: { sel: VideoSelection }) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelLite[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const n = sel.selected.size
  useEffect(() => {
    if (!open || models) return
    let off = false
    setFailed(null)
    loadModels(supabase).then(
      (m) => !off && setModels(m),
      (e: unknown) => !off && setFailed((e as Error)?.message ?? 'erreur'),
    )
    return () => {
      off = true
    }
  }, [open, models, supabase])
  const norm = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const match = (m: ModelLite) => !q.trim() || norm(m.name).includes(norm(q.trim())) || norm(displayModelName(m.name)).includes(norm(q.trim()))
  const byId = new Map((models ?? []).map((m) => [m.id, m]))
  const recent = open ? readRecent().map((id) => byId.get(id)).filter((m): m is ModelLite => !!m && match(m)) : []
  const recentIds = new Set(recent.map((m) => m.id))
  const shown = (models ?? []).filter((m) => match(m) && !recentIds.has(m.id))
  const pick = (id: string | null, name: string) => {
    setOpen(false)
    setQ('')
    if (id) pushRecent(id)
    void sel.move(id, name)
  }
  const item = (m: ModelLite) => (
    <button
      key={m.id}
      type="button"
      role="option"
      aria-selected={false}
      onClick={() => pick(m.id, displayModelName(m.name))}
      className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      {displayModelName(m.name)}
    </button>
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" disabled={sel.working || n === 0}>
          {sel.working ? <Loader2 className="animate-spin" /> : <FolderInput />}
          {n === 0 ? 'Déplacer vers un modèle' : `Déplacer ${n} vers un modèle`}
          <ChevronRight className="opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="w-72 p-2">
        <p className="px-1 pb-2 text-xs text-muted-foreground">
          {n} vidéo{n > 1 ? 's' : ''} → choisis le modèle (fichiers déplacés aussi chez 1fichier)
        </p>
        <Input autoFocus placeholder="Rechercher un modèle…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 h-8" />
        <div className="max-h-80 overflow-y-auto" role="listbox" aria-label="Modèles">
          {models === null && !failed && (
            <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Chargement des modèles…
            </p>
          )}
          {failed && (
            <p className="p-2 text-sm text-destructive">
              Modèles indisponibles : {failed}{' '}
              <button type="button" className="underline" onClick={() => setModels(null)}>
                Réessayer
              </button>
            </p>
          )}
          {recent.length > 0 && (
            <>
              <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Récents</p>
              {recent.map(item)}
              <div className="my-1 border-t" />
            </>
          )}
          {models && shown.length === 0 && recent.length === 0 && <p className="p-2 text-sm text-muted-foreground">Aucun modèle ne correspond.</p>}
          {shown.map(item)}
        </div>
        <button
          type="button"
          onClick={() => pick(null, '')}
          className="mt-2 block w-full rounded border-t px-2 pt-2 pb-1 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          Détacher du modèle (rien ne bouge chez 1fichier)
        </button>
      </PopoverContent>
    </Popover>
  )
}

/** Bouton dossier + flèche sur une jaquette (admin, pages avec sélection) : coche cette vidéo et passe en mode sélection. */
export function CardSelectButton({ titleId }: { titleId: string }) {
  const { isAdmin, isKids } = useRouteContext({ from: '/_authed' })
  const host = useHasSelectionHost()
  const [selected, setSelected] = useSelection()
  if (!isAdmin || isKids || !host) return null
  const on = selected.has(titleId)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? 'Retirer de la sélection à déplacer' : 'Sélectionner pour déplacer'}
      title={on ? 'Retirer de la sélection' : 'Sélectionner pour déplacer vers un modèle'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setSelectMode(true)
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(titleId)) n.delete(titleId)
          else n.add(titleId)
          return n
        })
      }}
      className={cn(
        'flex size-8 items-center justify-center rounded-full border-2 text-white backdrop-blur-sm transition-all hover:scale-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none',
        on ? 'border-primary bg-primary' : 'border-neutral-300 bg-black/60 hover:border-white',
      )}
    >
      <FolderInput className="size-4" strokeWidth={2.5} />
    </button>
  )
}
