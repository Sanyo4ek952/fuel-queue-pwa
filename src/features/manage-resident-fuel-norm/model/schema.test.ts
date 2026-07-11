import { describe, expect, it } from 'vitest'

import { residentFuelNormSchema } from './schema'

describe('residentFuelNormSchema', () => {
  it('accepts positive numeric liters', () => {
    expect(residentFuelNormSchema.parse({ liters: 20 })).toEqual({ liters: 20 })
    expect(residentFuelNormSchema.parse({ liters: '25.5' })).toEqual({ liters: 25.5 })
  })

  it('rejects zero, negative, and non-numeric liters', () => {
    expect(() => residentFuelNormSchema.parse({ liters: 0 })).toThrow()
    expect(() => residentFuelNormSchema.parse({ liters: -1 })).toThrow()
    expect(() => residentFuelNormSchema.parse({ liters: 'abc' })).toThrow()
  })
})
