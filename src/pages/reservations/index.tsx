import { CreateReservationForm } from '@/features/create-reservation'

export function ReservationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Записи</h1>
        <p className="mt-1 text-sm text-slate-500">Предварительная запись автомобилей на дату.</p>
      </div>
      <CreateReservationForm />
    </div>
  )
}
