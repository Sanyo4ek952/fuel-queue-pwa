export type CleanupUnconfirmedUsersEnv = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
}

export type CleanupUnconfirmedUsersResult = {
  scannedCount: number
  deletedCount: number
  cutoffIso: string
  deletedUserIds: string[]
}

type AuthUser = {
  id?: unknown
  created_at?: unknown
  email_confirmed_at?: unknown
}

type ListUsersResponse = {
  users?: unknown
}

const pageSize = 1000
const unconfirmedMaxAgeMs = 24 * 60 * 60 * 1000

function normalizeSupabaseUrl(url: string) {
  return url.replace(/\/+$/, '')
}

function getErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const body = value as { message?: unknown; error?: unknown; msg?: unknown }

  if (typeof body.message === 'string') {
    return body.message
  }

  if (typeof body.error === 'string') {
    return body.error
  }

  return typeof body.msg === 'string' ? body.msg : null
}

function isAuthUser(value: unknown): value is AuthUser {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isDeletionCandidate(user: AuthUser, cutoff: Date) {
  if (typeof user.id !== 'string' || typeof user.created_at !== 'string') {
    return false
  }

  if (user.email_confirmed_at !== null) {
    return false
  }

  const createdAt = new Date(user.created_at)

  return Number.isFinite(createdAt.getTime()) && createdAt < cutoff
}

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(getErrorMessage(body) ?? 'Supabase Admin Auth request failed.')
  }

  return body
}

async function listAuthUsers({
  env,
  page,
}: {
  env: CleanupUnconfirmedUsersEnv
  page: number
}) {
  const url = new URL(`${normalizeSupabaseUrl(env.supabaseUrl)}/auth/v1/admin/users`)

  url.searchParams.set('page', String(page))
  url.searchParams.set('per_page', String(pageSize))

  const body = (await fetchJson(url.toString(), {
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
  })) as ListUsersResponse | unknown[]

  const users = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && !Array.isArray(body)
      ? (body as ListUsersResponse).users
      : null

  if (!Array.isArray(users)) {
    throw new Error('Supabase Admin Auth users response is invalid.')
  }

  return users.filter(isAuthUser)
}

async function deleteAuthUser({
  env,
  userId,
}: {
  env: CleanupUnconfirmedUsersEnv
  userId: string
}) {
  await fetchJson(`${normalizeSupabaseUrl(env.supabaseUrl)}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    },
  })
}

export async function cleanupUnconfirmedUsers({
  env,
  now = new Date(),
}: {
  env: CleanupUnconfirmedUsersEnv
  now?: Date
}): Promise<CleanupUnconfirmedUsersResult> {
  const cutoff = new Date(now.getTime() - unconfirmedMaxAgeMs)
  const deletedUserIds: string[] = []
  let scannedCount = 0
  let page = 1

  while (true) {
    const users = await listAuthUsers({ env, page })

    scannedCount += users.length

    for (const user of users) {
      const userId = typeof user.id === 'string' ? user.id : null

      if (!userId || !isDeletionCandidate(user, cutoff)) {
        continue
      }

      await deleteAuthUser({ env, userId })
      deletedUserIds.push(userId)
    }

    if (users.length < pageSize) {
      break
    }

    page += 1
  }

  return {
    scannedCount,
    deletedCount: deletedUserIds.length,
    cutoffIso: cutoff.toISOString(),
    deletedUserIds,
  }
}
