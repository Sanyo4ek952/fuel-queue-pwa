import { describe, expect, it } from 'vitest'

import { loginSchema } from './schema'

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
