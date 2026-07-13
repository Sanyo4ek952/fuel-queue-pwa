import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  fetchWithTimeout: vi.fn(),
  getCachedCurrentProfile: vi.fn(),
  saveCachedCurrentProfile: vi.fn(),
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/api/auth', () => ({
  getAuthSession: mocks.getAuthSession,
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/lib/fetch-with-timeout', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  getCachedCurrentProfile: mocks.getCachedCurrentProfile,
  saveCachedCurrentProfile: mocks.saveCachedCurrentProfile,
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: mocks.supabase,
}))

import {
  approveRegistration,
  completeCurrentConsumerProfile,
  deactivateProfile,
  getCurrentProfile,
  listManagedProfiles,
  rejectRegistration,
  type CurrentProfile,
} from './index'

const profile: CurrentProfile = {
  id: 'profile-id',
  auth_user_id: 'auth-user-id',
  email: null,
  full_name: 'Test User',
  first_name: 'Test',
  last_name: 'User',
  middle_name: null,
  phone: null,
  avatar_url: null,
  auth_provider: null,
  position: null,
  signature_name: null,
  role: 'cashier',
  is_active: true,
  approval_status: 'approved',
  requested_station_id: null,
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  deactivated_by: null,
  deactivated_at: null,
  deactivation_reason: null,
  personal_data_consent_version: null,
  personal_data_consented_at: null,
  stations: [{ id: 'station-id', name: 'AZS #1', address: null }],
}

describe('getCurrentProfile', () => {
  beforeEach(() => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    mocks.fetchWithTimeout.mockReset()
    mocks.getCachedCurrentProfile.mockReset()
    mocks.saveCachedCurrentProfile.mockReset()
    mocks.supabase.rpc.mockReset()
  })

  it('loads the profile through the Vercel API and caches it', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(getCurrentProfile()).resolves.toMatchObject({
      id: 'profile-id',
      is_from_cache: false,
    })
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/current-profile',
      { credentials: 'same-origin' },
      {
        timeoutMs: 8_000,
        timeoutMessage: 'Current profile request timed out.',
      },
    )
    expect(mocks.saveCachedCurrentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'profile-id' }),
    )
  })

  it('uses the cached profile when the Vercel API times out', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Supabase request timed out.' }), {
        status: 504,
        headers: { 'content-type': 'application/json' },
      }),
    )
    mocks.getCachedCurrentProfile.mockResolvedValue(profile)

    await expect(getCurrentProfile()).resolves.toMatchObject({
      id: 'profile-id',
      is_from_cache: true,
    })
  })

  it('uses the cached profile when the profile API cannot be reached', async () => {
    mocks.fetchWithTimeout.mockRejectedValue(new TypeError('Failed to fetch'))
    mocks.getCachedCurrentProfile.mockResolvedValue(profile)

    await expect(getCurrentProfile()).resolves.toMatchObject({
      id: 'profile-id',
      is_from_cache: true,
    })
  })

  it('does not use cached profile data from another auth user', async () => {
    mocks.fetchWithTimeout.mockRejectedValue(new TypeError('Failed to fetch'))
    mocks.getCachedCurrentProfile.mockResolvedValue({
      ...profile,
      auth_user_id: 'previous-auth-user-id',
    })

    await expect(getCurrentProfile('current-auth-user-id')).rejects.toThrow('Failed to fetch')
  })

  it('treats a missing profile response as a profile error', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    mocks.getCachedCurrentProfile.mockResolvedValue(profile)

    await expect(getCurrentProfile()).rejects.toThrow('PROFILE_NOT_FOUND')
    expect(mocks.getCachedCurrentProfile).not.toHaveBeenCalled()
  })

  it('rejects malformed profile roles instead of returning a missing profile', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify({ ...profile, role: 'legacy_role' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    mocks.getCachedCurrentProfile.mockResolvedValue(profile)

    await expect(getCurrentProfile()).rejects.toThrow('INVALID_CURRENT_PROFILE')
    expect(mocks.getCachedCurrentProfile).not.toHaveBeenCalled()
  })

  it('does not use the cached profile for authorization errors', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Authorization token is invalid.' }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    mocks.getCachedCurrentProfile.mockResolvedValue(profile)

    await expect(getCurrentProfile()).rejects.toThrow(
      'Authorization token is invalid.',
    )
    expect(mocks.getCachedCurrentProfile).not.toHaveBeenCalled()
  })

  it('completes a consumer profile through the RPC wrapper', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(
        JSON.stringify({
        ...profile,
        role: 'consumer',
        first_name: 'Ivan',
        last_name: 'Resident',
        phone: '+79990000000',
        stations: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await expect(
      completeCurrentConsumerProfile({
        firstName: 'Ivan',
        lastName: 'Resident',
        middleName: '',
        phone: '+79990000000',
      }),
    ).resolves.toMatchObject({
      role: 'consumer',
      first_name: 'Ivan',
      phone: '+79990000000',
    })
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/complete-consumer-profile',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Ivan',
          lastName: 'Resident',
          middleName: '',
          phone: '+79990000000',
        }),
      },
      {
        timeoutMs: 10_000,
        timeoutMessage: 'Сервер не ответил. Проверьте соединение и повторите.',
      },
    )
  })
})

