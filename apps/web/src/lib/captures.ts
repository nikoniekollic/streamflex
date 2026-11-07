import type { TypedSupabaseClient } from '@/lib/supabase'
import { env } from '@/lib/env'
import { resolveStream } from '@/lib/stream'

export class CaptureError extends Error {
  constructor(readonly kind: 'cors' | 'load' | 'seek' | 'resolve', message: string) {
    super(message)
  }
}

function once(el: HTMLVideoElement, event: string, ms: number, kind: CaptureError['kind']): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new CaptureError(kind, `délai dépassé (${event})`)), ms)
    const ok = () => done()
    const ko = () => done(new CaptureError(kind, `erreur vidéo (${event})`))
    function done(err?: CaptureError) {
      clearTimeout(timer)
      el.removeEventListener(event, ok)
      el.removeEventListener('error', ko)
      err ? reject(err) : resolve()
    }
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', ko, { once: true })
  })
}

/** Image JPEG d'un instant aléatoire (10 % → 80 % de la durée) d'une vidéo accessible en CORS. */
export async function captureFrame(url: string): Promise<Blob> {
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous' // sinon le canvas serait « souillé » et illisible
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  try {
    v.src = url
    await once(v, 'loadedmetadata', 25_000, 'load')
    if (!Number.isFinite(v.duration) || v.duration < 5) throw new CaptureError('load', 'durée inconnue')
    v.currentTime = v.duration * (0.1 + Math.random() * 0.7)
    await once(v, 'seeked', 30_000, 'seek')
    const w = 640
    const h = Math.max(1, Math.round((w * v.videoHeight) / Math.max(1, v.videoWidth)))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(v, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new CaptureError('cors', 'image vide'))), 'image/jpeg', 0.8)
      } catch {
        reject(new CaptureError('cors', "le serveur vidéo n'autorise pas la lecture des images (CORS)"))
      }
    })
  } finally {
    v.removeAttribute('src')
    v.load()
  }
}

export type CaptureTarget = { id: string; title: string }

/** Films sans vraie jaquette (aucune, ou simple image de modèle). */
export async function fetchCaptureTargets(s: TypedSupabaseClient, offset: number, limit = 40): Promise<CaptureTarget[]> {
  const { data, error } = await s
    .from('titles')
    .select('id, title')
    .eq('type', 'movie')
    .or('poster_url.is.null,poster_url.like.%#model')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function countCaptureTargets(s: TypedSupabaseClient): Promise<number> {
  const { count } = await s.from('titles').select('id', { count: 'exact', head: true }).eq('type', 'movie').or('poster_url.is.null,poster_url.like.%#model')
  return count ?? 0
}

/** Résout la vidéo (Alldebrid, navigateur), capture une image, l'envoie dans le bucket « covers » et la définit comme jaquette. */
export async function captureTitle(s: TypedSupabaseClient, profileId: string, target: CaptureTarget): Promise<string> {
  let url: string
  try {
    url = (await resolveStream(s, { profileId, titleId: target.id, episodeId: null, preview: true })).url
  } catch (e) {
    throw new CaptureError('resolve', `source indisponible (${(e as Error).message})`)
  }
  const blob = await captureFrame(url)
  const path = `${target.id}.jpg`
  const up = await s.storage.from('covers').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
  if (up.error) throw new Error(`envoi impossible : ${up.error.message}`)
  const publicUrl = `${env.supabaseUrl}/storage/v1/object/public/covers/${path}?v=${Date.now()}`
  const { error } = await s.from('titles').update({ poster_url: publicUrl }).eq('id', target.id)
  if (error) throw new Error(error.message)
  return publicUrl
}
