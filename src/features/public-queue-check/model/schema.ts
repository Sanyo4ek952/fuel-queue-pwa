import { z } from 'zod'

import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const publicQueueCheckSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
  phoneLast4: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 4, 'Введите последние 4 цифры телефона'),
})

export type PublicQueueCheckFormInput = z.input<typeof publicQueueCheckSchema>
export type PublicQueueCheckFormValues = z.infer<typeof publicQueueCheckSchema>
