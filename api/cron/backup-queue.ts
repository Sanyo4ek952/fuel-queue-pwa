import { getMoscowDateString, isQueueBackupDate } from './_lib/queue-backup.js'
import { runQueueBackup } from './_lib/run-queue-backup.js'

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

type Env = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  cronSecret: string
  googleDriveFolderId: string
  googleOAuthClientId?: string
  googleOAuthClientSecret?: string
  googleOAuthRefreshToken?: string
  googleServiceAccountEmail?: string
  googleServiceAccountPrivateKey?: string
}

function getEnv(): Env {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const cronSecret = process.env.CRON_SECRET
  const googleDriveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  const googleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const googleOAuthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const googleOAuthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  const googleServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const googleServiceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  const hasOAuthCredentials =
    googleOAuthClientId && googleOAuthClientSecret && googleOAuthRefreshToken
  const hasServiceAccountCredentials = googleServiceAccountEmail && googleServiceAccountPrivateKey

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !cronSecret ||
    !googleDriveFolderId ||
    (!hasOAuthCredentials && !hasServiceAccountCredentials)
  ) {
    throw new Error('Queue backup environment is not configured.')
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    cronSecret,
    googleDriveFolderId,
    googleOAuthClientId,
    googleOAuthClientSecret,
    googleOAuthRefreshToken,
    googleServiceAccountEmail,
    googleServiceAccountPrivateKey,
  }
}

function isAuthorized(req: CronRequest, cronSecret: string) {
  const authorization = req.headers.authorization
  const querySecret = typeof req.query.secret === 'string' ? req.query.secret : null

  return authorization === `Bearer ${cronSecret}` || querySecret === cronSecret
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
    const targetDate =
      typeof req.query.date === 'string' && isQueueBackupDate(req.query.date)
        ? req.query.date
        : getMoscowDateString()
    const result = await runQueueBackup({ env, targetDate })

    res.status(200).json({
      ok: true,
      scope: 'date',
      targetDate,
      file: result.file,
      rowsCount: result.rowsCount,
      deletedOldFilesCount: result.deletedOldFilesCount,
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Queue backup failed.',
    })
  }
}
