import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CheckCircle2, Clock, Film, Loader2, Send, Tv, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import {
  STATUS_LABEL,
  TYPE_LABEL,
  cancelRequest,
  createRequest,
  fetchMyRequests,
  requestSchema,
  type MyRequest,
  type RequestStatus,
  type RequestValues,
} from '@/lib/requests'
import { searchTitles } from '@/lib/search'
import type { CatalogTitle } from '@/lib/catalog'

export const Route = createFileRoute('/_authed/_shell/request')({
  validateSearch: (s: Record<string, unknown>): { title?: string } =>
    typeof s.title === 'string' && s.title.trim() ? { title: s.title.trim().slice(0, 200) } : {},
  loader: ({ context }) => fetchMyRequests(context.supabase, context.user.id),
  staleTime: 0,
  component: RequestPage,
})

const STATUS_STYLE: Record<RequestStatus, { icon: typeof Clock; className: string }> = {
  pending: { icon: Clock, className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  added: { icon: CheckCircle2, className: 'border-green-500/40 bg-green-500/10 text-green-400' },
  rejected: { icon: XCircle, className: 'border-neutral-600 bg-neutral-800 text-neutral-300' },
}

function RequestPage() {
  const mine = Route.useLoaderData()
  const { title: prefill } = Route.useSearch()
  const { supabase, activeProfile, isKids } = Route.useRouteContext()
  const router = useRouter()

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { title: prefill ?? '', media_type: undefined as unknown as RequestValues['media_type'], release_year: '', note: '' },
  })
  const title = useWatch({ control: form.control, name: 'title' })
  const existing = useCatalogMatches(title, isKids)

  const onSubmit = async (v: RequestValues) => {
    try {
      await createRequest(supabase, v, activeProfile?.id ?? null)
      toast.success('Demande envoyée', { description: `« ${v.title} » — tu seras notifié dès son ajout.` })
      form.reset({ title: '', media_type: v.media_type, release_year: '', note: '' })
      await router.invalidate()
    } catch (e) {
      toast.error('Demande non envoyée', { description: (e as Error).message })
    }
  }

  const pending = form.formState.isSubmitting

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 md:px-8 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Demander un film ou une série</CardTitle>
          <CardDescription>Un titre manque au catalogue ? Fais-le savoir, tu recevras une notification à son ajout.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Titre</FormLabel>
                    <FormControl>
                      <Input placeholder="ex. Le Seigneur des anneaux" autoComplete="off" maxLength={200} autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {existing.length > 0 && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <p className="mb-2 font-medium">Déjà disponible ?</p>
                  <ul className="flex flex-wrap gap-2">
                    {existing.map((t) => (
                      <li key={t.id}>
                        <Link to="/title/$slug" params={{ slug: t.slug }} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 hover:bg-accent">
                          {t.type === 'movie' ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
                          {t.title}
                          {t.release_year && <span className="text-muted-foreground">({t.release_year})</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="media_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ''}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Film ou série" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="movie">
                            <Film /> Film
                          </SelectItem>
                          <SelectItem value="series">
                            <Tv /> Série
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="release_year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Année de sortie (optionnel)</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" maxLength={4} placeholder="2001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Précision (optionnel)</FormLabel>
                    <FormControl>
                      <Textarea rows={3} maxLength={500} placeholder="Version longue, saison précise, VOSTFR…" {...field} />
                    </FormControl>
                    <FormDescription>{field.value.length}/500</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" size="lg" disabled={pending} className="justify-self-start">
                {pending ? <Loader2 className="animate-spin" /> : <Send />} Envoyer la demande
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <MyRequests items={mine} />
    </div>
  )
}

/** Titres déjà au catalogue correspondant à la saisie (debounce 400 ms, cache Redis via searchTitles). */
function useCatalogMatches(title: string, kids: boolean): CatalogTitle[] {
  const { supabase } = Route.useRouteContext()
  const [matches, setMatches] = useState<CatalogTitle[]>([])
  useEffect(() => {
    const q = title.trim()
    if (q.length < 3) return setMatches([])
    let cancelled = false
    const t = window.setTimeout(async () => {
      try {
        const r = await searchTitles(supabase, { q }, kids)
        if (!cancelled) setMatches(r.isMock ? [] : r.results.slice(0, 4))
      } catch {
        if (!cancelled) setMatches([])
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [title, kids, supabase])
  return matches
}

function MyRequests({ items }: { items: MyRequest[] }) {
  const { supabase } = Route.useRouteContext()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const cancel = async (r: MyRequest) => {
    setBusy(r.id)
    try {
      await cancelRequest(supabase, r.id)
      toast(`Demande « ${r.title} » annulée`)
      await router.invalidate()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="content-start">
      <CardHeader>
        <CardTitle>Mes demandes</CardTitle>
        <CardDescription>{items.length ? `${items.length} demande${items.length > 1 ? 's' : ''}` : 'Aucune demande pour le moment.'}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {items.map((r) => {
            const s = STATUS_STYLE[r.status]
            const Icon = s.icon
            return (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {TYPE_LABEL[r.media_type]}
                    {r.release_year ? ` · ${r.release_year}` : ''} · {new Date(r.created_at).toLocaleDateString('fr-FR')}
                  </p>
                  {r.admin_note && r.status !== 'pending' && <p className="mt-1 text-xs text-muted-foreground italic">« {r.admin_note} »</p>}
                  {r.status === 'added' && r.titles && (
                    <Link to="/title/$slug" params={{ slug: r.titles.slug }} className="mt-1 inline-block text-xs text-primary hover:underline">
                      Voir le titre →
                    </Link>
                  )}
                </div>
                <Badge variant="outline" className={cn('shrink-0', s.className)}>
                  <Icon /> {STATUS_LABEL[r.status]}
                </Badge>
                {r.status === 'pending' && (
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Annuler ${r.title}`} disabled={busy === r.id} onClick={() => void cancel(r)}>
                    {busy === r.id ? <Loader2 className="animate-spin" /> : <X />}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
