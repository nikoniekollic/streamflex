import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { Dices, Image as ImageIcon, Loader2, Save, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRequiredProfile } from '@/components/profile/ActiveProfileContext'
import { getPreviewUrl } from '@/lib/preview'
import { searchTitlesForModel } from '@/lib/models'
import { formatMinutes } from '@/lib/model-names'

export const Route = createFileRoute('/_authed/_shell/admin/captures')({
  component: CoversAdmin,
})

// Le serveur vidéo (Alldebrid) n'envoie pas d'en-têtes CORS : le navigateur n'a pas le droit de lire les pixels d'une
// vidéo venue de là, donc aucune image ne peut être enregistrée en fichier. La jaquette est donc l'image que le
// navigateur affiche à un moment PRÉCIS de la vidéo : on enregistre ce moment (cover_pos), pas un fichier.
const raw = (s: unknown) => s as SupabaseClient
const pct = (v: number) => `${Math.round(v * 100)} %`

function CoversAdmin() {
  const { supabase } = Route.useRouteContext()
  const [stats, setStats] = useState<{ with: number; without: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadStats = async () => {
    const db = raw(supabase)
    const [w, wo] = await Promise.all([
      db.from('titles').select('id', { count: 'exact', head: true }).eq('type', 'movie').not('cover_pos', 'is', null),
      db.from('titles').select('id', { count: 'exact', head: true }).eq('type', 'movie').is('cover_pos', null),
    ])
    setStats({ with: w.count ?? 0, without: wo.count ?? 0 })
  }
  useEffect(() => void loadStats(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const randomize = async () => {
    setBusy(true)
    try {
      let total = 0
      for (let i = 0; i < 30; i++) {
        // par paquets de 2 000 : l'API coupe les requêtes trop longues
        const { data, error } = await raw(supabase).rpc('admin_randomize_cover_pos', { p_limit: 2000 })
        if (error) throw error
        if (!data) break
        total += data as number
      }
      toast.success(`${total.toLocaleString('fr-FR')} film(s) : moment de la jaquette défini`)
      await loadStats()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <ImageIcon className="size-5" /> Jaquettes (image de la vidéo)
        </h2>
        <p className="text-xs text-muted-foreground">
          Chaque jaquette montre l’image de la vidéo à un moment précis, <strong>toujours le même</strong> (avant : un moment différent à chaque visite). Le moment est enregistré en pourcentage de la durée ; l’image est affichée par le
          navigateur, sans fichier à stocker ni envoi.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {stats ? (
              <>
                <span className="text-green-500">{stats.with.toLocaleString('fr-FR')}</span> film(s) avec un moment défini · {stats.without.toLocaleString('fr-FR')} sans
              </>
            ) : (
              '…'
            )}
          </span>
          <Button size="sm" disabled={busy || stats?.without === 0} onClick={() => void randomize()}>
            {busy ? <Loader2 className="animate-spin" /> : <Dices />} Fixer un moment aux films sans
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Les nouveaux films importés reçoivent un moment automatiquement. Recharge le site (Ctrl+Maj+R) après un changement en masse pour voir les nouvelles images.</p>
      </div>

      <Picker />
    </section>
  )
}

// ───────── Choisir l'image d'un film : lecteur + curseur
type Found = { id: string; title: string }

function Picker() {
  const { supabase } = Route.useRouteContext()
  const profile = useRequiredProfile()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Found[]>([])
  const [searching, setSearching] = useState(false)
  const [sel, setSel] = useState<Found | null>(null)

  const search = async (e: FormEvent) => {
    e.preventDefault()
    setSearching(true)
    try {
      setResults(await searchTitlesForModel(supabase, q))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Choisir l’image d’un film</h3>
        <form onSubmit={search} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Partie du titre (2 caractères min.)" aria-label="Rechercher un film" />
          <Button type="submit" variant="secondary" disabled={searching || q.trim().length < 2}>
            {searching ? <Loader2 className="animate-spin" /> : <Search />}
          </Button>
        </form>
        <ul className="max-h-96 overflow-y-auto rounded-md border">
          {results.length === 0 && <li className="p-3 text-sm text-muted-foreground">Cherche un film pour régler son image.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSel(r)} className={`w-full truncate px-3 py-2 text-left text-sm hover:bg-accent ${sel?.id === r.id ? 'bg-accent' : ''}`}>
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {sel ? <Frame key={sel.id} title={sel} profileId={profile.id} /> : <p className="self-center rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Sélectionne un film.</p>}
    </div>
  )
}

function Frame({ title, profileId }: { title: Found; profileId: string }) {
  const { supabase } = Route.useRouteContext()
  const video = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState(0)
  const [pos, setPos] = useState(0.3)
  const [saved, setSaved] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // moment actuellement enregistré + lien de la vidéo
  useEffect(() => {
    let alive = true
    void raw(supabase)
      .from('titles')
      .select('cover_pos')
      .eq('id', title.id)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data as { cover_pos: number | null } | null)?.cover_pos ?? null
        if (alive) {
          setSaved(p)
          if (p != null) setPos(p)
        }
      })
    void getPreviewUrl(supabase, profileId, title.id, { cancelled: false }).then((u) => (alive ? (u ? setUrl(u) : setFailed(true)) : undefined))
    return () => {
      alive = false
    }
  }, [supabase, profileId, title.id])

  // le curseur déplace la vidéo (l'image affichée est celle de la jaquette)
  useEffect(() => {
    const v = video.current
    if (v && duration > 0) v.currentTime = Math.min(duration * pos, Math.max(0, duration - 0.5))
  }, [pos, duration])

  const minutes = useMemo(() => (duration ? formatMinutes(Math.max(1, Math.round((duration * pos) / 60))) : null), [duration, pos])

  const save = async () => {
    setSaving(true)
    try {
      const value = Math.min(0.95, Math.max(0, Math.round(pos * 1000) / 1000))
      const { error } = await raw(supabase).from('titles').update({ cover_pos: value }).eq('id', title.id)
      if (error) throw error
      setSaved(value)
      toast.success('Image enregistrée — recharge le site pour la voir sur la jaquette')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="truncate font-medium">{title.title}</p>
      <div className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-md bg-black">
        {url ? (
          <video ref={video} src={url} muted playsInline preload="auto" onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onError={() => setFailed(true)} className="size-full object-contain" />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted-foreground">{failed ? 'Vidéo indisponible' : <Loader2 className="animate-spin" />}</div>
        )}
      </div>
      <div className="flex max-w-2xl flex-col gap-2">
        <input type="range" min={0} max={0.95} step={0.005} value={pos} onChange={(e) => setPos(Number(e.target.value))} disabled={!duration} aria-label="Moment de la vidéo" className="w-full accent-[var(--primary)]" />
        <p className="text-xs text-muted-foreground">
          Moment : {pct(pos)}
          {minutes ? ` (≈ ${minutes})` : ''} · {saved == null ? 'aucun moment enregistré' : `enregistré : ${pct(saved)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPos(0.12 + Math.random() * 0.55)} disabled={!duration}>
            <Dices /> Au hasard
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !duration}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer ce moment
          </Button>
        </div>
      </div>
    </div>
  )
}
