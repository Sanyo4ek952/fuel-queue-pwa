/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFuelingReport: vi.fn(),
}))

vi.mock('@/shared/api/rpc', () => ({
  getFuelingReport: mocks.getFuelingReport,
}))

import type { FuelingReportFilterValues } from './schema'
import { useFuelingReport } from './use-fueling-report'

const report = {
  summary: {
    total_liters: 0,
    fueling_count: 0,
    unique_vehicle_count: 0,
    average_liters_per_fueling: 0,
  },
  by_station: [],
  by_fuel_type: [],
  by_day: [],
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

describe('useFuelingReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFuelingReport.mockResolvedValue({ data: report, error: null })
  })

  it('passes null stationIds for all stations', async () => {
    const filters: FuelingReportFilterValues = {
      periodPreset: 'today',
      dateFrom: '2026-07-07',
      dateTo: '2026-07-07',
      stationId: 'all',
    }

    renderHook(() => useFuelingReport({ filters }), {
      wrapper: makeWrapper(makeQueryClient()),
    })

    await waitFor(() => expect(mocks.getFuelingReport).toHaveBeenCalled())

    expect(mocks.getFuelingReport).toHaveBeenCalledWith({
      dateFrom: '2026-07-07',
      dateTo: '2026-07-07',
      stationIds: null,
    })
  })

  it('passes selected station id as an array', async () => {
    const stationId = '10000000-0000-4000-8000-000000000001'
    const filters: FuelingReportFilterValues = {
      periodPreset: 'today',
      dateFrom: '2026-07-07',
      dateTo: '2026-07-07',
      stationId,
    }

    renderHook(() => useFuelingReport({ filters }), {
      wrapper: makeWrapper(makeQueryClient()),
    })

    await waitFor(() => expect(mocks.getFuelingReport).toHaveBeenCalled())

    expect(mocks.getFuelingReport).toHaveBeenCalledWith({
      dateFrom: '2026-07-07',
      dateTo: '2026-07-07',
      stationIds: [stationId],
    })
  })
})
