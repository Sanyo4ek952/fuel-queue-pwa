import { describe, expect, it } from 'vitest'

import { normalizePhone } from './normalize-phone'

describe('normalizePhone', () => {
  it('normalizes Russian phone formats to 11 digit numbers', () => {
    expect(normalizePhone('+7 (999) 000-00-00')).toBe('79990000000')
    expect(normalizePhone('8 999 000 00 00')).toBe('79990000000')
    expect(normalizePhone('9990000000')).toBe('79990000000')
  })

  it('keeps non-standard international numbers as digits only', () => {
    expect(normalizePhone('+375 29 123-45-67')).toBe('375291234567')
    expect(normalizePhone('')).toBe('')
  })
})
