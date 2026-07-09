/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS } from '@/shared/config/stations'

import { CheckVehicleForm } from './check-vehicle-form'

const mocks = vi.hoisted(() => ({
  onlineStatus: { value: true },
  checkVehicleAccess: vi.fn(),
  refreshVehicleAccessCache: vi.fn(),
  getVehicleFuelingHistory: vi.fn(),
  getVehicleRecentFuelingHistory: vi.fn(),
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
    full_name: 'Петрова М.',
    role: 'cashier',
    stations: [] as Array<{ id: string; name: string; address: string | null }>,
  },
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({ data: mocks.currentProfile }),
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: () => mocks.onlineStatus.value,
}))

vi.mock('@/shared/api/rpc', () => ({
  checkVehicleAccess: mocks.checkVehicleAccess,
  refreshVehicleAccessCache: mocks.refreshVehicleAccessCache,
  getVehicleFuelingHistory: mocks.getVehicleFuelingHistory,
  getVehicleRecentFuelingHistory: mocks.getVehicleRecentFuelingHistory,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  checkVehicleAccessOffline: mocks.checkVehicleAccessOffline,
  getVehicleFuelingHistoryOffline: mocks.getVehicleFuelingHistoryOffline,
  markOfflineResult: mocks.markOfflineResult,
  markFuelingHistoryOfflineResult: mocks.markFuelingHistoryOfflineResult,
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

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>,
  )
}

async function submitPlate(plateNumber = 'А123ВС777') {
  await userEvent.type(screen.getByLabelText('Госномер'), plateNumber)
  await userEvent.click(screen.getByRole('button', { name: /провер/i }))
}

describe('CheckVehicleForm', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.onlineStatus.value = true
    mocks.checkVehicleAccess.mockReset()
    mocks.refreshVehicleAccessCache.mockReset()
    mocks.getVehicleFuelingHistory.mockReset()
    mocks.getVehicleRecentFuelingHistory.mockReset()
    mocks.checkVehicleAccessOffline.mockReset()
    mocks.getVehicleFuelingHistoryOffline.mockReset()
    mocks.markOfflineResult.mockClear()
    mocks.markFuelingHistoryOfflineResult.mockClear()
    mocks.currentProfile.stations = [STATIONS[0]]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('requires a selected cashier station before checking access', async () => {
    mocks.currentProfile.stations = []
    renderWithQueryClient(<CheckVehicleForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'А123ВС777')

    expect(screen.getByRole('button', { name: /проверить/i })).toBeDisabled()
    expect(screen.getByText('АЗС не назначена. Проверка недоступна.')).toBeInTheDocument()
    expect(mocks.getVehicleFuelingHistory).not.toHaveBeenCalled()
    expect(mocks.getVehicleRecentFuelingHistory).not.toHaveBeenCalled()
    expect(mocks.checkVehicleAccess).not.toHaveBeenCalled()
  })

  it('loads only recent fueling history from the accordion and links to full history', async () => {
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'Рђ123Р’РЎ777',
      },
      error: null,
    })
    mocks.getVehicleRecentFuelingHistory
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
              id: 'fueling-1',
              date: '2026-07-01',
              fueled_at: '2026-07-01T10:00:00.000Z',
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

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()
    await userEvent.click(screen.getByRole('button', { name: /История заправок/i }))

    await waitFor(() =>
      expect(mocks.getVehicleRecentFuelingHistory).toHaveBeenCalledWith({
        plateNumber: 'А123ВС777',
      }),
    )
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/history?plate=%D0%90123%D0%92%D0%A1777',
    )
  })

  it('shows loading state while online station check is pending', async () => {
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockReturnValue(new Promise(() => undefined))

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(screen.getByRole('button', { name: 'Проверяем...' })).toBeDisabled()
  })

  it('formats plate input for display and submits the normalized value', async () => {
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'BLOCKED',
        reason: 'NO_ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС777',
      },
      error: null,
    })

    renderWithQueryClient(<CheckVehicleForm />)
    const plateInput = screen.getByLabelText('Госномер')

    await userEvent.type(plateInput, 'a123bc777')

    expect(plateInput).toHaveValue('А 123 ВС 777')

    await userEvent.click(screen.getByRole('button', { name: /проверить/i }))

    await waitFor(() => {
      expect(mocks.checkVehicleAccess).toHaveBeenCalledWith({
        plateNumber: 'А123ВС777',
        stationId: STATIONS[0].id,
        checkDate: expect.any(String),
      })
    })
  })

  it('shows plate validation only after blur', async () => {
    renderWithQueryClient(<CheckVehicleForm />)
    const plateInput = screen.getByLabelText('Госномер')

    await userEvent.type(plateInput, 'D123ZZ777')

    expect(screen.queryByText('Введите номер в формате А 123 ВС 777')).not.toBeInTheDocument()

    await userEvent.tab()

    expect(await screen.findByText('Введите номер в формате А 123 ВС 777')).toBeInTheDocument()
  })

  it('renders an allowed online result for a selected station', async () => {
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

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(await screen.findByText('Допуск разрешен')).toBeInTheDocument()
    expect(screen.getByText('№7')).toBeInTheDocument()
    expect(screen.getByText('AI_95')).toBeInTheDocument()
  })

  it('renders an offline warning result for a selected station', async () => {
    mocks.onlineStatus.value = false
    mocks.checkVehicleAccessOffline.mockResolvedValue({
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      normalized_plate_number: 'А123ВС777',
    })

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(await screen.findByText('Нужно подтверждение')).toBeInTheDocument()
    expect(
      screen.getByText('Offline-проверка требует серверного подтверждения.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Данные сохранены локально и будут перепроверены сервером/),
    ).toBeInTheDocument()
    await waitFor(() => expect(mocks.checkVehicleAccess).not.toHaveBeenCalled())
  })
})
