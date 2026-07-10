import { describe, expect, it } from 'vitest'

import { addConsumerVehicleSchema } from './schema'

describe('addConsumerVehicleSchema', () => {
  it('normalizes a valid plate number', () => {
    const result = addConsumerVehicleSchema.parse({
      plateNumber: 'а 123 вс 777',
    })

    expect(result.plateNumber).toBe('А123ВС777')
  })

  it('rejects an invalid plate number', () => {
    expect(
      addConsumerVehicleSchema.safeParse({
        plateNumber: '123',
      }).success,
    ).toBe(false)
  })
})
