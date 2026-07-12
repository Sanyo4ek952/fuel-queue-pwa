import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from '../../api/public-api.js'

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode
      return response
    }),
    setHeader: vi.fn((key: string, value: string) => {
      response.headers[key.toLowerCase()] = value
      return response
    }),
    end: vi.fn((body: string) => {
      response.body = body
      return response
    }),
  }

  return response
}

function stubPublicQueueEnv() {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  vi.stubEnv('PUBLIC_QUEUE_RATE_LIMIT_SALT', 'server-only-salt')
}

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/public-queue-check', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('requires the server-only rate limit salt', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    vi.stubEnv('PUBLIC_QUEUE_RATE_LIMIT_SALT', '')
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.5' },
        query: { action: 'public-queue-check' },
        body: { plateNumber: 'A123BC777', phoneLast4: '1234' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({
      error: 'Public queue rate limit is not configured.',
    })
  })

  it('rejects an unknown public API action', async () => {
    stubPublicQueueEnv()
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.5' },
        query: { action: 'unknown-action' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ error: 'Public API action not found.' })
  })

  it('hashes the server-observed IP and does not forward the raw IP', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    stubPublicQueueEnv()
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        status: 'NOT_FOUND',
        public_status: 'NOT_FOUND',
        remaining_attempts: 4,
        retry_after_seconds: 0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.5, 198.51.100.9' },
        query: { action: 'public-queue-check' },
        body: { plateNumber: 'A123BC777', phoneLast4: '1234', clientIp: '1.1.1.1' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const expectedHash = createHmac('sha256', 'server-only-salt')
      .update('203.0.113.5')
      .digest('hex')
    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>

    expect(headers.authorization).toBe('Bearer service-role-key')
    expect(headers['x-forwarded-for']).toBeUndefined()
    expect(JSON.parse(init.body as string)).toEqual({
      plate_number: '\u0410123\u0412\u0421777',
      phone_last4: '1234',
      client_ip_hash: expectedHash,
    })
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain('203.0.113.5')
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain('1.1.1.1')
  })

  it('normalizes public queue input before calling the RPC', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    stubPublicQueueEnv()
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        status: 'FOUND',
        public_status: 'QUEUE_NOT_READY',
        queue_number: 19,
        ticket_number: 19,
        remaining_attempts: 9,
        retry_after_seconds: 0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { 'x-real-ip': '203.0.113.10' },
        query: { action: 'public-queue-check' },
        body: { plateNumber: 'K 019 MM 777', phoneLast4: ' 00-19 ' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [, init] = fetchMock.mock.calls[0]

    expect(JSON.parse(init.body as string)).toMatchObject({
      plate_number: '\u041A019\u041C\u041C777',
      phone_last4: '0019',
    })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'FOUND',
      queue_number: 19,
    })
  })

  it('returns invalid input without calling the RPC', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    stubPublicQueueEnv()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { 'x-real-ip': '203.0.113.10' },
        query: { action: 'public-queue-check' },
        body: { plateNumber: 'D123ZZ777', phoneLast4: '0019' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'INVALID_INPUT',
      public_status: 'INVALID_INPUT',
      error_code: 'PUBLIC_QUEUE_INVALID_INPUT',
    })
  })

  it('proxies rate limit metadata returned by the RPC', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    stubPublicQueueEnv()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createJsonResponse({
          status: 'LIMIT_EXCEEDED',
          public_status: 'LIMIT_EXCEEDED',
          queue_number: null,
          remaining_attempts: 0,
          retry_after_seconds: 1800,
          error_code: 'PUBLIC_QUEUE_IP_RATE_LIMITED',
        }),
      ),
    )
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { 'x-real-ip': '203.0.113.10' },
        query: { action: 'public-queue-check' },
        body: { plateNumber: 'A123BC777', phoneLast4: '1234' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'LIMIT_EXCEEDED',
      remaining_attempts: 0,
      retry_after_seconds: 1800,
      error_code: 'PUBLIC_QUEUE_IP_RATE_LIMITED',
    })
  })
})
