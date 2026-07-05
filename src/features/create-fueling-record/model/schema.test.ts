import { describe, expect, it } from 'vitest'

import { createFuelingRecordSchema } from './schema'

describe('createFuelingRecordSchema', () => {
  it('accepts valid fueling values', () => {
    expect(
      createFuelingRecordSchema.parse({
        plateNumber: 'A123BC',
        liters: '42.5',
        fuelType: 'AI_95',
        comment: 'ok',
      }),
    ).toMatchObject({
      plateNumber: 'A123BC',
      liters: 42.5,
      fuelType: 'AI_95',
    })
  })

  it('rejects empty plate number and non-positive liters', () => {
    expect(() =>
      createFuelingRecordSchema.parse({
        plateNumber: '',
        liters: 0,
        fuelType: 'AI_95',
      }),
    ).toThrow()
  })

  it('rejects unsupported fuel type', () => {
    expect(() =>
      createFuelingRecordSchema.parse({
        plateNumber: 'A123BC',
        liters: 40,
        fuelType: 'JET',
      }),
    ).toThrow()
  })
})
