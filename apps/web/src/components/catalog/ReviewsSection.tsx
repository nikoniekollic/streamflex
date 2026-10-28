import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { Loader2, Pencil, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { cn } from '@/lib/utils'
import {
  deleteReview,
  fetchRatingSummary,
  fetchReviews,
  reviewError,
  reviewSchema,
  saveReview,
  type RatingSummary,
  type Review,
} from '@/lib/reviews'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export function Stars({ value, size = 'size-4', className }: { value: number; size?: string; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5', className)} aria-label={`${value.toFixed(1)} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i + 1))
        return (
          <span key={i} className={cn('relative', size)}>
            <Star className={cn('absolute inset-0 text-neutral-600', size)} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={cn('fill-amber-400 text-amber-400', size)} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

function StarInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div role="radiogroup" aria-label="Note" className="flex gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} étoile${i > 1 ? 's' : ''}`}
          disabled={disabled}
          onMouseEnter={() => setHover(i)}
          onClick={() => onChange(i)}
          className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Star className={cn('size-7', i <= shown ? 'fill-amber-400 text-amber-400' : 'text-neutral-500')} />
        </button>
      ))}
    </div>
  )
}

export function ReviewsSection({ titleId }: { titleId: string }) {
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const profileId = activeProfile?.id ?? null
  const [summary, setSummary] = useState<RatingSummary | null>(null)
  const [rows, setRows] = useState<Review[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const mine = rows.find((r) => r.is_mine) ?? null

  const load = useCallback(
    async (p: number, append: boolean) => {
      setLoading(true)
      try {
        const [s, r] = await Promise.all([p === 0 ? fetchRatingSummary(supabase, titleId) : null, fetchReviews(supabase, titleId, profileId, p)])
        if (s) setSummary(s)
        setRows((prev) => (append ? [...prev, ...r.rows.filter((x) => !prev.some((y) => y.id === x.id))] : r.rows))
        setTotal(r.total)
        setPage(p)
      } catch (e) {
        toast.error(reviewError(e as Error))
      } finally {
        setLoading(false)
      }
    },
    [supabase, titleId, profileId],
  )

  useEffect(() => {
    setEditing(false)
    void load(0, false)
  }, [load])

  const startEdit = () => {
    setRating(mine?.rating ?? 0)
    setComment(mine?.comment ?? '')
    setFormError(null)
    setEditing(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profileId) return
    const parsed = reviewSchema.safeParse({ rating, comment })
    if (!parsed.success) return setFormError(parsed.error.issues[0].message)
    setSaving(true)
    try {
      await saveReview(supabase, profileId, titleId, parsed.data)
      toast.success(mine ? 'Avis mis à jour' : 'Merci pour ton avis !')
      setEditing(false)
      await load(0, false)
    } catch (err) {
      setFormError(reviewError(err as Error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!mine) return
    setSaving(true)
    try {
      await deleteReview(supabase, mine.id)
      toast.success('Avis supprimé')
      setEditing(false)
      await load(0, false)
    } catch (err) {
      toast.error(reviewError(err as Error))
    } finally {
      setSaving(false)
    }
  }

  const avg = summary?.average ?? null
  const count = summary?.total ?? 0
  const dist = summary ? [summary.r5, summary.r4, summary.r3, summary.r2, summary.r1] : [0, 0, 0, 0, 0]

  return (
    <section id="avis" className="mt-12 px-6 md:px-12" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="mb-6 text-2xl font-bold">
        Avis et Notes
      </h2>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        {/* Résumé */}
        <div className="flex flex-col gap-4 rounded-lg border border-white/10 p-5">
          <div className="flex items-end gap-3">
            <span className="text-5xl font-black tabular-nums">{avg !== null ? avg.toFixed(1).replace('.', ',') : '–'}</span>
            <div className="pb-1">
              <Stars value={avg ?? 0} />
              <p className="text-sm text-muted-foreground">
                {count} note{count > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {dist.map((n, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="w-3 text-right tabular-nums text-neutral-400">{5 - i}</span>
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-700">
                  <span className="block h-full bg-amber-400" style={{ width: count ? `${(n / count) * 100}%` : 0 }} />
                </span>
                <span className="w-8 text-right tabular-nums text-neutral-400">{n}</span>
              </li>
            ))}
          </ul>
          {profileId && !editing && (
            <Button variant={mine ? 'secondary' : 'default'} onClick={startEdit} disabled={loading}>
              <Pencil className="size-4" />
              {mine ? 'Modifier mon avis' : 'Donner mon avis'}
            </Button>
          )}
        </div>

        {/* Formulaire + liste */}
        <div className="flex flex-col gap-4">
          {editing && (
            <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-5" noValidate>
              <StarInput value={rating} onChange={(v) => (setRating(v), setFormError(null))} disabled={saving} />
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Ton commentaire (facultatif)"
                maxLength={2000}
                rows={4}
                disabled={saving}
                aria-label="Commentaire"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{comment.trim().length}/2000</span>
                {formError && <span className="text-destructive">{formError}</span>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {mine && (
                  <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={remove} disabled={saving}>
                    <Trash2 className="size-4" /> Supprimer
                  </Button>
                )}
                <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Annuler
                </Button>
                <Button type="submit" disabled={saving || rating === 0}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Publier
                </Button>
              </div>
            </form>
          )}

          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-muted-foreground">
              Aucun avis pour l’instant. Sois le premier à noter ce titre.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-white/10">
              {rows.map((r) => (
                <li key={r.id} className="flex gap-3 py-4">
                  <ProfileAvatar name={r.author_name} avatarUrl={r.author_avatar} className="size-10 shrink-0" textClassName="text-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{r.author_name}</span>
                      {r.is_mine && <span className="rounded bg-primary/20 px-1.5 text-xs text-primary">Toi</span>}
                      <Stars value={r.rating} size="size-3.5" />
                      <span className="text-xs text-neutral-500">
                        {dateFmt.format(new Date(r.created_at))}
                        {r.updated_at !== r.created_at && ' · modifié'}
                      </span>
                    </div>
                    {r.comment && <p className="mt-1.5 text-sm whitespace-pre-line break-words text-neutral-300">{r.comment}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {rows.length < total && (
            <Button variant="ghost" className="self-center" onClick={() => void load(page + 1, true)} disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              Voir plus d’avis ({total - rows.length})
            </Button>
          )}
          <span className="sr-only" aria-live="polite">
            {loading ? 'Chargement des avis' : `${rows.length} avis affichés sur ${total}`}
          </span>
        </div>
      </div>
    </section>
  )
}
