export const USER_ROLES = [
  'operator',
  'cashier',
  'shift_supervisor',
  'station_admin',
  'city_admin',
  'viewer',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  operator: 'Оператор',
  cashier: 'Кассир',
  shift_supervisor: 'Старший смены',
  station_admin: 'Администратор АЗС',
  city_admin: 'Администрация города',
  viewer: 'Наблюдатель',
}
