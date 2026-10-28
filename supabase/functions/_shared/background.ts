// Tâche non bloquante après la réponse (Supabase Edge Runtime : EdgeRuntime.waitUntil), sinon attente courte.
type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void }

export function background(task: PromiseLike<unknown>): Promise<void> {
  const p = Promise.resolve(task).then(
    () => undefined,
    (e) => console.error('[background]', e),
  )
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime
  if (rt?.waitUntil) {
    rt.waitUntil(p)
    return Promise.resolve()
  }
  return p
}
