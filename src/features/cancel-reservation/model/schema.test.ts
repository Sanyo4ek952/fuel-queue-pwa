import { describe, expect, it } from 'vitest'

import { cancelReservationSchema } from './schema'

describe('cancelReservationSchema', () => {
  it('allows owner cancellation without comment', () => {
    expect(
      cancelReservationSchema.safeParse({
        reason: 'OWNER_CANCELLED',
        comment: '',
      }).success,
    ).toBe(true)
  })

  it('requires comment for other reason', () => {
    expect(
      cancelReservationSchema.safeParse({
        reason: 'OTHER',
        comment: '',
      }).success,
    ).toBe(false)

    expect(
      cancelReservationSchema.safeParse({
        reason: 'OTHER',
        comment: 'Ошибка в заявке',
      }).success,
    ).toBe(true)
  })
})
