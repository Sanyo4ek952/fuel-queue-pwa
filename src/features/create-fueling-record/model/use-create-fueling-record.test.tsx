/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createFuelingRecord: vi.fn(),
  createOfflineFuelingRecord: vi.fn(),
  localReservationUpdate: vi.fn(),
  useOnlineStatus: vi.fn(() => true),
}))

vi.mock('@/entities/reservation', () => ({
  todayQueueQueryKey: () => ['today-queue'],
}))

vi.mock('@/shared/api/rpc', () => ({
  createFuelingRecord: mocks.createFuelingRecord,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  createOfflineFuelingRecord: mocks.createOfflineFuelingRecord,
  offlineDb: {
    local_reservations: {
      update: mocks.localReservationUpdate,
    },
  },
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: mocks.useOnlineStatus,
}))

import { useCreateFuelingRecord } from './use-create-fueling-record'

type QueueRow = {
  id: string
  queue_number: number
}

const mutationParams = {
  stationId: 'station-id',
  plateNumber: 'A123BC777',
  liters: 40,
  fuelType: 'AI_95' as const,
  targetDate: '2026-07-05',
  fueledAt: '2026-07-05T10:00:00.000Z',
  clientMutationId: 'mutation-id',
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useCreateFuelingRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOnlineStatus.mockReturnValue(true)
  })

  it('removes fueled reservation from queue cache, updates local snapshot, and invalidates queue data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

    queryClient.setQueryData<QueueRow[]>(['today-queue'], [
      { id: 'reservation-id', queue_number: 1 },
      { id: 'next-reservation-id', queue_number: 3 },
    ])
    mocks.createFuelingRecord.mockResolvedValue({
      data: {
        id: 'fueling-id',
        date: '2026-07-05',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        driver_id: null,
        reservation_id: 'reservation-id',
        queue_entry_id: null,
        preferential_queue_entry_id: null,
        fuel_type: 'AI_95',
        liters: 40,
        is_manual_override: false,
        override_id: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        fueled_at: '2026-07-05T10:00:00.000Z',
      },
      error: null,
    })

    const { result } = renderHook(() => useCreateFuelingRecord(), {
      wrapper: makeWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync(mutationParams)
    })

    expect(queryClient.getQueryData<QueueRow[]>(['today-queue'])).toEqual([
      { id: 'next-reservation-id', queue_number: 3 },
    ])
    expect(mocks.localReservationUpdate).toHaveBeenCalledWith(
      'reservation-id',
      expect.objectContaining({ status: 'FUELED' }),
    )
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    })
  })

  it('invalidates preferential queues after preferential fueling without touching today queue cache', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

    queryClient.setQueryData<QueueRow[]>(['today-queue'], [
      { id: 'reservation-id', queue_number: 1 },
    ])
    mocks.createFuelingRecord.mockResolvedValue({
      data: {
        id: 'fueling-id',
        date: '2026-07-05',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        driver_id: null,
        reservation_id: null,
        queue_entry_id: null,
        preferential_queue_entry_id: 'preferential-entry-id',
        fuel_type: 'AI_95',
        liters: 20,
        is_manual_override: false,
        override_id: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        fueled_at: '2026-07-05T10:00:00.000Z',
      },
      error: null,
    })

    const { result } = renderHook(() => useCreateFuelingRecord(), {
      wrapper: makeWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ ...mutationParams, liters: 20 })
    })

    expect(queryClient.getQueryData<QueueRow[]>(['today-queue'])).toEqual([
      { id: 'reservation-id', queue_number: 1 },
    ])
    expect(mocks.localReservationUpdate).not.toHaveBeenCalled()
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['preferential-queues'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      predicate: expect.any(Function),
    })
  })
})
