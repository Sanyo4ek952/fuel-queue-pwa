import { z } from 'zod'

import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const checkVehicleSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
})

export type CheckVehicleFormInput = z.input<typeof checkVehicleSchema>
export type CheckVehicleFormValues = z.infer<typeof checkVehicleSchema>
