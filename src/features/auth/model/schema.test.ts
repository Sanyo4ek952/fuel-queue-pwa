import { describe, expect, it } from 'vitest'

import { loginSchema, registerSchema } from './schema'

describe('loginSchema', () => {
  it('accepts valid email and password', () => {
    const result = loginSchema.safeParse({
      email: 'operator@example.local',
      password: 'password123',
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'operator',
      password: 'password123',
    })

    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = loginSchema.safeParse({
      email: 'operator@example.local',
      password: '12345',
    })

    expect(result.success).toBe(false)
  })
})

describe('registerSchema', () => {
  const validRegistration = {
    email: 'new.operator@example.local',
    password: 'password123',
    passwordConfirmation: 'password123',
    firstName: 'Ivan',
    lastName: 'Ivanov',
    middleName: '',
    position: 'Operator',
    signatureName: 'Ivanov I.I.',
    requestedStationId: '10000000-0000-0000-0000-000000000001',
  }

  it('accepts a complete registration request', () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true)
  })

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      passwordConfirmation: 'password456',
    })

    expect(result.success).toBe(false)
  })
})
