// Jeton signé (HMAC-SHA256) pour le Worker Cloudflare /alldebrid/unlock.
// Le navigateur transporte le jeton mais ne peut ni le lire utilement ni le forger : pas de proxy Alldebrid ouvert.
const enc = new TextEncoder()

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const debridWorkerUrl = () => (Deno.env.get('DEBRID_WORKER_URL') ?? '').replace(/\/+$/, '') || null

export async function signDebridToken(link: string, userId: string, ttlSeconds = 600): Promise<string | null> {
  const secret = Deno.env.get('DEBRID_SIGNING_SECRET')
  if (!secret || secret.length < 32) return null
  const payload = b64url(enc.encode(JSON.stringify({ link, sub: userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))
  return `${payload}.${b64url(sig)}`
}
