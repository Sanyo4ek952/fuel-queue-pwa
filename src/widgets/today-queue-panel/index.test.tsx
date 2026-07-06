/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { TodayQueueRow } from '@/entities/reservation'

const mocks = vi.hoisted(() => ({
  useTodayQueue: vi.fn(),
}))

vi.mock('@/entities/reservation', () => ({
  useTodayQueue: mocks.useTodayQueue,
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

function makeQueueRow(overrides: Partial<TodayQueueRow>): TodayQueueRow {
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
    driver_full_name: 'Ivan Ivanov',
    driver_phone: null,
    fuel_type: 'AI_95',
    requested_liters: 40,
    status: 'RESERVED',
    sync_status: 'SYNCED',
    comment: null,
    client_mutation_id: null,
    is_offline: false,
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
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows an empty state for the global queue without rows', () => {
    render(<TodayQueuePanel />)

    expect(
      screen.getByText('В общей очереди нет активных записей.'),
    ).toBeInTheDocument()
  })

  it('renders pending offline queue rows', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({
          id: 'local-mutation-id',
          sync_status: 'PENDING',
          client_mutation_id: 'mutation-id',
          is_offline: true,
        }),
      ],
      isOnline: false,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('А123ВС777')).toBeInTheDocument()
    expect(screen.queryByText('PENDING')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Открыть детали' }),
    )
    expect(screen.getByText('Кассир АЗС: Петрова М.')).toBeInTheDocument()
    expect(screen.getByText('Offline-режим')).toBeInTheDocument()
  })

  it('filters rows by partial plate number', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'first-row', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'second-row',
          created_by_profile_id: 'second-profile',
          created_by_full_name: 'Иван Сидоров',
          created_by_signature_name: 'Сидоров И.',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.type(screen.getByLabelText('Поиск по госномеру'), '123')

    expect(screen.getByText('А123ВС777')).toBeInTheDocument()
    expect(screen.queryByText('В456ТС777')).not.toBeInTheDocument()
  })

  it('normalizes plate search input before filtering', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'first-row', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'second-row',
          created_by_profile_id: 'second-profile',
          created_by_full_name: 'Иван Сидоров',
          created_by_signature_name: 'Сидоров И.',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.type(
      screen.getByLabelText('Поиск по госномеру'),
      'a 123 bc',
    )

    expect(screen.getByText('А123ВС777')).toBeInTheDocument()
    expect(screen.queryByText('В456ТС777')).not.toBeInTheDocument()
  })

  it('filters rows by author', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'first-row', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'second-row',
          created_by_profile_id: 'second-profile',
          created_by_full_name: 'Иван Сидоров',
          created_by_signature_name: 'Сидоров И.',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.click(screen.getByLabelText('Кто добавил'))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Сидоров И. (Кассир АЗС)' }),
    )

    expect(screen.getByText('В456ТС777')).toBeInTheDocument()
    expect(screen.queryByText('А123ВС777')).not.toBeInTheDocument()
  })

  it('updates category counters after filtering', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'first-row', normalized_plate_number: 'А123ВС777' }),
        makeQueueRow({
          id: 'second-row',
          queue_number: 2,
          normalized_plate_number: 'В456ТС777',
          fuel_type: 'DIESEL',
        }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.type(
      screen.getByLabelText('Поиск по госномеру'),
      'a 123 bc',
    )

    expect(screen.getByRole('tab', { name: 'Бензин (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Дизель (0)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Газ (0)' })).toBeInTheDocument()
  })

  it('renders contiguous display numbers for visible category rows', () => {
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
    expect(within(secondRow as HTMLElement).getByText('2')).toBeInTheDocument()
    expect(
      within(secondRow as HTMLElement).queryByText('3'),
    ).not.toBeInTheDocument()
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
    expect(
      screen.getByRole('button', { name: 'Показать еще' }),
    ).toBeInTheDocument()
  })

  it('loads the next ten category rows after clicking show more', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: makeGasolineQueueRows(11),
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Показать еще' }))

    expect(screen.getByText('QUEUE-011')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Показать еще' }),
    ).not.toBeInTheDocument()
  })

  it('hides the show more button when a category has ten rows or fewer', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: makeGasolineQueueRows(10),
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('QUEUE-010')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Показать еще' }),
    ).not.toBeInTheDocument()
  })

  it('resets visible category rows after applying a filter', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: makeGasolineQueueRows(12),
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.click(screen.getByRole('button', { name: 'Показать еще' }))

    expect(screen.getByText('QUEUE-012')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Поиск по госномеру'), '0')

    expect(screen.queryByText('QUEUE-012')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Показать еще' }),
    ).toBeInTheDocument()
  })

  it('shows an empty state when filters match no rows', async () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        makeQueueRow({ id: 'first-row', normalized_plate_number: 'А123ВС777' }),
      ],
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    await userEvent.type(screen.getByLabelText('Поиск по госномеру'), '999')

    expect(
      screen.getByText('По выбранным фильтрам записей нет.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('А123ВС777')).not.toBeInTheDocument()
  })
})
