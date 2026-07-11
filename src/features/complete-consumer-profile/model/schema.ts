import { z } from 'zod'

import { isValidRuPhoneNumber, normalizeRuPhoneNumber } from '@/shared/lib/phone-number'

const phoneValidationMessage = 'Введите телефон в формате +7 999 123-45-67'

export const completeConsumerProfileSchema = z.object({
  firstName: z.string().trim().min(2, 'Введите имя.'),
  lastName: z.string().trim().min(2, 'Введите фамилию.'),
  middleName: z.string().trim().optional(),
  phone: z
    .string()
    .trim()
    .min(1, phoneValidationMessage)
    .refine(isValidRuPhoneNumber, phoneValidationMessage)
    .transform(normalizeRuPhoneNumber),
})

export type CompleteConsumerProfileInput = z.input<typeof completeConsumerProfileSchema>
export type CompleteConsumerProfileValues = z.output<typeof completeConsumerProfileSchema>
