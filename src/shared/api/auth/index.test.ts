import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  },
}))

import { signUpConsumerWithPassword, signUpWithPassword } from './index'

describe('auth registration metadata', () => {
  beforeEach(() => {
    mocks.signUp.mockReset()
    mocks.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    })
    mocks.signInWithPassword.mockReset()
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
      error: null,
    })
    mocks.signOut.mockReset()
    mocks.signOut.mockResolvedValue({
      error: null,
    })
  })

  it('marks consumer signups without signing in before email confirmation', async () => {
    const result = await signUpConsumerWithPassword({
      email: 'resident@example.local',
      password: 'password123',
      firstName: 'Ivan',
      lastName: 'Resident',
      middleName: '',
      phone: '+79990000000',
      captchaToken: 'consumer-captcha-token',
    })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'resident@example.local',
      password: 'password123',
      options: {
        captchaToken: 'consumer-captcha-token',
        data: {
          first_name: 'Ivan',
          last_name: 'Resident',
          middle_name: '',
          phone: '+79990000000',
          requested_role: 'consumer',
        },
      },
    })
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('keeps staff signups on the approval workflow', async () => {
    const result = await signUpWithPassword({
      email: 'cashier@example.local',
      password: 'password123',
      firstName: 'Ivan',
      lastName: 'Cashier',
      middleName: '',
      position: 'Cashier',
      signatureName: 'Cashier I.',
      requestedRole: 'cashier',
      requestedStationId: '10000000-0000-0000-0000-000000000001',
      captchaToken: 'staff-captcha-token',
    })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'cashier@example.local',
      password: 'password123',
      options: {
        captchaToken: 'staff-captcha-token',
        data: {
          first_name: 'Ivan',
          last_name: 'Cashier',
          middle_name: '',
          position: 'Cashier',
          signature_name: 'Cashier I.',
          requested_role: 'cashier',
          requested_station_id: '10000000-0000-0000-0000-000000000001',
        },
      },
    })
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('clears consumer signup session when email confirmation is disabled', async () => {
    mocks.signUp.mockResolvedValue({
      data: { session: { access_token: 'signup-session' } },
      error: null,
    })

    const result = await signUpConsumerWithPassword({
      email: 'resident@example.local',
      password: 'password123',
      firstName: 'Ivan',
      lastName: 'Resident',
      middleName: '',
      phone: '+79990000000',
      captchaToken: 'consumer-captcha-token',
    })

    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('clears staff signup session when email confirmation is disabled', async () => {
    mocks.signUp.mockResolvedValue({
      data: { session: { access_token: 'signup-session' } },
      error: null,
    })

    const result = await signUpWithPassword({
      email: 'cashier@example.local',
      password: 'password123',
      firstName: 'Ivan',
      lastName: 'Cashier',
      middleName: '',
      position: 'Cashier',
      signatureName: 'Cashier I.',
      requestedRole: 'cashier',
      requestedStationId: '10000000-0000-0000-0000-000000000001',
      captchaToken: 'staff-captcha-token',
    })

    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })
})
