import { useQuery } from '@tanstack/react-query'

import {
  listCancelledReservations,
  type CancelledReservation,
} from '@/shared/api/reservation'

export const cancelledReservationsQueryKey = (dateFrom: string, dateTo: string) =>
  ['cancelled-reservations', dateFrom, dateTo] as const

export function useCancelledReservations(params: { dateFrom: string; dateTo: string }) {
  return useQuery({
    queryKey: cancelledReservationsQueryKey(params.dateFrom, params.dateTo),
    queryFn: () => listCancelledReservations(params),
  })
}

export type { CancelledReservation }
