/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TodayQueueRow } from '@/entities/reservation'

const mocks = vi.hoisted(() => ({
  mutateCall: vi.fn(),
  mutateCancel: vi.fn(),
  mutateFuelPreference: vi.fn(),
  useTodayQueue: vi.fn(),
  useDailyLimitOverview: vi.fn(),
  useDailyFuelingSchedule: vi.fn(),
  useLogReservationCall: vi.fn(),
  useUpdateReservationFuelPreference: vi.fn(),
  useCurrentProfile: vi.fn(),
  useCancelReservation: vi.fn(),
}))

vi.mock('@/entities/daily-limit', () => ({
  useDailyLimitOverview: mocks.useDailyLimitOverview,
}))

vi.mock('@/entities/reservation', () => ({
  useTodayQueue: mocks.useTodayQueue,
}))

vi.mock('@/entities/profile', () => ({
  useCurrentProfile: mocks.useCurrentProfile,
}))

vi.mock('@/features/cancel-reservation', async () => {
  const actual = await vi.importActual<typeof import('@/features/cancel-reservation')>(
    '@/features/cancel-reservation',
  )

  return {
    ...actual,
    useCancelReservation: mocks.useCancelReservation,
  }
})

vi.mock('@/features/manage-fueling-schedule', () => ({
  useDailyFuelingSchedule: mocks.useDailyFuelingSchedule,
}))

vi.mock('@/features/log-reservation-call', () => ({
  useLogReservationCall: mocks.useLogReservationCall,
}))

vi.mock('@/features/update-reservation-fuel-preference', async () => {
  const actual = await vi.importActual<typeof import('@/features/update-reservation-fuel-preference')>(
    '@/features/update-reservation-fuel-preference',
  )

  return {
    ...actual,
    useUpdateReservationFuelPreference: mocks.useUpdateReservationFuelPreference,
  }
})

import { TodayQueuePanel } from './index'

const CALL_FILTER_NAME = '\u041e\u0431\u0437\u0432\u043e\u043d'
const PLATE_SEARCH_NAME = '\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0433\u043e\u0441\u043d\u043e\u043c\u0435\u0440\u0443'
const AUTHOR_FILTER_NAME = '\u041a\u0442\u043e \u0434\u043e\u0431\u0430\u0432\u0438\u043b'
const TODAY_ARRIVALS_LABEL = '\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u0440\u0438\u0435\u0434\u0443\u0442'
const DETAILS_BUTTON_NAME = '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0435\u0442\u0430\u043b\u0438'

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: vi.fn(() => 'mutation-id'),
      configurable: true,
    })
  }
})

function makeQueueRow(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    id: 'reservation-id',
    date: null,
    station_id: null,
    vehicle_id: 'vehicle-id',
    driver_id: null,
    created_by_profile_id: 'profile-id',
    created_by_full_name: 'Мария Петрова',
    created_by_role: 'cashier',
    created_by_signature_name: 'Петрова М.',
    queue_number: 1,
    ticket_number: 1,
    current_position: 1,
    people_ahead: 0,
    normalized_plate_number: 'А123ВС777',
    driver_full_name: 'Иван Иванов',
    driver_phone: '+79990000000',
    fuel_type: 'AI_95',
    requested_liters: 40,
    status: 'RESERVED',
    sync_status: 'SYNCED',
    comment: null,
    client_mutation_id: null,
    is_offline: false,
    is_within_today_limit: true,
    latest_call_status: null,
    latest_called_by_profile_id: null,
    latest_called_by_full_name: '',
    latest_called_by_role: null,
    latest_called_by_signature_name: null,
    latest_called_at: null,
    latest_call_comment: null,
    latest_call_client_mutation_id: null,
    latest_call_sync_status: null,
    ...overrides,
  }
}

function makeGasolineQueueRows(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1

    return makeQueueRow({
      id: `gasoline-row-${number}`,
      created_by_profile_id: `profile-${number}`,
      queue_number: number,
      ticket_number: number,
      current_position: number,
      people_ahead: number - 1,
      normalized_plate_number: `QUEUE-${String(number).padStart(3, '0')}`,
    })
  })
}

