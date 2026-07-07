import { describe, expect, it } from 'vitest'

import { queueBackupExportSchema } from './schema'

describe('queueBackupExportSchema', () => {
  it('uses all queue mode when date is empty', () => {
    expect(queueBackupExportSchema.parse({ targetDate: '' })).toEqual({
      targetDate: null,
    })
  })

  it('keeps a valid target date', () => {
    expect(queueBackupExportSchema.parse({ targetDate: '2026-07-07' })).toEqual({
      targetDate: '2026-07-07',
    })
  })

  it('rejects invalid target dates', () => {
    expect(() => queueBackupExportSchema.parse({ targetDate: '07.07.2026' })).toThrow()
  })
})
