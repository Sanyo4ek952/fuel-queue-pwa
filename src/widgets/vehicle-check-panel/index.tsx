import { CheckVehicleForm } from '@/features/check-vehicle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

export function VehicleCheckPanel() {
  return (
    <Card className="rounded-lg border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>Проверка автомобиля</CardTitle>
        <CardDescription>Введите госномер. На этом этапе запрос к Supabase не выполняется.</CardDescription>
      </CardHeader>
      <CardContent>
        <CheckVehicleForm />
      </CardContent>
    </Card>
  )
}
