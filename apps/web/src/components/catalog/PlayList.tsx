import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { CatalogTitle } from '@/lib/catalog'

// Une liste de jaquettes (rangée, grille d'une page…) : un clic sur l'une d'elles lance le lecteur ET la suite de la liste
// (suivant / précédent, lecture enchaînée), au lieu d'une vidéo isolée.
type Ctx = { ids: string[]; label: string }
const PlayListContext = createContext<Ctx | null>(null)

const MAX = 300

export function PlayList({ titles, label, children }: { titles: Pick<CatalogTitle, 'id' | 'type'>[]; label: string; children: ReactNode }) {
  const key = titles.map((t) => t.id).join(',')
  const value = useMemo(() => ({ ids: titles.filter((t) => t.type === 'movie').map((t) => t.id).slice(0, MAX), label }), [key, label]) // eslint-disable-line react-hooks/exhaustive-deps
  return <PlayListContext.Provider value={value}>{children}</PlayListContext.Provider>
}

export const usePlayList = () => useContext(PlayListContext)
