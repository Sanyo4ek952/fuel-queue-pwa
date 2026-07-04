import { Fuel, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ROUTES } from '@/shared/config/routes'
import { Button } from '@/shared/ui/button'
import { SyncStatusPanel } from '@/widgets/sync-status-panel'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-3 px-4">
        <Link to={ROUTES.dashboard} className="flex min-w-0 items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Fuel className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold leading-5">Fuel Queue</span>
            <span className="block truncate text-xs text-slate-500">АЗС №1</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <SyncStatusPanel />
          <Button asChild variant="ghost" size="icon" aria-label="Настройки">
            <Link to={ROUTES.settings}>
              <Settings className="size-5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
