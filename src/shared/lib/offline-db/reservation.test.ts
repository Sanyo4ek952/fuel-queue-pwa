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
    local_reservations: makeTable(),
    local_daily_limits: makeTable(),
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

import { createOfflineReservation } from './reservation'

describe('createOfflineReservation', () => {
  beforeEach(() => {
    Object.values(mocks.tables).forEach((table) => {
      table.rows = []
      table.toArray.mockClear()
      table.put.mockClear()
    })
  })

  it('creates a pending local reservation and sync outbox operation', async () => {
    const result = await createOfflineReservation({
      plateNumber: 'А123ВС777',
      driverFullName: 'Ivan Ivanov',
      fuelType: 'AI_95',
      requestedLiters: 40,
      clientMutationId: 'mutation-id',
    })

    expect(result).toMatchObject({
      id: 'local-mutation-id',
      date: null,
      station_id: null,
      queue_number: 1,
      sync_status: 'PENDING',
    })
    expect(mocks.tables.local_vehicles.rows).toHaveLength(1)
    expect(mocks.tables.local_reservations.rows[0]).toMatchObject({
      client_mutation_id: 'mutation-id',
      date: null,
      station_id: null,
      status: 'RESERVED',
      sync_status: 'PENDING',
    })
    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      type: 'CREATE_RESERVATION',
      status: 'PENDING',
      client_mutation_id: 'mutation-id',
      payload: expect.not.objectContaining({
        station_id: expect.anything(),
        target_date: expect.anything(),
      }),
    })
  })

  it('blocks a duplicate active local reservation for the same vehicle', async () => {
    await createOfflineReservation({
      plateNumber: 'А123ВС777',
      driverFullName: 'Ivan Ivanov',
      fuelType: 'AI_95',
      requestedLiters: 40,
      clientMutationId: 'mutation-id',
    })

    await expect(
      createOfflineReservation({
        plateNumber: 'А123ВС777',
        driverFullName: 'Ivan Ivanov',
        fuelType: 'AI_95',
        requestedLiters: 40,
        clientMutationId: 'mutation-id-2',
      }),
    ).rejects.toThrow('ACTIVE_RESERVATION_ALREADY_EXISTS')
  })

  it('assigns queue numbers globally', async () => {
    mocks.tables.local_reservations.rows.push({
      id: 'reservation-10',
      vehicle_id: 'other-vehicle',
      status: 'RESERVED',
      queue_number: 10,
    })

    const result = await createOfflineReservation({
      plateNumber: 'А123ВС778',
      driverFullName: 'Ivan Ivanov',
      fuelType: 'AI_95',
      requestedLiters: 40,
      clientMutationId: 'mutation-id',
    })

    expect(result.queue_number).toBe(11)
  })
})
