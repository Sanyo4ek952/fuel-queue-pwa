import { z } from 'zod'

export const loginSchema = z.object({
  email: z.email('Введите корректный email.'),
  password: z.string().min(6, 'Пароль должен быть не короче 6 символов.'),
})

export type LoginFormInput = z.input<typeof loginSchema>
export type LoginFormValues = z.output<typeof loginSchema>
