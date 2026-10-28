import { z } from 'zod'
import type { AuthError } from '@supabase/supabase-js'

export const loginSchema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    displayName: z.string().trim().min(2, '2 caractères minimum').max(60, '60 caractères maximum'),
    email: z.string().trim().email('Adresse e-mail invalide'),
    password: z
      .string()
      .min(8, '8 caractères minimum')
      .regex(/[A-Za-z]/, 'Au moins une lettre')
      .regex(/\d/, 'Au moins un chiffre'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Les mots de passe ne correspondent pas',
  })
export type RegisterValues = z.infer<typeof registerSchema>

const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  email_not_confirmed: 'Confirme ton adresse e-mail avant de te connecter.',
  user_already_exists: 'Un compte existe déjà avec cet e-mail.',
  email_exists: 'Un compte existe déjà avec cet e-mail.',
  weak_password: 'Mot de passe trop faible.',
  over_request_rate_limit: 'Trop de tentatives. Réessaie dans quelques minutes.',
  over_email_send_rate_limit: "Trop d'e-mails envoyés. Réessaie plus tard.",
  signup_disabled: 'Les inscriptions sont désactivées.',
}

export function authErrorMessage(error: AuthError | Error): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return (code && AUTH_ERRORS[code]) || error.message || 'Une erreur est survenue.'
}

export function safeRedirect(target: string | undefined, fallback = '/'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return fallback
  if (target.startsWith('/login') || target.startsWith('/register')) return fallback
  return target
}

export function validateRedirectSearch(search: Record<string, unknown>): { redirect?: string } {
  return typeof search.redirect === 'string' ? { redirect: search.redirect } : {}
}
