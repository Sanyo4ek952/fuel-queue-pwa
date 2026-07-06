import { describe, expect, it } from 'vitest'

import { checkVehicleSchema } from './schema'

describe('checkVehicleSchema', () => {
  it.each(['а123вс777', 'a123bc777', 'А 123 ВС 777', 'A-123-BC-777'])(
    'normalizes valid plate input %s',
    (plateNumber) => {
      expect(checkVehicleSchema.parse({ plateNumber })).toMatchObject({
        plateNumber: 'А123ВС777',
      })
    },
  )

  it.each(['', 'D123ZZ777', 'А12ВС777', 'А123ВС7'])(
    'rejects invalid plate input %s',
    (plateNumber) => {
      expect(checkVehicleSchema.safeParse({ plateNumber }).success).toBe(false)
    },
  )
})
