import { CreateFuelingRecordForm } from '@/features/create-fueling-record'

export function FuelingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Заправка</h1>
        <p className="mt-1 text-sm text-slate-500">
          Проверка допуска и фиксация фактического отпуска топлива.
        </p>
      </div>
      <CreateFuelingRecordForm />
    </div>
  )
}
