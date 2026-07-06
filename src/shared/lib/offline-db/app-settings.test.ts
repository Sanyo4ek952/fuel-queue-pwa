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
  getCachedNoShowGraceDays,
} from './app-settings'

describe('no-show grace app setting cache', () => {
  beforeEach(() => {
    mocks.localAppSettings.rows = []
    mocks.localAppSettings.get.mockClear()
    mocks.localAppSettings.put.mockClear()
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
})
