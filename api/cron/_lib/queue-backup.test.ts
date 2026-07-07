import { describe, expect, it } from 'vitest'

import {
  buildQueueBackupCsv,
  getMoscowDateString,
  getQueueBackupFileName,
  isQueueBackupDate,
  selectOldQueueBackupFileIds,
} from './queue-backup.js'

describe('queue backup csv', () => {
  it('builds an Excel-friendly semicolon CSV with BOM and escaped values', () => {
    const csv = buildQueueBackupCsv([
      {
        date: '2026-07-07',
        queue_number: 1,
        station_name: 'АЗС #1',
        normalized_plate_number: 'А123ВС777',
        driver_full_name: 'Иванов "Иван"',
        driver_phone: '+7;900',
        is_within_today_limit: true,
        comment: 'строка 1\nстрока 2',
      },
    ])

    expect(csv.startsWith('\uFEFFДата;Номер очереди;АЗС')).toBe(true)
    expect(csv).toContain('"Иванов ""Иван"""')
    expect(csv).toContain('"+7;900"')
    expect(csv).toContain('"строка 1\nстрока 2"')
    expect(csv).toContain(';Да;')
  })

  it('uses Moscow date for backup names', () => {
    expect(getMoscowDateString(new Date('2026-07-06T21:05:00.000Z'))).toBe('2026-07-07')
    expect(getQueueBackupFileName('2026-07-07')).toBe('azs-queue-backup-2026-07-07.csv')
    expect(getQueueBackupFileName()).toBe('azs-queue-backup-all.csv')
  })

  it('validates queue backup date strings', () => {
    expect(isQueueBackupDate('2026-07-07')).toBe(true)
    expect(isQueueBackupDate('2026-7-7')).toBe(false)
    expect(isQueueBackupDate('all')).toBe(false)
  })

  it('selects only old queue backup files beyond retention', () => {
    const files = [
      { id: 'old', name: 'azs-queue-backup-2026-07-01.csv' },
      { id: 'newer', name: 'azs-queue-backup-2026-07-02.csv' },
      { id: 'other', name: 'manual.csv' },
    ]

    expect(selectOldQueueBackupFileIds(files, 1)).toEqual(['old'])
  })
})
