import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'

import { listPreferentialFuelingReport } from '@/shared/api/reports'
import { type FuelType } from '@/shared/constants'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function ReportsPage() {
  const reportQuery = useQuery({
    queryKey: ['reports', 'preferential-fueling'],
    queryFn: listPreferentialFuelingReport,
  })
  const rows = reportQuery.data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Отчеты</h1>
        <p className="mt-1 text-sm text-slate-500">
          История машин, заправленных по льготным очередям.
        </p>
      </div>

      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 text-slate-500" aria-hidden="true" />
            Льготные заправки
          </CardTitle>
          <CardDescription>
            Машины остаются в отчете после того, как исчезают из активного льготного списка.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reportQuery.error ? (
            <Alert variant="destructive">
              <AlertTitle>Отчет не загружен</AlertTitle>
              <AlertDescription>{reportQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}

          {reportQuery.isLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
              Загружаем отчет...
            </div>
          ) : null}

          {!reportQuery.isLoading && rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Заправок по льготным очередям пока нет.
            </div>
          ) : null}

          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Очередь</TableHead>
                  <TableHead>Госномер</TableHead>
                  <TableHead>Водитель</TableHead>
                  <TableHead>Топливо</TableHead>
                  <TableHead>Литры</TableHead>
                  <TableHead>АЗС</TableHead>
                  <TableHead>Кассир</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.fueled_at)}</TableCell>
                    <TableCell>{row.queue_name || 'Не указана'}</TableCell>
                    <TableCell className="font-medium">{row.normalized_plate_number}</TableCell>
                    <TableCell>{row.driver_full_name || 'Не указан'}</TableCell>
                    <TableCell>{fuelTypeLabels[row.fuel_type as FuelType] ?? row.fuel_type}</TableCell>
                    <TableCell>{row.liters} л</TableCell>
                    <TableCell>{row.station_name || 'Не указана'}</TableCell>
                    <TableCell>{row.cashier_name || 'Не указан'}</TableCell>
                    <TableCell>{row.comment || row.entry_comment || 'Нет'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
