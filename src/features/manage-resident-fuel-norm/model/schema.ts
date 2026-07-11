import { z } from 'zod'

export const residentFuelNormSchema = z.object({
  liters: z.coerce
    .number()
    .positive('Литры должны быть больше нуля')
    .max(1000, 'Литры не должны быть больше 1000'),
})

export type ResidentFuelNormFormInput = z.input<typeof residentFuelNormSchema>
export type ResidentFuelNormFormValues = z.infer<typeof residentFuelNormSchema>
