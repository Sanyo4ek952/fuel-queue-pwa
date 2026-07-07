import { useMutation } from '@tanstack/react-query'

import {
  parseCreateReservationResult,
  parseCreateFuelingRecordResult,
  parseCreateManualOverrideResult,
  parseCreateReservationCallLogResult,
  syncOfflineMutation,
} from '@/shared/api/rpc'
import { offlineDb, type SyncOutboxOperation } from '@/shared/lib/offline-db'

let isSyncing = false

async function markOperationFailed(operation: SyncOutboxOperation, error: string) {
  await offlineDb.sync_outbox.update(operation.id, {
    status: 'FAILED',
    error,
    retry_count: operation.retry_count + 1,
  })
}

async function markFuelingRecordSynced(operation: SyncOutboxOperation, data: unknown) {
  const parsed = parseCreateFuelingRecordResult(data)
  const syncedAt = new Date().toISOString()

  await offlineDb.transaction(
    'rw',
    [offlineDb.sync_outbox, offlineDb.local_fueling_records],
    async () => {
      await offlineDb.sync_outbox.update(operation.id, {
        status: 'SYNCED',
        synced_at: syncedAt,
        error: undefined,
      })

      if (parsed) {
        await offlineDb.local_fueling_records
          .where('client_mutation_id')
          .equals(operation.client_mutation_id)
          .modify({
            id: parsed.id,
            station_id: parsed.station_id,
            vehicle_id: parsed.vehicle_id,
            date: parsed.date,
            reservation_id: parsed.reservation_id,
            fuel_type: parsed.fuel_type,
            liters: parsed.liters,
            fueled_at: parsed.fueled_at,
            is_manual_override: parsed.is_manual_override,
            override_id: parsed.override_id,
            sync_status: 'SYNCED',
            updated_at: syncedAt,
          })
      }
    },
  )
}

async function markReservationSynced(operation: SyncOutboxOperation, data: unknown) {
  const parsed = parseCreateReservationResult(data)
  const syncedAt = new Date().toISOString()

  await offlineDb.transaction(
    'rw',
    [offlineDb.sync_outbox, offlineDb.local_reservations],
    async () => {
      await offlineDb.sync_outbox.update(operation.id, {
        status: 'SYNCED',
        synced_at: syncedAt,
        error: undefined,
      })

      if (parsed) {
        await offlineDb.local_reservations
          .where('client_mutation_id')
          .equals(operation.client_mutation_id)
          .modify({
            id: parsed.id,
            station_id: parsed.station_id,
            vehicle_id: parsed.vehicle_id,
            driver_id: parsed.driver_id,
            date: parsed.date,
            fuel_type: parsed.fuel_type,
            fuel_preference_mode: parsed.fuel_preference_mode,
            requested_liters: parsed.requested_liters,
            queue_number: parsed.queue_number,
            status: parsed.status,
            normalized_plate_number: parsed.normalized_plate_number,
            driver_full_name: parsed.driver_full_name,
            driver_phone: parsed.driver_phone,
            sync_status: 'SYNCED',
            updated_at: syncedAt,
          })
      }
    },
  )
}

async function markManualOverrideSynced(operation: SyncOutboxOperation, data: unknown) {
  const parsed = parseCreateManualOverrideResult(data)
  const syncedAt = new Date().toISOString()

  await offlineDb.transaction(
    'rw',
    [offlineDb.sync_outbox, offlineDb.local_manual_overrides],
    async () => {
      await offlineDb.sync_outbox.update(operation.id, {
        status: 'SYNCED',
        synced_at: syncedAt,
        error: undefined,
      })

      if (parsed) {
        await offlineDb.local_manual_overrides
          .where('client_mutation_id')
          .equals(operation.client_mutation_id)
          .modify({
            id: parsed.id,
            station_id: parsed.station_id,
            vehicle_id: parsed.vehicle_id,
            date: parsed.date,
            reason: parsed.reason,
            approved_by: parsed.approved_by,
            normalized_plate_number: parsed.normalized_plate_number,
            expires_at: parsed.expires_at,
            used_at: parsed.used_at,
            sync_status: 'SYNCED',
            updated_at: syncedAt,
          })
      }
    },
  )
}

