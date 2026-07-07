import { isQueueBackupDate } from './cron/_lib/queue-backup.js'
import { runQueueBackup, type QueueBackupEnv } from './cron/_lib/run-queue-backup.js'

type QueueBackupRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>
}

type QueueBackupResponse = {
  setHeader(name: string, value: string): void
  status(code: number): QueueBackupResponse
  json(value: unknown): void
  end(value?: string | Buffer): void
}

type Env = QueueBackupEnv & {
  supabaseAnonKey: string
}

type SupabaseUserResponse = {
  id?: string
  error?: string
  msg?: string
}

type ProfileRow = {
  role?: string | null
  is_active?: boolean | null
  approval_status?: string | null
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function sendJson(res: QueueBackupResponse, statusCode: number, payload: unknown) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json')
  res.status(statusCode).json(payload)
}

function getBearerToken(req: QueueBackupRequest) {
  const authorization = firstHeaderValue(req.headers.authorization)

  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  return authorization.slice('Bearer '.length).trim() || null
}

async function readBody(req: QueueBackupRequest) {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>
  }

  if (!req[Symbol.asyncIterator]) {
    return {}
  }

  const chunks: Buffer[] = []

  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')

  return rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
}

function getEnv(): Env {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
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
    !supabaseAnonKey ||
    !supabaseServiceRoleKey ||
    !googleDriveFolderId ||
    (!hasOAuthCredentials && !hasServiceAccountCredentials)
  ) {
    throw new Error('Queue backup environment is not configured.')
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    googleDriveFolderId,
    googleOAuthClientId,
    googleOAuthClientSecret,
    googleOAuthRefreshToken,
    googleServiceAccountEmail,
    googleServiceAccountPrivateKey,
  }
}

export function parseQueueBackupTargetDate(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string' || !isQueueBackupDate(value)) {
    throw new Error('Invalid queue backup date.')
  }

  return value
}

async function getUserIdByAccessToken({
  env,
  accessToken,
}: {
  env: Env
  accessToken: string
}) {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const result = (await response.json().catch(() => null)) as SupabaseUserResponse | null

  if (!response.ok || !result?.id) {
    throw new Error(result?.msg ?? result?.error ?? 'Unauthorized.')
  }

  return result.id
}

async function getProfileByAuthUserId({
  env,
  authUserId,
}: {
  env: Env
  authUserId: string
}) {
  const url = new URL(`${env.supabaseUrl}/rest/v1/profiles`)
  url.searchParams.set('select', 'role,is_active,approval_status')
  url.searchParams.set('auth_user_id', `eq.${authUserId}`)
  url.searchParams.set('limit', '1')

  const response = await fetch(url, {
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
  })
  const result = (await response.json().catch(() => null)) as ProfileRow[] | { message?: string } | null

  if (!response.ok || !Array.isArray(result)) {
    throw new Error(
      Array.isArray(result) ? 'Profile lookup failed.' : (result?.message ?? 'Profile lookup failed.'),
    )
  }

  return result[0] ?? null
}

export async function assertCanExportQueueBackup({
  env,
  accessToken,
}: {
  env: Env
  accessToken: string
}) {
  const authUserId = await getUserIdByAccessToken({ env, accessToken })
  const profile = await getProfileByAuthUserId({ env, authUserId })

  if (
    !profile ||
    profile.role !== 'mayor' ||
    profile.is_active !== true ||
    profile.approval_status !== 'approved'
  ) {
    throw new Error('Queue backup access denied.')
  }
}

export default async function handler(req: QueueBackupRequest, res: QueueBackupResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'Method not allowed.' })
    return
  }

  let env: Env

  try {
    env = getEnv()
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Invalid environment.',
    })
    return
  }

  const accessToken = getBearerToken(req)

  if (!accessToken) {
    sendJson(res, 401, { error: 'Unauthorized.' })
    return
  }

  try {
    const body = await readBody(req)
    const targetDate = parseQueueBackupTargetDate(body.targetDate)

    await assertCanExportQueueBackup({ env, accessToken })

    const result = await runQueueBackup({ env, targetDate })

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
    res.status(200).end(result.csv)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Queue backup failed.'
    const statusCode =
      message === 'Unauthorized.'
        ? 401
        : message === 'Queue backup access denied.'
          ? 403
          : message === 'Invalid queue backup date.'
            ? 400
            : 500

    sendJson(res, statusCode, { error: message })
  }
}
