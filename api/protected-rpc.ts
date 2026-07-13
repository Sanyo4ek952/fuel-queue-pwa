import {
  handleProtectedRpc,
  fetchWithTimeout,
  getSupabaseErrorMessage,
  readBody,
  sendJson,
  type ProtectedRpcRequest,
  type ProtectedRpcResponse,
} from './_lib/protected-rpc.js'
import {
  AuthSessionError,
  assertSameOriginRequest,
  getServerAuthSession,
  getSupabaseConfig,
} from './_lib/auth-session.js'

type ProtectedRpcRouterRequest = ProtectedRpcRequest & {
  query?: Record<string, string | string[] | undefined>
}

type ProtectedRpcRoute = {
  rpcName: string
  fallbackError: string
  mapBody: (body: Record<string, unknown>) => Record<string, unknown>
}

type ProtectedCustomRoute =
  | {
      kind: 'active-preferential-queues'
      fallbackError: string
    }
  | {
      kind: 'vehicle-access-cache'
      fallbackError: string
    }

function getCursor(body: Record<string, unknown>) {
  const cursor = body.cursor

  return cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>) : {}
}

const protectedRpcRoutes: Record<string, ProtectedRpcRoute | ProtectedCustomRoute> = {
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
  'cancel-my-reservation': {
    rpcName: 'cancel_my_reservation',
    fallbackError: 'Cancel my reservation request failed.',
    mapBody: (body) => ({
      reservation_id: body.reservationId ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'cancel-preferential-queue-entry': {
    rpcName: 'cancel_preferential_queue_entry',
    fallbackError: 'Cancel preferential queue entry request failed.',
    mapBody: (body) => ({
      entry_id: body.entryId ?? null,
      comment: body.comment ?? null,
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
  'complete-consumer-profile': {
    rpcName: 'complete_consumer_profile',
    fallbackError: 'Complete consumer profile request failed.',
    mapBody: (body) => ({
      p_first_name: body.firstName ?? null,
      p_last_name: body.lastName ?? null,
      p_middle_name: body.middleName ?? null,
      p_phone: body.phone ?? null,
    }),
  },
  'create-consumer-reservation': {
    rpcName: 'create_consumer_reservation',
    fallbackError: 'Create consumer reservation request failed.',
    mapBody: (body) => ({
      vehicle_id: body.vehicleId ?? null,
      driver_full_name: body.driverFullName ?? null,
      driver_phone: body.driverPhone ?? null,
      fuel_type: body.fuelType ?? null,
      fuel_preference_mode: body.fuelPreferenceMode ?? 'EXACT',
      requested_liters: body.requestedLiters ?? 20,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-consumer-vehicle': {
    rpcName: 'create_consumer_vehicle',
    fallbackError: 'Create consumer vehicle request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-daily-limit': {
    rpcName: 'create_daily_limit',
    fallbackError: 'Create daily limit request failed.',
    mapBody: (body) => ({
      target_date: body.targetDate ?? null,
      target_station_id: body.stationId ?? null,
      fuel_type_limits: body.fuelTypeLimits ?? [],
      client_mutation_id: body.clientMutationId ?? null,
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
  'create-manual-override': {
    rpcName: 'create_manual_override',
    fallbackError: 'Create manual override request failed.',
    mapBody: (body) => ({
      target_date: body.targetDate ?? null,
      target_station_id: body.stationId ?? null,
      plate_number: body.plateNumber ?? null,
      reason: body.reason ?? null,
      expires_at: body.expiresAt ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-personal-vehicle-liter-limit': {
    rpcName: 'create_personal_vehicle_liter_limit',
    fallbackError: 'Create personal vehicle liter limit request failed.',
    mapBody: (body) => ({
      target_date: body.targetDate ?? null,
      plate_number: body.plateNumber ?? null,
      liters: body.liters ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-reservation': {
    rpcName: 'create_reservation',
    fallbackError: 'Create reservation request failed.',
    mapBody: (body) => ({
      plate_number: body.plateNumber ?? null,
      driver_full_name: body.driverFullName ?? null,
      driver_phone: body.driverPhone ?? null,
      fuel_type: body.fuelType ?? null,
      fuel_preference_mode: body.fuelPreferenceMode ?? 'EXACT',
      requested_liters: body.requestedLiters ?? null,
      comment: body.comment ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-preferential-queue': {
    rpcName: 'create_preferential_queue',
    fallbackError: 'Create preferential queue request failed.',
    mapBody: (body) => ({
      name: body.name ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'create-preferential-queue-entry': {
    rpcName: 'create_preferential_queue_entry',
    fallbackError: 'Create preferential queue entry request failed.',
    mapBody: (body) => ({
      queue_id: body.queueId ?? null,
      plate_number: body.plateNumber ?? null,
      driver_full_name: body.driverFullName ?? null,
      driver_phone: body.driverPhone ?? null,
      fuel_type: body.fuelType ?? null,
      requested_liters: body.requestedLiters ?? null,
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
  'get-my-queue-status': {
    rpcName: 'get_my_queue_status',
    fallbackError: 'Get my queue status request failed.',
    mapBody: () => ({}),
  },
  'get-my-today-fueling-status': {
    rpcName: 'get_my_today_fueling_status',
    fallbackError: 'Get my today fueling status request failed.',
    mapBody: () => ({}),
  },
  'get-cancelled-reservations': {
    rpcName: 'get_cancelled_reservations',
    fallbackError: 'Cancelled reservations request failed.',
    mapBody: (body) => {
      const cursor = getCursor(body)

      return {
        page_size: body.pageSize ?? 25,
        cursor_cancelled_at: cursor.cancelled_at ?? null,
        cursor_id: cursor.id ?? null,
        plate_search: body.plateSearch ?? '',
        date_from: body.dateFrom ?? null,
        date_to: body.dateTo ?? null,
      }
    },
  },
  'get-daily-fueling-schedule': {
    rpcName: 'get_daily_fueling_schedule',
    fallbackError: 'Daily fueling schedule request failed.',
    mapBody: (body) => ({
      target_date: body.targetDate ?? null,
      target_station_id: body.stationId ?? null,
    }),
  },
  'get-fueling-report': {
    rpcName: 'get_fueling_report',
    fallbackError: 'Fueling report request failed.',
    mapBody: (body) => ({
      date_from: body.dateFrom ?? null,
      date_to: body.dateTo ?? null,
      station_ids: body.stationIds ?? null,
    }),
  },
  'get-no-show-grace': {
    rpcName: 'get_reservation_no_show_grace_days',
    fallbackError: 'No-show grace request failed.',
    mapBody: () => ({}),
  },
  'get-refuel-cooldown': {
    rpcName: 'get_reservation_refuel_cooldown',
    fallbackError: 'Refuel cooldown request failed.',
    mapBody: () => ({}),
  },
  'list-active-preferential-queues': {
    kind: 'active-preferential-queues',
    fallbackError: 'List active preferential queues request failed.',
  },
  'list-my-vehicles': {
    rpcName: 'list_my_vehicles',
    fallbackError: 'List my vehicles request failed.',
    mapBody: () => ({}),
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
  'resident-fuel-norm': {
    rpcName: 'get_resident_fuel_norm_liters',
    fallbackError: 'Resident fuel norm request failed.',
    mapBody: () => ({}),
  },
  'record-personal-data-consent': {
    rpcName: 'record_personal_data_consent',
    fallbackError: 'Record personal data consent request failed.',
    mapBody: (body) => ({
      p_document_version: body.documentVersion ?? null,
      p_document_hash: body.documentHash ?? null,
      p_accepted_at: body.acceptedAt ?? null,
      p_source: body.source ?? null,
      p_registration_role: body.registrationRole ?? null,
      p_user_agent: body.userAgent ?? null,
    }),
  },
  'set-daily-fueling-schedule': {
    rpcName: 'set_daily_fueling_schedule',
    fallbackError: 'Set daily fueling schedule request failed.',
    mapBody: (body) => ({
      target_date: body.targetDate ?? null,
      target_station_id: body.stationId ?? null,
      schedules: body.schedules ?? [],
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'set-no-show-grace': {
    rpcName: 'set_reservation_no_show_grace_days',
    fallbackError: 'Set no-show grace request failed.',
    mapBody: (body) => ({
      days: body.days ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'set-refuel-cooldown': {
    rpcName: 'set_reservation_refuel_cooldown',
    fallbackError: 'Set refuel cooldown request failed.',
    mapBody: (body) => ({
      days: body.days ?? null,
      client_mutation_id: body.clientMutationId ?? null,
    }),
  },
  'set-resident-fuel-norm': {
    rpcName: 'set_resident_fuel_norm_liters',
    fallbackError: 'Set resident fuel norm request failed.',
    mapBody: (body) => ({
      liters: body.liters ?? null,
      client_mutation_id: body.clientMutationId ?? null,
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
  'unlink-my-vehicle': {
    rpcName: 'unlink_my_vehicle',
    fallbackError: 'Unlink my vehicle request failed.',
    mapBody: (body) => ({
      profile_vehicle_id: body.profileVehicleId ?? null,
      client_mutation_id: body.clientMutationId ?? null,
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
  'vehicle-access-cache': {
    kind: 'vehicle-access-cache',
    fallbackError: 'Vehicle access cache request failed.',
  },
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function isRpcRoute(route: ProtectedRpcRoute | ProtectedCustomRoute): route is ProtectedRpcRoute {
  return 'rpcName' in route
}

async function fetchSupabaseJson(
  url: string,
  {
    anonKey,
    accessToken,
    fallbackError,
    init,
  }: {
    anonKey: string
    accessToken: string
    fallbackError: string
    init?: RequestInit
  },
) {
  const supabaseResponse = await fetchWithTimeout(url, {
    ...init,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  })
  const body = await supabaseResponse.json().catch(() => null)

  if (!supabaseResponse.ok) {
    throw new AuthSessionError(getSupabaseErrorMessage(body, fallbackError), supabaseResponse.status)
  }

  return body
}

async function handleActivePreferentialQueues(
  request: ProtectedRpcRequest,
  response: ProtectedRpcResponse,
  fallbackError: string,
) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  try {
    assertSameOriginRequest(request)
    const session = await getServerAuthSession({
      request,
      response,
      config: { url, anonKey },
      verifyUser: false,
    })
    const query = new URL(`${url}/rest/v1/preferential_queues`)

    query.searchParams.set(
      'select',
      'id,name,status,created_by,client_mutation_id,created_at,updated_at,created_by_profile:profiles!preferential_queues_created_by_fkey(full_name,role,signature_name),entries:preferential_queue_entries(id,queue_id,vehicle_id,driver_id,fuel_type,requested_liters,status,comment,client_mutation_id,created_at,updated_at,vehicles(normalized_plate_number),drivers(full_name,phone),created_by_profile:profiles!preferential_queue_entries_created_by_fkey(full_name,role,signature_name))',
    )
    query.searchParams.set('status', 'eq.ACTIVE')
    query.searchParams.set('entries.status', 'eq.ACTIVE')
    query.searchParams.set('order', 'created_at.asc')

    const body = await fetchSupabaseJson(query.toString(), {
      anonKey,
      accessToken: session.accessToken,
      fallbackError,
    })

    sendJson(response, 200, body)
  } catch (error) {
    if (error instanceof AuthSessionError) {
      sendJson(response, error.statusCode, { error: error.message })
      return
    }

    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : fallbackError,
    })
  }
}

async function handleVehicleAccessCache(
  request: ProtectedRpcRequest,
  response: ProtectedRpcResponse,
  fallbackError: string,
) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  try {
    assertSameOriginRequest(request)
    const session = await getServerAuthSession({
      request,
      response,
      config: { url, anonKey },
      verifyUser: false,
    })
    const body = await readBody(request)
    const checkDate = typeof body.checkDate === 'string' ? body.checkDate : ''
    const headers = {
      apikey: anonKey,
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
    }
    const rest = (table: string) => new URL(`${url}/rest/v1/${table}`)
    const stationsQuery = rest('stations')
    stationsQuery.searchParams.set('select', 'id,name,address,is_active,updated_at')
    stationsQuery.searchParams.set('is_active', 'eq.true')
    const vehiclesQuery = rest('vehicles')
    vehiclesQuery.searchParams.set('select', 'id,normalized_plate_number,is_blocked,block_reason,updated_at')
    const queueEntriesQuery = rest('fuel_queue_entries')
    queueEntriesQuery.searchParams.set(
      'select',
      'id,permanent_number,vehicle_id,driver_id,status,preferred_fuel_type,fuel_preference_mode,requested_liters,comment,client_mutation_id,sync_status,created_at,updated_at,vehicles(normalized_plate_number),drivers(full_name,phone)',
    )
    queueEntriesQuery.searchParams.set('status', 'eq.WAITING')
    const allocationsQuery = rest('daily_queue_allocations')
    allocationsQuery.searchParams.set('select', 'id,queue_entry_id,allocation_date,station_id,assigned_fuel_type,allocated_liters,daily_position,station_position,station_fuel_position,arrival_at,status,call_status,updated_at')
    allocationsQuery.searchParams.set('allocation_date', `eq.${checkDate}`)
    const fuelingRecordsQuery = rest('fueling_records')
    fuelingRecordsQuery.searchParams.set('select', 'id,station_id,vehicle_id,date,fueled_at,is_manual_override,updated_at')
    fuelingRecordsQuery.searchParams.set('order', 'fueled_at.desc')
    fuelingRecordsQuery.searchParams.set('limit', '500')
    const manualOverridesQuery = rest('manual_overrides')
    manualOverridesQuery.searchParams.set(
      'select',
      'id,station_id,vehicle_id,date,reason,approved_by,used_at,expires_at,client_mutation_id,sync_status,updated_at',
    )
    manualOverridesQuery.searchParams.set('date', `eq.${checkDate}`)

    const rpc = (name: string, rpcBody: unknown) =>
      fetchSupabaseJson(`${url}/rest/v1/rpc/${name}`, {
        anonKey,
        accessToken: session.accessToken,
        fallbackError,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify(rpcBody),
        },
      })

    const [
      stations,
      vehicles,
      queueEntries,
      allocations,
      fuelingRecords,
      manualOverrides,
      dailyLimitOverview,
      refuelCooldown,
      noShowGrace,
    ] = await Promise.all([
      fetchSupabaseJson(stationsQuery.toString(), { anonKey, accessToken: session.accessToken, fallbackError }),
      fetchSupabaseJson(vehiclesQuery.toString(), { anonKey, accessToken: session.accessToken, fallbackError }),
      fetchSupabaseJson(queueEntriesQuery.toString(), { anonKey, accessToken: session.accessToken, fallbackError }),
      fetchSupabaseJson(allocationsQuery.toString(), { anonKey, accessToken: session.accessToken, fallbackError }),
      fetchSupabaseJson(fuelingRecordsQuery.toString(), { anonKey, accessToken: session.accessToken, fallbackError }),
      fetchSupabaseJson(manualOverridesQuery.toString(), { anonKey, accessToken: session.accessToken, fallbackError }),
      rpc('get_daily_limit_overview', { target_date: checkDate }),
      rpc('get_reservation_refuel_cooldown', {}),
      rpc('get_reservation_no_show_grace_days', {}),
    ])

    sendJson(response, 200, {
      stations,
      vehicles,
      queueEntries,
      allocations,
      fuelingRecords,
      manualOverrides,
      dailyLimitOverview,
      refuelCooldown,
      noShowGrace,
    })
  } catch (error) {
    if (error instanceof AuthSessionError) {
      sendJson(response, error.statusCode, { error: error.message })
      return
    }

    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : fallbackError,
    })
  }
}

export default function handler(request: ProtectedRpcRouterRequest, response: ProtectedRpcResponse) {
  const action = firstQueryValue(request.query?.action)
  const route = action ? protectedRpcRoutes[action] : undefined

  if (!route) {
    sendJson(response, 404, { error: 'Protected RPC action not found.' })
    return
  }

  if (!isRpcRoute(route)) {
    return route.kind === 'active-preferential-queues'
      ? handleActivePreferentialQueues(request, response, route.fallbackError)
      : handleVehicleAccessCache(request, response, route.fallbackError)
  }

  return handleProtectedRpc(request, response, route)
}
