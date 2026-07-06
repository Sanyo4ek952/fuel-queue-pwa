import { z } from 'zod'

export const createPreferentialQueueSchema = z.object({
  name: z.string().trim().min(1, 'Введите название очереди'),
})

export type CreatePreferentialQueueFormInput = z.input<typeof createPreferentialQueueSchema>
export type CreatePreferentialQueueFormValues = z.infer<typeof createPreferentialQueueSchema>
