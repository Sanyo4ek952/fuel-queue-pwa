import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import type {
  FuelQueueCategory,
  FuelPreferenceMode,
  FuelType,
  ReservationCallStatus,
  ReservationStatus,
  SyncStatus,
} from '@/shared/constants'
import { getFuelQueueCategory } from '@/shared/constants'
import { supabase } from '@/shared/api/supabase'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { offlineDb, type LocalReservation } from '@/shared/lib/offline-db'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

type RelatedVehicle = {
  normalized_plate_number?: string | null
}

type RelatedDriver = {
  full_name?: string | null
  phone?: string | null
}

type RelatedProfile = {
  full_name?: string | null
  role?: string | null
  signature_name?: string | null
}

type ReservationRow = {
  id: string
  date?: string | null
  station_id?: string | null
  vehicle_id: string
  driver_id?: string | null
  operator_id: string
  fuel_type: string
  preferred_fuel_type?: string | null
  fuel_preference_mode?: string | null
  requested_liters: number | string
  queue_number: number
  ticket_number?: number | string | null
  current_position?: number | string | null
  people_ahead?: number | string | null
  status: string
  comment?: string | null
  client_mutation_id?: string | null
  sync_status?: string | null
  created_at?: string
  updated_at?: string
  is_within_today_limit?: boolean | null
  is_callable_now?: boolean | null
  call_unavailable_reason?: string | null
  matched_fuel_type?: string | null
  normalized_plate_number?: string | null
  driver_full_name?: string | null
  driver_phone?: string | null
  created_by_full_name?: string | null
  created_by_role?: string | null
  created_by_signature_name?: string | null
  latest_call_status?: string | null
  latest_called_by_profile_id?: string | null
  latest_called_by_full_name?: string | null
  latest_called_by_role?: string | null
  latest_called_by_signature_name?: string | null
  latest_called_at?: string | null
  latest_call_comment?: string | null
  latest_call_client_mutation_id?: string | null
  latest_call_sync_status?: string | null
  vehicles?: RelatedVehicle | RelatedVehicle[] | null
  drivers?: RelatedDriver | RelatedDriver[] | null
  operator?: RelatedProfile | RelatedProfile[] | null
}

export type TodayQueueRow = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  driver_id: string | null
  created_by_profile_id: string | null
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
  queue_number: number
  ticket_number: number
  current_position: number
  people_ahead: number
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType | string
  preferred_fuel_type?: FuelType | string
  fuel_preference_mode?: FuelPreferenceMode | string
  requested_liters: number
  status: ReservationStatus
  sync_status: SyncStatus
  comment: string | null
  client_mutation_id: string | null
  is_offline: boolean
  is_within_today_limit: boolean
  is_callable_now?: boolean
  call_unavailable_reason?: string | null
  matched_fuel_type?: FuelType | string | null
  latest_call_status: ReservationCallStatus | null
  latest_called_by_profile_id: string | null
  latest_called_by_full_name: string
  latest_called_by_role: UserRole | string | null
  latest_called_by_signature_name: string | null
  latest_called_at: string | null
  latest_call_comment: string | null
  latest_call_client_mutation_id: string | null
  latest_call_sync_status: SyncStatus | null
  updated_at?: string
}

type CancelledReservationRow = {
  id: string
  date?: string | null
  station_id?: string | null
  vehicle_id: string
  driver_id?: string | null
  fuel_type: string
  requested_liters: number | string
  queue_number: number
  status: string
  comment?: string | null
  cancelled_by?: string | null
  cancelled_at?: string | null
  cancel_reason?: string | null
  cancel_comment?: string | null
  created_at?: string | null
  updated_at?: string | null
  normalized_plate_number?: string | null
  driver_full_name?: string | null
  driver_phone?: string | null
  created_by_full_name?: string | null
  created_by_role?: string | null
  created_by_signature_name?: string | null
  cancelled_by_full_name?: string | null
  cancelled_by_role?: string | null
  cancelled_by_signature_name?: string | null
}

export type QueueCallFilter = 'all' | 'call' | 'contacted' | 'no_answer'
export type QueueGasolineFuelFilter = 'all' | 'AI_92' | 'AI_95' | 'AI_100'

export type TodayQueueCursor = {
  queue_number: number
  id: string
}

export type CancelledReservationsCursor = {
  cancelled_at: string
  id: string
}

export type TodayQueuePage = {
  rows: TodayQueueRow[]
  nextCursor: TodayQueueCursor | null
  summary: TodayQueueSummary
}

