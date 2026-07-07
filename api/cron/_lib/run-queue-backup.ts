import {
  buildQueueBackupCsv,
  getQueueBackupFileName,
  type QueueBackupRow,
} from './queue-backup.js'
import {
  cleanupOldQueueBackups,
  getGoogleAccessToken,
  getGoogleAccessTokenByRefreshToken,
  uploadQueueBackupToDrive,
} from './google-drive.js'

export type QueueBackupEnv = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  googleDriveFolderId: string
  googleOAuthClientId?: string
  googleOAuthClientSecret?: string
  googleOAuthRefreshToken?: string
  googleServiceAccountEmail?: string
  googleServiceAccountPrivateKey?: string
}

export type RunQueueBackupResult = {
  targetDate: string | null
  fileName: string
  csv: string
  file: {
    id: string
    name: string
  }
  rowsCount: number
  deletedOldFilesCount: number
}

async function getQueueBackupGoogleAccessToken(env: QueueBackupEnv) {
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

export async function fetchQueueBackupRows({
  env,
  targetDate,
}: {
  env: QueueBackupEnv
  targetDate: string | null
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

export async function runQueueBackup({
  env,
  targetDate,
}: {
  env: QueueBackupEnv
  targetDate: string | null
}): Promise<RunQueueBackupResult> {
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

  return {
    targetDate,
    fileName,
    csv,
    file,
    rowsCount: rows.length,
    deletedOldFilesCount,
  }
}
