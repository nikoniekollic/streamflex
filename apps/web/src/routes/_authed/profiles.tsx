import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Check, LogOut, Pencil, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { PinDialog } from '@/components/profile/PinDialog'
import { ProfileFormDialog, type ProfileFormResult } from '@/components/profile/ProfileFormDialog'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { safeRedirect, validateRedirectSearch } from '@/lib/auth'
import { useSignOut } from '@/lib/profile'
import {
  MAX_PROFILES,
  NEEDS_PIN,
  createProfile,
  deleteProfile,
  setActiveProfileId,
  unlockProfile,
  updateProfile,
  type ViewerProfile,
} from '@/lib/viewer-profiles'

export const Route = createFileRoute('/_authed/profiles')({
  validateSearch: validateRedirectSearch,
  component: WhoIsWatching,
})

type Result = Awaited<ReturnType<typeof unlockProfile>>
type PinRequest = { title: string; description?: string; run: (pin: string) => Promise<Result>; onOk: () => Promise<void> | void }

function WhoIsWatching() {
  const { supabase, user } = Route.useRouteContext()
  const { redirect } = Route.useSearch()
  const { profiles, activeProfile, selectProfile, refreshProfiles } = useActiveProfile()
  const signOut = useSignOut()

  const [manage, setManage] = useState(false)
  const [editing, setEditing] = useState<ViewerProfile | 'new' | null>(null)
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null)

  const target = safeRedirect(redirect === '/profiles' ? undefined : redirect)

  // ── Choix d'un profil (PIN si verrouillé)
  const choose = (p: ViewerProfile) => {
    if (manage) return setEditing(p)
    if (!p.has_pin) return void selectProfile(p.id, target)
    setPinRequest({
      title: `Profil verrouillé : ${p.name}`,
      description: 'Saisis le code PIN pour accéder à ce profil.',
      run: (pin) => unlockProfile(supabase, p.id, pin),
      onOk: () => selectProfile(p.id, target),
    })
  }

  // ── Opération pouvant exiger un PIN (profil protégé ou contrôle parental)
  const withPin = async (op: (pin?: string) => Promise<Result>, onOk: () => Promise<void>, reason: string): Promise<string | null> => {
    const first = await op()
    if (first.ok) {
      await onOk()
      return null
    }
    if (!NEEDS_PIN.has(first.error)) return first.message
    setPinRequest({
      title: 'Code PIN requis',
      description: reason,
      run: (pin) => op(pin),
      onOk,
    })
    return null
  }

  const afterChange = async (msg: string) => {
    setEditing(null)
    await refreshProfiles()
    toast.success(msg)
  }

  const save = async ({ input, newPin }: ProfileFormResult) => {
    if (editing === 'new') {
      return withPin(
        (pin) => createProfile(supabase, input, newPin, pin),
        () => afterChange(`Profil « ${input.name} » créé`),
        'Le contrôle parental est actif : saisis le PIN d’un profil adulte pour créer un profil adulte.',
      )
    }
    const p = editing as ViewerProfile
    return withPin(
      (pin) => updateProfile(supabase, p.id, input, newPin, pin),
      () => afterChange('Profil mis à jour'),
      p.has_pin ? `Saisis le PIN du profil « ${p.name} » (ou un PIN parental).` : 'Saisis un PIN parental pour cette modification.',
    )
  }

  const remove = async () => {
    const p = editing as ViewerProfile
    return withPin(
      (pin) => deleteProfile(supabase, p.id, pin),
      async () => {
        if (activeProfile?.id === p.id) setActiveProfileId(user.id, null)
        await afterChange(`Profil « ${p.name} » supprimé`)
      },
      'Suppression protégée : saisis le PIN du profil ou un PIN parental.',
    )
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-black px-6 py-16">
      <span className="absolute top-5 left-6 text-2xl font-extrabold tracking-tight text-primary md:left-12 md:text-3xl">STREAMFLEX</span>

      <h1 className="mb-10 text-center text-3xl font-medium md:text-5xl">{manage ? 'Gérer les profils' : 'Qui est-ce ?'}</h1>

      <ul className="flex max-w-4xl flex-wrap justify-center gap-6 md:gap-8">
        {profiles.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => choose(p)} className="group flex w-24 flex-col items-center gap-3 outline-none md:w-36" aria-label={manage ? `Modifier ${p.name}` : `Choisir ${p.name}`}>
              <span className="relative">
                <ProfileAvatar
                  name={p.name}
                  avatarUrl={p.avatar_url}
                  isKids={p.is_kids_profile}
                  locked={p.has_pin}
                  className={cn(
                    'size-24 ring-white transition md:size-36',
                    'group-hover:ring-4 group-focus-visible:ring-4',
                    activeProfile?.id === p.id && !manage && 'ring-2',
                  )}
                  textClassName="text-4xl md:text-6xl"
                />
                {manage && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60">
                    <Pencil className="size-8 text-white" />
                  </span>
                )}
              </span>
              <span className="max-w-full truncate text-sm text-neutral-400 transition group-hover:text-white md:text-lg">{p.name}</span>
            </button>
          </li>
        ))}
        {profiles.length < MAX_PROFILES && (
          <li>
            <button type="button" onClick={() => setEditing('new')} className="group flex w-24 flex-col items-center gap-3 outline-none md:w-36">
              <span className="flex size-24 items-center justify-center rounded-md border-2 border-neutral-700 transition group-hover:border-white group-hover:bg-white/10 group-focus-visible:border-white md:size-36">
                <Plus className="size-10 text-neutral-500 transition group-hover:text-white md:size-14" />
              </span>
              <span className="text-sm text-neutral-400 transition group-hover:text-white md:text-lg">Ajouter</span>
            </button>
          </li>
        )}
      </ul>

      <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
        <Button
          variant={manage ? 'default' : 'outline'}
          size="lg"
          className={cn('h-11 px-8 text-base tracking-widest uppercase', !manage && 'border-neutral-500 bg-transparent text-neutral-400 hover:text-white')}
          onClick={() => setManage((m) => !m)}
        >
          {manage ? (
            <>
              <Check /> Terminé
            </>
          ) : (
            'Gérer les profils'
          )}
        </Button>
        <Button variant="ghost" size="lg" className="h-11 text-neutral-400" onClick={() => void signOut()}>
          <LogOut /> Déconnexion
        </Button>
      </div>

      <ProfileFormDialog
        open={editing !== null}
        profile={editing === 'new' ? null : editing}
        canDelete={profiles.length > 1}
        onSubmit={save}
        onDelete={remove}
        onClose={() => setEditing(null)}
      />

      <PinDialog
        open={pinRequest !== null}
        title={pinRequest?.title ?? ''}
        description={pinRequest?.description}
        onClose={() => setPinRequest(null)}
        onSubmit={async (pin) => {
          if (!pinRequest) return null
          const r = await pinRequest.run(pin)
          if (!r.ok) return r.message
          const req = pinRequest
          setPinRequest(null)
          await req.onOk()
          return null
        }}
      />
    </main>
  )
}
