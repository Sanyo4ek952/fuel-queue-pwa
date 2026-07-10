import { z } from 'zod'

export const REGISTERABLE_ROLES = ['cashier', 'mayor_assistant'] as const

const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Выберите АЗС.',
)

export const loginSchema = z.object({
  email: z.email('Введите корректный email.'),
  password: z.string().min(6, 'Пароль должен быть не короче 6 символов.'),
})

export const registerSchema = z
  .object({
    email: z.email('Введите корректный email.'),
    password: z.string().min(6, 'Пароль должен быть не короче 6 символов.'),
    passwordConfirmation: z.string().min(6, 'Повторите пароль.'),
    firstName: z.string().trim().min(2, 'Введите имя.'),
    lastName: z.string().trim().min(2, 'Введите фамилию.'),
    middleName: z.string().trim().optional(),
    position: z.string().trim().min(2, 'Введите должность.'),
    signatureName: z.string().trim().min(2, 'Введите подпись для журналов.'),
    requestedRole: z.enum(REGISTERABLE_ROLES),
    requestedStationId: z.union([uuidLikeSchema, z.literal('')]).optional(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Пароли не совпадают.',
  })
  .refine((value) => value.requestedRole !== 'cashier' || Boolean(value.requestedStationId), {
    path: ['requestedStationId'],
    message: 'Выберите АЗС.',
  })

export const consumerRegisterSchema = z
  .object({
    email: z.email('Введите корректный email.'),
    password: z.string().min(6, 'Пароль должен быть не короче 6 символов.'),
    passwordConfirmation: z.string().min(6, 'Повторите пароль.'),
    firstName: z.string().trim().min(2, 'Введите имя.'),
    lastName: z.string().trim().min(2, 'Введите фамилию.'),
    middleName: z.string().trim().optional(),
    phone: z.string().trim().optional(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Пароли не совпадают.',
  })

export type LoginFormInput = z.input<typeof loginSchema>
export type LoginFormValues = z.output<typeof loginSchema>
export type RegisterFormInput = z.input<typeof registerSchema>
export type RegisterFormValues = z.output<typeof registerSchema>
export type ConsumerRegisterFormInput = z.input<typeof consumerRegisterSchema>
export type ConsumerRegisterFormValues = z.output<typeof consumerRegisterSchema>
