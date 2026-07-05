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
    }

    return table
  }

  const tables = {
    local_vehicles: makeTable(),
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

import { evaluateVehicleAccessOffline } from './vehicle-access'
import { createOfflineManualOverride } from './manual-override'

const stationId = '10000000-0000-0000-0000-000000000001'
const targetDate = '2026-07-05'

describe('createOfflineManualOverride', () => {
  beforeEach(() => {
    Object.values(mocks.tables).forEach((table) => {
      table.rows = []
      table.toArray.mockClear()
      table.put.mockClear()
    })
  })

  it('creates a pending local manual override and sync outbox operation', async () => {
    const result = await createOfflineManualOverride({
      stationId,
      targetDate,
      plateNumber: 'A123BC',
      reason: 'Supervisor decision',
      clientMutationId: 'mutation-id',
    })

    expect(result).toMatchObject({
      id: 'local-mutation-id',
      reason: 'Supervisor decision',
      sync_status: 'PENDING',
    })
    expect(mocks.tables.local_vehicles.rows).toHaveLength(1)
    expect(mocks.tables.local_manual_overrides.rows[0]).toMatchObject({
      client_mutation_id: 'mutation-id',
      station_id: stationId,
      date: targetDate,
      sync_status: 'PENDING',
    })
    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      type: 'CREATE_MANUAL_OVERRIDE',
      status: 'PENDING',
      client_mutation_id: 'mutation-id',
      payload: {
        station_id: stationId,
        target_date: targetDate,
        reason: 'Supervisor decision',
      },
    })
  })

  it('makes the local vehicle access check allowed by manual override', async () => {
    const result = await createOfflineManualOverride({
      stationId,
      targetDate,
      plateNumber: 'A123BC',
      reason: 'Supervisor decision',
      clientMutationId: 'mutation-id',
    })

    expect(
      evaluateVehicleAccessOffline(
        {
          plateNumber: 'A123BC',
          stationId,
          checkDate: targetDate,
        },
        {
          vehicles: mocks.tables.local_vehicles.rows as never,
          reservations: [],
          dailyLimits: [],
          fuelingRecords: [],
          manualOverrides: mocks.tables.local_manual_overrides.rows as never,
        },
      ),
    ).toMatchObject({
      status: 'ALLOWED',
      reason: 'MANUAL_OVERRIDE_ACTIVE',
      manual_override_id: result.id,
    })
  })

  it('rejects an empty reason', async () => {
    await expect(
      createOfflineManualOverride({
        stationId,
        targetDate,
        plateNumber: 'A123BC',
        reason: '',
        clientMutationId: 'mutation-id',
      }),
    ).rejects.toThrow('INVALID_REASON')
  })
})