export type TodayQueueSummary = {
  total_count: number
  callable_count: number
  contacted_count: number
  no_answer_count: number
  category_counts: Record<FuelQueueCategory, number>
  callable_category_counts: Record<FuelQueueCategory, number>
}

export type CancelledReservationsPage = {
  rows: CancelledReservation[]
  nextCursor: CancelledReservationsCursor | null
}

type TodayQueuePageResponse = {
  rows?: ReservationRow[] | null
  next_cursor?: TodayQueueCursor | null
  summary?: Partial<TodayQueueSummary> | null
}

type CancelledReservationsPageResponse = {
  rows?: CancelledReservationRow[] | null
  next_cursor?: CancelledReservationsCursor | null
}

type QueueAuthorRow = {
  user_id?: string | null
  display_name?: string | null
  role?: string | null
  signature_name?: string | null
}

export type QueueAuthorOption = {
  userId: string
  displayName: string
  role: UserRole | string | null
  signatureName: string | null
}

export type CancelledReservation = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  driver_id: string | null
  fuel_type: FuelType | string
  requested_liters: number
  queue_number: number
  status: ReservationStatus
  comment: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  cancel_comment: string | null
  created_at: string | null
  updated_at: string | null
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
  cancelled_by_full_name: string
  cancelled_by_role: UserRole | string | null
  cancelled_by_signature_name: string | null
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toSafeNumber(value: unknown) {
  const numericValue = toNumber(value)

  return Number.isFinite(numericValue) ? numericValue : 0
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numericValue = toNumber(value)

  return Number.isFinite(numericValue) ? numericValue : null
}

