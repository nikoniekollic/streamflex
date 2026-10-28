// Client Redis serveur (Edge Functions) — deux drivers, choisis automatiquement :
//   1. REDIS_URL (redis:// ou rediss://)        → ioredis (TCP, connexion réutilisée par instance chaude)
//   2. UPSTASH_REDIS_REST_URL + _TOKEN          → REST Upstash (HTTP, idéal en edge/serverless)
// Sans configuration : no-op (l'application fonctionne sans cache). Toute erreur Redis = cache miss.
import { getSecret } from './secrets.ts'

type Driver = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl: number): Promise<void>
  del(...keys: string[]): Promise<void>
  incr(key: string): Promise<number | null>
}

const OP_TIMEOUT_MS = 800

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), OP_TIMEOUT_MS))]).catch(() => fallback)
}

// ───────── Driver ioredis
// deno-lint-ignore no-explicit-any
let ioredisClient: any = null
async function ioredisDriver(url: string): Promise<Driver> {
  if (!ioredisClient) {
    const { default: Redis } = await import('npm:ioredis@5.4.1')
    ioredisClient = new Redis(url, {
      lazyConnect: false,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (n: number) => (n > 3 ? null : 200 * n),
    })
    ioredisClient.on('error', () => {}) // erreurs gérées par appel
  }
  const c = ioredisClient
  return {
    get: (k) => withTimeout(c.get(k), null),
    set: async (k, v, ttl) => void (await withTimeout(c.set(k, v, 'EX', ttl), null)),
    del: async (...k) => void (await withTimeout(c.del(...k), 0)),
    incr: (k) => withTimeout(c.incr(k), null),
  }
}

// ───────── Driver Upstash REST
function upstashDriver(url: string, token: string): Driver {
  const cmd = async <T>(...args: (string | number)[]): Promise<T | null> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(OP_TIMEOUT_MS * 2),
      })
      if (!res.ok) return null
      const { result } = (await res.json()) as { result: T }
      return result ?? null
    } catch {
      return null
    }
  }
  return {
    get: (k) => cmd<string>('GET', k),
    set: async (k, v, ttl) => void (await cmd('SET', k, v, 'EX', ttl)),
    del: async (...k) => void (k.length && (await cmd('DEL', ...k))),
    incr: (k) => cmd<number>('INCR', k),
  }
}

const noop: Driver = { get: async () => null, set: async () => {}, del: async () => {}, incr: async () => null }

let driverPromise: Promise<Driver> | null = null
let driverAt = 0

function driver(): Promise<Driver> {
  // ré-évalue la config toutes les 5 min (clés modifiées dans /admin/security)
  if (!driverPromise || Date.now() - driverAt > 5 * 60_000) {
    driverAt = Date.now()
    driverPromise = (async () => {
      const [redisUrl, restUrl, restToken] = await Promise.all([
        getSecret('REDIS_URL'),
        getSecret('UPSTASH_REDIS_REST_URL'),
        getSecret('UPSTASH_REDIS_REST_TOKEN'),
      ])
      try {
        if (redisUrl) return await ioredisDriver(redisUrl)
      } catch (e) {
        console.error('[redis] ioredis indisponible, repli REST/no-op', e)
      }
      if (restUrl && restToken) return upstashDriver(restUrl, restToken)
      return noop
    })()
  }
  return driverPromise
}

export const cache = {
  async enabled(): Promise<boolean> {
    return (await driver()) !== noop
  },
  async get<T>(key: string): Promise<T | null> {
    const raw = await (await driver()).get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await (await driver()).set(key, JSON.stringify(value), Math.max(60, Math.floor(ttlSeconds)))
  },
  async del(...keys: string[]): Promise<void> {
    await (await driver()).del(...keys)
  },
  async getRaw(key: string): Promise<string | null> {
    return (await driver()).get(key)
  },
  async incr(key: string): Promise<number | null> {
    return (await driver()).incr(key)
  },
}
