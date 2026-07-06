import type { VehicleFuelingHistoryResult } from './use-vehicle-fueling-history'

type VehicleFuelingHistoryPages = {
  pages: VehicleFuelingHistoryResult[]
}

export function buildVehicleFuelingHistoryViewResult(
  data: VehicleFuelingHistoryPages | undefined,
): VehicleFuelingHistoryResult | undefined {
  const firstPage = data?.pages[0]

  if (!firstPage) {
    return undefined
  }

  return {
    ...firstPage,
    records: data.pages.flatMap((page) => page.records),
    has_more: data.pages.at(-1)?.has_more ?? firstPage.has_more,
    offline: firstPage.offline || data.pages.some((page) => page.offline),
    error: firstPage.error ?? data.pages.find((page) => page.error)?.error,
  }
}
