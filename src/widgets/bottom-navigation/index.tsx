import { CalendarPlus, CarFront, ClipboardList, Fuel, MoreHorizontal } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { ROUTES } from '@/shared/config/routes'

const bottomNavItems = [
  { to: ROUTES.check, label: 'Проверка', icon: CarFront },
  { to: ROUTES.reservations, label: 'Запись', icon: CalendarPlus },
  { to: ROUTES.queue, label: 'Очередь', icon: ClipboardList },
  { to: ROUTES.fueling, label: 'Заправка', icon: Fuel },
  { to: ROUTES.dashboard, label: 'Ещё', icon: MoreHorizontal },
] as const

export function BottomNavigation() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto grid h-16 max-w-3xl grid-cols-5 px-1">
        {bottomNavItems.map((item) => {
          const Icon = item.icon

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors',
                  isActive ? 'text-slate-950' : 'text-slate-500',
                ].join(' ')
              }
            >
              <Icon className="size-5" aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
