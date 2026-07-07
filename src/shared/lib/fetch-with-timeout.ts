export type FetchTimeoutOptions = {
  timeoutMs: number
  timeoutMessage: string
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { timeoutMs, timeoutMessage }: FetchTimeoutOptions,
) {
  const controller = new AbortController()
  let timedOut = false

  const abortFromCaller = () => {
    controller.abort(init.signal?.reason)
  }

  if (init.signal?.aborted) {
    abortFromCaller()
  } else {
    init.signal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage)
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
    init.signal?.removeEventListener('abort', abortFromCaller)
  }
}
