import { describe, expect, it } from 'vitest'

import type { ProfileWithStations } from '@/entities/profile'

import {
  getAvailableStations,
  getNextSelectedStationId,
} from './available-stations'
import { STATIONS } from './stations'

const profile: ProfileWithStations = {
  id: 'profile-id',
  auth_user_id: 'auth-user-id',
  full_name: 'Dev Operator',
  role: 'operator',
  is_active: true,
  stations: [
    {
      id: STATIONS[1].id,
      name: STATIONS[1].name,
      address: STATIONS[1].address,
    },
  ],
}

describe('available station helpers', () => {
  it('returns static stations before profile is loaded', () => {
    expect(getAvailableStations(null)).toEqual(STATIONS)
  })

  it('returns profile stations after profile is loaded', () => {
    expect(getAvailableStations(profile)).toEqual([STATIONS[1]])
  })

  it('keeps selected station when it is available', () => {
    expect(getNextSelectedStationId(STATIONS[1].id, [STATIONS[1]])).toBe(STATIONS[1].id)
  })

  it('resets unavailable selected station to the first available station', () => {
    expect(getNextSelectedStationId(STATIONS[0].id, [STATIONS[1]])).toBe(STATIONS[1].id)
  })

  it('clears selected station when no stations are available', () => {
    expect(getNextSelectedStationId(STATIONS[0].id, [])).toBe('')
  })
})
