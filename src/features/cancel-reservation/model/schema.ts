import { z } from 'zod'

export const CANCEL_RESERVATION_REASONS = ['OWNER_CANCELLED', 'OTHER'] as const

export const cancelReservationSchema = z
  .object({
    reason: z.enum(CANCEL_RESERVATION_REASONS),
    comment: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (value.reason === 'OTHER' && !value.comment) {
      context.addIssue({
        code: 'custom',
        path: ['comment'],
        message: 'Укажите причину удаления.',
      })
    }
  })

export type CancelReservationFormValues = z.infer<typeof cancelReservationSchema>
