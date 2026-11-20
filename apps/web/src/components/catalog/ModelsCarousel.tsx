import { Link } from '@tanstack/react-router'
import { CarouselItem } from '@/components/ui/carousel'
import { Row } from '@/components/catalog/CategoryCarousel'
import { ModelCard } from '@/components/catalog/ModelCard'
import type { PublicModel } from '@/lib/model-catalog'

const ITEM = 'sf-row-item'

/** Rangée « Modèles » de l'accueil. */
export function ModelsCarousel({ models }: { models: PublicModel[] }) {
  if (models.length === 0) return null
  return (
    <Row
      label="Modèles"
      memoryKey="home:models"
      action={
        <Link to="/models" className="text-sm text-neutral-400 hover:text-white">
          Tout voir
        </Link>
      }
    >
      {models.map((m) => (
        <CarouselItem key={m.id} className={ITEM}>
          <ModelCard model={m} />
        </CarouselItem>
      ))}
    </Row>
  )
}
