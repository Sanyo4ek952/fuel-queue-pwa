import Dexie, { type Table } from 'dexie'

import type { FuelType, SyncStatus } from '@/shared/constants'

export type LocalRecord = {
  id: string
  updated_at?: string
}

export type LocalStation = LocalRecord & {
  name: string
  address?: string | null
  is_active?: boolean
}

export type LocalVehicle = LocalRecord & {
  normalized_plate_number: string
  is_blocked: boolean
  block_reason?: string | null
}

export type LocalReservation = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  status: string
  queue_number: number
  fuel_type: FuelType | string
  requested_liters: number
  created_at?: string
}

export type LocalQueueEntry = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  status: string
}

export type LocalDailyLimit = LocalRecord & {
  station_id: string
  date: string
  status: string
  max_liters_per_vehicle: number
}

export type LocalFuelingRecord = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  fueled_at: string
  is_manual_override: boolean
}

export type LocalManualOverride = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  used_at?: string | null
  expires_at?: string | null
}

export type LocalRefusalRecord = LocalRecord & {
  station_id?: string | null
  vehicle_id?: string | null
  date: string
  reason: string
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
  local_stations!: Table<LocalStation, string>
  local_vehicles!: Table<LocalVehicle, string>
  local_daily_limits!: Table<LocalDailyLimit, string>
  local_reservations!: Table<LocalReservation, string>
  local_queue_entries!: Table<LocalQueueEntry, string>
  local_fueling_records!: Table<LocalFuelingRecord, string>
  local_refusal_records!: Table<LocalRefusalRecord, string>
  local_manual_overrides!: Table<LocalManualOverride, string>
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

    this.version(2).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, [station_id+date], date, updated_at',
      local_reservations: 'id, [vehicle_id+date], [station_id+date], date, status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records: 'id, [vehicle_id+date], date, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides: 'id, [vehicle_id+station_id+date], date, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })
  }
}

export const offlineDb = new FuelQueueOfflineDb()
