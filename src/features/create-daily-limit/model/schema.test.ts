import { describe, expect, it } from 'vitest'

import { createDailyLimitSchema } from './schema'

const validCategoryLimits = [
  {
    fuelCategory: 'GASOLINE',
    limitMode: 'fuel_liters',
    vehicleLimit: 0,
    litersLimit: '400',
  },
  {
    fuelCategory: 'DIESEL',
    limitMode: 'vehicle_count',
    vehicleLimit: '10',
    litersLimit: '',
  },
  {
    fuelCategory: 'GAS',
    limitMode: 'fuel_liters',
    vehicleLimit: 0,
    litersLimit: '200',
  },
]

describe('createDailyLimitSchema', () => {
  it('coerces category limit numeric fields', () => {
    const result = createDailyLimitSchema.parse({
      targetDate: '2026-07-05',
      categoryLimits: validCategoryLimits,
    })

    expect(result.categoryLimits[0]).toMatchObject({
      fuelCategory: 'GASOLINE',
      limitMode: 'fuel_liters',
      litersLimit: 400,
    })
    expect(result.categoryLimits[1]).toMatchObject({
      fuelCategory: 'DIESEL',
      limitMode: 'vehicle_count',
      vehicleLimit: 10,
      litersLimit: null,
    })
  })

  it('rejects missing liters in fuel_liters mode', () => {
    const result = createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05',
      categoryLimits: [
        { fuelCategory: 'GASOLINE', limitMode: 'fuel_liters', vehicleLimit: 0, litersLimit: '' },
        { fuelCategory: 'DIESEL', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
        { fuelCategory: 'GAS', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects zero vehicles in vehicle_count mode', () => {
    const result = createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05',
      categoryLimits: [
        { fuelCategory: 'GASOLINE', limitMode: 'vehicle_count', vehicleLimit: 0, litersLimit: '' },
        { fuelCategory: 'DIESEL', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
        { fuelCategory: 'GAS', limitMode: 'vehicle_count', vehicleLimit: 10, litersLimit: '' },
      ],
    })

    expect(result.success).toBe(false)
  })
})
