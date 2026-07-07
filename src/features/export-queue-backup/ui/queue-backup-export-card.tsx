import { zodResolver } from '@hookform/resolvers/zod'
import { Download, HardDriveUpload } from 'lucide-react'
import { useForm } from 'react-hook-form'

import {
  type QueueBackupExportInput,
  type QueueBackupExportValues,
  queueBackupExportSchema,
} from '../model/schema'
import { useExportQueueBackup } from '../model/use-export-queue-backup'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

export function QueueBackupExportCard() {
  const exportMutation = useExportQueueBackup()
  const form = useForm<QueueBackupExportInput, unknown, QueueBackupExportValues>({
    resolver: zodResolver(queueBackupExportSchema),
    defaultValues: {
      targetDate: '',
    },
  })

  async function handleSubmit(values: QueueBackupExportValues) {
    await exportMutation.mutateAsync({
      targetDate: values.targetDate,
    })
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveUpload className="size-5 text-slate-500" aria-hidden="true" />
          Экспорт очереди
        </CardTitle>
        <CardDescription>
          Сохранить очередь на Google Диск и скачать CSV-файл для Excel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="queueBackupTargetDate">Дата</FormLabel>
              <Input id="queueBackupTargetDate" type="date" {...form.register('targetDate')} />
              <p className="text-xs text-slate-500">
                Оставьте пустым, чтобы скачать всю активную очередь.
              </p>
              {form.formState.errors.targetDate ? (
                <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={exportMutation.isPending}
            >
              <Download className="size-4" aria-hidden="true" />
              {exportMutation.isPending ? 'Готовим файл...' : 'Скачать очередь'}
            </Button>
          </form>
        </Form>

        {exportMutation.error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Очередь не скачана</AlertTitle>
            <AlertDescription>{exportMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {exportMutation.data ? (
          <Alert className="mt-4 border-emerald-200 bg-emerald-50 text-emerald-950">
            <AlertTitle>Файл готов</AlertTitle>
            <AlertDescription>
              {exportMutation.data.fileName} загружен на Google Диск и скачан в браузере.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
