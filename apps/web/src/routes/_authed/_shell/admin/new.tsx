import { createFileRoute } from '@tanstack/react-router'
import { TitleForm } from '@/components/admin/TitleForm'
import { emptySource, emptyTitle, fetchGenres } from '@/lib/admin'

export const Route = createFileRoute('/_authed/_shell/admin/new')({
  loader: ({ context }) => fetchGenres(context.supabase),
  component: NewTitle,
})

function NewTitle() {
  const genres = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-semibold">Nouveau titre</h2>
      <TitleForm
        initial={{ ...emptyTitle(), sources: [emptySource()] }}
        genres={genres}
        onSaved={(id) => navigate({ to: '/admin/$id', params: { id }, replace: true })}
        onCancel={() => navigate({ to: '/admin' })}
      />
    </div>
  )
}
