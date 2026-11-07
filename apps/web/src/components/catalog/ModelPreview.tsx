import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { CSS_POS, useSiteSettings } from '@/lib/site-settings'
import { randomTitleIds } from '@/lib/playlists'
import { resolveMany } from '@/lib/preview'
import { CSS_FIT, hoverFit } from '@/components/catalog/HoverPreview'

const CLIPS = 5 // nombre de vidéos mélangées
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const known = new Map<string, string[]>() // modèle → vidéos tirées au hasard (gardées : second survol instantané)

/** Charge un extrait : lien, instant aléatoire, image prête (ou abandon après 8 s). */
function loadClip(el: HTMLVideoElement, url: string, clip: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 8000)
    const done = () => {
      clearTimeout(t)
      resolve()
    }
    el.onloadedmetadata = () => {
      const d = el.duration
      if (Number.isFinite(d) && d > clip * 2) el.currentTime = Math.min(d * (0.1 + Math.random() * 0.7), d - clip - 1)
      else done()
    }
    el.onseeked = done
    el.onerror = done
    el.muted = true
    el.preload = 'auto'
    el.src = url
  })
}

/**
 * Aperçu d'un modèle : un montage de ~30 s fait de quelques vidéos tirées au hasard parmi les siennes,
 * enchaînées sans coupure (l'extrait suivant est préparé pendant que le courant joue).
 */
export function ModelPreview({ modelId, active }: { modelId: string; active: boolean }) {
  const { activeProfile } = useActiveProfile()
  const profileId = activeProfile?.id
  const { preview: cfg } = useSiteSettings()
  const host = useRef<HTMLDivElement>(null)
  const [urls, setUrls] = useState<string[]>([])
  const [shown, setShown] = useState(false)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const controls = useRef<{ toggle: (p: boolean) => void } | null>(null)
  pausedRef.current = paused

  // Vidéos du montage (tirées au hasard, liens préparés en un seul appel)
  useEffect(() => {
    if (!active || !profileId || urls.length) return
    let alive = true
    ;(async () => {
      const ids = known.get(modelId) ?? (await randomTitleIds(supabase, { limit: CLIPS + 2, modelId, kids: !!activeProfile?.is_kids_profile }).catch(() => []))
      known.set(modelId, ids)
      const links = await resolveMany(supabase, profileId, ids)
      const ok = links.filter((u): u is string => !!u).slice(0, CLIPS)
      if (alive && ok.length) setUrls(ok)
    })()
    return () => {
      alive = false
    }
  }, [active, profileId, modelId, urls.length, activeProfile?.is_kids_profile])

  // Lecture : deux éléments en alternance, le suivant est prêt avant la fin du courant
  useEffect(() => {
    const h = host.current
    if (!active || !h || urls.length === 0) return
    let dead = false
    const seg = Math.max(4, cfg.clipSeconds / urls.length) * 1000
    const els = [0, 1].map(() => {
      const v = document.createElement('video')
      v.playsInline = true
      v.muted = true
      Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: CSS_FIT[hoverFit(cfg.fit)], objectPosition: CSS_POS[cfg.hoverPos], opacity: '0', background: '#000', pointerEvents: 'none' })
      h.appendChild(v)
      return v
    })
    let cur = 0
    const play = async (v: HTMLVideoElement) => {
      v.volume = cfg.volume
      v.muted = false
      await v.play().catch(() => {
        v.muted = true // son refusé par le navigateur : muet plutôt que rien
        return v.play().catch(() => undefined)
      })
    }
    controls.current = {
      toggle: (p) => {
        const v = els[cur]
        if (p) v.pause()
        else void v.play().catch(() => undefined)
      },
    }

    void (async () => {
      let idx = 0
      await loadClip(els[0], urls[0], seg / 1000)
      if (dead) return
      els[0].style.opacity = '1'
      setShown(true)
      if (!pausedRef.current) await play(els[0])
      while (!dead) {
        const next = (idx + 1) % urls.length
        const spare = els[1 - cur]
        const preload = loadClip(spare, urls[next], seg / 1000)
        let waited = 0
        while (!dead && waited < seg) {
          await sleep(200)
          if (!pausedRef.current) waited += 200
        }
        await preload
        if (dead) return
        const old = els[cur]
        spare.style.opacity = '1'
        if (!pausedRef.current) await play(spare)
        old.style.opacity = '0'
        old.pause()
        cur = 1 - cur
        idx = next
      }
    })()

    return () => {
      dead = true
      controls.current = null
      setShown(false)
      for (const v of els) {
        v.pause()
        v.removeAttribute('src')
        v.load()
        v.remove()
      }
    }
  }, [active, urls, cfg.clipSeconds, cfg.fit, cfg.hoverPos, cfg.volume])

  useEffect(() => {
    if (!active) setPaused(false)
  }, [active])

  return (
    <>
      <div ref={host} aria-hidden className={cn('pointer-events-none absolute inset-0 z-[1] bg-black transition-opacity duration-500', active && shown ? 'opacity-100' : 'opacity-0')} />
      {active && shown && cfg.pauseButton && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const p = !paused
            setPaused(p)
            controls.current?.toggle(p)
          }}
          aria-label={paused ? "Reprendre l'aperçu" : "Mettre l'aperçu en pause"}
          aria-pressed={paused}
          className="absolute top-2 left-2 z-[6] flex size-8 items-center justify-center rounded-full border-2 border-neutral-300 bg-black/60 text-white backdrop-blur-sm hover:scale-110 hover:border-white"
        >
          {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
        </button>
      )}
    </>
  )
}
