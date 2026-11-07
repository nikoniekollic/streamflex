import { Link } from '@tanstack/react-router'
import { GeneratedCover } from '@/components/catalog/GeneratedCover'
import { ModelLabel } from '@/components/catalog/ModelName'
import type { PublicModel } from '@/lib/model-catalog'

/** Carte d'un modèle : sa photo (ou une jaquette générée), son nom stylé au centre, le nombre de vidéos. */
export function ModelCard({ model }: { model: PublicModel }) {
  const n = model.titles_count
  return (
    <Link
      to="/models/$id"
      params={{ id: model.id }}
      aria-label={`${model.name} — ${n} vidéo${n > 1 ? 's' : ''}`}
      className="group/card relative block aspect-[2/3] overflow-hidden rounded-md bg-neutral-900 transition-shadow duration-300 outline-none hover:ring-2 hover:ring-white/80 focus-visible:ring-2 focus-visible:ring-white"
    >
      {model.image_url ? (
        <img src={model.image_url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover transition-transform duration-500 group-hover/card:scale-105" />
      ) : (
        <GeneratedCover seed={model.id} label={model.name} />
      )}
      <ModelLabel name={model.name} />
      <div className="absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/90 to-transparent px-2 pt-8 pb-2 text-center text-xs font-medium text-neutral-200">
        {n} vidéo{n > 1 ? 's' : ''}
      </div>
    </Link>
  )
}
