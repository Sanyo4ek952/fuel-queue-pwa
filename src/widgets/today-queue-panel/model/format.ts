import type { TodayQueueRow } from '@/entities/reservation'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'

export function formatCreatedBy(row: TodayQueueRow) {
  const roleLabel =
    row.created_by_role && row.created_by_role in ROLE_LABELS
      ? ROLE_LABELS[row.created_by_role as UserRole]
      : 'Пользователь'
  const name = row.created_by_signature_name || row.created_by_full_name

  return name ? `${roleLabel}: ${name}` : 'Автор не указан'
}

export function getPhoneHref(phone: string | null) {
  const normalizedPhone = phone?.replace(/[^\d+]/g, '')

  return normalizedPhone ? `tel:${normalizedPhone}` : null
}

export function getCalledByLabel(row: TodayQueueRow) {
  return row.latest_called_by_signature_name || row.latest_called_by_full_name || 'Пользователь'
}

export function formatCallTime(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
}
