import type React from 'react'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFavorite } from '@/lib/favorites'
import { Button } from '@/components/ui/button'
import type { CatalogTitle } from '@/lib/catalog'

type Props = {
  title: Pick<CatalogTitle, 'id' | 'title'>
  variant?: 'icon' | 'button'
  className?: string
}

export function FavoriteButton({ title, variant = 'icon', className }: Props) {
  const { isFavorite, pending, toggle } = useFavorite(title)
  const label = isFavorite ? 'Retirer de Ma liste' : 'Ajouter à Ma liste'

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    void toggle()
  }

  if (variant === 'button') {
    return (
      <Button
        type="button"
        size="lg"
        variant="secondary"
        aria-pressed={isFavorite}
        disabled={pending}
        onClick={onClick}
        className={cn('h-11 bg-neutral-500/60 px-6 text-base font-semibold text-white hover:bg-neutral-500/40 md:h-12', className)}
      >
        <Heart className={cn('size-6 transition-transform', isFavorite && 'scale-110 fill-current text-primary')} />
        {isFavorite ? 'Dans ma liste' : 'Ma liste'}
      </Button>
    )
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isFavorite}
      disabled={pending}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-full border-2 bg-black/60 backdrop-blur-sm transition-all',
        'hover:scale-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-60',
        isFavorite ? 'border-primary bg-primary text-primary-foreground' : 'border-neutral-300 text-white hover:border-white',
        className,
      )}
    >
      <Heart className={cn('size-4', isFavorite && 'fill-current')} strokeWidth={2.5} />
    </button>
  )
}
