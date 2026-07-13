export const USER_ROLES = [
  'mayor',
  'station_manager',
  'cashier',
  'mayor_assistant',
  'consumer',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  mayor: 'Руководитель администрации',
  station_manager: 'Управляющий АЗС',
  cashier: 'Кассир АЗС',
  mayor_assistant: 'Админ',
  consumer: 'Пользователь',
}
