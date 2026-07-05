import { z } from 'zod'

export const maxMessageTemplateIdSchema = z
  .string()
  .trim()
  .uuid('Шаблон MAX выбран некорректно')
  .optional()
  .or(z.literal(''))

export const sendMaxMessageSchema = z.object({
  recipientPhones: z
    .array(z.string().trim().min(1))
    .min(1, 'Выберите хотя бы одного получателя')
    .max(10, 'За один раз можно выбрать не больше 10 получателей'),
  templateId: maxMessageTemplateIdSchema,
  messageText: z
    .string()
    .trim()
    .min(1, 'Введите текст сообщения')
    .max(4000, 'MAX принимает текст до 4000 символов'),
})

export type SendMaxMessageFormInput = z.input<typeof sendMaxMessageSchema>
export type SendMaxMessageFormValues = z.infer<typeof sendMaxMessageSchema>
