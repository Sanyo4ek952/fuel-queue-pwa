import { z } from 'zod'

import { FUEL_PREFERENCE_MODES, QUEUE_FUEL_TYPES, isGasolineFuelType } from '@/shared/constants'
import { isValidRuPhoneNumber, normalizeRuPhoneNumber } from '@/shared/lib/phone-number'
import { isValidPlateNumber, normalizePlateNumber } from '@/shared/lib/plate-number'

const phoneValidationMessage = 'Введите телефон в формате +7 999 123-45-67'

const requiredRuPhoneNumberSchema = z
  .string()
  .trim()
  .min(1, phoneValidationMessage)
  .refine(isValidRuPhoneNumber, phoneValidationMessage)
  .transform((value) => normalizeRuPhoneNumber(value))

export const createReservationSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .transform(normalizePlateNumber)
    .refine((value) => value.length > 0, 'Введите госномер')
    .refine(isValidPlateNumber, 'Введите номер в формате А 123 ВС 777'),
  driverFullName: z.string().trim().min(1, 'Введите ФИО водителя'),
  driverPhone: requiredRuPhoneNumberSchema,
  fuelType: z.enum(QUEUE_FUEL_TYPES),
  fuelPreferenceMode: z.enum(FUEL_PREFERENCE_MODES).default('EXACT'),
  requestedLiters: z.coerce.number().positive('Литры должны быть больше нуля'),
  comment: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.fuelPreferenceMode === 'ANY_GASOLINE' && !isGasolineFuelType(value.fuelType)) {
    context.addIssue({
      code: 'custom',
      path: ['fuelPreferenceMode'],
      message: 'Любой бензин доступен только для АИ-92, АИ-95 и АИ-100',
    })
  }
})

export type CreateReservationFormInput = z.input<typeof createReservationSchema>
export type CreateReservationFormValues = z.infer<typeof createReservationSchema>
