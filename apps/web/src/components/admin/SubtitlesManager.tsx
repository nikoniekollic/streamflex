import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Captions, FileUp, Link2, Loader2, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  COMMON_LANGUAGES,
  addSubtitleLink,
  deleteSubtitle,
  detectFormat,
  languageName,
  listSubtitlesAdmin,
  setDefaultSubtitle,
  uploadSubtitle,
  type SubtitleRow,
  type SubtitleTarget,
} from '@/lib/subtitles'

type EpisodeOption = { id: string; label: string }

export function SubtitlesManager({ titleId, type }: { titleId: string; type: 'movie' | 'series' }) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const [episodes, setEpisodes] = useState<EpisodeOption[] | null>(type === 'series' ? null : [])
  const [episodeId, setEpisodeId] = useState<string | null>(null)

  useEffect(() => {
    if (type !== 'series') return
    void (async () => {
      const [{ data: seasons }, { data: eps }] = await Promise.all([
        supabase.from('seasons').select('id, season_number').eq('title_id', titleId).range(0, 99),
        supabase.from('episodes').select('id, season_id, episode_number, name').eq('title_id', titleId).range(0, 999),
      ])
      const sn = new Map((seasons ?? []).map((s) => [s.id, s.season_number]))
      const list = (eps ?? [])
        .map((e) => ({ ...e, s: sn.get(e.season_id) ?? 0 }))
        .sort((a, b) => a.s - b.s || a.episode_number - b.episode_number)
        .map((e) => ({
          id: e.id,
          label: `S${String(e.s).padStart(2, '0')}E${String(e.episode_number).padStart(2, '0')}${e.name ? ` — ${e.name}` : ''}`,
        }))
      setEpisodes(list)
      setEpisodeId(list[0]?.id ?? null)
    })()
  }, [supabase, titleId, type])

  const target = useMemo<SubtitleTarget | null>(
    () => (type === 'movie' ? { titleId, episodeId: null } : episodeId ? { titleId, episodeId } : null),
    [type, titleId, episodeId],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Captions className="size-5" /> Sous-titres
        </CardTitle>
        <CardDescription>
          Fichiers .vtt ou .srt (2 Mo max), uploadés dans Storage ou liés par URL. Les .srt sont convertis en WebVTT à la lecture.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {type === 'series' && (
          <div className="grid max-w-md gap-2">
            <Label htmlFor="st-episode">Épisode</Label>
            {episodes === null ? (
              <Loader2 className="size-4 animate-spin" />
            ) : episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun épisode pour cette série.</p>
            ) : (
              <NativeSelect id="st-episode" value={episodeId ?? ''} onChange={(e) => setEpisodeId(e.target.value)}>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        )}
        {target && <SubtitleList key={target.episodeId ?? target.titleId} target={target} />}
      </CardContent>
    </Card>
  )
}

