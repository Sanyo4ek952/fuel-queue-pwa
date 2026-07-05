import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { corsHeaders, getMaxConfig, jsonResponse, normalizePhone, sendMaxMessage } from '../_shared/max-api.ts'

type DriverRow = {
  id: string
  full_name: string
  phone: string | null
  created_at: string
}

type ContactPayload = {
  vcfInfo: string
  hash: string
  phone: string
  maxUserId: number | null
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name)

  if (!value) {
    throw new Error(`${name} is not configured.`)
  }

  return value
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)

  if (leftBytes.length !== rightBytes.length) {
    return false
  }

  let diff = 0

  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index]
  }

  return diff === 0
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

async function verifyContactHash({
  botToken,
  vcfInfo,
  hash,
}: {
  botToken: string
  vcfInfo: string
  hash: string
}) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(botToken),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(vcfInfo))
  const hex = toHex(signature)
  const base64 = toBase64(signature)
  const base64Url = base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

  return [hex, base64, base64Url].some((candidate) => timingSafeEqual(candidate, hash))
}

function normalizeVcfInfo(value: string) {
  return value.replaceAll('\\r\\n', '\r\n').replaceAll('\\n', '\n')
}

function extractPhoneFromVcf(vcfInfo: string) {
  const match = vcfInfo.match(/^TEL[^:]*:(.+)$/im)

  return match?.[1]?.trim() ?? ''
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function extractContactPayload(update: Record<string, unknown>): ContactPayload | null {
  const message = getObject(update.message) ?? getObject(update)
  const body = getObject(message?.body)
  const attachments = Array.isArray(body?.attachments)
    ? body.attachments
    : Array.isArray(message?.attachments)
      ? message.attachments
      : []
  const contactAttachment = attachments
    .map(getObject)
    .find((attachment) => attachment?.type === 'contact')

  if (!contactAttachment) {
    return null
  }

  const payload = getObject(contactAttachment.payload)
  const rawVcfInfo = typeof payload?.vcf_info === 'string' ? payload.vcf_info : ''
  const hash = typeof payload?.hash === 'string' ? payload.hash : ''
  const vcfInfo = normalizeVcfInfo(rawVcfInfo)
  const maxInfo = getObject(payload?.max_info)
  const maxUserId =
    numberFromUnknown(maxInfo?.user_id) ??
    numberFromUnknown(maxInfo?.id) ??
    numberFromUnknown(getObject(message?.sender)?.user_id) ??
    numberFromUnknown(getObject(update.user)?.user_id)

  if (!vcfInfo || !hash) {
    return null
  }

  return {
    vcfInfo,
    hash,
    phone: extractPhoneFromVcf(vcfInfo),
    maxUserId,
  }
}

function getUpdateUserId(update: Record<string, unknown>) {
  return numberFromUnknown(getObject(update.user)?.user_id)
}

function getUpdateChatId(update: Record<string, unknown>) {
  return numberFromUnknown(update.chat_id)
}

async function sendContactRequest({
  token,
  apiBaseUrl,
  userId,
  chatId,
}: {
  token: string
  apiBaseUrl: string
  userId?: number
  chatId?: number
}) {
  await sendMaxMessage({
    token,
    apiBaseUrl,
    userId,
    chatId,
    body: {
      text: 'Чтобы получать сообщения от АЗС, поделитесь номером телефона через кнопку ниже.',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                {
                  type: 'request_contact',
                  text: 'Поделиться контактом',
                },
              ],
            ],
          },
        },
      ],
    },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const webhookSecret = Deno.env.get('MAX_WEBHOOK_SECRET')

    if (webhookSecret) {
      const actualSecret = request.headers.get('X-Max-Bot-Api-Secret')

      if (actualSecret !== webhookSecret) {
        return jsonResponse({ error: 'INVALID_WEBHOOK_SECRET' }, { status: 401 })
      }
    }

    const { token, apiBaseUrl } = getMaxConfig()
    const supabase = createClient(
      getRequiredEnv('SUPABASE_URL'),
      getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
        },
      },
    )
    const update = (await request.json()) as Record<string, unknown>
    const updateType = String(update.update_type ?? '')
    const chatId = getUpdateChatId(update) ?? undefined
    const userId = getUpdateUserId(update) ?? undefined

    if (updateType === 'bot_stopped' || updateType === 'dialog_removed') {
      if (userId) {
        await supabase
          .from('driver_max_links')
          .update({
            is_linked: false,
            consent_status: 'revoked',
            unlinked_at: new Date().toISOString(),
          })
          .eq('max_user_id', userId)
      }

      return jsonResponse({ ok: true })
    }

    if (updateType === 'bot_started') {
      await sendContactRequest({ token, apiBaseUrl, userId, chatId })

      return jsonResponse({ ok: true })
    }

    if (updateType !== 'message_created') {
      return jsonResponse({ ok: true })
    }

    const contact = extractContactPayload(update)

    if (!contact) {
      await sendContactRequest({ token, apiBaseUrl, userId, chatId })

      return jsonResponse({ ok: true, contact: 'requested' })
    }

    const hashIsValid = await verifyContactHash({
      botToken: token,
      vcfInfo: contact.vcfInfo,
      hash: contact.hash,
    })

    if (!hashIsValid) {
      await sendMaxMessage({
        token,
        apiBaseUrl,
        userId: contact.maxUserId ?? userId,
        chatId,
        body: {
          text: 'Не удалось подтвердить контакт MAX. Пожалуйста, нажмите кнопку и поделитесь контактом ещё раз.',
        },
      })

      return jsonResponse({ ok: false, error: 'INVALID_CONTACT_HASH' }, { status: 400 })
    }

    const normalizedPhone = normalizePhone(contact.phone)

    if (!normalizedPhone) {
      return jsonResponse({ ok: false, error: 'PHONE_NOT_FOUND_IN_CONTACT' }, { status: 400 })
    }

    const { data: drivers, error: driversError } = await supabase
      .from('drivers')
      .select('id, full_name, phone, created_at')
      .not('phone', 'is', null)
      .order('created_at', { ascending: true })

    if (driversError) {
      throw driversError
    }

    const matchedDriver = ((drivers ?? []) as DriverRow[]).find(
      (driver) => normalizePhone(driver.phone) === normalizedPhone,
    )

    if (!matchedDriver) {
      await sendMaxMessage({
        token,
        apiBaseUrl,
        userId: contact.maxUserId ?? userId,
        chatId,
        body: {
          text: 'Этот номер телефона не найден в списке водителей АЗС. Обратитесь к оператору.',
        },
      })

      return jsonResponse({ ok: true, linked: false, reason: 'DRIVER_PHONE_NOT_FOUND' })
    }

    const effectiveUserId = contact.maxUserId ?? userId

    if (!effectiveUserId) {
      return jsonResponse({ ok: false, error: 'MAX_USER_ID_NOT_FOUND' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { error: upsertError } = await supabase
      .from('driver_max_links')
      .upsert(
        {
          driver_id: matchedDriver.id,
          normalized_phone: normalizedPhone,
          max_user_id: effectiveUserId,
          max_chat_id: chatId ?? null,
          is_linked: true,
          linked_at: now,
          unlinked_at: null,
          consent_status: 'granted',
          consent_at: now,
        },
        {
          onConflict: 'normalized_phone',
        },
      )

    if (upsertError) {
      throw upsertError
    }

    await sendMaxMessage({
      token,
      apiBaseUrl,
      userId: effectiveUserId,
      chatId,
      body: {
        text: 'Готово. Ваш номер привязан к MAX-боту АЗС, теперь вы сможете получать сообщения по записям.',
      },
    })

    return jsonResponse({ ok: true, linked: true })
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: 400 },
    )
  }
})
