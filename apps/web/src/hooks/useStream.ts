import { useCallback, useEffect, useRef, useState } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { StreamError, resolveStream, type ResolveParams, type StreamErrorCode, type StreamInfo } from '@/lib/stream'

export type StreamState =
  | { status: 'resolving'; attempt: number }
  | { status: 'ready'; stream: StreamInfo }
  | { status: 'error'; code: StreamErrorCode }

/** Diagnostic console uniquement : statut HTTP / type de contenu / blocage CORS de l'URL servie. */
async function probeStream(url: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    console.info('[StreamFlex] sonde', res.status, res.headers.get('content-type'), res.url)
    if (res.status === 404) console.error('[StreamFlex] 404 : fichier introuvable sur le bypass')
    else if (!res.ok) console.error('[StreamFlex] HTTP', res.status)
    else if (res.headers.get('content-type')?.includes('text/html')) console.error('[StreamFlex] le bypass renvoie une page HTML, pas une vidéo')
  } catch (e) {
    if ((e as Error).name !== 'AbortError')
      console.error('[StreamFlex] sonde bloquée (CORS ou réseau) — <video> peut fonctionner quand même', e)
  } finally {
    clearTimeout(timer)
    ctrl.abort()
  }
}

type Opts = Pick<ResolveParams, 'quality' | 'audio' | 'refresh' | 'exclude'>

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
        console.info('[StreamFlex] URL de lecture', stream.url, { source: stream.sourceId, quality: stream.quality })
        if (!stream.url || /\/(undefined|null)(\/|$|\?)/.test(stream.url)) console.error('[StreamFlex] URL invalide (ID manquant)', stream.url)
        void probeStream(stream.url)
        if (id === req.current) setState({ status: 'ready', stream })
        return stream
      } catch (e) {
        console.error('[StreamFlex] resolve-stream a échoué', e instanceof StreamError ? e.code : e)
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
