import {
  cleanupUnconfirmedUsers,
  type CleanupUnconfirmedUsersEnv,
} from './_lib/cleanup-unconfirmed-users.js'

type CronRequest = {
  method?: string
  headers: {
    authorization?: string
  }
  query: Record<string, string | string[] | undefined>
}

type CronResponse = {
  setHeader(name: string, value: string): void
  status(code: number): {
    json(value: unknown): void
  }
}

type Env = CleanupUnconfirmedUsersEnv & {
  cronSecret: string
}

function getEnv(): Env {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const cronSecret = process.env.CRON_SECRET

  if (!supabaseUrl || !supabaseServiceRoleKey || !cronSecret) {
    throw new Error('Unconfirmed users cleanup environment is not configured.')
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    cronSecret,
  }
}

function isAuthorized(req: CronRequest, cronSecret: string) {
  return req.headers.authorization === `Bearer ${cronSecret}`
}

export default async function handler(req: CronRequest, res: CronResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  let env: Env

  try {
    env = getEnv()
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Invalid environment.' })
    return
  }

  if (!isAuthorized(req, env.cronSecret)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  try {
    const result = await cleanupUnconfirmedUsers({ env })

    res.status(200).json({
      ok: true,
      cutoffIso: result.cutoffIso,
      scannedCount: result.scannedCount,
      deletedCount: result.deletedCount,
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unconfirmed users cleanup failed.',
    })
  }
}
