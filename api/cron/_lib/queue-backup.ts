export type QueueBackupRow = {
  date?: string | null
  queue_number?: number | string | null
  station_name?: string | null
  normalized_plate_number?: string | null
  driver_full_name?: string | null
  driver_phone?: string | null
  fuel_type?: string | null
  fuel_category?: string | null
  requested_liters?: number | string | null
  effective_liters?: number | string | null
  status?: string | null
  sync_status?: string | null
  is_within_today_limit?: boolean | null
  latest_call_status?: string | null
  latest_called_by?: string | null
  latest_called_at?: string | null
  latest_call_comment?: string | null
  latest_call_sync_status?: string | null
  created_by?: string | null
  created_by_role?: string | null
  comment?: string | null
  client_mutation_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export const QUEUE_BACKUP_FILE_PREFIX = 'azs-queue-backup-'
export const QUEUE_BACKUP_RETENTION_COUNT = 10

const queueBackupColumns: Array<{
  header: string
  value: (row: QueueBackupRow) => unknown
}> = [
  { header: 'Дата', value: (row) => row.date },
  { header: 'Номер очереди', value: (row) => row.queue_number },
  { header: 'АЗС', value: (row) => row.station_name },
  { header: 'Госномер', value: (row) => row.normalized_plate_number },
  { header: 'Водитель', value: (row) => row.driver_full_name },
  { header: 'Телефон', value: (row) => row.driver_phone },
  { header: 'Топливо', value: (row) => row.fuel_type },
  { header: 'Категория', value: (row) => row.fuel_category },
  { header: 'Запрошено литров', value: (row) => row.requested_liters },
  { header: 'Расчетные литры', value: (row) => row.effective_liters },
  { header: 'Статус записи', value: (row) => row.status },
  { header: 'Статус синхронизации', value: (row) => row.sync_status },
  { header: 'В дневном лимите', value: (row) => formatBoolean(row.is_within_today_limit) },
  { header: 'Статус обзвона', value: (row) => row.latest_call_status },
  { header: 'Кто обзвонил', value: (row) => row.latest_called_by },
  { header: 'Когда обзвонили', value: (row) => row.latest_called_at },
  { header: 'Комментарий обзвона', value: (row) => row.latest_call_comment },
  { header: 'Sync обзвона', value: (row) => row.latest_call_sync_status },
  { header: 'Кто добавил', value: (row) => row.created_by },
  { header: 'Роль автора', value: (row) => row.created_by_role },
  { header: 'Комментарий', value: (row) => row.comment },
  { header: 'Client mutation id', value: (row) => row.client_mutation_id },
  { header: 'Создано', value: (row) => row.created_at },
  { header: 'Обновлено', value: (row) => row.updated_at },
]

function formatBoolean(value: boolean | null | undefined) {
  if (value === true) {
    return 'Да'
  }

  if (value === false) {
    return 'Нет'
  }

  return ''
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  const text = String(value)

  if (text.includes(';') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

export function buildQueueBackupCsv(rows: QueueBackupRow[]) {
  const header = queueBackupColumns.map((column) => escapeCsvValue(column.header)).join(';')
  const body = rows.map((row) =>
    queueBackupColumns.map((column) => escapeCsvValue(column.value(row))).join(';'),
  )

  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}

export function getMoscowDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(date)
}

export function getQueueBackupFileName(targetDate?: string | null) {
  return `${QUEUE_BACKUP_FILE_PREFIX}${targetDate ?? 'all'}.csv`
}

export function isQueueBackupDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function selectOldQueueBackupFileIds(
  files: Array<{ id: string; name: string; createdTime?: string }>,
  retentionCount = QUEUE_BACKUP_RETENTION_COUNT,
) {
  return files
    .filter((file) => file.name.startsWith(QUEUE_BACKUP_FILE_PREFIX) && file.name.endsWith('.csv'))
    .sort((left, right) => {
      const byName = right.name.localeCompare(left.name)

      if (byName !== 0) {
        return byName
      }

      return (right.createdTime ?? '').localeCompare(left.createdTime ?? '')
    })
    .slice(retentionCount)
    .map((file) => file.id)
}
