import type { UserRole } from '@/shared/config/roles'
import { ROUTES, type AppRoute } from '@/shared/config/routes'

const allRoles = new Set<UserRole>([
  'mayor',
  'station_manager',
  'cashier',
  'mayor_assistant',
  'consumer',
])
const staffRoles = new Set<UserRole>(['mayor', 'station_manager', 'cashier', 'mayor_assistant'])
const createReservationRoles = new Set<UserRole>([
  'mayor',
  'station_manager',
  'cashier',
  'mayor_assistant',
])
const checkVehicleRoles = staffRoles
const queueViewerRoles = staffRoles
const cancelReservationRoles = new Set<UserRole>(['mayor', 'station_manager', 'mayor_assistant'])

const createFuelingRecordRoles = new Set<UserRole>(['mayor', 'station_manager', 'cashier'])
const stationManagerRoles = new Set<UserRole>(['mayor', 'station_manager'])
const mayorOnlyRoles = new Set<UserRole>(['mayor'])
const dailyLimitManagerRoles = new Set<UserRole>(['mayor'])
const personalLiterLimitRoles = new Set<UserRole>(['mayor', 'mayor_assistant'])
const limitRouteRoles = new Set<UserRole>(['mayor', 'station_manager', 'mayor_assistant'])
const userManagerRoles = new Set<UserRole>(['mayor', 'station_manager'])

const routeRoles: Partial<Record<AppRoute, ReadonlySet<UserRole>>> = {
  [ROUTES.dashboard]: allRoles,
  [ROUTES.check]: checkVehicleRoles,
  [ROUTES.queue]: queueViewerRoles,
  [ROUTES.reservations]: createReservationRoles,
  [ROUTES.preferentialQueues]: mayorOnlyRoles,
  [ROUTES.fueling]: createFuelingRecordRoles,
  [ROUTES.limits]: limitRouteRoles,
  [ROUTES.history]: staffRoles,
  [ROUTES.deletedReservations]: cancelReservationRoles,
  [ROUTES.reports]: mayorOnlyRoles,
  [ROUTES.users]: userManagerRoles,
  [ROUTES.sync]: stationManagerRoles,
  [ROUTES.settings]: staffRoles,
  [ROUTES.queueCheckQr]: staffRoles,
  [ROUTES.profileSetup]: new Set<UserRole>(['consumer']),
  [ROUTES.login]: allRoles,
  [ROUTES.authCallback]: allRoles,
  [ROUTES.promo]: allRoles,
}

export function canCreateReservation(role: UserRole) {
  return createReservationRoles.has(role)
}

export function canCreateFuelingRecord(role: UserRole) {
  return createFuelingRecordRoles.has(role)
}

export function canCreateDailyLimit(role: UserRole) {
  return dailyLimitManagerRoles.has(role)
}

export function canCreatePersonalVehicleLiterLimit(role: UserRole) {
  return personalLiterLimitRoles.has(role)
}

export function canCreateManualOverride(role: UserRole) {
  return stationManagerRoles.has(role)
}

export function canCancelReservation(role: UserRole) {
  return cancelReservationRoles.has(role)
}

export function canViewAllStations(role: UserRole) {
  return role === 'mayor' || role === 'mayor_assistant'
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
