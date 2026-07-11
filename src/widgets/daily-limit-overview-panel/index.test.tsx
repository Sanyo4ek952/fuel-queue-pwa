/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useDailyLimitOverview: vi.fn(),
}))

vi.mock('@/entities/daily-limit', () => ({
  useDailyLimitOverview: mocks.useDailyLimitOverview,
}))

import { DailyLimitOverviewPanel } from './index'

describe('DailyLimitOverviewPanel', () => {
  beforeEach(() => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: false,
        id: null,
        date: '2026-07-05',
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
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a missing limit state', () => {
    render(<DailyLimitOverviewPanel />)

    expect(screen.getByText('Лимит не создан')).toBeInTheDocument()
  })

  it('renders a category forecast', () => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: true,
        id: 'limit-id',
        date: '2026-07-05',
        station_id: null,
        status: 'CLOSED',
        updated_at: null,
        category_overviews: [
          {
            fuel_category: 'GASOLINE',
            label: 'Бензин',
            limit_mode: 'fuel_liters',
            vehicle_limit: 0,
            liters_limit: 250,
            queue_count: 8,
            queued_liters: 300,
            covered_vehicle_count: 5,
            covered_liters: 250,
            remaining_vehicle_count: null,
            remaining_liters: 0,
            projected_queue_number: 12,
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
    expect(screen.getByText('Прогноз дня')).toBeInTheDocument()
    expect(screen.getByText('Бензин')).toBeInTheDocument()
    expect(screen.queryByText('Хватит до №')).not.toBeInTheDocument()
    expect(screen.queryByText('До номера')).not.toBeInTheDocument()
  })

  it('renders limit cards grouped by station', () => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: true,
        id: null,
        date: '2026-07-05',
        station_id: null,
        station_name: 'Общий пул',
        station_address: null,
        status: 'OPEN',
        updated_at: null,
        category_overviews: [
          {
            fuel_type: 'AI_95',
            fuel_category: 'GASOLINE',
            label: 'АИ-95',
            limit_mode: 'fuel_liters',
            vehicle_limit: 0,
            liters_limit: 400,
            queue_count: 8,
            queued_liters: 300,
            covered_vehicle_count: 5,
            covered_liters: 250,
            remaining_vehicle_count: null,
            remaining_liters: 150,
            projected_queue_number: 12,
          },
        ],
        station_overviews: [
          {
            exists: true,
            id: 'limit-station-1',
            date: '2026-07-05',
            station_id: 'station-1',
            station_name: 'АЗС №1',
            station_address: 'Адрес 1',
            status: 'OPEN',
            updated_at: null,
            category_overviews: [
              {
                fuel_type: 'AI_95',
                fuel_category: 'GASOLINE',
                label: 'АИ-95',
                limit_mode: 'fuel_liters',
                vehicle_limit: 0,
                liters_limit: 250,
                queue_count: 8,
                queued_liters: 300,
                covered_vehicle_count: 5,
                covered_liters: 250,
                remaining_vehicle_count: null,
                remaining_liters: 0,
                projected_queue_number: 12,
              },
            ],
          },
          {
            exists: true,
            id: 'limit-station-2',
            date: '2026-07-05',
            station_id: 'station-2',
            station_name: 'АЗС №2',
            station_address: 'Адрес 2',
            status: 'OPEN',
            updated_at: null,
            category_overviews: [
              {
                fuel_type: 'DIESEL',
                fuel_category: 'DIESEL',
                label: 'Дизель',
                limit_mode: 'vehicle_count',
                vehicle_limit: 4,
                liters_limit: null,
                queue_count: 6,
                queued_liters: 180,
                covered_vehicle_count: 4,
                covered_liters: 120,
                remaining_vehicle_count: 0,
                remaining_liters: null,
                projected_queue_number: 4,
              },
            ],
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

    expect(screen.getAllByText('Общий пул')).not.toHaveLength(0)
    expect(screen.getAllByText('АЗС №1')).not.toHaveLength(0)
    expect(screen.getAllByText('АЗС №2')).not.toHaveLength(0)
    expect(screen.getAllByText('АИ-95')).not.toHaveLength(0)
    expect(screen.getByText('Дизель')).toBeInTheDocument()
  })

  it('shows offline and estimated snapshot warnings', () => {
    mocks.useDailyLimitOverview.mockReturnValue({
      data: {
        exists: true,
        id: 'limit-id',
        date: '2026-07-05',
        station_id: null,
        status: 'OPEN',
        updated_at: null,
        category_overviews: [],
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
    expect(screen.getByText('Оценочный прогноз')).toBeInTheDocument()
  })
})
