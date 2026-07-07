import { useQuery } from '@tanstack/react-query'

import { getFuelingReport } from '@/shared/api/rpc'

import type { FuelingReportFilterValues } from './schema'

export const fuelingReportQueryKey = (filters: FuelingReportFilterValues | null) =>
  ['fueling-report', filters] as const

export function useFuelingReport({
  filters,
}: {
  filters: FuelingReportFilterValues | null
}) {
  return useQuery({
    queryKey: fuelingReportQueryKey(filters),
    enabled: Boolean(filters),
    queryFn: async () => {
      if (!filters) {
        throw new Error('Report filters are not valid.')
      }

      const result = await getFuelingReport({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        stationIds: filters.stationId === 'all' ? null : [filters.stationId],
      })

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить отчет.')
      }

      return result.data
    },
  })
}
