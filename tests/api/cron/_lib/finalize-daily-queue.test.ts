import { afterEach, describe, expect, it, vi } from 'vitest'

import { finalizeDailyQueue, getPreviousMoscowDate } from '../../../../api/cron/_lib/finalize-daily-queue.js'

afterEach(() => vi.unstubAllGlobals())

describe('daily queue finalization', () => {
  it('uses the previous Moscow calendar date', () => {
    expect(getPreviousMoscowDate(new Date('2026-07-11T21:10:00.000Z'))).toBe('2026-07-11')
  })

  it('calls the service-role-only RPC', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ missed_count: 2, expired_count: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(finalizeDailyQueue({
      env: { supabaseUrl: 'https://example.supabase.co/', supabaseServiceRoleKey: 'service-key' },
      targetDate: '2026-07-10',
    })).resolves.toEqual({ missed_count: 2, expired_count: 1 })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/finalize_daily_queue',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ target_date: '2026-07-10' }) }),
    )
  })
})
