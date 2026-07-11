import { describe, expect, it } from 'vitest'

import { formatServerArrivalAt } from './index'

describe('formatServerArrivalAt', () => {
  it('formats an already persisted server timestamp', () => {
    expect(formatServerArrivalAt('2026-07-25T10:00:00.000Z')).toContain('25')
  })

  it('does not calculate missing or invalid ETA values', () => {
    expect(formatServerArrivalAt(null)).toBeNull()
    expect(formatServerArrivalAt('invalid')).toBeNull()
  })
})
