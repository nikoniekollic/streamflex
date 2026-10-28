import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/_shell/browse')({
  loader: async ({ context }) => {
    const { data, error } = await context.supabase
      .from('titles')
      .select('id, slug, title, type, poster_url, release_year')
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(0, 47)
    if (error) throw error
    return { titles: data }
  },
  component: Browse,
})

function Browse() {
  const { titles } = Route.useLoaderData()
  return (
    <section className="px-6 py-10 md:px-12">
      <h1 className="mb-6 text-2xl font-bold">Catalogue</h1>
      {titles.length === 0 ? (
        <p className="text-muted-foreground">Aucun titre publié pour le moment.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {titles.map((t) => (
            <li key={t.id} className="overflow-hidden rounded-md bg-card">
              {t.poster_url ? (
                <img src={t.poster_url} alt={t.title} loading="lazy" className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[2/3] items-center justify-center p-2 text-center text-sm">{t.title}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
