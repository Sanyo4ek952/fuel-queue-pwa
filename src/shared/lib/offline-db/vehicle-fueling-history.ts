import type {
  GetVehicleFuelingHistoryParams,
  VehicleFuelingHistoryFuelSummary,
  VehicleFuelingHistoryResult,
  VehicleFuelingHistoryStationSummary,
} from '@/shared/types/vehicle-fueling-history'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { offlineDb } from './db'

function addCount<TKey extends string>(
  map: Map<TKey, { fuelingCount: number; totalLiters: number }>,
  key: TKey,
  liters: number,
) {
  const current = map.get(key) ?? { fuelingCount: 0, totalLiters: 0 }

  map.set(key, {
    fuelingCount: current.fuelingCount + 1,
    totalLiters: current.totalLiters + liters,
  })
}

export function markFuelingHistoryOfflineResult(
  result: VehicleFuelingHistoryResult,
  error?: string,
): VehicleFuelingHistoryResult {
  return {
    ...result,
    offline: true,
    error,
  }
}

export async function getVehicleFuelingHistoryOffline({
  plateNumber,
}: GetVehicleFuelingHistoryParams): Promise<VehicleFuelingHistoryResult> {
  const normalizedPlateNumber = normalizePlateNumber(plateNumber)
  const [vehicles, stations, fuelingRecords] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    offlineDb.local_stations.toArray(),
    offlineDb.local_fueling_records.toArray(),
  ])
  const vehicle = vehicles.find((item) => item.normalized_plate_number === normalizedPlateNumber)
  const stationNames = new Map(stations.map((station) => [station.id, station.name]))

  if (!vehicle) {
    return {
      normalized_plate_number: normalizedPlateNumber,
      vehicle_id: null,
      vehicle_found: false,
      total_fueling_count: 0,
      regular_fueling_count: 0,
      manual_override_fueling_count: 0,
      total_liters: 0,
      first_fueled_at: null,
      last_fueled_at: null,
      station_summaries: [],
      fuel_type_summaries: [],
    }
  }

  const vehicleFuelings = fuelingRecords.filter((record) => record.vehicle_id === vehicle.id)
  const stationCounts = new Map<string, { fuelingCount: number; totalLiters: number }>()
  const fuelTypeCounts = new Map<string, { fuelingCount: number; totalLiters: number }>()
  let regularFuelingCount = 0
  let manualOverrideFuelingCount = 0
  let totalLiters = 0
  let firstFueledAt: string | null = null
  let lastFueledAt: string | null = null

  for (const fueling of vehicleFuelings) {
    const liters = fueling.liters ?? 0

    totalLiters += liters
    addCount(stationCounts, fueling.station_id, liters)

    if (fueling.fuel_type) {
      addCount(fuelTypeCounts, fueling.fuel_type, liters)
    }

    if (fueling.is_manual_override) {
      manualOverrideFuelingCount += 1
    } else {
      regularFuelingCount += 1
    }

    if (!firstFueledAt || fueling.fueled_at < firstFueledAt) {
      firstFueledAt = fueling.fueled_at
    }

    if (!lastFueledAt || fueling.fueled_at > lastFueledAt) {
      lastFueledAt = fueling.fueled_at
    }
  }

  const stationSummaries: VehicleFuelingHistoryStationSummary[] = [...stationCounts.entries()]
    .map(([stationId, count]) => ({
      station_id: stationId,
      station_name: stationNames.get(stationId) ?? stationId,
      fueling_count: count.fuelingCount,
      total_liters: count.totalLiters,
    }))
    .sort((left, right) => left.station_name.localeCompare(right.station_name))
  const fuelTypeSummaries: VehicleFuelingHistoryFuelSummary[] = [...fuelTypeCounts.entries()]
    .map(([fuelType, count]) => ({
      fuel_type: fuelType,
      fueling_count: count.fuelingCount,
      total_liters: count.totalLiters,
    }))
    .sort((left, right) => left.fuel_type.localeCompare(right.fuel_type))

  return {
    normalized_plate_number: normalizedPlateNumber,
    vehicle_id: vehicle.id,
    vehicle_found: true,
    total_fueling_count: vehicleFuelings.length,
    regular_fueling_count: regularFuelingCount,
    manual_override_fueling_count: manualOverrideFuelingCount,
    total_liters: totalLiters,
    first_fueled_at: firstFueledAt,
    last_fueled_at: lastFueledAt,
    station_summaries: stationSummaries,
    fuel_type_summaries: fuelTypeSummaries,
  }
}
