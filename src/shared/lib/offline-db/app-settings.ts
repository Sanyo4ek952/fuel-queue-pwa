import { offlineDb } from './db'

const REFUEL_COOLDOWN_KEY = 'reservation_refuel_cooldown_days'

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
