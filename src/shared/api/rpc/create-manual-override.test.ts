import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseCreateManualOverrideResult } from './create-manual-override'

describe('parseCreateManualOverrideResult', () => {
  it('parses a valid create_manual_override response', () => {
    expect(
      parseCreateManualOverrideResult({
        id: 'override-id',
        date: '2026-07-05',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        normalized_plate_number: 'А123ВС',
        reason: 'Supervisor decision',
        approved_by: 'profile-id',
        expires_at: null,
        used_at: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
      }),
    ).toMatchObject({
      id: 'override-id',
      normalized_plate_number: 'А123ВС',
      reason: 'Supervisor decision',
      sync_status: 'SYNCED',
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseCreateManualOverrideResult({ id: 'override-id' })).toBeNull()
  })
})
