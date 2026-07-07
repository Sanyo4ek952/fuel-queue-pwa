import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/rpc', () => ({
  parsePublicQueueCheckResult: vi.fn(() => null),
}))

import { checkPublicQueuePositionViaApi } from './index'

describe('checkPublicQueuePositionViaApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('explains when the public check server is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Supabase is not configured.' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const result = await checkPublicQueuePositionViaApi({
      plateNumber: 'А123ВС777',
      phoneLast4: '1234',
    })

    expect(result.error).toBe(
      'Не удалось проверить номер: публичная проверка не настроена на сервере.',
    )
  })

  it('explains when the public check request fails because of network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await checkPublicQueuePositionViaApi({
      plateNumber: 'А123ВС777',
      phoneLast4: '1234',
    })

    expect(result.error).toBe('Не удалось проверить номер: нет соединения с сервером проверки.')
  })

  it('explains when the public check response has an unexpected shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const result = await checkPublicQueuePositionViaApi({
      plateNumber: 'А123ВС777',
      phoneLast4: '1234',
    })

    expect(result.error).toBe('Не удалось проверить номер: сервер вернул неполный ответ.')
  })
})
