import { z } from 'zod'

import { FUEL_TYPES } from '@/shared/constants'

export const createFuelingRecordSchema = z.object({
  plateNumber: z.string().trim().min(1, 'Введите госномер'),
  liters: z.coerce.number().positive('Литры должны быть больше нуля'),
  fuelType: z.enum(FUEL_TYPES),
  comment: z.string().trim().optional(),
})

export type CreateFuelingRecordFormInput = z.input<typeof createFuelingRecordSchema>
export type CreateFuelingRecordFormValues = z.infer<typeof createFuelingRecordSchema>
