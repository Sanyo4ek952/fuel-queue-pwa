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

import { getCurrentProfile, type CurrentProfile } from './index'

const profile: CurrentProfile = {
  id: 'profile-id',
  auth_user_id: 'auth-user-id',
  full_name: 'Test User',
  first_name: 'Test',
  last_name: 'User',
  middle_name: null,
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
      { headers: { Authorization: 'Bearer access-token' } },
      { timeoutMs: 8_000, timeoutMessage: 'Current profile request timed out.' },
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
      new Response(JSON.stringify({ error: 'Authorization token is invalid.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    mocks.getCachedCurrentProfile.mockResolvedValue(profile)

    await expect(getCurrentProfile()).rejects.toThrow('Authorization token is invalid.')
    expect(mocks.getCachedCurrentProfile).not.toHaveBeenCalled()
  })
})
