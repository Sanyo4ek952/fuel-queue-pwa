const requestTimeoutMs = 9_000

const profileColumns = [
  'id',
  'auth_user_id',
  'full_name',
  'first_name',
  'last_name',
  'middle_name',
  'position',
  'signature_name',
  'role',
  'is_active',
  'approval_status',
  'requested_station_id',
  'approved_by',
  'approved_at',
  'rejected_by',
  'rejected_at',
  'rejection_reason',
  'deactivated_by',
  'deactivated_at',
  'deactivation_reason',
].join(',')

type VercelRequestLike = {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

type VercelResponseLike = {
  status: (statusCode: number) => VercelResponseLike
  setHeader: (key: string, value: string) => VercelResponseLike
  end: (body: string) => void
}

type SupabaseConfig = {
  url: string | undefined
  anonKey: string | undefined
}

type SupabaseRequestParams = {
  anonKey: string
  accessToken: string
}

type SupabaseError = Error & {
  statusCode?: number
}

type StationRow = {
  id: string
  name: string
  address?: string | null
}

type UserStationRow = {
  stations?: StationRow | StationRow[] | null
}

type ProfileRow = {
  id: string
  role?: string
  approval_status?: string
}

type SupabaseUser = {
  id: string
}

function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseConfig(): SupabaseConfig {
  return {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }
}

function sendJson(response: VercelResponseLike, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

function getAccessToken(request: VercelRequestLike) {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization
  const match = authorization?.match(/^Bearer\s+(.+)$/i)

  return match?.[1] ?? null
}

function getSupabaseErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const body = value as { message?: unknown }

  return typeof body.message === 'string' ? body.message : null
}

function isSupabaseUser(value: unknown): value is SupabaseUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return typeof (value as { id?: unknown }).id === 'string'
}

function getErrorStatusCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return 500
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode

  return Number.isInteger(statusCode) ? Number(statusCode) : 500
}

const userRoles = new Set(['mayor', 'station_manager', 'cashier', 'mayor_assistant', 'consumer'])
const profileApprovalStatuses = new Set(['pending', 'approved', 'rejected'])

function createSupabaseError(message: string, statusCode: number) {
  const error: SupabaseError = new Error(message)

  error.statusCode = statusCode

  return error
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchSupabaseJson(url: string, { anonKey, accessToken }: SupabaseRequestParams) {
  const response = await fetchWithTimeout(url, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
    },
  })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const message = getSupabaseErrorMessage(body) ?? 'Supabase request failed.'
    const error: SupabaseError = new Error(message)

    error.statusCode = response.status
    throw error
  }

  return body
}

function canViewAllStations(role: string | undefined) {
  return role === 'mayor' || role === 'mayor_assistant'
}

function toStation(value: StationRow) {
  return {
    id: value.id,
    name: value.name,
    address: value.address ?? null,
  }
}

function getStationsFromUserStationRows(rows: UserStationRow[]) {
  return rows.flatMap((item) => {
    if (!item.stations) {
      return []
    }

    return Array.isArray(item.stations) ? item.stations.map(toStation) : [toStation(item.stations)]
  })
}

export default async function handler(request: VercelRequestLike, response: VercelResponseLike) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()
  const accessToken = getAccessToken(request)

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  if (!accessToken) {
    sendJson(response, 401, { error: 'Authorization token is required.' })
    return
  }

  try {
    const user = await fetchSupabaseJson(`${url}/auth/v1/user`, { anonKey, accessToken })

    if (!isSupabaseUser(user)) {
      sendJson(response, 401, { error: 'Authorization token is invalid.' })
      return
    }

    const profileQuery = new URL(`${url}/rest/v1/profiles`)
    profileQuery.searchParams.set('select', profileColumns)
    profileQuery.searchParams.set('auth_user_id', `eq.${user.id}`)
    profileQuery.searchParams.set('limit', '1')

    const profiles = await fetchSupabaseJson(profileQuery.toString(), { anonKey, accessToken })
    const profile = Array.isArray(profiles) ? (profiles[0] as ProfileRow | undefined) : null

    if (!profile) {
      throw createSupabaseError('PROFILE_NOT_FOUND', 404)
    }

    if (!profile.role || !userRoles.has(profile.role)) {
      throw createSupabaseError('INVALID_PROFILE_ROLE', 500)
    }

    if (!profile.approval_status || !profileApprovalStatuses.has(profile.approval_status)) {
      throw createSupabaseError('INVALID_PROFILE_APPROVAL_STATUS', 500)
    }

    if (canViewAllStations(profile.role)) {
      const stationsQuery = new URL(`${url}/rest/v1/stations`)
      stationsQuery.searchParams.set('select', 'id,name,address')
      stationsQuery.searchParams.set('is_active', 'eq.true')
      stationsQuery.searchParams.set('order', 'name.asc')

      const stations = await fetchSupabaseJson(stationsQuery.toString(), { anonKey, accessToken })
      sendJson(response, 200, { ...profile, stations: Array.isArray(stations) ? stations.map(toStation) : [] })
      return
    }

    if (profile.role === 'consumer') {
      sendJson(response, 200, { ...profile, stations: [] })
      return
    }

    const assignedStationsQuery = new URL(`${url}/rest/v1/user_stations`)
    assignedStationsQuery.searchParams.set('select', 'stations(id,name,address)')
    assignedStationsQuery.searchParams.set('user_id', `eq.${profile.id}`)

    const assignedStations = await fetchSupabaseJson(assignedStationsQuery.toString(), {
      anonKey,
      accessToken,
    })

    sendJson(response, 200, {
      ...profile,
      stations: Array.isArray(assignedStations) ? getStationsFromUserStationRows(assignedStations) : [],
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(response, 504, { error: 'Supabase request timed out.' })
      return
    }

    sendJson(response, getErrorStatusCode(error), {
      error: error instanceof Error ? error.message : 'Current profile request failed.',
    })
  }
}
