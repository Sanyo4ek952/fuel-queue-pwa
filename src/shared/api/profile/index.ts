import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import { USER_ROLES } from '@/shared/config/roles'
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
  role: UserRole
  is_active: boolean
  stations: ProfileStation[]
}

type ProfileRow = {
  id: string
  auth_user_id: string
  full_name: string
  role: string
  is_active: boolean
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

function toProfile(value: ProfileRow, stations: ProfileStation[]): CurrentProfile | null {
  if (!isUserRole(value.role)) {
    return null
  }

  return {
    id: value.id,
    auth_user_id: value.auth_user_id,
    full_name: value.full_name,
    role: value.role,
    is_active: value.is_active,
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
    .select('id, auth_user_id, full_name, role, is_active')
    .eq('auth_user_id', user.id)
    .single<ProfileRow>()

  if (profileError) {
    throw new Error(profileError.message)
  }

  const stations =
    profile.role === 'city_admin' ? await getAllStations() : await getAssignedStations(profile.id)

  return toProfile(profile, stations)
}
