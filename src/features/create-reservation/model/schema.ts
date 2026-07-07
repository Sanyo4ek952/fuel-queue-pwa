import { z } from 'zod'

import { QUEUE_FUEL_TYPES } from '@/shared/constants'
import { isValidRuPhoneNumber, normalizeRuPhoneNumber } from '@/shared/lib/phone-number'
import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

const phoneValidationMessage = 'Введите телефон в формате +7 999 123-45-67'

const optionalRuPhoneNumberSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || isValidRuPhoneNumber(value), phoneValidationMessage)
  .transform((value) => normalizeRuPhoneNumber(value) || undefined)

export const createReservationSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
  driverFullName: z.string().trim().min(1, 'Введите ФИО водителя'),
  driverPhone: optionalRuPhoneNumberSchema,
  fuelType: z.enum(QUEUE_FUEL_TYPES),
  requestedLiters: z.coerce.number().positive('Литры должны быть больше нуля'),
  comment: z.string().trim().optional(),
})

export type CreateReservationFormInput = z.input<typeof createReservationSchema>
export type CreateReservationFormValues = z.infer<typeof createReservationSchema>
