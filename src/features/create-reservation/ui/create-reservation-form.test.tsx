/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS } from '@/shared/config/stations'
import { getTodayDateInputValue } from '@/shared/lib/date'

import { CreateReservationForm } from './create-reservation-form'

const mocks = vi.hoisted(() => ({
  onlineStatus: { value: true },
  createReservation: vi.fn(),
  checkVehicleAccess: vi.fn(),
  refreshVehicleAccessCache: vi.fn(),
  getVehicleFuelingHistory: vi.fn(),
  createOfflineReservation: vi.fn(),
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
  createOfflineReservation: mocks.createOfflineReservation,
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
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false
    }

    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined
    }

    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => undefined
    }

    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => undefined
    }

    localStorage.clear()
    mocks.onlineStatus.value = true
    mocks.createReservation.mockReset()
    mocks.checkVehicleAccess.mockReset()
    mocks.refreshVehicleAccessCache.mockReset()
    mocks.getVehicleFuelingHistory.mockReset()
    mocks.createOfflineReservation.mockReset()
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

  it('renders global queue fields without station or date requirements', () => {
    renderWithQueryClient(<CreateReservationForm />)

    expect(screen.getByLabelText('Госномер')).toBeInTheDocument()
    expect(screen.getByLabelText('Водитель')).toBeInTheDocument()
    expect(screen.queryByLabelText('АЗС')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Дата')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /создать запись/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /проверить/i })).toBeDisabled()
    expect(screen.getByText(/АЗС не назначена. Проверка допуска недоступна/)).toBeInTheDocument()
  })

  it('submits reservation fields without station and date', async () => {
    mocks.createReservation.mockResolvedValue({
      data: {
        id: 'reservation-id',
        date: null,
        station_id: null,
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
          plateNumber: 'А123ВС777',
          driverFullName: 'Иван Иванов',
          fuelType: 'AI_95',
          requestedLiters: 40,
        }),
      )
    })
    expect(mocks.createReservation.mock.calls[0][0]).not.toMatchObject({
      stationId: expect.anything(),
      targetDate: expect.anything(),
    })
    expect(await screen.findByText('Запись создана')).toBeInTheDocument()
  })

  it('shows a clear error when the vehicle already has an active queue entry', async () => {
    mocks.createReservation.mockResolvedValue({
      data: null,
      error: 'ACTIVE_RESERVATION_ALREADY_EXISTS',
    })

    renderWithQueryClient(<CreateReservationForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'А123ВС777')
    await userEvent.type(screen.getByLabelText('Водитель'), 'Иван Иванов')
    await userEvent.click(screen.getByRole('button', { name: /создать запись/i }))

    expect(
      await screen.findByText('Автомобиль уже есть в очереди. Повторная запись запрещена.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Запись создана')).not.toBeInTheDocument()
    expect(mocks.createOfflineReservation).not.toHaveBeenCalled()
  })

  it('checks vehicle access for the selected station and today', async () => {
    mocks.currentProfile.stations = [STATIONS[0]]
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
        checkDate: getTodayDateInputValue(),
      })
    })
    expect(await screen.findByText('Допуск разрешен')).toBeInTheDocument()
    expect(screen.getByText('Допуск разрешен').compareDocumentPosition(screen.getByLabelText('Водитель'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(mocks.getVehicleFuelingHistory).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /История заправок/i }))

    expect(await screen.findByText('Заправки')).toBeInTheDocument()
    expect(mocks.getVehicleFuelingHistory).toHaveBeenCalledWith({
      plateNumber: 'А123ВС777',
      pageLimit: 5,
      pageOffset: 0,
    })
  })

  it('loads fueling history in batches of five from the accordion', async () => {
    mocks.currentProfile.stations = [STATIONS[0]]
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС777',
      },
      error: null,
    })
    mocks.getVehicleFuelingHistory
      .mockResolvedValueOnce({
        data: {
          normalized_plate_number: 'А123ВС777',
          vehicle_id: 'vehicle-id',
          vehicle_found: true,
          total_fueling_count: 11,
          regular_fueling_count: 11,
          manual_override_fueling_count: 0,
          total_liters: 440,
          first_fueled_at: '2026-07-01T10:00:00.000Z',
          last_fueled_at: '2026-07-11T10:00:00.000Z',
          station_summaries: [],
          fuel_type_summaries: [],
          records: [
            {
              id: 'fueling-11',
              date: '2026-07-11',
              fueled_at: '2026-07-11T10:00:00.000Z',
              liters: 40,
              station_id: STATIONS[0].id,
              station_name: 'АЗС №1',
              fuel_type: 'AI_95',
              is_manual_override: false,
              sync_status: 'SYNCED',
            },
          ],
          has_more: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          normalized_plate_number: 'А123ВС777',
          vehicle_id: 'vehicle-id',
          vehicle_found: true,
          total_fueling_count: 11,
          regular_fueling_count: 11,
          manual_override_fueling_count: 0,
          total_liters: 440,
          first_fueled_at: '2026-07-01T10:00:00.000Z',
          last_fueled_at: '2026-07-11T10:00:00.000Z',
          station_summaries: [],
          fuel_type_summaries: [],
          records: [
            {
              id: 'fueling-6',
              date: '2026-07-06',
              fueled_at: '2026-07-06T10:00:00.000Z',
              liters: 35,
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
    await screen.findByText('Допуск разрешен')

    expect(mocks.getVehicleFuelingHistory).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /История заправок/i }))

    await waitFor(() => {
      expect(mocks.getVehicleFuelingHistory).toHaveBeenCalledWith({
        plateNumber: 'А123ВС777',
        pageLimit: 5,
        pageOffset: 0,
      })
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить ещё' }))

    await waitFor(() => {
      expect(mocks.getVehicleFuelingHistory).toHaveBeenLastCalledWith({
        plateNumber: 'А123ВС777',
        pageLimit: 5,
        pageOffset: 5,
      })
    })
    expect(await screen.findByText('35 л')).toBeInTheDocument()
  })

  it('clears stale check result and history when plate or station changes', async () => {
    mocks.currentProfile.stations = [STATIONS[0], STATIONS[1]]
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС777',
      },
      error: null,
    })
    mocks.getVehicleFuelingHistory.mockResolvedValue({
      data: {
        normalized_plate_number: 'А123ВС777',
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
    const plateInput = screen.getByLabelText('Госномер')

    await userEvent.type(plateInput, 'А123ВС777')
    await userEvent.click(screen.getByRole('button', { name: /проверить/i }))

    expect(await screen.findByText('Допуск разрешен')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /История заправок/i }))
    expect(await screen.findByText('Заправок не найдено.')).toBeInTheDocument()

    await userEvent.clear(plateInput)
    await userEvent.type(plateInput, 'А123ВС778')

    await waitFor(() => {
      expect(screen.queryByText('Допуск разрешен')).not.toBeInTheDocument()
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
    expect(await screen.findByText('Допуск разрешен')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('АЗС'))
    await userEvent.click(await screen.findByRole('option', { name: STATIONS[1].name }))

    await waitFor(() => {
      expect(screen.queryByText('Допуск разрешен')).not.toBeInTheDocument()
    })
  })
})
