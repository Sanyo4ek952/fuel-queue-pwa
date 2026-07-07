import Dexie, { type Table } from 'dexie'

import type {
  FuelPreferenceMode,
  FuelType,
  ReservationCallStatus,
  SyncStatus,
} from '@/shared/constants'
import type { UserRole } from '@/shared/config/roles'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

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
  station_id?: string | null
  vehicle_id: string
  driver_id?: string | null
  created_by_profile_id?: string | null
  created_by_full_name?: string | null
  created_by_role?: UserRole | string | null
  created_by_signature_name?: string | null
  date?: string | null
  status: string
  queue_number: number
  ticket_number?: number
  current_position?: number
  people_ahead?: number
  fuel_type: FuelType | string
  fuel_preference_mode?: FuelPreferenceMode | string
  requested_liters: number
  normalized_plate_number?: string
  driver_full_name?: string
  driver_phone?: string | null
  comment?: string | null
  client_mutation_id?: string | null
  sync_status?: SyncStatus
  is_within_today_limit?: boolean
  is_callable_now?: boolean
  call_unavailable_reason?: string | null
  matched_fuel_type?: FuelType | string | null
  latest_call_status?: ReservationCallStatus | null
  latest_called_by_profile_id?: string | null
  latest_called_by_full_name?: string | null
  latest_called_by_role?: UserRole | string | null
  latest_called_by_signature_name?: string | null
  latest_called_at?: string | null
  latest_call_comment?: string | null
  latest_call_client_mutation_id?: string | null
  latest_call_sync_status?: SyncStatus | null
  created_at?: string
}

export type LocalReservationCallLog = LocalRecord & {
  reservation_id: string
  status: ReservationCallStatus
  called_by_profile_id?: string | null
  called_by_full_name?: string | null
  called_by_role?: UserRole | string | null
  called_by_signature_name?: string | null
  called_at: string
  comment?: string | null
  client_mutation_id?: string | null
  sync_status?: SyncStatus
}

export type LocalQueueEntry = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  status: string
}

export type LocalDailyLimit = LocalRecord & {
  station_id?: string | null
  date: string
  status: string
  total_vehicle_limit?: number | null
  max_liters_per_vehicle?: number
  occupied_vehicle_count?: number
  remaining_vehicle_count?: number | null
  projected_queue_number?: number | null
  fuel_type_overviews?: Array<{
    fuel_type: FuelType | string
    vehicle_limit: number
    occupied_vehicle_count: number
    remaining_vehicle_count: number
    liters_limit: number | null
    reserved_liters: number
    remaining_liters: number | null
  }>
  category_overviews?: Array<{
    fuel_type?: FuelType | string
    fuel_category: string
    label: string
    limit_mode: string
    vehicle_limit: number
    liters_limit: number | null
    queue_count: number
    queued_liters: number
    covered_vehicle_count: number
    covered_liters: number
    remaining_vehicle_count: number | null
    remaining_liters: number | null
    projected_queue_number: number | null
  }>
  cached_at?: string
}

export type LocalFuelingRecord = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  reservation_id?: string | null
  fuel_type?: FuelType | string
  liters?: number
  fueled_at: string
  is_manual_override: boolean
  override_id?: string | null
  comment?: string | null
  client_mutation_id?: string | null
  sync_status?: SyncStatus
}

export type LocalManualOverride = LocalRecord & {
  station_id: string
  vehicle_id: string
  date: string
  reason?: string
  approved_by?: string | null
  normalized_plate_number?: string
  used_at?: string | null
  expires_at?: string | null
  client_mutation_id?: string | null
  sync_status?: SyncStatus
}

export type LocalRefusalRecord = LocalRecord & {
  station_id?: string | null
  vehicle_id?: string | null
  date: string
  reason: string
}

export type LocalAppSetting = {
  key: string
  value: unknown
  updated_at?: string
  cached_at: string
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

function normalizePayloadPlateNumber(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }

  const payloadRecord = payload as Record<string, unknown>

  if (typeof payloadRecord.plate_number !== 'string') {
    return payload
  }

  return {
    ...payloadRecord,
    plate_number: normalizePlateNumber(payloadRecord.plate_number),
  }
}

export class FuelQueueOfflineDb extends Dexie {
  local_profiles!: Table<LocalRecord, string>
  local_stations!: Table<LocalStation, string>
  local_vehicles!: Table<LocalVehicle, string>
  local_daily_limits!: Table<LocalDailyLimit, string>
  local_reservations!: Table<LocalReservation, string>
  local_reservation_call_logs!: Table<LocalReservationCallLog, string>
  local_queue_entries!: Table<LocalQueueEntry, string>
  local_fueling_records!: Table<LocalFuelingRecord, string>
  local_refusal_records!: Table<LocalRefusalRecord, string>
  local_manual_overrides!: Table<LocalManualOverride, string>
  local_app_settings!: Table<LocalAppSetting, string>
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

