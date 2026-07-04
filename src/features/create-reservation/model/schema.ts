import { z } from 'zod'

import { FUEL_TYPES } from '@/shared/constants'

export const createReservationSchema = z.object({
  targetDate: z.string().min(1, 'Выберите дату'),
  plateNumber: z.string().trim().min(1, 'Введите госномер'),
  driverFullName: z.string().trim().min(1, 'Введите ФИО водителя'),
  driverPhone: z.string().trim().optional(),
  fuelType: z.enum(FUEL_TYPES),
  requestedLiters: z.coerce.number().positive('Литры должны быть больше нуля'),
  comment: z.string().trim().optional(),
})

export type CreateReservationFormInput = z.input<typeof createReservationSchema>
export type CreateReservationFormValues = z.infer<typeof createReservationSchema>
