import { z } from 'zod'

import { FUEL_TYPES } from '@/shared/constants'

const optionalNonNegativeNumber = z.preprocess(
  (value) => (value === '' || value == null ? null : Number(value)),
  z.number().min(0, 'Лимит литров не может быть отрицательным').nullable(),
)

export const dailyFuelTypeLimitSchema = z.object({
  fuelType: z.enum(FUEL_TYPES),
  vehicleLimit: z.coerce
    .number()
    .int('Лимит машин должен быть целым числом')
    .min(0, 'Лимит машин не может быть отрицательным'),
  litersLimit: optionalNonNegativeNumber,
})

export const createDailyLimitSchema = z
  .object({
    targetDate: z.string().min(1, 'Выберите дату'),
    totalVehicleLimit: z.coerce
      .number()
      .int('Общий лимит машин должен быть целым числом')
      .positive('Общий лимит машин должен быть больше нуля'),
    maxLitersPerVehicle: z.coerce
      .number()
      .positive('Лимит литров на авто должен быть больше нуля'),
    fuelTypeLimits: z.array(dailyFuelTypeLimitSchema),
  })
  .refine(
    (values) =>
      values.fuelTypeLimits.reduce((sum, item) => sum + item.vehicleLimit, 0) <=
      values.totalVehicleLimit,
    {
      message: 'Сумма лимитов по видам топлива не должна превышать общий лимит',
      path: ['fuelTypeLimits'],
    },
  )

export type CreateDailyLimitFormInput = z.input<typeof createDailyLimitSchema>
export type CreateDailyLimitFormValues = z.infer<typeof createDailyLimitSchema>
