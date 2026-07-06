import { z } from 'zod'

import { FUEL_TYPES } from '@/shared/constants'
import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const createFuelingRecordSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
  liters: z.coerce.number().positive('Литры должны быть больше нуля'),
  fuelType: z.enum(FUEL_TYPES),
  comment: z.string().trim().optional(),
})

export type CreateFuelingRecordFormInput = z.input<typeof createFuelingRecordSchema>
export type CreateFuelingRecordFormValues = z.infer<typeof createFuelingRecordSchema>
