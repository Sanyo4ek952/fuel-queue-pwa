type YandexUserInfo = {
  id?: unknown
  psuid?: unknown
  login?: unknown
  default_email?: unknown
  emails?: unknown
  display_name?: unknown
  real_name?: unknown
  first_name?: unknown
  last_name?: unknown
  default_avatar_id?: unknown
  is_avatar_empty?: unknown
}

const yandexUserInfoUrl = 'https://login.yandex.ru/info?format=json'

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init?.headers,
    },
  })
}

function getAccessToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)

  if (bearerMatch?.[1]) {
    return bearerMatch[1].trim()
  }

  return ''
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getFirstEmail(profile: YandexUserInfo) {
  const defaultEmail = getString(profile.default_email)

  if (defaultEmail) {
    return defaultEmail
  }

  if (!Array.isArray(profile.emails)) {
    return null
  }

  for (const email of profile.emails) {
    const normalizedEmail = getString(email)

    if (normalizedEmail) {
      return normalizedEmail
    }
  }

  return null
}

function getSubject(profile: YandexUserInfo) {
  return (
    getString(profile.id) ??
    getString(profile.psuid) ??
    getString(profile.login)
  )
}

function getAvatarUrl(profile: YandexUserInfo) {
  const isAvatarEmpty = profile.is_avatar_empty === true || profile.is_avatar_empty === 'true'
  const avatarId = getString(profile.default_avatar_id)

  if (isAvatarEmpty || !avatarId) {
    return null
  }

  return `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200`
}

function normalizeYandexProfile(profile: YandexUserInfo) {
  const sub = getSubject(profile)

  if (!sub) {
    return null
  }

  const email = getFirstEmail(profile)
  const givenName = getString(profile.first_name)
  const familyName = getString(profile.last_name)
  const name =
    getString(profile.real_name) ??
    getString(profile.display_name) ??
    getString([givenName, familyName].filter(Boolean).join(' ')) ??
    getString(profile.login) ??
    sub
  const preferredUsername = getString(profile.login)
  const picture = getAvatarUrl(profile)

  return {
    sub,
    id: sub,
    email,
    email_verified: Boolean(email),
    name,
    full_name: name,
    given_name: givenName,
    family_name: familyName,
    preferred_username: preferredUsername,
    user_name: preferredUsername,
    avatar_url: picture,
    picture,
    default_email: email,
  }
}

export async function handleYandexUserInfoRequest(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders,
    })
  }

  const accessToken = getAccessToken(request)

  if (!accessToken) {
    return jsonResponse({ error: 'missing_access_token' }, { status: 401 })
  }

  const yandexResponse = await fetch(yandexUserInfoUrl, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
    },
  })

  if (!yandexResponse.ok) {
    return jsonResponse({ error: 'yandex_userinfo_failed' }, { status: 502 })
  }

  const profile = normalizeYandexProfile(await yandexResponse.json())

  if (!profile) {
    return jsonResponse({ error: 'yandex_userinfo_missing_subject' }, { status: 502 })
  }

  return jsonResponse(profile)
}

type DenoRuntime = {
  Deno?: {
    serve: (handler: (request: Request) => Response | Promise<Response>) => void
  }
}

;(globalThis as typeof globalThis & DenoRuntime).Deno?.serve(handleYandexUserInfoRequest)
