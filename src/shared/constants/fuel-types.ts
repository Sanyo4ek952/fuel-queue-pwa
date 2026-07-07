export const FUEL_TYPES = ['AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER'] as const

export type FuelType = (typeof FUEL_TYPES)[number]

export const FUEL_PREFERENCE_MODES = ['EXACT', 'ANY_GASOLINE'] as const

export type FuelPreferenceMode = (typeof FUEL_PREFERENCE_MODES)[number]

export const FUEL_QUEUE_CATEGORIES = ['GASOLINE', 'DIESEL', 'GAS'] as const

export type FuelQueueCategory = (typeof FUEL_QUEUE_CATEGORIES)[number]

export const DAILY_LIMIT_MODES = ['vehicle_count', 'fuel_liters'] as const

export type DailyLimitMode = (typeof DAILY_LIMIT_MODES)[number]

export const QUEUE_FUEL_TYPES = ['AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS'] as const

export type QueueFuelType = (typeof QUEUE_FUEL_TYPES)[number]

export function isGasolineFuelType(fuelType: FuelType | string) {
  return fuelType === 'AI_92' || fuelType === 'AI_95' || fuelType === 'AI_100'
}

export function getFuelQueueCategory(fuelType: FuelType | string): FuelQueueCategory | null {
  if (isGasolineFuelType(fuelType)) {
    return 'GASOLINE'
  }

  if (fuelType === 'DIESEL') {
    return 'DIESEL'
  }

  if (fuelType === 'GAS') {
    return 'GAS'
  }

  return null
}

export function getCompatibleFuelTypes(
  fuelType: FuelType | string,
  fuelPreferenceMode: FuelPreferenceMode | string = 'EXACT',
): QueueFuelType[] {
  if (fuelPreferenceMode === 'ANY_GASOLINE' && isGasolineFuelType(fuelType)) {
    if (fuelType === 'AI_95') {
      return ['AI_95', 'AI_92', 'AI_100']
    }

    if (fuelType === 'AI_100') {
      return ['AI_100', 'AI_92', 'AI_95']
    }

    return ['AI_92', 'AI_95', 'AI_100']
  }

  return QUEUE_FUEL_TYPES.includes(fuelType as QueueFuelType)
    ? [fuelType as QueueFuelType]
    : []
}
