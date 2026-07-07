import { describe, expect, it } from 'vitest'

import {
  extractPhoneDigits,
  formatRuPhoneNumber,
  isValidRuPhoneNumber,
  normalizeRuPhoneNumber,
} from './index'

describe('phone-number helpers', () => {
  it('extracts only digits', () => {
    expect(extractPhoneDigits('+7 (999) 123-45-67')).toBe('79991234567')
  })

  it.each(['9991234567', '89991234567', '79991234567', '+7 999 123-45-67'])(
    'normalizes %s to canonical Russian phone format',
    (phoneNumber) => {
      expect(normalizeRuPhoneNumber(phoneNumber)).toBe('+79991234567')
    },
  )

  it('returns an empty string for empty input', () => {
    expect(normalizeRuPhoneNumber('')).toBe('')
  })

  it('formats full and partial input for display', () => {
    expect(formatRuPhoneNumber('9991234567')).toBe('+7 999 123-45-67')
    expect(formatRuPhoneNumber('9991')).toBe('+7 999 1')
  })

  it.each(['', '999123456', '99912345678'])('rejects invalid phone input %s', (phoneNumber) => {
    expect(isValidRuPhoneNumber(phoneNumber)).toBe(false)
  })
})