function firstRelation<TRelation>(value: TRelation | TRelation[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function toTodayQueueRow(row: ReservationRow): TodayQueueRow {
  const vehicle = firstRelation(row.vehicles)
  const driver = firstRelation(row.drivers)
  const operator = firstRelation(row.operator)
  const ticketNumber = toNullableNumber(row.ticket_number) ?? toNumber(row.queue_number)
  const currentPosition = toNullableNumber(row.current_position)
  const peopleAhead = toNullableNumber(row.people_ahead)

  return {
    id: row.id,
    date: row.date ?? null,
    station_id: row.station_id ?? null,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    created_by_profile_id: row.operator_id,
    created_by_full_name: row.created_by_full_name ?? operator?.full_name ?? '',
    created_by_role: row.created_by_role ?? operator?.role ?? null,
    created_by_signature_name: row.created_by_signature_name ?? operator?.signature_name ?? null,
    queue_number: ticketNumber,
    ticket_number: ticketNumber,
    current_position: currentPosition ?? ticketNumber,
    people_ahead: peopleAhead ?? Math.max((currentPosition ?? ticketNumber) - 1, 0),
    normalized_plate_number: row.normalized_plate_number ?? vehicle?.normalized_plate_number ?? '',
    driver_full_name: row.driver_full_name ?? driver?.full_name ?? '',
    driver_phone: row.driver_phone ?? driver?.phone ?? null,
    fuel_type: row.fuel_type,
    preferred_fuel_type: row.preferred_fuel_type ?? row.fuel_type,
    fuel_preference_mode: row.fuel_preference_mode ?? 'EXACT',
    requested_liters: toNumber(row.requested_liters),
    status: row.status as ReservationStatus,
    sync_status: (row.sync_status ?? 'SYNCED') as SyncStatus,
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    is_offline: false,
    is_within_today_limit: Boolean(row.is_within_today_limit),
    is_callable_now: Boolean(row.is_callable_now ?? row.is_within_today_limit),
    call_unavailable_reason: row.call_unavailable_reason ?? null,
    matched_fuel_type: row.matched_fuel_type ?? null,
    latest_call_status: (row.latest_call_status ?? null) as ReservationCallStatus | null,
    latest_called_by_profile_id: row.latest_called_by_profile_id ?? null,
    latest_called_by_full_name: row.latest_called_by_full_name ?? '',
    latest_called_by_role: row.latest_called_by_role ?? null,
    latest_called_by_signature_name: row.latest_called_by_signature_name ?? null,
    latest_called_at: row.latest_called_at ?? null,
    latest_call_comment: row.latest_call_comment ?? null,
    latest_call_client_mutation_id: row.latest_call_client_mutation_id ?? null,
    latest_call_sync_status: (row.latest_call_sync_status ?? null) as SyncStatus | null,
    updated_at: row.updated_at,
  }
}

export function toTodayQueueRowFromLocal(row: LocalReservation): TodayQueueRow {
  const ticketNumber = row.ticket_number ?? row.queue_number
  const currentPosition = row.current_position ?? ticketNumber
  const peopleAhead = row.people_ahead ?? Math.max(currentPosition - 1, 0)

  return {
    id: row.id,
    date: row.date ?? null,
    station_id: row.station_id ?? null,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    created_by_profile_id: row.created_by_profile_id ?? null,
    created_by_full_name: row.created_by_full_name ?? '',
    created_by_role: row.created_by_role ?? null,
    created_by_signature_name: row.created_by_signature_name ?? null,
    queue_number: ticketNumber,
    ticket_number: ticketNumber,
    current_position: currentPosition,
    people_ahead: peopleAhead,
    normalized_plate_number: row.normalized_plate_number ?? '',
    driver_full_name: row.driver_full_name ?? '',
    driver_phone: row.driver_phone ?? null,
    fuel_type: row.fuel_type,
    preferred_fuel_type: row.fuel_type,
    fuel_preference_mode: row.fuel_preference_mode ?? 'EXACT',
    requested_liters: row.requested_liters,
    status: row.status as ReservationStatus,
    sync_status: row.sync_status ?? 'SYNCED',
    comment: row.comment ?? null,
    client_mutation_id: row.client_mutation_id ?? null,
    is_offline: row.sync_status !== 'SYNCED',
    is_within_today_limit: Boolean(row.is_within_today_limit),
    is_callable_now: Boolean(row.is_callable_now ?? row.is_within_today_limit),
    call_unavailable_reason: row.call_unavailable_reason ?? null,
    matched_fuel_type: row.matched_fuel_type ?? null,
    latest_call_status: row.latest_call_status ?? null,
    latest_called_by_profile_id: row.latest_called_by_profile_id ?? null,
    latest_called_by_full_name: row.latest_called_by_full_name ?? '',
    latest_called_by_role: row.latest_called_by_role ?? null,
    latest_called_by_signature_name: row.latest_called_by_signature_name ?? null,
    latest_called_at: row.latest_called_at ?? null,
    latest_call_comment: row.latest_call_comment ?? null,
    latest_call_client_mutation_id: row.latest_call_client_mutation_id ?? null,
    latest_call_sync_status: row.latest_call_sync_status ?? null,
    updated_at: row.updated_at,
  }
}

export function withCurrentQueuePositions(rows: TodayQueueRow[]) {
  const rowsByCategory = new Map<FuelQueueCategory | null, TodayQueueRow[]>()

  for (const row of rows) {
    const fuelCategory = getFuelQueueCategory(row.fuel_type)
    const categoryRows = rowsByCategory.get(fuelCategory) ?? []

    categoryRows.push(row)
    rowsByCategory.set(fuelCategory, categoryRows)
  }

  const positionsById = new Map<string, number>()

  for (const categoryRows of rowsByCategory.values()) {
    categoryRows
      .sort((left, right) => left.ticket_number - right.ticket_number || left.id.localeCompare(right.id))
      .forEach((row, index) => positionsById.set(row.id, index + 1))
  }

  return rows.map((row) => {
    const currentPosition = positionsById.get(row.id) ?? row.current_position

    return {
      ...row,
      current_position: currentPosition,
      people_ahead: Math.max(currentPosition - 1, 0),
    }
  })
}

function buildTodayQueueSummaryFromRows(rows: TodayQueueRow[]): TodayQueueSummary {
  return {
    total_count: rows.length,
    callable_count: rows.filter(
      (row) => Boolean(row.is_callable_now ?? row.is_within_today_limit) && row.latest_call_status !== 'CONTACTED',
    ).length,
    contacted_count: rows.filter((row) => row.latest_call_status === 'CONTACTED').length,
    no_answer_count: rows.filter((row) => row.latest_call_status === 'NO_ANSWER').length,
    category_counts: {
      GASOLINE: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === 'GASOLINE').length,
      DIESEL: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === 'DIESEL').length,
      GAS: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === 'GAS').length,
    },
    callable_category_counts: {
      GASOLINE: rows.filter(
        (row) =>
          Boolean(row.is_callable_now ?? row.is_within_today_limit) &&
          getFuelQueueCategory(row.fuel_type) === 'GASOLINE',
      ).length,
      DIESEL: rows.filter(
        (row) =>
          Boolean(row.is_callable_now ?? row.is_within_today_limit) &&
          getFuelQueueCategory(row.fuel_type) === 'DIESEL',
      ).length,
      GAS: rows.filter(
        (row) =>
          Boolean(row.is_callable_now ?? row.is_within_today_limit) &&
          getFuelQueueCategory(row.fuel_type) === 'GAS',
      ).length,
    },
  }
}

