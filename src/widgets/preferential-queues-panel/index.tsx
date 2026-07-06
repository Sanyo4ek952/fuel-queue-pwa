import { useQuery } from '@tanstack/react-query'
import { Ban, Crown, Fuel, Phone, PlusCircle, UserRound } from 'lucide-react'
import { useState } from 'react'

import { CreatePreferentialQueueForm } from '@/features/create-preferential-queue'
import {
  CreatePreferentialQueueEntryForm,
  useCancelPreferentialQueueEntry,
} from '@/features/create-preferential-queue-entry'
import {
  listActivePreferentialQueues,
  type PreferentialQueue,
  type PreferentialQueueEntry,
} from '@/shared/api/preferential-queues'
import { type FuelType } from '@/shared/constants'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const preferentialQueuesQueryKey = () => ['preferential-queues'] as const

function PreferentialEntryCard({ entry }: { entry: PreferentialQueueEntry }) {
  const cancelEntryMutation = useCancelPreferentialQueueEntry()

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold tracking-normal text-slate-950">
            {entry.normalized_plate_number || 'Номер не указан'}
          </h3>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge variant="secondary" className="rounded-md">
              {fuelTypeLabels[entry.fuel_type as FuelType] ?? entry.fuel_type}
            </Badge>
            <Badge variant="outline" className="rounded-md">
              {entry.requested_liters} л
            </Badge>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          disabled={cancelEntryMutation.isPending}
          onClick={() =>
            cancelEntryMutation.mutate({
              entryId: entry.id,
              comment: 'Отменено мэром',
            })
          }
        >
          <Ban className="size-4" aria-hidden="true" />
          Отменить
        </Button>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="flex items-center gap-1 text-slate-500">
            <UserRound className="size-4" aria-hidden="true" />
            Водитель
          </dt>
          <dd className="font-medium text-slate-950">
            {entry.driver_full_name || 'Не указан'}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-slate-500">
            <Phone className="size-4" aria-hidden="true" />
            Телефон
          </dt>
          <dd className="font-medium text-slate-950">{entry.driver_phone || 'Не указан'}</dd>
        </div>
      </dl>

      {entry.comment ? <p className="mt-3 text-sm text-slate-500">{entry.comment}</p> : null}

      {cancelEntryMutation.error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>Заявка не отменена</AlertTitle>
          <AlertDescription>{cancelEntryMutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
    </article>
  )
}

function PreferentialQueueCard({ queue }: { queue: PreferentialQueue }) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  return (
    <section className="space-y-3">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{queue.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary" className="rounded-md">
                {queue.entries.length}
              </Badge>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button type="button" size="sm" className="gap-2">
                    <PlusCircle className="size-4" aria-hidden="true" />
                    Добавить
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Добавить машину</DialogTitle>
                    <DialogDescription>
                      Машина будет добавлена в льготную очередь «{queue.name}».
                    </DialogDescription>
                  </DialogHeader>
                  <CreatePreferentialQueueEntryForm
                    queueId={queue.id}
                    queueName={queue.name}
                    onSuccess={() => setIsAddDialogOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            </span>
          </CardTitle>
          <CardDescription>Активные льготные заявки в этой очереди.</CardDescription>
        </CardHeader>
      </Card>

      {queue.entries.length > 0 ? (
        <div className="space-y-3">
          {queue.entries.map((entry) => (
            <PreferentialEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          В этой льготной очереди пока нет активных машин.
        </div>
      )}
    </section>
  )
}

export function PreferentialQueuesPanel() {
  const queuesQuery = useQuery({
    queryKey: preferentialQueuesQueryKey(),
    queryFn: listActivePreferentialQueues,
  })
  const queues = queuesQuery.data ?? []
  const activeEntriesCount = queues.reduce((count, queue) => count + queue.entries.length, 0)

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="size-5 text-slate-500" aria-hidden="true" />
            Льготные очереди
          </CardTitle>
          <CardDescription>
            Отдельные списки мэра. Они не занимают дневной лимит и не зависят от правила повторной постановки в обычную очередь.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Очередей</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{queues.length}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Активных машин</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{activeEntriesCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <CreatePreferentialQueueForm />

      {queuesQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Льготные очереди не загружены</AlertTitle>
          <AlertDescription>{queuesQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {queuesQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загружаем льготные очереди...
        </div>
      ) : null}

      {!queuesQuery.isLoading && queues.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          Создайте первую льготную очередь, чтобы добавить машины.
        </div>
      ) : null}

      {queues.length > 0 ? (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Fuel className="size-4" aria-hidden="true" />
            Активные списки
          </div>
          {queues.map((queue) => (
            <PreferentialQueueCard key={queue.id} queue={queue} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
