import { describe, expect, it } from 'vitest'

import {
  buildFuelingScheduleEta,
  buildFuelingScheduleSummary,
  calculateArrivalTime,
  calculateFuelingEndTime,
  type FuelingScheduleConfig,
} from './index'

const gasolineSchedule: FuelingScheduleConfig = {
  fuelCategory: 'GASOLINE',
  date: '2026-07-25',
  startTime: '13:00',
  intervalMinutes: 5,
  vehiclesPerInterval: 5,
}

describe('calculateArrivalTime', () => {
  it('assigns one arrival time to each interval group', () => {
    expect(calculateArrivalTime(gasolineSchedule, 1)).toBe('13:00 25 июля')
    expect(calculateArrivalTime(gasolineSchedule, 5)).toBe('13:00 25 июля')
    expect(calculateArrivalTime(gasolineSchedule, 6)).toBe('13:05 25 июля')
    expect(calculateArrivalTime(gasolineSchedule, 10)).toBe('13:05 25 июля')
    expect(calculateArrivalTime(gasolineSchedule, 11)).toBe('13:10 25 июля')
    expect(calculateArrivalTime(gasolineSchedule, 15)).toBe('13:10 25 июля')
  })

  it('returns null without a usable schedule', () => {
    expect(calculateArrivalTime(undefined, 1)).toBeNull()
    expect(calculateArrivalTime({ ...gasolineSchedule, startTime: 'bad' }, 1)).toBeNull()
    expect(calculateArrivalTime({ ...gasolineSchedule, date: 'bad' }, 1)).toBeNull()
  })

  it('keeps the calendar date when arrival time crosses midnight', () => {
    expect(
      calculateArrivalTime(
        {
          fuelCategory: 'GASOLINE',
          date: '2026-07-25',
          startTime: '23:55',
          intervalMinutes: 10,
          vehiclesPerInterval: 1,
        },
        2,
      ),
    ).toBe('00:05 26 июля')
  })
})

describe('calculateFuelingEndTime', () => {
  it('calculates the projected end time by total queue count', () => {
    expect(calculateFuelingEndTime(gasolineSchedule, 20)).toBe('13:20 25 июля')
    expect(calculateFuelingEndTime(gasolineSchedule, 0)).toBe('13:00 25 июля')
  })

  it('keeps the calendar date when end time crosses midnight', () => {
    expect(
      calculateFuelingEndTime(
        {
          fuelCategory: 'GASOLINE',
          date: '2026-07-25',
          startTime: '23:55',
          intervalMinutes: 10,
          vehiclesPerInterval: 1,
        },
        2,
      ),
    ).toBe('00:15 26 июля')
  })
})

describe('buildFuelingScheduleEta', () => {
  it('calculates positions separately by fuel category', () => {
    const eta = buildFuelingScheduleEta(
      [
        { id: 'gas-1', ticketNumber: 1, fuelCategory: 'GASOLINE' },
        { id: 'diesel-1', ticketNumber: 2, fuelCategory: 'DIESEL' },
        { id: 'gas-2', ticketNumber: 3, fuelCategory: 'GASOLINE' },
      ],
      [
        { fuelCategory: 'GASOLINE', date: '2026-07-25', startTime: '13:00', intervalMinutes: 5, vehiclesPerInterval: 1 },
        { fuelCategory: 'DIESEL', date: '2026-07-25', startTime: '14:00', intervalMinutes: 10, vehiclesPerInterval: 1 },
      ],
    )

    expect(eta.get('gas-1')).toMatchObject({ categoryPosition: 1, arrivalTime: '13:00 25 июля' })
    expect(eta.get('gas-2')).toMatchObject({ categoryPosition: 2, arrivalTime: '13:05 25 июля' })
    expect(eta.get('diesel-1')).toMatchObject({ categoryPosition: 1, arrivalTime: '14:00 25 июля' })
  })
})

describe('buildFuelingScheduleSummary', () => {
  it('keeps summary counts independent of visible filters', () => {
    expect(
      buildFuelingScheduleSummary(
        [
          { id: 'gas-1', ticketNumber: 1, fuelCategory: 'GASOLINE' },
          { id: 'gas-2', ticketNumber: 2, fuelCategory: 'GASOLINE' },
        ],
        [gasolineSchedule],
        ['GASOLINE', 'DIESEL'],
      ),
    ).toEqual([
      {
        fuelCategory: 'GASOLINE',
        queueCount: 2,
        startTime: '13:00 25 июля',
        endTime: '13:05 25 июля',
        intervalMinutes: 5,
        vehiclesPerInterval: 5,
      },
      {
        fuelCategory: 'DIESEL',
        queueCount: 0,
        startTime: null,
        endTime: null,
        intervalMinutes: null,
        vehiclesPerInterval: null,
      },
    ])
  })

  it('can calculate summary end time from server category counts instead of loaded rows', () => {
    expect(
      buildFuelingScheduleSummary(
        [{ id: 'visible-gas-1', ticketNumber: 1, fuelCategory: 'GASOLINE' }],
        [
          {
            fuelCategory: 'GASOLINE',
            date: '2026-07-10',
            startTime: '13:00',
            intervalMinutes: 13,
            vehiclesPerInterval: 5,
          },
        ],
        ['GASOLINE'],
        { GASOLINE: 400 },
      ),
    ).toEqual([
      {
        fuelCategory: 'GASOLINE',
        queueCount: 400,
        startTime: '13:00 10 июля',
        endTime: '06:20 11 июля',
        intervalMinutes: 13,
        vehiclesPerInterval: 5,
      },
    ])
  })
})
