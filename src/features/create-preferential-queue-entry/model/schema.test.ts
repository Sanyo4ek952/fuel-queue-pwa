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

  it('normalizes empty driver phone to undefined', () => {
    const result = createPreferentialQueueEntrySchema.parse({
      queueId: '00000000-0000-4000-8000-000000000001',
      plateNumber: 'a123bc777',
      driverFullName: 'Ivan Ivanov',
      driverPhone: '',
      fuelType: 'AI_95',
      requestedLiters: 30,
      comment: '',
    })

    expect(result.driverPhone).toBeUndefined()
  })

  it('normalizes driver phone when provided', () => {
    expect(
      createPreferentialQueueEntrySchema.parse({
        queueId: '00000000-0000-4000-8000-000000000001',
        plateNumber: 'a123bc777',
        driverFullName: 'Ivan Ivanov',
        driverPhone: '89991234567',
        fuelType: 'AI_95',
        requestedLiters: 30,
        comment: '',
      }),
    ).toMatchObject({
      driverPhone: '+79991234567',
    })
  })

  it.each(['+7 999 123-45', '999123456', '99912345678'])(
    'rejects invalid driver phone %s',
    (driverPhone) => {
      expect(
        createPreferentialQueueEntrySchema.safeParse({
          queueId: '00000000-0000-4000-8000-000000000001',
          plateNumber: 'a123bc777',
          driverFullName: 'Ivan Ivanov',
          driverPhone,
          fuelType: 'AI_95',
          requestedLiters: 40,
        }).success,
      ).toBe(false)
    },
  )

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
