import { describe, expect, it } from 'vitest'

import { sendMaxMessageSchema } from './schema'

describe('sendMaxMessageSchema', () => {
  it('allows up to 10 recipients', () => {
    const result = sendMaxMessageSchema.safeParse({
      recipientPhones: Array.from({ length: 10 }, (_, index) => `7999000000${index}`),
      templateId: '',
      messageText: 'Сообщение',
    })

    expect(result.success).toBe(true)
  })

  it('rejects more than 10 recipients and empty message text', () => {
    const result = sendMaxMessageSchema.safeParse({
      recipientPhones: Array.from({ length: 11 }, (_, index) => `7999000000${index}`),
      templateId: '',
      messageText: '',
    })

    expect(result.success).toBe(false)
  })
})
