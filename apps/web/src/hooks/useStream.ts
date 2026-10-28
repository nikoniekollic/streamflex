import { useCallback, useEffect, useRef, useState } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { StreamError, resolveStream, type Quality, type StreamErrorCode, type StreamInfo } from '@/lib/stream'

export type StreamState =
  | { status: 'resolving'; attempt: number }
  | { status: 'ready'; stream: StreamInfo }
  | { status: 'error'; code: StreamErrorCode }

type Opts = { quality?: Quality; refresh?: boolean; exclude?: string[] }

/**
 * Résolution du flux côté serveur (Edge Function `resolve-stream`) :
 * l'origine de la source (Pixeldrain / 1fichier / autre hébergeur) est identifiée serveur,
 * les liens 1fichier & co sont débridés via Alldebrid ; le navigateur ne reçoit que l'URL directe.
 */
export function useStream(supabase: TypedSupabaseClient, profileId: string, titleId: string, episodeId: string | null) {
  const [state, setState] = useState<StreamState>({ status: 'resolving', attempt: 1 })
  const req = useRef(0)

  const resolve = useCallback(
    async (opts: Opts = {}, attempt = 1) => {
      const id = ++req.current
      setState({ status: 'resolving', attempt })
      try {
        const stream = await resolveStream(supabase, { profileId, titleId, episodeId, ...opts })
        if (id === req.current) setState({ status: 'ready', stream })
        return stream
      } catch (e) {
        if (id === req.current) setState({ status: 'error', code: e instanceof StreamError ? e.code : 'unknown' })
        return null
      }
    },
    [supabase, profileId, titleId, episodeId],
  )

  useEffect(() => {
    void resolve()
    return () => {
      req.current++ // ignore les réponses tardives après démontage / changement d'épisode
    }
  }, [resolve])

  return { state, resolve }
}
