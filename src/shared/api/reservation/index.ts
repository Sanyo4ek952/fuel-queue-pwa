import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import type {
  FuelPreferenceMode,
  FuelType,
  ReservationCallStatus,
  ReservationStatus,
  SyncStatus,
} from '@/shared/constants'
import { supabase } from '@/shared/api/supabase'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { offlineDb, type LocalReservation } from '@/shared/lib/offline-db'

type RelatedVehicle = {
  normalized_plate_number?: string | null
}

type RelatedDriver = {
  full_name?: string | null
  phone?: string | null
}

type RelatedProfile = {
  full_name?: string | null
  role?: string | null
  signature_name?: string | null
}

type ReservationRow = {
  id: string
  date?: string | null
  station_id?: string | null
  vehicle_id: string
  driver_id?: string | null
  operator_id: string
  fuel_type: string
  preferred_fuel_type?: string | null
  fuel_preference_mode?: string | null
  requested_liters: number | string
  queue_number: number
  ticket_number?: number | string | null
  current_position?: number | string | null
  people_ahead?: number | string | null
  status: string
  comment?: string | null
  client_mutation_id?: string | null
  sync_status?: string | null
  created_at?: string
  updated_at?: string
  is_within_today_limit?: boolean | null
  is_callable_now?: boolean | null
  call_unavailable_reason?: string | null
  matched_fuel_type?: string | null
  normalized_plate_number?: string | null
  driver_full_name?: string | null
  driver_phone?: string | null
  created_by_full_name?: string | null
  created_by_role?: string | null
  created_by_signature_name?: string | null
  latest_call_status?: string | null
  latest_called_by_profile_id?: string | null
  latest_called_by_full_name?: string | null
  latest_called_by_role?: string | null
  latest_called_by_signature_name?: string | null
  latest_called_at?: string | null
  latest_call_comment?: string | null
  latest_call_client_mutation_id?: string | null
  latest_call_sync_status?: string | null
  vehicles?: RelatedVehicle | RelatedVehicle[] | null
  drivers?: RelatedDriver | RelatedDriver[] | null
  operator?: RelatedProfile | RelatedProfile[] | null
}

export type TodayQueueRow = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  driver_id: string | null
  created_by_profile_id: string | null
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
  queue_number: number
  ticket_number: number
  current_position: number
  people_ahead: number
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType | string
  preferred_fuel_type?: FuelType | string
  fuel_preference_mode?: FuelPreferenceMode | string
  requested_liters: number
  status: ReservationStatus
  sync_status: SyncStatus
  comment: string | null
  client_mutation_id: string | null
  is_offline: boolean
  is_within_today_limit: boolean
  is_callable_now?: boolean
  call_unavailable_reason?: string | null
  matched_fuel_type?: FuelType | string | null
  latest_call_status: ReservationCallStatus | null
  latest_called_by_profile_id: string | null
  latest_called_by_full_name: string
  latest_called_by_role: UserRole | string | null
  latest_called_by_signature_name: string | null
  latest_called_at: string | null
  latest_call_comment: string | null
  latest_call_client_mutation_id: string | null
  latest_call_sync_status: SyncStatus | null
  updated_at?: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numericValue = toNumber(value)

  return Number.isFinite(numericValue) ? numericValue : null
}

