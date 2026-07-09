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
  startTime: '13:00',
  intervalMinutes: 5,
  vehiclesPerInterval: 5,
}

describe('calculateArrivalTime', () => {
  it('assigns one arrival time to each interval group', () => {
    expect(calculateArrivalTime(gasolineSchedule, 1)).toBe('13:00')
    expect(calculateArrivalTime(gasolineSchedule, 5)).toBe('13:00')
    expect(calculateArrivalTime(gasolineSchedule, 6)).toBe('13:05')
    expect(calculateArrivalTime(gasolineSchedule, 10)).toBe('13:05')
    expect(calculateArrivalTime(gasolineSchedule, 11)).toBe('13:10')
    expect(calculateArrivalTime(gasolineSchedule, 15)).toBe('13:10')
  })

  it('returns null without a usable schedule', () => {
    expect(calculateArrivalTime(undefined, 1)).toBeNull()
    expect(calculateArrivalTime({ ...gasolineSchedule, startTime: 'bad' }, 1)).toBeNull()
  })
})

describe('calculateFuelingEndTime', () => {
  it('calculates the projected end time by total queue count', () => {
    expect(calculateFuelingEndTime(gasolineSchedule, 20)).toBe('13:20')
    expect(calculateFuelingEndTime(gasolineSchedule, 0)).toBe('13:00')
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
        { fuelCategory: 'GASOLINE', startTime: '13:00', intervalMinutes: 5, vehiclesPerInterval: 1 },
        { fuelCategory: 'DIESEL', startTime: '14:00', intervalMinutes: 10, vehiclesPerInterval: 1 },
      ],
    )

    expect(eta.get('gas-1')).toMatchObject({ categoryPosition: 1, arrivalTime: '13:00' })
    expect(eta.get('gas-2')).toMatchObject({ categoryPosition: 2, arrivalTime: '13:05' })
    expect(eta.get('diesel-1')).toMatchObject({ categoryPosition: 1, arrivalTime: '14:00' })
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
        startTime: '13:00',
        endTime: '13:05',
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
})
