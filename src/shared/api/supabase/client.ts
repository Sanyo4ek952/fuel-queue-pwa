import { createClient } from '@supabase/supabase-js'

import { env, isSupabaseConfigured } from '@/shared/config/env'
import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'

const fallbackSupabaseUrl = 'https://example.supabase.co'
const fallbackSupabaseAnonKey = 'public-anon-key'
const supabaseRequestTimeoutMs = 10_000

function fetchSupabaseWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithTimeout(input, init, {
    timeoutMs: supabaseRequestTimeoutMs,
    timeoutMessage: 'Supabase request timed out.',
  })
}

export const supabase = createClient(
  isSupabaseConfigured ? env.supabaseUrl : fallbackSupabaseUrl,
  isSupabaseConfigured ? env.supabaseAnonKey : fallbackSupabaseAnonKey,
  {
    global: {
      fetch: fetchSupabaseWithTimeout,
    },
  },
)
