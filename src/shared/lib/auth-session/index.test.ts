/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'

import { getSessionAal, hasAal2, isPrivilegedRole, isYandexAuthUser } from './index'

function createToken(payload: object) {
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `header.${encodedPayload}.signature`
}

describe('auth session helpers', () => {
  it('reads aal from the access token', () => {
    const session = { access_token: createToken({ aal: 'aal2' }) }

    expect(getSessionAal(session as never)).toBe('aal2')
    expect(hasAal2(session as never)).toBe(true)
  })

  it('detects privileged roles', () => {
    expect(isPrivilegedRole('mayor')).toBe(true)
    expect(isPrivilegedRole('consumer')).toBe(false)
  })

  it('detects Yandex identities on a linked user', () => {
    expect(
      isYandexAuthUser({
        app_metadata: { provider: 'email', providers: ['email', 'custom:yandex'] },
        identities: [{ provider: 'custom:yandex' }],
      } as never),
    ).toBe(true)
  })
})
