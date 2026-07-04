export const ROUTES = {
  login: '/login',
  dashboard: '/dashboard',
  check: '/check',
  queue: '/queue',
  reservations: '/reservations',
  limits: '/limits',
  fueling: '/fueling',
  history: '/history',
  reports: '/reports',
  users: '/users',
  sync: '/sync',
  settings: '/settings',
  promo: '/promo',
} as const

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES]

export const MAIN_SECTION_LINKS = [
  { path: ROUTES.check, label: 'Проверка авто', description: 'Нормализация госномера и проверка допуска' },
  { path: ROUTES.reservations, label: 'Записи', description: 'Предварительная запись на дату' },
  { path: ROUTES.queue, label: 'Очередь сегодня', description: 'Текущая очередь по выбранной АЗС' },
  { path: ROUTES.fueling, label: 'Заправка', description: 'Фиксация факта отпуска топлива' },
  { path: ROUTES.limits, label: 'Лимиты', description: 'Дневные лимиты по АЗС и топливу' },
  { path: ROUTES.sync, label: 'Синхронизация', description: 'Outbox, ошибки и конфликты' },
] as const
