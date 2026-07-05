import { describe, expect, it } from 'vitest'

import { approveRegistrationSchema } from './schema'

describe('approveRegistrationSchema', () => {
  const baseApproval = {
    profileId: '30000000-0000-0000-0000-000000000001',
    role: 'cashier',
    stationIds: ['10000000-0000-0000-0000-000000000001'],
  }

  it('accepts cashier approval with station access', () => {
    expect(approveRegistrationSchema.safeParse(baseApproval).success).toBe(true)
  })

  it('rejects cashier approval without station access', () => {
    const result = approveRegistrationSchema.safeParse({
      ...baseApproval,
      stationIds: [],
    })

    expect(result.success).toBe(false)
  })

  it('accepts mayor assistant approval without station access', () => {
    const result = approveRegistrationSchema.safeParse({
      ...baseApproval,
      role: 'mayor_assistant',
      stationIds: [],
    })

    expect(result.success).toBe(true)
  })
})
