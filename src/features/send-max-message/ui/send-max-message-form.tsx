import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Loader2, MessageCircle, Search, Send, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'

import { useMaxRecipients, type MaxRecipient } from '@/entities/driver'
import {
  type SendMaxMessageFormInput,
  type SendMaxMessageFormValues,
  sendMaxMessageSchema,
  useMaxMessageTemplates,
  useSendMaxMessage,
} from '@/features/send-max-message'
import { useOnlineStatus } from '@/shared/lib/sync'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

const CUSTOM_TEMPLATE_VALUE = '__custom__'

const recipientStatusLabels: Record<MaxRecipient['max_status'], string> = {
  linked: 'Привязан',
  no_consent: 'Нет согласия',
  unlinked: 'Не привязан',
}

function getRecipientStatusClassName(status: MaxRecipient['max_status']) {
  if (status === 'linked') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50'
  }

  if (status === 'no_consent') {
    return 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50'
  }

  return 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-50'
}

function isRecipientSelectable(recipient: MaxRecipient) {
  return recipient.max_status === 'linked'
}

function matchesSearch(recipient: MaxRecipient, search: string) {
  const query = search.trim().toLowerCase()

  if (!query) {
    return true
  }

  return (
    recipient.display_name.toLowerCase().includes(query) ||
    recipient.display_phone.toLowerCase().includes(query) ||
    recipient.normalized_phone.includes(query.replace(/\D/g, ''))
  )
}

