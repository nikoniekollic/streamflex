import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { StreamStatus } from '@/components/player/StreamStatus'
import { StreamError, loadWatch } from '@/lib/stream'
import { WatchSession } from '@/components/player/WatchSession'
import { requireActiveProfile } from '@/lib/route-guards'


type WatchSearch = { episode?: string; t?: number }

export const Route = createFileRoute('/_authed/watch/$id')({
  validateSearch: (s: Record<string, unknown>): WatchSearch => {
    const out: WatchSearch = {}
    if (typeof s.episode === 'string') out.episode = s.episode
    const t = Number(s.t)
    if (Number.isFinite(t) && t >= 0) out.t = Math.floor(t)
    return out
  },
  beforeLoad: ({ context, location }) => requireActiveProfile(context, location.href),
  loaderDeps: ({ search }) => ({ episode: search.episode, t: search.t }),
  loader: ({ context, params, deps }) => loadWatch(context.supabase, context.activeProfile!.id, params.id, deps.episode, deps.t),
  staleTime: 0,
  gcTime: 0,
  pendingMs: 0,
  pendingComponent: () => <StreamStatus phase="resolving" title="" onBack={() => history.back()} />,
  errorComponent: WatchError,
  notFoundComponent: () => (
    <StreamStatus phase="error" code="title_not_found" title="" onBack={() => history.back()} onRetry={() => undefined} />
  ),
  component: WatchPage,
})

// Page de lecture (liens directs) : la lecture elle-même vit dans WatchSession, partagée avec le lecteur en premier plan
function WatchPage() {
  const data = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  return (
    <WatchSession
      key={`${data.title.id}:${data.episode?.id ?? ''}`}
      data={data}
      mode="route"
      onBack={() => (router.history.canGoBack() ? router.history.back() : void navigate({ to: '/' }))}
      onSwitch={(t) => void navigate({ to: '/watch/$id', params: { id: t.titleId ?? data.title.id }, search: t.episodeId ? { episode: t.episodeId } : { t: 0 }, replace: true })}
    />
  )
}

function WatchError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <StreamStatus
      phase="error"
      code={error instanceof StreamError ? error.code : 'unknown'}
      title=""
      onBack={() => history.back()}
      onRetry={() => {
        reset()
        void router.invalidate()
      }}
    />
  )
}
