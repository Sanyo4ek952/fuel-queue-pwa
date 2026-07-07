import { getAuthSession } from '@/shared/api/auth'

export type ExportQueueBackupParams = {
  targetDate: string | null
}

export type ExportQueueBackupResult = {
  fileName: string
}

function getFileNameFromContentDisposition(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/)

  return match?.[1] ?? 'azs-queue-backup-all.csv'
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function exportQueueBackup({
  targetDate,
}: ExportQueueBackupParams): Promise<ExportQueueBackupResult> {
  if (!navigator.onLine) {
    throw new Error('Экспорт доступен только онлайн.')
  }

  const sessionResult = await getAuthSession()

  if (sessionResult.error || !sessionResult.data?.access_token) {
    throw new Error(sessionResult.error ?? 'Нужно войти в систему.')
  }

  const response = await fetch('/api/queue-backup', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionResult.data.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetDate,
    }),
  })

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null

    throw new Error(result?.error ?? 'Не удалось скачать очередь.')
  }

  const blob = await response.blob()
  const fileName = getFileNameFromContentDisposition(response.headers.get('content-disposition'))

  downloadBlob(blob, fileName)

  return { fileName }
}
