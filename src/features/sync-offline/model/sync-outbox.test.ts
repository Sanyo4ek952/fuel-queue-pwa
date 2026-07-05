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
      where: vi.fn((key: string) => ({
        anyOf: vi.fn((...values: string[]) => ({
          sortBy: vi.fn(async (sortKey: string) =>
            table.rows
              .filter((row) => values.includes(String(row[key])))
              .sort((left, right) => String(left[sortKey]).localeCompare(String(right[sortKey]))),
          ),
        })),
        equals: vi.fn((value: string) => ({
          modify: vi.fn(async (changes: Record<string, unknown>) => {
            table.rows
              .filter((row) => row[key] === value)
              .forEach((row) => {
                Object.assign(row, changes)
              })
          }),
        })),
      })),
    }

    return table
  }

  const tables = {
    local_fueling_records: makeTable(),
    local_manual_overrides: makeTable(),
    local_reservations: makeTable(),
    sync_outbox: makeTable(),
    sync_conflicts: makeTable(),
  }

  return {
    syncOfflineMutation: vi.fn(),
    parseCreateFuelingRecordResult: vi.fn((value: unknown) => value),
    parseCreateManualOverrideResult: vi.fn((value: unknown) => value),
    parseCreateReservationResult: vi.fn((value: unknown) => value),
    tables,
    offlineDb: {
      ...tables,
      transaction: vi.fn(async (_mode: string, _tables: unknown[], callback: () => Promise<void>) =>
        callback(),
      ),
    },
  }
})

vi.mock('@/shared/api/rpc', () => ({
  parseCreateFuelingRecordResult: mocks.parseCreateFuelingRecordResult,
  parseCreateManualOverrideResult: mocks.parseCreateManualOverrideResult,
  parseCreateReservationResult: mocks.parseCreateReservationResult,
  syncOfflineMutation: mocks.syncOfflineMutation,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  offlineDb: mocks.offlineDb,
}))

import { syncPendingOutbox } from './sync-outbox-service'

function addOutboxOperation(overrides: Partial<MutableRecord> = {}) {
  mocks.tables.sync_outbox.rows.push({
    id: 'mutation-id',
    client_mutation_id: 'mutation-id',
    type: 'CREATE_FUELING_RECORD',
    payload: {
      plate_number: 'А123ВС',
      target_date: '2026-07-05',
      station_id: 'station-id',
    },
    status: 'PENDING',
    created_at: '2026-07-05T10:00:00.000Z',
    retry_count: 0,
    ...overrides,
  })
}

