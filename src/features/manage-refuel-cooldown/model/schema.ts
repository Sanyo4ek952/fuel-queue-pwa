import { z } from 'zod'

export const refuelCooldownSchema = z.object({
  days: z.coerce
    .number()
    .int('Введите целое число дней')
    .min(0, 'Интервал не может быть меньше 0')
    .max(3650, 'Интервал не может быть больше 3650 дней'),
})

export const noShowGraceSchema = z.object({
  days: z.coerce
    .number()
    .int('Введите целое число дней')
    .min(0, 'Количество дней не может быть меньше 0')
    .max(3650, 'Количество дней не может быть больше 3650 дней'),
})

export type RefuelCooldownFormInput = z.input<typeof refuelCooldownSchema>
export type RefuelCooldownFormValues = z.infer<typeof refuelCooldownSchema>
export type NoShowGraceFormInput = z.input<typeof noShowGraceSchema>
export type NoShowGraceFormValues = z.infer<typeof noShowGraceSchema>
