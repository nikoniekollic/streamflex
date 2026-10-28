import { useCallback, useEffect, useRef, useState } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { StreamError, resolveStream, type ResolveParams, type StreamErrorCode, type StreamInfo } from '@/lib/stream'

export type StreamState =
  | { status: 'resolving'; attempt: number }
  | { status: 'ready'; stream: StreamInfo }
  | { status: 'error'; code: StreamErrorCode }

const HTTP_HINT: Record<number, string> = {
  401: 'authentification requise par le CDN',
  403: 'accès refusé — hotlink/Referer bloqué, IP refusée ou lien expiré',
  404: 'fichier introuvable sur le CDN (ID faux ou fichier supprimé)',
  410: 'lien expiré',
  429: 'trop de requêtes (limite de débit)',
  451: 'bloqué pour raisons légales',
  502: 'le CDN ne joint pas Pixeldrain',
  503: 'CDN indisponible',
}

/** Diagnostic console : statut HTTP, type de contenu, CORS, Referer. N'influe pas sur la lecture. */
async function probeStream(url: string) {
  const tag = '[StreamFlex][sonde]'
  console.groupCollapsed(`${tag} ${url}`)
  for (const referrerPolicy of ['strict-origin-when-cross-origin', 'no-referrer'] as const) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const label = referrerPolicy === 'no-referrer' ? 'sans Referer' : 'avec Referer'
    try {
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', referrerPolicy, cache: 'no-store' })
      const ct = res.headers.get('content-type') ?? '(aucun)'
      const len = res.headers.get('content-length') ?? '?'
      if (!res.ok) console.error(`${tag} ${label} → HTTP ${res.status} ${res.statusText} : ${HTTP_HINT[res.status] ?? 'erreur serveur'}`, { url: res.url, contentType: ct })
      else if (ct.includes('text/html')) console.error(`${tag} ${label} → HTTP ${res.status} mais page HTML (pas une vidéo)`, { url: res.url })
      else if (!/^(video\/|application\/octet-stream)/i.test(ct)) console.warn(`${tag} ${label} → HTTP ${res.status}, type inattendu ${ct}`, { url: res.url, taille: len })
      else console.info(`${tag} ${label} → OK HTTP ${res.status} ${ct}, ${len} octets`, { urlFinale: res.url, redirige: res.redirected })
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        console.warn(`${tag} ${label} → pas de réponse en 10 s (timeout)`)
      } else {
        // Distinguer CORS (serveur joignable, en-têtes CORS absents) d'une vraie panne réseau/DNS
        let reachable = false
        try {
          await fetch(url, { mode: 'no-cors', referrerPolicy, cache: 'no-store', signal: AbortSignal.timeout(8000) })
          reachable = true
        } catch {
          /* injoignable */
        }
        console.error(
          reachable
            ? `${tag} ${label} → bloqué par CORS (serveur joignable, mais sans Access-Control-Allow-Origin). La balise <video> n'a pas besoin de CORS : voir l'erreur <video> ci-dessous.`
            : `${tag} ${label} → réseau/DNS/TLS : domaine injoignable ou bloqué (CSP, antivirus, FAI)`,
          `${err.name}: ${err.message}`,
        )
      }
    } finally {
      clearTimeout(timer)
      ctrl.abort()
    }
  }
  console.groupEnd()
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
