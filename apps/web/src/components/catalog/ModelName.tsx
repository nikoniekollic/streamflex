import { useModelName } from '@/lib/model-names'
import { modelNameStyle } from '@/lib/cover'
import { useSiteSettings } from '@/lib/site-settings'

/** Nom du modèle au centre de la jaquette (police et couleurs propres à chaque modèle). */
export function ModelName({ titleId }: { titleId: string }) {
  const name = useModelName(titleId)
  return <ModelLabel name={name} />
}

const V = { top: 'items-start', center: 'items-center', bottom: 'items-end' } as const // haut : sous les boutons ; bas : au-dessus du compteur de vidéos
const H = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const

/** Libellé stylé d'un nom de modèle (jaquettes de films, cartes de modèles). */
export function ModelLabel({ name }: { name: string | null }) {
  const { names } = useSiteSettings()
  if (!name || !names.show) return null
  const s = modelNameStyle(name, names)
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-[2] flex overflow-hidden px-2 ${V[names.vpos]} ${H[names.hpos]} ${names.vpos === 'top' ? 'pt-12' : names.vpos === 'bottom' ? 'pb-9' : ''}`}
      style={{ textAlign: names.hpos }}
    >
      <span
        className="line-clamp-3 max-w-full leading-tight break-words"
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
