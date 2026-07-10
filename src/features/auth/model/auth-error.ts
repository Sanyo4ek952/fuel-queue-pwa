import type { AuthResult } from '@/shared/api/auth'

export const AUTH_RATE_LIMIT_MESSAGE = 'Слишком много запросов. Повторите отправку через 60 секунд.'

export class AuthMutationError extends Error {
  status?: number
  code?: string

  constructor(result: Pick<AuthResult<unknown>, 'error' | 'status' | 'code'>) {
    super(result.status === 429 ? AUTH_RATE_LIMIT_MESSAGE : (result.error ?? 'Ошибка авторизации.'))
    this.name = 'AuthMutationError'
    this.status = result.status
    this.code = result.code
  }
}

export function isAuthRateLimitError(error: unknown) {
  return error instanceof AuthMutationError && error.status === 429
}
