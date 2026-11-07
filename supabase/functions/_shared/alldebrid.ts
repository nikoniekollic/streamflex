// Client Alldebrid côté serveur uniquement (clé jamais exposée au navigateur).
// Doc : https://docs.alldebrid.com/ — GET /v4/link/unlock (+ /v4/link/delayed)

import { getSecret } from './secrets.ts'

const API = 'https://api.alldebrid.com/v4'
const TIMEOUT_MS = 12_000

export type DebridFailure =
  | 'offline' // fichier supprimé / indisponible chez l'hébergeur
  | 'unsupported' // hébergeur non pris en charge
  | 'protected' // lien protégé par mot de passe
  | 'host_busy' // hébergeur saturé / limite atteinte (temporaire)
  | 'auth' // clé invalide / compte bloqué / non premium
  | 'server_blocked' // IP serveur/VPN refusée par Alldebrid (NO_SERVER)
  | 'unavailable' // API injoignable / timeout / 5xx
  | 'unknown'

export class DebridError extends Error {
  constructor(
    readonly failure: DebridFailure,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
  get retryable() {
    return this.failure === 'unavailable' || this.failure === 'host_busy'
  }
}

const CODE_MAP: [RegExp, DebridFailure][] = [
  [/^LINK_DOWN$|^LINK_ERROR$|^LINK_NOT_FOUND|^LINK_TEMPORARY_UNAVAILABLE$/, 'offline'],
  [/^LINK_HOST_NOT_SUPPORTED$|^LINK_IS_MISSING$|^LINK_INVALID/, 'unsupported'],
  [/^LINK_PASS_PROTECTED$/, 'protected'],
  [/^LINK_HOST_(UNAVAILABLE|FULL|LIMIT_REACHED)$|^LINK_TOO_MANY_DOWNLOADS$|^DELAYED/, 'host_busy'],
  [/^AUTH_|^MUST_BE_PREMIUM$|^FREE_TRIAL_LIMIT_REACHED$|^PIN_/, 'auth'],
  [/^NO_SERVER$|^VPN/, 'server_blocked'],
  [/^MAINTENANCE$|^GENERIC$/, 'unavailable'],
]

function classify(code: string): DebridFailure {
  return CODE_MAP.find(([re]) => re.test(code))?.[1] ?? 'unknown'
}

type AdResponse<T> = { status: 'success' | 'error'; data?: T; error?: { code: string; message: string } }
type AdUnlock = { link?: string; filename?: string; filesize?: number; host?: string; delayed?: number; id?: string }
type AdDelayed = { status: 1 | 2 | 3; link?: string; time_left?: number }

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const [KEY, AGENT] = await Promise.all([getSecret('ALLDEBRID_API_KEY'), getSecret('ALLDEBRID_AGENT')])
  if (!KEY) throw new DebridError('auth', 'MISSING_KEY', 'ALLDEBRID_API_KEY non configurée')
  const url = new URL(`${API}${path}`)
  url.searchParams.set('agent', AGENT ?? 'streamflex')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    throw new DebridError('unavailable', 'NETWORK', `Alldebrid injoignable : ${(e as Error).name}`)
  }
  if (res.status >= 500) throw new DebridError('unavailable', `HTTP_${res.status}`, `Alldebrid HTTP ${res.status}`)

  let body: AdResponse<T>
  try {
    body = await res.json()
  } catch {
    throw new DebridError('unavailable', 'BAD_JSON', 'Réponse Alldebrid illisible')
  }
  if (body.status !== 'success' || !body.data) {
    const code = body.error?.code ?? `HTTP_${res.status}`
    throw new DebridError(classify(code), code, body.error?.message ?? 'Erreur Alldebrid')
  }
  return body.data
}

export type Unlocked = { url: string; filename?: string; filesize?: number; host?: string; ttl: number }

/** Débride un lien hébergeur (1fichier, etc.) → URL directe streamable. */
export async function unlock(link: string, { attempts = 2 } = {}): Promise<Unlocked> {
  let last: DebridError | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      const data = await call<AdUnlock>('/link/unlock', { link })
      if (data.link) return { url: data.link, filename: data.filename, filesize: data.filesize, host: data.host, ttl: 2 * 3600 }
      if (data.delayed) {
        for (let n = 0; n < 8; n++) {
          await new Promise((r) => setTimeout(r, 2000))
          const d = await call<AdDelayed>('/link/delayed', { id: String(data.delayed) })
          if (d.status === 2 && d.link) return { url: d.link, filename: data.filename, filesize: data.filesize, host: data.host, ttl: 2 * 3600 }
          if (d.status === 3) throw new DebridError('offline', 'DELAYED_FAILED', 'Génération du lien échouée')
        }
        throw new DebridError('host_busy', 'DELAYED_TIMEOUT', 'Lien toujours en préparation')
      }
      throw new DebridError('unknown', 'NO_LINK', 'Aucun lien renvoyé')
    } catch (e) {
      last = e instanceof DebridError ? e : new DebridError('unknown', 'EXCEPTION', String(e))
      if (!last.retryable || i === attempts - 1) break
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw last!
}

// Hébergeurs reconnus (détection de l'origine d'une URL brute)
const DEBRID_HOSTS = [
  /(^|\.)1fichier\.com$/, /(^|\.)alterupload\.com$/, /(^|\.)cjoint\.net$/, /(^|\.)desfichiers\.com$/,
  /(^|\.)dfichiers\.com$/, /(^|\.)megadl\.fr$/, /(^|\.)mesfichiers\.org$/, /(^|\.)piecejointe\.net$/,
  /(^|\.)pjointe\.com$/, /(^|\.)tenvoi\.com$/, /(^|\.)dl4free\.com$/,
  /(^|\.)uptobox\.(com|eu)$/, /(^|\.)rapidgator\.net$/, /(^|\.)turbobit\.net$/, /(^|\.)nitroflare\.com$/,
  /(^|\.)uploaded\.net$/, /(^|\.)mega\.nz$/, /(^|\.)mediafire\.com$/, /(^|\.)katfile\.com$/,
]

export function isDebridHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return DEBRID_HOSTS.some((re) => re.test(host))
  } catch {
    return false
  }
}

export const DEBRID_MESSAGES: Record<DebridFailure, string> = {
  offline: 'Le fichier est hors ligne ou a été supprimé chez l’hébergeur.',
  unsupported: 'Cet hébergeur n’est pas pris en charge par Alldebrid.',
  protected: 'Le lien est protégé par un mot de passe.',
  host_busy: 'L’hébergeur est temporairement saturé.',
  auth: 'Compte Alldebrid invalide, expiré ou non premium.',
  server_blocked: 'Alldebrid refuse les requêtes depuis ce serveur (IP datacenter/VPN).',
  unavailable: 'Le service Alldebrid est injoignable.',
  unknown: 'Erreur de débridage inconnue.',
}
