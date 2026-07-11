import { describe, expect, it } from 'vitest'

import { fuelingScheduleFormSchema } from './schema'

describe('fuelingScheduleFormSchema', () => {
  it('accepts valid schedule values', () => {
    expect(
      fuelingScheduleFormSchema.parse({
        targetDate: '2026-07-09',
        stationId: '00000000-0000-4000-8000-000000000001',
        schedules: [
          {
            fuelCategory: 'GASOLINE',
            startTime: '13:00',
            intervalMinutes: '5',
            vehiclesPerInterval: '5',
          },
        ],
      }),
    ).toEqual({
      targetDate: '2026-07-09',
      stationId: '00000000-0000-4000-8000-000000000001',
      schedules: [
        {
          fuelCategory: 'GASOLINE',
          startTime: '13:00',
          intervalMinutes: 5,
          vehiclesPerInterval: 5,
        },
      ],
    })
  })

  it('rejects invalid time and numeric bounds', () => {
    expect(() =>
      fuelingScheduleFormSchema.parse({
        targetDate: '2026-07-09',
        stationId: '00000000-0000-4000-8000-000000000001',
        schedules: [
          {
            fuelCategory: 'GASOLINE',
            startTime: '25:00',
            intervalMinutes: 0,
            vehiclesPerInterval: 101,
          },
        ],
      }),
    ).toThrow()
  })
})
