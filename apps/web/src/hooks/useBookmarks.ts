import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { TypedSupabaseClient } from '@/lib/supabase'
import { createBookmark, deleteBookmark, fetchBookmarks, type NewBookmark, type VideoBookmark } from '@/lib/bookmarks'

const sortBm = (a: VideoBookmark, b: VideoBookmark) => a.timestamp_seconds - b.timestamp_seconds || a.created_at.localeCompare(b.created_at)

export function useBookmarks(supabase: TypedSupabaseClient, profileId: string, titleId: string, episodeId: string | null) {
  const [bookmarks, setBookmarks] = useState<VideoBookmark[]>([])

  const reload = useCallback(async () => {
    try {
      setBookmarks(await fetchBookmarks(supabase, titleId, episodeId, profileId))
    } catch {
      /* non bloquant pour la lecture */
    }
  }, [supabase, titleId, episodeId, profileId])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = useCallback(
    async (b: NewBookmark) => {
      const id = await createBookmark(supabase, { profileId, titleId, episodeId }, b)
      setBookmarks((list) =>
        [...list, { id, ...b, label: b.label.trim(), created_at: new Date().toISOString(), author_name: '', author_avatar: null, is_mine: true }].sort(sortBm),
      )
      toast.success('Moment enregistré')
      void reload() // nom/avatar de l'auteur
    },
    [supabase, profileId, titleId, episodeId, reload],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteBookmark(supabase, id)
        setBookmarks((list) => list.filter((b) => b.id !== id))
      } catch {
        toast.error('Suppression impossible')
      }
    },
    [supabase],
  )

  return { bookmarks, create, remove }
}