function makeFuelCategoryQueueRows(
  count: number,
  fuelType: 'AI_95' | 'DIESEL' | 'GAS',
  platePrefix: string,
  queueNumberOffset = 0,
) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    const queueNumber = queueNumberOffset + number

    return makeQueueRow({
      id: `${platePrefix.toLowerCase()}-row-${number}`,
      created_by_profile_id: `profile-${platePrefix}-${number}`,
      fuel_type: fuelType,
      queue_number: queueNumber,
      ticket_number: queueNumber,
      current_position: number,
      people_ahead: number - 1,
      normalized_plate_number: `${platePrefix}-${String(number).padStart(3, '0')}`,
    })
  })
}

function makeDailyLimitOverview(category_overviews: unknown[] = []) {
  return {
    data: {
      exists: true,
      id: 'daily-limit-id',
      date: '2026-07-08',
      station_id: null,
      status: 'OPEN',
      category_overviews,
      updated_at: '2026-07-08T10:00:00.000Z',
      source: 'online',
      is_estimated: false,
      unsynced_reservation_count: 0,
    },
    isOnline: true,
    isLoading: false,
    isFetching: false,
    error: null,
  }
}

function makeGasolineLimitOverview(overrides: Record<string, unknown> = {}) {
  return makeDailyLimitOverview([
    {
      fuel_category: 'GASOLINE',
      label: 'Бензин',
      limit_mode: 'vehicle_count',
      vehicle_limit: 0,
      liters_limit: null,
      queue_count: 0,
      queued_liters: 0,
      covered_vehicle_count: 0,
      covered_liters: 0,
      remaining_vehicle_count: 0,
      remaining_liters: null,
      projected_queue_number: null,
      ...overrides,
    },
  ])
}

