import { describe, expect, it } from 'vitest'

import { createReservationSchema } from './schema'

describe('createReservationSchema', () => {
  it('coerces requested liters', () => {
    const result = createReservationSchema.parse({
      targetDate: '2026-07-06',
      plateNumber: 'А123ВС',
      driverFullName: 'Иван Иванов',
      driverPhone: '',
      fuelType: 'AI_95',
      requestedLiters: '40',
      comment: '',
    })

    expect(result.requestedLiters).toBe(40)
  })

  it('rejects missing plate and driver', () => {
    const result = createReservationSchema.safeParse({
      targetDate: '2026-07-06',
      plateNumber: '',
      driverFullName: '',
      fuelType: 'AI_95',
      requestedLiters: 40,
    })

    expect(result.success).toBe(false)
  })
})
