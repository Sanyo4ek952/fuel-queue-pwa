import { describe, expect, it } from 'vitest'

import { createManualOverrideSchema } from './schema'

describe('createManualOverrideSchema', () => {
  it('accepts a valid manual override form', () => {
    const result = createManualOverrideSchema.safeParse({
        targetDate: '2026-07-05',
        plateNumber: 'A 123 BC 777',
        reason: 'Supervisor decision',
        expiresAt: '',
      })

    expect(result.success).toBe(true)
    expect(result.success ? result.data.plateNumber : null).toBe('А123ВС777')
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
        plateNumber: 'А123ВС777',
        reason: '',
      }).success,
    ).toBe(false)
  })

  it.each(['D123ZZ777', 'А12ВС777', 'А123ВС7'])(
    'rejects invalid plate input %s',
    (plateNumber) => {
      expect(
        createManualOverrideSchema.safeParse({
          targetDate: '2026-07-05',
          plateNumber,
          reason: 'Supervisor decision',
        }).success,
      ).toBe(false)
    },
  )
})
