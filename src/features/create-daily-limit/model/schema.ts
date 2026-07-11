import { z } from 'zod'

import { QUEUE_FUEL_TYPES } from '@/shared/constants'

const targetDateSchema = z.string().min(1, 'Выберите дату')

const optionalPositiveNumber = z.preprocess(
  (value) => (value === '' || value == null ? null : Number(value)),
  z.number().min(0, 'Лимит не может быть отрицательным').nullable(),
)

export const dailyFuelTypeLimitSchema = z
  .object({
    fuelType: z.enum(QUEUE_FUEL_TYPES),
    status: z.enum(['OPEN', 'PAUSED']).default('OPEN'),
    vehicleLimit: z.coerce
      .number()
      .int('Лимит машин должен быть целым числом')
      .min(0, 'Лимит машин не может быть отрицательным'),
    litersLimit: optionalPositiveNumber,
  })
  .superRefine((value, ctx) => {
    if (value.status === 'OPEN' && (value.litersLimit == null || value.litersLimit <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['litersLimit'],
        message: 'Укажите лимит литров больше нуля',
      })
    }
  })

export const createDailyLimitSchema = z.object({
  targetDate: targetDateSchema,
  stationId: z.string().min(1, 'Выберите АЗС'),
  fuelTypeLimits: z.array(dailyFuelTypeLimitSchema),
})

export const saveDailyFuelTypeLimitSchema = z.object({
  targetDate: targetDateSchema,
  stationId: z.string().min(1, 'Выберите АЗС'),
  fuelTypeLimit: dailyFuelTypeLimitSchema,
})

export type CreateDailyLimitFormInput = z.input<typeof createDailyLimitSchema>
export type CreateDailyLimitFormValues = z.infer<typeof createDailyLimitSchema>
export type SaveDailyFuelTypeLimitValues = z.infer<typeof saveDailyFuelTypeLimitSchema>
