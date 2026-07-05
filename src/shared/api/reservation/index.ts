import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import type { FuelType, ReservationStatus, SyncStatus } from '@/shared/constants'
import { supabase } from '@/shared/api/supabase'
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
  date: string
  station_id: string
  vehicle_id: string
  driver_id?: string | null
  operator_id: string
  fuel_type: string
  requested_liters: number | string
  queue_number: number
  status: string
  comment?: string | null
  client_mutation_id?: string | null
  sync_status?: string | null
  created_at?: string
  updated_at?: string
  vehicles?: RelatedVehicle | RelatedVehicle[] | null
  drivers?: RelatedDriver | RelatedDriver[] | null
  operator?: RelatedProfile | RelatedProfile[] | null
}

export type TodayQueueRow = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  driver_id: string | null
  created_by_profile_id: string | null
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
  queue_number: number
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType | string
  requested_liters: number
  status: ReservationStatus
  sync_status: SyncStatus
  comment: string | null
  client_mutation_id: string | null
  is_offline: boolean
  updated_at?: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function firstRelation<TRelation>(value: TRelation | TRelation[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function toTodayQueueRow(row: ReservationRow): TodayQueueRow {
  const vehicle = firstRelation(row.vehicles)
  const driver = firstRelation(row.drivers)
  const operator = firstRelation(row.operator)

  return {
    id: row.id,
    date: row.date,
    station_id: row.station_id,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    created_by_profile_id: row.operator_id,
    created_by_full_name: operator?.full_name ?? '',
    created_by_role: operator?.role ?? null,
    created_by_signature_name: operator?.signature_name ?? null,
    queue_number: toNumber(row.queue_number),
    normalized_plate_number: vehicle?.normalized_plate_number ?? '',
    driver_full_name: driver?.full_name ?? '',
    driver_phone: driver?.phone ?? null,
    fuel_type: row.fuel_type,
    requested_liters: toNumber(row.requested_liters),
    status: row.status as ReservationStatus,
    sync_status: (row.sync_status ?? 'SYNCED') as SyncStatus,
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    is_offline: false,
    updated_at: row.updated_at,
  }
}

export function toTodayQueueRowFromLocal(row: LocalReservation): TodayQueueRow {
  return {
    id: row.id,
    date: row.date,
    station_id: row.station_id,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    created_by_profile_id: row.created_by_profile_id ?? null,
    created_by_full_name: row.created_by_full_name ?? '',
    created_by_role: row.created_by_role ?? null,
    created_by_signature_name: row.created_by_signature_name ?? null,
    queue_number: row.queue_number,
    normalized_plate_number: row.normalized_plate_number ?? '',
    driver_full_name: row.driver_full_name ?? '',
    driver_phone: row.driver_phone ?? null,
    fuel_type: row.fuel_type,
    requested_liters: row.requested_liters,
    status: row.status as ReservationStatus,
    sync_status: row.sync_status ?? 'SYNCED',
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    is_offline: row.sync_status !== 'SYNCED',
    updated_at: row.updated_at,
  }
}

export async function listTodayQueueRows({
  stationId,
  date,
}: {
  stationId: string
  date: string
}) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase
    .from('fuel_reservations')
    .select(
      'id,date,station_id,vehicle_id,driver_id,operator_id,fuel_type,requested_liters,queue_number,status,comment,client_mutation_id,sync_status,created_at,updated_at,vehicles(normalized_plate_number),drivers(full_name,phone),operator:profiles!fuel_reservations_operator_id_fkey(full_name,role,signature_name)',
    )
    .eq('station_id', stationId)
    .eq('date', date)
    .order('queue_number', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data as ReservationRow[]).map(toTodayQueueRow)
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
        requested_liters: row.requested_liters,
        queue_number: row.queue_number,
        status: row.status,
        normalized_plate_number: row.normalized_plate_number,
        driver_full_name: row.driver_full_name,
        driver_phone: row.driver_phone,
        comment: row.comment,
        client_mutation_id: row.client_mutation_id,
        sync_status: row.sync_status,
        updated_at: row.updated_at,
      }),
    ),
  )
}
