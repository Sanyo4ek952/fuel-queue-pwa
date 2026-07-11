/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createConsumerReservation: vi.fn(),
  useOnlineStatus: vi.fn(() => true),
}))

vi.mock('@/shared/api/rpc', () => ({
  createConsumerReservation: mocks.createConsumerReservation,
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: mocks.useOnlineStatus,
}))

import { useCreateConsumerReservation } from './use-create-consumer-reservation'

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const mutationParams = {
  vehicleId: 'vehicle-id',
  driverFullName: 'Иван Иванов',
  driverPhone: '+79991234567',
  fuelType: 'AI_95' as const,
  fuelPreferenceMode: 'EXACT' as const,
  comment: '',
  clientMutationId: 'mutation-id',
}

describe('useCreateConsumerReservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useOnlineStatus.mockReturnValue(true)
  })

  it('invalidates queue and today fueling status after creating a resident queue entry', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

    mocks.createConsumerReservation.mockResolvedValue({
      data: {
        id: 'reservation-id',
        queue_entry_id: 'reservation-id',
        permanent_number: 7,
        vehicle_id: 'vehicle-id',
        normalized_plate_number: 'А123ВС777',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        requested_liters: 20,
        queue_number: 7,
        ticket_number: 7,
        status: 'WAITING',
        client_mutation_id: 'mutation-id',
        allocation: null,
      },
      error: null,
    })

    const { result } = renderHook(() => useCreateConsumerReservation(), {
      wrapper: makeWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync(mutationParams)
    })

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-queue-status'] })
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['my-today-fueling-status'] })
  })

  it('shows a clear one-active-entry error from the server', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    mocks.createConsumerReservation.mockResolvedValue({
      data: null,
      error: 'CONSUMER_ACTIVE_RESERVATION_ALREADY_EXISTS',
    })

    const { result } = renderHook(() => useCreateConsumerReservation(), {
      wrapper: makeWrapper(queryClient),
    })

    await expect(result.current.mutateAsync(mutationParams)).rejects.toThrow(
      'У вас уже есть активная запись в очереди.',
    )
  })
})
