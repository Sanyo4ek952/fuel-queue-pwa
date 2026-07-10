import { ArrowRight, Fuel, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useCurrentProfile } from '@/entities/profile'
import { MAIN_SECTION_LINKS } from '@/shared/config/routes'
import { ROLE_LABELS } from '@/shared/config/roles'
import { canAccessRoute } from '@/shared/lib/permissions'
import { useOnlineStatus } from '@/shared/lib/sync'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ConsumerDashboardPanel } from '@/widgets/consumer-dashboard-panel'

function getStationContextLabel(stations: Array<{ name: string }>) {
  if (stations.length === 0) {
    return 'АЗС не назначена'
  }

  if (stations.length === 1) {
    return stations[0].name
  }

  return 'Все доступные АЗС'
}

export function DashboardPage() {
  const isOnline = useOnlineStatus()
  const currentProfileQuery = useCurrentProfile()
  const profile = currentProfileQuery.data
  const stationContextLabel = getStationContextLabel(profile?.stations ?? [])
  const visibleLinks = profile
    ? MAIN_SECTION_LINKS.filter((item) => canAccessRoute(profile.role, item.path))
    : MAIN_SECTION_LINKS

  if (profile?.role === 'consumer') {
    return <ConsumerDashboardPanel />
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-slate-950 p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-300">Fuel Queue PWA</p>
            <h1 className="mt-2 text-2xl font-semibold">Учёт очереди и отпуска топлива</h1>
          </div>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <Fuel className="size-6" aria-hidden="true" />
          </span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge className="gap-1.5 rounded-md bg-white text-slate-950 hover:bg-white">
            <MapPin className="size-3.5" aria-hidden="true" />
            {stationContextLabel}
          </Badge>
          {profile ? (
            <Badge
              variant="outline"
              className="rounded-md border-white/20 bg-white/10 text-white hover:bg-white/10"
            >
              {ROLE_LABELS[profile.role]}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className="rounded-md border-white/20 bg-white/10 text-white hover:bg-white/10"
          >
            {isOnline ? 'Онлайн' : 'Офлайн'}
          </Badge>
        </div>
      </section>

      <Card className="rounded-lg border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Основные разделы</CardTitle>
          <CardDescription>Быстрый переход к рабочим сценариям АЗС</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {visibleLinks.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:bg-slate-50"
            >
              <span>
                <span className="block text-sm font-medium text-slate-950">{item.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.description}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
