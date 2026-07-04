import Dexie, { type Table } from 'dexie'

import type { SyncStatus } from '@/shared/constants'

export type LocalRecord = {
  id: string
  updated_at?: string
}

export type SyncOutboxOperation = {
  id: string
  client_mutation_id: string
  type: string
  payload: unknown
  status: SyncStatus
  created_at: string
  synced_at?: string
  error?: string
  retry_count: number
}

export type SyncConflict = {
  id: string
  client_mutation_id: string
  operation_id: string
  reason: string
  payload: unknown
  created_at: string
}

export class FuelQueueOfflineDb extends Dexie {
  local_profiles!: Table<LocalRecord, string>
  local_stations!: Table<LocalRecord, string>
  local_daily_limits!: Table<LocalRecord, string>
  local_reservations!: Table<LocalRecord, string>
  local_queue_entries!: Table<LocalRecord, string>
  local_fueling_records!: Table<LocalRecord, string>
  local_refusal_records!: Table<LocalRecord, string>
  local_manual_overrides!: Table<LocalRecord, string>
  sync_outbox!: Table<SyncOutboxOperation, string>
  sync_conflicts!: Table<SyncConflict, string>

  constructor() {
    super('fuel_queue_pwa')

    this.version(1).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_daily_limits: 'id, updated_at',
      local_reservations: 'id, updated_at',
      local_queue_entries: 'id, updated_at',
      local_fueling_records: 'id, updated_at',
      local_refusal_records: 'id, updated_at',
      local_manual_overrides: 'id, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })
  }
}

export const offlineDb = new FuelQueueOfflineDb()
