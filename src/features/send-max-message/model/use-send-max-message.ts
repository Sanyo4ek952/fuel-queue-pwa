import { useMutation } from '@tanstack/react-query'

import { sendMaxMessage, type SendMaxMessageResult } from '@/shared/api/max-messages'

import type { SendMaxMessageFormValues } from './schema'

export function useSendMaxMessage() {
  return useMutation({
    mutationFn: async (values: SendMaxMessageFormValues): Promise<SendMaxMessageResult> =>
      sendMaxMessage({
        recipientPhones: values.recipientPhones,
        templateId: values.templateId || null,
        messageText: values.messageText,
      }),
  })
}

export type { SendMaxMessageResult }
