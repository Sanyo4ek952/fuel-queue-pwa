import { z } from 'zod'

export const checkVehicleSchema = z.object({
  plateNumber: z.string().trim().min(1, 'Введите госномер'),
})

export type CheckVehicleFormValues = z.infer<typeof checkVehicleSchema>
