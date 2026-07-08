/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateReservationFuelPreference: vi.fn(),
  localReservationUpdate: vi.fn(),
  useOnlineStatus: vi.fn(() => true),
}))

vi.mock('@/entities/reservation', () => ({
  todayQueueQueryKey: () => ['today-queue'],
}))

vi.mock('@/shared/api/rpc', () => ({
  updateReservationFuelPreference: mocks.updateReservationFuelPreference,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  offlineDb: {
    local_reservations: {
      update: mocks.localReservationUpdate,
    },
  },
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: mocks.useOnlineStatus,
}))

import { useUpdateReservationFuelPreference } from './use-update-reservation-fuel-preference'

type QueueRow = {
  id: string
  queue_number: number
  fuel_type: string
  fuel_preference_mode: string
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useUpdateReservationFuelPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOnlineStatus.mockReturnValue(true)
  })

  it('updates queue cache and local reservation without changing queue number', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

    queryClient.setQueryData<QueueRow[]>(['today-queue'], [
      {
        id: 'reservation-id',
        queue_number: 7,
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
      },
    ])
    mocks.updateReservationFuelPreference.mockResolvedValue({
      data: {
        id: 'reservation-id',
        date: '2026-07-08',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_92',
        fuel_preference_mode: 'ANY_GASOLINE',
        queue_number: 7,
        status: 'RESERVED',
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        updated_at: '2026-07-08T10:00:00.000Z',
      },
      error: null,
    })

    const { result } = renderHook(() => useUpdateReservationFuelPreference(), {
      wrapper: makeWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        reservationId: 'reservation-id',
        fuelType: 'AI_92',
        fuelPreferenceMode: 'ANY_GASOLINE',
        clientMutationId: 'mutation-id',
      })
    })

    expect(queryClient.getQueryData<QueueRow[]>(['today-queue'])).toEqual([
      expect.objectContaining({
        id: 'reservation-id',
        queue_number: 7,
        fuel_type: 'AI_92',
        fuel_preference_mode: 'ANY_GASOLINE',
      }),
    ])
    expect(mocks.localReservationUpdate).toHaveBeenCalledWith(
      'reservation-id',
      expect.objectContaining({
        queue_number: 7,
        fuel_type: 'AI_92',
        fuel_preference_mode: 'ANY_GASOLINE',
      }),
    )
    expect(invalidateQueriesSpy).toHaveBeenCalled()
  })

  it('blocks updates while offline', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    mocks.useOnlineStatus.mockReturnValue(false)

    const { result } = renderHook(() => useUpdateReservationFuelPreference(), {
      wrapper: makeWrapper(queryClient),
    })

    await expect(
      result.current.mutateAsync({
        reservationId: 'reservation-id',
        fuelType: 'AI_92',
        fuelPreferenceMode: 'ANY_GASOLINE',
        clientMutationId: 'mutation-id',
      }),
    ).rejects.toThrow('OFFLINE_UNAVAILABLE')
  })

  it('shows a clear error when fuel editing is locked by an open limit', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    mocks.updateReservationFuelPreference.mockResolvedValue({
      data: null,
      error: 'FUEL_PREFERENCE_LOCKED_BY_OPEN_LIMIT',
    })

    const { result } = renderHook(() => useUpdateReservationFuelPreference(), {
      wrapper: makeWrapper(queryClient),
    })

    await expect(
      result.current.mutateAsync({
        reservationId: 'reservation-id',
        fuelType: 'AI_92',
        fuelPreferenceMode: 'ANY_GASOLINE',
        clientMutationId: 'mutation-id',
      }),
    ).rejects.toThrow('Топливо нельзя изменить после открытия лимитов на сегодня.')

    expect(mocks.localReservationUpdate).not.toHaveBeenCalled()
  })
})
