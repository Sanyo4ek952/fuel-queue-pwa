/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TodayQueueRow } from '@/entities/reservation'

const mocks = vi.hoisted(() => {
  function makeTable() {
    return {
      put: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    }
  }

  return {
    createReservationCallLog: vi.fn(),
    currentProfile: {
      id: 'profile-id',
      full_name: 'Мария Петрова',
      role: 'cashier',
      signature_name: 'Петрова М.',
    },
    isOnline: true,
    offlineDb: {
      local_reservation_call_logs: makeTable(),
      local_reservations: makeTable(),
      sync_outbox: makeTable(),
      transaction: vi.fn(async (_mode: string, _tables: unknown[], callback: () => Promise<void>) =>
        callback(),
      ),
    },
  }
})

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({ data: mocks.currentProfile }),
}))

vi.mock('@/entities/reservation', () => ({
  todayQueueQueryKey: () => ['today-queue'],
}))

vi.mock('@/shared/api/rpc', async () => {
  const actual = await vi.importActual<typeof import('@/shared/api/rpc')>('@/shared/api/rpc')

  return {
    ...actual,
    createReservationCallLog: mocks.createReservationCallLog,
  }
})

vi.mock('@/shared/lib/offline-db', () => ({
  offlineDb: mocks.offlineDb,
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: () => mocks.isOnline,
}))

import { useLogReservationCall } from './use-log-reservation-call'

function makeQueueRow(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    id: 'reservation-id',
    date: null,
    station_id: null,
    vehicle_id: 'vehicle-id',
    driver_id: null,
    created_by_profile_id: 'profile-id',
    created_by_full_name: 'Мария Петрова',
    created_by_role: 'cashier',
    created_by_signature_name: 'Петрова М.',
    queue_number: 1,
    ticket_number: 1,
    current_position: 1,
    people_ahead: 0,
    normalized_plate_number: 'А123ВС777',
    driver_full_name: 'Иван Иванов',
    driver_phone: '+79990000000',
    fuel_type: 'AI_95',
    requested_liters: 40,
    status: 'RESERVED',
    sync_status: 'SYNCED',
    comment: null,
    client_mutation_id: null,
    is_offline: false,
    is_within_today_limit: true,
    is_callable_now: true,
    latest_call_status: null,
    latest_called_by_profile_id: null,
    latest_called_by_full_name: '',
    latest_called_by_role: null,
    latest_called_by_signature_name: null,
    latest_called_at: null,
    latest_call_comment: null,
    latest_call_client_mutation_id: null,
    latest_call_sync_status: null,
    ...overrides,
  }
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useLogReservationCall', () => {
  beforeEach(() => {
    mocks.createReservationCallLog.mockReset()
    mocks.offlineDb.local_reservation_call_logs.put.mockClear()
    mocks.offlineDb.local_reservations.update.mockClear()
    mocks.offlineDb.sync_outbox.put.mockClear()
    mocks.offlineDb.transaction.mockClear()
    mocks.isOnline = true

    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001',
    )
  })

  it('rejects any call status when the reservation is outside the call list', async () => {
    const { result } = renderHook(() => useLogReservationCall(), { wrapper: makeWrapper() })

    result.current.mutate({
      reservation: makeQueueRow({
        is_callable_now: false,
        call_unavailable_reason: 'OUTSIDE_TODAY_LIMIT',
      }),
      status: 'NO_ANSWER',
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toMatchObject({ message: 'OUTSIDE_TODAY_LIMIT' })
    expect(mocks.createReservationCallLog).not.toHaveBeenCalled()
  })

  it('allows resetting a contacted call outside the call list', async () => {
    mocks.createReservationCallLog.mockResolvedValue({
      data: {
        id: 'call-id',
        reservation_id: 'reservation-id',
        status: 'NOT_CALLED',
        called_by_profile_id: 'profile-id',
        called_by_full_name: 'Мария Петрова',
        called_by_role: 'cashier',
        called_by_signature_name: 'Петрова М.',
        called_at: '2026-07-07T10:30:00.000Z',
        comment: null,
        client_mutation_id: '00000000-0000-4000-8000-000000000001',
        sync_status: 'SYNCED',
      },
      error: null,
    })
    const { result } = renderHook(() => useLogReservationCall(), { wrapper: makeWrapper() })

    result.current.mutate({
      reservation: makeQueueRow({
        is_callable_now: false,
        call_unavailable_reason: 'ALREADY_CONTACTED',
        latest_call_status: 'CONTACTED',
      }),
      status: 'NOT_CALLED',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.createReservationCallLog).toHaveBeenCalledWith({
      reservationId: 'reservation-id',
      status: 'NOT_CALLED',
      comment: undefined,
      clientMutationId: '00000000-0000-4000-8000-000000000001',
    })
    expect(mocks.offlineDb.local_reservations.update).toHaveBeenCalledWith(
      'reservation-id',
      expect.objectContaining({
        latest_call_status: 'NOT_CALLED',
        latest_call_sync_status: 'SYNCED',
      }),
    )
  })

  it('does not enqueue an offline call status outside the call list', async () => {
    mocks.isOnline = false
    const { result } = renderHook(() => useLogReservationCall(), { wrapper: makeWrapper() })

    result.current.mutate({
      reservation: makeQueueRow({
        is_callable_now: false,
        call_unavailable_reason: 'NO_OPEN_DAILY_LIMIT',
      }),
      status: 'NO_ANSWER',
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toMatchObject({ message: 'NO_OPEN_DAILY_LIMIT' })
    expect(mocks.offlineDb.local_reservation_call_logs.put).not.toHaveBeenCalled()
    expect(mocks.offlineDb.sync_outbox.put).not.toHaveBeenCalled()
  })

  it('enqueues an offline contacted call reset outside the call list', async () => {
    mocks.isOnline = false
    const { result } = renderHook(() => useLogReservationCall(), { wrapper: makeWrapper() })

    result.current.mutate({
      reservation: makeQueueRow({
        is_callable_now: false,
        call_unavailable_reason: 'ALREADY_CONTACTED',
        latest_call_status: 'CONTACTED',
      }),
      status: 'NOT_CALLED',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.offlineDb.local_reservation_call_logs.put).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation_id: 'reservation-id',
        status: 'NOT_CALLED',
        sync_status: 'PENDING',
        client_mutation_id: '00000000-0000-4000-8000-000000000001',
      }),
    )
    expect(mocks.offlineDb.sync_outbox.put).toHaveBeenCalledWith(
      expect.objectContaining({
        client_mutation_id: '00000000-0000-4000-8000-000000000001',
        type: 'CREATE_ALLOCATION_CALL_LOG',
        status: 'PENDING',
      }),
    )
  })
})
