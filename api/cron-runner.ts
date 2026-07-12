import {
  cleanupUnconfirmedUsers,
  type CleanupUnconfirmedUsersEnv,
} from './cron/_lib/cleanup-unconfirmed-users.js'
import {
  finalizeDailyQueue,
  getPreviousMoscowDate,
} from './cron/_lib/finalize-daily-queue.js'
import { getMoscowDateString, isQueueBackupDate } from './cron/_lib/queue-backup.js'
import { runQueueBackup, type QueueBackupEnv } from './cron/_lib/run-queue-backup.js'

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

type BaseCronEnv = CleanupUnconfirmedUsersEnv & {
  cronSecret: string
}

type BackupCronEnv = QueueBackupEnv & {
  cronSecret: string
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getBaseEnv(): BaseCronEnv {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const cronSecret = process.env.CRON_SECRET

  if (!supabaseUrl || !supabaseServiceRoleKey || !cronSecret) {
    throw new Error('Cron environment is not configured.')
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    cronSecret,
  }
}

function getBackupEnv(): BackupCronEnv {
  const baseEnv = getBaseEnv()
  const googleDriveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  const googleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const googleOAuthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const googleOAuthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  const googleServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const googleServiceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  const hasOAuthCredentials =
    googleOAuthClientId && googleOAuthClientSecret && googleOAuthRefreshToken
  const hasServiceAccountCredentials = googleServiceAccountEmail && googleServiceAccountPrivateKey

  if (!googleDriveFolderId || (!hasOAuthCredentials && !hasServiceAccountCredentials)) {
    throw new Error('Queue backup environment is not configured.')
  }

  return {
    ...baseEnv,
    googleDriveFolderId,
    googleOAuthClientId,
    googleOAuthClientSecret,
    googleOAuthRefreshToken,
    googleServiceAccountEmail,
    googleServiceAccountPrivateKey,
  }
}

function isAuthorized(req: CronRequest, cronSecret: string) {
  return req.headers.authorization === `Bearer ${cronSecret}`
}

function assertMethod(req: CronRequest, res: CronResponse) {
  if (req.method === 'GET' || req.method === 'POST') {
    return true
  }

  res.setHeader('Allow', 'GET, POST')
  res.status(405).json({ error: 'Method not allowed.' })
  return false
}

async function handleBackupQueue(req: CronRequest, res: CronResponse) {
  let env: BackupCronEnv

  try {
    env = getBackupEnv()
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Invalid environment.' })
    return
  }

  if (!isAuthorized(req, env.cronSecret)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  try {
    const requestedDate = firstQueryValue(req.query.date)
    const targetDate = requestedDate && isQueueBackupDate(requestedDate)
      ? requestedDate
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

async function handleFinalizeDailyQueue(req: CronRequest, res: CronResponse) {
  let env: BaseCronEnv

  try {
    env = getBaseEnv()
  } catch {
    res.status(500).json({ error: 'Daily queue finalization environment is not configured.' })
    return
  }

  if (!isAuthorized(req, env.cronSecret)) {
    res.status(401).json({ error: 'Unauthorized.' })
    return
  }

  const requestedDate = firstQueryValue(req.query.date)
  const targetDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : getPreviousMoscowDate()

  try {
    const result = await finalizeDailyQueue({
      env: {
        supabaseUrl: env.supabaseUrl,
        supabaseServiceRoleKey: env.supabaseServiceRoleKey,
      },
      targetDate,
    })

    res.status(200).json({ ok: true, targetDate, result })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Daily queue finalization failed.',
    })
  }
}

async function handleCleanupUnconfirmedUsers(req: CronRequest, res: CronResponse) {
  let env: BaseCronEnv

  try {
    env = getBaseEnv()
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

export default function handler(req: CronRequest, res: CronResponse) {
  if (!assertMethod(req, res)) {
    return
  }

  const job = firstQueryValue(req.query.job)

  if (job === 'backup-queue') {
    return handleBackupQueue(req, res)
  }

  if (job === 'finalize-daily-queue') {
    return handleFinalizeDailyQueue(req, res)
  }

  if (job === 'cleanup-unconfirmed-users') {
    return handleCleanupUnconfirmedUsers(req, res)
  }

  res.status(404).json({ error: 'Cron job not found.' })
}
