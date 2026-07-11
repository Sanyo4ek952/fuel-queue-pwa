import { describe, expect, it } from 'vitest'

import { createConsumerReservationSchema } from './schema'

const baseValues = {
  vehicleId: '123e4567-e89b-12d3-a456-426614174000',
  driverFullName: 'Иван Иванов',
  driverPhone: '+7 999 123-45-67',
  fuelType: 'AI_95',
  fuelPreferenceMode: 'EXACT',
  comment: '',
} as const

describe('createConsumerReservationSchema', () => {
  it('accepts a valid consumer reservation form', () => {
    expect(createConsumerReservationSchema.safeParse(baseValues).success).toBe(true)
  })

  it('requires a vehicle id', () => {
    const result = createConsumerReservationSchema.safeParse({
      ...baseValues,
      vehicleId: '',
    })

    expect(result.success).toBe(false)
  })

  it('requires a valid driver phone', () => {
    expect(
      createConsumerReservationSchema.safeParse({
        ...baseValues,
        driverPhone: '',
      }).success,
    ).toBe(false)

    expect(createConsumerReservationSchema.parse(baseValues).driverPhone).toBe('+79991234567')
  })

  it('rejects any gasoline preference for non-gasoline fuel', () => {
    const result = createConsumerReservationSchema.safeParse({
      ...baseValues,
      fuelType: 'DIESEL',
      fuelPreferenceMode: 'ANY_GASOLINE',
    })

    expect(result.success).toBe(false)
  })
})
