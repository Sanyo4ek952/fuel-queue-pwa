import { describe, expect, it } from 'vitest'

import { getCompatibleFuelTypes } from './fuel-types'

describe('getCompatibleFuelTypes', () => {
  it('keeps the selected AI-92 first for any gasoline', () => {
    expect(getCompatibleFuelTypes('AI_92', 'ANY_GASOLINE')).toEqual([
      'AI_92',
      'AI_95',
      'AI_100',
    ])
  })

  it('keeps the selected AI-95 first for any gasoline', () => {
    expect(getCompatibleFuelTypes('AI_95', 'ANY_GASOLINE')).toEqual([
      'AI_95',
      'AI_92',
      'AI_100',
    ])
  })

  it('keeps the selected AI-100 first for any gasoline', () => {
    expect(getCompatibleFuelTypes('AI_100', 'ANY_GASOLINE')).toEqual([
      'AI_100',
      'AI_92',
      'AI_95',
    ])
  })

  it('uses only the selected fuel type for exact preference', () => {
    expect(getCompatibleFuelTypes('AI_95', 'EXACT')).toEqual(['AI_95'])
  })

  it('does not broaden non-gasoline fuel types for any gasoline', () => {
    expect(getCompatibleFuelTypes('DIESEL', 'ANY_GASOLINE')).toEqual(['DIESEL'])
    expect(getCompatibleFuelTypes('GAS', 'ANY_GASOLINE')).toEqual(['GAS'])
  })
})
