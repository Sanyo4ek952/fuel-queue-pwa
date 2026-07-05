import { describe, expect, it } from 'vitest'

import { createManualOverrideSchema } from './schema'

describe('createManualOverrideSchema', () => {
  it('accepts a valid manual override form', () => {
    expect(
      createManualOverrideSchema.safeParse({
        targetDate: '2026-07-05',
        plateNumber: 'A123BC',
        reason: 'Supervisor decision',
        expiresAt: '',
      }).success,
    ).toBe(true)
  })

  it('rejects an empty plate number', () => {
    expect(
      createManualOverrideSchema.safeParse({
        targetDate: '2026-07-05',
        plateNumber: '',
        reason: 'Supervisor decision',
      }).success,
    ).toBe(false)
  })

  it('rejects an empty reason', () => {
    expect(
      createManualOverrideSchema.safeParse({
        targetDate: '2026-07-05',
        plateNumber: 'A123BC',
        reason: '',
      }).success,
    ).toBe(false)
  })
})
