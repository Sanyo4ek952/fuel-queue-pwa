import type { FuelType } from '@/shared/constants'

export type VehicleFuelingHistoryStationSummary = {
  station_id: string
  station_name: string
  fueling_count: number
  total_liters: number
}

export type VehicleFuelingHistoryFuelSummary = {
  fuel_type: FuelType | string
  fueling_count: number
  total_liters: number
}

export type VehicleFuelingHistoryRecord = {
  id: string
  date: string
  fueled_at: string
  liters: number
  station_id: string
  station_name: string
  fuel_type: FuelType | string
  is_manual_override: boolean
  sync_status: string
}

export type VehicleFuelingHistoryResult = {
  normalized_plate_number: string
  vehicle_id: string | null
  vehicle_found: boolean
  total_fueling_count: number
  regular_fueling_count: number
  manual_override_fueling_count: number
  total_liters: number
  first_fueled_at: string | null
  last_fueled_at: string | null
  station_summaries: VehicleFuelingHistoryStationSummary[]
  fuel_type_summaries: VehicleFuelingHistoryFuelSummary[]
  records: VehicleFuelingHistoryRecord[]
  has_more: boolean
  offline?: boolean
  error?: string
}

export type GetVehicleFuelingHistoryParams = {
  plateNumber: string
  pageLimit?: number
  pageOffset?: number
}
