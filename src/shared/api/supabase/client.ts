import { createClient } from '@supabase/supabase-js'

import { env, isSupabaseConfigured } from '@/shared/config/env'

const fallbackSupabaseUrl = 'https://example.supabase.co'
const fallbackSupabaseAnonKey = 'public-anon-key'

export const supabase = createClient(
  isSupabaseConfigured ? env.supabaseUrl : fallbackSupabaseUrl,
  isSupabaseConfigured ? env.supabaseAnonKey : fallbackSupabaseAnonKey,
)
