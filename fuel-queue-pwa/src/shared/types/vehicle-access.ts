export type VehicleAccessStatus = 'ALLOWED' | 'BLOCKED' | 'WARNING'

export type VehicleAccessReason =
  | 'ACTIVE_RESERVATION'
  | 'ALREADY_FUELED'
  | 'DAILY_LIMIT_NOT_OPEN'
  | 'INVALID_PLATE_NUMBER'
  | 'LITERS_LIMIT_EXCEEDED'
  | 'MANUAL_OVERRIDE_ACTIVE'
  | 'NO_ACTIVE_RESERVATION'
  | 'NO_DAILY_LIMIT'
  | 'OFFLINE_UNCONFIRMED'
  | 'PROFILE_NOT_FOUND'
  | 'RESERVATION_AT_OTHER_STATION'
  | 'STATION_ACCESS_DENIED'
  | 'VEHICLE_BLOCKED'
  | 'RPC_ERROR'

export type VehicleAccessResult = {
  status: VehicleAccessStatus
  reason: VehicleAccessReason
  normalized_plate_number: string
  date?: string
  station_id?: string
  vehicle_id?: string
  reservation_id?: string
  reservation_station_id?: string
  daily_limit_id?: string
  daily_limit_status?: string
  queue_number?: number
  fuel_type?: string
  requested_liters?: number
  max_liters_per_vehicle?: number
  manual_override_id?: string
  block_reason?: string | null
  last_fueling_record_id?: string
  last_fueling_station_id?: string
  last_fueled_at?: string
  offline?: boolean
  offline_decision?: Exclude<VehicleAccessStatus, 'WARNING'>
  offline_reason?: VehicleAccessReason
  error?: string
}

export type CheckVehicleAccessParams = {
  plateNumber: string
  stationId: string
  checkDate: string
}
