import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Loader2 } from 'lucide-react'
import { authErrorMessage, loginSchema, safeRedirect, type LoginValues } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { clearAllActiveProfiles } from '@/lib/viewer-profiles'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { authInputClass } from '@/components/auth/styles'

export const Route = createFileRoute('/_guest/login')({
  component: LoginPage,
})

function LoginPage() {
  const { supabase } = Route.useRouteContext()
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginValues) => {
    setError(null)
    const { error } = await supabase.auth.signInWithPassword(values)
    if (error) return setError(authErrorMessage(error))
    clearAllActiveProfiles() // « Qui est-ce ? » obligatoire après connexion
    await router.invalidate()
    router.history.replace(safeRedirect(redirect))
  }

  const pending = form.formState.isSubmitting

  return (
    <Card className="gap-8 border-white/10 bg-black/75 py-10 shadow-2xl backdrop-blur-sm">
      <CardHeader className="px-8 md:px-12">
        <CardTitle className="text-3xl font-bold">S'identifier</CardTitle>
        <CardDescription>Accède à ton catalogue StreamFlex.</CardDescription>
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
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" autoFocus className={authInputClass} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mot de passe</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" className={authInputClass} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="lg" className="mt-2 h-12 text-base font-semibold" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Se connecter
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="px-8 text-sm text-neutral-400 md:px-12">
        Première visite ?&nbsp;
        <Link to="/register" search={{ redirect }} className="font-medium text-white hover:underline">
          Inscris-toi.
        </Link>
      </CardFooter>
    </Card>
  )
}
