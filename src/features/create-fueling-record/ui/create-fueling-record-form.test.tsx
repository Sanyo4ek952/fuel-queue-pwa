/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIONS } from '@/shared/config/stations'

import { createFuelingRecordSchema } from '../model/schema'
import { CreateFuelingRecordForm } from './create-fueling-record-form'

const mocks = vi.hoisted(() => ({
  onlineStatus: { value: true },
  checkVehicleAccess: vi.fn(),
  refreshVehicleAccessCache: vi.fn(),
  createFuelingRecord: vi.fn(),
  createOfflineFuelingRecord: vi.fn(),
  localReservationUpdate: vi.fn(),
  currentProfile: {
    id: 'profile-id',
    full_name: 'Петрова М.',
    role: 'cashier' as 'cashier' | 'mayor',
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
  createFuelingRecord: mocks.createFuelingRecord,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  createOfflineFuelingRecord: mocks.createOfflineFuelingRecord,
  offlineDb: {
    local_reservations: {
      update: mocks.localReservationUpdate,
    },
  },
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  )
}

async function checkPlate() {
  await userEvent.type(screen.getByLabelText('Госномер'), 'А123ВС777')
  await userEvent.click(screen.getByRole('button', { name: /проверить/i }))
}

describe('CreateFuelingRecordForm', () => {
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
    mocks.checkVehicleAccess.mockReset()
    mocks.refreshVehicleAccessCache.mockReset()
    mocks.createFuelingRecord.mockReset()
    mocks.createOfflineFuelingRecord.mockReset()
    mocks.localReservationUpdate.mockReset()
    mocks.currentProfile.role = 'cashier'
    mocks.currentProfile.stations = [STATIONS[0]]
    mocks.refreshVehicleAccessCache.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a disabled fuel select with desired fuel for exact reservations', async () => {
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС777',
        reservation_id: 'reservation-id',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        matched_fuel_type: 'AI_95',
      },
      error: null,
    })

    renderWithQueryClient(<CreateFuelingRecordForm />)
    await checkPlate()

    const fuelSelect = await screen.findByLabelText('Топливо')

    expect(fuelSelect).toBeDisabled()
    expect(within(fuelSelect).getByText('АИ-95')).toBeInTheDocument()
  })

  it('clears plate validation after the user starts editing again', async () => {
    renderWithQueryClient(<CreateFuelingRecordForm />)
    const plateInput = document.querySelector<HTMLInputElement>('#plateNumber')
    expect(plateInput).not.toBeNull()

    await userEvent.type(plateInput!, 'D123ZZ777')
    await userEvent.click(screen.getAllByRole('button')[0])

    const validationResult = createFuelingRecordSchema.safeParse({
      plateNumber: 'D123ZZ777',
      liters: 20,
      fuelType: 'AI_95',
      comment: '',
    })
    if (validationResult.success) {
      throw new Error('Expected invalid plate number')
    }
    const validationMessage = validationResult.error.issues[0]?.message
    if (!validationMessage) {
      throw new Error('Expected plate validation message')
    }
    expect(await screen.findByText(validationMessage)).toBeInTheDocument()

    await userEvent.clear(plateInput!)

    expect(screen.queryByText(validationMessage)).not.toBeInTheDocument()
  })

  it('shows a disabled fuel select with calculated replacement fuel', async () => {
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'ACTIVE_RESERVATION',
        normalized_plate_number: 'А123ВС777',
        reservation_id: 'reservation-id',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'ANY_GASOLINE',
        matched_fuel_type: 'AI_92',
      },
      error: null,
    })

    renderWithQueryClient(<CreateFuelingRecordForm />)
    await checkPlate()

    const fuelSelect = await screen.findByLabelText('Топливо')

    expect(fuelSelect).toBeDisabled()
    expect(within(fuelSelect).getByText('АИ-92')).toBeInTheDocument()
  })

  it('keeps fuel select enabled for manual override without reservation', async () => {
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'MANUAL_OVERRIDE_ACTIVE',
        normalized_plate_number: 'А123ВС777',
        manual_override_id: 'override-id',
        matched_fuel_type: null,
      },
      error: null,
    })
    mocks.createFuelingRecord.mockResolvedValue({
      data: {
        id: 'fueling-id',
        date: '2026-07-09',
        station_id: STATIONS[0].id,
        vehicle_id: 'vehicle-id',
        driver_id: null,
        reservation_id: null,
        queue_entry_id: null,
        preferential_queue_entry_id: null,
        fuel_type: 'DIESEL',
        liters: 20,
        is_manual_override: true,
        override_id: 'override-id',
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        fueled_at: '2026-07-09T00:00:00.000Z',
      },
      error: null,
    })

    renderWithQueryClient(<CreateFuelingRecordForm />)
    await checkPlate()

    const fuelSelect = await screen.findByLabelText('Топливо')
    expect(fuelSelect).toBeEnabled()

    await userEvent.click(fuelSelect)
    await userEvent.click(await screen.findByRole('option', { name: 'Дизель' }))
    await userEvent.click(screen.getByRole('button', { name: 'Заправить' }))

    await waitFor(() => {
      expect(mocks.createFuelingRecord).toHaveBeenCalledWith(
        expect.objectContaining({ fuelType: 'DIESEL' }),
      )
    })
  })

  it('hides preferential queue name for cashier', async () => {
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'PREFERENTIAL_QUEUE_ACTIVE',
        normalized_plate_number: 'А123ВС777',
        preferential_queue_entry_id: 'entry-id',
        preferential_queue_id: 'queue-id',
        preferential_queue_name: 'Врачи',
        fuel_type: 'AI_95',
        matched_fuel_type: 'AI_95',
        requested_liters: 40,
      },
      error: null,
    })

    renderWithQueryClient(<CreateFuelingRecordForm />)
    await checkPlate()

    expect(await screen.findByText('Льготная очередь')).toBeInTheDocument()
    expect(screen.queryByText('Врачи')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Машина есть в активной льготной очереди мэра.'),
    ).not.toBeInTheDocument()
  })

  it('shows preferential queue name for mayor', async () => {
    mocks.currentProfile.role = 'mayor'
    mocks.checkVehicleAccess.mockResolvedValue({
      data: {
        status: 'ALLOWED',
        reason: 'PREFERENTIAL_QUEUE_ACTIVE',
        normalized_plate_number: 'А123ВС777',
        preferential_queue_entry_id: 'entry-id',
        preferential_queue_id: 'queue-id',
        preferential_queue_name: 'Врачи',
        fuel_type: 'AI_95',
        matched_fuel_type: 'AI_95',
        requested_liters: 40,
      },
      error: null,
    })

    renderWithQueryClient(<CreateFuelingRecordForm />)
    await checkPlate()

    expect(await screen.findByText('Врачи')).toBeInTheDocument()
    expect(
      screen.queryByText('Машина есть в активной льготной очереди мэра.'),
    ).not.toBeInTheDocument()
  })
})
