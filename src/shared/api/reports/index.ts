import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelType } from '@/shared/constants'

type RelatedStation = {
  name?: string | null
}

type RelatedVehicle = {
  normalized_plate_number?: string | null
}

type RelatedDriver = {
  full_name?: string | null
  phone?: string | null
}

type RelatedCashier = {
  full_name?: string | null
  signature_name?: string | null
}

type RelatedPreferentialEntry = {
  id: string
  comment?: string | null
  queue?: {
    id?: string | null
    name?: string | null
  } | null
}

type PreferentialFuelingReportRow = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  driver_id?: string | null
  preferential_queue_entry_id: string
  fuel_type: string
  liters: number | string
  comment?: string | null
  fueled_at: string
  stations?: RelatedStation | RelatedStation[] | null
  vehicles?: RelatedVehicle | RelatedVehicle[] | null
  drivers?: RelatedDriver | RelatedDriver[] | null
  cashier?: RelatedCashier | RelatedCashier[] | null
  preferential_entry?: RelatedPreferentialEntry | RelatedPreferentialEntry[] | null
}

export type PreferentialFuelingReportItem = {
  id: string
  date: string
  fueled_at: string
  station_id: string
  station_name: string
  queue_id: string | null
  queue_name: string
  vehicle_id: string
  normalized_plate_number: string
  driver_id: string | null
  driver_full_name: string
  driver_phone: string | null
  cashier_name: string
  fuel_type: FuelType | string
  liters: number
  comment: string | null
  entry_comment: string | null
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function firstRelation<TRelation>(value: TRelation | TRelation[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function toReportItem(row: PreferentialFuelingReportRow): PreferentialFuelingReportItem {
  const station = firstRelation(row.stations)
  const vehicle = firstRelation(row.vehicles)
  const driver = firstRelation(row.drivers)
  const cashier = firstRelation(row.cashier)
  const entry = firstRelation(row.preferential_entry)

  return {
    id: row.id,
    date: row.date,
    fueled_at: row.fueled_at,
    station_id: row.station_id,
    station_name: station?.name ?? '',
    queue_id: entry?.queue?.id ?? null,
    queue_name: entry?.queue?.name ?? '',
    vehicle_id: row.vehicle_id,
    normalized_plate_number: vehicle?.normalized_plate_number ?? '',
    driver_id: row.driver_id ?? null,
    driver_full_name: driver?.full_name ?? '',
    driver_phone: driver?.phone ?? null,
    cashier_name: cashier?.signature_name || cashier?.full_name || '',
    fuel_type: row.fuel_type,
    liters: toNumber(row.liters),
    comment: row.comment ?? null,
    entry_comment: entry?.comment ?? null,
  }
}

export async function listPreferentialFuelingReport() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase
    .from('fueling_records')
    .select(
      'id,date,station_id,vehicle_id,driver_id,preferential_queue_entry_id,fuel_type,liters,comment,fueled_at,stations(name),vehicles(normalized_plate_number),drivers(full_name,phone),cashier:profiles!fueling_records_cashier_id_fkey(full_name,signature_name),preferential_entry:preferential_queue_entries!fueling_records_preferential_queue_entry_id_fkey(id,comment,queue:preferential_queues(id,name))',
    )
    .not('preferential_queue_entry_id', 'is', null)
    .order('fueled_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data as PreferentialFuelingReportRow[]).map(toReportItem)
}
