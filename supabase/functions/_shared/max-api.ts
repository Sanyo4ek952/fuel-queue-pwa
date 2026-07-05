export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  })
}

export function normalizePhone(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '')

  if (digits.length === 11 && digits.startsWith('8')) {
    return `7${digits.slice(1)}`
  }

  if (digits.length === 10) {
    return `7${digits}`
  }

  return digits
}

export function getMaxConfig() {
  const token = Deno.env.get('MAX_BOT_TOKEN')
  const apiBaseUrl = Deno.env.get('MAX_API_BASE_URL') ?? 'https://platform-api2.max.ru'

  if (!token) {
    throw new Error('MAX_BOT_TOKEN is not configured.')
  }

  return {
    token,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
  }
}

export async function sendMaxMessage({
  token,
  apiBaseUrl,
  userId,
  chatId,
  body,
}: {
  token: string
  apiBaseUrl: string
  userId?: number
  chatId?: number
  body: Record<string, unknown>
}) {
  const searchParams = new URLSearchParams()

  if (chatId) {
    searchParams.set('chat_id', String(chatId))
  } else if (userId) {
    searchParams.set('user_id', String(userId))
  } else {
    throw new Error('MAX recipient id is missing.')
  }

  const response = await fetch(`${apiBaseUrl}/messages?${searchParams.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : text

    throw new Error(message || `MAX API error: ${response.status}`)
  }

  return data
}

export function extractMaxMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const root = value as Record<string, unknown>
  const message = root.message && typeof root.message === 'object'
    ? (root.message as Record<string, unknown>)
    : root
  const body = message.body && typeof message.body === 'object'
    ? (message.body as Record<string, unknown>)
    : null
  const id = message.id ?? message.message_id ?? body?.mid ?? body?.seq

  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}
