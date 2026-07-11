import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Search, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { PlateNumberInput } from '@/entities/vehicle'
import {
  type PublicQueueCheckFormInput,
  type PublicQueueCheckFormValues,
  publicQueueCheckSchema,
} from '../model/schema'
import { usePublicNoShowGrace } from '../model/use-public-no-show-grace'
import { usePublicQueueCheck } from '../model/use-public-queue-check'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

const remainingAttemptsStorageKey = 'public-queue-check-remaining-attempts'

const fuelTypeLabels: Record<string, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

function saveRemainingAttempts(value: number) {
  try {
    localStorage.setItem(remainingAttemptsStorageKey, String(value))
  } catch {
    // localStorage is only a UI hint.
  }
}

function readRemainingAttemptsHint() {
  try {
    const value = localStorage.getItem(remainingAttemptsStorageKey)
    const numericValue = value === null ? null : Number(value)

    return Number.isFinite(numericValue) ? numericValue : null
  } catch {
    return null
  }
}

function getNoShowGraceDescription(days: number | undefined) {
  if (typeof days !== 'number') {
    return 'Условия аннулирования записи зависят от текущих настроек очереди.'
  }

  if (days <= 0) {
    return 'Автоматическое аннулирование записи по пропускам заправки сейчас отключено.'
  }

  return `Если вы не заправитесь в течение ${days} суток, ваша запись в очереди будет аннулирована.`
}

function QueuePositionSummary({
  ticketNumber,
  currentPosition,
  peopleAhead,
}: {
  ticketNumber: number | null
  currentPosition: number | null
  peopleAhead: number | null
}) {
  if (ticketNumber === null) {
    return null
  }

  return (
    <span className="block">
      Постоянный номер №{ticketNumber}.
      {currentPosition !== null && peopleAhead !== null
        ? ` Дневная позиция: ${currentPosition}, впереди: ${peopleAhead}.`
        : ''}
    </span>
  )
}

