import { useQuery } from '@tanstack/react-query'
import { Crown, Fuel, Phone, PlusCircle, Trash2 } from 'lucide-react'
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
import { FUEL_TYPES, type FuelType } from '@/shared/constants'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion'
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

const litersFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

function formatLiters(value: number) {
  return `${litersFormatter.format(value)} л`
}

function aggregateFuelNeeds(entries: PreferentialQueueEntry[]) {
  return entries.reduce<Record<string, number>>((totals, entry) => {
    totals[entry.fuel_type] = (totals[entry.fuel_type] ?? 0) + entry.requested_liters

    return totals
  }, {})
}

function getFuelNeedItems(entries: PreferentialQueueEntry[]) {
  const totals = aggregateFuelNeeds(entries)
  const unknownFuelTypes = Object.keys(totals)
    .filter((fuelType) => !FUEL_TYPES.includes(fuelType as FuelType))
    .sort()

  return [...FUEL_TYPES, ...unknownFuelTypes]
    .map((fuelType) => ({
      fuelType,
      liters: totals[fuelType] ?? 0,
    }))
    .filter((item) => item.liters > 0)
}

function getPhoneHref(phone: string | null) {
  const normalizedPhone = phone?.replace(/[^\d+]/g, '')

  return normalizedPhone ? `tel:${normalizedPhone}` : null
}

function FuelNeedsSummary({
  entries,
  ariaLabel,
}: {
  entries: PreferentialQueueEntry[]
  ariaLabel: string
}) {
  const items = getFuelNeedItems(entries)

  return (
    <div
      aria-label={ariaLabel}
      className="rounded-md border border-slate-200 bg-white px-3 py-2"
    >
      <p className="text-xs text-slate-500">Нужно топлива</p>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item.fuelType} variant="outline" className="rounded-md">
              {fuelTypeLabels[item.fuelType as FuelType] ?? item.fuelType}:{' '}
              {formatLiters(item.liters)}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xl font-semibold text-slate-950">0 л</p>
      )}
    </div>
  )
}

function formatCreatedBy(entry: PreferentialQueueEntry) {
  return (
    entry.created_by_signature_name ||
    entry.created_by_full_name ||
    'Автор не указан'
  )
}

function PreferentialEntryCard({
  entry,
  displayNumber,
}: {
  entry: PreferentialQueueEntry
  displayNumber: number
}) {
  const cancelEntryMutation = useCancelPreferentialQueueEntry()
  const phoneHref = getPhoneHref(entry.driver_phone)

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <Accordion type="single" collapsible>
        <AccordionItem value={entry.id} className="border-b-0">
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
                  {displayNumber}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold tracking-normal text-slate-950">
                    {entry.normalized_plate_number || 'Номер не указан'}
                  </h2>
                  <p className="truncate text-xs text-slate-500">
                    {entry.driver_full_name || 'Водитель не указан'}
                  </p>
                  <div className="mt-1 flex max-w-full flex-nowrap gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <Badge
                      variant="secondary"
                      className="h-4 shrink-0 rounded-md px-1.5 text-[11px]"
                    >
                      {fuelTypeLabels[entry.fuel_type as FuelType] ??
                        entry.fuel_type}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="h-4 shrink-0 rounded-md px-1.5 text-[11px]"
                    >
                      {entry.requested_liters} л
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                aria-label="Удалить из льготной очереди"
                disabled={cancelEntryMutation.isPending}
                onClick={() =>
                  cancelEntryMutation.mutate({
                    entryId: entry.id,
                    comment: 'Отменено мэром',
                  })
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
              {phoneHref ? (
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  aria-label="Позвонить"
                >
                  <a href={phoneHref}>
                    <Phone className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Телефон не указан"
                  disabled
                >
                  <Phone className="size-4" aria-hidden="true" />
                </Button>
              )}
              <AccordionTrigger
                className="size-8 flex-none justify-center gap-0 p-0 hover:no-underline"
                aria-label="Открыть детали"
              >
                <span className="sr-only">Открыть детали</span>
              </AccordionTrigger>
            </div>
          </div>

          <AccordionContent className="border-t border-slate-100 px-3 pt-3 pb-3">
            <span className="sr-only">Сведения о записи</span>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Топливо</dt>
                <dd className="font-medium text-slate-950">
                  {fuelTypeLabels[entry.fuel_type as FuelType] ??
                    entry.fuel_type}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Литры</dt>
                <dd className="font-medium text-slate-950">
                  {entry.requested_liters} л
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Телефон</dt>
                <dd className="font-medium text-slate-950">
                  {entry.driver_phone || 'Не указан'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Добавил</dt>
                <dd className="font-medium text-slate-950">
                  {formatCreatedBy(entry)}
                </dd>
              </div>
            </dl>

            {entry.comment ? (
              <p className="mt-3 text-sm text-slate-500">{entry.comment}</p>
            ) : null}
          </AccordionContent>

          {cancelEntryMutation.error ? (
            <Alert variant="destructive" className="mt-3">
              <AlertTitle>Заявка не отменена</AlertTitle>
              <AlertDescription>
                {cancelEntryMutation.error.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </AccordionItem>
      </Accordion>
    </article>
  )
}

function PreferentialQueueCard({ queue }: { queue: PreferentialQueue }) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const hasEntries = queue.entries.length > 0

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
          <CardDescription>
            Активные льготные заявки в этой очереди.
          </CardDescription>
        </CardHeader>
        {hasEntries ? (
          <CardContent>
            <FuelNeedsSummary
              entries={queue.entries}
              ariaLabel={`Нужно топлива в очереди ${queue.name}`}
            />
          </CardContent>
        ) : null}
      </Card>

      {hasEntries ? (
        <div className="space-y-3">
          {queue.entries.map((entry, index) => (
            <PreferentialEntryCard
              key={entry.id}
              entry={entry}
              displayNumber={index + 1}
            />
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
  const activeEntriesCount = queues.reduce(
    (count, queue) => count + queue.entries.length,
    0,
  )
  const activeEntries = queues.flatMap((queue) => queue.entries)

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="size-5 text-slate-500" aria-hidden="true" />
            Льготные очереди
          </CardTitle>
          <CardDescription>
            Отдельные списки мэра. Они не занимают дневной лимит и не зависят от
            правила повторной постановки в обычную очередь.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Очередей</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">
                {queues.length}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs text-slate-500">Активных машин</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">
                {activeEntriesCount}
              </p>
            </div>
            <div className="col-span-2">
              <FuelNeedsSummary
                entries={activeEntries}
                ariaLabel="Всего нужно топлива"
              />
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
