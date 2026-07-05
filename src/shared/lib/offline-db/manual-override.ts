import { normalizePlateNumber } from '@/shared/lib/plate-number'

import {
  offlineDb,
  type LocalManualOverride,
  type LocalVehicle,
  type SyncOutboxOperation,
} from './db'

export type CreateOfflineManualOverrideParams = {
  targetDate: string
  stationId: string
  plateNumber: string
  reason: string
  expiresAt?: string
  clientMutationId: string
}

export type OfflineManualOverrideResult = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  normalized_plate_number: string
  reason: string
  approved_by: string | null
  expires_at: string | null
  used_at: string | null
  client_mutation_id: string
  sync_status: 'PENDING'
}

export type CreateManualOverridePayload = {
  target_date: string
  station_id: string
  plate_number: string
  reason: string
  expires_at?: string
}

export function buildCreateManualOverridePayload({
  targetDate,
  stationId,
  plateNumber,
  reason,
  expiresAt,
}: CreateOfflineManualOverrideParams): CreateManualOverridePayload {
  return {
    target_date: targetDate,
    station_id: stationId,
    plate_number: plateNumber,
    reason,
    expires_at: expiresAt || undefined,
  }
}

function makeLocalVehicle(normalizedPlateNumber: string): LocalVehicle {
  return {
    id: `local-vehicle-${normalizedPlateNumber}`,
    normalized_plate_number: normalizedPlateNumber,
    is_blocked: false,
    updated_at: new Date().toISOString(),
  }
}

function isFutureOrOpen(expiresAt?: string | null) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now()
}

export async function createOfflineManualOverride({
  targetDate,
  stationId,
  plateNumber,
  reason,
  expiresAt,
  clientMutationId,
}: CreateOfflineManualOverrideParams): Promise<OfflineManualOverrideResult> {
  const normalizedPlateNumber = normalizePlateNumber(plateNumber)
  const trimmedReason = reason.trim()
  const trimmedExpiresAt = expiresAt?.trim() || null

  if (!normalizedPlateNumber) {
    throw new Error('INVALID_PLATE_NUMBER')
  }

  if (!trimmedReason) {
    throw new Error('INVALID_REASON')
  }

  if (trimmedExpiresAt && new Date(trimmedExpiresAt).getTime() <= Date.now()) {
    throw new Error('INVALID_EXPIRES_AT')
  }

  const [vehicles, manualOverrides] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    offlineDb.local_manual_overrides.toArray(),
  ])
  const existingVehicle = vehicles.find(
    (vehicle) => vehicle.normalized_plate_number === normalizedPlateNumber,
  )
  const vehicle = existingVehicle ?? makeLocalVehicle(normalizedPlateNumber)
  const existingActiveOverride = manualOverrides.find(
    (override) =>
      override.vehicle_id === vehicle.id &&
      override.station_id === stationId &&
      override.date === targetDate &&
      !override.used_at &&
      isFutureOrOpen(override.expires_at),
  )

  if (existingActiveOverride) {
    return {
      id: existingActiveOverride.id,
      date: existingActiveOverride.date,
      station_id: existingActiveOverride.station_id,
      vehicle_id: existingActiveOverride.vehicle_id,
      normalized_plate_number:
        existingActiveOverride.normalized_plate_number ?? normalizedPlateNumber,
      reason: existingActiveOverride.reason ?? trimmedReason,
      approved_by: existingActiveOverride.approved_by ?? null,
      expires_at: existingActiveOverride.expires_at ?? null,
      used_at: existingActiveOverride.used_at ?? null,
      client_mutation_id: existingActiveOverride.client_mutation_id ?? clientMutationId,
      sync_status: 'PENDING',
    }
  }

  const id = `local-${clientMutationId}`
  const now = new Date().toISOString()
  const localManualOverride: LocalManualOverride = {
    id,
    date: targetDate,
    station_id: stationId,
    vehicle_id: vehicle.id,
    reason: trimmedReason,
    approved_by: null,
    normalized_plate_number: normalizedPlateNumber,
    expires_at: trimmedExpiresAt,
    used_at: null,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
    updated_at: now,
  }
  const syncOutboxOperation: SyncOutboxOperation = {
    id: clientMutationId,
    client_mutation_id: clientMutationId,
    type: 'CREATE_MANUAL_OVERRIDE',
    payload: buildCreateManualOverridePayload({
      targetDate,
      stationId,
      plateNumber,
      reason: trimmedReason,
      expiresAt: trimmedExpiresAt ?? undefined,
      clientMutationId,
    }),
    status: 'PENDING',
    created_at: now,
    retry_count: 0,
  }

  await offlineDb.transaction(
    'rw',
    [offlineDb.local_vehicles, offlineDb.local_manual_overrides, offlineDb.sync_outbox],
    async () => {
      if (!existingVehicle) {
        await offlineDb.local_vehicles.put(vehicle)
      }

      await offlineDb.local_manual_overrides.put(localManualOverride)
      await offlineDb.sync_outbox.put(syncOutboxOperation)
    },
  )

  return {
    id,
    date: targetDate,
    station_id: stationId,
    vehicle_id: vehicle.id,
    normalized_plate_number: normalizedPlateNumber,
    reason: trimmedReason,
    approved_by: null,
    expires_at: trimmedExpiresAt,
    used_at: null,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
  }
}
