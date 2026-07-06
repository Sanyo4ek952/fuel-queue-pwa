import { describe, expect, it } from 'vitest'

import type { ProfileWithStations } from '@/entities/profile'
import { ROUTES } from '@/shared/config/routes'

import { getProtectedRouteState } from './access'

const activeProfile: ProfileWithStations = {
  id: 'profile-id',
  auth_user_id: 'auth-user-id',
  full_name: 'Dev Mayor Assistant',
  first_name: 'Dev',
  last_name: 'Assistant',
  middle_name: null,
  position: 'Mayor Assistant',
  signature_name: 'Dev Mayor Assistant',
  role: 'mayor_assistant',
  is_active: true,
  approval_status: 'approved',
  requested_station_id: null,
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  deactivated_by: null,
  deactivated_at: null,
  deactivation_reason: null,
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

  it('blocks pending profiles before inactive state', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: { ...activeProfile, approval_status: 'pending', is_active: false },
        route: ROUTES.dashboard,
      }),
    ).toBe('profile-pending')
  })

  it('blocks rejected profiles before inactive state', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: { ...activeProfile, approval_status: 'rejected', is_active: false },
        route: ROUTES.dashboard,
      }),
    ).toBe('profile-rejected')
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

  it('blocks reports for mayor assistant', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: activeProfile,
        route: ROUTES.reports,
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

  it('allows reports for mayor', () => {
    expect(
      getProtectedRouteState({
        authLoading: false,
        hasSession: true,
        profileLoading: false,
        profile: { ...activeProfile, role: 'mayor' },
        route: ROUTES.reports,
      }),
    ).toBe('allowed')
  })
})
