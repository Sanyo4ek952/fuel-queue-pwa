import { describe, expect, it } from 'vitest'

import type { ProfileWithStations } from '@/entities/profile'
import { ROUTES } from '@/shared/config/routes'

import { getProtectedRouteState } from './access'

const activeProfile: ProfileWithStations = {
  id: 'profile-id',
  auth_user_id: 'auth-user-id',
  full_name: 'Dev Operator',
  role: 'operator',
  is_active: true,
  stations: [],
}

describe('getProtectedRouteState', () => {
  it('waits while auth is loading', () => {
    expect(
      getProtectedRouteState({
        authLoading: true,
        hasSession: false,
        profileLoading: false,
        profile: null,
        route: ROUTES.dashboard,
      }),
    ).toBe('auth-loading')
  })

  it('redirects unauthenticated users to login', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: false,
        profileLoading: false,
        profile: null,
        route: ROUTES.dashboard,
      }),
    ).toBe('redirect-login')
  })

  it('blocks inactive profiles', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: { ...activeProfile, is_active: false },
        route: ROUTES.dashboard,
      }),
    ).toBe('profile-inactive')
  })

  it('blocks routes that are not available for the role', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: activeProfile,
        route: ROUTES.fueling,
      }),
    ).toBe('forbidden')
  })

  it('allows authenticated active profile with route permission', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: activeProfile,
        route: ROUTES.reservations,
      }),
    ).toBe('allowed')
  })
})
