import { z } from 'zod'

import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const addConsumerVehicleSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
})

export type AddConsumerVehicleFormInput = z.input<typeof addConsumerVehicleSchema>
export type AddConsumerVehicleFormValues = z.output<typeof addConsumerVehicleSchema>
