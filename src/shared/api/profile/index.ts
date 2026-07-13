import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import { USER_ROLES } from '@/shared/config/roles'
import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'
import {
  getCachedCurrentProfile,
  saveCachedCurrentProfile,
} from '@/shared/lib/offline-db'
import { requestProtectedRpcApi } from '@/shared/api/rpc/protected-api'

export type ProfileStation = {
  id: string
  name: string
  address: string | null
}

export type CurrentProfile = {
  id: string
  auth_user_id: string
  email: string | null
  full_name: string
  first_name: string | null
  last_name: string | null
  middle_name: string | null
  phone: string | null
  avatar_url: string | null
  auth_provider: string | null
  position: string | null
  signature_name: string | null
  role: UserRole
  is_active: boolean
  approval_status: ProfileApprovalStatus
  requested_station_id: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  deactivated_by: string | null
  deactivated_at: string | null
  deactivation_reason: string | null
  personal_data_consent_version?: string | null
  personal_data_consented_at?: string | null
  stations: ProfileStation[]
  is_from_cache?: boolean
}

export type ProfileApprovalStatus = 'pending' | 'approved' | 'rejected'

export function isConsumerProfileComplete(profile: Pick<CurrentProfile, 'first_name' | 'last_name' | 'phone'>) {
  return Boolean(profile.first_name?.trim() && profile.last_name?.trim() && profile.phone?.trim())
}

export type ManagedProfile = Omit<CurrentProfile, 'stations'> & {
  requested_station_name: string | null
  approved_by_name: string | null
  rejected_by_name: string | null
  deactivated_by_name: string | null
  created_at: string
  updated_at: string
  stations: ProfileStation[]
}

export type ManagedProfilesSection = 'pending' | 'active' | 'rejected' | 'disabled'

export type ManagedProfilesPage = {
  items: ManagedProfile[]
  totalCount: number
  hasMore: boolean
}

type ProfileRow = {
  id: string
  auth_user_id: string
  email?: string | null
  full_name: string
  first_name: string | null
  last_name: string | null
  middle_name: string | null
  phone?: string | null
  avatar_url?: string | null
  auth_provider?: string | null
  position: string | null
  signature_name: string | null
  role: string
  is_active: boolean
  approval_status: string
  requested_station_id: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  deactivated_by: string | null
  deactivated_at: string | null
  deactivation_reason: string | null
  personal_data_consent_version?: string | null
  personal_data_consented_at?: string | null
}

function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole)
}

function isProfileApprovalStatus(value: string): value is ProfileApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected'
}

function toProfile(value: ProfileRow, stations: ProfileStation[]): CurrentProfile | null {
  if (!isUserRole(value.role) || !isProfileApprovalStatus(value.approval_status)) {
    return null
  }

  return {
    id: value.id,
    auth_user_id: value.auth_user_id,
    email: value.email ?? null,
    full_name: value.full_name,
    first_name: value.first_name,
    last_name: value.last_name,
    middle_name: value.middle_name,
    phone: value.phone ?? null,
    avatar_url: value.avatar_url ?? null,
    auth_provider: value.auth_provider ?? null,
    position: value.position,
    signature_name: value.signature_name,
    role: value.role,
    is_active: value.is_active,
    approval_status: value.approval_status,
    requested_station_id: value.requested_station_id,
    approved_by: value.approved_by,
    approved_at: value.approved_at,
    rejected_by: value.rejected_by,
    rejected_at: value.rejected_at,
    rejection_reason: value.rejection_reason,
    deactivated_by: value.deactivated_by,
    deactivated_at: value.deactivated_at,
    deactivation_reason: value.deactivation_reason,
    personal_data_consent_version: value.personal_data_consent_version ?? null,
    personal_data_consented_at: value.personal_data_consented_at ?? null,
    stations,
  }
}

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  try {
    const profile = await getCurrentProfileViaApi()

    if (profile) {
      await saveCachedCurrentProfile(profile)
    }

    return profile ? { ...profile, is_from_cache: false } : null
  } catch (error) {
    if (!shouldUseCachedCurrentProfile(error)) {
      throw error
    }

    const cachedProfile = await getCachedCurrentProfile()

    if (cachedProfile) {
      return { ...cachedProfile, is_from_cache: true }
    }

    throw error
  }
}

function isProfileStation(value: unknown): value is ProfileStation {
  if (!value || typeof value !== 'object') {
    return false
  }

  const station = value as Partial<ProfileStation>

  return typeof station.id === 'string' && typeof station.name === 'string'
}

