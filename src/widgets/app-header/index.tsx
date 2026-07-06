import { Fuel, LogOut, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'
import { useLogout } from '@/features/auth'
import { ROUTES } from '@/shared/config/routes'
import { ROLE_LABELS } from '@/shared/config/roles'
import { Button } from '@/shared/ui/button'
import { SyncStatusPanel } from '@/widgets/sync-status-panel'

function getStationContextLabel(stations: Array<{ name: string }>) {
  if (stations.length === 0) {
    return 'АЗС не назначена'
  }

  if (stations.length === 1) {
    return stations[0].name
  }

  return 'Все доступные АЗС'
}

export function AppHeader() {
  const currentProfileQuery = useCurrentProfile()
  const logoutMutation = useLogout()
  const profile = currentProfileQuery.data
  const stationContextLabel = getStationContextLabel(profile?.stations ?? [])

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-3xl flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            to={ROUTES.dashboard}
            className="flex min-w-0 items-center gap-2"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Fuel className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base leading-5 font-semibold">
                Fuel Queue
              </span>
              <span className="block truncate text-xs text-slate-500">
                {stationContextLabel}
              </span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {profile ? (
              <span className="hidden max-w-36 text-right sm:block">
                <span className="block truncate text-xs font-medium text-slate-700">
                  {profile.full_name}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {ROLE_LABELS[profile.role]}
                </span>
              </span>
            ) : null}
            <SyncStatusPanel />
            <Button asChild variant="ghost" size="icon" aria-label="Настройки">
              <Link to={ROUTES.settings}>
                <Settings className="size-5" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Выйти"
              disabled={logoutMutation.isPending}
              onClick={() => {
                void logoutMutation.mutateAsync()
              }}
            >
              <LogOut className="size-5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
