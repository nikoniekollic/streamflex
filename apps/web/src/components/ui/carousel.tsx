import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// API compatible Shadcn Carousel — implémentation native (scroll-snap), sans Embla.

type CarouselContextValue = {
  viewportRef: React.RefObject<HTMLDivElement | null>
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
  update: () => void
}

const CarouselContext = React.createContext<CarouselContextValue | null>(null)

function useCarousel() {
  const ctx = React.useContext(CarouselContext)
  if (!ctx) throw new Error('useCarousel must be used within a <Carousel />')
  return ctx
}

function Carousel({ className, children, ...props }: React.ComponentProps<'div'>) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const [canScrollPrev, setCanScrollPrev] = React.useState(false)
  const [canScrollNext, setCanScrollNext] = React.useState(false)

  const update = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    setCanScrollPrev(el.scrollLeft > 4)
    setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  const scrollBy = React.useCallback((dir: 1 | -1) => {
    const el = viewportRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }, [])

  const scrollPrev = React.useCallback(() => scrollBy(-1), [scrollBy])
  const scrollNext = React.useCallback(() => scrollBy(1), [scrollBy])

  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      scrollPrev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      scrollNext()
    }
  }

  return (
    <CarouselContext.Provider value={{ viewportRef, scrollPrev, scrollNext, canScrollPrev, canScrollNext, update }}>
      <div
        data-slot="carousel"
        role="region"
        aria-roledescription="carousel"
        onKeyDownCapture={onKeyDown}
        className={cn('group/carousel relative', className)}
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  )
}

function CarouselContent({ className, ...props }: React.ComponentProps<'div'>) {
  const { viewportRef } = useCarousel()
  return (
    <div ref={viewportRef} data-slot="carousel-content" className="scrollbar-none overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory">
      <div className={cn('flex', className)} {...props} />
    </div>
  )
}

function CarouselItem({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="carousel-item"
      role="group"
      aria-roledescription="slide"
      className={cn('min-w-0 shrink-0 grow-0 snap-start', className)}
      {...props}
    />
  )
}

function CarouselPrevious({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { scrollPrev, canScrollPrev } = useCarousel()
  return (
    <Button
      data-slot="carousel-previous"
      variant="ghost"
      size="icon"
      aria-label="Précédent"
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      className={cn(
        'absolute inset-y-0 left-0 z-20 h-auto w-10 rounded-none bg-black/60 opacity-0 transition-opacity group-hover/carousel:opacity-100 hover:bg-black/80 disabled:hidden md:w-12 [&_svg:not([class*=size-])]:size-8',
        className,
      )}
      {...props}
    >
      <ChevronLeft />
    </Button>
  )
}

function CarouselNext({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { scrollNext, canScrollNext } = useCarousel()
  return (
    <Button
      data-slot="carousel-next"
      variant="ghost"
      size="icon"
      aria-label="Suivant"
      disabled={!canScrollNext}
      onClick={scrollNext}
      className={cn(
        'absolute inset-y-0 right-0 z-20 h-auto w-10 rounded-none bg-black/60 opacity-0 transition-opacity group-hover/carousel:opacity-100 hover:bg-black/80 disabled:hidden md:w-12 [&_svg:not([class*=size-])]:size-8',
        className,
      )}
      {...props}
    >
      <ChevronRight />
    </Button>
  )
}

export { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, useCarousel }
