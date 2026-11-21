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

// ───── Mode sélection (Sélectionner / Déplacer) : partagé par la barre de sélection et le bouton dossier des jaquettes,
// gardé d'une page à l'autre et au rechargement de l'onglet, comme la sélection elle-même
const MODE_KEY = 'sf:browse-select-mode:v1'
let mode = (() => {
  try {
    return sessionStorage.getItem(MODE_KEY) === '1'
  } catch {
    return false
  }
})()
const modeSubs = new Set<() => void>()
export function setSelectMode(on: boolean) {
  mode = on
  try {
    if (on) sessionStorage.setItem(MODE_KEY, '1')
    else sessionStorage.removeItem(MODE_KEY)
  } catch {
    /* stockage indisponible : le mode reste actif jusqu'au rechargement */
  }
  modeSubs.forEach((l) => l())
}
export function useSelectMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      modeSubs.add(l)
      return () => void modeSubs.delete(l)
    },
    () => mode,
  )
}

// ───── Pages qui savent afficher une sélection (barre « Déplacer / Supprimer ») : le bouton dossier des jaquettes n'apparaît
// que là (sur l'accueil, une vidéo cochée n'aurait nulle part où aller)
let hosts = 0
const hostSubs = new Set<() => void>()
export function addSelectionHost(): () => void {
  hosts++
  hostSubs.forEach((l) => l())
  return () => {
    hosts--
    hostSubs.forEach((l) => l())
  }
}
export function useHasSelectionHost(): boolean {
  return useSyncExternalStore(
    (l) => {
      hostSubs.add(l)
      return () => void hostSubs.delete(l)
    },
    () => hosts > 0,
  )
}