function parseTodayQueueSummary(
  value: TodayQueuePageResponse['summary'],
  fallbackRows: TodayQueueRow[],
): TodayQueueSummary {
  const fallback = buildTodayQueueSummaryFromRows(fallbackRows)

  if (!value || typeof value !== 'object') {
    return fallback
  }

  const categoryCounts =
    value.category_counts && typeof value.category_counts === 'object'
      ? (value.category_counts as Partial<Record<FuelQueueCategory, unknown>>)
      : {}
  const callableCategoryCounts =
    value.callable_category_counts && typeof value.callable_category_counts === 'object'
      ? (value.callable_category_counts as Partial<Record<FuelQueueCategory, unknown>>)
      : {}

  return {
    total_count: toSafeNumber(value.total_count ?? fallback.total_count),
    callable_count: toSafeNumber(value.callable_count ?? fallback.callable_count),
    contacted_count: toSafeNumber(value.contacted_count ?? fallback.contacted_count),
    no_answer_count: toSafeNumber(value.no_answer_count ?? fallback.no_answer_count),
    category_counts: {
      GASOLINE: toSafeNumber(categoryCounts.GASOLINE ?? fallback.category_counts.GASOLINE),
      DIESEL: toSafeNumber(categoryCounts.DIESEL ?? fallback.category_counts.DIESEL),
      GAS: toSafeNumber(categoryCounts.GAS ?? fallback.category_counts.GAS),
    },
    callable_category_counts: {
      GASOLINE: toSafeNumber(
        callableCategoryCounts.GASOLINE ?? fallback.callable_category_counts.GASOLINE,
      ),
      DIESEL: toSafeNumber(
        callableCategoryCounts.DIESEL ?? fallback.callable_category_counts.DIESEL,
      ),
      GAS: toSafeNumber(callableCategoryCounts.GAS ?? fallback.callable_category_counts.GAS),
    },
  }
}

function toCancelledReservation(row: CancelledReservationRow): CancelledReservation {
  return {
    id: row.id,
    date: row.date ?? null,
    station_id: row.station_id ?? null,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id ?? null,
    fuel_type: row.fuel_type,
    requested_liters: toNumber(row.requested_liters),
    queue_number: toNumber(row.queue_number),
    status: row.status as ReservationStatus,
    comment: row.comment ?? null,
    cancelled_by: row.cancelled_by ?? null,
    cancelled_at: row.cancelled_at ?? null,
    cancel_reason: row.cancel_reason ?? null,
    cancel_comment: row.cancel_comment ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    normalized_plate_number: row.normalized_plate_number ?? '',
    driver_full_name: row.driver_full_name ?? '',
    driver_phone: row.driver_phone ?? null,
    created_by_full_name: row.created_by_full_name ?? '',
    created_by_role: row.created_by_role ?? null,
    created_by_signature_name: row.created_by_signature_name ?? null,
    cancelled_by_full_name: row.cancelled_by_full_name ?? '',
    cancelled_by_role: row.cancelled_by_role ?? null,
    cancelled_by_signature_name: row.cancelled_by_signature_name ?? null,
  }
}

function parseTodayQueuePage(data: unknown): TodayQueuePage {
  const page = data && typeof data === 'object' ? (data as TodayQueuePageResponse) : null
  const rows = Array.isArray(page?.rows) ? page.rows.map(toTodayQueueRow) : []

  return {
    rows,
    nextCursor: page?.next_cursor ?? null,
    summary: parseTodayQueueSummary(page?.summary, rows),
  }
}

function parseCancelledReservationsPage(data: unknown): CancelledReservationsPage {
  const page = data && typeof data === 'object' ? (data as CancelledReservationsPageResponse) : null
  const rows = Array.isArray(page?.rows) ? page.rows.map(toCancelledReservation) : []

  return {
    rows,
    nextCursor: page?.next_cursor ?? null,
  }
}

function toQueueAuthorOption(row: QueueAuthorRow): QueueAuthorOption | null {
  if (!row.user_id) {
    return null
  }

  return {
    userId: row.user_id,
    displayName: row.display_name ?? 'Автор не указан',
    role: row.role ?? null,
    signatureName: row.signature_name ?? null,
  }
}

