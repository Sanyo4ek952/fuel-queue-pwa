export type VehicleAccessStatus = 'ALLOWED' | 'BLOCKED' | 'WARNING'

export type VehicleAccessReason =
  | 'ACTIVE_RESERVATION'
  | 'ALREADY_FUELED'
  | 'INVALID_PLATE_NUMBER'
  | 'MANUAL_OVERRIDE_ACTIVE'
  | 'NO_GLOBAL_DAILY_LIMIT'
  | 'NO_ACTIVE_RESERVATION'
  | 'OFFLINE_UNCONFIRMED'
  | 'OUTSIDE_TODAY_LIMIT'
  | 'PROFILE_NOT_FOUND'
  | 'PREFERENTIAL_QUEUE_ACTIVE'
  | 'RESERVATION_AT_OTHER_STATION'
  | 'REFUEL_COOLDOWN_ACTIVE'
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
  allocation_id?: string
  queue_entry_id?: string
  reservation_station_id?: string
  daily_limit_id?: string
  daily_limit_status?: string
  queue_number?: number
  fuel_type?: string
  preferred_fuel_type?: string
  fuel_preference_mode?: string
  matched_fuel_type?: string | null
  is_within_today_limit?: boolean
  is_callable_now?: boolean
  call_unavailable_reason?: string | null
  fuel_category?: string
  requested_liters?: number
  effective_liters?: number
  category_position?: number
  arrival_at?: string
  call_status?: string
  category_liters?: number
  max_liters_per_vehicle?: number
  manual_override_id?: string
  preferential_queue_entry_id?: string
  preferential_queue_id?: string
  preferential_queue_name?: string
  block_reason?: string | null
  last_fueling_record_id?: string
  last_fueling_station_id?: string
  last_fueled_at?: string
  last_fueling_date?: string
  next_allowed_date?: string
  cooldown_days?: number
  days_since_last_fueling?: number
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
