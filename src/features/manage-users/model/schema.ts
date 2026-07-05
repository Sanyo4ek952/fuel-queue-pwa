import { z } from 'zod'

const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Некорректный UUID.',
)

export const approveRegistrationSchema = z
  .object({
    profileId: uuidLikeSchema,
    role: z.enum(['cashier', 'mayor_assistant']),
    stationIds: z.array(uuidLikeSchema),
  })
  .refine((value) => value.role !== 'cashier' || value.stationIds.length > 0, {
    path: ['stationIds'],
    message: 'Выберите хотя бы одну АЗС.',
  })

export const rejectRegistrationSchema = z.object({
  profileId: uuidLikeSchema,
  reason: z.string().trim().min(3, 'Укажите причину отклонения.'),
})

export const deactivateProfileSchema = z.object({
  profileId: uuidLikeSchema,
  reason: z.string().trim().min(3, 'Укажите причину отключения.'),
})

export type ApproveRegistrationValues = z.output<typeof approveRegistrationSchema>
export type RejectRegistrationValues = z.output<typeof rejectRegistrationSchema>
export type DeactivateProfileValues = z.output<typeof deactivateProfileSchema>
