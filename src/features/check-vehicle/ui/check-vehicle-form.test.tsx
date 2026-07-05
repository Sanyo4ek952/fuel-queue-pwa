/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS, useSelectedStation } from '@/features/select-station'

import { CheckVehicleForm } from './check-vehicle-form'

const mocks = vi.hoisted(() => ({
  onlineStatus: { value: true },
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
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({ data: null }),
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: () => mocks.onlineStatus.value,
}))

vi.mock('@/shared/api/rpc', () => ({
  checkVehicleAccess: mocks.checkVehicleAccess,
  refreshVehicleAccessCache: mocks.refreshVehicleAccessCache,
  getVehicleFuelingHistory: mocks.getVehicleFuelingHistory,
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

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

async function submitPlate(plateNumber = 'A123BC') {
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
    mocks.checkVehicleAccessOffline.mockReset()
    mocks.getVehicleFuelingHistoryOffline.mockReset()
    mocks.markOfflineResult.mockClear()
    mocks.markFuelingHistoryOfflineResult.mockClear()
    useSelectedStation.setState({ selectedStationId: '' })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('checks fueling history across all stations without a selected station', async () => {
    mocks.getVehicleFuelingHistory.mockResolvedValue({
      data: {
        normalized_plate_number: 'A123BC',
        vehicle_id: 'vehicle-id',
        vehicle_found: true,
        total_fueling_count: 3,
        regular_fueling_count: 3,
        manual_override_fueling_count: 0,
        total_liters: 120,
        first_fueled_at: '2026-07-01T10:00:00.000Z',
        last_fueled_at: '2026-07-05T10:00:00.000Z',
        station_summaries: [
          {
            station_id: STATIONS[0].id,
            station_name: 'АЗС №1',
            fueling_count: 3,
            total_liters: 120,
          },
        ],
        fuel_type_summaries: [],
        records: [
          {
            id: 'fueling-1',
            date: '2026-07-05',
            fueled_at: '2026-07-05T10:00:00.000Z',
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

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(await screen.findByText('История заправок по всем АЗС')).toBeInTheDocument()
    expect(mocks.getVehicleFuelingHistory).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /История заправок/i }))

    expect(await screen.findByText('Заправки')).toBeInTheDocument()
    expect(screen.getByText('40 л')).toBeInTheDocument()
    expect(mocks.getVehicleFuelingHistory).toHaveBeenCalledWith({
      plateNumber: 'A123BC',
      pageLimit: 10,
      pageOffset: 0,
    })
    expect(mocks.checkVehicleAccess).not.toHaveBeenCalled()
  })

  it('loads more fueling history items from the accordion', async () => {
    mocks.getVehicleFuelingHistory
      .mockResolvedValueOnce({
        data: {
          normalized_plate_number: 'A123BC',
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
          normalized_plate_number: 'A123BC',
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
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить ещё' }))

    await waitFor(() =>
      expect(mocks.getVehicleFuelingHistory).toHaveBeenLastCalledWith({
        plateNumber: 'A123BC',
        pageLimit: 10,
        pageOffset: 10,
      }),
    )
    expect(await screen.findByText('35 л')).toBeInTheDocument()
  })

  it('shows loading state while online station check is pending', async () => {
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockReturnValue(new Promise(() => undefined))

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(screen.getByRole('button', { name: 'Проверяем...' })).toBeDisabled()
  })

  it('renders an allowed online result for a selected station', async () => {
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'A123BC',
        queue_number: 7,
        fuel_type: 'AI_95',
        requested_liters: 40,
      },
      error: null,
    })

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(await screen.findByText('Допуск разрешён')).toBeInTheDocument()
    expect(screen.getByText('№7')).toBeInTheDocument()
    expect(screen.getByText('AI_95')).toBeInTheDocument()
  })

  it('renders an offline warning result for a selected station', async () => {
    mocks.onlineStatus.value = false
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.checkVehicleAccessOffline.mockResolvedValue({
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      normalized_plate_number: 'A123BC',
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
