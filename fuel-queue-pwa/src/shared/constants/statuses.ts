export const RESERVATION_STATUSES = [
  'RESERVED',
  'ARRIVED',
  'APPROVED',
  'FUELING',
  'FUELED',
  'REJECTED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
  'ERROR',
  'CONFLICT',
] as const

export const SYNC_STATUSES = ['SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT'] as const

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]
export type SyncStatus = (typeof SYNC_STATUSES)[number]
