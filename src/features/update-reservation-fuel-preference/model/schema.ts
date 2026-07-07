import { z } from 'zod'

import { FUEL_PREFERENCE_MODES, QUEUE_FUEL_TYPES, isGasolineFuelType } from '@/shared/constants'

export const updateReservationFuelPreferenceSchema = z
  .object({
    fuelType: z.enum(QUEUE_FUEL_TYPES),
    fuelPreferenceMode: z.enum(FUEL_PREFERENCE_MODES),
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

export type UpdateReservationFuelPreferenceFormValues = z.infer<
  typeof updateReservationFuelPreferenceSchema
>
