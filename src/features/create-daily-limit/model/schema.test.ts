import { describe, expect, it } from 'vitest'

import { createDailyLimitSchema } from './schema'

describe('createDailyLimitSchema', () => {
  it('coerces numeric fields and empty liters limit', () => {
    const result = createDailyLimitSchema.parse({
      targetDate: '2026-07-05',
      totalVehicleLimit: '10',
      maxLitersPerVehicle: '50',
      fuelTypeLimits: [
        {
          fuelType: 'AI_95',
          vehicleLimit: '5',
          litersLimit: '',
        },
      ],
    })

    expect(result.totalVehicleLimit).toBe(10)
    expect(result.maxLitersPerVehicle).toBe(50)
    expect(result.fuelTypeLimits[0]?.vehicleLimit).toBe(5)
    expect(result.fuelTypeLimits[0]?.litersLimit).toBeNull()
  })

  it('rejects fuel type vehicle limits above the total vehicle limit', () => {
    const result = createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05',
      totalVehicleLimit: 3,
      maxLitersPerVehicle: 50,
      fuelTypeLimits: [
        {
          fuelType: 'AI_92',
          vehicleLimit: 2,
          litersLimit: null,
        },
        {
          fuelType: 'AI_95',
          vehicleLimit: 2,
          litersLimit: null,
        },
      ],
    })

    expect(result.success).toBe(false)
  })
})
