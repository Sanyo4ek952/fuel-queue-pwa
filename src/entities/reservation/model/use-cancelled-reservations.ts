import { useInfiniteQuery } from '@tanstack/react-query'

import {
  listCancelledReservationsPage,
  type CancelledReservation,
  type CancelledReservationsCursor,
} from '@/shared/api/reservation'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

const CANCELLED_RESERVATIONS_PAGE_SIZE = 25

export const cancelledReservationsQueryKey = (plateSearch: string) =>
  ['cancelled-reservations', normalizePlateNumber(plateSearch)] as const

export function useCancelledReservations(params: { plateSearch?: string } = {}) {
  const plateSearch = params.plateSearch ?? ''

  return useInfiniteQuery({
    queryKey: cancelledReservationsQueryKey(plateSearch),
    initialPageParam: null as CancelledReservationsCursor | null,
    queryFn: ({ pageParam }) =>
      listCancelledReservationsPage({
        pageSize: CANCELLED_RESERVATIONS_PAGE_SIZE,
        cursor: pageParam,
        plateSearch,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    select: (data) => ({
      ...data,
      rows: data.pages.flatMap((page) => page.rows),
    }),
  })
}

export type { CancelledReservation }
