/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeReservation: null as Record<string, unknown> | null,
  todayFuelingStatus: null as Record<string, unknown> | null,
  vehicles: [
    {
      id: 'vehicle-id',
      profile_vehicle_id: 'profile-vehicle-id',
      plate_number: 'A123BC777',
      normalized_plate_number: 'А123ВС777',
      is_blocked: false,
      block_reason: null,
      status: 'ACTIVE',
      created_at: '2026-07-09T10:00:00Z',
      updated_at: '2026-07-09T10:00:00Z',
    },
  ],
}))

vi.mock('@/features/cancel-consumer-reservation', () => ({
  useCancelConsumerReservation: () => ({
    isPending: false,
    mutate: vi.fn(),
    error: null,
  }),
}))

vi.mock('@/features/create-consumer-reservation', () => ({
  CreateConsumerReservationForm: () => <div data-testid="create-reservation-form" />,
  useMyQueueStatus: () => ({
    data: mocks.activeReservation,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useMyTodayFuelingStatus: () => ({
    data: mocks.todayFuelingStatus,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/manage-consumer-vehicles', () => ({
  AddConsumerVehicleForm: () => <div data-testid="add-vehicle-form" />,
  useConsumerVehicles: () => ({
    data: mocks.vehicles,
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/manage-fueling-schedule', () => ({
  useDailyFuelingSchedule: () => ({
    data: [],
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/update-reservation-fuel-preference', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/update-reservation-fuel-preference')
  >('@/features/update-reservation-fuel-preference')

  return {
    ...actual,
    useUpdateReservationFuelPreference: () => ({
      isPending: false,
      mutate: vi.fn(),
      error: null,
    }),
  }
})

import { ConsumerDashboardPanel } from './index'

function makeActiveReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reservation-id',
    date: '2026-07-10',
    station_id: 'station-id',
    station_name: 'АЗС №1',
    station_address: 'Адрес 1',
    vehicle_id: 'vehicle-id',
    driver_id: 'driver-id',
    normalized_plate_number: 'А123ВС777',
    driver_full_name: 'Иван Иванов',
    driver_phone: '+79991234567',
    fuel_type: 'AI_95',
    fuel_preference_mode: 'EXACT',
    requested_liters: 20,
    queue_number: 7,
    ticket_number: 7,
    current_position: 3,
    people_ahead: 2,
    is_within_today_limit: true,
    is_callable_now: true,
    matched_fuel_type: 'AI_95',
    is_fuel_preference_update_locked: false,
    status: 'RESERVED',
    client_mutation_id: 'mutation-id',
    ...overrides,
  }
}

describe('ConsumerDashboardPanel', () => {
  beforeEach(() => {
    mocks.activeReservation = makeActiveReservation()
    mocks.todayFuelingStatus = null
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows station name and address on the active reservation card', () => {
    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('АЗС №1')).toBeInTheDocument()
    expect(screen.getByText('Адрес 1')).toBeInTheDocument()
    expect(screen.getByText('В лимите')).toHaveClass('bg-emerald-50', 'text-emerald-700')
    expect(screen.getAllByText('АИ-95').length).toBeGreaterThan(0)
  })

  it('shows station assigned by the daily limit even when reservation station id is empty', () => {
    mocks.activeReservation = makeActiveReservation({
      station_id: null,
      station_name: 'АЗС №2',
      station_address: 'Адрес 2',
      is_within_today_limit: true,
    })

    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('АЗС №2')).toBeInTheDocument()
    expect(screen.getByText('Адрес 2')).toBeInTheDocument()
    expect(screen.queryByText('АЗС будет назначена')).not.toBeInTheDocument()
  })

  it('shows a clear fallback when station is not assigned yet', () => {
    mocks.activeReservation = makeActiveReservation({
      station_id: null,
      station_name: null,
      station_address: null,
    })

    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('АЗС будет назначена')).toBeInTheDocument()
  })

  it('shows today fueling status separately from the active reservation card', () => {
    mocks.activeReservation = null
    mocks.todayFuelingStatus = {
      id: 'fueling-id',
      date: '2026-07-10',
      station_id: 'station-id',
      station_name: 'АЗС №2',
      station_address: 'Адрес 2',
      vehicle_id: 'vehicle-id',
      reservation_id: 'reservation-id',
      normalized_plate_number: 'А123ВС777',
      fuel_type: 'DIESEL',
      liters: 25,
      fueled_at: '2026-07-10T10:00:00Z',
      ticket_number: 9,
    }

    render(<ConsumerDashboardPanel />)

    expect(screen.queryByText('Активная запись')).not.toBeInTheDocument()
    expect(screen.getByText('Сегодня заправлено')).toBeInTheDocument()
    expect(screen.getByText('АЗС №2')).toBeInTheDocument()
    expect(screen.getByText('Адрес 2')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.queryByTestId('create-reservation-form')).not.toBeInTheDocument()
  })
})
