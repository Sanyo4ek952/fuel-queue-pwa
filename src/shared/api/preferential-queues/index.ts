import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import type { FuelType } from '@/shared/constants'
import type {
  PreferentialQueueEntryStatus,
  PreferentialQueueStatus,
} from '@/shared/api/rpc'
import { requestProtectedRpcApi } from '@/shared/api/rpc/protected-api'

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

type PreferentialEntryRow = {
  id: string
  queue_id: string
  vehicle_id: string
  driver_id?: string | null
  fuel_type: string
  requested_liters: number | string
  status: string
  comment?: string | null
  client_mutation_id?: string | null
  created_at: string
  updated_at: string
  vehicles?: RelatedVehicle | RelatedVehicle[] | null
  drivers?: RelatedDriver | RelatedDriver[] | null
  created_by_profile?: RelatedProfile | RelatedProfile[] | null
}

type PreferentialQueueRow = {
  id: string
  name: string
  status: string
  created_by: string
  client_mutation_id?: string | null
  created_at: string
  updated_at: string
  entries?: PreferentialEntryRow[] | null
  created_by_profile?: RelatedProfile | RelatedProfile[] | null
}

export type PreferentialQueueEntry = {
  id: string
  queue_id: string
  vehicle_id: string
  driver_id: string | null
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType | string
  requested_liters: number
  status: PreferentialQueueEntryStatus
  comment: string | null
  client_mutation_id: string | null
  created_at: string
  updated_at: string
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
}

export type PreferentialQueue = {
  id: string
  name: string
  status: PreferentialQueueStatus
  created_by: string
  client_mutation_id: string | null
  created_at: string
  updated_at: string
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
  entries: PreferentialQueueEntry[]
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function firstRelation<TRelation>(value: TRelation | TRelation[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function toPreferentialQueueEntry(row: PreferentialEntryRow): PreferentialQueueEntry {
  const vehicle = firstRelation(row.vehicles)
  const driver = firstRelation(row.drivers)
  const createdBy = firstRelation(row.created_by_profile)

  return {
    id: row.id,
    queue_id: row.queue_id,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    normalized_plate_number: vehicle?.normalized_plate_number ?? '',
    driver_full_name: driver?.full_name ?? '',
    driver_phone: driver?.phone ?? null,
    fuel_type: row.fuel_type,
    requested_liters: toNumber(row.requested_liters),
    status: row.status as PreferentialQueueEntryStatus,
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_full_name: createdBy?.full_name ?? '',
    created_by_role: createdBy?.role ?? null,
    created_by_signature_name: createdBy?.signature_name ?? null,
  }
}

function toPreferentialQueue(row: PreferentialQueueRow): PreferentialQueue {
  const createdBy = firstRelation(row.created_by_profile)

  return {
    id: row.id,
    name: row.name,
    status: row.status as PreferentialQueueStatus,
    created_by: row.created_by,
    client_mutation_id: row.client_mutation_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_full_name: createdBy?.full_name ?? '',
    created_by_role: createdBy?.role ?? null,
    created_by_signature_name: createdBy?.signature_name ?? null,
    entries: (row.entries ?? [])
      .map(toPreferentialQueueEntry)
      .sort((left, right) => left.created_at.localeCompare(right.created_at)),
  }
}

export async function listActivePreferentialQueues() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const data = await requestProtectedRpcApi(
    '/api/list-active-preferential-queues',
    {},
    'List active preferential queues request failed.',
  )

  return (Array.isArray(data) ? (data as PreferentialQueueRow[]) : []).map(toPreferentialQueue)
}
