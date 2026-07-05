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
  full_name: 'Dev Cashier',
  first_name: 'Dev',
  last_name: 'Cashier',
  middle_name: null,
  position: 'Cashier',
  signature_name: 'Dev Cashier',
  role: 'cashier',
  is_active: true,
  approval_status: 'approved',
  requested_station_id: null,
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  deactivated_by: null,
  deactivated_at: null,
  deactivation_reason: null,
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
