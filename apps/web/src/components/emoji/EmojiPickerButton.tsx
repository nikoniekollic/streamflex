import { useState } from 'react'
import { Smile } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { EmojiPanel } from '@/components/emoji/EmojiPanel'

/** Bouton rond affichant l'emoji choisi ; un clic ouvre le sélecteur (Apparence, fiche d'un modèle…). */
export function EmojiPickerButton({ value, onChange, label = 'Choisir un emoji', className }: { value: string | null | undefined; onChange: (emoji: string) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-no-emoji
          className={cn('flex size-10 items-center justify-center rounded-full border bg-background text-2xl leading-none transition hover:scale-105 hover:bg-accent', className)}
        >
          {value || <Smile className="size-5 text-muted-foreground" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-0 bg-transparent p-0 shadow-none">
        <EmojiPanel
          onPick={(e) => {
            onChange(e)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
