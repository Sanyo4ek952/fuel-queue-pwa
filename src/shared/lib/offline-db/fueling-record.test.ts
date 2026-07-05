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
      put: vi.fn(async (row: MutableRecord) => {
        const index = table.rows.findIndex((item) => item.id === row.id)

        if (index >= 0) {
          table.rows[index] = row
        } else {
          table.rows.push(row)
        }
      }),
      update: vi.fn(async (id: string, changes: Record<string, unknown>) => {
        const row = table.rows.find((item) => item.id === id)

        if (row) {
          Object.assign(row, changes)
        }
      }),
    }

    return table
  }

  const tables = {
    local_vehicles: makeTable(),
    local_reservations: makeTable(),
    local_daily_limits: makeTable(),
    local_fueling_records: makeTable(),
    local_manual_overrides: makeTable(),
    sync_outbox: makeTable(),
  }

  return {
    tables,
    offlineDb: {
      ...tables,
      transaction: vi.fn(async (_mode: string, _tables: unknown[], callback: () => Promise<void>) =>
        callback(),
      ),
    },
  }
})

vi.mock('./db', () => ({
  offlineDb: mocks.offlineDb,
}))

import { createOfflineFuelingRecord } from './fueling-record'

const stationId = '10000000-0000-0000-0000-000000000001'
const vehicleId = 'vehicle-1'
const targetDate = '2026-07-05'

describe('createOfflineFuelingRecord', () => {
  beforeEach(() => {
    Object.values(mocks.tables).forEach((table) => {
      table.rows = []
      table.toArray.mockClear()
      table.put.mockClear()
      table.update.mockClear()
    })

    mocks.tables.local_vehicles.rows.push({
      id: vehicleId,
      normalized_plate_number: 'A123BC',
      is_blocked: false,
    })
    mocks.tables.local_reservations.rows.push({
      id: 'reservation-1',
      station_id: stationId,
      vehicle_id: vehicleId,
      date: targetDate,
      status: 'RESERVED',
      queue_number: 7,
      fuel_type: 'AI_95',
      requested_liters: 40,
    })
    mocks.tables.local_daily_limits.rows.push({
      id: 'daily-limit-1',
      station_id: stationId,
      date: targetDate,
      status: 'OPEN',
      max_liters_per_vehicle: 50,
    })
  })

  it('creates a pending local fueling record and sync outbox operation', async () => {
    const result = await createOfflineFuelingRecord({
      stationId,
      plateNumber: 'A123BC',
      liters: 40,
      targetDate,
      fueledAt: '2026-07-05T10:00:00.000Z',
      clientMutationId: 'mutation-id',
    })

    expect(result).toMatchObject({
      id: 'local-mutation-id',
      reservation_id: 'reservation-1',
      fuel_type: 'AI_95',
      sync_status: 'PENDING',
    })
    expect(mocks.tables.local_fueling_records.rows).toHaveLength(1)
    expect(mocks.tables.sync_outbox.rows).toHaveLength(1)
    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      type: 'CREATE_FUELING_RECORD',
      status: 'PENDING',
      client_mutation_id: 'mutation-id',
    })
    expect(mocks.tables.local_reservations.rows[0].status).toBe('FUELED')
  })

  it('blocks a repeated offline fueling after the first local record', async () => {
    await createOfflineFuelingRecord({
      stationId,
      plateNumber: 'A123BC',
      liters: 40,
      targetDate,
      fueledAt: '2026-07-05T10:00:00.000Z',
      clientMutationId: 'mutation-id',
    })

    await expect(
      createOfflineFuelingRecord({
        stationId,
        plateNumber: 'A123BC',
        liters: 40,
        targetDate,
        fueledAt: '2026-07-05T11:00:00.000Z',
        clientMutationId: 'mutation-id-2',
      }),
    ).rejects.toThrow('ALREADY_FUELED')
  })
})
