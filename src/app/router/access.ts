import type { ProfileWithStations } from '@/entities/profile'
import { canAccessRoute } from '@/shared/lib/permissions'

export type ProtectedRouteState =
  | 'auth-loading'
  | 'redirect-login'
  | 'profile-loading'
  | 'profile-missing'
  | 'profile-inactive'
  | 'forbidden'
  | 'allowed'

type GetProtectedRouteStateParams = {
  authLoading: boolean
  hasSession: boolean
  profileLoading: boolean
  profile?: ProfileWithStations | null
  route: string
}

export function getProtectedRouteState({
  authLoading,
  hasSession,
  profileLoading,
  profile,
  route,
}: GetProtectedRouteStateParams): ProtectedRouteState {
  if (authLoading) {
    return 'auth-loading'
  }

  if (!hasSession) {
    return 'redirect-login'
  }

  if (profileLoading) {
    return 'profile-loading'
  }

  if (!profile) {
    return 'profile-missing'
  }

  if (!profile.is_active) {
    return 'profile-inactive'
  }

  if (!canAccessRoute(profile.role, route)) {
    return 'forbidden'
  }

  return 'allowed'
}
