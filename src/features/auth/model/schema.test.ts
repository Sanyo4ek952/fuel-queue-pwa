import { describe, expect, it } from 'vitest'

import { consumerRegisterSchema, loginSchema, registerSchema } from './schema'

describe('loginSchema', () => {
  it('accepts valid email and password', () => {
    const result = loginSchema.safeParse({
      email: 'cashier@example.local',
      password: 'password123',
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'cashier',
      password: 'password123',
    })

    expect(result.success).toBe(false)
  })

  it('rejects short password', () => {
    const result = loginSchema.safeParse({
      email: 'cashier@example.local',
      password: '12345',
    })

    expect(result.success).toBe(false)
  })
})

describe('registerSchema', () => {
  const validRegistration = {
    email: 'new.cashier@example.local',
    password: 'password123',
    passwordConfirmation: 'password123',
    firstName: 'Ivan',
    lastName: 'Ivanov',
    middleName: '',
    position: 'Cashier',
    signatureName: 'Ivanov I.I.',
    requestedRole: 'cashier',
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

  it('rejects cashier registration without a station', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      requestedStationId: '',
    })

    expect(result.success).toBe(false)
  })

  it('accepts mayor assistant registration without a station', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      requestedRole: 'mayor_assistant',
      requestedStationId: '',
    })

    expect(result.success).toBe(true)
  })

  it('rejects an unsupported requested role', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      requestedRole: 'station_manager',
    })

    expect(result.success).toBe(false)
  })
})

describe('consumerRegisterSchema', () => {
  const validRegistration = {
    email: 'resident@example.local',
    password: 'password123',
    passwordConfirmation: 'password123',
    firstName: 'Ivan',
    lastName: 'Resident',
    middleName: '',
    phone: '+79990000000',
  }

  it('accepts a complete consumer registration request', () => {
    expect(consumerRegisterSchema.safeParse(validRegistration).success).toBe(true)
  })

  it('rejects mismatched passwords', () => {
    const result = consumerRegisterSchema.safeParse({
      ...validRegistration,
      passwordConfirmation: 'password456',
    })

    expect(result.success).toBe(false)
  })
})
