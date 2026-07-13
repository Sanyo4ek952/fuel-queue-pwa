import {
  AuthSessionError,
  clearSessionCookies,
  getServerAuthSession,
  toPublicSession,
} from '../_lib/auth-session.js'

type SessionRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

type SessionResponse = {
  status: (statusCode: number) => SessionResponse
  setHeader: (key: string, value: string | string[]) => SessionResponse
  end: (body: string) => void
}

function sendJson(response: SessionResponse, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

function getErrorStatusCode(error: unknown) {
  return error instanceof AuthSessionError ? error.statusCode : 500
}

export default async function handler(request: SessionRequest, response: SessionResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  try {
    const session = await getServerAuthSession({ request, response })

    sendJson(response, 200, toPublicSession(session))
  } catch (error) {
    if (error instanceof AuthSessionError && error.statusCode === 401) {
      clearSessionCookies(response)
      sendJson(response, 200, null)
      return
    }

    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(response, 504, { error: 'Supabase request timed out.' })
      return
    }

    sendJson(response, getErrorStatusCode(error), {
      error: error instanceof Error ? error.message : 'Session request failed.',
    })
  }
}
