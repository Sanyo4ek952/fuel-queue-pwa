import { describe, expect, it } from 'vitest'

import { createDailyLimitSchema } from './schema'

describe('createDailyLimitSchema', () => {
  it('accepts simultaneous vehicle and optional liter constraints', () => {
    const result = createDailyLimitSchema.parse({
      targetDate: '2026-07-05',
      stationId: 'station-id',
      fuelTypeLimits: [{
        fuelType: 'AI_95', status: 'OPEN', vehicleLimit: '10', litersLimit: '400',
      }],
    })
    expect(result.fuelTypeLimits[0]).toEqual({
      fuelType: 'AI_95', status: 'OPEN', vehicleLimit: 10, litersLimit: 400,
    })
  })

  it('allows a paused fuel with zero capacity', () => {
    expect(createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05', stationId: 'station-id',
      fuelTypeLimits: [{ fuelType: 'AI_92', status: 'PAUSED', vehicleLimit: 0, litersLimit: '' }],
    }).success).toBe(true)
  })

  it('allows an open fuel with zero capacity', () => {
    expect(createDailyLimitSchema.safeParse({
      targetDate: '2026-07-05', stationId: 'station-id',
      fuelTypeLimits: [{ fuelType: 'AI_92', status: 'OPEN', vehicleLimit: 0, litersLimit: 100 }],
    }).success).toBe(true)
  })
})
