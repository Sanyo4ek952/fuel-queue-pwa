import {
  assertSameOriginRequest,
  clearSessionCookies,
  getSessionCookies,
  getSupabaseConfig,
  signOutServerSession,
  AuthSessionError,
} from '../_lib/auth-session.js'

type LogoutRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
}

type LogoutResponse = {
  status: (statusCode: number) => LogoutResponse
  setHeader: (key: string, value: string | string[]) => LogoutResponse
  end: (body: string) => void
}

function sendJson(response: LogoutResponse, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

export default async function handler(request: LogoutRequest, response: LogoutResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  try {
    assertSameOriginRequest(request)

    const { accessToken } = getSessionCookies(request)

    await signOutServerSession({
      accessToken,
      config: getSupabaseConfig(),
    })
    clearSessionCookies(response)
    sendJson(response, 200, { ok: true })
  } catch (error) {
    clearSessionCookies(response)

    if (error instanceof AuthSessionError) {
      sendJson(response, error.statusCode, { error: error.message })
      return
    }

    sendJson(response, 200, { ok: true })
  }
}
