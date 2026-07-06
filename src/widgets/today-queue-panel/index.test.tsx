/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useTodayQueue: vi.fn(),
}))

vi.mock('@/entities/reservation', () => ({
  useTodayQueue: mocks.useTodayQueue,
}))

import { TodayQueuePanel } from './index'

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

    expect(screen.getByText('В общей очереди нет активных записей.')).toBeInTheDocument()
  })

  it('renders pending offline queue rows', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        {
          id: 'local-mutation-id',
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
          sync_status: 'PENDING',
          comment: null,
          client_mutation_id: 'mutation-id',
          is_offline: true,
        },
      ],
      isOnline: false,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<TodayQueuePanel />)

    expect(screen.getByText('А123ВС777')).toBeInTheDocument()
    expect(screen.getByText('Кассир АЗС: Петрова М.')).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(screen.getByText('Offline-режим')).toBeInTheDocument()
  })
})
