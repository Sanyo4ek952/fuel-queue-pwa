import { describe, expect, it } from 'vitest'

import { ROUTES } from '@/shared/config/routes'

import {
  canAccessRoute,
  canCreateDailyLimit,
  canCreateFuelingRecord,
  canCreateManualOverride,
  canCreateReservation,
  canResolveSyncConflict,
  canViewAllStations,
} from './index'

describe('permission helpers', () => {
  it('allows reservation roles to create reservations', () => {
    expect(canCreateReservation('operator')).toBe(true)
    expect(canCreateReservation('shift_supervisor')).toBe(true)
    expect(canCreateReservation('station_admin')).toBe(true)
    expect(canCreateReservation('cashier')).toBe(false)
    expect(canCreateReservation('city_admin')).toBe(false)
    expect(canCreateReservation('viewer')).toBe(false)
  })

  it('allows cashier and station managers to create fueling records', () => {
    expect(canCreateFuelingRecord('cashier')).toBe(true)
    expect(canCreateFuelingRecord('shift_supervisor')).toBe(true)
    expect(canCreateFuelingRecord('station_admin')).toBe(true)
    expect(canCreateFuelingRecord('operator')).toBe(false)
  })

  it('allows only station managers to manage limits and sync conflicts', () => {
    expect(canCreateDailyLimit('shift_supervisor')).toBe(true)
    expect(canCreateDailyLimit('station_admin')).toBe(true)
    expect(canCreateManualOverride('shift_supervisor')).toBe(true)
    expect(canResolveSyncConflict('station_admin')).toBe(true)
    expect(canCreateDailyLimit('city_admin')).toBe(false)
    expect(canResolveSyncConflict('viewer')).toBe(false)
  })

  it('allows city admin to view all stations', () => {
    expect(canViewAllStations('city_admin')).toBe(true)
    expect(canViewAllStations('station_admin')).toBe(false)
  })

  it('guards application routes by role', () => {
    expect(canAccessRoute('operator', ROUTES.reservations)).toBe(true)
    expect(canAccessRoute('cashier', ROUTES.fueling)).toBe(true)
    expect(canAccessRoute('cashier', ROUTES.reservations)).toBe(false)
    expect(canAccessRoute('city_admin', ROUTES.limits)).toBe(false)
    expect(canAccessRoute('station_admin', ROUTES.users)).toBe(true)
    expect(canAccessRoute('city_admin', ROUTES.users)).toBe(true)
    expect(canAccessRoute('viewer', ROUTES.users)).toBe(false)
  })
})
