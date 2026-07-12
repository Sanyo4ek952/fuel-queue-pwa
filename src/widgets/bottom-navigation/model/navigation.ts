import { CalendarPlus, ClipboardList, Fuel, MoreHorizontal } from 'lucide-react'

import { ROUTES } from '@/shared/config/routes'
import type { UserRole } from '@/shared/config/roles'
import { canAccessRoute } from '@/shared/lib/permissions'

export const bottomNavItems = [
  { to: ROUTES.reservations, label: 'Запись', icon: CalendarPlus },
  { to: ROUTES.queue, label: 'Очередь', icon: ClipboardList },
  { to: ROUTES.fueling, label: 'Заправка', icon: Fuel },
  { to: ROUTES.dashboard, label: 'Ещё', icon: MoreHorizontal },
] as const

export function getVisibleBottomNavItems(role?: UserRole) {
  return role ? bottomNavItems.filter((item) => canAccessRoute(role, item.to)) : bottomNavItems
}
