import { getAuthSession } from '@/shared/api/auth'
import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'

export async function requestProtectedRpcApi(path: string, body: unknown, fallbackMessage: string) {
  const sessionResult = await getAuthSession()

  if (sessionResult.error) {
    throw new Error(sessionResult.error)
  }

  if (!sessionResult.data?.access_token) {
    throw new Error('Authorization token is required.')
  }

  const response = await fetchWithTimeout(
    path,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionResult.data.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs: 10_000,
      timeoutMessage: fallbackMessage,
    },
  )
  const value = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : fallbackMessage

    throw new Error(message)
  }

  return value
}
