import { useModelName } from '@/lib/model-names'
import { modelNameStyle } from '@/lib/cover'

/** Nom du modèle au centre de la jaquette (police et couleurs propres à chaque modèle). */
export function ModelName({ titleId }: { titleId: string }) {
  const name = useModelName(titleId)
  if (!name) return null
  const s = modelNameStyle(name)
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center px-2 text-center">
      <span
        className="line-clamp-3 leading-tight break-words"
        style={{
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
