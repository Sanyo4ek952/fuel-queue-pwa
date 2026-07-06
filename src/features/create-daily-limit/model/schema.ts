import { z } from 'zod'

import { DAILY_LIMIT_MODES, FUEL_QUEUE_CATEGORIES } from '@/shared/constants'

const optionalPositiveNumber = z.preprocess(
  (value) => (value === '' || value == null ? null : Number(value)),
  z.number().positive('Лимит должен быть больше нуля').nullable(),
)

export const dailyCategoryLimitSchema = z
  .object({
    fuelCategory: z.enum(FUEL_QUEUE_CATEGORIES),
    limitMode: z.enum(DAILY_LIMIT_MODES),
    vehicleLimit: z.coerce
      .number()
      .int('Лимит машин должен быть целым числом')
      .min(0, 'Лимит машин не может быть отрицательным'),
    litersLimit: optionalPositiveNumber,
  })
  .superRefine((value, context) => {
    if (value.limitMode === 'vehicle_count' && value.vehicleLimit <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['vehicleLimit'],
        message: 'Укажите количество машин',
      })
    }

    if (value.limitMode === 'fuel_liters' && (value.litersLimit == null || value.litersLimit <= 0)) {
      context.addIssue({
        code: 'custom',
        path: ['litersLimit'],
        message: 'Укажите количество топлива',
      })
    }
  })

export const createDailyLimitSchema = z.object({
  targetDate: z.string().min(1, 'Выберите дату'),
  categoryLimits: z.array(dailyCategoryLimitSchema).length(3),
})

export type CreateDailyLimitFormInput = z.input<typeof createDailyLimitSchema>
export type CreateDailyLimitFormValues = z.infer<typeof createDailyLimitSchema>
