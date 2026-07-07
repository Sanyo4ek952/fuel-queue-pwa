import { describe, expect, it } from 'vitest'

import { updateReservationFuelPreferenceSchema } from './schema'

describe('updateReservationFuelPreferenceSchema', () => {
  it('accepts exact queue fuel values', () => {
    expect(
      updateReservationFuelPreferenceSchema.parse({
        fuelType: 'AI_95',
        fuelPreferenceMode: 'EXACT',
      }),
    ).toEqual({
      fuelType: 'AI_95',
      fuelPreferenceMode: 'EXACT',
    })
  })

  it('accepts any-gasoline mode for gasoline fuel types', () => {
    expect(
      updateReservationFuelPreferenceSchema.parse({
        fuelType: 'AI_92',
        fuelPreferenceMode: 'ANY_GASOLINE',
      }),
    ).toEqual({
      fuelType: 'AI_92',
      fuelPreferenceMode: 'ANY_GASOLINE',
    })
  })

  it.each(['DIESEL', 'GAS'])(
    'rejects any-gasoline mode for %s',
    (fuelType) => {
      expect(
        updateReservationFuelPreferenceSchema.safeParse({
          fuelType,
          fuelPreferenceMode: 'ANY_GASOLINE',
        }).success,
      ).toBe(false)
    },
  )
})
