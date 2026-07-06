import { describe, expect, it } from 'vitest'

import { createReservationSchema } from './schema'

describe('createReservationSchema', () => {
  it('coerces requested liters', () => {
    const result = createReservationSchema.parse({
      plateNumber: 'a-123-bc-777',
      driverFullName: 'Иван Иванов',
      driverPhone: '',
      fuelType: 'AI_95',
      requestedLiters: '40',
      comment: '',
    })

    expect(result.plateNumber).toBe('А123ВС777')
    expect(result.requestedLiters).toBe(40)
  })

  it('rejects missing plate and driver', () => {
    const result = createReservationSchema.safeParse({
      plateNumber: '',
      driverFullName: '',
      fuelType: 'AI_95',
      requestedLiters: 40,
    })

    expect(result.success).toBe(false)
  })

  it.each(['D123ZZ777', 'А12ВС777', 'А123ВС7'])(
    'rejects invalid plate input %s',
    (plateNumber) => {
      expect(
        createReservationSchema.safeParse({
          plateNumber,
          driverFullName: 'Иван Иванов',
          fuelType: 'AI_95',
          requestedLiters: 40,
        }).success,
      ).toBe(false)
    },
  )
})
