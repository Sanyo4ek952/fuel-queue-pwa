import { describe, expect, it } from 'vitest'

import { normalizePlateNumber } from './normalize-plate-number'

describe('normalizePlateNumber', () => {
  it('removes spaces and hyphens', () => {
    expect(normalizePlateNumber('А 123-ВС')).toBe('А123ВС')
  })

  it('uppercases lowercase input', () => {
    expect(normalizePlateNumber('а123вс')).toBe('А123ВС')
  })

  it('replaces latin lookalike letters with cyrillic letters', () => {
    expect(normalizePlateNumber('A123BC-EXK-MHOPCTYX')).toBe('А123ВСЕХКМНОРСТУХ')
  })

  it('keeps cyrillic input unchanged after cleanup', () => {
    expect(normalizePlateNumber('М777ОР')).toBe('М777ОР')
  })

  it('returns an empty string for empty input', () => {
    expect(normalizePlateNumber('')).toBe('')
  })
})
