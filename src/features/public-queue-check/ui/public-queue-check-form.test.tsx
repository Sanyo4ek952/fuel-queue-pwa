/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicQueueCheckForm } from './public-queue-check-form'

const mocks = vi.hoisted(() => ({
  checkPublicQueuePosition: vi.fn(),
  getNoShowGrace: vi.fn(),
}))

vi.mock('@/shared/api/rpc', () => ({
  getNoShowGrace: mocks.getNoShowGrace,
}))

vi.mock('@/shared/api/public-queue', () => ({
  checkPublicQueuePositionViaApi: mocks.checkPublicQueuePosition,
  getPublicNoShowGraceViaApi: mocks.getNoShowGrace,
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

describe('PublicQueueCheckForm', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.checkPublicQueuePosition.mockReset()
    mocks.getNoShowGrace.mockReset()
    mocks.getNoShowGrace.mockResolvedValue({
      data: {
        days: 3,
        updated_at: null,
        client_mutation_id: null,
      },
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('does not check queue on render', () => {
    renderWithQueryClient(<PublicQueueCheckForm />)

    expect(mocks.checkPublicQueuePosition).not.toHaveBeenCalled()
  })

  it('checks queue after submit', async () => {
    mocks.checkPublicQueuePosition.mockResolvedValue({
      data: {
        status: 'NOT_FOUND',
        queue_number: null,
        ticket_number: null,
        current_position: null,
        people_ahead: null,
        is_within_today_limit: null,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    await waitFor(() => {
      expect(mocks.checkPublicQueuePosition).toHaveBeenCalledTimes(1)
    })
    expect(mocks.checkPublicQueuePosition).toHaveBeenCalledWith({
      plateNumber: 'А123ВС777',
      phoneLast4: '1234',
    })
  })

  it('shows a cautious fueling message and cancellation warning for a queue position within today limit', async () => {
    mocks.checkPublicQueuePosition.mockResolvedValue({
      data: {
        status: 'FOUND',
        queue_number: 2847,
        ticket_number: 2847,
        current_position: 71,
        people_ahead: 70,
        preferred_fuel_type: 'AI_95',
        public_status: 'IN_CALL_LIST',
        is_within_today_limit: true,
        is_callable_now: true,
        matched_fuel_type: 'AI_95',
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Запись включена в список обзвона')).toBeInTheDocument()
    expect(
      screen.getByText(/Постоянный номер №2847. Дневная позиция: 71, впереди: 70./),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ожидайте звонка оператора, доступно АИ-95./)).toBeInTheDocument()
    expect(screen.queryByText(/Если вы не заправитесь/)).not.toBeInTheDocument()
    expect(screen.queryByText('А123ВС777')).not.toBeInTheDocument()
    expect(screen.queryByText('1234')).not.toBeInTheDocument()
  })

  it('shows a waiting message without cancellation warning outside today limit', async () => {
    mocks.checkPublicQueuePosition.mockResolvedValue({
      data: {
        status: 'FOUND',
        queue_number: 2847,
        ticket_number: 2847,
        current_position: 71,
        people_ahead: 70,
        preferred_fuel_type: 'DIESEL',
        public_status: 'QUEUE_NOT_READY',
        is_within_today_limit: false,
        is_callable_now: false,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Постоянный номер №2847 ожидает распределения')).toBeInTheDocument()
    expect(
      screen.getByText(/Постоянный номер №2847. Дневная позиция: 71, впереди: 70./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/аннулирована/)).not.toBeInTheDocument()
    expect(screen.queryByText('А123ВС777')).not.toBeInTheDocument()
    expect(screen.queryByText('1234')).not.toBeInTheDocument()
  })

  it('shows configured no-show grace days after a successful check', async () => {
    mocks.getNoShowGrace.mockResolvedValue({
      data: {
        days: 5,
        updated_at: null,
        client_mutation_id: null,
      },
      error: null,
    })
    mocks.checkPublicQueuePosition.mockResolvedValue({
      data: {
        status: 'FOUND',
        queue_number: 9,
        ticket_number: 9,
        current_position: 3,
        people_ahead: 2,
        preferred_fuel_type: 'GAS',
        public_status: 'INVITED_BY_OPERATOR',
        is_within_today_limit: true,
        is_callable_now: false,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Оператор подтвердил возможность приехать')).toBeInTheDocument()
    expect(screen.getByText(/в течение 5 суток/)).toBeInTheDocument()
    expect(screen.queryByText(/трёх суток/)).not.toBeInTheDocument()
  })

  it('shows disabled no-show grace text when automatic cancellation is off', async () => {
    mocks.getNoShowGrace.mockResolvedValue({
      data: {
        days: 0,
        updated_at: null,
        client_mutation_id: null,
      },
      error: null,
    })
    mocks.checkPublicQueuePosition.mockResolvedValue({
      data: {
        status: 'FOUND',
        queue_number: 9,
        ticket_number: 9,
        current_position: 3,
        people_ahead: 2,
        public_status: 'INVITED_BY_OPERATOR',
        is_within_today_limit: true,
        is_callable_now: false,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Оператор подтвердил возможность приехать')).toBeInTheDocument()
    expect(screen.getByText(/Автоматическое аннулирование записи по пропускам заправки сейчас отключено/)).toBeInTheDocument()
    expect(screen.queryByText(/трёх суток/)).not.toBeInTheDocument()
  })
})
