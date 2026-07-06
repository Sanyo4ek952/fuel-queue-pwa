import { describe, expect, it } from 'vitest'

import { createPreferentialQueueSchema } from './schema'

describe('createPreferentialQueueSchema', () => {
  it('accepts a queue name', () => {
    expect(createPreferentialQueueSchema.parse({ name: 'Врачи' })).toEqual({ name: 'Врачи' })
  })

  it('rejects an empty queue name', () => {
    expect(() => createPreferentialQueueSchema.parse({ name: '   ' })).toThrow()
  })
})
