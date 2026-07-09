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
export const RESERVATION_CALL_STATUSES = [
  'NOT_CALLED',
  'CONTACTED',
  'NO_ANSWER',
] as const

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]
export type SyncStatus = (typeof SYNC_STATUSES)[number]
export type ReservationCallStatus = (typeof RESERVATION_CALL_STATUSES)[number]
