import { useCallback, useRef, useState } from 'react'
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { StreamStatus } from '@/components/player/StreamStatus'
import { useWatchProgress } from '@/hooks/useWatchProgress'
import { useStream } from '@/hooks/useStream'
import { useBookmarks } from '@/hooks/useBookmarks'
import { StreamError, loadWatch, type Quality } from '@/lib/stream'
import { loadSubtitleUrl } from '@/lib/subtitles'
import { requireActiveProfile } from '@/lib/route-guards'

const MAX_MEDIA_RETRIES = 2

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

// Remonte l'état (flux, position, retries) à chaque changement de titre/épisode
function WatchPage() {
  const data = Route.useLoaderData()
  return <WatchSession key={`${data.title.id}:${data.episode?.id ?? ''}`} />
}

function WatchSession() {
  const { title, episode, nextEpisode, startAt: initialStart, subtitles } = Route.useLoaderData()
  const { supabase, activeProfile } = Route.useRouteContext()
  const profileId = activeProfile!.id
  const navigate = Route.useNavigate()
  const router = useRouter()

  const episodeId = episode?.id ?? null
  const { state, resolve } = useStream(supabase, profileId, title.id, episodeId)
  const [startAt, setStartAt] = useState(initialStart)
  const mediaRetries = useRef(0)
  const lastPosition = useRef(initialStart)

  const { report, flush } = useWatchProgress({ supabase, profileId, titleId: title.id, episodeId })
  const bm = useBookmarks(supabase, profileId, title.id, episodeId)

  const onTimeUpdate = useCallback(
    (pos: number, dur: number) => {
      lastPosition.current = pos
      report(pos, dur)
    },
    [report],
  )

  const back = useCallback(() => {
    void flush()
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/' })
  }, [flush, navigate, router])

  const [playbackFailed, setPlaybackFailed] = useState(false)

  const retry = useCallback(() => {
    mediaRetries.current = 0
    setPlaybackFailed(false)
    setStartAt(lastPosition.current)
    void resolve({ refresh: true }, 2)
  }, [resolve])

  // Lien direct expiré / mort en cours de lecture : 1) re-débridage sans cache, 2) bascule vers une autre source
  const onMediaError = useCallback(
    (at: number) => {
      if (state.status !== 'ready') return
      setStartAt(at)
      mediaRetries.current += 1
      console.warn(`[StreamFlex] échec de lecture (tentative ${mediaRetries.current}/${MAX_MEDIA_RETRIES})`, state.stream.url)
      // Plafond strict : plus de boucle infinie de réessais
      if (mediaRetries.current > MAX_MEDIA_RETRIES) {
        console.error('[StreamFlex] abandon après', MAX_MEDIA_RETRIES, 'réessais — voir les logs <video> ci-dessus')
        setPlaybackFailed(true)
        return
      }
      if (mediaRetries.current === 1) void resolve({ quality: state.stream.quality, refresh: true }, 2)
      else void resolve({ refresh: true, exclude: [state.stream.sourceId] }, 3)
    },
    [resolve, state],
  )

  const loadSubtitle = useCallback((id: string) => loadSubtitleUrl(supabase, id), [supabase])
  const audioPref = useRef<string | undefined>(undefined)

  const onAudioChange = useCallback(
    (lang: string, at: number) => {
      setStartAt(at)
      audioPref.current = lang
      // @ts-ignore audio accepté par resolve-stream
      void resolve({ audio: lang, quality: state.status === 'ready' ? state.stream.quality : undefined } as any)
    },
    [resolve, state],
  )

  const onQualityChange = useCallback(
    (q: Quality, at: number) => {
      setStartAt(at)
      // @ts-ignore audio accepté par resolve-stream
      void resolve({ quality: q, audio: audioPref.current } as any)
    },
    [resolve],
  )

  const goNext = useCallback(() => {
    if (!nextEpisode) return
    void flush()
    void navigate({ to: '/watch/$id', params: { id: title.id }, search: { episode: nextEpisode.id }, replace: true })
  }, [flush, navigate, nextEpisode, title.id])

  const subtitle = episode
    ? `S${episode.season_number} · É${episode.episode_number}${episode.name ? ` — ${episode.name}` : ''}`
    : undefined

  if (state.status === 'resolving') {
    return <StreamStatus phase="resolving" attempt={state.attempt} title={title.title} backdrop={title.backdrop_url} onBack={back} />
  }
  if (playbackFailed) {
    return <StreamStatus phase="error" code="all_sources_failed" title={title.title} backdrop={title.backdrop_url} onBack={back} onRetry={retry} />
  }
  if (state.status === 'error') {
    return <StreamStatus phase="error" code={state.code} title={title.title} backdrop={title.backdrop_url} onBack={back} onRetry={retry} />
  }

  const { stream } = state
  return (
    <VideoPlayer
      key={`${stream.sourceId}:${stream.url}`}
      src={stream.url}
      poster={title.backdrop_url}
      title={title.title}
      subtitle={subtitle}
      startAt={startAt}
      qualities={stream.qualities}
      quality={stream.quality}
      onQualityChange={onQualityChange}
      subtitles={subtitles}
      loadSubtitle={loadSubtitle}
      audios={stream.audios ?? []}
      audio={stream.audio ?? []}
      onAudioChange={onAudioChange}
      onTimeUpdate={onTimeUpdate}
      onPause={() => void flush()}
      onEnded={() => {
        void flush()
        goNext()
      }}
      onNext={nextEpisode ? goNext : undefined}
      nextLabel={nextEpisode ? `Épisode suivant (É${nextEpisode.episode_number})` : undefined}
      onBack={back}
      onError={onMediaError}
      bookmarks={bm.bookmarks}
      onCreateBookmark={bm.create}
      onDeleteBookmark={bm.remove}
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
