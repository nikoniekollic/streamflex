// Débridage Alldebrid DEPUIS LE NAVIGATEUR : Alldebrid refuse les IP de serveurs (NO_SERVER),
// pas celles des particuliers. La clé est fournie par resolve-stream aux seuls abonnés actifs.
export type ClientDebrid = { link: string; key: string; agent: string }
export type DebridFailure = 'offline' | 'host_busy' | 'unavailable'

export class DebridClientError extends Error {
  constructor(readonly failure: DebridFailure, readonly code: string) {
    super(code)
  }
}

const API = 'https://api.alldebrid.com/v4'

type Res<T> = { status: 'success' | 'error'; data?: T; error?: { code: string } }

async function call<T>(path: string, d: ClientDebrid, params: Record<string, string>): Promise<T> {
  const url = new URL(API + path)
  url.searchParams.set('agent', d.agent)
  url.searchParams.set('apikey', d.key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let body: Res<T>
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (r.status === 429 || r.status === 503) throw new DebridClientError('host_busy', 'RATE_LIMIT')
    body = (await r.json()) as Res<T>
  } catch (e) {
    if (e instanceof DebridClientError) throw e
    throw new DebridClientError('unavailable', 'NETWORK')
  }
  if (body.status !== 'success' || !body.data) {
    const code = body.error?.code ?? 'UNKNOWN'
    if (/^LINK_DOWN$|^LINK_ERROR$|^LINK_NOT_FOUND|^LINK_TEMPORARY_UNAVAILABLE$/.test(code)) throw new DebridClientError('offline', code)
    if (/^LINK_HOST_(UNAVAILABLE|FULL|LIMIT_REACHED)$|^LINK_TOO_MANY_DOWNLOADS$/.test(code)) throw new DebridClientError('host_busy', code)
    throw new DebridClientError('unavailable', code)
  }
  return body.data
}

/** Lien 1fichier → URL directe lisible par <video>. */
export async function unlockInBrowser(d: ClientDebrid): Promise<{ url: string; ttl: number }> {
  const ttl = 2 * 3600
  const data = await call<{ link?: string; delayed?: number }>('/link/unlock', d, { link: d.link })
  if (data.link) return { url: data.link, ttl }
  if (data.delayed) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5000)) // la doc demande 5 s minimum entre deux interrogations
      const s = await call<{ status: number; link?: string }>('/link/delayed', d, { id: String(data.delayed) })
      if (s.status === 2 && s.link) return { url: s.link, ttl }
      if (s.status === 3) throw new DebridClientError('offline', 'DELAYED_FAILED')
    }
    throw new DebridClientError('host_busy', 'DELAYED_TIMEOUT')
  }
  throw new DebridClientError('unavailable', 'NO_LINK')
}
