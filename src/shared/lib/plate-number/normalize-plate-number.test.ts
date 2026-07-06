import { describe, expect, it } from 'vitest'

import {
  formatPlateNumber,
  isValidPlateNumber,
  normalizePlateNumber,
} from './normalize-plate-number'

describe('plate number helpers', () => {
  it.each([
    ['а123вс777', 'А123ВС777'],
    ['a123bc777', 'А123ВС777'],
    ['А 123 ВС 777', 'А123ВС777'],
    ['A-123-BC-777', 'А123ВС777'],
  ])('normalizes %s to cyrillic storage value', (input, expected) => {
    expect(normalizePlateNumber(input)).toBe(expected)
  })

  it('formats a normalized plate for display', () => {
    expect(formatPlateNumber('a123bc777')).toBe('А 123 ВС 777')
  })

  it('removes unsupported characters', () => {
    expect(normalizePlateNumber('A 123 BC № 77')).toBe('А123ВС77')
  })

  it('validates only russian plate numbers with a region', () => {
    expect(isValidPlateNumber('а123вс77')).toBe(true)
    expect(isValidPlateNumber('А123ВС777')).toBe(true)
    expect(isValidPlateNumber('D123ZZ777')).toBe(false)
    expect(isValidPlateNumber('А12ВС777')).toBe(false)
    expect(isValidPlateNumber('А123ВС7')).toBe(false)
  })

  it('returns an empty string for empty input', () => {
    expect(normalizePlateNumber('')).toBe('')
  })
})
