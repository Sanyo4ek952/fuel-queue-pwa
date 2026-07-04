export const FUEL_TYPES = ['AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER'] as const

export type FuelType = (typeof FUEL_TYPES)[number]
