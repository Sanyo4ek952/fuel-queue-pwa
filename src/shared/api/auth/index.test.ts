/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import {
  resendSignupConfirmationEmail,
  signInWithYandex,
  signUpConsumerWithPassword,
  signUpWithPassword,
} from './index'

describe('auth registration metadata', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', mocks.fetch)
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

    expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/login?action=signup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
      },
      body: expect.any(String),
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      email: 'resident@example.local',
      password: 'password123',
      captchaToken: 'consumer-captcha-token',
      data: expect.objectContaining({
        first_name: 'Ivan',
        last_name: 'Resident',
        middle_name: '',
        phone: '+79990000000',
        requested_role: 'consumer',
        personal_data_consent_accepted: true,
        personal_data_consent_version: '1.0',
        personal_data_consent_document_hash: 'personal-data-consent-v1-2026-07-12-sudak-admin',
        personal_data_consent_source: 'email_password',
        personal_data_consent_registration_role: 'consumer',
      }),
    })
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

    expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/login?action=signup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
      },
      body: expect.any(String),
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      email: 'cashier@example.local',
      password: 'password123',
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
        personal_data_consent_version: '1.0',
        personal_data_consent_document_hash: 'personal-data-consent-v1-2026-07-12-sudak-admin',
        personal_data_consent_source: 'email_password',
        personal_data_consent_registration_role: 'cashier',
      }),
    })
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('does not expose a server signup session to the browser', async () => {
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

    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('does not expose a staff signup session to the browser', async () => {
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

    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('resends a signup confirmation email', async () => {
    const result = await resendSignupConfirmationEmail({
      email: 'resident@example.local',
    })

    expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/login?action=resend-signup-confirmation', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
      email: 'resident@example.local',
      }),
    })
    expect(result.data).toBe(true)
    expect(result.error).toBeNull()
  })

  it('passes hCaptcha token when resending signup confirmation', async () => {
    await resendSignupConfirmationEmail({
      email: 'resident@example.local',
      captchaToken: 'resend-captcha-token',
    })

    expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/login?action=resend-signup-confirmation', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
      email: 'resident@example.local',
        captchaToken: 'resend-captcha-token',
      }),
    })
  })

  it('preserves 429 status from resend errors', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Too many requests',
          code: 'over_email_send_rate_limit',
        }),
        { status: 429 },
      ),
    )

    const result = await resendSignupConfirmationEmail({
      email: 'resident@example.local',
    })

    expect(result.data).toBeNull()
    expect(result.error).toBe('Too many requests')
    expect(result.status).toBe(429)
    expect(result.code).toBe('over_email_send_rate_limit')
  })

  it('does not start browser-side Yandex OAuth in the HttpOnly cookie auth flow', async () => {
    const result = await signInWithYandex()

    expect(result.data).toBeNull()
    expect(result.error).toBe('Yandex ID login requires the secure server-side OAuth flow.')
  })
})
