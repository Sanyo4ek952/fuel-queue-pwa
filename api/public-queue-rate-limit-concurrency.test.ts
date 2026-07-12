import { describe, expect, it } from 'vitest'

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const shouldRun =
  process.env.SUPABASE_LOCAL_CONCURRENCY_TEST === '1' &&
  !!supabaseUrl &&
  !!serviceRoleKey &&
  (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost'))

describe('public queue check rate limit concurrency', () => {
  const concurrencyIt = shouldRun ? it : it.skip

  concurrencyIt(
    'allows no more than 10 parallel requests for the same IP hash',
    async () => {
      const localSupabaseUrl = supabaseUrl ?? ''
      const localServiceRoleKey = serviceRoleKey ?? ''
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          fetch(`${localSupabaseUrl}/rest/v1/rpc/check_public_queue_position`, {
            method: 'POST',
            headers: {
              apikey: localServiceRoleKey,
              authorization: `Bearer ${localServiceRoleKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              plate_number: '',
              phone_last4: '',
              client_ip_hash: `pgtap-concurrency-ip-${index - index}`,
            }),
          }).then(async (response) => response.json() as Promise<{ status?: string }>),
        ),
      )

      const allowedCount = responses.filter((response) => response.status !== 'LIMIT_EXCEEDED').length
      const blockedCount = responses.filter((response) => response.status === 'LIMIT_EXCEEDED').length

      expect(allowedCount).toBeLessThanOrEqual(10)
      expect(blockedCount).toBeGreaterThanOrEqual(2)
    },
    20_000,
  )
})
