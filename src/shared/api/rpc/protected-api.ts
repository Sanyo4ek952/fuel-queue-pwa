import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'

export async function requestProtectedRpcApi(path: string, body: unknown, fallbackMessage: string) {
  const response = await fetchWithTimeout(
    path,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
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
