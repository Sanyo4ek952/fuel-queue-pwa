export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  appEnv: import.meta.env.VITE_APP_ENV ?? 'development',
  appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
} as const

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
