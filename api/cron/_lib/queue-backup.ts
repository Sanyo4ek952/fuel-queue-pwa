export type QueueBackupRow = {
  date?: string | null
  queue_number?: number | string | null
  permanent_number?: number | string | null
  station_id?: string | null
  station_name?: string | null
  normalized_plate_number?: string | null
  driver_full_name?: string | null
  driver_phone?: string | null
  preferred_fuel_type?: string | null
  fuel_type?: string | null
  fuel_preference_mode?: string | null
  compatible_fuel_types?: string[] | string | null
  matched_fuel_type?: string | null
  assigned_fuel_type?: string | null
  daily_position?: number | string | null
  station_position?: number | string | null
  station_fuel_position?: number | string | null
  arrival_at?: string | null
  allocation_status?: string | null
  queue_status?: string | null
  concrete_supply?: string | null
  fuel_category?: string | null
  requested_liters?: number | string | null
  effective_liters?: number | string | null
  status?: string | null
  sync_status?: string | null
  is_within_today_limit?: boolean | null
  is_callable_now?: boolean | null
  call_unavailable_reason?: string | null
  invitation_status?: string | null
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
  { header: 'Постоянный номер', value: (row) => row.permanent_number ?? row.queue_number },
  { header: 'АЗС', value: (row) => row.station_name },
  { header: 'Назначенная АЗС', value: (row) => row.station_name },
  { header: 'Госномер', value: (row) => row.normalized_plate_number },
  { header: 'Водитель', value: (row) => row.driver_full_name },
  { header: 'Телефон', value: (row) => row.driver_phone },
  { header: 'Предпочтение топлива', value: (row) => row.preferred_fuel_type ?? row.fuel_type },
  { header: 'Режим предпочтения топлива', value: (row) => row.fuel_preference_mode },
  { header: 'Допустимые марки', value: (row) => formatList(row.compatible_fuel_types) },
  { header: 'Назначенная марка', value: (row) => row.assigned_fuel_type ?? row.matched_fuel_type },
  { header: 'Дневная позиция', value: (row) => row.daily_position },
  { header: 'Позиция на АЗС', value: (row) => row.station_position },
  { header: 'Позиция АЗС/топливо', value: (row) => row.station_fuel_position },
  { header: 'Время прибытия', value: (row) => row.arrival_at },
  { header: 'Конкретная поставка', value: (row) => row.concrete_supply },
  { header: 'Категория', value: (row) => row.fuel_category },
  { header: 'Запрошено литров', value: (row) => row.requested_liters },
  { header: 'Расчетные литры', value: (row) => row.effective_liters },
  { header: 'Статус записи', value: (row) => row.queue_status ?? row.status },
  { header: 'Статус назначения', value: (row) => row.allocation_status },
  { header: 'Статус синхронизации', value: (row) => row.sync_status },
  { header: 'В дневном лимите', value: (row) => formatBoolean(row.is_within_today_limit) },
  { header: 'Можно приглашать сейчас', value: (row) => formatBoolean(row.is_callable_now) },
  { header: 'Причина недоступности', value: (row) => row.call_unavailable_reason },
  { header: 'Статус приглашения', value: (row) => row.invitation_status ?? row.latest_call_status },
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

function formatList(value: string[] | string | null | undefined) {
  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return value
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
