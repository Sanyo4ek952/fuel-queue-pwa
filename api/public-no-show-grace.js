const requestTimeoutMs = 9_000

function normalizeSupabaseUrl(url) {
  return url?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseConfig() {
  return {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }
}

function sendJson(response, statusCode, payload) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300')
  response.end(JSON.stringify(payload))
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
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  try {
    const supabaseResponse = await fetchWithTimeout(
      `${url}/rest/v1/rpc/get_reservation_no_show_grace_days`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
        },
        body: '{}',
      },
    )
    const responseBody = await supabaseResponse.json().catch(() => null)

    if (!supabaseResponse.ok) {
      sendJson(response, supabaseResponse.status, {
        error:
          responseBody && typeof responseBody.message === 'string'
            ? responseBody.message
            : 'Public no-show grace check failed.',
      })
      return
    }

    sendJson(response, 200, {
      days: Number.isFinite(Number(responseBody)) ? Math.trunc(Number(responseBody)) : 0,
      updated_at: null,
      client_mutation_id: null,
    })
  } catch (error) {
    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : 'Public no-show grace check failed.',
    })
  }
}