describe('TodayQueuePanel', () => {
  beforeEach(() => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    })
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: false,
        id: null,
        date: '2026-07-08',
        station_id: null,
        status: null,
        category_overviews: [],
        updated_at: null,
        source: 'online',
        is_estimated: false,
        unsynced_reservation_count: 0,
      },
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useDailyFuelingSchedule.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useLogReservationCall.mockReturnValue({
      mutate: mocks.mutateCall,
      isPending: false,
      error: null,
    })
    mocks.useCurrentProfile.mockReturnValue({
      data: {
        role: 'cashier',
      },
    })
    mocks.useCancelReservation.mockReturnValue({
      mutate: mocks.mutateCancel,
      isPending: false,
      error: null,
      variables: undefined,
    })
    mocks.useUpdateReservationFuelPreference.mockReturnValue({
      mutate: mocks.mutateFuelPreference,
      isPending: false,
      error: null,
      variables: undefined,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows an empty state for the global queue without rows', () => {
    render(<TodayQueuePanel />)

    expect(screen.getByText('В общей очереди нет активных записей.')).toBeInTheDocument()
  })

  it('does not render the author filter', () => {
    render(<TodayQueuePanel />)

    expect(screen.queryByRole('combobox', { name: AUTHOR_FILTER_NAME })).not.toBeInTheDocument()
  })

  it('renders with a legacy daily-limit overview shape', () => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: true,
        id: 'daily-limit-id',
        date: '2026-07-08',
        station_id: null,
        status: 'OPEN',
        updated_at: '2026-07-08T10:00:00.000Z',
        source: 'online',
        is_estimated: false,
        unsynced_reservation_count: 0,
      },
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.queryByRole('combobox', { name: AUTHOR_FILTER_NAME })).not.toBeInTheDocument()
  })

  it('shows all rows by default', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'in-limit', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'outside-limit',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
          is_within_today_limit: false,
        }),
        makeQueueRow({
          id: 'contacted',
          queue_number: 3,
          normalized_plate_number: 'С789КМ777',
          latest_call_status: 'CONTACTED',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('А123ВС777')).toBeInTheDocument()
    expect(screen.getByText('В456ТС777')).toBeInTheDocument()
    expect(screen.getByText('С789КМ777')).toBeInTheDocument()
  })

  it('can switch to the call filter', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'in-limit', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'outside-limit',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
          is_within_today_limit: false,
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('combobox', { name: CALL_FILTER_NAME }))
    await user.click(screen.getByRole('option', { name: new RegExp('^' + TODAY_ARRIVALS_LABEL + '1$') }))

    await waitFor(() =>
      expect(mocks.useTodayQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ callFilter: 'call' }),
      ),
    )
  })

  it('shows call filter counters in the select options except all', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'not-called', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'contacted',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
          latest_call_status: 'CONTACTED',
        }),
        makeQueueRow({
          id: 'no-answer',
          queue_number: 3,
          normalized_plate_number: 'С789КМ777',
          latest_call_status: 'NO_ANSWER',
        }),
        makeQueueRow({
          id: 'outside-limit',
          queue_number: 4,
          normalized_plate_number: 'Н333РТ777',
          is_within_today_limit: false,
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('combobox', { name: CALL_FILTER_NAME }))

    const allOption = screen.getByRole('option', { name: 'Все' })

    expect(within(allOption).queryByText(/\d+/)).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: new RegExp('^' + TODAY_ARRIVALS_LABEL + '2$') })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Позвонили1$/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Не дозвонились1$/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Перезвонить/ })).not.toBeInTheDocument()
  })

  it('counts call filter options after the plate search filter is applied', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'matched', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'hidden-one',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
        }),
        makeQueueRow({
          id: 'hidden-two',
          queue_number: 3,
          normalized_plate_number: 'С789КМ777',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.type(screen.getByLabelText(PLATE_SEARCH_NAME), '123')

    await waitFor(() =>
      expect(mocks.useTodayQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ plateSearch: '123' }),
      ),
    )
  })

  it('formats a full latin plate number in the queue search filter', async () => {
    const user = userEvent.setup()

    render(<TodayQueuePanel />)

    await user.type(screen.getByLabelText(PLATE_SEARCH_NAME), 'a123bc777')

    await waitFor(() =>
      expect(screen.getByLabelText(PLATE_SEARCH_NAME)).toHaveValue('\u0410 123 \u0412\u0421 777'),
    )
    expect(mocks.useTodayQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ plateSearch: '\u0410 123 \u0412\u0421 777' }),
    )
  })

  it('logs a contacted call from the quick action', async () => {
    const row = makeQueueRow()

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Дозвонились' }))

    expect(mocks.mutateCall).toHaveBeenCalledWith({
      reservation: row,
      status: 'CONTACTED',
    })
  })

  it('disables call actions only for the row with a pending call mutation', () => {
    const pendingRow = makeQueueRow({
      id: 'pending-allocation-id',
      allocation_id: 'pending-allocation-id',
      queue_entry_id: 'pending-queue-entry-id',
      normalized_plate_number: 'PENDING-001',
    })
    const availableRow = makeQueueRow({
      id: 'available-allocation-id',
      allocation_id: 'available-allocation-id',
      queue_entry_id: 'available-queue-entry-id',
      queue_number: 2,
      ticket_number: 2,
      current_position: 2,
      normalized_plate_number: 'READY-002',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [pendingRow, availableRow],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useLogReservationCall.mockReturnValue({
      mutate: mocks.mutateCall,
      isPending: true,
      error: null,
      variables: {
        reservation: pendingRow,
        status: 'CONTACTED',
      },
    })

    render(<TodayQueuePanel />)

    const pendingArticle = screen.getByText('PENDING-001').closest('article')
    const availableArticle = screen.getByText('READY-002').closest('article')

    expect(pendingArticle).not.toBeNull()
    expect(availableArticle).not.toBeNull()
    expect(
      within(pendingArticle as HTMLElement).getByRole('button', {
        name: 'Дозвонились',
      }),
    ).toBeDisabled()
    expect(
      within(availableArticle as HTMLElement).getByRole('button', {
        name: 'Дозвонились',
      }),
    ).toBeEnabled()
  })

  it('resets a contacted call from the active quick action', async () => {
    const row = makeQueueRow({
      latest_call_status: 'CONTACTED',
      latest_called_by_full_name: 'Мария Петрова',
      latest_called_at: '2026-07-07T10:30:00.000Z',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Дозвонились' }))

    expect(mocks.mutateCall).toHaveBeenCalledWith({
      reservation: row,
      status: 'NOT_CALLED',
    })
  })

  it('resets a contacted call from the expanded contacted action', async () => {
    const row = makeQueueRow({
      latest_call_status: 'CONTACTED',
      latest_called_by_full_name: 'Мария Петрова',
      latest_called_at: '2026-07-07T10:30:00.000Z',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    await userEvent.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))
    await userEvent.click(within(article).getAllByRole('button', { name: 'Дозвонились' })[1])

    expect(mocks.mutateCall).toHaveBeenCalledWith({
      reservation: row,
      status: 'NOT_CALLED',
    })
  })

  it('disables every call status action outside the call list', async () => {
    const row = makeQueueRow({
      is_callable_now: false,
      is_within_today_limit: false,
      call_unavailable_reason: 'OUTSIDE_TODAY_LIMIT',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    expect(within(article).getByRole('button', { name: 'Дозвонились' })).toBeDisabled()

    await userEvent.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))

    expect(within(article).getByRole('button', { name: 'Не ответил' })).toBeDisabled()
    expect(within(article).queryByRole('button', { name: 'Перезвонить' })).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: 'Неверный' })).not.toBeInTheDocument()

    expect(mocks.mutateCall).not.toHaveBeenCalled()
  })

  it('allows resetting a contacted call after it leaves the call list', async () => {
    const row = makeQueueRow({
      is_callable_now: false,
      call_unavailable_reason: 'ALREADY_CONTACTED',
      latest_call_status: 'CONTACTED',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    const contactedButton = screen.getByRole('button', { name: 'Дозвонились' })

    expect(contactedButton).toBeEnabled()

    await userEvent.click(contactedButton)

    expect(mocks.mutateCall).toHaveBeenCalledWith({
      reservation: row,
      status: 'NOT_CALLED',
    })
  })

  it('renders the latest call author on the card details', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          latest_call_status: 'NO_ANSWER',
          latest_called_by_full_name: 'Ольга Смирнова',
          latest_called_by_signature_name: 'Смирнова О.',
          latest_called_at: '2026-07-07T10:30:00.000Z',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Открыть детали' }))

    expect(screen.getByText(/Отметил: Смирнова О./)).toBeInTheDocument()
  })

  it('shows a server page of twenty five rows before loading more', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: makeGasolineQueueRows(25),
      isOnline: true,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('QUEUE-025')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Показать еще' })).toBeInTheDocument()
  })

  it('shows a server page of twenty five diesel rows in the diesel tab', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: [
        ...makeFuelCategoryQueueRows(1, 'AI_95', 'GASOLINE', 0),
        ...makeFuelCategoryQueueRows(25, 'DIESEL', 'DIESEL', 100),
      ],
      summary: {
        total_count: 26,
        callable_count: 26,
        contacted_count: 0,
        no_answer_count: 0,
        category_counts: {
          GASOLINE: 1,
          DIESEL: 25,
          GAS: 0,
        },
        callable_category_counts: {
          GASOLINE: 1,
          DIESEL: 25,
          GAS: 0,
        },
      },
      isOnline: true,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('tab', { name: /Дизель/ }))

    expect(screen.getByText('DIESEL-001')).toBeInTheDocument()
    expect(screen.getByText('DIESEL-025')).toBeInTheDocument()
  })

  it('loads the next page for the active gas tab only', async () => {
    const user = userEvent.setup()
    const fetchGasNextPage = vi.fn()
    const fetchDieselNextPage = vi.fn()
    const fetchGasolineNextPage = vi.fn()

    mocks.useTodayQueue.mockReturnValue({
      rows: makeFuelCategoryQueueRows(1, 'GAS', 'GAS', 200),
      summary: {
        total_count: 1,
        callable_count: 1,
        contacted_count: 0,
        no_answer_count: 0,
        category_counts: {
          GASOLINE: 0,
          DIESEL: 0,
          GAS: 51,
        },
        callable_category_counts: {
          GASOLINE: 0,
          DIESEL: 0,
          GAS: 51,
        },
      },
      isOnline: true,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: fetchGasolineNextPage,
      categoryPagination: {
        GASOLINE: {
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: fetchGasolineNextPage,
        },
        DIESEL: {
          hasNextPage: true,
          isFetchingNextPage: false,
          fetchNextPage: fetchDieselNextPage,
        },
        GAS: {
          hasNextPage: true,
          isFetchingNextPage: false,
          fetchNextPage: fetchGasNextPage,
        },
      },
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('tab', { name: /Газ/ }))
    await user.click(screen.getByRole('button', { name: 'Показать еще' }))

    expect(fetchGasNextPage).toHaveBeenCalledTimes(1)
    expect(fetchDieselNextPage).not.toHaveBeenCalled()
    expect(fetchGasolineNextPage).not.toHaveBeenCalled()
  })

  it('shows server summary counters instead of counting only the loaded page', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: makeGasolineQueueRows(25),
      summary: {
        total_count: 125,
        callable_count: 40,
        contacted_count: 12,
        no_answer_count: 7,
        category_counts: {
          GASOLINE: 100,
          DIESEL: 20,
          GAS: 5,
        },
      },
      isOnline: true,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('125')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: /100/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /20/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /5/ })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: CALL_FILTER_NAME }))

    expect(
      screen.getByRole('option', { name: new RegExp('^' + TODAY_ARRIVALS_LABEL + '40$') }),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Позвонили12$/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Не дозвонились7$/ })).toBeInTheDocument()
  })

  it('falls back to loaded rows for counters in offline mode', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'callable', is_callable_now: true }),
        makeQueueRow({
          id: 'contacted',
          queue_number: 2,
          latest_call_status: 'CONTACTED',
        }),
      ],
      isOnline: false,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  it('renders the current position after filtering the queue', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'first-row',
          queue_number: 4,
          ticket_number: 4,
          current_position: 70,
          people_ahead: 69,
          normalized_plate_number: 'A123BC777',
        }),
        makeQueueRow({
          id: 'second-row',
          created_by_profile_id: 'second-profile',
          queue_number: 2847,
          ticket_number: 2847,
          current_position: 71,
          people_ahead: 70,
          normalized_plate_number: 'B456TC777',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.type(screen.getByLabelText(PLATE_SEARCH_NAME), '456')

    const secondRow = screen.getByText('B456TC777').closest('article')

    expect(secondRow).not.toBeNull()
    expect(
      within(secondRow as HTMLElement).getByLabelText('Позиция в очереди топлива 71'),
    ).toBeInTheDocument()

    expect(within(secondRow as HTMLElement).getByText('B456TC777')).toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.useTodayQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ plateSearch: '456' }),
      ),
    )
  })

  it('shows today arrivals by callable server status', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'callable',
          queue_number: 1,
          normalized_plate_number: 'CALLABLE-001',
          is_callable_now: true,
        }),
        makeQueueRow({
          id: 'outside-limit',
          queue_number: 2,
          normalized_plate_number: 'OUTSIDE-002',
          is_callable_now: false,
          is_within_today_limit: false,
        }),
        makeQueueRow({
          id: 'no-fuel',
          queue_number: 3,
          normalized_plate_number: 'NOFUEL-003',
          is_callable_now: false,
          call_unavailable_reason: 'NO_COMPATIBLE_FUEL',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('combobox', { name: CALL_FILTER_NAME }))
    await user.click(
      screen.getByRole('option', {
        name: /^\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u0440\u0438\u0435\u0434\u0443\u04421$/,
      }),
    )

    await waitFor(() =>
      expect(mocks.useTodayQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ callFilter: 'call' }),
      ),
    )
  })

  it('filters gasoline rows by matched fuel type with a fuel type fallback', async () => {
    const user = userEvent.setup()

    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'matched-ai-95',
          queue_number: 1,
          normalized_plate_number: 'MATCHED-095',
          fuel_type: 'AI_92',
          matched_fuel_type: 'AI_95',
          fuel_preference_mode: 'ANY_GASOLINE',
        }),
        makeQueueRow({
          id: 'fallback-ai-95',
          queue_number: 2,
          normalized_plate_number: 'FALLBACK-095',
          fuel_type: 'AI_95',
          matched_fuel_type: null,
        }),
        makeQueueRow({
          id: 'ai-100',
          queue_number: 3,
          normalized_plate_number: 'AI100-003',
          fuel_type: 'AI_100',
          matched_fuel_type: null,
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('combobox', { name: /^\u041c\u0430\u0440\u043a\u0430 \u0431\u0435\u043d\u0437\u0438\u043d\u0430$/ }))
    await user.click(screen.getByRole('option', { name: /95/ }))

    await waitFor(() =>
      expect(mocks.useTodayQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ gasolineFuelFilter: 'AI_95' }),
      ),
    )
  })

  it('updates fuel preference from a queue card without changing the reservation id', async () => {
    const user = userEvent.setup()
    const row = makeQueueRow({
      id: 'reservation-id',
      queue_number: 7,
      ticket_number: 7,
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    await user.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))
    await user.click(within(article).getByRole('button', { name: /Изменить марку топлива/ }))

    const [fuelTypeSelect, fuelPreferenceSelect] = screen.getAllByRole('combobox')

    await user.click(fuelTypeSelect)
    await user.click(screen.getByRole('option', { name: /92/ }))
    await user.click(fuelPreferenceSelect)
    await user.click(screen.getByRole('option', { name: /92\/95\/100/ }))
    await user.click(screen.getByRole('button', { name: /Сохранить/ }))

    expect(mocks.mutateFuelPreference).toHaveBeenCalledWith({
      reservationId: 'reservation-id',
      fuelType: 'AI_92',
      fuelPreferenceMode: 'ANY_GASOLINE',
      clientMutationId: expect.any(String),
    })
  })

  it('keeps fuel preference pending state scoped to the queue entry id', async () => {
    const user = userEvent.setup()
    const pendingRow = makeQueueRow({
      id: 'pending-allocation-id',
      allocation_id: 'pending-allocation-id',
      queue_entry_id: 'pending-queue-entry-id',
      normalized_plate_number: 'PENDING-001',
    })
    const availableRow = makeQueueRow({
      id: 'available-allocation-id',
      allocation_id: 'available-allocation-id',
      queue_entry_id: 'available-queue-entry-id',
      queue_number: 2,
      ticket_number: 2,
      current_position: 2,
      normalized_plate_number: 'READY-002',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [pendingRow, availableRow],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useUpdateReservationFuelPreference.mockReturnValue({
      mutate: mocks.mutateFuelPreference,
      isPending: true,
      error: null,
      variables: {
        reservationId: 'pending-queue-entry-id',
        fuelType: 'AI_95',
        fuelPreferenceMode: 'EXACT',
        clientMutationId: 'mutation-id',
      },
    })

    render(<TodayQueuePanel />)

    const pendingArticle = screen.getByText('PENDING-001').closest('article')
    const availableArticle = screen.getByText('READY-002').closest('article')

    expect(pendingArticle).not.toBeNull()
    expect(availableArticle).not.toBeNull()

    await user.click(
      within(pendingArticle as HTMLElement).getByRole('button', { name: DETAILS_BUTTON_NAME }),
    )
    await user.click(
      within(availableArticle as HTMLElement).getByRole('button', {
        name: DETAILS_BUTTON_NAME,
      }),
    )

    expect(
      within(pendingArticle as HTMLElement).getByRole('button', {
        name: /Изменить марку топлива/,
      }),
    ).toBeDisabled()
    expect(
      within(availableArticle as HTMLElement).getByRole('button', {
        name: /Изменить марку топлива/,
      }),
    ).toBeEnabled()
  })

  it('cancels only the selected queue row by reservation id', async () => {
    const user = userEvent.setup()
    const selectedRow = makeQueueRow({
      id: 'selected-diesel-reservation-id',
      queue_number: 10,
      ticket_number: 10,
      current_position: 3,
      fuel_type: 'DIESEL',
      normalized_plate_number: 'DIESEL-010',
    })

    mocks.useCurrentProfile.mockReturnValue({
      data: {
        role: 'mayor_assistant',
      },
    })
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'other-reservation-id',
          queue_number: 9,
          ticket_number: 9,
          normalized_plate_number: 'OTHER-009',
        }),
        selectedRow,
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await user.click(screen.getByRole('tab', { name: /Дизель/ }))

    const selectedArticle = screen.getByText('DIESEL-010').closest('article')

    expect(selectedArticle).not.toBeNull()

    await user.click(
      within(selectedArticle as HTMLElement).getByRole('button', {
        name: 'Удалить из очереди',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(mocks.mutateCancel).toHaveBeenCalledTimes(1)
    expect(mocks.mutateCancel).toHaveBeenCalledWith({
      reservationId: 'selected-diesel-reservation-id',
      reason: 'OWNER_CANCELLED',
      comment: null,
      clientMutationId: expect.any(String),
    })
  })

  it('keeps cancel pending state scoped to the queue entry id', () => {
    const pendingRow = makeQueueRow({
      id: 'pending-allocation-id',
      allocation_id: 'pending-allocation-id',
      queue_entry_id: 'pending-queue-entry-id',
      normalized_plate_number: 'PENDING-001',
    })
    const availableRow = makeQueueRow({
      id: 'available-allocation-id',
      allocation_id: 'available-allocation-id',
      queue_entry_id: 'available-queue-entry-id',
      queue_number: 2,
      ticket_number: 2,
      current_position: 2,
      normalized_plate_number: 'READY-002',
    })

    mocks.useCurrentProfile.mockReturnValue({
      data: {
        role: 'mayor_assistant',
      },
    })
    mocks.useTodayQueue.mockReturnValue({
      rows: [pendingRow, availableRow],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useCancelReservation.mockReturnValue({
      mutate: mocks.mutateCancel,
      isPending: true,
      error: null,
      variables: {
        reservationId: 'pending-queue-entry-id',
        reason: 'OWNER_CANCELLED',
        comment: null,
        clientMutationId: 'mutation-id',
      },
    })

    render(<TodayQueuePanel />)

    const pendingArticle = screen.getByText('PENDING-001').closest('article')
    const availableArticle = screen.getByText('READY-002').closest('article')

    expect(pendingArticle).not.toBeNull()
    expect(availableArticle).not.toBeNull()
    expect(
      within(pendingArticle as HTMLElement).getByRole('button', {
        name: 'Удалить из очереди',
      }),
    ).toBeDisabled()
    expect(
      within(availableArticle as HTMLElement).getByRole('button', {
        name: 'Удалить из очереди',
      }),
    ).toBeEnabled()
  })

  it('disables fuel preference editing while gasoline vehicle limit is greater than zero', async () => {
    const row = makeQueueRow({
      id: 'reservation-id',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useDailyLimitOverview.mockReturnValue(
      makeGasolineLimitOverview({ vehicle_limit: 1, remaining_vehicle_count: 1 }),
    )

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    await userEvent.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))

    expect(
      within(article).getByRole('button', {
        name: 'Топливо нельзя изменить, пока по бензину установлен ненулевой лимит',
      }),
    ).toBeDisabled()
  })

  it('allows fuel preference editing while gasoline vehicle limit is zero', async () => {
    const user = userEvent.setup()
    const row = makeQueueRow({
      id: 'reservation-id',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useDailyLimitOverview.mockReturnValue(makeGasolineLimitOverview({ vehicle_limit: 0 }))

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    await user.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))
    await user.click(within(article).getByRole('button', { name: /Изменить марку топлива/ }))
    await user.click(screen.getByRole('button', { name: /Сохранить/ }))

    expect(mocks.mutateFuelPreference).toHaveBeenCalledWith({
      reservationId: 'reservation-id',
      fuelType: 'AI_95',
      fuelPreferenceMode: 'EXACT',
      clientMutationId: expect.any(String),
    })
  })

  it('allows fuel preference editing when gasoline limit row is missing', async () => {
    const row = makeQueueRow({
      id: 'reservation-id',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useDailyLimitOverview.mockReturnValue(makeDailyLimitOverview())

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    await userEvent.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))

    expect(within(article).getByRole('button', { name: /Изменить марку топлива/ })).toBeEnabled()
  })

  it('locks fuel preference editing only for non-zero gasoline liters limits', async () => {
    const row = makeQueueRow({
      id: 'reservation-id',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useDailyLimitOverview.mockReturnValue(
      makeGasolineLimitOverview({
        limit_mode: 'fuel_liters',
        vehicle_limit: 0,
        liters_limit: 0,
        remaining_vehicle_count: null,
        remaining_liters: 0,
      }),
    )

    const { rerender } = render(<TodayQueuePanel />)
    const article = screen.getByRole('article')

    await userEvent.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))

    expect(within(article).getByRole('button', { name: /Изменить марку топлива/ })).toBeEnabled()

    mocks.useDailyLimitOverview.mockReturnValue(
      makeGasolineLimitOverview({
        limit_mode: 'fuel_liters',
        vehicle_limit: 0,
        liters_limit: 100,
        remaining_vehicle_count: null,
        remaining_liters: 100,
      }),
    )

    rerender(<TodayQueuePanel />)

    expect(
      within(article).getByRole('button', {
        name: 'Топливо нельзя изменить, пока по бензину установлен ненулевой лимит',
      }),
    ).toBeDisabled()
  })

  it('disables fuel preference editing while the queue is offline', async () => {
    const row = makeQueueRow({
      id: 'reservation-id',
      is_offline: true,
      sync_status: 'PENDING',
    })

    mocks.useTodayQueue.mockReturnValue({
      rows: [row],
      isOnline: false,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    const article = screen.getByRole('article')

    await userEvent.click(within(article).getByRole('button', { name: DETAILS_BUTTON_NAME }))

    expect(within(article).getByRole('button', { name: /Изменить марку топлива/ })).toBeDisabled()
  })

  it('shows only the ETA persisted by the server', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'callable-1',
          queue_number: 1,
          ticket_number: 1,
          normalized_plate_number: 'CALLABLE-001',
          is_callable_now: true,
          arrival_at: '2026-07-09T10:00:00.000Z',
        }),
        makeQueueRow({
          id: 'no-compatible-fuel',
          queue_number: 2,
          ticket_number: 2,
          normalized_plate_number: 'NOFUEL-002',
          is_callable_now: false,
          call_unavailable_reason: 'NO_COMPATIBLE_FUEL',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    render(<TodayQueuePanel />)

    const callableFirst = screen.getByText('CALLABLE-001').closest('article')
    const noFuel = screen.getByText('NOFUEL-002').closest('article')

    expect(callableFirst).not.toBeNull()
    expect(noFuel).not.toBeNull()
    expect(
      within(callableFirst as HTMLElement).getByText('Время прибытия: 9 июля в 13:00'),
    ).toBeInTheDocument()
    expect(
      within(noFuel as HTMLElement).queryByText(/Время прибытия/),
    ).not.toBeInTheDocument()
  })
})
