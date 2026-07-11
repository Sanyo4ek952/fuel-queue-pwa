/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { CreateReservationForm } from './create-reservation-form'

const mocks = vi.hoisted(() => ({
  createReservation: vi.fn(),
  createOfflineReservation: vi.fn(),
  isOnline: true,
}))

vi.mock('@/shared/api/rpc', () => ({ createReservation: mocks.createReservation }))
vi.mock('@/shared/lib/offline-db', () => ({ createOfflineReservation: mocks.createOfflineReservation }))
vi.mock('@/shared/lib/sync', () => ({ useOnlineStatus: () => mocks.isOnline }))
vi.mock('@/entities/profile', () => ({
  useCurrentProfile: () => ({ data: { id: 'profile-id', full_name: 'Оператор', role: 'cashier' } }),
}))

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CreateReservationForm />
    </QueryClientProvider>,
  )
}

describe('CreateReservationForm', () => {
  beforeEach(() => {
    mocks.isOnline = true
    mocks.createReservation.mockReset()
    mocks.createOfflineReservation.mockReset()
  })

  afterEach(() => cleanup())

  it('contains no date, station, time, or admission precheck', () => {
    renderForm()
    expect(screen.queryByLabelText(/дата/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/АЗС/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /проверить/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Госномер')).toBeInTheDocument()
    expect(screen.getByLabelText('Литры')).toBeInTheDocument()
  })

  it('submits only permanent queue entry fields', async () => {
    mocks.createReservation.mockResolvedValue({
      data: {
        id: 'entry-id', queue_entry_id: 'entry-id', permanent_number: 42,
        vehicle_id: 'vehicle-id', driver_id: 'driver-id', normalized_plate_number: 'А123ВС777',
        driver_full_name: 'Иван Иванов', driver_phone: '+79991234567', fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT', requested_liters: 20, queue_number: 42,
        ticket_number: 42, current_position: null, people_ahead: null, status: 'WAITING',
        client_mutation_id: 'mutation-id',
      },
      error: null,
    })
    renderForm()
    await userEvent.type(screen.getByLabelText('Госномер'), 'А123ВС777')
    await userEvent.type(screen.getByLabelText('Водитель'), 'Иван Иванов')
    await userEvent.type(screen.getByLabelText('Телефон'), '9991234567')
    await userEvent.click(screen.getByRole('button', { name: /добавить в очередь/i }))

    await waitFor(() => expect(mocks.createReservation).toHaveBeenCalledTimes(1))
    expect(mocks.createReservation.mock.calls[0][0]).not.toHaveProperty('date')
    expect(mocks.createReservation.mock.calls[0][0]).not.toHaveProperty('stationId')
    expect(await screen.findByText(/Постоянный номер №42/)).toBeInTheDocument()
  })
})
