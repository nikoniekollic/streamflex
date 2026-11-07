import { Link } from '@tanstack/react-router'
import { CarouselItem } from '@/components/ui/carousel'
import { Row } from '@/components/catalog/CategoryCarousel'
import { ModelCard } from '@/components/catalog/ModelCard'
import type { PublicModel } from '@/lib/model-catalog'

const ITEM = 'basis-[38%] sm:basis-[28%] md:basis-[22%] lg:basis-[16.66%] xl:basis-[14.28%] 2xl:basis-[12.5%]'

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
