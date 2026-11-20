import { useSyncExternalStore } from 'react'

// ───── Sélection gardée HORS de la page : pendant le chargement de la page suivante (plus d'1 s), le routeur affiche un écran
// d'attente qui démontait la liste et effaçait la sélection. Ici elle survit au changement de page, de filtre, et au
// rechargement de l'onglet (sessionStorage) : on sélectionne page après page, puis on supprime tout d'un coup.
// Partagée entre l'admin (Catalogue) et la page Catalogue du site (mode sélection de l'admin).
const SEL_KEY = 'sf:admin-selection:v1'
let selection: ReadonlySet<string> = (() => {
  try {
    const v = JSON.parse(sessionStorage.getItem(SEL_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set<string>()
  }
})()
const selSubs = new Set<() => void>()
export function setSelection(next: ReadonlySet<string> | ((s: ReadonlySet<string>) => ReadonlySet<string>)) {
  selection = typeof next === 'function' ? next(selection) : next
  try {
    sessionStorage.setItem(SEL_KEY, JSON.stringify([...selection]))
  } catch {
    /* stockage plein / indisponible : la sélection reste en mémoire */
  }
  selSubs.forEach((l) => l())
}
export function useSelection(): [ReadonlySet<string>, typeof setSelection] {
  const s = useSyncExternalStore(
    (l) => {
      selSubs.add(l)
      return () => void selSubs.delete(l)
    },
    () => selection,
  )
  return [s, setSelection]
}