describe('listManagedProfiles', () => {
  beforeEach(() => {
    mocks.fetchWithTimeout.mockReset()
    mocks.supabase.rpc.mockReset()
  })

  it('loads one managed profiles page through the protected API', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              ...profile,
              requested_station_name: 'АЗС #1',
              approved_by_name: null,
              rejected_by_name: null,
              deactivated_by_name: null,
              created_at: '2026-07-13T08:00:00.000Z',
              updated_at: '2026-07-13T08:00:00.000Z',
            },
          ],
          total_count: 12,
          has_more: true,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await expect(
      listManagedProfiles({
        section: 'active',
        limit: 10,
        offset: 10,
      }),
    ).resolves.toMatchObject({
      totalCount: 12,
      hasMore: true,
      items: [{ id: 'profile-id' }],
    })
    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/list-managed-profiles',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          section: 'active',
          limit: 10,
          offset: 10,
        }),
      },
      {
        timeoutMs: 10_000,
        timeoutMessage: 'Сервер не ответил. Проверьте соединение и повторите.',
      },
    )
    const [, init] = mocks.fetchWithTimeout.mock.calls[0]
    expect(init.headers).not.toHaveProperty('authorization')
    expect(mocks.supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed paginated managed profiles responses', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      listManagedProfiles({
        section: 'pending',
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow('Unexpected list_managed_profiles_page response.')
  })
})

describe('managed profile mutations', () => {
  beforeEach(() => {
    mocks.fetchWithTimeout.mockReset()
    mocks.supabase.rpc.mockReset()
    mocks.fetchWithTimeout.mockResolvedValue(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  it('approves a registration through the protected API', async () => {
    await approveRegistration({
      profileId: 'profile-id',
      role: 'cashier',
      stationIds: ['station-1', 'station-2'],
    })

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/approve-registration',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-id',
          role: 'cashier',
          stationIds: ['station-1', 'station-2'],
        }),
      },
      {
        timeoutMs: 10_000,
        timeoutMessage: 'Сервер не ответил. Проверьте соединение и повторите.',
      },
    )
    const [, init] = mocks.fetchWithTimeout.mock.calls[0]
    expect(init.headers).not.toHaveProperty('authorization')
    expect(mocks.supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects a registration through the protected API', async () => {
    await rejectRegistration({
      profileId: 'profile-id',
      reason: 'Missing documents',
    })

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/reject-registration',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-id',
          reason: 'Missing documents',
        }),
      },
      {
        timeoutMs: 10_000,
        timeoutMessage: 'Сервер не ответил. Проверьте соединение и повторите.',
      },
    )
    const [, init] = mocks.fetchWithTimeout.mock.calls[0]
    expect(init.headers).not.toHaveProperty('authorization')
    expect(mocks.supabase.rpc).not.toHaveBeenCalled()
  })

  it('deactivates a profile through the protected API', async () => {
    await deactivateProfile({
      profileId: 'profile-id',
      reason: 'No longer employed',
    })

    expect(mocks.fetchWithTimeout).toHaveBeenCalledWith(
      '/api/deactivate-profile',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: 'profile-id',
          reason: 'No longer employed',
        }),
      },
      {
        timeoutMs: 10_000,
        timeoutMessage: 'Сервер не ответил. Проверьте соединение и повторите.',
      },
    )
    const [, init] = mocks.fetchWithTimeout.mock.calls[0]
    expect(init.headers).not.toHaveProperty('authorization')
    expect(mocks.supabase.rpc).not.toHaveBeenCalled()
  })
})
