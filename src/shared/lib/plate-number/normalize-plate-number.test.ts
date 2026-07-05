import { describe, expect, it } from 'vitest'

import { normalizePlateNumber } from './normalize-plate-number'

describe('normalizePlateNumber', () => {
  it('removes spaces and hyphens', () => {
    expect(normalizePlateNumber('А 123-ВС')).toBe('A123BC')
  })

  it('uppercases lowercase input', () => {
    expect(normalizePlateNumber('а123вс')).toBe('A123BC')
  })

  it('replaces cyrillic lookalike letters with latin letters', () => {
    expect(normalizePlateNumber('А123ВС-ЕХК-МНОРСТУХ')).toBe('A123BCEXKMHOPCTYX')
  })

  it('keeps latin input unchanged after cleanup', () => {
    expect(normalizePlateNumber('M777OP')).toBe('M777OP')
  })

  it('removes unsupported characters', () => {
    expect(normalizePlateNumber('A 123 BC № 77')).toBe('A123BC77')
  })

  it('returns an empty string for empty input', () => {
    expect(normalizePlateNumber('')).toBe('')
  })
})
