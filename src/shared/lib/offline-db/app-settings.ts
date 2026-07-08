import { offlineDb } from './db'
import type { CurrentProfile } from '@/shared/api/profile'

const REFUEL_COOLDOWN_KEY = 'reservation_refuel_cooldown_days'
const NO_SHOW_GRACE_KEY = 'reservation_no_show_grace_days'
const CURRENT_PROFILE_KEY = 'current_profile'

function parseDays(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 0
  }

  const days = Number((value as { days?: unknown }).days)
  return Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0
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