function firstRelation<TRelation>(value: TRelation | TRelation[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function toTodayQueueRow(row: ReservationRow): TodayQueueRow {
  const vehicle = firstRelation(row.vehicles)
  const driver = firstRelation(row.drivers)
  const operator = firstRelation(row.operator)
  const ticketNumber = toNullableNumber(row.ticket_number) ?? toNumber(row.queue_number)
  const currentPosition = toNullableNumber(row.current_position)
  const peopleAhead = toNullableNumber(row.people_ahead)

  return {
    id: row.id,
    date: row.date ?? null,
    station_id: row.station_id ?? null,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    created_by_profile_id: row.operator_id,
    created_by_full_name: row.created_by_full_name ?? operator?.full_name ?? '',
    created_by_role: row.created_by_role ?? operator?.role ?? null,
    created_by_signature_name: row.created_by_signature_name ?? operator?.signature_name ?? null,
    queue_number: ticketNumber,
    ticket_number: ticketNumber,
    current_position: currentPosition ?? ticketNumber,
    people_ahead: peopleAhead ?? Math.max((currentPosition ?? ticketNumber) - 1, 0),
    normalized_plate_number: row.normalized_plate_number ?? vehicle?.normalized_plate_number ?? '',
    driver_full_name: row.driver_full_name ?? driver?.full_name ?? '',
    driver_phone: row.driver_phone ?? driver?.phone ?? null,
    fuel_type: row.fuel_type,
    preferred_fuel_type: row.preferred_fuel_type ?? row.fuel_type,
    fuel_preference_mode: row.fuel_preference_mode ?? 'EXACT',
    requested_liters: toNumber(row.requested_liters),
    status: row.status as ReservationStatus,
    sync_status: (row.sync_status ?? 'SYNCED') as SyncStatus,
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    is_offline: false,
    is_within_today_limit: Boolean(row.is_within_today_limit),
    is_callable_now: Boolean(row.is_callable_now ?? row.is_within_today_limit),
    call_unavailable_reason: row.call_unavailable_reason ?? null,
    matched_fuel_type: row.matched_fuel_type ?? null,
    latest_call_status: (row.latest_call_status ?? null) as ReservationCallStatus | null,
    latest_called_by_profile_id: row.latest_called_by_profile_id ?? null,
    latest_called_by_full_name: row.latest_called_by_full_name ?? '',
    latest_called_by_role: row.latest_called_by_role ?? null,
    latest_called_by_signature_name: row.latest_called_by_signature_name ?? null,
    latest_called_at: row.latest_called_at ?? null,
    latest_call_comment: row.latest_call_comment ?? null,
    latest_call_client_mutation_id: row.latest_call_client_mutation_id ?? null,
    latest_call_sync_status: (row.latest_call_sync_status ?? null) as SyncStatus | null,
    updated_at: row.updated_at,
  }
}

export function toTodayQueueRowFromLocal(row: LocalReservation): TodayQueueRow {
  const ticketNumber = row.ticket_number ?? row.queue_number
  const currentPosition = row.current_position ?? ticketNumber
  const peopleAhead = row.people_ahead ?? Math.max(currentPosition - 1, 0)

  return {
    id: row.id,
    date: row.date ?? null,
    station_id: row.station_id ?? null,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    created_by_profile_id: row.created_by_profile_id ?? null,
    created_by_full_name: row.created_by_full_name ?? '',
    created_by_role: row.created_by_role ?? null,
    created_by_signature_name: row.created_by_signature_name ?? null,
    queue_number: ticketNumber,
    ticket_number: ticketNumber,
    current_position: currentPosition,
    people_ahead: peopleAhead,
    normalized_plate_number: row.normalized_plate_number ?? '',
    driver_full_name: row.driver_full_name ?? '',
    driver_phone: row.driver_phone ?? null,
    fuel_type: row.fuel_type,
    preferred_fuel_type: row.fuel_type,
    fuel_preference_mode: row.fuel_preference_mode ?? 'EXACT',
    requested_liters: row.requested_liters,
    status: row.status as ReservationStatus,
    sync_status: row.sync_status ?? 'SYNCED',
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    is_offline: row.sync_status !== 'SYNCED',
    is_within_today_limit: Boolean(row.is_within_today_limit),
    is_callable_now: Boolean(row.is_callable_now ?? row.is_within_today_limit),
    call_unavailable_reason: row.call_unavailable_reason ?? null,
    matched_fuel_type: row.matched_fuel_type ?? null,
    latest_call_status: row.latest_call_status ?? null,
    latest_called_by_profile_id: row.latest_called_by_profile_id ?? null,
    latest_called_by_full_name: row.latest_called_by_full_name ?? '',
    latest_called_by_role: row.latest_called_by_role ?? null,
    latest_called_by_signature_name: row.latest_called_by_signature_name ?? null,
    latest_called_at: row.latest_called_at ?? null,
    latest_call_comment: row.latest_call_comment ?? null,
    latest_call_client_mutation_id: row.latest_call_client_mutation_id ?? null,
    latest_call_sync_status: row.latest_call_sync_status ?? null,
    updated_at: row.updated_at,
  }
}

export function withCurrentQueuePositions(rows: TodayQueueRow[]) {
  const positionsById = new Map(
    [...rows]
      .sort((left, right) => left.ticket_number - right.ticket_number || left.id.localeCompare(right.id))
      .map((row, index) => [row.id, index + 1]),
  )

  return rows.map((row) => {
    const currentPosition = positionsById.get(row.id) ?? row.current_position

    return {
      ...row,
      current_position: currentPosition,
      people_ahead: Math.max(currentPosition - 1, 0),
    }
  })
}

export async function listTodayQueueRows() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const policyResult = await supabase.rpc('apply_reservation_no_show_policy')

  if (policyResult.error) {
    throw new Error(policyResult.error.message)
  }

  const { data, error } = await supabase.rpc('get_today_call_list', {
    target_date: getTodayDateInputValue(),
  })

  if (error) {
    throw new Error(error.message)
  }

  return withCurrentQueuePositions(
    (Array.isArray(data) ? (data as ReservationRow[]) : []).map(toTodayQueueRow),
  )
}

export async function cacheTodayQueueRows(rows: TodayQueueRow[]) {
  await offlineDb.local_reservations.bulkPut(
    rows.map(
      (row): LocalReservation => ({
        id: row.id,
        date: row.date,
        station_id: row.station_id,
        vehicle_id: row.vehicle_id,
        driver_id: row.driver_id,
        created_by_profile_id: row.created_by_profile_id,
        created_by_full_name: row.created_by_full_name,
        created_by_role: row.created_by_role,
        created_by_signature_name: row.created_by_signature_name,
        fuel_type: row.fuel_type,
        fuel_preference_mode: row.fuel_preference_mode,
        requested_liters: row.requested_liters,
        queue_number: row.queue_number,
        ticket_number: row.ticket_number,
        current_position: row.current_position,
        people_ahead: row.people_ahead,
        status: row.status,
        normalized_plate_number: row.normalized_plate_number,
        driver_full_name: row.driver_full_name,
        driver_phone: row.driver_phone,
        comment: row.comment,
        client_mutation_id: row.client_mutation_id,
        sync_status: row.sync_status,
        is_within_today_limit: row.is_within_today_limit,
        is_callable_now: row.is_callable_now,
        call_unavailable_reason: row.call_unavailable_reason,
        matched_fuel_type: row.matched_fuel_type,
        latest_call_status: row.latest_call_status,
        latest_called_by_profile_id: row.latest_called_by_profile_id,
        latest_called_by_full_name: row.latest_called_by_full_name,
        latest_called_by_role: row.latest_called_by_role,
        latest_called_by_signature_name: row.latest_called_by_signature_name,
        latest_called_at: row.latest_called_at,
        latest_call_comment: row.latest_call_comment,
        latest_call_client_mutation_id: row.latest_call_client_mutation_id,
        latest_call_sync_status: row.latest_call_sync_status,
        updated_at: row.updated_at,
      }),
    ),
  )
}
