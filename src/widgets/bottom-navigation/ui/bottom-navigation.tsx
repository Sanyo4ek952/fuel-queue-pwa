import { NavLink } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'

import { getVisibleBottomNavItems } from '../model/navigation'

export function BottomNavigation() {
  const currentProfileQuery = useCurrentProfile()
  const visibleItems = getVisibleBottomNavItems(currentProfileQuery.data?.role)

  if (visibleItems.length <= 1) {
    return null
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div
        className="mx-auto grid h-16 max-w-3xl px-1"
        style={{ gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => {
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
