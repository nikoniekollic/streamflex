import type { CSSProperties } from 'react'
import { useModelName } from '@/lib/model-names'
import { modelNameStyle } from '@/lib/cover'
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

/** Libellé stylé d'un nom de modèle (jaquettes de films, cartes de modèles). */
export function ModelLabel({ name }: { name: string | null }) {
  const { names } = useSiteSettings()
  if (!name || !names.show) return null
  const s = modelNameStyle(name, names)
  const box = nameBox(names)
  return (
    <div aria-hidden className={box.outer}>
      <span
        className="line-clamp-3 leading-tight break-words"
        style={{
          ...box.style,
          fontFamily: s.fontFamily,
          fontWeight: s.fontWeight,
          fontStyle: s.fontStyle,
          textTransform: s.textTransform,
          letterSpacing: s.letterSpacing,
          fontSize: s.fontSize,
          color: s.color,
          WebkitTextStroke: `1.5px ${s.stroke}`,
          paintOrder: 'stroke fill',
          textShadow: `0 2px 10px rgba(0,0,0,.85), 0 0 18px ${s.glow}`,
        }}
      >
        {name}
      </span>
    </div>
  )
}