async function markReservationCallLogSynced(operation: SyncOutboxOperation, data: unknown) {
  const parsed = parseCreateReservationCallLogResult(data)
  const syncedAt = new Date().toISOString()

  await offlineDb.transaction(
    'rw',
    [offlineDb.sync_outbox, offlineDb.local_reservation_call_logs, offlineDb.local_reservations],
    async () => {
      await offlineDb.sync_outbox.update(operation.id, {
        status: 'SYNCED',
        synced_at: syncedAt,
        error: undefined,
      })

      if (parsed) {
        await offlineDb.local_reservation_call_logs
          .where('client_mutation_id')
          .equals(operation.client_mutation_id)
          .modify({
            id: parsed.id,
            reservation_id: parsed.reservation_id,
            status: parsed.status,
            called_by_profile_id: parsed.called_by_profile_id,
            called_by_full_name: parsed.called_by_full_name,
            called_by_role: parsed.called_by_role,
            called_by_signature_name: parsed.called_by_signature_name,
            called_at: parsed.called_at,
            comment: parsed.comment,
            sync_status: 'SYNCED',
            updated_at: syncedAt,
          })
        await offlineDb.local_reservations.update(parsed.reservation_id, {
          latest_call_status: parsed.status,
          latest_called_by_profile_id: parsed.called_by_profile_id,
          latest_called_by_full_name: parsed.called_by_full_name,
          latest_called_by_role: parsed.called_by_role,
          latest_called_by_signature_name: parsed.called_by_signature_name,
          latest_called_at: parsed.called_at,
          latest_call_comment: parsed.comment,
          latest_call_client_mutation_id: parsed.client_mutation_id,
          latest_call_sync_status: 'SYNCED',
          updated_at: syncedAt,
        })
      }
    },
  )
}

async function markOperationConflict(operation: SyncOutboxOperation, reason: string, payload: unknown) {
  const createdAt = new Date().toISOString()

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.sync_outbox,
      offlineDb.local_fueling_records,
      offlineDb.local_reservations,
      offlineDb.local_reservation_call_logs,
      offlineDb.local_manual_overrides,
      offlineDb.sync_conflicts,
    ],
    async () => {
      await offlineDb.sync_outbox.update(operation.id, {
        status: 'CONFLICT',
        error: reason,
        retry_count: operation.retry_count + 1,
      })
      await offlineDb.local_fueling_records
        .where('client_mutation_id')
        .equals(operation.client_mutation_id)
        .modify({
          sync_status: 'CONFLICT',
          updated_at: createdAt,
        })
      await offlineDb.local_reservations
        .where('client_mutation_id')
        .equals(operation.client_mutation_id)
        .modify({
          sync_status: 'CONFLICT',
          status: 'CONFLICT',
          updated_at: createdAt,
        })
      await offlineDb.local_manual_overrides
        .where('client_mutation_id')
        .equals(operation.client_mutation_id)
        .modify({
          sync_status: 'CONFLICT',
          updated_at: createdAt,
        })
      await offlineDb.local_reservation_call_logs
        .where('client_mutation_id')
        .equals(operation.client_mutation_id)
        .modify({
          sync_status: 'CONFLICT',
          updated_at: createdAt,
        })
      await offlineDb.local_reservations
        .filter((reservation) => reservation.latest_call_client_mutation_id === operation.client_mutation_id)
        .modify({
          latest_call_sync_status: 'CONFLICT',
          updated_at: createdAt,
        })
      await offlineDb.sync_conflicts.put({
        id: crypto.randomUUID(),
        client_mutation_id: operation.client_mutation_id,
        operation_id: operation.id,
        reason,
        payload,
        created_at: createdAt,
      })
    },
  )
}

async function syncOutboxOperation(operation: SyncOutboxOperation) {
  await offlineDb.sync_outbox.update(operation.id, {
    status: 'SYNCING',
    error: undefined,
  })

  const result = await syncOfflineMutation({
    clientMutationId: operation.client_mutation_id,
    operationType: operation.type,
    payload: operation.payload,
  })

  if (result.error || !result.data) {
    await markOperationFailed(operation, result.error ?? 'Sync failed.')
    return
  }

  if (result.data.status === 'CONFLICT') {
    await markOperationConflict(
      operation,
      result.data.reason ?? 'CONFLICT',
      result.data.payload ?? operation.payload,
    )
    return
  }

  if (operation.type === 'CREATE_FUELING_RECORD') {
    await markFuelingRecordSynced(operation, result.data.data)
    return
  }

  if (operation.type === 'CREATE_RESERVATION') {
    await markReservationSynced(operation, result.data.data)
    return
  }

  if (operation.type === 'CREATE_MANUAL_OVERRIDE') {
    await markManualOverrideSynced(operation, result.data.data)
    return
  }

  if (operation.type === 'CREATE_RESERVATION_CALL_LOG') {
    await markReservationCallLogSynced(operation, result.data.data)
    return
  }

  await offlineDb.sync_outbox.update(operation.id, {
    status: 'SYNCED',
    synced_at: new Date().toISOString(),
    error: undefined,
  })
}

export async function syncPendingOutbox() {
  if (isSyncing) {
    return
  }

  isSyncing = true

  try {
    const operations = await offlineDb.sync_outbox
      .where('status')
      .anyOf('PENDING', 'FAILED')
      .sortBy('created_at')

    for (const operation of operations) {
      await syncOutboxOperation(operation)
    }
  } finally {
    isSyncing = false
  }
}

export function useRunOutboxSync() {
  return useMutation({
    mutationFn: syncPendingOutbox,
  })
}
