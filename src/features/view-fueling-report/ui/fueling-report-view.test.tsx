/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useFuelingReport: vi.fn(),
}))

vi.mock('@/features/view-fueling-report/model/use-fueling-report', () => ({
  useFuelingReport: mocks.useFuelingReport,
}))

vi.mock('../model/use-fueling-report', () => ({
  useFuelingReport: mocks.useFuelingReport,
}))

import { FuelingReportView } from './fueling-report-view'

const report = {
  summary: {
    total_liters: 125.5,
    fueling_count: 3,
    unique_vehicle_count: 2,
    average_liters_per_fueling: 41.833,
  },
  by_station: [
    {
      station_id: '10000000-0000-4000-8000-000000000001',
      station_name: 'АЗС №1',
      total_liters: 80.5,
      fueling_count: 2,
      unique_vehicle_count: 2,
    },
  ],
  by_fuel_type: [
    {
      fuel_type: 'AI_95',
      total_liters: 80.5,
      fueling_count: 2,
      unique_vehicle_count: 2,
    },
  ],
  by_day: [
    {
      date: '2026-07-07',
      total_liters: 125.5,
      fueling_count: 3,
      unique_vehicle_count: 2,
    },
  ],
}

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
})

describe('FuelingReportView', () => {
  beforeEach(() => {
    mocks.useFuelingReport.mockReturnValue({
      data: report,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders summary and report tables', async () => {
    render(<FuelingReportView />)

    expect(screen.getByText('125,5 л')).toBeInTheDocument()
    expect(screen.getAllByText('Заправки').length).toBeGreaterThan(0)
    expect(screen.getAllByText('АЗС №1').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('tab', { name: 'По топливу' }))
    expect(screen.getByText('АИ-95')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'По дням' }))
    expect(screen.getAllByText(/7.*2026/).length).toBeGreaterThan(0)
  })
})
