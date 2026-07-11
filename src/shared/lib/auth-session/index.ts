import type { Session, User } from '@supabase/supabase-js'

import type { UserRole } from '@/shared/config/roles'

export const PRIVILEGED_ROLES: readonly UserRole[] = [
  'mayor',
  'station_manager',
  'cashier',
  'mayor_assistant',
]

type JwtPayload = {
  aal?: string
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')

  return atob(padded)
}

function decodeJwtPayload(accessToken: string): JwtPayload | null {
  const [, payload] = accessToken.split('.')

  if (!payload) {
    return null
  }

  try {
    const value = JSON.parse(decodeBase64Url(payload)) as unknown

    return value && typeof value === 'object' ? (value as JwtPayload) : null
  } catch {
    return null
  }
}

export function getSessionAal(session: Session | null) {
  if (!session?.access_token) {
    return null
  }

  return decodeJwtPayload(session.access_token)?.aal ?? null
}

export function hasAal2(session: Session | null) {
  return getSessionAal(session) === 'aal2'
}

export function isPrivilegedRole(role: UserRole) {
  return PRIVILEGED_ROLES.includes(role)
}

export function isYandexAuthUser(user: User | null) {
  if (!user) {
    return false
  }

  const provider = user.app_metadata?.provider
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers
    : []
  const identities = Array.isArray(user.identities) ? user.identities : []

  return (
    provider === 'custom:yandex' ||
    provider === 'yandex' ||
    providers.includes('custom:yandex') ||
    providers.includes('yandex') ||
    identities.some((identity) => identity.provider === 'custom:yandex' || identity.provider === 'yandex')
  )
}
