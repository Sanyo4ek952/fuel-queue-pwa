import { describe, expect, it } from 'vitest'

import { createDailyLimitSchema } from './schema'

describe('createDailyLimitSchema', () => {
  it('accepts an open fuel with a positive liter limit', () => {
    const result = createDailyLimitSchema.parse({
      targetDate: '2026-07-05',
      stationId: 'station-id',
      fuelTypeLimits: [{
        fuelType: 'AI_95', status: 'OPEN', vehicleLimit: '0', litersLimit: '400',
      }],
    })
    expect(result.fuelTypeLimits[0]).toEqual({
      fuelType: 'AI_95', status: 'OPEN', vehicleLimit: 0, litersLimit: 400,
    })
  })

  it('allows a paused fuel with zero capacity', () => {
    expect(createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05', stationId: 'station-id',
      fuelTypeLimits: [{ fuelType: 'AI_92', status: 'PAUSED', vehicleLimit: 0, litersLimit: '' }],
    }).success).toBe(true)
  })

  it('rejects an open fuel without liters', () => {
    const result = createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05', stationId: 'station-id',
      fuelTypeLimits: [{ fuelType: 'AI_92', status: 'OPEN', vehicleLimit: 0, litersLimit: '' }],
    })

    expect(result.success).toBe(false)
  })
})
