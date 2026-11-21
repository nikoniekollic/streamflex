import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useModelColors, useModelName } from '@/lib/model-names'
import { displayModelName, modelNameStyle } from '@/lib/cover'
import { useSiteSettings } from '@/lib/site-settings'

/** Nom du modèle au centre de la jaquette (police et couleurs propres à chaque modèle). */
export function ModelName({ titleId }: { titleId: string }) {
  const name = useModelName(titleId)
  return <ModelLabel name={name} />
}

/** Position du nom : le coin/centre du texte est placé au point (x %, y %) de la jaquette ; 0/0 = coin haut gauche, 50/50 = centre. */
export function nameBox(names: { x: number; y: number }): { outer: string; style: CSSProperties } {
  return {
    outer: 'pointer-events-none absolute inset-0 z-[2] overflow-hidden',
    style: {
      position: 'absolute',
      left: `${names.x}%`,
      top: `${names.y}%`,
      transform: `translate(-${names.x}%, -${names.y}%)`,
      width: 'max-content',
      maxWidth: 'calc(100% - 1rem)',
      textAlign: names.x < 34 ? 'left' : names.x > 66 ? 'right' : 'center',
    },
  }
}

// ───────── Taille ajustée à la jaquette : chaque morceau du nom (coupé seulement après « _ », « - » ou une espace) doit
// tenir sur une ligne ; sinon la police rétrécit juste ce qu'il faut, au lieu de couper un mot en plein milieu.
const fitters = new WeakMap<Element, () => void>()
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => es.forEach((e) => fitters.get(e.target)?.())) : null
let ctx2d: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, font: string): number {
  ctx2d ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (!ctx2d) return 0
  ctx2d.font = font
  return ctx2d.measureText(text).width
}
const pieces = (text: string) => text.split(/\s+/).flatMap((w) => w.split(/(?<=[_-])/)).filter(Boolean)

function useFitRem(box: RefObject<HTMLDivElement | null>, text: string, baseRem: number, font: { style: string; weight: number; family: string }): number {
  const [rem, setRem] = useState(baseRem)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const avail = el.clientWidth - root - 6 // marge de 1rem (max-width) + contour
      if (avail <= 0) return
      const px = baseRem * root
      const f = `${font.style} ${font.weight} ${px}px ${font.family}`
      // nom entier sur une ligne s'il suffit de réduire un peu (au plus d'un quart) : « Ruby_Onyx » plutôt que « Ruby_ / Onyx »
      const whole = (baseRem * avail) / Math.max(1, textWidth(text, f))
      const widest = Math.max(...pieces(text).map((p) => textWidth(p, f)))
      const next = whole >= baseRem ? baseRem : whole >= baseRem * 0.75 ? whole : widest > avail ? Math.max(0.6, (baseRem * avail) / widest) : baseRem
      setRem(Math.floor(next * 100) / 100)
    }
    fit()
    fitters.set(el, fit)
    ro?.observe(el)
    return () => {
      ro?.unobserve(el)
      fitters.delete(el)
    }
  }, [box, text, baseRem, font.style, font.weight, font.family])
  return rem
}

/** Libellé stylé d'un nom de modèle (jaquettes de films, cartes de modèles). */
export function ModelLabel({ name }: { name: string | null }) {
  const { names } = useSiteSettings()
  useModelColors()
  const boxRef = useRef<HTMLDivElement>(null)
  const s = modelNameStyle(name ?? '', names)
  const shown = name ? displayModelName(name) : ''
  const rem = useFitRem(boxRef, shown, parseFloat(s.fontSize), { style: s.fontStyle, weight: s.fontWeight, family: s.fontFamily })
  if (!name || !names.show) return null
  const box = nameBox(names)
  return (
    <div aria-hidden ref={boxRef} className={box.outer}>
      <span
        className="line-clamp-3 leading-tight [overflow-wrap:anywhere]"
        style={{
          ...box.style,
          fontFamily: s.fontFamily,
          fontWeight: s.fontWeight,
          fontStyle: s.fontStyle,
          textTransform: s.textTransform,
          letterSpacing: s.letterSpacing,
          fontSize: `${rem}rem`,
          color: s.color,
          WebkitTextStroke: `1.5px ${s.stroke}`,
          paintOrder: 'stroke fill',
          textShadow: `0 2px 10px rgba(0,0,0,.85), 0 0 18px ${s.glow}`,
        }}
      >
        {shown.split(/(?<=[_-])/).map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <wbr />}
            {part}
          </Fragment>
        ))}
      </span>
    </div>
  )
}
