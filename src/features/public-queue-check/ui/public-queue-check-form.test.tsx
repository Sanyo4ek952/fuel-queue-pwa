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
  checkPublicQueuePosition: mocks.checkPublicQueuePosition,
  getNoShowGrace: mocks.getNoShowGrace,
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
        queue_number: 9,
        is_within_today_limit: true,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Можно приехать на заправку')).toBeInTheDocument()
    expect(
      screen.getByText('Ваша очередь подошла. Окончательный допуск подтвердит оператор на АЗС.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Если вы не заправитесь в течение 3 суток/)).toBeInTheDocument()
    expect(screen.queryByText('А123ВС777')).not.toBeInTheDocument()
    expect(screen.queryByText('1234')).not.toBeInTheDocument()
  })

  it('shows a waiting message without cancellation warning outside today limit', async () => {
    mocks.checkPublicQueuePosition.mockResolvedValue({
      data: {
        status: 'FOUND',
        queue_number: 9,
        is_within_today_limit: false,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Очередь №9 ещё не подошла')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Ваша запись найдена, но сегодня она ещё не входит в лимит. Пожалуйста, ожидайте своей очереди. Когда очередь подойдёт, вам позвонят.',
      ),
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
        is_within_today_limit: true,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Можно приехать на заправку')).toBeInTheDocument()
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
        is_within_today_limit: true,
        remaining_attempts: 4,
      },
      error: null,
    })

    renderWithQueryClient(<PublicQueueCheckForm />)
    await userEvent.type(screen.getByLabelText('Госномер'), 'A123BC777')
    await userEvent.type(screen.getByLabelText('Последние 4 цифры телефона'), '1234')
    await userEvent.click(screen.getByRole('button', { name: /проверить очередь/i }))

    expect(await screen.findByText('Можно приехать на заправку')).toBeInTheDocument()
    expect(screen.getByText(/Автоматическое аннулирование записи по пропускам заправки сейчас отключено/)).toBeInTheDocument()
    expect(screen.queryByText(/трёх суток/)).not.toBeInTheDocument()
  })
})
