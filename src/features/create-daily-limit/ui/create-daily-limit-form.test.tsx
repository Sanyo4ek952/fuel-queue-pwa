/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS, useSelectedStation } from '@/features/select-station'

import { CreateDailyLimitForm } from './create-daily-limit-form'

const mocks = vi.hoisted(() => ({
  createDailyLimit: vi.fn(),
}))

vi.mock('@/shared/api/rpc', () => ({
  createDailyLimit: mocks.createDailyLimit,
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

describe('CreateDailyLimitForm', () => {
  beforeEach(() => {
    localStorage.clear()
    useSelectedStation.setState({ selectedStationId: '' })
    mocks.createDailyLimit.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('disables submit until a station is selected', () => {
    renderWithQueryClient(<CreateDailyLimitForm />)

    expect(screen.getByRole('button', { name: /сохранить лимит/i })).toBeDisabled()
    expect(screen.getByText('Выберите АЗС перед созданием лимита.')).toBeInTheDocument()
  })

  it('submits default limit values for the selected station', async () => {
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.createDailyLimit.mockResolvedValue({
      data: {
        id: 'limit-id',
        date: '2026-07-05',
        station_id: STATIONS[0].id,
        total_vehicle_limit: 100,
        max_liters_per_vehicle: 50,
        status: 'OPEN',
        client_mutation_id: 'mutation-id',
        fuel_type_limits: [],
      },
      error: null,
    })

    renderWithQueryClient(<CreateDailyLimitForm />)
    await userEvent.click(screen.getByRole('button', { name: /сохранить лимит/i }))

    await waitFor(() => {
      expect(mocks.createDailyLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: STATIONS[0].id,
          totalVehicleLimit: 100,
          maxLitersPerVehicle: 50,
        }),
      )
    })
  })
})
