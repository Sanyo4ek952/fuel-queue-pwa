import {
  buildQueueBackupCsv,
  getMoscowDateString,
  getQueueBackupFileName,
  type QueueBackupRow,
} from './_lib/queue-backup.js'
import {
  cleanupOldQueueBackups,
  getGoogleAccessToken,
  getGoogleAccessTokenByRefreshToken,
  uploadQueueBackupToDrive,
} from './_lib/google-drive.js'

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

async function getQueueBackupGoogleAccessToken(env: Env) {
  if (env.googleOAuthClientId && env.googleOAuthClientSecret && env.googleOAuthRefreshToken) {
    return getGoogleAccessTokenByRefreshToken({
      clientId: env.googleOAuthClientId,
      clientSecret: env.googleOAuthClientSecret,
      refreshToken: env.googleOAuthRefreshToken,
    })
  }

  if (env.googleServiceAccountEmail && env.googleServiceAccountPrivateKey) {
    return getGoogleAccessToken({
      clientEmail: env.googleServiceAccountEmail,
      privateKey: env.googleServiceAccountPrivateKey,
    })
  }

  throw new Error('Google Drive credentials are not configured.')
}

async function fetchQueueBackupRows({
  env,
  targetDate,
}: {
  env: Env
  targetDate: string
}) {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/rpc/export_queue_backup`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target_date: targetDate,
    }),
  })
  const result = (await response.json()) as QueueBackupRow[] | { message?: string; error?: string }

  if (!response.ok || !Array.isArray(result)) {
    const error = Array.isArray(result) ? null : (result.message ?? result.error)
    throw new Error(error ?? 'Supabase queue backup export failed.')
  }

  return result
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
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : getMoscowDateString()
    const fileName = getQueueBackupFileName(targetDate)
    const rows = await fetchQueueBackupRows({ env, targetDate })
    const csv = buildQueueBackupCsv(rows)
    const accessToken = await getQueueBackupGoogleAccessToken(env)
    const file = await uploadQueueBackupToDrive({
      accessToken,
      folderId: env.googleDriveFolderId,
      fileName,
      csv,
    })
    const deletedOldFilesCount = await cleanupOldQueueBackups({
      accessToken,
      folderId: env.googleDriveFolderId,
    })

    res.status(200).json({
      ok: true,
      targetDate,
      file,
      rowsCount: rows.length,
      deletedOldFilesCount,
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Queue backup failed.',
    })
  }
}
