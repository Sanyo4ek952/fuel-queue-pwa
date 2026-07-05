import { z } from 'zod'

export const createManualOverrideSchema = z.object({
  targetDate: z.string().min(1, 'Выберите дату'),
  plateNumber: z.string().trim().min(1, 'Введите госномер'),
  reason: z.string().trim().min(1, 'Укажите причину'),
  expiresAt: z.string().trim().optional(),
})

export type CreateManualOverrideFormInput = z.input<typeof createManualOverrideSchema>
export type CreateManualOverrideFormValues = z.infer<typeof createManualOverrideSchema>
