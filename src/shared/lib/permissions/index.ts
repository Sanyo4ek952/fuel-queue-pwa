import type { UserRole } from '@/shared/config/roles'
import { ROUTES, type AppRoute } from '@/shared/config/routes'

const createReservationRoles = new Set<UserRole>([
  'operator',
  'shift_supervisor',
  'station_admin',
])

const createFuelingRecordRoles = new Set<UserRole>([
  'cashier',
  'shift_supervisor',
  'station_admin',
])

const stationManagerRoles = new Set<UserRole>(['shift_supervisor', 'station_admin'])

const routeRoles: Partial<Record<AppRoute, ReadonlySet<UserRole>>> = {
  [ROUTES.dashboard]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
  [ROUTES.check]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
  [ROUTES.queue]: createReservationRoles,
  [ROUTES.reservations]: createReservationRoles,
  [ROUTES.fueling]: createFuelingRecordRoles,
  [ROUTES.limits]: stationManagerRoles,
  [ROUTES.history]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
  [ROUTES.reports]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
  [ROUTES.users]: new Set(['station_admin', 'city_admin']),
  [ROUTES.sync]: stationManagerRoles,
  [ROUTES.settings]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
  [ROUTES.login]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
  [ROUTES.promo]: new Set([
    'operator',
    'cashier',
    'shift_supervisor',
    'station_admin',
    'city_admin',
    'viewer',
  ]),
}

export function canCreateReservation(role: UserRole) {
  return createReservationRoles.has(role)
}

export function canCreateFuelingRecord(role: UserRole) {
  return createFuelingRecordRoles.has(role)
}

export function canCreateDailyLimit(role: UserRole) {
  return stationManagerRoles.has(role)
}

export function canCreateManualOverride(role: UserRole) {
  return stationManagerRoles.has(role)
}

export function canViewAllStations(role: UserRole) {
  return role === 'city_admin'
}

export function canResolveSyncConflict(role: UserRole) {
  return stationManagerRoles.has(role)
}

export function canAccessRoute(role: UserRole, route: string) {
  const allowedRoles = routeRoles[route as AppRoute]

  if (!allowedRoles) {
    return false
  }

  return allowedRoles.has(role)
}
