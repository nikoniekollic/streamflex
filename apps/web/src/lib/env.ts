function required(key: keyof ImportMetaEnv): string {
  const v = import.meta.env[key]
  if (!v) throw new Error(`[env] Missing ${key} — copy .env.example to .env.local`)
  return v
}

const supabaseUrl = required('VITE_SUPABASE_URL')
if (import.meta.env.PROD && !supabaseUrl.startsWith('https://')) {
  throw new Error('[env] VITE_SUPABASE_URL doit être en https en production')
}

export const env = {
  supabaseUrl,
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY'),
  /** Données de démonstration si le catalogue est vide : actives en dev, désactivées en prod sauf VITE_ENABLE_MOCKS=true */
  enableMocks: import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === 'true',
} as const