export function PublicQueueCheckForm() {
  const publicQueueCheck = usePublicQueueCheck()
  const noShowGrace = usePublicNoShowGrace()
  const [remainingAttemptsHint, setRemainingAttemptsHint] = useState(readRemainingAttemptsHint)
  const form = useForm<PublicQueueCheckFormInput, unknown, PublicQueueCheckFormValues>({
    resolver: zodResolver(publicQueueCheckSchema),
    mode: 'onBlur',
    defaultValues: {
      plateNumber: '',
      phoneLast4: '',
    },
  })

  async function handleSubmit(values: PublicQueueCheckFormValues) {
    const result = await publicQueueCheck.mutateAsync({
      plateNumber: values.plateNumber,
      phoneLast4: values.phoneLast4,
    })

    saveRemainingAttempts(result.remaining_attempts)
    setRemainingAttemptsHint(result.remaining_attempts)
  }

  const result = publicQueueCheck.data
  const isLimitExceeded = result?.status === 'LIMIT_EXCEEDED'
  const isNotFound = result?.status === 'NOT_FOUND'
  const isInvalid = result?.status === 'INVALID_INPUT'
  const isFound =
    result?.status === 'FOUND' && (result.ticket_number !== null || result.queue_number !== null)
  const isInvited = isFound && result.public_status === 'INVITED_BY_OPERATOR'
  const isInCallList = isFound && result.public_status === 'IN_CALL_LIST'
  const isWaitingFuel = isFound && result.public_status === 'WAITING_FOR_PREFERRED_FUEL'
  const isPausedByLimit = isFound && result.public_status === 'PAUSED_BY_LIMIT'
  const isQueueNotReady =
    isFound &&
    (result.public_status === 'QUEUE_NOT_READY' || result.public_status === 'WAIT_FOR_CALL')
  const foundTicketNumber = isFound ? (result.ticket_number ?? result.queue_number) : null
  const noShowGraceDescription = getNoShowGraceDescription(noShowGrace.data?.days)

  return (
    <Card className="w-full rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <div className="mb-1 flex size-11 items-center justify-center rounded-lg bg-slate-900 text-white">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <CardTitle>Проверка очереди</CardTitle>
        <CardDescription>
          Введите госномер и последние 4 цифры телефона, указанного при записи.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="publicPlateNumber">Госномер</FormLabel>
              <Controller
                control={form.control}
                name="plateNumber"
                render={({ field }) => (
                  <PlateNumberInput
                    id="publicPlateNumber"
                    className="h-12 text-lg uppercase"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
              {form.formState.errors.plateNumber ? (
                <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
              ) : null}
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="phoneLast4">Последние 4 цифры телефона</FormLabel>
              <Input
                id="phoneLast4"
                autoComplete="off"
                className="h-12 text-lg"
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
                {...form.register('phoneLast4')}
              />
              {form.formState.errors.phoneLast4 ? (
                <FormMessage>{form.formState.errors.phoneLast4.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={publicQueueCheck.isPending}
            >
              <Search className="size-4" aria-hidden="true" />
              {publicQueueCheck.isPending ? 'Проверяем...' : 'Проверить очередь'}
            </Button>
            {remainingAttemptsHint !== null ? (
              <p className="text-center text-xs text-slate-500">
                Осталось проверок сегодня: примерно {remainingAttemptsHint}
              </p>
            ) : null}

            {isInvited ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <AlertTitle>Оператор подтвердил возможность приехать</AlertTitle>
                <AlertDescription>
                  <QueuePositionSummary
                    ticketNumber={foundTicketNumber}
                    currentPosition={result.current_position}
                    peopleAhead={result.people_ahead}
                  />
                  Окончательный допуск подтвердят на АЗС.
                  <span className="mt-2 block">{noShowGraceDescription}</span>
                </AlertDescription>
              </Alert>
            ) : null}

            {isInCallList ? (
              <Alert className="border-sky-200 bg-sky-50 text-sky-950">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <AlertTitle>Запись включена в список обзвона</AlertTitle>
                <AlertDescription>
                  <QueuePositionSummary
                    ticketNumber={foundTicketNumber}
                    currentPosition={result.current_position}
                    peopleAhead={result.people_ahead}
                  />
                  Ожидайте звонка оператора
                  {result.matched_fuel_type
                    ? `, доступно ${fuelTypeLabels[result.matched_fuel_type] ?? result.matched_fuel_type}`
                    : ''}
                  .
                  {result.arrival_at ? (
                    <span className="mt-2 block font-medium">
                      Прибытие: {new Intl.DateTimeFormat('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Europe/Moscow',
                      }).format(new Date(result.arrival_at))}
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {isPausedByLimit ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Дневное назначение временно остановлено</AlertTitle>
                <AlertDescription>
                  Постоянный номер №{result.permanent_number ?? foundTicketNumber} сохранён.
                  После возобновления лимита назначение получит приоритет.
                </AlertDescription>
              </Alert>
            ) : null}

            {isWaitingFuel ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Ожидается выбранное топливо</AlertTitle>
                <AlertDescription>
                  <QueuePositionSummary
                    ticketNumber={foundTicketNumber}
                    currentPosition={result.current_position}
                    peopleAhead={result.people_ahead}
                  />
                  Сейчас нет подходящей марки топлива для вашей записи.
                </AlertDescription>
              </Alert>
            ) : null}

            {isQueueNotReady ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Постоянный номер №{foundTicketNumber} ожидает распределения</AlertTitle>
                <AlertDescription>
                  <QueuePositionSummary
                    ticketNumber={foundTicketNumber}
                    currentPosition={result.current_position}
                    peopleAhead={result.people_ahead}
                  />
                  Ваша запись найдена, но сегодня она еще не входит в лимит. Пожалуйста,
                  ожидайте своей очереди. Когда очередь подойдет, вам позвонят.
                </AlertDescription>
              </Alert>
            ) : null}

            {isNotFound ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Запись не найдена</AlertTitle>
                <AlertDescription>
                  Проверьте госномер и последние 4 цифры телефона.
                </AlertDescription>
              </Alert>
            ) : null}

            {isLimitExceeded ? (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Лимит проверок исчерпан</AlertTitle>
                <AlertDescription>
                  Сегодня выполнено максимальное количество проверок. Попробуйте завтра.
                </AlertDescription>
              </Alert>
            ) : null}

            {isInvalid ? (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Проверьте данные</AlertTitle>
                <AlertDescription>
                  Введите корректный госномер и последние 4 цифры телефона.
                </AlertDescription>
              </Alert>
            ) : null}

            {publicQueueCheck.error ? (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" aria-hidden="true" />
                <AlertTitle>Проверка недоступна</AlertTitle>
                <AlertDescription>{publicQueueCheck.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
