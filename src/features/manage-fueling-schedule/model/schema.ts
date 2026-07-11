import { z } from 'zod'

import { FUEL_QUEUE_CATEGORIES } from '@/shared/constants'

export const fuelingScheduleItemSchema = z.object({
  fuelCategory: z.enum(FUEL_QUEUE_CATEGORIES),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Введите время в формате ЧЧ:ММ'),
  intervalMinutes: z.coerce
    .number()
    .int('Введите целое количество минут')
    .min(1, 'Интервал должен быть не меньше 1 минуты')
    .max(240, 'Интервал должен быть не больше 240 минут'),
  vehiclesPerInterval: z.coerce
    .number()
    .int('Введите целое количество автомобилей')
    .min(1, 'Количество должно быть не меньше 1 автомобиля')
    .max(100, 'Количество должно быть не больше 100 автомобилей'),
})

export const fuelingScheduleFormSchema = z.object({
  targetDate: z.string().min(1, 'Выберите дату'),
  stationId: z.string().uuid('Выберите АЗС'),
  schedules: z.array(fuelingScheduleItemSchema),
})

export type FuelingScheduleFormInput = z.input<typeof fuelingScheduleFormSchema>
export type FuelingScheduleFormValues = z.infer<typeof fuelingScheduleFormSchema>
