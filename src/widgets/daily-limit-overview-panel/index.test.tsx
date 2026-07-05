/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectedStationId: 'station-id',
  useDailyLimitOverview: vi.fn(),
}))

vi.mock('@/entities/daily-limit', () => ({
  useDailyLimitOverview: mocks.useDailyLimitOverview,
}))

vi.mock('@/features/select-station', () => ({
  StationSelect: () => <div data-testid="station-select" />,
  useSelectedStation: (selector: (state: { selectedStationId: string }) => string) =>
    selector({ selectedStationId: mocks.selectedStationId }),
}))

import { DailyLimitOverviewPanel } from './index'

describe('DailyLimitOverviewPanel', () => {
  beforeEach(() => {
    mocks.selectedStationId = 'station-id'
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: false,
        id: null,
        date: '2026-07-05',
        station_id: 'station-id',
        status: null,
        total_vehicle_limit: null,
        max_liters_per_vehicle: null,
        occupied_vehicle_count: 0,
        remaining_vehicle_count: null,
        fuel_type_overviews: [],
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
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a missing limit state', () => {
    render(<DailyLimitOverviewPanel />)

    expect(screen.getByText('Лимит не создан')).toBeInTheDocument()
  })

  it('renders a closed limit and filled fuel type', () => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: true,
        id: 'limit-id',
        date: '2026-07-05',
        station_id: 'station-id',
        status: 'CLOSED',
        total_vehicle_limit: 5,
        max_liters_per_vehicle: 50,
        occupied_vehicle_count: 5,
        remaining_vehicle_count: 0,
        updated_at: null,
        fuel_type_overviews: [
          {
            fuel_type: 'AI_95',
            vehicle_limit: 5,
            occupied_vehicle_count: 5,
            remaining_vehicle_count: 0,
            liters_limit: 250,
            reserved_liters: 250,
            remaining_liters: 0,
          },
        ],
        source: 'online',
        is_estimated: false,
        unsynced_reservation_count: 0,
      },
      isOnline: true,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<DailyLimitOverviewPanel />)

    expect(screen.getByText('Закрыт')).toBeInTheDocument()
    expect(screen.getByText('Лимит не открыт')).toBeInTheDocument()
    expect(screen.getByText('АИ-95')).toBeInTheDocument()
  })

  it('shows offline and estimated snapshot warnings', () => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: true,
        id: 'limit-id',
        date: '2026-07-05',
        station_id: 'station-id',
        status: 'OPEN',
        total_vehicle_limit: 10,
        max_liters_per_vehicle: 50,
        occupied_vehicle_count: 3,
        remaining_vehicle_count: 7,
        updated_at: null,
        fuel_type_overviews: [],
        source: 'offline',
        is_estimated: true,
        unsynced_reservation_count: 1,
      },
      isOnline: false,
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(<DailyLimitOverviewPanel />)

    expect(screen.getByText('Offline snapshot')).toBeInTheDocument()
    expect(screen.getByText('Оценочный остаток')).toBeInTheDocument()
  })
})
