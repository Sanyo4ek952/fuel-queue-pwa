import { z } from 'zod'

import { QUEUE_FUEL_TYPES } from '@/shared/constants'
import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

export const createReservationSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
  driverFullName: z.string().trim().min(1, 'Введите ФИО водителя'),
  driverPhone: z.string().trim().optional(),
  fuelType: z.enum(QUEUE_FUEL_TYPES),
  requestedLiters: z.coerce.number().positive('Литры должны быть больше нуля'),
  comment: z.string().trim().optional(),
})

export type CreateReservationFormInput = z.input<typeof createReservationSchema>
export type CreateReservationFormValues = z.infer<typeof createReservationSchema>
