const requestTimeoutMs = 9_000

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }
}

function sendJson(response, statusCode, payload) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function getForwardedIp(request) {
  return (
    firstHeaderValue(request.headers['x-forwarded-for']) ||
    firstHeaderValue(request.headers['x-real-ip']) ||
    firstHeaderValue(request.headers['cf-connecting-ip']) ||
    ''
  )
}

async function readBody(request) {
  if (request.body && typeof request.body === 'object') {
    return request.body
  }

  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')

  return rawBody ? JSON.parse(rawBody) : {}
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  try {
    const body = await readBody(request)
    const plateNumber = typeof body.plateNumber === 'string' ? body.plateNumber : ''
    const phoneLast4 = typeof body.phoneLast4 === 'string' ? body.phoneLast4 : ''
    const forwardedIp = getForwardedIp(request)
    const supabaseResponse = await fetchWithTimeout(
      `${url}/rest/v1/rpc/check_public_queue_position`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
          ...(forwardedIp ? { 'x-forwarded-for': forwardedIp } : {}),
        },
        body: JSON.stringify({
          plate_number: plateNumber,
          phone_last4: phoneLast4,
        }),
      },
    )
    const responseBody = await supabaseResponse.json().catch(() => null)

    if (!supabaseResponse.ok) {
      sendJson(response, supabaseResponse.status, {
        error:
          responseBody && typeof responseBody.message === 'string'
            ? responseBody.message
            : 'Public queue check failed.',
      })
      return
    }

    sendJson(response, 200, responseBody)
  } catch (error) {
    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : 'Public queue check failed.',
    })
  }
}
