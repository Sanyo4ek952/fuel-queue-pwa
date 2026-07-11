import { offlineDb } from './db'
import type { CurrentProfile } from '@/shared/api/profile'
import type { DailyFuelingScheduleRow } from '@/shared/api/rpc/daily-fueling-schedule'

const REFUEL_COOLDOWN_KEY = 'reservation_refuel_cooldown_days'
const NO_SHOW_GRACE_KEY = 'reservation_no_show_grace_days'
const RESIDENT_FUEL_NORM_KEY = 'resident_fuel_norm_liters'
const CURRENT_PROFILE_KEY = 'current_profile'
const DAILY_FUELING_SCHEDULE_KEY_PREFIX = 'daily_fueling_schedule:'

function parseDays(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 0
  }

  const days = Number((value as { days?: unknown }).days)
  return Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0
}

function parseLiters(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 20
  }

  const liters = Number((value as { liters?: unknown }).liters)
  return Number.isFinite(liters) && liters > 0 ? liters : 20
}

export async function cacheRefuelCooldownSetting(days: number) {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0
  const now = new Date().toISOString()

  await offlineDb.local_app_settings.put({
    key: REFUEL_COOLDOWN_KEY,
    value: { days: safeDays },
    updated_at: now,
    cached_at: now,
  })
}

export async function getCachedRefuelCooldownDays() {
  const setting = await offlineDb.local_app_settings.get(REFUEL_COOLDOWN_KEY)
  return parseDays(setting?.value)
}

export async function cacheNoShowGraceSetting(days: number) {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0
  const now = new Date().toISOString()

  await offlineDb.local_app_settings.put({
    key: NO_SHOW_GRACE_KEY,
    value: { days: safeDays },
    updated_at: now,
    cached_at: now,
  })
}

export async function getCachedNoShowGraceDays() {
  const setting = await offlineDb.local_app_settings.get(NO_SHOW_GRACE_KEY)
  return parseDays(setting?.value)
}

export async function cacheResidentFuelNormLiters(liters: number) {
  const safeLiters = Number.isFinite(liters) && liters > 0 ? liters : 20
  const now = new Date().toISOString()

  await offlineDb.local_app_settings.put({
    key: RESIDENT_FUEL_NORM_KEY,
    value: { liters: safeLiters },
    updated_at: now,
    cached_at: now,
  })
}

export async function getCachedResidentFuelNormLiters() {
  const setting = await offlineDb.local_app_settings.get(RESIDENT_FUEL_NORM_KEY)
  return parseLiters(setting?.value)
}

function isDailyFuelingScheduleRow(value: unknown): value is DailyFuelingScheduleRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const row = value as Partial<DailyFuelingScheduleRow>

  return (
    typeof row.date === 'string' &&
    typeof row.station_id === 'string' &&
    (row.fuel_category === 'GASOLINE' ||
      row.fuel_category === 'DIESEL' ||
      row.fuel_category === 'GAS') &&
    typeof row.start_time === 'string' &&
    typeof row.interval_minutes === 'number' &&
    typeof row.vehicles_per_interval === 'number'
  )
}

export async function cacheDailyFuelingSchedule(
  targetDate: string,
  rows: DailyFuelingScheduleRow[],
  stationId?: string | null,
) {
  const now = new Date().toISOString()

  await offlineDb.local_app_settings.put({
    key: `${DAILY_FUELING_SCHEDULE_KEY_PREFIX}${targetDate}:${stationId ?? 'all'}`,
    value: { rows },
    updated_at: now,
    cached_at: now,
  })
}

export async function getCachedDailyFuelingSchedule(targetDate: string, stationId?: string | null) {
  const setting = await offlineDb.local_app_settings.get(
    `${DAILY_FUELING_SCHEDULE_KEY_PREFIX}${targetDate}:${stationId ?? 'all'}`,
  )

  if (!setting?.value || typeof setting.value !== 'object' || Array.isArray(setting.value)) {
    return []
  }

  const rows = (setting.value as { rows?: unknown }).rows

  return Array.isArray(rows) && rows.every(isDailyFuelingScheduleRow)
    ? rows
    : []
}

function isProfileStation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const station = value as Partial<CurrentProfile['stations'][number]>

  return typeof station.id === 'string' && typeof station.name === 'string'
}

function isCachedCurrentProfile(value: unknown): value is CurrentProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const profile = value as Partial<CurrentProfile>

  return (
    typeof profile.id === 'string' &&
    typeof profile.auth_user_id === 'string' &&
    typeof profile.full_name === 'string' &&
    typeof profile.role === 'string' &&
    typeof profile.is_active === 'boolean' &&
    typeof profile.approval_status === 'string' &&
    Array.isArray(profile.stations) &&
    profile.stations.every(isProfileStation)
  )
}

export async function saveCachedCurrentProfile(profile: CurrentProfile) {
  const now = new Date().toISOString()
  const { is_from_cache: _isFromCache, ...profileToCache } = profile

  await offlineDb.local_app_settings.put({
    key: CURRENT_PROFILE_KEY,
    value: profileToCache,
    updated_at: now,
    cached_at: now,
  })
}

export async function getCachedCurrentProfile() {
  const setting = await offlineDb.local_app_settings.get(CURRENT_PROFILE_KEY)

  return isCachedCurrentProfile(setting?.value) ? setting.value : null
}

export async function clearCachedCurrentProfile() {
  await offlineDb.local_app_settings.delete(CURRENT_PROFILE_KEY)
}
