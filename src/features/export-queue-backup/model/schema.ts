import { z } from 'zod'

export const queueBackupExportSchema = z.object({
  targetDate: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: 'Выберите корректную дату.',
    })
    .transform((value) => value || null),
})

export type QueueBackupExportInput = z.input<typeof queueBackupExportSchema>
export type QueueBackupExportValues = z.output<typeof queueBackupExportSchema>
