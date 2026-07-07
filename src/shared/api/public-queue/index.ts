import {
  parsePublicQueueCheckResult,
  type CheckPublicQueueParams,
  type NoShowGraceSetting,
  type PublicQueueCheckResult,
  type RpcResult,
} from '@/shared/api/rpc'
import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'

const publicApiTimeoutMs = 10_000
const publicApiUnavailableMessage =
  'Не удалось проверить номер: сервер проверки временно недоступен.'
const publicApiTimeoutMessage =
  'Не удалось проверить номер: сервер проверки не ответил за 10 секунд.'
const publicApiNetworkMessage =
  'Не удалось проверить номер: нет соединения с сервером проверки.'

function buildPublicQueueCheckErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return publicApiUnavailableMessage
  }

  const message = error.message.trim()
  const normalizedMessage = message.toLowerCase()

  if (!message) {
    return publicApiUnavailableMessage
  }

  if (message === publicApiTimeoutMessage || normalizedMessage.includes('timed out')) {
    return publicApiTimeoutMessage
  }

  if (
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('network') ||
    normalizedMessage.includes('load failed')
  ) {
    return publicApiNetworkMessage
  }

  if (message === 'Supabase is not configured.') {
    return 'Не удалось проверить номер: публичная проверка не настроена на сервере.'
  }

  if (message === 'Unexpected public queue check response.') {
    return 'Не удалось проверить номер: сервер вернул неполный ответ.'
  }

  if (message === 'Public queue check failed.') {
    return 'Не удалось проверить номер: сервер проверки вернул ошибку.'
  }

  return `Не удалось проверить номер: ${message}`
}

async function requestPublicApi(path: string, init?: RequestInit) {
  return fetchWithTimeout(path, init, {
    timeoutMs: publicApiTimeoutMs,
    timeoutMessage: publicApiTimeoutMessage,
  })
}

async function readJson(response: Response) {
  const value = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : publicApiUnavailableMessage

    throw new Error(message)
  }

  return value
}

function parseNoShowGrace(value: unknown): NoShowGraceSetting | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<NoShowGraceSetting>
  const days = typeof result.days === 'number' ? result.days : Number(result.days)

  if (!Number.isFinite(days)) {
    return null
  }

  return {
    days: Math.trunc(days),
    updated_at: result.updated_at ?? null,
    client_mutation_id: result.client_mutation_id ?? null,
  }
}

export async function checkPublicQueuePositionViaApi({
  plateNumber,
  phoneLast4,
}: CheckPublicQueueParams): Promise<RpcResult<PublicQueueCheckResult>> {
  try {
    const response = await requestPublicApi('/api/public-queue-check', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        plateNumber,
        phoneLast4,
      }),
    })
    const json = await readJson(response)
    const parsed = parsePublicQueueCheckResult(json)

    if (!parsed) {
      return {
        data: null,
        error: buildPublicQueueCheckErrorMessage(
          new Error('Unexpected public queue check response.'),
        ),
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: buildPublicQueueCheckErrorMessage(error),
    }
  }
}

export async function getPublicNoShowGraceViaApi(): Promise<RpcResult<NoShowGraceSetting>> {
  try {
    const response = await requestPublicApi('/api/public-no-show-grace')
    const json = await readJson(response)
    const parsed = parseNoShowGrace(json)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected public no-show grace response.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Настройки очереди временно недоступны.',
    }
  }
}
