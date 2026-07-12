/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
  signInWithOAuth: vi.fn(),
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
      resend: mocks.resend,
      signInWithOAuth: mocks.signInWithOAuth,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  },
}))

import {
  resendSignupConfirmationEmail,
  signInWithYandex,
  signUpConsumerWithPassword,
  signUpWithPassword,
} from './index'

describe('auth registration metadata', () => {
  beforeEach(() => {
    mocks.signUp.mockReset()
    mocks.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    })
    mocks.resend.mockReset()
    mocks.resend.mockResolvedValue({
      data: {},
      error: null,
    })
    mocks.signInWithOAuth.mockReset()
    mocks.signInWithOAuth.mockResolvedValue({
      data: {},
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
      personalDataConsentAccepted: true,
    })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'resident@example.local',
      password: 'password123',
      options: {
        captchaToken: 'consumer-captcha-token',
        data: expect.objectContaining({
          first_name: 'Ivan',
          last_name: 'Resident',
          middle_name: '',
          phone: '+79990000000',
          requested_role: 'consumer',
          personal_data_consent_accepted: true,
          personal_data_consent_version: '2026-07-12',
          personal_data_consent_document_hash: 'personal-data-consent-2026-07-12-city-queue-v1',
          personal_data_consent_source: 'email_password',
          personal_data_consent_registration_role: 'consumer',
        }),
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
      personalDataConsentAccepted: true,
    })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'cashier@example.local',
      password: 'password123',
      options: {
        captchaToken: 'staff-captcha-token',
        data: expect.objectContaining({
          first_name: 'Ivan',
          last_name: 'Cashier',
          middle_name: '',
          position: 'Cashier',
          signature_name: 'Cashier I.',
          requested_role: 'cashier',
          requested_station_id: '10000000-0000-0000-0000-000000000001',
          personal_data_consent_accepted: true,
          personal_data_consent_version: '2026-07-12',
          personal_data_consent_document_hash: 'personal-data-consent-2026-07-12-city-queue-v1',
          personal_data_consent_source: 'email_password',
          personal_data_consent_registration_role: 'cashier',
        }),
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
      personalDataConsentAccepted: true,
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
      personalDataConsentAccepted: true,
    })

    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('resends a signup confirmation email', async () => {
    const result = await resendSignupConfirmationEmail({
      email: 'resident@example.local',
    })

    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'resident@example.local',
      options: undefined,
    })
    expect(result.data).toBe(true)
    expect(result.error).toBeNull()
  })

  it('passes hCaptcha token when resending signup confirmation', async () => {
    await resendSignupConfirmationEmail({
      email: 'resident@example.local',
      captchaToken: 'resend-captcha-token',
    })

    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'resident@example.local',
      options: {
        captchaToken: 'resend-captcha-token',
      },
    })
  })

  it('preserves 429 status from resend errors', async () => {
    mocks.resend.mockResolvedValue({
      data: {},
      error: {
        message: 'Too many requests',
        status: 429,
        code: 'over_email_send_rate_limit',
      },
    })

    const result = await resendSignupConfirmationEmail({
      email: 'resident@example.local',
    })

    expect(result.data).toBeNull()
    expect(result.error).toBe('Too many requests')
    expect(result.status).toBe(429)
    expect(result.code).toBe('over_email_send_rate_limit')
  })

  it('starts Yandex ID OAuth with the custom provider, scopes, and auth callback redirect', async () => {
    const result = await signInWithYandex()

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'custom:yandex',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'login:info login:email',
      },
    })
    expect(result.data).toBe(true)
    expect(result.error).toBeNull()
  })
})
