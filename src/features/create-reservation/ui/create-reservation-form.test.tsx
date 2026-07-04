/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS, useSelectedStation } from '@/features/select-station'
import { getTomorrowDateInputValue } from '@/shared/lib/date'

import { CreateReservationForm } from './create-reservation-form'

const mocks = vi.hoisted(() => ({
  createReservation: vi.fn(),
}))

vi.mock('@/shared/api/rpc', () => ({
  createReservation: mocks.createReservation,
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
    useSelectedStation.setState({ selectedStationId: '' })
    mocks.createReservation.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('disables submit until a station is selected', () => {
    renderWithQueryClient(<CreateReservationForm />)

    expect(screen.getByRole('button', { name: /создать запись/i })).toBeDisabled()
    expect(screen.getByText('Выберите АЗС перед созданием записи.')).toBeInTheDocument()
  })

  it('submits reservation fields for the selected station', async () => {
    useSelectedStation.setState({ selectedStationId: STATIONS[0].id })
    mocks.createReservation.mockResolvedValue({
      data: {
        id: 'reservation-id',
        date: getTomorrowDateInputValue(),
        station_id: STATIONS[0].id,
        vehicle_id: 'vehicle-id',
        driver_id: 'driver-id',
        normalized_plate_number: 'A123BC',
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
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC')
    await userEvent.type(screen.getByLabelText('Водитель'), 'Иван Иванов')
    await userEvent.click(screen.getByRole('button', { name: /создать запись/i }))

    await waitFor(() => {
      expect(mocks.createReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: STATIONS[0].id,
          targetDate: getTomorrowDateInputValue(),
          plateNumber: 'A123BC',
          driverFullName: 'Иван Иванов',
          fuelType: 'AI_95',
          requestedLiters: 40,
        }),
      )
    })
  })
})
