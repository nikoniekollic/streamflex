import { useState } from 'react'
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { AlertCircle, Heart, History, Loader2, LogOut, MonitorSmartphone, Save, ShieldCheck } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubscriptionCard } from '@/components/profile/SubscriptionCard'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { getMyProfile, initials, profileSchema, toFormValues, updateMyProfile, useSignOut, type ProfileValues } from '@/lib/profile'

export const Route = createFileRoute('/_authed/_shell/profile')({
  beforeLoad: ({ context }) => {
    if (context.isKids) throw redirect({ to: '/', replace: true }) // compte inaccessible aux profils enfants
  },
  loader: ({ context }) => getMyProfile(context.supabase, context.user.id),
  staleTime: 0,
  component: ProfilePage,
})

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })

function ProfilePage() {
  const profile = Route.useLoaderData()
  const { supabase, user, isAdmin } = Route.useRouteContext()
  const router = useRouter()
  const signOut = useSignOut()
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState<'local' | 'global' | null>(null)

  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: toFormValues(profile) })
  const [displayName, avatarUrl] = useWatch({ control: form.control, name: ['display_name', 'avatar_url'] })
  const previewUrl = /^https:\/\/\S+$/i.test(avatarUrl) ? avatarUrl : undefined
  const fallback = initials(displayName, user.email ?? '?')

  const onSubmit = async (values: ProfileValues) => {
    setError(null)
    try {
      const saved = await updateMyProfile(supabase, user.id, values)
      form.reset(toFormValues(saved))
      await router.invalidate()
      toast.success('Profil mis à jour')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const doSignOut = async (scope: 'local' | 'global') => {
    setSigningOut(scope)
    try {
      await signOut(scope)
    } catch (e) {
      setSigningOut(null)
      toast.error('Déconnexion impossible', { description: (e as Error).message })
    }
  }

  const pending = form.formState.isSubmitting

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-10 md:px-8 lg:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-6">
        {/* ───── Identité */}
        <Card className="items-center text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <Avatar className="size-28 rounded-xl text-3xl">
              {previewUrl && <AvatarImage src={previewUrl} alt="Avatar" />}
              <AvatarFallback className="rounded-xl bg-primary font-bold text-primary-foreground">{fallback}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-xl font-semibold">{displayName || user.email}</p>
              {profile?.username && <p className="text-sm text-muted-foreground">@{profile.username}</p>}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {isAdmin && (
                <Badge>
                  <ShieldCheck /> Admin
                </Badge>
              )}
              {profile?.created_at && (
                <Badge variant="outline">Membre depuis le {dateFmt.format(new Date(profile.created_at))}</Badge>
              )}
            </div>
            <div className="flex gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link to="/my-list">
                  <Heart /> Ma liste
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/history">
                  <History /> Historique
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <SubscriptionCard />

        {/* ───── Session */}
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Connecté en tant que {user.email}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button variant="destructive" onClick={() => void doSignOut('local')} disabled={!!signingOut}>
              {signingOut === 'local' ? <Loader2 className="animate-spin" /> : <LogOut />} Se déconnecter
            </Button>
            <Button variant="outline" onClick={() => void doSignOut('global')} disabled={!!signingOut}>
              {signingOut === 'global' ? <Loader2 className="animate-spin" /> : <MonitorSmartphone />} Déconnecter tous les appareils
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ───── Formulaire */}
      <Card>
        <CardHeader>
          <CardTitle>Informations personnelles</CardTitle>
          <CardDescription>Ces informations sont visibles uniquement par toi.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-6">
            <CardContent className="grid gap-5">
              {!profile && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>Profil introuvable — il est normalement créé à l'inscription.</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-2">
                <Label htmlFor="profile-email">E-mail</Label>
                <Input id="profile-email" value={user.email ?? ''} disabled readOnly />
                <p className="text-sm text-muted-foreground">L'adresse de connexion ne peut pas être modifiée ici.</p>
              </div>
              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom affiché</FormLabel>
                    <FormControl>
                      <Input autoComplete="nickname" placeholder="Ton nom" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom d'utilisateur</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                        <Input autoComplete="username" placeholder="pseudo_42" className="pl-7" {...field} />
                      </div>
                    </FormControl>
                    <FormDescription>Unique. 3 à 30 caractères : lettres, chiffres et _.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="avatar_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL de l'avatar</FormLabel>
                    <FormControl>
                      <Input type="url" inputMode="url" placeholder="https://…" {...field} />
                    </FormControl>
                    <FormDescription>Image carrée recommandée. L'aperçu se met à jour en direct.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="justify-end gap-2 border-t pt-6">
              <Button type="button" variant="outline" disabled={!form.formState.isDirty || pending} onClick={() => form.reset()}>
                Annuler
              </Button>
              <Button type="submit" disabled={!form.formState.isDirty || pending || !profile}>
                {pending ? <Loader2 className="animate-spin" /> : <Save />} Enregistrer
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