export async function listTodayQueueRowsPage(params: {
  pageSize?: number
  cursor?: TodayQueueCursor | null
  plateSearch?: string
  createdByProfileId?: string | null
  callFilter?: QueueCallFilter
  gasolineFuelFilter?: QueueGasolineFuelFilter
  fuelCategoryFilter?: FuelQueueCategory | null
} = {}): Promise<TodayQueuePage> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const policyResult = await supabase.rpc('apply_reservation_no_show_policy')

  if (policyResult.error) {
    throw new Error(policyResult.error.message)
  }

  const { data, error } = await supabase.rpc('get_today_call_list', {
    target_date: getTodayDateInputValue(),
    page_size: params.pageSize ?? 25,
    cursor_queue_number: params.cursor?.queue_number ?? null,
    cursor_id: params.cursor?.id ?? null,
    plate_search: normalizePlateNumber(params.plateSearch ?? ''),
    created_by_profile_id: params.createdByProfileId ?? null,
    call_filter: params.callFilter ?? 'all',
    gasoline_fuel_filter: params.gasolineFuelFilter ?? 'all',
    fuel_category_filter: params.fuelCategoryFilter ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return parseTodayQueuePage(data)
}

export async function listTodayQueueRows() {
  const page = await listTodayQueueRowsPage()

  return withCurrentQueuePositions(page.rows)
}

export async function listTodayQueueAuthors(params: {
  plateSearch?: string
  callFilter?: QueueCallFilter
  gasolineFuelFilter?: QueueGasolineFuelFilter
} = {}): Promise<QueueAuthorOption[]> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.rpc('get_today_queue_authors', {
    target_date: getTodayDateInputValue(),
    plate_search: normalizePlateNumber(params.plateSearch ?? ''),
    call_filter: params.callFilter ?? 'all',
    gasoline_fuel_filter: params.gasolineFuelFilter ?? 'all',
  })

  if (error) {
    throw new Error(error.message)
  }

  return (Array.isArray(data) ? (data as QueueAuthorRow[]) : [])
    .map(toQueueAuthorOption)
    .filter((option): option is QueueAuthorOption => option !== null)
}

export async function listCancelledReservationsPage(params: {
  pageSize?: number
  cursor?: CancelledReservationsCursor | null
  plateSearch?: string
  dateFrom?: string | null
  dateTo?: string | null
} = {}): Promise<CancelledReservationsPage> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.rpc('get_cancelled_reservations', {
    page_size: params.pageSize ?? 25,
    cursor_cancelled_at: params.cursor?.cancelled_at ?? null,
    cursor_id: params.cursor?.id ?? null,
    plate_search: normalizePlateNumber(params.plateSearch ?? ''),
    date_from: params.dateFrom ?? null,
    date_to: params.dateTo ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return parseCancelledReservationsPage(data)
}

export async function listCancelledReservations(params: {
  plateSearch?: string
} = {}): Promise<CancelledReservation[]> {
  const page = await listCancelledReservationsPage(params)

  return page.rows
}

export async function cacheTodayQueueRows(rows: TodayQueueRow[]) {
  await offlineDb.local_reservations.bulkPut(
    rows.map(
      (row): LocalReservation => ({
        id: row.id,
        date: row.date,
        station_id: row.station_id,
        vehicle_id: row.vehicle_id,
        driver_id: row.driver_id,
        created_by_profile_id: row.created_by_profile_id,
        created_by_full_name: row.created_by_full_name,
        created_by_role: row.created_by_role,
        created_by_signature_name: row.created_by_signature_name,
        fuel_type: row.fuel_type,
        fuel_preference_mode: row.fuel_preference_mode,
        requested_liters: row.requested_liters,
        queue_number: row.queue_number,
        ticket_number: row.ticket_number,
        current_position: row.current_position,
        people_ahead: row.people_ahead,
        status: row.status,
        normalized_plate_number: row.normalized_plate_number,
        driver_full_name: row.driver_full_name,
        driver_phone: row.driver_phone,
        comment: row.comment,
        client_mutation_id: row.client_mutation_id,
        sync_status: row.sync_status,
        is_within_today_limit: row.is_within_today_limit,
        is_callable_now: row.is_callable_now,
        call_unavailable_reason: row.call_unavailable_reason,
        matched_fuel_type: row.matched_fuel_type,
        latest_call_status: row.latest_call_status,
        latest_called_by_profile_id: row.latest_called_by_profile_id,
        latest_called_by_full_name: row.latest_called_by_full_name,
        latest_called_by_role: row.latest_called_by_role,
        latest_called_by_signature_name: row.latest_called_by_signature_name,
        latest_called_at: row.latest_called_at,
        latest_call_comment: row.latest_call_comment,
        latest_call_client_mutation_id: row.latest_call_client_mutation_id,
        latest_call_sync_status: row.latest_call_sync_status,
        updated_at: row.updated_at,
      }),
    ),
  )
}
