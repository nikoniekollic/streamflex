import { useCallback, useEffect, useRef } from 'react'
import type { TypedSupabaseClient } from '@/lib/supabase'

const SAVE_INTERVAL_MS = 15_000
const MIN_DELTA_S = 2

type Options = { supabase: TypedSupabaseClient; profileId: string; titleId: string; episodeId: string | null }

// Sauvegarde silencieuse de la progression : toutes les 15 s pendant la lecture + pause/fin/sortie.
export function useWatchProgress({ supabase, profileId, titleId, episodeId }: Options) {
  const latest = useRef<{ position: number; duration: number } | null>(null)
  const lastSaved = useRef<number>(-1)
  const inFlight = useRef(false)

  const flush = useCallback(async () => {
    const cur = latest.current
    if (!cur || inFlight.current) return
    const position = Math.floor(cur.position)
    if (Math.abs(position - lastSaved.current) < MIN_DELTA_S) return
    inFlight.current = true
    try {
      const { error } = await supabase.rpc('save_progress', {
        p_profile_id: profileId,
        p_title_id: titleId,
        p_episode_id: episodeId,
        p_position_seconds: position,
        p_duration_seconds: Number.isFinite(cur.duration) && cur.duration > 0 ? Math.floor(cur.duration) : null,
      })
      if (!error) lastSaved.current = position
      else if (import.meta.env.DEV) console.warn('[progress]', error.message)
    } finally {
      inFlight.current = false
    }
  }, [supabase, profileId, titleId, episodeId])

  const report = useCallback((position: number, duration: number) => {
    latest.current = { position, duration }
  }, [])

  useEffect(() => {
    lastSaved.current = -1
    latest.current = null
    const id = window.setInterval(() => void flush(), SAVE_INTERVAL_MS)
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      void flush()
    }
  }, [flush])

  return { report, flush }
}
