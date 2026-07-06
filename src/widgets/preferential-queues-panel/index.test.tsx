/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreferentialQueue } from '@/shared/api/preferential-queues'

const mocks = vi.hoisted(() => ({
  listActivePreferentialQueues: vi.fn(),
  createPreferentialQueue: vi.fn(),
  createPreferentialQueueEntry: vi.fn(),
  cancelPreferentialQueueEntry: vi.fn(),
}))

vi.mock('@/shared/api/preferential-queues', () => ({
  listActivePreferentialQueues: mocks.listActivePreferentialQueues,
}))

vi.mock('@/shared/api/rpc', () => ({
  createPreferentialQueue: mocks.createPreferentialQueue,
  createPreferentialQueueEntry: mocks.createPreferentialQueueEntry,
  cancelPreferentialQueueEntry: mocks.cancelPreferentialQueueEntry,
}))

import { PreferentialQueuesPanel } from './index'

const queueId = '00000000-0000-4000-8000-000000000001'
const entryId = '00000000-0000-4000-8000-000000000002'

function makeQueue(overrides: Partial<PreferentialQueue> = {}): PreferentialQueue {
  return {
    id: queueId,
    name: 'Врачи',
    status: 'ACTIVE',
    created_by: 'profile-id',
    client_mutation_id: 'queue-mutation-id',
    created_at: '2026-07-07T00:00:00.000Z',
    updated_at: '2026-07-07T00:00:00.000Z',
    created_by_full_name: 'Мэр',
    created_by_role: 'mayor',
    created_by_signature_name: 'Мэр',
    entries: [
      {
        id: entryId,
        queue_id: queueId,
        vehicle_id: 'vehicle-id',
        driver_id: 'driver-id',
        normalized_plate_number: 'А123ВС777',
        driver_full_name: 'Иван Иванов',
        driver_phone: null,
        fuel_type: 'AI_95',
        requested_liters: 40,
        status: 'ACTIVE',
        comment: null,
        client_mutation_id: 'entry-mutation-id',
        created_at: '2026-07-07T00:00:00.000Z',
        updated_at: '2026-07-07T00:00:00.000Z',
        created_by_full_name: 'Мэр',
        created_by_role: 'mayor',
        created_by_signature_name: 'Мэр',
      },
    ],
    ...overrides,
  }
}

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

describe('PreferentialQueuesPanel', () => {
  beforeAll(() => {
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
    if (!HTMLFormElement.prototype.requestSubmit) {
      HTMLFormElement.prototype.requestSubmit = vi.fn()
    }
  })

  beforeEach(() => {
    mocks.listActivePreferentialQueues.mockResolvedValue([makeQueue()])
    mocks.createPreferentialQueue.mockResolvedValue({ data: null, error: null })
    mocks.createPreferentialQueueEntry.mockResolvedValue({
      data: {
        id: 'new-entry-id',
        queue_id: queueId,
        queue_name: 'Врачи',
        vehicle_id: 'new-vehicle-id',
        driver_id: 'new-driver-id',
        normalized_plate_number: 'В456ТС777',
        driver_full_name: 'Петр Петров',
        driver_phone: null,
        fuel_type: 'AI_95',
        requested_liters: 40,
        status: 'ACTIVE',
        comment: null,
        client_mutation_id: 'new-entry-mutation-id',
        created_at: '2026-07-07T00:00:00.000Z',
        updated_at: '2026-07-07T00:00:00.000Z',
      },
      error: null,
    })
    mocks.cancelPreferentialQueueEntry.mockResolvedValue({
      data: {
        id: entryId,
        queue_id: queueId,
        status: 'CANCELLED',
        cancelled_comment: 'Отменено мэром',
        cancelled_at: '2026-07-07T00:00:00.000Z',
      },
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('opens the existing vehicle form from a queue card with a fixed queue id', async () => {
    renderWithQueryClient(<PreferentialQueuesPanel />)

    expect(await screen.findByText('Врачи')).toBeInTheDocument()
    expect(screen.queryByLabelText('Льготная очередь')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Госномер')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Льготная очередь')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/Очередь:/)).toHaveTextContent('Врачи')

    await userEvent.type(within(dialog).getByLabelText('Госномер'), 'В456ТС777')
    await userEvent.type(within(dialog).getByLabelText('Водитель'), 'Петр Петров')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить в очередь' }))

    await waitFor(() => {
      expect(mocks.createPreferentialQueueEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          queueId,
          plateNumber: 'В456ТС777',
          driverFullName: 'Петр Петров',
        }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('cancels an entry and removes it from the visible list', async () => {
    mocks.listActivePreferentialQueues
      .mockResolvedValueOnce([makeQueue()])
      .mockResolvedValueOnce([makeQueue({ entries: [] })])

    renderWithQueryClient(<PreferentialQueuesPanel />)

    expect(await screen.findByText('А123ВС777')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))

    await waitFor(() => {
      expect(mocks.cancelPreferentialQueueEntry).toHaveBeenCalledWith({
        entryId,
        comment: 'Отменено мэром',
      })
    })
    await waitFor(() => {
      expect(screen.queryByText('А123ВС777')).not.toBeInTheDocument()
    })
  })
})
