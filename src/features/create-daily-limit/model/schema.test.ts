import { describe, expect, it } from 'vitest'

import { createDailyLimitSchema } from './schema'

const validFuelTypeLimits = [
  {
    fuelType: 'AI_92',
    limitMode: 'fuel_liters',
    vehicleLimit: 0,
    litersLimit: '0',
  },
  {
    fuelType: 'AI_95',
    limitMode: 'fuel_liters',
    vehicleLimit: 0,
    litersLimit: '400',
  },
  {
    fuelType: 'AI_100',
    limitMode: 'fuel_liters',
    vehicleLimit: 0,
    litersLimit: '0',
  },
  {
    fuelType: 'DIESEL',
    limitMode: 'vehicle_count',
    vehicleLimit: '10',
    litersLimit: '',
  },
  {
    fuelType: 'GAS',
    limitMode: 'fuel_liters',
    vehicleLimit: 0,
    litersLimit: '200',
  },
]

describe('createDailyLimitSchema', () => {
  it('coerces fuel type limit numeric fields', () => {
    const result = createDailyLimitSchema.parse({
      targetDate: '2026-07-05',
      fuelTypeLimits: validFuelTypeLimits,
    })

    expect(result.fuelTypeLimits[1]).toMatchObject({
      fuelType: 'AI_95',
      limitMode: 'fuel_liters',
      litersLimit: 400,
    })
    expect(result.fuelTypeLimits[3]).toMatchObject({
      fuelType: 'DIESEL',
      limitMode: 'vehicle_count',
      vehicleLimit: 10,
      litersLimit: null,
    })
  })

  it('rejects missing liters in fuel_liters mode', () => {
    const result = createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05',
      fuelTypeLimits: [
        { fuelType: 'AI_92', limitMode: 'fuel_liters', vehicleLimit: 0, litersLimit: '' },
        { fuelType: 'AI_95', limitMode: 'fuel_liters', vehicleLimit: 0, litersLimit: 400 },
        { fuelType: 'AI_100', limitMode: 'fuel_liters', vehicleLimit: 0, litersLimit: 0 },
        { fuelType: 'DIESEL', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
        { fuelType: 'GAS', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects zero vehicles in vehicle_count mode', () => {
    const result = createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05',
      fuelTypeLimits: [
        { fuelType: 'AI_92', limitMode: 'vehicle_count', vehicleLimit: 0, litersLimit: '' },
        { fuelType: 'AI_95', limitMode: 'fuel_liters', vehicleLimit: 0, litersLimit: 400 },
        { fuelType: 'AI_100', limitMode: 'fuel_liters', vehicleLimit: 0, litersLimit: 0 },
        { fuelType: 'DIESEL', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
        { fuelType: 'GAS', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
      ],
    })

    expect(result.success).toBe(false)
  })
})