describe('syncPendingOutbox', () => {
  beforeEach(() => {
    Object.values(mocks.tables).forEach((table) => {
      table.rows = []
      table.toArray.mockClear()
      table.put.mockClear()
      table.update.mockClear()
      table.where.mockClear()
    })
    mocks.offlineDb.transaction.mockClear()
    mocks.syncOfflineMutation.mockReset()
    mocks.parseCreateFuelingRecordResult.mockClear()
    mocks.parseCreateManualOverrideResult.mockClear()
    mocks.parseCreateReservationResult.mockClear()
  })

  it('marks a create fueling record operation as synced and updates local record', async () => {
    addOutboxOperation()
    mocks.tables.local_fueling_records.rows.push({
      id: 'local-mutation-id',
      client_mutation_id: 'mutation-id',
      sync_status: 'PENDING',
    })
    mocks.syncOfflineMutation.mockResolvedValue({
      data: {
        status: 'SYNCED',
        operation_type: 'CREATE_FUELING_RECORD',
        client_mutation_id: 'mutation-id',
        data: {
          id: 'server-record-id',
          station_id: 'station-id',
          vehicle_id: 'vehicle-id',
          date: '2026-07-05',
          reservation_id: 'reservation-id',
          fuel_type: 'AI_95',
          liters: 40,
          fueled_at: '2026-07-05T10:00:00.000Z',
          is_manual_override: false,
          override_id: null,
          client_mutation_id: 'mutation-id',
          sync_status: 'SYNCED',
        },
      },
      error: null,
    })

    await syncPendingOutbox()

    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      status: 'SYNCED',
      error: undefined,
    })
    expect(mocks.tables.local_fueling_records.rows[0]).toMatchObject({
      id: 'server-record-id',
      vehicle_id: 'vehicle-id',
      sync_status: 'SYNCED',
    })
  })

  it('marks an operation and local fueling record as conflict', async () => {
    addOutboxOperation()
    mocks.tables.local_fueling_records.rows.push({
      id: 'local-mutation-id',
      client_mutation_id: 'mutation-id',
      sync_status: 'PENDING',
    })
    mocks.syncOfflineMutation.mockResolvedValue({
      data: {
        status: 'CONFLICT',
        operation_type: 'CREATE_FUELING_RECORD',
        client_mutation_id: 'mutation-id',
        reason: 'ALREADY_FUELED',
        payload: { plate_number: 'А123ВС' },
      },
      error: null,
    })

    await syncPendingOutbox()

    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      status: 'CONFLICT',
      error: 'ALREADY_FUELED',
      retry_count: 1,
    })
    expect(mocks.tables.local_fueling_records.rows[0]).toMatchObject({
      sync_status: 'CONFLICT',
    })
    expect(mocks.tables.sync_conflicts.rows[0]).toMatchObject({
      client_mutation_id: 'mutation-id',
      operation_id: 'mutation-id',
      reason: 'ALREADY_FUELED',
    })
  })

  it('marks an operation as failed when rpc returns an error', async () => {
    addOutboxOperation({ status: 'FAILED', retry_count: 2 })
    mocks.syncOfflineMutation.mockResolvedValue({
      data: null,
      error: 'Network error',
    })

    await syncPendingOutbox()

    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      status: 'FAILED',
      error: 'Network error',
      retry_count: 3,
    })
  })

  it('marks a create reservation operation as synced and updates local reservation', async () => {
    addOutboxOperation({
      type: 'CREATE_RESERVATION',
      payload: {
        plate_number: 'Рђ123Р’РЎ',
        target_date: '2026-07-06',
        station_id: 'station-id',
      },
    })
    mocks.tables.local_reservations.rows.push({
      id: 'local-mutation-id',
      client_mutation_id: 'mutation-id',
      sync_status: 'PENDING',
    })
    mocks.syncOfflineMutation.mockResolvedValue({
      data: {
        status: 'SYNCED',
        operation_type: 'CREATE_RESERVATION',
        client_mutation_id: 'mutation-id',
        data: {
          id: 'server-reservation-id',
          station_id: 'station-id',
          vehicle_id: 'vehicle-id',
          driver_id: 'driver-id',
          date: '2026-07-06',
          normalized_plate_number: 'Рђ123Р’РЎ',
          driver_full_name: 'Иван Иванов',
          driver_phone: null,
          fuel_type: 'AI_95',
          requested_liters: 40,
          queue_number: 3,
          status: 'RESERVED',
          client_mutation_id: 'mutation-id',
        },
      },
      error: null,
    })

    await syncPendingOutbox()

    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      status: 'SYNCED',
      error: undefined,
    })
    expect(mocks.tables.local_reservations.rows[0]).toMatchObject({
      id: 'server-reservation-id',
      vehicle_id: 'vehicle-id',
      queue_number: 3,
      sync_status: 'SYNCED',
    })
  })

  it('marks a create manual override operation as synced and updates local override', async () => {
    addOutboxOperation({
      type: 'CREATE_MANUAL_OVERRIDE',
      payload: {
        plate_number: 'Рђ123Р’РЎ',
        target_date: '2026-07-05',
        station_id: 'station-id',
        reason: 'Supervisor decision',
      },
    })
    mocks.tables.local_manual_overrides.rows.push({
      id: 'local-mutation-id',
      client_mutation_id: 'mutation-id',
      sync_status: 'PENDING',
    })
    mocks.syncOfflineMutation.mockResolvedValue({
      data: {
        status: 'SYNCED',
        operation_type: 'CREATE_MANUAL_OVERRIDE',
        client_mutation_id: 'mutation-id',
        data: {
          id: 'server-override-id',
          station_id: 'station-id',
          vehicle_id: 'vehicle-id',
          date: '2026-07-05',
          normalized_plate_number: 'Рђ123Р’РЎ',
          reason: 'Supervisor decision',
          approved_by: 'profile-id',
          expires_at: null,
          used_at: null,
          client_mutation_id: 'mutation-id',
          sync_status: 'SYNCED',
        },
      },
      error: null,
    })

    await syncPendingOutbox()

    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      status: 'SYNCED',
      error: undefined,
    })
    expect(mocks.tables.local_manual_overrides.rows[0]).toMatchObject({
      id: 'server-override-id',
      vehicle_id: 'vehicle-id',
      reason: 'Supervisor decision',
      sync_status: 'SYNCED',
    })
  })

  it('marks a create manual override operation and local override as conflict', async () => {
    addOutboxOperation({
      type: 'CREATE_MANUAL_OVERRIDE',
      payload: {
        plate_number: 'Рђ123Р’РЎ',
        target_date: '2026-07-05',
        station_id: 'station-id',
        reason: 'Supervisor decision',
      },
    })
    mocks.tables.local_manual_overrides.rows.push({
      id: 'local-mutation-id',
      client_mutation_id: 'mutation-id',
      sync_status: 'PENDING',
    })
    mocks.syncOfflineMutation.mockResolvedValue({
      data: {
        status: 'CONFLICT',
        operation_type: 'CREATE_MANUAL_OVERRIDE',
        client_mutation_id: 'mutation-id',
        reason: 'FORBIDDEN',
        payload: { plate_number: 'Рђ123Р’РЎ' },
      },
      error: null,
    })

    await syncPendingOutbox()

    expect(mocks.tables.sync_outbox.rows[0]).toMatchObject({
      status: 'CONFLICT',
      error: 'FORBIDDEN',
    })
    expect(mocks.tables.local_manual_overrides.rows[0]).toMatchObject({
      sync_status: 'CONFLICT',
    })
  })

  it('does not run the outbox sync in parallel', async () => {
    addOutboxOperation()
    let resolveSync: (value: unknown) => void = () => undefined
    const syncPromise = new Promise((resolve) => {
      resolveSync = resolve
    })
    mocks.syncOfflineMutation.mockReturnValue(syncPromise)

    const firstRun = syncPendingOutbox()
    const secondRun = syncPendingOutbox()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mocks.syncOfflineMutation).toHaveBeenCalledTimes(1)

    resolveSync({
      data: {
        status: 'SYNCED',
        operation_type: 'CREATE_FUELING_RECORD',
        client_mutation_id: 'mutation-id',
        data: null,
      },
      error: null,
    })

    await Promise.all([firstRun, secondRun])

    expect(mocks.syncOfflineMutation).toHaveBeenCalledTimes(1)
  })
})
