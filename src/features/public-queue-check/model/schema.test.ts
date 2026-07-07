import { describe, expect, it } from 'vitest'

import { publicQueueCheckSchema } from './schema'

describe('publicQueueCheckSchema', () => {
  it.each(['а123вс777', 'a123bc777', 'А 123 ВС 777', 'A-123-BC-777'])(
    'normalizes valid plate input %s',
    (plateNumber) => {
      expect(publicQueueCheckSchema.parse({ plateNumber, phoneLast4: '1234' })).toMatchObject({
        plateNumber: 'А123ВС777',
        phoneLast4: '1234',
      })
    },
  )

  it.each(['', 'D123ZZ777', 'А12ВС777', 'А123ВС7'])(
    'rejects invalid plate input %s',
    (plateNumber) => {
      expect(publicQueueCheckSchema.safeParse({ plateNumber, phoneLast4: '1234' }).success).toBe(
        false,
      )
    },
  )

  it.each(['0000', '1234', '9999'])('accepts phone last digits %s', (phoneLast4) => {
    expect(publicQueueCheckSchema.parse({ plateNumber: 'А123ВС777', phoneLast4 })).toMatchObject({
      phoneLast4,
    })
  })

  it.each(['', '123', '12345', 'abcd'])('rejects phone last digits %s', (phoneLast4) => {
    expect(publicQueueCheckSchema.safeParse({ plateNumber: 'А123ВС777', phoneLast4 }).success).toBe(
      false,
    )
  })
})
