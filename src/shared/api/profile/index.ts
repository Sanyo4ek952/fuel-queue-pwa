import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import { USER_ROLES } from '@/shared/config/roles'
import { canViewAllStations } from '@/shared/lib/permissions'
import { supabase } from '@/shared/api/supabase'

export type ProfileStation = {
  id: string
  name: string
  address: string | null
}

export type CurrentProfile = {
  id: string
  auth_user_id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  middle_name: string | null
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
  stations: ProfileStation[]
}

export type ProfileApprovalStatus = 'pending' | 'approved' | 'rejected'

export type ManagedProfile = Omit<CurrentProfile, 'stations'> & {
  requested_station_name: string | null
  approved_by_name: string | null
  rejected_by_name: string | null
  deactivated_by_name: string | null
  created_at: string
  updated_at: string
  stations: ProfileStation[]
}

type ProfileRow = {
  id: string
  auth_user_id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  middle_name: string | null
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
}

type StationRow = {
  id: string
  name: string
  address: string | null
}

type UserStationRow = {
  stations?: StationRow | StationRow[] | null
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
    full_name: value.full_name,
    first_name: value.first_name,
    last_name: value.last_name,
    middle_name: value.middle_name,
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
    stations,
  }
}

function toStation(value: StationRow): ProfileStation {
  return {
    id: value.id,
    name: value.name,
    address: value.address,
  }
}

async function getAllStations(): Promise<ProfileStation[]> {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, address')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map(toStation)
}

async function getAssignedStations(profileId: string): Promise<ProfileStation[]> {
  const { data, error } = await supabase
    .from('user_stations')
    .select('stations(id, name, address)')
    .eq('user_id', profileId)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? [])
    .flatMap((item: UserStationRow) => {
      if (!item.stations) {
        return []
      }

      return Array.isArray(item.stations) ? item.stations : [item.stations]
    })
    .map(toStation)
}

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw new Error(userError.message)
  }

  if (!user) {
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(
      [
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
      ].join(', '),
    )
    .eq('auth_user_id', user.id)
    .maybeSingle<ProfileRow>()

  if (profileError) {
    throw new Error(profileError.message)
  }

  if (!profile) {
    return null
  }

  const stations = isUserRole(profile.role) && canViewAllStations(profile.role)
    ? await getAllStations()
    : await getAssignedStations(profile.id)

  return toProfile(profile, stations)
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
      full_name: row.full_name,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      middle_name: row.middle_name ?? null,
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
      created_at: row.created_at,
      updated_at: row.updated_at,
      stations: Array.isArray(row.stations) ? row.stations.filter(isProfileStation) : [],
    }
  }

  return null
}

export async function listManagedProfiles(): Promise<ManagedProfile[]> {
  if (!isSupabaseConfigured) {
    return []
  }

  const { data, error } = await supabase.rpc('list_managed_profiles')

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data)) {
    throw new Error('Unexpected list_managed_profiles response.')
  }

  return data.map(toManagedProfile).filter((profile): profile is ManagedProfile => Boolean(profile))
}

export async function approveRegistration(params: {
  profileId: string
  role: UserRole
  stationIds: string[]
}) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.rpc('approve_registration', {
    target_profile_id: params.profileId,
    target_role: params.role,
    target_station_ids: params.stationIds,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function rejectRegistration(params: { profileId: string; reason: string }) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.rpc('reject_registration', {
    target_profile_id: params.profileId,
    reason: params.reason,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function deactivateProfile(params: { profileId: string; reason: string }) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.rpc('deactivate_profile', {
    target_profile_id: params.profileId,
    reason: params.reason,
  })

  if (error) {
    throw new Error(error.message)
  }
}
