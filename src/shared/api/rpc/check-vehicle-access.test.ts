import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))

import { checkVehicleAccess } from './check-vehicle-access'

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('checkVehicleAccess', () => {
  it('calls the protected API with normalized access check parameters', async () => {
    const normalizedPlateNumber = '\u0410123\u0412\u0421777'

    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'A123BC777',
        allocation_id: 'allocation-id',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await checkVehicleAccess({
      plateNumber: ' a 123 bc 777 ',
      stationId: 'station-id',
      checkDate: '2026-07-12',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/check-vehicle-access',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          plateNumber: normalizedPlateNumber,
          stationId: 'station-id',
          checkDate: '2026-07-12',
        }),
      }),
    )
    expect(result).toMatchObject({
      data: {
        status: 'ALLOWED',
        allocation_id: 'allocation-id',
      },
      error: null,
    })
  })

  it('returns protected API errors', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse({ error: 'FORBIDDEN' }, 403)))

    await expect(
      checkVehicleAccess({
        plateNumber: 'A123BC777',
        stationId: 'station-id',
        checkDate: '2026-07-12',
      }),
    ).resolves.toEqual({
      data: null,
      error: 'FORBIDDEN',
    })
  })
})
