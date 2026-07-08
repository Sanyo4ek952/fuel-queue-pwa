import { beforeEach, describe, expect, it, vi } from 'vitest'

type MutableRecord = {
  key: string
  [key: string]: unknown
}

const mocks = vi.hoisted(() => {
  const localAppSettings = {
    rows: [] as MutableRecord[],
    get: vi.fn(async (key: string) => localAppSettings.rows.find((item) => item.key === key)),
    put: vi.fn(async (row: MutableRecord) => {
      const index = localAppSettings.rows.findIndex((item) => item.key === row.key)

      if (index >= 0) {
        localAppSettings.rows[index] = row
      } else {
        localAppSettings.rows.push(row)
      }
    }),
    delete: vi.fn(async (key: string) => {
      localAppSettings.rows = localAppSettings.rows.filter((item) => item.key !== key)
    }),
  }

  return {
    localAppSettings,
    offlineDb: {
      local_app_settings: localAppSettings,
    },
  }
})

vi.mock('./db', () => ({
  offlineDb: mocks.offlineDb,
}))

import {
  cacheNoShowGraceSetting,
  clearCachedCurrentProfile,
  getCachedCurrentProfile,
  getCachedNoShowGraceDays,
  saveCachedCurrentProfile,
} from './app-settings'

describe('no-show grace app setting cache', () => {
  beforeEach(() => {
    mocks.localAppSettings.rows = []
    mocks.localAppSettings.get.mockClear()
    mocks.localAppSettings.put.mockClear()
    mocks.localAppSettings.delete.mockClear()
  })

  it('stores and reads positive no-show grace days', async () => {
    await cacheNoShowGraceSetting(3)

    await expect(getCachedNoShowGraceDays()).resolves.toBe(3)
    expect(mocks.localAppSettings.rows[0]).toMatchObject({
      key: 'reservation_no_show_grace_days',
      value: { days: 3 },
    })
  })

  it('stores zero as disabled', async () => {
    await cacheNoShowGraceSetting(0)

    await expect(getCachedNoShowGraceDays()).resolves.toBe(0)
  })

  it('stores, reads, and clears the current profile cache', async () => {
    await saveCachedCurrentProfile({
      id: 'profile-id',
      auth_user_id: 'auth-user-id',
      full_name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      middle_name: null,
      position: null,
      signature_name: null,
      role: 'cashier',
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
      stations: [{ id: 'station-id', name: 'AZS #1', address: null }],
      is_from_cache: true,
    })

    await expect(getCachedCurrentProfile()).resolves.toMatchObject({
      id: 'profile-id',
      stations: [{ id: 'station-id' }],
    })
    await expect(getCachedCurrentProfile()).resolves.not.toHaveProperty('is_from_cache')

    await clearCachedCurrentProfile()

    await expect(getCachedCurrentProfile()).resolves.toBeNull()
  })
})
