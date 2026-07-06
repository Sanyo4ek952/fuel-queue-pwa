import { describe, expect, it } from 'vitest'

import { createFuelingRecordSchema } from './schema'

describe('createFuelingRecordSchema', () => {
  it('accepts valid fueling values', () => {
    expect(
      createFuelingRecordSchema.parse({
        plateNumber: 'A-123-BC-777',
        liters: '42.5',
        fuelType: 'AI_95',
        comment: 'ok',
      }),
    ).toMatchObject({
      plateNumber: 'А123ВС777',
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
        plateNumber: 'А123ВС777',
        liters: 40,
        fuelType: 'JET',
      }),
    ).toThrow()
  })

  it.each(['D123ZZ777', 'А12ВС777', 'А123ВС7'])(
    'rejects invalid plate input %s',
    (plateNumber) => {
      expect(
        createFuelingRecordSchema.safeParse({
          plateNumber,
          liters: 40,
          fuelType: 'AI_95',
        }).success,
      ).toBe(false)
    },
  )
})
