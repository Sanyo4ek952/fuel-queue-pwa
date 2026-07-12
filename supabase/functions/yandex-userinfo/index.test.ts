import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleYandexUserInfoRequest } from './index.ts'

function createYandexResponse(status = 200) {
  return new Response(
    JSON.stringify({
      id: 'yandex-user-id',
      default_email: 'resident@example.local',
      display_name: 'Resident User',
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  )
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('yandex-userinfo Edge Function', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts Authorization Bearer token and forwards it to Yandex UserInfo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createYandexResponse())

    vi.stubGlobal('fetch', fetchMock)

    const response = await handleYandexUserInfoRequest(
      new Request('https://example.functions.supabase.co/yandex-userinfo', {
        headers: {
          authorization: 'Bearer yandex-token',
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(await readJson(response)).toMatchObject({
      sub: 'yandex-user-id',
      id: 'yandex-user-id',
      email: 'resident@example.local',
      name: 'Resident User',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://login.yandex.ru/info?format=json', {
      headers: {
        Authorization: 'OAuth yandex-token',
      },
    })
  })

  it('trims Bearer token whitespace before forwarding it to Yandex', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createYandexResponse())

    vi.stubGlobal('fetch', fetchMock)

    const response = await handleYandexUserInfoRequest(
      new Request('https://example.functions.supabase.co/yandex-userinfo', {
        headers: {
          authorization: 'bearer   yandex-token   ',
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://login.yandex.ru/info?format=json', {
      headers: {
        Authorization: 'OAuth yandex-token',
      },
    })
  })

  it('rejects access_token passed as a query parameter', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const response = await handleYandexUserInfoRequest(
      new Request('https://example.functions.supabase.co/yandex-userinfo?access_token=yandex-token'),
    )

    expect(response.status).toBe(401)
    expect(await readJson(response)).toEqual({ error: 'missing_access_token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed authorization headers without calling Yandex', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    for (const authorization of ['OAuth yandex-token', 'Basic yandex-token']) {
      const response = await handleYandexUserInfoRequest(
        new Request('https://example.functions.supabase.co/yandex-userinfo', {
          headers: {
            authorization,
          },
        }),
      )

      expect(response.status).toBe(401)
      expect(await readJson(response)).toEqual({ error: 'missing_access_token' })
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
