import { useEffect, useState, type ReactNode } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouteContext } from '@tanstack/react-router'
import { AlertCircle, Check, ImageOff, Info, Loader2, Plus, Trash2 } from 'lucide-react'
import { cn, slugify } from '@/lib/utils'
import {
  MATURITY,
  PROVIDERS,
  QUALITIES,
  adminErrorMessage,
  createGenre,
  emptySource,
  saveTitle,
  titleFormSchema,
  type TitleFormValues,
} from '@/lib/admin'
import type { Tables } from '@/types/database'
import { DebridTester } from '@/components/admin/DebridTester'
import { FILE_ID_RE, buildHosterPageUrl, extractFileId, isHoster } from '@/lib/stream-url'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

type Genre = Pick<Tables<'genres'>, 'id' | 'slug' | 'name'>

type Props = {
  initial: TitleFormValues
  genres: Genre[]
  onSaved: (id: string) => void | Promise<void>
  onCancel: () => void
  extraActions?: ReactNode
}

export function TitleForm({ initial, genres: initialGenres, onSaved, onCancel, extraActions }: Props) {
  const { supabase } = useRouteContext({ from: '/_authed' })
  const isEdit = !!initial.id
  const [genres, setGenres] = useState(initialGenres)
  const [newGenre, setNewGenre] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [slugTouched, setSlugTouched] = useState(isEdit)

  const form = useForm<TitleFormValues>({ resolver: zodResolver(titleFormSchema), defaultValues: initial })
  const sources = useFieldArray({ control: form.control, name: 'sources', keyName: 'key' })
  const [type, poster, backdrop, genreIds] = useWatch({
    control: form.control,
    name: ['type', 'poster_url', 'backdrop_url', 'genre_ids'],
  })

  // Série : sources gérées par épisode → on vide les sources du formulaire
  useEffect(() => {
    if (type === 'series' && form.getValues('sources').length) form.setValue('sources', [])
  }, [type, form])

  const onSubmit = async (values: TitleFormValues) => {
    setError(null)
    setSaved(false)
    try {
      const id = await saveTitle(supabase, values)
      setSaved(true)
      form.reset(values)
      await onSaved(id)
    } catch (e) {
      setError(adminErrorMessage(e))
    }
  }

  const toggleGenre = (id: number) => {
    const cur = form.getValues('genre_ids')
    form.setValue('genre_ids', cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id], { shouldDirty: true })
  }

  const addGenre = async () => {
    const name = newGenre.trim()
    if (!name) return
    const existing = genres.find((g) => g.slug === slugify(name))
    try {
      const g = existing ?? (await createGenre(supabase, name))
      if (!existing) setGenres((list) => [...list, g].sort((a, b) => a.name.localeCompare(b.name)))
      if (!form.getValues('genre_ids').includes(g.id)) toggleGenre(g.id)
      setNewGenre('')
    } catch (e) {
      setError(adminErrorMessage(e))
    }
  }

  const pending = form.formState.isSubmitting

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-[1fr_320px]" noValidate>
        <div className="grid gap-6">
          {/* ───── Informations */}
          <Card>
            <CardHeader>
              <CardTitle>Informations</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} disabled={isEdit}>
                        <option value="movie">Film</option>
                        <option value="series">Série</option>
                      </NativeSelect>
                    </FormControl>
                    {isEdit && <FormDescription>Non modifiable après création.</FormDescription>}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maturity_rating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Classification</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">—</option>
                        {MATURITY.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Titre</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          field.onChange(e)
                          if (!slugTouched) form.setValue('slug', slugify(e.target.value), { shouldValidate: form.formState.isSubmitted })
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slug (URL)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          setSlugTouched(true)
                          field.onChange(e)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="original_title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Titre original</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="synopsis"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea rows={5} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="release_year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Année</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" placeholder="2024" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {type === 'movie' && (
                <FormField
                  control={form.control}
                  name="runtime_minutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Durée (min)</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="120" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          {/* ───── Catégories */}
          <Card>
            <CardHeader>
              <CardTitle>Catégories</CardTitle>
              <CardDescription>Chaque catégorie génère une rangée sur l'accueil (≥ 4 titres publiés).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {genres.length === 0 && <span className="text-sm text-muted-foreground">Aucune catégorie.</span>}
                {genres.map((g) => {
                  const active = genreIds.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGenre(g.id)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors',
                        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                      )}
                    >
                      {active && <Check className="size-3.5" />}
                      {g.name}
                    </button>
                  )
                })}
              </div>
              <div className="flex max-w-sm gap-2">
                <Input
                  value={newGenre}
                  onChange={(e) => setNewGenre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void addGenre()
                    }
                  }}
                  placeholder="Nouvelle catégorie"
                />
                <Button type="button" variant="secondary" onClick={() => void addGenre()}>
                  <Plus /> Ajouter
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ───── Sources vidéo */}
          <Card>
            <CardHeader>
              <CardTitle>Sources vidéo</CardTitle>
              <CardDescription>
                Priorité basse = essayée en premier par <code>resolve-stream</code>. Un ID ou une URL complète sont acceptés.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {type === 'series' ? (
                <Alert>
                  <Info />
                  <AlertDescription>
                    Pour une série, les sources sont rattachées aux épisodes (pipeline <code>upload_pipeline.py</code>).
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  {sources.fields.length === 0 && (
                    <p className="text-sm text-muted-foreground">Aucune source : le titre ne sera pas lisible.</p>
                  )}
                  {sources.fields.map((f, i) => {
                    const provider = form.watch(`sources.${i}.provider`)
                    const hint = PROVIDERS.find((p) => p.value === provider)?.hint
                    return (
                      <div key={f.key} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-6">
                        <FormField
                          control={form.control}
                          name={`sources.${i}.provider`}
                          render={({ field }) => (
                            <FormItem className="sm:col-span-2">
                              <FormLabel>Hébergeur</FormLabel>
                              <FormControl>
                                <NativeSelect {...field}>
                                  {PROVIDERS.map((p) => (
                                    <option key={p.value} value={p.value}>
                                      {p.label}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`sources.${i}.quality`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Qualité</FormLabel>
                              <FormControl>
                                <NativeSelect {...field}>
                                  {QUALITIES.map((q) => (
                                    <option key={q} value={q}>
                                      {q}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`sources.${i}.priority`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Priorité</FormLabel>
                              <FormControl>
                                <Input inputMode="numeric" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`sources.${i}.is_active`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Active</FormLabel>
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} className="mt-2" />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <div className="flex items-end justify-end">
                          <Button type="button" variant="ghost" size="icon" aria-label="Retirer la source" onClick={() => sources.remove(i)}>
                            <Trash2 className="text-destructive" />
                          </Button>
                        </div>
                        {isHoster(provider) ? (
                          <FormField
                            control={form.control}
                            name={`sources.${i}.file_id`}
                            render={({ field }) => {
                              const id = extractFileId(provider, field.value)
                              return (
                                <FormItem className="sm:col-span-6">
                                  <FormLabel>Identifiant du fichier</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder={hint}
                                      {...field}
                                      onBlur={(e) => {
                                        field.onChange(extractFileId(provider, e.target.value)) // URL collée → ID seul
                                        field.onBlur()
                                      }}
                                      className="font-mono"
                                    />
                                  </FormControl>
                                  {FILE_ID_RE.test(id) && (
                                    <a
                                      href={buildHosterPageUrl(provider, id)}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="text-xs text-muted-foreground hover:underline"
                                    >
                                      {buildHosterPageUrl(provider, id)}
                                    </a>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )
                            }}
                          />
                        ) : (
                          <FormField
                            control={form.control}
                            name={`sources.${i}.raw_url`}
                            render={({ field }) => (
                              <FormItem className="sm:col-span-6">
                                <FormLabel>URL</FormLabel>
                                <FormControl>
                                  <Input placeholder="https://…" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <DebridTester source={form.watch(`sources.${i}`)} />
                      </div>
                    )
                  })}
                  <Button type="button" variant="secondary" className="justify-self-start" onClick={() => sources.append(emptySource())}>
                    <Plus /> Ajouter une source
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ───── Colonne latérale */}
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Publication</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField
                control={form.control}
                name="is_published"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <FormLabel>Visible dans le catalogue</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {saved && !form.formState.isDirty && (
                <Alert>
                  <Check />
                  <AlertDescription>Enregistré.</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending} className="flex-1">
                  {pending && <Loader2 className="animate-spin" />} {isEdit ? 'Enregistrer' : 'Créer'}
                </Button>
                <Button type="button" variant="outline" onClick={onCancel}>
                  Annuler
                </Button>
              </div>
              {extraActions}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visuels</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ImagePreview src={poster} className="aspect-[2/3] w-32" />
              <FormField
                control={form.control}
                name="poster_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image de couverture (affiche)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <ImagePreview src={backdrop} className="aspect-video w-full" />
              <FormField
                control={form.control}
                name="backdrop_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image de fond (hero)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logo_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Logo (optionnel)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="trailer_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bande-annonce (optionnel)</FormLabel>
                    <FormControl>
                      <Input placeholder="https://…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </div>
      </form>
    </Form>
  )
}

function ImagePreview({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const valid = /^https?:\/\//.test(src) && failed !== src
  return (
    <div className={cn('flex items-center justify-center overflow-hidden rounded-md border bg-muted', className)}>
      {valid ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(src)} />
      ) : (
        <ImageOff className="size-6 text-muted-foreground" />
      )}
    </div>
  )
}
