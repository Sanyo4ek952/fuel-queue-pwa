import { Download, HardDriveUpload } from 'lucide-react'

import { useExportQueueBackup } from '../model/use-export-queue-backup'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

export function QueueBackupExportCard() {
  const exportMutation = useExportQueueBackup()

  async function handleExport() {
    await exportMutation.mutateAsync({
      targetDate: null,
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
        <Button
          type="button"
          className="h-11 w-full gap-2"
          disabled={exportMutation.isPending}
          onClick={handleExport}
        >
          <Download className="size-4" aria-hidden="true" />
          {exportMutation.isPending ? 'Готовим файл...' : 'Скачать очередь'}
        </Button>

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
