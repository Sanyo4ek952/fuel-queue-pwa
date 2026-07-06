import { useCurrentProfile } from '@/entities/profile'
import { CreateDailyLimitForm } from '@/features/create-daily-limit'
import { CreatePersonalVehicleLiterLimitForm } from '@/features/create-personal-vehicle-liter-limit'
import {
  canCreateDailyLimit,
  canCreatePersonalVehicleLiterLimit,
} from '@/shared/lib/permissions'
import { DailyLimitOverviewPanel } from '@/widgets/daily-limit-overview-panel'

export function DailyLimitsPage() {
  const currentProfileQuery = useCurrentProfile()
  const role = currentProfileQuery.data?.role

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Лимиты</h1>
        <p className="mt-1 text-sm text-slate-500">
          Общий лимит на день и прогноз по бензину, дизелю и газу.
        </p>
      </div>
      <DailyLimitOverviewPanel />
      {role && canCreateDailyLimit(role) ? <CreateDailyLimitForm /> : null}
      {role && canCreatePersonalVehicleLiterLimit(role) ? (
        <CreatePersonalVehicleLiterLimitForm />
      ) : null}
    </div>
  )
}
