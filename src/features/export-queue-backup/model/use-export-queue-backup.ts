import { useMutation } from '@tanstack/react-query'

import { exportQueueBackup, type ExportQueueBackupParams } from '@/shared/api/queue-backup'

export function useExportQueueBackup() {
  return useMutation({
    mutationFn: (params: ExportQueueBackupParams) => exportQueueBackup(params),
  })
}
