import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { StreamStatus } from '@/components/player/StreamStatus'
import { useWatchProgress } from '@/hooks/useWatchProgress'
import { useStream } from '@/hooks/useStream'
import { useBookmarks } from '@/hooks/useBookmarks'
import type { Quality, WatchData } from '@/lib/stream'
import { loadSubtitleUrl } from '@/lib/subtitles'
import { cycleRepeat, nextInQueue, previousInQueue, syncQueue, toggleShuffle, useQueue } from '@/lib/queue'
import { markPlayed } from '@/lib/random-history'

export type SwitchTarget = { titleId?: string; episodeId?: string }

/**
 * Lecture d'un titre : résolution du flux, lecteur, progression, file de lecture (playlist / aléatoire).
 * Utilisée par la page /watch et par le lecteur en premier plan (surcouche avec croix de fermeture).
 */
export function WatchSession({ data, mode, onBack, onSwitch }: { data: WatchData; mode: 'route' | 'overlay'; onBack: () => void; onSwitch: (t: SwitchTarget) => void }) {
  const { title, episode, nextEpisode, startAt: initialStart, subtitles } = data
  const { supabase, activeProfile } = useRouteContext({ from: '/_authed' })
  const profileId = activeProfile!.id

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
    onBack()
  }, [flush, onBack])

  const [playbackFailed, setPlaybackFailed] = useState(false)

  const retry = useCallback(() => {
    mediaRetries.current = 0
    setPlaybackFailed(false)
    setStartAt(lastPosition.current)
    void resolve({ refresh: true }, 2)
  }, [resolve])

  // Lien direct expiré / mort en cours de lecture
  const onMediaError = useCallback(
    (at: number) => {
      if (state.status !== 'ready') return
      setStartAt(at)
      // Aucun réessai automatique : l'hébergeur peut bloquer l'IP après trop de requêtes erronées.
      mediaRetries.current += 1
      console.error('[StreamFlex] échec de lecture — pas de réessai automatique', state.stream.url)
      setPlaybackFailed(true)
    },
    [state],
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

  // File de lecture (playlist, lecture aléatoire) : la vidéo affichée en fait-elle partie ?
  const queue = useQueue()
  useEffect(() => {
    const q = syncQueue(title.id)
    if (q?.track) markPlayed(profileId, title.id) // lecture aléatoire : cette vidéo ne reviendra pas dans les prochaines listes
  }, [title.id, profileId])
  const inQueue = !!queue && queue.order[queue.index] === title.id

  const goQueue = useCallback(
    (id: string | null) => {
      if (!id) return
      void flush()
      onSwitch({ titleId: id })
    },
    [flush, onSwitch],
  )
  const goNextQueue = useCallback(() => void nextInQueue(supabase).then(goQueue), [supabase, goQueue])

  const goNext = useCallback(() => {
    if (inQueue) return goNextQueue()
    if (!nextEpisode) return
    void flush()
    onSwitch({ episodeId: nextEpisode.id })
  }, [flush, goNextQueue, inQueue, nextEpisode, onSwitch])

  const subtitle = episode ? `S${episode.season_number} · É${episode.episode_number}${episode.name ? ` — ${episode.name}` : ''}` : undefined

  if (state.status === 'resolving') {
    return <StreamStatus phase="resolving" attempt={state.attempt} title={title.title} backdrop={title.backdrop_url} onBack={back} />
  }
  if (playbackFailed) {
    return <StreamStatus phase="error" code="all_sources_failed" title={title.title} backdrop={title.backdrop_url} onBack={back} onRetry={retry} />
  }
  if (state.status === 'error') {
    return <StreamStatus phase="error" code={state.code} detail={state.detail} title={title.title} backdrop={title.backdrop_url} onBack={back} onRetry={retry} />
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
      onNext={inQueue || nextEpisode ? goNext : undefined}
      nextLabel={inQueue ? 'Vidéo suivante' : nextEpisode ? `Épisode suivant (É${nextEpisode.episode_number})` : undefined}
      loop={inQueue && queue?.repeat === 'one'}
      closeIcon={mode === 'overlay'}
      queue={
        inQueue && queue
          ? {
              label: queue.label,
              position: `${queue.index + 1}${queue.random ? '' : ` / ${queue.order.length}`}`,
              shuffle: queue.shuffle,
              repeat: queue.repeat,
              onShuffle: toggleShuffle,
              onRepeat: cycleRepeat,
              onPrevious: queue.index > 0 ? () => goQueue(previousInQueue()) : undefined,
            }
          : undefined
      }
      onBack={back}
      onError={onMediaError}
      bookmarks={bm.bookmarks}
      onCreateBookmark={bm.create}
      onDeleteBookmark={bm.remove}
    />
  )
}
