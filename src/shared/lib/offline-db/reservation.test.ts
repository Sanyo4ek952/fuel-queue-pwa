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
      get: vi.fn(async (id: string) => table.rows.find((item) => item.id === id || item.key === id)),
      put: vi.fn(async (row: MutableRecord) => {
        const index = table.rows.findIndex(
          (item) => item.id === row.id || (item.key && item.key === row.key),
        )

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
    local_fueling_records: makeTable(),
    local_app_settings: makeTable(),
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

import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { createOfflineReservation } from './reservation'

describe('createOfflineReservation', () => {
  beforeEach(() => {
    Object.values(mocks.tables).forEach((table) => {
      table.rows = []
      table.toArray.mockClear()
      table.get.mockClear()
      table.put.mockClear()
    })
  })

  it('creates a pending local reservation and sync outbox operation', async () => {
    const result = await createOfflineReservation({
      plateNumber: 'А123ВС777',
      driverFullName: 'Ivan Ivanov',
      driverPhone: '+79991234567',
      fuelType: 'AI_95',
      requestedLiters: 40,
      clientMutationId: 'mutation-id',
    })

    expect(result).toMatchObject({
      id: 'local-mutation-id',
      date: null,
      station_id: null,
      queue_number: 1,
      ticket_number: 1,
      current_position: 1,
      people_ahead: 0,
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
      driverPhone: '+79991234567',
      fuelType: 'AI_95',
      requestedLiters: 40,
      clientMutationId: 'mutation-id',
    })

    await expect(
      createOfflineReservation({
        plateNumber: 'А123ВС777',
        driverFullName: 'Ivan Ivanov',
        driverPhone: '+79991234567',
        fuelType: 'AI_95',
        requestedLiters: 40,
        clientMutationId: 'mutation-id-2',
      }),
    ).rejects.toThrow('ACTIVE_RESERVATION_ALREADY_EXISTS')

    expect(mocks.tables.local_reservations.rows).toHaveLength(1)
    expect(mocks.tables.sync_outbox.rows).toHaveLength(1)
    expect(mocks.tables.sync_outbox.rows[0].client_mutation_id).toBe('mutation-id')
  })

  it('assigns queue numbers globally and queue positions by fuel category', async () => {
    mocks.tables.local_reservations.rows.push({
      id: 'reservation-10',
      vehicle_id: 'other-vehicle',
      status: 'RESERVED',
      fuel_type: 'DIESEL',
      queue_number: 10,
    })

    const result = await createOfflineReservation({
      plateNumber: 'А123ВС778',
      driverFullName: 'Ivan Ivanov',
      driverPhone: '+79991234567',
      fuelType: 'AI_95',
      requestedLiters: 40,
      clientMutationId: 'mutation-id',
    })

    expect(result.queue_number).toBe(11)
    expect(result.ticket_number).toBe(11)
    expect(result.current_position).toBe(1)
    expect(result.people_ahead).toBe(0)
  })

  it('blocks a local reservation when cached refuel cooldown is active', async () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayValue = yesterday.toISOString().slice(0, 10)
    const normalizedPlateNumber = normalizePlateNumber('A123BC777')
    const vehicleId = `local-vehicle-${normalizedPlateNumber}`

    mocks.tables.local_vehicles.rows.push({
      id: vehicleId,
      normalized_plate_number: normalizedPlateNumber,
      is_blocked: false,
    })
    mocks.tables.local_fueling_records.rows.push({
      id: 'fueling-id',
      vehicle_id: vehicleId,
      station_id: 'station-id',
      date: yesterdayValue,
      fueled_at: `${yesterdayValue}T10:00:00.000Z`,
      is_manual_override: false,
    })
    mocks.tables.local_app_settings.rows.push({
      id: 'reservation_refuel_cooldown_days',
      key: 'reservation_refuel_cooldown_days',
      value: { days: 2 },
      cached_at: new Date().toISOString(),
    })

    await expect(
      createOfflineReservation({
        plateNumber: 'A123BC777',
        driverFullName: 'Ivan Ivanov',
        driverPhone: '+79991234567',
        fuelType: 'AI_95',
        requestedLiters: 40,
        clientMutationId: 'mutation-id',
      }),
    ).rejects.toThrow('REFUEL_COOLDOWN_ACTIVE')
  })
})
