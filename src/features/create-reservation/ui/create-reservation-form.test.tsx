/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS, useSelectedStation } from '@/features/select-station'
import { getTomorrowDateInputValue } from '@/shared/lib/date'

import { CreateReservationForm } from './create-reservation-form'

const mocks = vi.hoisted(() => ({
  onlineStatus: { value: true },
  createReservation: vi.fn(),
  checkVehicleAccess: vi.fn(),
  refreshVehicleAccessCache: vi.fn(),
  getVehicleFuelingHistory: vi.fn(),
  checkVehicleAccessOffline: vi.fn(),
  getVehicleFuelingHistoryOffline: vi.fn(),
  markOfflineResult: vi.fn((result: { status: string; reason: string }, error?: string) => ({
    ...result,
    status: 'WARNING',
    reason: 'OFFLINE_UNCONFIRMED',
    offline: true,
    offline_decision: result.status,
    offline_reason: result.reason,
    error,
  })),
  markFuelingHistoryOfflineResult: vi.fn((result: Record<string, unknown>, error?: string) => ({
    ...result,
    offline: true,
    error,
  })),
  currentProfile: {
    id: 'profile-id',
    full_name: 'Мария Петрова',
    role: 'cashier',
    signature_name: 'Петрова М.',
    stations: [] as Array<{ id: string; name: string; address: string }>,
  },
}))

vi.mock('@/shared/api/rpc', () => ({
  createReservation: mocks.createReservation,
  checkVehicleAccess: mocks.checkVehicleAccess,
  refreshVehicleAccessCache: mocks.refreshVehicleAccessCache,
  getVehicleFuelingHistory: mocks.getVehicleFuelingHistory,
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: () => mocks.onlineStatus.value,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  checkVehicleAccessOffline: mocks.checkVehicleAccessOffline,
  getVehicleFuelingHistoryOffline: mocks.getVehicleFuelingHistoryOffline,
  markOfflineResult: mocks.markOfflineResult,
  markFuelingHistoryOfflineResult: mocks.markFuelingHistoryOfflineResult,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({
    data: mocks.currentProfile,
  }),
}))

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

