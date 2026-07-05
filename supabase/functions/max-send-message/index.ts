import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { corsHeaders, extractMaxMessageId, getMaxConfig, jsonResponse, normalizePhone, sendMaxMessage } from '../_shared/max-api.ts'

type DriverMaxLink = {
  driver_id: string | null
  normalized_phone: string
  max_user_id: number
  max_chat_id: number | null
  is_linked: boolean
  consent_status: 'granted' | 'revoked'
}

type DeliveryResult = {
  normalized_phone: string
  status: 'sent' | 'failed' | 'skipped'
  max_message_id: string | null
  error_message: string | null
}

const allowedRoles = new Set(['mayor', 'station_manager', 'cashier', 'mayor_assistant'])

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name)

  if (!value) {
    throw new Error(`${name} is not configured.`)
  }

  return value
}

function validatePayload(value: unknown) {
  if (!value || typeof value !== 'object') {
    throw new Error('INVALID_PAYLOAD')
  }

  const payload = value as Record<string, unknown>
  const recipientPhones = Array.isArray(payload.recipient_phones)
    ? payload.recipient_phones.map((phone) => normalizePhone(String(phone))).filter(Boolean)
    : []
  const uniquePhones = [...new Set(recipientPhones)]
  const messageText = typeof payload.message_text === 'string' ? payload.message_text.trim() : ''
  const templateId = typeof payload.template_id === 'string' && payload.template_id
    ? payload.template_id
    : null

  if (uniquePhones.length < 1 || uniquePhones.length > 10) {
    throw new Error('RECIPIENT_COUNT_MUST_BE_1_TO_10')
  }

  if (!messageText || messageText.length > 4000) {
    throw new Error('INVALID_MESSAGE_TEXT')
  }

  return {
    recipientPhones: uniquePhones,
    messageText,
    templateId,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token, apiBaseUrl } = getMaxConfig()
    const supabaseUrl = getRequiredEnv('SUPABASE_URL')
    const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const authHeader = request.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')

    if (!jwt) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    })
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt)

    if (userError || !userData.user) {
      return jsonResponse({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, is_active, approval_status')
      .eq('auth_user_id', userData.user.id)
      .eq('is_active', true)
      .eq('approval_status', 'approved')
      .single()

    if (profileError || !profile || !allowedRoles.has(profile.role)) {
      return jsonResponse({ error: 'FORBIDDEN' }, { status: 403 })
    }

    const { recipientPhones, messageText, templateId } = validatePayload(await request.json())
    const { data: links, error: linksError } = await supabase
      .from('driver_max_links')
      .select('driver_id, normalized_phone, max_user_id, max_chat_id, is_linked, consent_status')
      .in('normalized_phone', recipientPhones)

    if (linksError) {
      throw linksError
    }

    const linkByPhone = new Map(
      ((links ?? []) as DriverMaxLink[]).map((link) => [link.normalized_phone, link]),
    )
    const { data: batch, error: batchError } = await supabase
      .from('max_message_batches')
      .insert({
        sender_profile_id: profile.id,
        template_id: templateId,
        message_text: messageText,
        recipient_count: recipientPhones.length,
        status: 'pending',
      })
      .select('id')
      .single()

    if (batchError || !batch) {
      throw batchError ?? new Error('BATCH_NOT_CREATED')
    }

    const results: DeliveryResult[] = []

    for (const normalizedPhone of recipientPhones) {
      const link = linkByPhone.get(normalizedPhone)

      if (!link || !link.is_linked || link.consent_status !== 'granted') {
        results.push({
          normalized_phone: normalizedPhone,
          status: 'skipped',
          max_message_id: null,
          error_message: 'Recipient is not linked or consent is not granted.',
        })
        continue
      }

      const { data: delivery, error: deliveryError } = await supabase
        .from('max_message_deliveries')
        .insert({
          batch_id: batch.id,
          driver_id: link.driver_id,
          normalized_phone: normalizedPhone,
          max_user_id: link.max_user_id,
          max_chat_id: link.max_chat_id,
          status: 'pending',
        })
        .select('id')
        .single()

      if (deliveryError || !delivery) {
        results.push({
          normalized_phone: normalizedPhone,
          status: 'failed',
          max_message_id: null,
          error_message: deliveryError?.message ?? 'Delivery row was not created.',
        })
        continue
      }

      try {
        const maxResponse = await sendMaxMessage({
          token,
          apiBaseUrl,
          userId: link.max_user_id,
          chatId: link.max_chat_id ?? undefined,
          body: {
            text: messageText,
            notify: true,
          },
        })
        const maxMessageId = extractMaxMessageId(maxResponse)

        await supabase
          .from('max_message_deliveries')
          .update({
            status: 'sent',
            max_message_id: maxMessageId,
            sent_at: new Date().toISOString(),
          })
          .eq('id', delivery.id)

        results.push({
          normalized_phone: normalizedPhone,
          status: 'sent',
          max_message_id: maxMessageId,
          error_message: null,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'MAX send failed.'

        await supabase
          .from('max_message_deliveries')
          .update({
            status: 'failed',
            error_message: errorMessage,
          })
          .eq('id', delivery.id)

        results.push({
          normalized_phone: normalizedPhone,
          status: 'failed',
          max_message_id: null,
          error_message: errorMessage,
        })
      }
    }

    const sentCount = results.filter((result) => result.status === 'sent').length
    const finalStatus = sentCount === recipientPhones.length ? 'sent' : sentCount > 0 ? 'partial' : 'failed'

    await supabase
      .from('max_message_batches')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', batch.id)

    return jsonResponse({
      batch_id: batch.id,
      status: finalStatus,
      results,
    })
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' },
      { status: 400 },
    )
  }
})
