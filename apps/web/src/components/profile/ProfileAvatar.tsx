import { Baby, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AVATAR_PRESETS } from '@/lib/viewer-profiles'

type Props = {
  name: string
  avatarUrl: string | null
  isKids?: boolean
  locked?: boolean
  className?: string
  /** taille du texte d'initiale */
  textClassName?: string
}

export function ProfileAvatar({ name, avatarUrl, isKids, locked, className, textClassName }: Props) {
  const preset = avatarUrl?.startsWith('preset:') ? AVATAR_PRESETS.find((p) => `preset:${p.key}` === avatarUrl) : undefined
  const image = avatarUrl?.startsWith('https://') ? avatarUrl : null
  const gradient = preset?.className ?? AVATAR_PRESETS[(name.charCodeAt(0) || 0) % AVATAR_PRESETS.length].className

  return (
    <span className={cn('relative block aspect-square overflow-hidden rounded-md', className)}>
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        <span className={cn('flex size-full items-center justify-center bg-gradient-to-br font-black text-white select-none', gradient, textClassName)}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
      {isKids && (
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold text-white">
          <Baby className="size-3" /> Enfants
        </span>
      )}
      {locked && (
        <span className="absolute top-1 right-1 rounded-full bg-black/70 p-1 text-white">
          <Lock className="size-3" />
        </span>
      )}
    </span>
  )
}
