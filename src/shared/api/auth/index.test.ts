import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
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
  })

  it('marks consumer signups for immediate consumer profile creation', async () => {
    await signUpConsumerWithPassword({
      email: 'resident@example.local',
      password: 'password123',
      firstName: 'Ivan',
      lastName: 'Resident',
      middleName: '',
      phone: '+79990000000',
    })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'resident@example.local',
      password: 'password123',
      options: {
        data: {
          first_name: 'Ivan',
          last_name: 'Resident',
          middle_name: '',
          phone: '+79990000000',
          requested_role: 'consumer',
        },
      },
    })
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'resident@example.local',
      password: 'password123',
    })
  })

  it('keeps staff signups on the approval workflow', async () => {
    await signUpWithPassword({
      email: 'cashier@example.local',
      password: 'password123',
      firstName: 'Ivan',
      lastName: 'Cashier',
      middleName: '',
      position: 'Cashier',
      signatureName: 'Cashier I.',
      requestedRole: 'cashier',
      requestedStationId: '10000000-0000-0000-0000-000000000001',
    })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'cashier@example.local',
      password: 'password123',
      options: {
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
  })
})
