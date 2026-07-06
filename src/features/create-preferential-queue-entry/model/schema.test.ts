import { describe, expect, it } from 'vitest'

import { createPreferentialQueueEntrySchema } from './schema'

describe('createPreferentialQueueEntrySchema', () => {
  it('normalizes plate number and accepts queue entry values', () => {
    expect(
      createPreferentialQueueEntrySchema.parse({
        queueId: '00000000-0000-4000-8000-000000000001',
        plateNumber: 'а123вс777',
        driverFullName: 'Иванов Иван',
        driverPhone: '',
        fuelType: 'AI_95',
        requestedLiters: 30,
        comment: '',
      }),
    ).toMatchObject({
      queueId: '00000000-0000-4000-8000-000000000001',
      plateNumber: 'А123ВС777',
      driverFullName: 'Иванов Иван',
      fuelType: 'AI_95',
      requestedLiters: 30,
    })
  })

  it('rejects invalid queue entry values', () => {
    expect(() =>
      createPreferentialQueueEntrySchema.parse({
        queueId: '',
        plateNumber: '',
        driverFullName: '',
        fuelType: 'AI_95',
        requestedLiters: 0,
      }),
    ).toThrow()
  })
})