function RecipientRow({
  recipient,
  selected,
  disabled,
  onToggle,
}: {
  recipient: MaxRecipient
  selected: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-slate-950 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
      disabled={disabled}
      onClick={onToggle}
    >
      <span
        className={[
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
          selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300 bg-white',
        ].join(' ')}
        aria-hidden="true"
      >
        {selected ? <CheckCircle2 className="size-4" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-950">
          {recipient.display_name}
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {recipient.display_phone} · {recipient.driver_count} записей
        </span>
      </span>
      <Badge
        variant="outline"
        className={`shrink-0 rounded-md ${getRecipientStatusClassName(recipient.max_status)}`}
      >
        {recipientStatusLabels[recipient.max_status]}
      </Badge>
    </button>
  )
}

export function SendMaxMessageForm() {
  const isOnline = useOnlineStatus()
  const recipientsQuery = useMaxRecipients()
  const templatesQuery = useMaxMessageTemplates()
  const sendMutation = useSendMaxMessage()
  const [search, setSearch] = useState('')
  const form = useForm<SendMaxMessageFormInput, unknown, SendMaxMessageFormValues>({
    resolver: zodResolver(sendMaxMessageSchema),
    defaultValues: {
      recipientPhones: [],
      templateId: '',
      messageText: '',
    },
  })
  const selectedPhones = form.watch('recipientPhones')
  const messageText = form.watch('messageText')
  const recipients = useMemo(() => recipientsQuery.data ?? [], [recipientsQuery.data])
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data])
  const filteredRecipients = useMemo(
    () => recipients.filter((recipient) => matchesSearch(recipient, search)),
    [recipients, search],
  )
  const selectedRecipients = useMemo(
    () => recipients.filter((recipient) => selectedPhones.includes(recipient.normalized_phone)),
    [recipients, selectedPhones],
  )
  const resultByPhone = useMemo(() => {
    const map = new Map<string, NonNullable<typeof sendMutation.data>['results'][number]>()

    sendMutation.data?.results.forEach((result) => {
      map.set(result.normalized_phone, result)
    })

    return map
  }, [sendMutation.data])

  useEffect(() => {
    const selectablePhones = new Set(
      recipients.filter(isRecipientSelectable).map((recipient) => recipient.normalized_phone),
    )
    const nextSelectedPhones = selectedPhones.filter((phone) => selectablePhones.has(phone))

    if (nextSelectedPhones.length !== selectedPhones.length) {
      form.setValue('recipientPhones', nextSelectedPhones, { shouldValidate: true })
    }
  }, [form, recipients, selectedPhones])

  function toggleRecipient(recipient: MaxRecipient) {
    if (!isRecipientSelectable(recipient)) {
      return
    }

    const selected = selectedPhones.includes(recipient.normalized_phone)

    if (selected) {
      form.setValue(
        'recipientPhones',
        selectedPhones.filter((phone) => phone !== recipient.normalized_phone),
        { shouldValidate: true },
      )
      return
    }

    if (selectedPhones.length >= 10) {
      form.trigger('recipientPhones')
      return
    }

    form.setValue('recipientPhones', [...selectedPhones, recipient.normalized_phone], {
      shouldValidate: true,
    })
  }

  function handleTemplateChange(value: string) {
    if (value === CUSTOM_TEMPLATE_VALUE) {
      form.setValue('templateId', '', { shouldValidate: true })
      return
    }

    const template = templates.find((item) => item.id === value)

    form.setValue('templateId', value, { shouldValidate: true })

    if (template) {
      form.setValue('messageText', template.body, { shouldValidate: true })
    }
  }

  async function handleSubmit(values: SendMaxMessageFormValues) {
    if (!isOnline) {
      return
    }

    await sendMutation.mutateAsync(values)
  }

  const isSubmitDisabled =
    !isOnline ||
    selectedPhones.length === 0 ||
    messageText.trim().length === 0 ||
    sendMutation.isPending

  return (
    <Form {...form}>
      <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <FormItem>
            <FormLabel htmlFor="maxRecipientSearch">Поиск получателя</FormLabel>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                id="maxRecipientSearch"
                className="pl-9"
                placeholder="Имя или телефон"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </FormItem>
          <FormItem>
            <FormLabel>Выбрано</FormLabel>
            <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
              {selectedPhones.length} из 10
            </div>
            {form.formState.errors.recipientPhones ? (
              <FormMessage>{form.formState.errors.recipientPhones.message}</FormMessage>
            ) : null}
          </FormItem>
        </div>

        {!isOnline ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            MAX-рассылка доступна только онлайн. Офлайн-очередь для сообщений не создаётся.
          </div>
        ) : null}

        <div className="space-y-2">
          {recipientsQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Загружаем получателей...
            </div>
          ) : null}
          {recipientsQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {recipientsQuery.error.message}
            </div>
          ) : null}
          {!recipientsQuery.isLoading && filteredRecipients.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500">
              Получатели не найдены.
            </div>
          ) : null}
          {filteredRecipients.map((recipient) => {
            const selected = selectedPhones.includes(recipient.normalized_phone)
            const disabled =
              sendMutation.isPending ||
              !isRecipientSelectable(recipient) ||
              (!selected && selectedPhones.length >= 10)

            return (
              <RecipientRow
                key={recipient.normalized_phone}
                recipient={recipient}
                selected={selected}
                disabled={disabled}
                onToggle={() => toggleRecipient(recipient)}
              />
            )
          })}
        </div>

        <div className="grid gap-4">
          <FormItem>
            <FormLabel htmlFor="maxTemplate">Шаблон</FormLabel>
            <Select
              value={form.watch('templateId') || CUSTOM_TEMPLATE_VALUE}
              onValueChange={handleTemplateChange}
              disabled={templatesQuery.isLoading}
            >
              <SelectTrigger id="maxTemplate" className="h-10 w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value={CUSTOM_TEMPLATE_VALUE}>Без шаблона</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templatesQuery.isError ? (
              <FormMessage>{templatesQuery.error.message}</FormMessage>
            ) : null}
          </FormItem>

          <FormItem>
            <FormLabel htmlFor="maxMessageText">Текст сообщения</FormLabel>
            <textarea
              id="maxMessageText"
              className="min-h-36 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-[3px] focus-visible:ring-slate-200"
              placeholder="Введите сообщение для MAX"
              {...form.register('messageText')}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>Текст можно изменить перед отправкой.</span>
              <span>{messageText.trim().length}/4000</span>
            </div>
            {form.formState.errors.messageText ? (
              <FormMessage>{form.formState.errors.messageText.message}</FormMessage>
            ) : null}
          </FormItem>
        </div>

        {selectedRecipients.length > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">Получатели</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedRecipients.map((recipient) => (
                <Badge key={recipient.normalized_phone} variant="outline" className="rounded-md bg-white">
                  {recipient.display_name}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <Button type="submit" className="h-11 w-full gap-2" disabled={isSubmitDisabled}>
          {sendMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          {sendMutation.isPending ? 'Отправляем...' : 'Отправить в MAX'}
        </Button>

        {sendMutation.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {sendMutation.error.message}
          </div>
        ) : null}

        {sendMutation.data ? (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <MessageCircle className="size-4 text-slate-500" aria-hidden="true" />
              Результат отправки
            </div>
            {selectedRecipients.map((recipient) => {
              const result = resultByPhone.get(recipient.normalized_phone)
              const isSent = result?.status === 'sent'

              return (
                <div
                  key={recipient.normalized_phone}
                  className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
                >
                  {isSent ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{recipient.display_name}</span>
                    <span className="block text-slate-500">
                      {isSent ? 'Отправлено' : (result?.error_message ?? 'Не отправлено')}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </form>
    </Form>
  )
}
