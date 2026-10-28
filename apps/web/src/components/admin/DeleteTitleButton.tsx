import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type Props = { title: string; onConfirm: () => Promise<void>; size?: 'icon' | 'default' }

export function DeleteTitleButton({ title, onConfirm, size = 'icon' }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={size === 'icon' ? 'ghost' : 'destructive'} size={size} aria-label={`Supprimer ${title}`}>
          <Trash2 className={size === 'icon' ? 'text-destructive' : undefined} />
          {size !== 'icon' && 'Supprimer'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer « {title} » ?</AlertDialogTitle>
          <AlertDialogDescription>
            Le titre, ses saisons, épisodes, sources vidéo et la progression des utilisateurs seront supprimés
            définitivement.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Annuler</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Supprimer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
