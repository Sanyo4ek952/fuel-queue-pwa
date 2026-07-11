import {
  finalizeDailyQueue,
  getPreviousMoscowDate,
} from './_lib/finalize-daily-queue.js'

type CronRequest = {
  method?: string
  headers: { authorization?: string }
  query: Record<string, string | string[] | undefined>
}

type CronResponse = {
  setHeader(name: string, value: string): void
  status(code: number): { json(value: unknown): void }
}

export default async function handler(req: CronRequest, res: CronResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    res.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const cronSecret = process.env.CRON_SECRET

  if (!supabaseUrl || !supabaseServiceRoleKey || !cronSecret) {
    res.status(500).json({ error: 'Daily queue finalization environment is not configured.' })
    return
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  const requestedDate = typeof req.query.date === 'string' ? req.query.date : null
  const targetDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : getPreviousMoscowDate()

  try {
    const result = await finalizeDailyQueue({
      env: { supabaseUrl, supabaseServiceRoleKey },
      targetDate,
    })
    res.status(200).json({ ok: true, targetDate, result })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Daily queue finalization failed.',
    })
  }
}
