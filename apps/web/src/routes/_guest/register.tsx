import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Loader2, MailCheck } from 'lucide-react'
import { authErrorMessage, registerSchema, safeRedirect, type RegisterValues } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { clearAllActiveProfiles } from '@/lib/viewer-profiles'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { authInputClass } from '@/components/auth/styles'

export const Route = createFileRoute('/_guest/register')({
  component: RegisterPage,
})

const FIELDS = [
  { name: 'displayName', label: 'Nom affiché', type: 'text', autoComplete: 'nickname' },
  { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
  { name: 'password', label: 'Mot de passe', type: 'password', autoComplete: 'new-password' },
  { name: 'confirmPassword', label: 'Confirmer le mot de passe', type: 'password', autoComplete: 'new-password' },
] as const

function RegisterPage() {
  const { supabase } = Route.useRouteContext()
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  })

  const onSubmit = async ({ displayName, email, password }: RegisterValues) => {
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: displayName },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })
    if (error) return setError(authErrorMessage(error))
    if (data.user && data.user.identities?.length === 0) return setError('Un compte existe déjà avec cet e-mail.')
    if (!data.session) return setPendingEmail(email)
    clearAllActiveProfiles() // « Qui est-ce ? » obligatoire après connexion
    await router.invalidate()
    router.history.replace(safeRedirect(redirect))
  }

  const pending = form.formState.isSubmitting

  if (pendingEmail) {
    return (
      <Card className="border-white/10 bg-black/75 py-10 shadow-2xl backdrop-blur-sm">
        <CardContent className="grid gap-6 px-8 md:px-12">
          <Alert className="border-white/10 bg-white/5">
            <MailCheck />
            <AlertTitle>Vérifie ta boîte mail</AlertTitle>
            <AlertDescription>
              Un lien de confirmation a été envoyé à <strong className="text-white">{pendingEmail}</strong>.
            </AlertDescription>
          </Alert>
          <Button asChild variant="secondary" size="lg" className="h-12">
            <Link to="/login" search={{ redirect }}>
              Retour à la connexion
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="gap-8 border-white/10 bg-black/75 py-10 shadow-2xl backdrop-blur-sm">
      <CardHeader className="px-8 md:px-12">
        <CardTitle className="text-3xl font-bold">Créer un compte</CardTitle>
        <CardDescription>Films et séries en illimité.</CardDescription>
      </CardHeader>
      <CardContent className="px-8 md:px-12">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
            {error && (
              <Alert variant="destructive" className="border-primary/40 bg-primary/10">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {FIELDS.map((f, i) => (
              <FormField
                key={f.name}
                control={form.control}
                name={f.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{f.label}</FormLabel>
                    <FormControl>
                      <Input
                        type={f.type}
                        autoComplete={f.autoComplete}
                        autoFocus={i === 0}
                        className={authInputClass}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <Button type="submit" size="lg" className="mt-2 h-12 text-base font-semibold" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} S'inscrire
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="px-8 text-sm text-neutral-400 md:px-12">
        Déjà inscrit ?&nbsp;
        <Link to="/login" search={{ redirect }} className="font-medium text-white hover:underline">
          Connecte-toi.
        </Link>
      </CardFooter>
    </Card>
  )
}