function toManagedProfile(value: unknown): ManagedProfile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<ManagedProfile>

  if (
    typeof row.id === 'string' &&
    typeof row.auth_user_id === 'string' &&
    typeof row.full_name === 'string' &&
    typeof row.role === 'string' &&
    typeof row.is_active === 'boolean' &&
    typeof row.approval_status === 'string' &&
    typeof row.created_at === 'string' &&
    typeof row.updated_at === 'string' &&
    isUserRole(row.role) &&
    isProfileApprovalStatus(row.approval_status)
  ) {
    return {
      id: row.id,
      auth_user_id: row.auth_user_id,
      email: row.email ?? null,
      full_name: row.full_name,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      middle_name: row.middle_name ?? null,
      phone: row.phone ?? null,
      avatar_url: row.avatar_url ?? null,
      auth_provider: row.auth_provider ?? null,
      position: row.position ?? null,
      signature_name: row.signature_name ?? null,
      role: row.role,
      is_active: row.is_active,
      approval_status: row.approval_status,
      requested_station_id: row.requested_station_id ?? null,
      requested_station_name: row.requested_station_name ?? null,
      approved_by: row.approved_by ?? null,
      approved_by_name: row.approved_by_name ?? null,
      approved_at: row.approved_at ?? null,
      rejected_by: row.rejected_by ?? null,
      rejected_by_name: row.rejected_by_name ?? null,
      rejected_at: row.rejected_at ?? null,
      rejection_reason: row.rejection_reason ?? null,
      deactivated_by: row.deactivated_by ?? null,
      deactivated_by_name: row.deactivated_by_name ?? null,
      deactivated_at: row.deactivated_at ?? null,
      deactivation_reason: row.deactivation_reason ?? null,
      personal_data_consent_version: row.personal_data_consent_version ?? null,
      personal_data_consented_at: row.personal_data_consented_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stations: Array.isArray(row.stations) ? row.stations.filter(isProfileStation) : [],
    }
  }

  return null
}

class CurrentProfileApiError extends Error {
  statusCode: number | null

  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.statusCode = statusCode
  }
}

function shouldUseCachedCurrentProfile(error: unknown) {
  if (error instanceof CurrentProfileApiError) {
    return error.statusCode === 504 || (error.statusCode !== null && error.statusCode >= 500)
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    return (
      message.includes('timed out') ||
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('load failed')
    )
  }

  return false
}

async function readCurrentProfileApiResponse(response: Response) {
  const value = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'Current profile request failed.'

    throw new CurrentProfileApiError(message, response.status)
  }

  return value
}

async function getCurrentProfileViaApi(): Promise<CurrentProfile | null> {
  const response = await fetchWithTimeout(
    '/api/current-profile',
    {
      credentials: 'same-origin',
    },
    {
      timeoutMs: 8_000,
      timeoutMessage: 'Current profile request timed out.',
    },
  )
  const value = await readCurrentProfileApiResponse(response)

  if (value === null) {
    throw new CurrentProfileApiError('PROFILE_NOT_FOUND', 404)
  }

  if (!value || typeof value !== 'object') {
    throw new CurrentProfileApiError('Unexpected current profile response.')
  }

  const profile = value as ProfileRow & { stations?: ProfileStation[] }

  if (!Array.isArray(profile.stations)) {
    throw new CurrentProfileApiError('Unexpected current profile stations response.')
  }

  const currentProfile = toProfile(profile, profile.stations)

  if (!currentProfile) {
    throw new CurrentProfileApiError('INVALID_CURRENT_PROFILE')
  }

  return currentProfile
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numberValue = Number(value)

    if (Number.isFinite(numberValue)) {
      return numberValue
    }
  }

  return null
}

function toManagedProfilesPage(value: unknown): ManagedProfilesPage | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const page = value as {
    items?: unknown
    total_count?: unknown
    has_more?: unknown
  }
  const totalCount = toNumber(page.total_count)

  if (!Array.isArray(page.items) || totalCount === null || typeof page.has_more !== 'boolean') {
    return null
  }

  return {
    items: page.items.map(toManagedProfile).filter((profile): profile is ManagedProfile => Boolean(profile)),
    totalCount,
    hasMore: page.has_more,
  }
}

export async function listManagedProfiles(params: {
  section: ManagedProfilesSection
  limit: number
  offset: number
}): Promise<ManagedProfilesPage> {
  if (!isSupabaseConfigured) {
    return {
      items: [],
      totalCount: 0,
      hasMore: false,
    }
  }

  const data = await requestProtectedRpcApi(
    '/api/list-managed-profiles',
    {
      section: params.section,
      limit: params.limit,
      offset: params.offset,
    },
    'List managed profiles request failed.',
  )
  const page = toManagedProfilesPage(data)

  if (!page) {
    throw new Error('Unexpected list_managed_profiles_page response.')
  }

  return page
}

export async function approveRegistration(params: {
  profileId: string
  role: UserRole
  stationIds: string[]
}) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  await requestProtectedRpcApi(
    '/api/approve-registration',
    {
      profileId: params.profileId,
      role: params.role,
      stationIds: params.stationIds,
    },
    'Approve registration request failed.',
  )
}

export async function rejectRegistration(params: { profileId: string; reason: string }) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  await requestProtectedRpcApi(
    '/api/reject-registration',
    {
      profileId: params.profileId,
      reason: params.reason,
    },
    'Reject registration request failed.',
  )
}

export async function deactivateProfile(params: { profileId: string; reason: string }) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  await requestProtectedRpcApi(
    '/api/deactivate-profile',
    {
      profileId: params.profileId,
      reason: params.reason,
    },
    'Deactivate profile request failed.',
  )
}

export async function completeCurrentConsumerProfile(params: {
  firstName: string
  lastName: string
  middleName?: string
  phone: string
}): Promise<CurrentProfile> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { supabase } = await import('@/shared/api/supabase')
  const { data, error } = await supabase.rpc('complete_consumer_profile', {
    p_first_name: params.firstName,
    p_last_name: params.lastName,
    p_middle_name: params.middleName ?? null,
    p_phone: params.phone,
  })

  if (error) {
    throw new Error(error.message)
  }

  const profile = data as ProfileRow | null

  if (!profile) {
    throw new Error('PROFILE_NOT_FOUND')
  }

  const currentProfile = toProfile(profile, [])

  if (!currentProfile) {
    throw new Error('INVALID_CURRENT_PROFILE')
  }

  return currentProfile
}
