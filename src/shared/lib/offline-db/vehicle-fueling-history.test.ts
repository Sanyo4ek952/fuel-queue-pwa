import { beforeEach, describe, expect, it, vi } from 'vitest'

type MutableRecord = {
  id: string
  [key: string]: unknown
}

const mocks = vi.hoisted(() => {
  function makeTable() {
    const table = {
      rows: [] as MutableRecord[],
      toArray: vi.fn(async () => table.rows),
    }

    return table
  }

  const tables = {
    local_vehicles: makeTable(),
    local_stations: makeTable(),
    local_fueling_records: makeTable(),
  }

  return {
    tables,
    offlineDb: tables,
  }
})

vi.mock('./db', () => ({
  offlineDb: mocks.offlineDb,
}))

import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { getVehicleFuelingHistoryOffline } from './vehicle-fueling-history'

describe('getVehicleFuelingHistoryOffline', () => {
  beforeEach(() => {
    Object.values(mocks.tables).forEach((table) => {
      table.rows = []
      table.toArray.mockClear()
    })

    mocks.tables.local_vehicles.rows.push({
      id: 'vehicle-1',
      normalized_plate_number: normalizePlateNumber('A123BC'),
      is_blocked: false,
    })
    mocks.tables.local_stations.rows.push({
      id: 'station-1',
      name: 'Station 1',
    })

    for (let index = 1; index <= 11; index += 1) {
      mocks.tables.local_fueling_records.rows.push({
        id: `fueling-${index}`,
        station_id: 'station-1',
        vehicle_id: 'vehicle-1',
        date: `2026-07-${String(index).padStart(2, '0')}`,
        fuel_type: 'AI_95',
        liters: index,
        fueled_at: `2026-07-${String(index).padStart(2, '0')}T10:00:00.000Z`,
        is_manual_override: false,
        sync_status: 'SYNCED',
      })
    }
  })

  it('sorts fueling records descending and paginates by limit and offset', async () => {
    const firstPage = await getVehicleFuelingHistoryOffline({
      plateNumber: 'A123BC',
      pageLimit: 10,
      pageOffset: 0,
    })
    const secondPage = await getVehicleFuelingHistoryOffline({
      plateNumber: 'A123BC',
      pageLimit: 10,
      pageOffset: 10,
    })

    expect(firstPage.records).toHaveLength(10)
    expect(firstPage.records[0]).toMatchObject({
      id: 'fueling-11',
      station_name: 'Station 1',
      liters: 11,
    })
    expect(firstPage.has_more).toBe(true)
    expect(secondPage.records).toHaveLength(1)
    expect(secondPage.records[0]).toMatchObject({ id: 'fueling-1' })
    expect(secondPage.has_more).toBe(false)
  })
})
