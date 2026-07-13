import {
  handleProtectedRpc,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'

type ProtectedRpcRouterRequest = ProtectedRpcRequest & {
  query?: Record<string, string | string[] | undefined>
}

type ProtectedRpcRoute = {
  rpcName: string
  fallbackError: string
  mapBody: (body: Record<string, unknown>) => Record<string, unknown>
}

function getCursor(body: Record<string, unknown>) {
  const cursor = body.cursor

  return cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>) : {}
}

const protectedRpcRoutes: Record<string, ProtectedRpcRoute> = {
  'approve-registration': {
    rpcName: 'approve_registration',
    fallbackError: 'Approve registration request failed.',
    mapBody: (body) => ({
      target_profile_id: body.profileId ?? null,
      target_role: body.role ?? null,
      target_station_ids: body.stationIds ?? null,
    }),
  },
  'cancel-reservation': {
    rpcName: 'cancel_reservation',
    fallbackError: 'Cancel reservation request failed.',
    mapBody: (body) => ({
      reservation_id: body.reservationId ?? null,
      reason: body.reason ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'check-vehicle-access': {
    rpcName: 'check_vehicle_access',
    fallbackError: 'Check vehicle access request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
      station_id: body.stationId ?? null,
      check_date: body.checkDate ?? null,
    }),
  },
  'create-fueling-record-for-allocation': {
    rpcName: 'create_fueling_record_for_allocation',
    fallbackError: 'Create fueling record request failed.',
    mapBody: (body) => ({
      allocation_id: body.allocationId ?? null,
      liters: body.liters ?? null,
      fueled_at: body.fueledAt ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-fueling-record-for-preferential-entry': {
    rpcName: 'create_fueling_record_for_preferential_entry',
    fallbackError: 'Create preferential fueling record request failed.',
    mapBody: (body) => ({
      preferential_queue_entry_id: body.preferentialQueueEntryId ?? null,
      station_id: body.stationId ?? null,
      liters: body.liters ?? null,
      fueled_at: body.fueledAt ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'daily-limit-overview': {
    rpcName: 'get_daily_limit_overview',
    fallbackError: 'Daily limit overview request failed.',
    mapBody: (body) => ({
      target_date: body.date ?? null,
    }),
  },
  'deactivate-profile': {
    rpcName: 'deactivate_profile',
    fallbackError: 'Deactivate profile request failed.',
    mapBody: (body) => ({
      target_profile_id: body.profileId ?? null,
      reason: body.reason ?? null,
    }),
  },
  'list-managed-profiles': {
    rpcName: 'list_managed_profiles_page',
    fallbackError: 'List managed profiles request failed.',
    mapBody: (body) => ({
      section: body.section ?? null,
      page_limit: body.limit ?? null,
      page_offset: body.offset ?? null,
    }),
  },
  'reservation-call-log': {
    rpcName: 'create_reservation_call_log',
    fallbackError: 'Create reservation call log request failed.',
    mapBody: (body) => ({
      reservation_id: body.allocationId ?? body.reservationId ?? null,
      status: body.status ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'reject-registration': {
    rpcName: 'reject_registration',
    fallbackError: 'Reject registration request failed.',
    mapBody: (body) => ({
      target_profile_id: body.profileId ?? null,
      reason: body.reason ?? null,
    }),
  },
  'sync-offline-mutation': {
    rpcName: 'sync_offline_mutation',
    fallbackError: 'Sync offline mutation request failed.',
    mapBody: (body) => ({
      client_mutation_id: body.clientMutationId ?? null,
      operation_type: body.operationType ?? null,
      payload: body.payload ?? null,
    }),
  },
  'today-queue': {
    rpcName: 'get_today_call_list',
    fallbackError: 'Today queue request failed.',
    mapBody: (body) => {
      const cursor = getCursor(body)

      return {
        target_date: body.targetDate ?? null,
        page_size: body.pageSize ?? 25,
        cursor_queue_number: cursor.queue_number ?? null,
        cursor_id: cursor.id ?? null,
        plate_search: body.plateSearch ?? '',
        created_by_profile_id: body.createdByProfileId ?? null,
        call_filter: body.callFilter ?? 'all',
        gasoline_fuel_filter: body.gasolineFuelFilter ?? 'all',
        fuel_category_filter: body.fuelCategoryFilter ?? null,
      }
    },
  },
  'today-queue-authors': {
    rpcName: 'get_today_queue_authors',
    fallbackError: 'Today queue authors request failed.',
    mapBody: (body) => ({
      target_date: body.targetDate ?? null,
      plate_search: body.plateSearch ?? '',
      call_filter: body.callFilter ?? 'all',
      gasoline_fuel_filter: body.gasolineFuelFilter ?? 'all',
    }),
  },
  'update-reservation-fuel-preference': {
    rpcName: 'update_reservation_fuel_preference',
    fallbackError: 'Update reservation fuel preference request failed.',
    mapBody: (body) => ({
      reservation_id: body.reservationId ?? null,
      fuel_type: body.fuelType ?? null,
      fuel_preference_mode: body.fuelPreferenceMode ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'vehicle-fueling-history': {
    rpcName: 'get_vehicle_fueling_history',
    fallbackError: 'Vehicle fueling history request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
      page_limit: body.pageLimit ?? null,
      page_offset: body.pageOffset ?? null,
    }),
  },
  'vehicle-recent-fueling-history': {
    rpcName: 'get_vehicle_recent_fueling_history',
    fallbackError: 'Vehicle recent fueling history request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
    }),
  },
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function sendJson(response: ProtectedRpcResponse, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

export default function handler(request: ProtectedRpcRouterRequest, response: ProtectedRpcResponse) {
  const action = firstQueryValue(request.query?.action)
  const route = action ? protectedRpcRoutes[action] : undefined

  if (!route) {
    sendJson(response, 404, { error: 'Protected RPC action not found.' })
    return
  }

  return handleProtectedRpc(request, response, route)
}
