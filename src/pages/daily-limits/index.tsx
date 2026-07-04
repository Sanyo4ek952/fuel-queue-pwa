import { CreateDailyLimitForm } from '@/features/create-daily-limit'

export function DailyLimitsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Лимиты</h1>
        <p className="mt-1 text-sm text-slate-500">Лимиты на дату, АЗС и виды топлива.</p>
      </div>
      <CreateDailyLimitForm />
    </div>
  )
}
