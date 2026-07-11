/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateConsumerReservationForm } from './create-consumer-reservation-form'

const mocks = vi.hoisted(() => ({
  createConsumerReservation: vi.fn(),
  getResidentFuelNorm: vi.fn(),
  useCurrentProfile: vi.fn(),
  useOnlineStatus: vi.fn(() => true),
}))

vi.mock('@/shared/api/rpc', () => ({
  createConsumerReservation: mocks.createConsumerReservation,
  getResidentFuelNorm: mocks.getResidentFuelNorm,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: mocks.useCurrentProfile,
}))

vi.mock('@/shared/lib/sync', () => ({
  useOnlineStatus: mocks.useOnlineStatus,
}))

const vehicles = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    profile_vehicle_id: '00000000-0000-4000-8000-000000000011',
    plate_number: 'A123AA777',
    normalized_plate_number: 'A123AA777',
    is_blocked: false,
    block_reason: null,
    status: 'ACTIVE' as const,
    created_at: '2026-07-11T10:00:00Z',
    updated_at: '2026-07-11T10:00:00Z',
  },
]

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

describe('CreateConsumerReservationForm', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-000000000099',
    })

    mocks.createConsumerReservation.mockReset()
    mocks.getResidentFuelNorm.mockReset()
    mocks.useCurrentProfile.mockReturnValue({
      data: { id: 'profile-id', full_name: 'Иван Иванов', role: 'consumer' },
    })
    mocks.useOnlineStatus.mockReturnValue(true)
    mocks.getResidentFuelNorm.mockResolvedValue({
      data: { liters: 25 },
      error: null,
    })
    mocks.createConsumerReservation.mockResolvedValue({
      data: {
        id: 'reservation-id',
        queue_entry_id: 'reservation-id',
        permanent_number: 7,
        vehicle_id: vehicles[0].id,
        normalized_plate_number: vehicles[0].normalized_plate_number,
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        requested_liters: 25,
        queue_number: 7,
        ticket_number: 7,
        status: 'WAITING',
        client_mutation_id: '00000000-0000-4000-8000-000000000099',
        allocation: null,
      },
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the server-controlled resident norm instead of a liters input', async () => {
    renderWithQueryClient(<CreateConsumerReservationForm vehicles={vehicles} />)

    expect(screen.queryByLabelText('Литры')).not.toBeInTheDocument()
    expect(await screen.findByText('Норма литров')).toBeInTheDocument()
    expect(await screen.findByText('25 л')).toBeInTheDocument()
  })

  it('submits a resident reservation without requested liters from the form', async () => {
    renderWithQueryClient(<CreateConsumerReservationForm vehicles={vehicles} />)

    await userEvent.type(screen.getByLabelText('Телефон'), '9991234567')
    await userEvent.click(screen.getByRole('button', { name: /Создать запись/i }))

    await waitFor(() => {
      expect(mocks.createConsumerReservation).toHaveBeenCalledTimes(1)
    })

    expect(mocks.createConsumerReservation.mock.calls[0][0]).not.toHaveProperty('requestedLiters')
    expect(mocks.createConsumerReservation.mock.calls[0][0]).toMatchObject({
      vehicleId: vehicles[0].id,
      driverFullName: 'Иван Иванов',
      fuelType: 'AI_95',
      clientMutationId: '00000000-0000-4000-8000-000000000099',
    })
  })
})
