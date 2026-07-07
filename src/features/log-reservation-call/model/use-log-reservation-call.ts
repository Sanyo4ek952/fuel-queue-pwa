import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useCurrentProfile } from '@/entities/profile'
import { todayQueueQueryKey, type TodayQueueRow } from '@/entities/reservation'
import {
  buildCreateReservationCallLogPayload,
  createReservationCallLog,
  type CreateReservationCallLogResult,
} from '@/shared/api/rpc'
import type { ReservationCallStatus, SyncStatus } from '@/shared/constants'
import {
  offlineDb,
  type LocalReservationCallLog,
  type SyncOutboxOperation,
} from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type LogReservationCallInput = {
  reservation: TodayQueueRow
  status: ReservationCallStatus
  comment?: string
}

function applyCallToReservation({
  reservationId,
  status,
  calledByProfileId,
  calledByFullName,
  calledByRole,
  calledBySignatureName,
  calledAt,
  comment,
  clientMutationId,
  syncStatus,
}: {
  reservationId: string
  status: ReservationCallStatus
  calledByProfileId: string | null
  calledByFullName: string
  calledByRole: string | null
  calledBySignatureName: string | null
  calledAt: string
  comment: string | null
  clientMutationId: string
  syncStatus: SyncStatus
}) {
  return offlineDb.local_reservations.update(reservationId, {
    latest_call_status: status,
    latest_called_by_profile_id: calledByProfileId,
    latest_called_by_full_name: calledByFullName,
    latest_called_by_role: calledByRole,
    latest_called_by_signature_name: calledBySignatureName,
    latest_called_at: calledAt,
    latest_call_comment: comment,
    latest_call_client_mutation_id: clientMutationId,
    latest_call_sync_status: syncStatus,
    updated_at: new Date().toISOString(),
  })
}

async function cacheSyncedCallLog(result: CreateReservationCallLogResult) {
  const now = new Date().toISOString()
  const localCallLog: LocalReservationCallLog = {
    id: result.id,
    reservation_id: result.reservation_id,
    status: result.status,
    called_by_profile_id: result.called_by_profile_id,
    called_by_full_name: result.called_by_full_name,
    called_by_role: result.called_by_role,
    called_by_signature_name: result.called_by_signature_name,
    called_at: result.called_at,
    comment: result.comment,
    client_mutation_id: result.client_mutation_id,
    sync_status: 'SYNCED',
    updated_at: now,
  }

  await offlineDb.transaction(
    'rw',
    [offlineDb.local_reservation_call_logs, offlineDb.local_reservations],
    async () => {
      await offlineDb.local_reservation_call_logs.put(localCallLog)
      await applyCallToReservation({
        reservationId: result.reservation_id,
        status: result.status,
        calledByProfileId: result.called_by_profile_id,
        calledByFullName: result.called_by_full_name,
        calledByRole: result.called_by_role,
        calledBySignatureName: result.called_by_signature_name,
        calledAt: result.called_at,
        comment: result.comment,
        clientMutationId: result.client_mutation_id,
        syncStatus: 'SYNCED',
      })
    },
  )
}

async function createOfflineReservationCallLog({
  reservation,
  status,
  comment,
  clientMutationId,
  profile,
}: LogReservationCallInput & {
  clientMutationId: string
  profile: {
    id: string
    full_name: string
    role: string
    signature_name: string | null
  }
}): Promise<CreateReservationCallLogResult> {
  if (reservation.is_offline || reservation.id.startsWith('local-')) {
    throw new Error('RESERVATION_NOT_SYNCED')
  }

  const now = new Date().toISOString()
  const trimmedComment = comment?.trim() || null
  const localCallLog: LocalReservationCallLog = {
    id: `local-call-${clientMutationId}`,
    reservation_id: reservation.id,
    status,
    called_by_profile_id: profile.id,
    called_by_full_name: profile.full_name,
    called_by_role: profile.role,
    called_by_signature_name: profile.signature_name,
    called_at: now,
    comment: trimmedComment,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
    updated_at: now,
  }
  const syncOutboxOperation: SyncOutboxOperation = {
    id: clientMutationId,
    client_mutation_id: clientMutationId,
    type: 'CREATE_RESERVATION_CALL_LOG',
    payload: buildCreateReservationCallLogPayload({
      reservationId: reservation.id,
      status,
      comment: trimmedComment ?? undefined,
      clientMutationId,
    }),
    status: 'PENDING',
    created_at: now,
    retry_count: 0,
  }

  await offlineDb.transaction(
    'rw',
    [offlineDb.local_reservation_call_logs, offlineDb.local_reservations, offlineDb.sync_outbox],
    async () => {
      await offlineDb.local_reservation_call_logs.put(localCallLog)
      await offlineDb.sync_outbox.put(syncOutboxOperation)
      await applyCallToReservation({
        reservationId: reservation.id,
        status,
        calledByProfileId: profile.id,
        calledByFullName: profile.full_name,
        calledByRole: profile.role,
        calledBySignatureName: profile.signature_name,
        calledAt: now,
        comment: trimmedComment,
        clientMutationId,
        syncStatus: 'PENDING',
      })
    },
  )

  return {
    id: localCallLog.id,
    reservation_id: reservation.id,
    status,
    called_by_profile_id: profile.id,
    called_by_full_name: profile.full_name,
    called_by_role: profile.role,
    called_by_signature_name: profile.signature_name,
    called_at: now,
    comment: trimmedComment,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
  }
}

export function useLogReservationCall() {
  const isOnline = useOnlineStatus()
  const currentProfileQuery = useCurrentProfile()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ reservation, status, comment }: LogReservationCallInput) => {
      const profile = currentProfileQuery.data
      const clientMutationId = crypto.randomUUID()

      if (!profile) {
        throw new Error('PROFILE_NOT_LOADED')
      }

      if (!isOnline) {
        return createOfflineReservationCallLog({
          reservation,
          status,
          comment,
          clientMutationId,
          profile,
        })
      }

      const result = await createReservationCallLog({
        reservationId: reservation.id,
        status,
        comment,
        clientMutationId,
      })

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'CREATE_RESERVATION_CALL_LOG_FAILED')
      }

      await cacheSyncedCallLog(result.data)

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: todayQueueQueryKey() })
    },
  })
}
