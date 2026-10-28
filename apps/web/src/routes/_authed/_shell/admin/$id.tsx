import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { TitleForm } from '@/components/admin/TitleForm'
import { DeleteTitleButton } from '@/components/admin/DeleteTitleButton'
import { SubtitlesManager } from '@/components/admin/SubtitlesManager'
import { Button } from '@/components/ui/button'
import { adminErrorMessage, deleteTitle, fetchGenres, fetchTitleForEdit } from '@/lib/admin'

export const Route = createFileRoute('/_authed/_shell/admin/$id')({
  loader: async ({ context, params }) => {
    const [title, genres] = await Promise.all([fetchTitleForEdit(context.supabase, params.id), fetchGenres(context.supabase)])
    if (!title) throw notFound()
    return { title, genres }
  },
  staleTime: 0,
  notFoundComponent: () => (
    <p className="text-muted-foreground">
      Titre introuvable.{' '}
      <Link to="/admin" className="text-primary hover:underline">
        Retour à la liste
      </Link>
    </p>
  ),
  component: EditTitle,
})

function EditTitle() {
  const { title, genres } = Route.useLoaderData()
  const { id } = Route.useParams()
  const titleId: string = title.id ?? id
  const { supabase } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const router = useRouter()

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Modifier « {title.title} »</h2>
        {title.is_published && (
          <Button asChild variant="ghost" size="sm">
            <Link to="/title/$slug" params={{ slug: title.slug }}>
              <ExternalLink /> Voir
            </Link>
          </Button>
        )}
      </div>
      <TitleForm
        key={titleId}
        initial={title}
        genres={genres}
        onSaved={() => router.invalidate()}
        onCancel={() => navigate({ to: '/admin' })}
        extraActions={
          <DeleteTitleButton
            size="default"
            title={title.title}
            onConfirm={async () => {
              try {
                await deleteTitle(supabase, titleId)
              } catch (e) {
                throw new Error(adminErrorMessage(e))
              }
              await navigate({ to: '/admin', replace: true })
            }}
          />
        }
      />
      <SubtitlesManager titleId={titleId} type={title.type} />
    </div>
  )
}
