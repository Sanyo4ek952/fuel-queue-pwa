/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TodayQueueRow } from '@/entities/reservation'

const mocks = vi.hoisted(() => ({
  mutateCall: vi.fn(),
  useTodayQueue: vi.fn(),
  useLogReservationCall: vi.fn(),
}))

vi.mock('@/entities/reservation', () => ({
  useTodayQueue: mocks.useTodayQueue,
}))

vi.mock('@/features/log-reservation-call', () => ({
  useLogReservationCall: mocks.useLogReservationCall,
}))

import { TodayQueuePanel } from './index'

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
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
      normalized_plate_number: `QUEUE-${String(number).padStart(3, '0')}`,
    })
  })
}

describe('TodayQueuePanel', () => {
  beforeEach(() => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })
    mocks.useLogReservationCall.mockReturnValue({
      mutate: mocks.mutateCall,
      isPending: false,
      error: null,
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

    await user.click(screen.getByRole('combobox', { name: 'Обзвон' }))
    await user.click(screen.getByRole('option', { name: /^Обзвон1$/ }))

    expect(screen.getByText('А123ВС777')).toBeInTheDocument()
    expect(screen.queryByText('В456ТС777')).not.toBeInTheDocument()
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
          id: 'wrong-number',
          queue_number: 4,
          normalized_plate_number: 'Е111КХ777',
          latest_call_status: 'WRONG_NUMBER',
        }),
        makeQueueRow({
          id: 'call-later',
          queue_number: 5,
          normalized_plate_number: 'М222ОР777',
          latest_call_status: 'CALL_LATER',
        }),
        makeQueueRow({
          id: 'outside-limit',
          queue_number: 6,
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

    await user.click(screen.getByRole('combobox', { name: 'Обзвон' }))

    const allOption = screen.getByRole('option', { name: 'Все' })

    expect(within(allOption).queryByText(/\d+/)).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Обзвон4$/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Позвонили1$/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Не дозвонились2$/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Перезвонить1$/ })).toBeInTheDocument()
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

    await user.type(screen.getByLabelText('Поиск по госномеру'), 'А123')
    await user.click(screen.getByRole('combobox', { name: 'Обзвон' }))

    expect(screen.getByRole('option', { name: /^Обзвон1$/ })).toBeInTheDocument()
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

  it('shows only the first ten rows in a category before loading more', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: makeGasolineQueueRows(11),
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('QUEUE-010')).toBeInTheDocument()
    expect(screen.queryByText('QUEUE-011')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Показать еще' })).toBeInTheDocument()
  })

  it('renders the stable queue number for visible category rows', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'first-row',
          queue_number: 1,
          normalized_plate_number: 'A123BC777',
        }),
        makeQueueRow({
          id: 'second-row',
          created_by_profile_id: 'second-profile',
          queue_number: 3,
          normalized_plate_number: 'B456TC777',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    const secondRow = screen.getByText('B456TC777').closest('article')

    expect(secondRow).not.toBeNull()
    expect(within(secondRow as HTMLElement).getByText('3')).toBeInTheDocument()
    expect(within(secondRow as HTMLElement).queryByText('2')).not.toBeInTheDocument()
  })
})