describe('CreateReservationForm', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.onlineStatus.value = true
    useSelectedStation.setState({ selectedStationId: '' })
    mocks.createReservation.mockReset()
    mocks.checkVehicleAccess.mockReset()
    mocks.refreshVehicleAccessCache.mockReset()
    mocks.getVehicleFuelingHistory.mockReset()
    mocks.checkVehicleAccessOffline.mockReset()
    mocks.getVehicleFuelingHistoryOffline.mockReset()
    mocks.markOfflineResult.mockClear()
    mocks.markFuelingHistoryOfflineResult.mockClear()
    mocks.currentProfile.stations = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('disables submit until a station is selected', () => {
    renderWithQueryClient(<CreateReservationForm />)

    expect(screen.getByRole('button', { name: /создать запись/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /проверить/i })).toBeDisabled()
    expect(screen.getByText('Выберите АЗС перед созданием записи.')).toBeInTheDocument()
  })

  it('submits reservation fields for the selected station', async () => {
    mocks.currentProfile.stations = [STATIONS[0]]
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.createReservation.mockResolvedValue({
      data: {
        id: 'reservation-id',
        date: getTomorrowDateInputValue(),
        station_id: STATIONS[0].id,
        vehicle_id: 'vehicle-id',
        driver_id: 'driver-id',
        normalized_plate_number: 'А123ВС777',
        driver_full_name: 'Иван Иванов',
        driver_phone: null,
        fuel_type: 'AI_95',
        requested_liters: 40,
        queue_number: 1,
        status: 'RESERVED',
        client_mutation_id: 'mutation-id',
      },
      error: null,
    })

    renderWithQueryClient(<CreateReservationForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'А123ВС777')
    await userEvent.type(screen.getByLabelText('Водитель'), 'Иван Иванов')
    await userEvent.click(screen.getByRole('button', { name: /создать запись/i }))

    await waitFor(() => {
      expect(mocks.createReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: STATIONS[0].id,
          targetDate: getTomorrowDateInputValue(),
          plateNumber: 'А123ВС777',
          driverFullName: 'Иван Иванов',
          fuelType: 'AI_95',
          requestedLiters: 40,
        }),
      )
    })
  })

  it('checks vehicle access for the selected station and reservation date', async () => {
    mocks.currentProfile.stations = [STATIONS[0]]
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС777',
        queue_number: 7,
        fuel_type: 'AI_95',
        requested_liters: 40,
      },
      error: null,
    })
    mocks.getVehicleFuelingHistory.mockResolvedValue({
      data: {
        normalized_plate_number: 'А123ВС777',
        vehicle_id: 'vehicle-id',
        vehicle_found: true,
        total_fueling_count: 1,
        regular_fueling_count: 1,
        manual_override_fueling_count: 0,
        total_liters: 40,
        first_fueled_at: '2026-07-01T10:00:00.000Z',
        last_fueled_at: '2026-07-01T10:00:00.000Z',
        station_summaries: [],
        fuel_type_summaries: [],
        records: [
          {
            id: 'fueling-1',
            date: '2026-07-01',
            fueled_at: '2026-07-01T10:00:00.000Z',
            liters: 40,
            station_id: STATIONS[0].id,
            station_name: 'АЗС №1',
            fuel_type: 'AI_95',
            is_manual_override: false,
            sync_status: 'SYNCED',
          },
        ],
        has_more: false,
      },
      error: null,
    })

    renderWithQueryClient(<CreateReservationForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'А123ВС777')
    await userEvent.click(screen.getByRole('button', { name: /проверить/i }))

    await waitFor(() => {
      expect(mocks.checkVehicleAccess).toHaveBeenCalledWith({
        plateNumber: 'А123ВС777',
        stationId: STATIONS[0].id,
        checkDate: getTomorrowDateInputValue(),
      })
    })
    expect(await screen.findByText('Допуск разрешён')).toBeInTheDocument()
    expect(await screen.findByText('Заправки')).toBeInTheDocument()
    expect(mocks.getVehicleFuelingHistory).toHaveBeenCalledWith({
      plateNumber: 'А123ВС777',
      pageLimit: 10,
      pageOffset: 0,
    })
  })

  it('clears stale check result and history when check inputs change', async () => {
    mocks.currentProfile.stations = [STATIONS[0], STATIONS[1]]
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС77',
      },
      error: null,
    })
    mocks.getVehicleFuelingHistory.mockResolvedValue({
      data: {
        normalized_plate_number: 'А123ВС77',
        vehicle_id: 'vehicle-id',
        vehicle_found: true,
        total_fueling_count: 0,
        regular_fueling_count: 0,
        manual_override_fueling_count: 0,
        total_liters: 0,
        first_fueled_at: null,
        last_fueled_at: null,
        station_summaries: [],
        fuel_type_summaries: [],
        records: [],
        has_more: false,
      },
      error: null,
    })

    renderWithQueryClient(<CreateReservationForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC77')
    await userEvent.click(screen.getByRole('button', { name: /проверить/i }))

    expect(await screen.findByText('Допуск разрешён')).toBeInTheDocument()
    expect(await screen.findByText('Заправок не найдено.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Госномер'), '8')

    await waitFor(() => {
      expect(screen.queryByText('Допуск разрешён')).not.toBeInTheDocument()
      expect(screen.queryByText('Заправок не найдено.')).not.toBeInTheDocument()
    })

    mocks.checkVehicleAccess.mockResolvedValueOnce({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС778',
      },
      error: null,
    })

    await userEvent.click(screen.getByRole('button', { name: /проверить/i }))
    expect(await screen.findByText('Допуск разрешён')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Дата'))
    await userEvent.type(screen.getByLabelText('Дата'), '2026-07-10')

    await waitFor(() => {
      expect(screen.queryByText('Допуск разрешён')).not.toBeInTheDocument()
    })

    mocks.checkVehicleAccess.mockResolvedValueOnce({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС778',
      },
      error: null,
    })

    await userEvent.click(screen.getByRole('button', { name: /проверить/i }))
    expect(await screen.findByText('Допуск разрешён')).toBeInTheDocument()

    act(() => {
      useSelectedStation.setState({ selectedStationId: STATIONS[1].id })
    })

    await waitFor(() => {
      expect(screen.queryByText('Допуск разрешён')).not.toBeInTheDocument()
    })
  })
})
