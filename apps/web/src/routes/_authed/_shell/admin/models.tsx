import { useRef, useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ImagePlus, Link2, Loader2, Plus, Search, Trash2, Upload, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CoverSymbol } from '@/components/catalog/GeneratedCover'
import { CoverThumb } from '@/components/catalog/CoverThumb'
import {
  attachByQuery,
  attachTitles,
  createModel,
  deleteEmptyModels,
  deleteModel,
  mergeModels,
  recaptureModels,
  listModels,
  modelSchema,
  searchTitlesForModel,
  updateModel,
  uploadModelImage,
  type AdminModel,
  type ModelTitle,
} from '@/lib/models'

export const Route = createFileRoute('/_authed/_shell/admin/models')({
  loader: ({ context }) => listModels(context.supabase),
  staleTime: 0,
  component: ModelsAdmin,
})

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Erreur inconnue')

function ModelsAdmin() {
  const models = Route.useLoaderData()
  const { supabase } = Route.useRouteContext()
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(models[0]?.id ?? null)
  const selected = models.find((m) => m.id === selectedId) ?? null
  const refresh = () => router.invalidate()

  // ───── recapture des images (sélection ou tous les modèles)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [capturing, setCapturing] = useState(false)
  const toggleChecked = (id: string) =>
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const recapture = async (ids: string[] | null) => {
    setCapturing(true)
    try {
      const n = await recaptureModels(supabase, ids)
      toast.success(`${n} modèle${n > 1 ? 's' : ''} recapturé${n > 1 ? 's' : ''} (nouvelle vidéo et nouveau moment au hasard)`)
      setChecked(new Set())
      await refresh()
    } catch (err) {
      toast.error(msg(err))
    } finally {
      setCapturing(false)
    }
  }

  // ───── création
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = modelSchema.safeParse({ name, image_url: url })
    if (!parsed.success) return toast.error(parsed.error.issues[0].message)
    setBusy(true)
    try {
      const img = file ? await uploadModelImage(supabase, file) : parsed.data.image_url || null
      const id = await createModel(supabase, parsed.data.name, img)
      toast.success('Modèle créé')
      setName('')
      setUrl('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setSelectedId(id)
      await refresh()
    } catch (err) {
      toast.error(msg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <form onSubmit={create} className="flex flex-col gap-3 rounded-lg border p-4" noValidate>
          <h2 className="flex items-center gap-2 font-semibold">
            <Plus className="size-4" /> Nouveau modèle
          </h2>
          <div className="grid gap-1.5">
            <Label htmlFor="m-name">Nom</Label>
            <Input id="m-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="Modèle A" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-url" className="flex items-center gap-1.5">
              <Link2 className="size-3.5" /> Image par URL (https)
            </Label>
            <Input id="m-url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy || !!file} placeholder="https://…/profil.jpg" inputMode="url" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-file" className="flex items-center gap-1.5">
              <Upload className="size-3.5" /> …ou envoi depuis le PC (JPG/PNG/WebP, 5 Mo)
            </Label>
            <Input id="m-file" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />} Créer
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <p className="w-full text-xs text-muted-foreground">Image de chaque modèle = image capturée d’une de ses vidéos. « Recapturer » tire une autre vidéo et un autre moment au hasard.</p>
          <Button size="sm" variant="outline" onClick={() => setChecked(checked.size === models.length ? new Set() : new Set(models.map((m) => m.id)))}>
            {checked.size === models.length && models.length > 0 ? 'Tout désélectionner' : 'Tout sélectionner'}
          </Button>
          <Button size="sm" disabled={capturing || checked.size === 0} onClick={() => void recapture([...checked])}>
            {capturing ? <Loader2 className="size-4 animate-spin" /> : null} Recapturer la sélection ({checked.size})
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={capturing || models.length === 0}
            onClick={() => window.confirm(`Recapturer l’image des ${models.length} modèles ?`) && void recapture(null)}
          >
            Recapturer tous
          </Button>
        </div>

        <ul className="flex flex-col gap-1">
          {models.length === 0 && <li className="text-sm text-muted-foreground">Aucun modèle pour l’instant.</li>}
          {models.map((m, i) => (
            <li key={m.id} className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Sélectionner ${m.name}`} checked={checked.has(m.id)} onChange={() => toggleChecked(m.id)} className="shrink-0" />
              <button
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-md border p-2 text-left transition-colors hover:bg-accent', m.id === selectedId && 'border-primary bg-accent')}
              >
                {m.cover_title_id ? <CoverThumb titleId={m.cover_title_id} coverPos={m.cover_pos} order={i} className="size-10 shrink-0 rounded-md" fallback={<Avatar url={m.image_url} />} /> : <Avatar url={m.image_url} />}
                <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{m.titles_count}</span>
              </button>
            </li>
          ))}
        </ul>
        {models.some((m) => m.titles_count === 0) && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const n = await deleteEmptyModels(supabase)
                toast.success(`${n} modèle${n > 1 ? 's' : ''} vide${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`)
                setSelectedId(null)
                await refresh()
              } catch (err) {
                toast.error(msg(err))
              } finally {
                setBusy(false)
              }
            }}
          >
            <Trash2 className="size-4" /> Supprimer les modèles vides ({models.filter((m) => m.titles_count === 0).length})
          </Button>
        )}
      </div>

      {selected ? (
        <ModelDetail key={selected.id} model={selected} others={models.filter((m) => m.id !== selected.id)} onMerged={(id) => (setSelectedId(id), refresh())} onChanged={refresh} onDeleted={() => (setSelectedId(null), refresh())} />
      ) : (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">Crée ou sélectionne un modèle.</p>
      )}
    </div>
  )
}

function Avatar({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
  ) : (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
      <UserRound className="size-5 text-muted-foreground" />
    </span>
  )
}

function ModelDetail({ model, others, onMerged, onChanged, onDeleted }: { model: AdminModel; others: AdminModel[]; onMerged: (intoId: string) => unknown; onChanged: () => unknown; onDeleted: () => void }) {
  const { supabase } = Route.useRouteContext()
  const [name, setName] = useState(model.name)
  const [url, setUrl] = useState(model.image_url ?? '')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ModelTitle[]>([])
  const [searched, setSearched] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [override, setOverride] = useState(false)
  const [mergeInto, setMergeInto] = useState('')

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      await onChanged()
    } catch (err) {
      toast.error(msg(err))
    } finally {
      setBusy(false)
    }
  }

  const saveInfo = () => {
    const parsed = modelSchema.safeParse({ name, image_url: url })
    if (!parsed.success) return toast.error(parsed.error.issues[0].message)
    return run(() => updateModel(supabase, model.id, { name: parsed.data.name, image_url: parsed.data.image_url || null }), 'Modèle mis à jour (jaquettes rattachées mises à jour)')
  }

  const replaceFile = (f: File | undefined) => {
    if (!f) return
    void run(async () => {
      const img = await uploadModelImage(supabase, f)
      setUrl(img)
      await updateModel(supabase, model.id, { image_url: img })
    }, 'Image remplacée sur toutes les jaquettes rattachées')
  }

  const search = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      setResults(await searchTitlesForModel(supabase, q))
      setPicked(new Set())
      setSearched(true)
    } catch (err) {
      toast.error(msg(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const afterAttach = async (fn: () => Promise<number>, label: string) => {
    setBusy(true)
    try {
      const n = await fn()
      toast.success(`${n} jaquette${n > 1 ? 's' : ''} ${label}`)
      await onChanged()
      setResults(await searchTitlesForModel(supabase, q))
      setPicked(new Set())
    } catch (err) {
      toast.error(msg(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    if (!confirm(`Supprimer « ${model.name} » ? Les ${model.titles_count} jaquettes rattachées perdent l’image du modèle.`)) return
    void run(async () => {
      await deleteModel(supabase, model.id)
      onDeleted()
    }, 'Modèle supprimé')
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-start gap-4">
          {model.image_url ? <img src={model.image_url} alt="" className="h-32 w-24 shrink-0 rounded-md object-cover" /> : <div className="flex h-32 w-24 shrink-0 items-center justify-center rounded-md bg-muted"><ImagePlus className="size-6 text-muted-foreground" /></div>}
          <div className="grid flex-1 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="d-name">Nom</Label>
              <Input id="d-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-url">URL de l’image</Label>
              <Input id="d-url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} placeholder="https://…" inputMode="url" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveInfo} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Enregistrer
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <Upload className="size-4" /> Remplacer par un fichier
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(e) => replaceFile(e.target.files?.[0])} />
              </label>
              <Button variant="ghost" className="ml-auto text-destructive" onClick={remove} disabled={busy}>
                <Trash2 className="size-4" /> Supprimer
              </Button>
            </div>
          </div>
        </div>
        {others.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2 text-sm">
            <span className="text-muted-foreground">Ce n’est pas un vrai modèle (ex. « video ») ? Fusionner dans :</span>
            <select
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
              disabled={busy}
              aria-label="Modèle de destination"
              className="h-9 min-w-40 rounded-md border bg-background px-2"
            >
              <option value="">Choisir un modèle…</option>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.titles_count})
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !mergeInto}
              onClick={async () => {
                if (!window.confirm(`Déplacer les ${model.titles_count} jaquette(s) de « ${model.name} » puis supprimer « ${model.name} » ?`)) return
                setBusy(true)
                try {
                  const n = await mergeModels(supabase, model.id, mergeInto)
                  toast.success(`${n} jaquette(s) déplacée(s), « ${model.name} » supprimé`)
                  await onMerged(mergeInto)
                } catch (err) {
                  toast.error(msg(err))
                  setBusy(false)
                }
              }}
            >
              Fusionner
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{model.titles_count} jaquette(s) rattachée(s). Chacune garde son propre symbole coloré et son nom de fichier par-dessus l’image du modèle.</p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="font-semibold">Rattacher des jaquettes</h3>
        <form onSubmit={search} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Partie du nom de fichier (2 caractères min.)" aria-label="Rechercher des titres" />
          <Button type="submit" variant="secondary" disabled={busy || q.trim().length < 2}>
            <Search className="size-4" /> Chercher
          </Button>
        </form>

        {searched && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{results.length >= 200 ? '200+ résultats (liste limitée)' : `${results.length} résultat(s)`}</span>
              <Button size="sm" disabled={busy || picked.size === 0} onClick={() => afterAttach(() => attachTitles(supabase, model.id, [...picked]), 'rattachée(s)')}>
                Rattacher la sélection ({picked.size})
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || picked.size === 0} onClick={() => afterAttach(() => attachTitles(supabase, null, [...picked]), 'détachée(s)')}>
                Détacher la sélection
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || results.length === 0}
                onClick={() => confirm(`Rattacher TOUS les titres contenant « ${q.trim()} » (jusqu’à 2000) à « ${model.name} » ?`) && void afterAttach(() => attachByQuery(supabase, model.id, q, override), 'rattachée(s)')}
              >
                Rattacher tous les résultats
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> écraser les titres déjà rattachés à un autre modèle
              </label>
            </div>
            <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
              {results.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
                    <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                    <CoverSymbol seed={t.id} className="size-6" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.model_id === model.id ? <span className="text-xs text-primary">rattaché</span> : t.model_id ? <span className="text-xs text-amber-400">autre modèle</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
