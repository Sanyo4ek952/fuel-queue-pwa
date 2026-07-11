import { z } from 'zod'

import { FUEL_PREFERENCE_MODES, QUEUE_FUEL_TYPES, isGasolineFuelType } from '@/shared/constants'
import { isValidRuPhoneNumber, normalizeRuPhoneNumber } from '@/shared/lib/phone-number'

const requiredRuPhoneNumberSchema = z
  .string()
  .trim()
  .min(1, 'Введите телефон в формате +7 999 123-45-67')
  .refine(isValidRuPhoneNumber, 'Введите телефон в формате +7 999 123-45-67')
  .transform((value) => normalizeRuPhoneNumber(value))

export const createConsumerReservationSchema = z
  .object({
    vehicleId: z.string().uuid('Выберите автомобиль.'),
    driverFullName: z.string().trim().min(1, 'Введите ФИО водителя'),
    driverPhone: requiredRuPhoneNumberSchema,
    fuelType: z.enum(QUEUE_FUEL_TYPES),
    fuelPreferenceMode: z.enum(FUEL_PREFERENCE_MODES).default('EXACT'),
    comment: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (value.fuelPreferenceMode === 'ANY_GASOLINE' && !isGasolineFuelType(value.fuelType)) {
      context.addIssue({
        code: 'custom',
        path: ['fuelPreferenceMode'],
        message: 'Любой бензин доступен только для АИ-92, АИ-95 и АИ-100',
      })
    }
  })

export type CreateConsumerReservationFormInput = z.input<typeof createConsumerReservationSchema>
export type CreateConsumerReservationFormValues = z.output<typeof createConsumerReservationSchema>
