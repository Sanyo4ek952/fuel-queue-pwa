/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectedStationId: 'station-id',
  useTodayQueue: vi.fn(),
}))

vi.mock('@/entities/reservation', () => ({
  useTodayQueue: mocks.useTodayQueue,
}))

vi.mock('@/features/select-station', () => ({
  StationSelect: () => <div data-testid="station-select" />,
  useSelectedStation: (selector: (state: { selectedStationId: string }) => string) =>
    selector({ selectedStationId: mocks.selectedStationId }),
}))

import { TodayQueuePanel } from './index'

describe('TodayQueuePanel', () => {
  beforeEach(() => {
    mocks.selectedStationId = 'station-id'
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

  it('shows an empty state for a selected station without rows', () => {
    render(<TodayQueuePanel />)

    expect(screen.getByText('На сегодня записей нет.')).toBeInTheDocument()
  })

  it('renders pending offline queue rows', () => {
    mocks.useTodayQueue.mockReturnValue({
      rows: [
        {
          id: 'local-mutation-id',
          date: '2026-07-05',
          station_id: 'station-id',
          vehicle_id: 'vehicle-id',
          driver_id: null,
          queue_number: 1,
          normalized_plate_number: 'A123BC',
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

    expect(screen.getByText('A123BC')).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(screen.getByText('Offline-режим')).toBeInTheDocument()
  })
})
