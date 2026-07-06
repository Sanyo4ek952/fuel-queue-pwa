export const ROUTES = {
  login: '/login',
  dashboard: '/dashboard',
  check: '/check',
  queue: '/queue',
  reservations: '/reservations',
  preferentialQueues: '/preferential-queues',
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

export const PUBLIC_ROUTES = [ROUTES.promo] as const

export const MAIN_SECTION_LINKS = [
  { path: ROUTES.preferentialQueues, label: 'Льготные очереди', description: 'Именованные списки мэра вне дневного лимита' },
  { path: ROUTES.reservations, label: 'Записи', description: 'Предварительная запись на дату' },
  { path: ROUTES.queue, label: 'Очередь сегодня', description: 'Текущая очередь по выбранной АЗС' },
  { path: ROUTES.fueling, label: 'Заправка', description: 'Фиксация факта отпуска топлива' },
  { path: ROUTES.limits, label: 'Лимиты', description: 'Дневные лимиты по АЗС и топливу' },
  { path: ROUTES.users, label: 'Сотрудники', description: 'Заявки на регистрацию и доступ сотрудников' },
  { path: ROUTES.sync, label: 'Синхронизация', description: 'Outbox, ошибки и конфликты' },
] as const
