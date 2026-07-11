/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkVehicleAccess: vi.fn(),
  refreshVehicleAccessCache: vi.fn(),
  checkVehicleAccessOffline: vi.fn(),
  useOnlineStatus: vi.fn(() => true),
}))

vi.mock('@/shared/api/rpc', () => ({
  checkVehicleAccess: mocks.checkVehicleAccess,
  refreshVehicleAccessCache: mocks.refreshVehicleAccessCache,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  checkVehicleAccessOffline: mocks.checkVehicleAccessOffline,
  markOfflineResult: (result: object, error?: string) => ({
    ...result,
    status: 'WARNING',
    reason: 'OFFLINE_UNCONFIRMED',
    offline: true,
    error,
  }),
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: mocks.useOnlineStatus,
}))

import { useCheckVehicleAccess } from './use-check-vehicle-access'

const params = {
  plateNumber: 'K002MM777',
  stationId: 'station-id',
  checkDate: '2026-07-11',
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useCheckVehicleAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOnlineStatus.mockReturnValue(true)
  })

  it('returns the online access result even when offline cache refresh fails', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const onlineResult = {
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      normalized_plate_number: 'К002ММ777',
      allocation_id: 'allocation-id',
      reservation_id: 'queue-entry-id',
    }

    mocks.checkVehicleAccess.mockResolvedValue({ data: onlineResult, error: null })
    mocks.refreshVehicleAccessCache.mockRejectedValue(new Error('cache refresh failed'))

    const { result } = renderHook(() => useCheckVehicleAccess(), {
      wrapper: makeWrapper(queryClient),
    })

    let data: unknown
    await act(async () => {
      data = await result.current.mutateAsync(params)
    })

    expect(data).toBe(onlineResult)
    expect(mocks.checkVehicleAccess).toHaveBeenCalledWith(params)
    await waitFor(() => {
      expect(mocks.refreshVehicleAccessCache).toHaveBeenCalledWith(params)
    })
    expect(mocks.checkVehicleAccessOffline).not.toHaveBeenCalled()
  })
})
