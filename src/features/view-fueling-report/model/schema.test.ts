import { describe, expect, it, vi } from 'vitest'

import {
  fuelingReportFilterSchema,
  getFuelingReportPresetDateRange,
} from './schema'

const stationId = '10000000-0000-4000-8000-000000000001'

describe('fuelingReportFilterSchema', () => {
  it('accepts today, week, month and custom period values', () => {
    for (const periodPreset of ['today', 'week', 'month', 'custom'] as const) {
      expect(
        fuelingReportFilterSchema.parse({
          periodPreset,
          dateFrom: '2026-07-01',
          dateTo: '2026-07-07',
          stationId: 'all',
        }),
      ).toMatchObject({ periodPreset })
    }
  })

  it('rejects missing custom period dates and reversed ranges', () => {
    expect(() =>
      fuelingReportFilterSchema.parse({
        periodPreset: 'custom',
        dateFrom: '',
        dateTo: '2026-07-07',
        stationId: 'all',
      }),
    ).toThrow()

    expect(() =>
      fuelingReportFilterSchema.parse({
        periodPreset: 'custom',
        dateFrom: '2026-07-08',
        dateTo: '2026-07-07',
        stationId: 'all',
      }),
    ).toThrow()
  })

  it('accepts all stations and uuid station ids', () => {
    expect(
      fuelingReportFilterSchema.parse({
        periodPreset: 'today',
        dateFrom: '2026-07-07',
        dateTo: '2026-07-07',
        stationId: 'all',
      }).stationId,
    ).toBe('all')

    expect(
      fuelingReportFilterSchema.parse({
        periodPreset: 'today',
        dateFrom: '2026-07-07',
        dateTo: '2026-07-07',
        stationId,
      }).stationId,
    ).toBe(stationId)

    expect(() =>
      fuelingReportFilterSchema.parse({
        periodPreset: 'today',
        dateFrom: '2026-07-07',
        dateTo: '2026-07-07',
        stationId: 'station-1',
      }),
    ).toThrow()
  })
})

describe('getFuelingReportPresetDateRange', () => {
  it('returns inclusive rolling ranges', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'))

    expect(getFuelingReportPresetDateRange('today')).toEqual({
      dateFrom: '2026-07-07',
      dateTo: '2026-07-07',
    })
    expect(getFuelingReportPresetDateRange('week')).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-07',
    })
    expect(getFuelingReportPresetDateRange('month')).toEqual({
      dateFrom: '2026-06-08',
      dateTo: '2026-07-07',
    })

    vi.useRealTimers()
  })
})
