import { z } from 'zod'

import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const createPersonalVehicleLiterLimitSchema = z.object({
  targetDate: z.string().min(1, 'Выберите дату'),
  plateNumber: z
    .string()
    .min(1, 'Введите госномер')
    .transform((value) => normalizePlateNumber(value))
    .refine(isValidPlateNumber, 'Госномер должен быть в формате А123ВС777'),
  liters: z.coerce.number().positive('Литры должны быть больше нуля'),
  comment: z.string().max(500, 'Комментарий слишком длинный').optional(),
})

export type CreatePersonalVehicleLiterLimitFormInput = z.input<
  typeof createPersonalVehicleLiterLimitSchema
>
export type CreatePersonalVehicleLiterLimitFormValues = z.infer<
  typeof createPersonalVehicleLiterLimitSchema
>
