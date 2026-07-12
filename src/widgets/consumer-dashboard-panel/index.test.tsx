/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  queueStatusError: null as Error | null,
  todayFuelingStatusError: null as Error | null,
  vehiclesError: null as Error | null,
  unlinkVehicleMutation: {
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    error: null as Error | null,
  },
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
    error: mocks.queueStatusError,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useMyTodayFuelingStatus: () => ({
    data: mocks.todayFuelingStatus,
    error: mocks.todayFuelingStatusError,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/features/manage-consumer-vehicles', () => ({
  AddConsumerVehicleForm: () => <div data-testid="add-vehicle-form" />,
  useConsumerVehicles: () => ({
    data: mocks.vehicles,
    error: mocks.vehiclesError,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useUnlinkConsumerVehicle: () => mocks.unlinkVehicleMutation,
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
    queue_entry_id: 'reservation-id',
    permanent_number: 7,
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
    status: 'WAITING',
    client_mutation_id: 'mutation-id',
    allocation: null,
    ...overrides,
  }
}

describe('ConsumerDashboardPanel', () => {
  beforeEach(() => {
    mocks.activeReservation = makeActiveReservation()
    mocks.todayFuelingStatus = null
    mocks.queueStatusError = null
    mocks.todayFuelingStatusError = null
    mocks.vehiclesError = null
    mocks.unlinkVehicleMutation.isPending = false
    mocks.unlinkVehicleMutation.error = null
    mocks.unlinkVehicleMutation.mutate.mockReset()
    mocks.unlinkVehicleMutation.reset.mockReset()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'unlink-mutation-id'),
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows permanent number as the consumer common queue position', () => {
    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('Постоянный номер в общей очереди №7')).toBeInTheDocument()
    expect(screen.getByText('Общая очередь')).toBeInTheDocument()
    expect(screen.getByText('№7')).toBeInTheDocument()
  })

  it('shows which vehicle is queued and keeps the create form hidden', () => {
    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('Автомобиль в очереди')).toBeInTheDocument()
    expect(screen.getAllByText('А123ВС777').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Можно поставить в очередь только один автомобиль'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('create-reservation-form')).not.toBeInTheDocument()
  })

  it('does not show current_position as a consumer queue position', () => {
    render(<ConsumerDashboardPanel />)

    expect(screen.queryByText('Позиция в очереди топлива')).not.toBeInTheDocument()
    expect(screen.queryByText('№3')).not.toBeInTheDocument()
  })

  it('shows daily distribution station context separately', () => {
    render(<ConsumerDashboardPanel />)

    const distribution = screen.getByText('Дневное распределение').closest('div')

    expect(distribution).not.toBeNull()
    expect(within(distribution as HTMLElement).getByText('АЗС №1')).toBeInTheDocument()
    expect(within(distribution as HTMLElement).getByText('Адрес 1')).toBeInTheDocument()
    expect(within(distribution as HTMLElement).getByText('В лимите')).toHaveClass(
      'bg-emerald-50',
      'text-emerald-700',
    )
    expect(within(distribution as HTMLElement).getByText('АИ-95')).toBeInTheDocument()
  })

  it('shows station returned by allocation over the base reservation station', () => {
    mocks.activeReservation = makeActiveReservation({
      station_name: 'АЗС из записи',
      station_address: 'Адрес из записи',
      allocation: {
        id: 'allocation-id',
        date: '2026-07-10',
        station_id: 'station-id-2',
        station_name: 'АЗС №2',
        station_address: 'Адрес 2',
        assigned_fuel_type: 'AI_95',
        daily_position: 3,
        station_position: 2,
        station_fuel_position: 2,
        arrival_at: '2026-07-10T10:00:00Z',
        status: 'ACTIVE',
        call_status: 'NOT_CALLED',
      },
    })

    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('АЗС №2')).toBeInTheDocument()
    expect(screen.getByText('Адрес 2')).toBeInTheDocument()
    expect(screen.queryByText('АЗС из записи')).not.toBeInTheDocument()
  })

  it('shows a clear fallback when station is not assigned yet', () => {
    mocks.activeReservation = makeActiveReservation({
      station_id: null,
      station_name: null,
      station_address: null,
      allocation: null,
      is_within_today_limit: null,
      matched_fuel_type: null,
    })

    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('Ожидает дневного распределения')).toBeInTheDocument()
    expect(screen.getByText('Ожидает распределения')).toBeInTheDocument()
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

  it('shows a Russian fallback for technical today fueling loading errors', () => {
    mocks.todayFuelingStatusError = new Error('Unexpected get_my_today_fueling_status response.')

    render(<ConsumerDashboardPanel />)

    expect(screen.getByText('Не удалось загрузить сегодняшнюю заправку')).toBeInTheDocument()
    expect(screen.getByText('Не удалось загрузить сегодняшнюю заправку.')).toBeInTheDocument()
    expect(screen.getByText('Активная запись')).toBeInTheDocument()
    expect(
      screen.queryByText('Unexpected get_my_today_fueling_status response.'),
    ).not.toBeInTheDocument()
  })

  it('asks for confirmation before unlinking a vehicle', async () => {
    const user = userEvent.setup()

    render(<ConsumerDashboardPanel />)

    await user.click(screen.getByLabelText('Отвязать номер А123ВС777'))

    expect(screen.getByRole('dialog', { name: 'Отвязать номер?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Номер А123ВС777 исчезнет из личного кабинета. Его нельзя отвязать, пока автомобиль стоит в активной очереди.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Отвязать' }))

    expect(mocks.unlinkVehicleMutation.mutate).toHaveBeenCalledWith(
      {
        profileVehicleId: 'profile-vehicle-id',
        clientMutationId: 'unlink-mutation-id',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
  })

  it('shows active queue unlinking errors in the confirmation dialog', async () => {
    const user = userEvent.setup()
    mocks.unlinkVehicleMutation.error = new Error(
      'Номер нельзя отвязать, пока автомобиль стоит в активной очереди. Сначала отмените запись или дождитесь завершения.',
    )

    render(<ConsumerDashboardPanel />)

    await user.click(screen.getByLabelText('Отвязать номер А123ВС777'))

    expect(screen.getByText('Номер не отвязан')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Номер нельзя отвязать, пока автомобиль стоит в активной очереди. Сначала отмените запись или дождитесь завершения.',
      ),
    ).toBeInTheDocument()
  })
})
