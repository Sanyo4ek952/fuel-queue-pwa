import { describe, expect, it } from 'vitest'

import { refuelCooldownSchema } from './schema'

describe('refuelCooldownSchema', () => {
  it('accepts zero and positive integer days', () => {
    expect(refuelCooldownSchema.parse({ days: 0 })).toEqual({ days: 0 })
    expect(refuelCooldownSchema.parse({ days: '14' })).toEqual({ days: 14 })
  })

  it('rejects negative and fractional days', () => {
    expect(() => refuelCooldownSchema.parse({ days: -1 })).toThrow()
    expect(() => refuelCooldownSchema.parse({ days: 1.5 })).toThrow()
  })
})