function SubtitleList({ target }: { target: SubtitleTarget }) {
  const { supabase, user } = useRouteContext({ from: '/_authed' })
  const [rows, setRows] = useState<SubtitleRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [mode, setMode] = useState<'upload' | 'link'>('upload')
  const [language, setLanguage] = useState('fr')
  const [label, setLabel] = useState(languageName('fr'))
  const [labelTouched, setLabelTouched] = useState(false)
  const [isDefault, setIsDefault] = useState(false)
  const [isForced, setIsForced] = useState(false)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setRows(await listSubtitlesAdmin(supabase, target))
    } catch (e) {
      toast.error((e as Error).message)
      setRows([])
    }
  }, [supabase, target])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const langValid = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)
  const sourceValid = mode === 'upload' ? !!file && !!detectFormat(file.name) : /^https?:\/\/\S+\.(vtt|srt)(\?\S*)?$/i.test(url.trim())
  const canSubmit = langValid && label.trim().length > 0 && sourceValid && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy('add')
    const meta = { language, label: label.trim(), is_default: isDefault, is_forced: isForced }
    try {
      if (mode === 'upload' && file) await uploadSubtitle(supabase, target, meta, file, user.id)
      else await addSubtitleLink(supabase, target, meta, url.trim(), user.id)
      toast.success(`Sous-titres « ${meta.label} » ajoutés`)
      setFile(null)
      setUrl('')
      setIsDefault(false)
      setIsForced(false)
      if (fileRef.current) fileRef.current.value = ''
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Langue</TableHead>
            <TableHead>Libellé</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Options</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows === null && (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center">
                <Loader2 className="mx-auto size-4 animate-spin" />
              </TableCell>
            </TableRow>
          )}
          {rows?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                Aucun sous-titre.
              </TableCell>
            </TableRow>
          )}
          {rows?.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <span className="font-mono text-xs">{r.language}</span> <span className="text-muted-foreground">{languageName(r.language)}</span>
              </TableCell>
              <TableCell>{r.label}</TableCell>
              <TableCell>
                <Badge variant="outline">.{r.format}</Badge>
              </TableCell>
              <TableCell className="max-w-48">
                <a href={r.url} target="_blank" rel="noreferrer noopener" className="block truncate text-xs text-muted-foreground hover:underline">
                  {r.storage_path ? 'Storage' : r.url}
                </a>
              </TableCell>
              <TableCell className="space-x-1">
                {r.is_default && <Badge>Par défaut</Badge>}
                {r.is_forced && <Badge variant="secondary">Forcés</Badge>}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={r.is_default ? 'Retirer par défaut' : 'Définir par défaut'}
                  disabled={!!busy}
                  onClick={() => void act(`d${r.id}`, () => setDefaultSubtitle(supabase, target, r.id, !r.is_default))}
                >
                  <Star className={r.is_default ? 'fill-primary text-primary' : undefined} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Supprimer"
                  disabled={!!busy}
                  onClick={() => void act(`x${r.id}`, () => deleteSubtitle(supabase, r))}
                >
                  {busy === `x${r.id}` ? <Loader2 className="animate-spin" /> : <Trash2 className="text-destructive" />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <form onSubmit={submit} className="grid gap-4 rounded-lg border p-4" noValidate>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={mode === 'upload' ? 'default' : 'outline'} onClick={() => setMode('upload')}>
            <FileUp /> Upload
          </Button>
          <Button type="button" size="sm" variant={mode === 'link' ? 'default' : 'outline'} onClick={() => setMode('link')}>
            <Link2 /> Lien URL
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="st-lang">Langue (BCP 47)</Label>
            <Input
              id="st-lang"
              list="st-lang-list"
              value={language}
              aria-invalid={!langValid}
              onChange={(e) => {
                const v = e.target.value.trim()
                setLanguage(v)
                if (!labelTouched) setLabel(languageName(v))
              }}
            />
            <datalist id="st-lang-list">
              {COMMON_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </datalist>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="st-label">Libellé affiché</Label>
            <Input
              id="st-label"
              value={label}
              maxLength={60}
              onChange={(e) => {
                setLabelTouched(true)
                setLabel(e.target.value)
              }}
              placeholder="Français, English (SDH)…"
            />
          </div>
        </div>

        {mode === 'upload' ? (
          <div className="grid gap-2">
            <Label htmlFor="st-file">Fichier</Label>
            <Input
              ref={fileRef}
              id="st-file"
              type="file"
              accept=".vtt,.srt,text/vtt,application/x-subrip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="st-url">URL du fichier</Label>
            <Input id="st-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/film.fr.vtt" />
          </div>
        )}

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} /> Activés par défaut
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isForced} onCheckedChange={setIsForced} /> Forcés (passages en langue étrangère)
          </label>
        </div>

        <Button type="submit" disabled={!canSubmit} className="justify-self-start">
          {busy === 'add' && <Loader2 className="animate-spin" />} Ajouter les sous-titres
        </Button>
      </form>
    </div>
  )
}
