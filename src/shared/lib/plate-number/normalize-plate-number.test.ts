import { describe, expect, it } from 'vitest'

import {
  formatPlateNumber,
  isValidPlateNumber,
  normalizePlateNumber,
} from './normalize-plate-number'

describe('plate number helpers', () => {
  it.each([
    ['\u0430123\u0432\u0441777', '\u0410123\u0412\u0421777'],
    ['a123bc777', '\u0410123\u0412\u0421777'],
    ['\u0410 123 \u0412\u0421 777', '\u0410123\u0412\u0421777'],
    ['A-123-BC-777', '\u0410123\u0412\u0421777'],
  ])('normalizes %s to cyrillic storage value', (input, expected) => {
    expect(normalizePlateNumber(input)).toBe(expected)
  })

  it('formats a normalized plate for display', () => {
    expect(formatPlateNumber('a123bc777')).toBe('\u0410 123 \u0412\u0421 777')
  })

  it('removes unsupported characters', () => {
    expect(normalizePlateNumber('A 123 BC \u2116 77')).toBe('\u0410123\u0412\u042177')
  })

  it('validates only russian plate numbers with a region', () => {
    expect(isValidPlateNumber('\u0430123\u0432\u044177')).toBe(true)
    expect(isValidPlateNumber('\u0410123\u0412\u0421777')).toBe(true)
    expect(isValidPlateNumber('D123ZZ777')).toBe(false)
    expect(isValidPlateNumber('\u041012\u0412\u0421777')).toBe(false)
    expect(isValidPlateNumber('\u0410123\u0412\u04217')).toBe(false)
  })

  it('returns an empty string for empty input', () => {
    expect(normalizePlateNumber('')).toBe('')
  })
})
