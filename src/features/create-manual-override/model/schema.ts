import { z } from 'zod'

import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const createManualOverrideSchema = z.object({
  targetDate: z.string().min(1, 'Выберите дату'),
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
  reason: z.string().trim().min(1, 'Укажите причину'),
  expiresAt: z.string().trim().optional(),
})

export type CreateManualOverrideFormInput = z.input<typeof createManualOverrideSchema>
export type CreateManualOverrideFormValues = z.infer<typeof createManualOverrideSchema>
