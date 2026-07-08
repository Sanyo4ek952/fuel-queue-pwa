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
  it('allows mayor, station manager and mayor assistant to create reservations', () => {
    expect(canCreateReservation('mayor')).toBe(true)
    expect(canCreateReservation('station_manager')).toBe(true)
    expect(canCreateReservation('mayor_assistant')).toBe(true)
    expect(canCreateReservation('cashier')).toBe(false)
  })

  it('allows cashier and full-access roles to create fueling records', () => {
    expect(canCreateFuelingRecord('mayor')).toBe(true)
    expect(canCreateFuelingRecord('station_manager')).toBe(true)
    expect(canCreateFuelingRecord('cashier')).toBe(true)
    expect(canCreateFuelingRecord('mayor_assistant')).toBe(false)
  })

  it('allows mayor to manage daily limits and station managers to manage operational exceptions', () => {
    expect(canCreateDailyLimit('mayor')).toBe(true)
    expect(canCreateDailyLimit('station_manager')).toBe(false)
    expect(canCreateDailyLimit('mayor_assistant')).toBe(false)
    expect(canCreateManualOverride('station_manager')).toBe(true)
    expect(canResolveSyncConflict('mayor')).toBe(true)
    expect(canResolveSyncConflict('cashier')).toBe(false)
    expect(canResolveSyncConflict('mayor_assistant')).toBe(false)
  })

  it('allows mayor staff to view all stations', () => {
    expect(canViewAllStations('mayor')).toBe(true)
    expect(canViewAllStations('mayor_assistant')).toBe(true)
    expect(canViewAllStations('station_manager')).toBe(false)
  })

  it('guards application routes by role', () => {
    expect(canAccessRoute('mayor_assistant', ROUTES.reservations)).toBe(true)
    expect(canAccessRoute('cashier', ROUTES.check)).toBe(true)
    expect(canAccessRoute('cashier', ROUTES.fueling)).toBe(true)
    expect(canAccessRoute('cashier', ROUTES.reservations)).toBe(false)
    expect(canAccessRoute('station_manager', ROUTES.limits)).toBe(true)
    expect(canAccessRoute('station_manager', ROUTES.users)).toBe(true)
    expect(canAccessRoute('mayor', ROUTES.users)).toBe(true)
    expect(canAccessRoute('mayor_assistant', ROUTES.users)).toBe(false)
    expect(canAccessRoute('mayor', ROUTES.preferentialQueues)).toBe(true)
    expect(canAccessRoute('station_manager', ROUTES.preferentialQueues)).toBe(false)
    expect(canAccessRoute('cashier', ROUTES.preferentialQueues)).toBe(false)
    expect(canAccessRoute('mayor_assistant', ROUTES.preferentialQueues)).toBe(false)
    expect(canAccessRoute('mayor', ROUTES.reports)).toBe(true)
    expect(canAccessRoute('station_manager', ROUTES.reports)).toBe(false)
    expect(canAccessRoute('cashier', ROUTES.reports)).toBe(false)
    expect(canAccessRoute('mayor_assistant', ROUTES.reports)).toBe(false)
    expect(canAccessRoute('mayor', ROUTES.queueCheckQr)).toBe(true)
    expect(canAccessRoute('station_manager', ROUTES.queueCheckQr)).toBe(true)
    expect(canAccessRoute('cashier', ROUTES.queueCheckQr)).toBe(true)
    expect(canAccessRoute('mayor_assistant', ROUTES.queueCheckQr)).toBe(true)
  })
})
