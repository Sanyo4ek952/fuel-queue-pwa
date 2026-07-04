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
  checkVehicleAccessOffline: vi.fn(),
  markOfflineResult: vi.fn((result: { status: string; reason: string }, error?: string) => ({
    ...result,
    status: 'WARNING',
    reason: 'OFFLINE_UNCONFIRMED',
    offline: true,
    offline_decision: result.status,
    offline_reason: result.reason,
    error,
  })),
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: () => mocks.onlineStatus.value,
}))

vi.mock('@/shared/api/rpc', () => ({
  checkVehicleAccess: mocks.checkVehicleAccess,
  refreshVehicleAccessCache: mocks.refreshVehicleAccessCache,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  checkVehicleAccessOffline: mocks.checkVehicleAccessOffline,
  markOfflineResult: mocks.markOfflineResult,
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
    mocks.checkVehicleAccessOffline.mockReset()
    mocks.markOfflineResult.mockClear()
    useSelectedStation.setState({ selectedStationId: '' })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('disables submit until a station is selected', () => {
    renderWithQueryClient(<CheckVehicleForm />)

    expect(screen.getByRole('button', { name: /провер/i })).toBeDisabled()
    expect(screen.getByText('Выберите АЗС перед проверкой.')).toBeInTheDocument()
  })

  it('shows loading state while online check is pending', async () => {
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockReturnValue(new Promise(() => undefined))

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(screen.getByRole('button', { name: 'Проверяем...' })).toBeDisabled()
  })

  it('renders an allowed online result', async () => {
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС',
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

  it('renders an offline warning result', async () => {
    mocks.onlineStatus.value = false
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.checkVehicleAccessOffline.mockResolvedValue({
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      normalized_plate_number: 'А123ВС',
    })

    renderWithQueryClient(<CheckVehicleForm />)
    await submitPlate()

    expect(await screen.findByText('Нужно подтверждение')).toBeInTheDocument()
    expect(screen.getByText('Offline-проверка требует серверного подтверждения.')).toBeInTheDocument()
    expect(screen.getByText(/Данные сохранены локально/)).toBeInTheDocument()
    await waitFor(() => expect(mocks.checkVehicleAccess).not.toHaveBeenCalled())
  })
})
