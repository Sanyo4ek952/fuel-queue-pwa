import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'
import { notifyAuthSessionChange } from '@/shared/api/auth'

function getProtectedApiErrorMessage(status: number, value: unknown, fallbackMessage: string) {
  if (status === 401) {
    return 'Сессия истекла. Войдите снова.'
  }

  if (status === 403) {
    return 'Недостаточно прав для выполнения операции.'
  }

  if (status === 504) {
    return 'Сервер не ответил. Проверьте соединение и повторите.'
  }

  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
    ? value.error
    : fallbackMessage
}

export async function requestProtectedRpcApi(path: string, body: unknown, fallbackMessage: string) {
  let response: Response

  try {
    response = await fetchWithTimeout(
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
        timeoutMessage: 'Сервер не ответил. Проверьте соединение и повторите.',
      },
    )
  } catch (error) {
    const message =
      error instanceof Error && /timed out|failed to fetch|network|load failed/i.test(error.message)
        ? 'Сервер не ответил. Проверьте соединение и повторите.'
        : fallbackMessage

    throw new Error(message)
  }

  const value = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthSessionChange(null)
    }

    throw new Error(getProtectedApiErrorMessage(response.status, value, fallbackMessage))
  }

  return value
}