    this.version(3).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, [station_id+date], date, updated_at',
      local_reservations: 'id, [vehicle_id+date], [station_id+date], date, status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides: 'id, [vehicle_id+station_id+date], date, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(4).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, [station_id+date], date, updated_at',
      local_reservations:
        'id, client_mutation_id, [vehicle_id+date], [station_id+date], date, status, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides: 'id, [vehicle_id+station_id+date], date, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(5).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, [station_id+date], date, updated_at',
      local_reservations:
        'id, client_mutation_id, [vehicle_id+date], [station_id+date], date, status, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(6).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, [station_id+date], date, status, cached_at, updated_at',
      local_reservations:
        'id, client_mutation_id, [vehicle_id+date], [station_id+date], date, status, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(7)
      .stores({
        local_profiles: 'id, updated_at',
        local_stations: 'id, updated_at',
        local_vehicles: 'id, normalized_plate_number, updated_at',
        local_daily_limits: 'id, [station_id+date], date, status, cached_at, updated_at',
        local_reservations:
          'id, client_mutation_id, [vehicle_id+date], [station_id+date], date, status, sync_status, updated_at',
        local_queue_entries: 'id, [station_id+date], date, status, updated_at',
        local_fueling_records:
          'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
        local_refusal_records: 'id, date, updated_at',
        local_manual_overrides:
          'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
        sync_outbox: 'id, client_mutation_id, status, created_at',
        sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<LocalVehicle, string>('local_vehicles')
          .toCollection()
          .modify((vehicle) => {
            vehicle.normalized_plate_number = normalizePlateNumber(vehicle.normalized_plate_number)
          })
        await transaction
          .table<LocalReservation, string>('local_reservations')
          .toCollection()
          .modify((reservation) => {
            if (reservation.normalized_plate_number) {
              reservation.normalized_plate_number = normalizePlateNumber(
                reservation.normalized_plate_number,
              )
            }
          })
        await transaction
          .table<LocalManualOverride, string>('local_manual_overrides')
          .toCollection()
          .modify((manualOverride) => {
            if (manualOverride.normalized_plate_number) {
              manualOverride.normalized_plate_number = normalizePlateNumber(
                manualOverride.normalized_plate_number,
              )
            }
          })
        await transaction
          .table<SyncOutboxOperation, string>('sync_outbox')
          .toCollection()
          .modify((operation) => {
            operation.payload = normalizePayloadPlateNumber(operation.payload)
          })
        await transaction
          .table<SyncConflict, string>('sync_conflicts')
          .toCollection()
          .modify((conflict) => {
            conflict.payload = normalizePayloadPlateNumber(conflict.payload)
          })
      })

    this.version(8).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, [station_id+date], date, status, cached_at, updated_at',
      local_reservations:
        'id, client_mutation_id, vehicle_id, queue_number, status, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(9).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, date, status, cached_at, updated_at',
      local_reservations:
        'id, client_mutation_id, vehicle_id, queue_number, status, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(10).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, date, status, cached_at, updated_at',
      local_reservations:
        'id, client_mutation_id, vehicle_id, queue_number, status, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      local_app_settings: 'key, updated_at, cached_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(11).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, date, status, cached_at, updated_at',
      local_reservations:
        'id, client_mutation_id, vehicle_id, queue_number, status, sync_status, updated_at',
      local_reservation_call_logs:
        'id, client_mutation_id, reservation_id, status, called_at, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      local_app_settings: 'key, updated_at, cached_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    })

    this.version(12).stores({
      local_profiles: 'id, updated_at',
      local_stations: 'id, updated_at',
      local_vehicles: 'id, normalized_plate_number, updated_at',
      local_daily_limits: 'id, date, status, cached_at, updated_at',
      local_reservations:
        'id, client_mutation_id, vehicle_id, queue_number, status, sync_status, updated_at',
      local_reservation_call_logs:
        'id, client_mutation_id, reservation_id, status, called_at, sync_status, updated_at',
      local_queue_entries: 'id, [station_id+date], date, status, updated_at',
      local_fueling_records:
        'id, client_mutation_id, [vehicle_id+date], date, sync_status, updated_at',
      local_refusal_records: 'id, date, updated_at',
      local_manual_overrides:
        'id, client_mutation_id, [vehicle_id+station_id+date], date, sync_status, updated_at',
      local_app_settings: 'key, updated_at, cached_at',
      sync_outbox: 'id, client_mutation_id, status, created_at',
      sync_conflicts: 'id, client_mutation_id, operation_id, created_at',
    }).upgrade(async (transaction) => {
      await transaction
        .table<LocalReservation, string>('local_reservations')
        .toCollection()
        .modify((reservation) => {
          reservation.fuel_preference_mode ??= 'EXACT'
          reservation.is_callable_now ??= Boolean(reservation.is_within_today_limit)
          reservation.call_unavailable_reason ??=
            reservation.is_callable_now ? null : 'UNKNOWN_OFFLINE_STATUS'
          reservation.matched_fuel_type ??= reservation.is_callable_now
            ? reservation.fuel_type
            : null
        })
    })
  }
}

export const offlineDb = new FuelQueueOfflineDb()
