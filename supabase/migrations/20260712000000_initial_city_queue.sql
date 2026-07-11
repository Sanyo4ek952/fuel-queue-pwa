


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";



CREATE OR REPLACE FUNCTION "public"."allocate_daily_queue"("target_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  candidate record;
  picked record;
  current_daily_position integer;
  current_station_position integer;
  current_station_fuel_position integer;
  computed_arrival_at timestamptz;
  active_count integer := 0;
  paused_count integer := 0;
begin
  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('allocate_daily_queue:' || target_date::text, 0));

  create temporary table if not exists queue_allocation_capacity (
    station_id uuid,
    fuel_type text,
    vehicle_limit integer,
    liters_limit numeric,
    vehicle_used integer,
    liters_used numeric,
    start_time time,
    interval_minutes integer,
    vehicles_per_interval integer,
    allocation_order integer,
    primary key (station_id, fuel_type)
  ) on commit drop;
  truncate table queue_allocation_capacity;

  insert into queue_allocation_capacity (
    station_id, fuel_type, vehicle_limit, liters_limit, vehicle_used, liters_used,
    start_time, interval_minutes, vehicles_per_interval, allocation_order
  )
  select
    dl.station_id,
    dftl.fuel_type,
    coalesce(dftl.vehicle_limit, 0),
    dftl.liters_limit,
    0,
    0,
    dfs.start_time,
    dfs.interval_minutes,
    dfs.vehicles_per_interval,
    s.allocation_order
  from public.daily_limits dl
  join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = dl.id
  join public.stations s on s.id = dl.station_id and s.is_active
  join public.daily_fueling_schedules dfs
    on dfs.date = dl.date
   and dfs.station_id = dl.station_id
   and dfs.fuel_category = public.get_fuel_queue_category(dftl.fuel_type)
  where dl.date = target_date
    and dl.status = 'OPEN'
    and dftl.status = 'OPEN'
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    and coalesce(dftl.vehicle_limit, 0) > 0;

  update queue_allocation_capacity capacity
  set vehicle_used = usage.vehicle_used,
      liters_used = usage.liters_used
  from (
    select
      dqa.station_id,
      dqa.assigned_fuel_type,
      count(*)::integer as vehicle_used,
      coalesce(sum(coalesce(fr.liters, dqa.allocated_liters)), 0)::numeric as liters_used
    from public.daily_queue_allocations dqa
    left join public.fueling_records fr on fr.allocation_id = dqa.id
    where dqa.allocation_date = target_date
      and dqa.status = 'FUELED'
    group by dqa.station_id, dqa.assigned_fuel_type
  ) usage
  where capacity.station_id = usage.station_id
    and capacity.fuel_type = usage.assigned_fuel_type;

  update public.daily_queue_allocations
  set status = 'PAUSED_BY_LIMIT',
      paused_at = now(),
      paused_reason = 'LIMIT_REALLOCATION'
  where allocation_date = target_date
    and status = 'ACTIVE';

  select coalesce(max(daily_position), 0)
  into current_daily_position
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'FUELED';

  create temporary table if not exists queue_station_positions (
    station_id uuid,
    fuel_category text,
    station_position integer,
    station_fuel_position integer,
    primary key (station_id, fuel_category)
  ) on commit drop;
  truncate table queue_station_positions;

  insert into queue_station_positions (station_id, fuel_category, station_position, station_fuel_position)
  select
    station_id,
    public.get_fuel_queue_category(assigned_fuel_type),
    max(station_position),
    max(station_fuel_position)
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'FUELED'
  group by station_id, public.get_fuel_queue_category(assigned_fuel_type);

  for candidate in
    with candidates as (
      select
        fqe.*,
        case when dqa.id is not null then 0 else 1 end as priority,
        dqa.id as allocation_id
      from public.fuel_queue_entries fqe
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = target_date
       and dqa.status = 'PAUSED_BY_LIMIT'
      where fqe.status = 'WAITING'
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = target_date
            and coalesce(fr.is_manual_override, false) = false
        )
    )
    select *
    from candidates
    order by priority, permanent_number, id
  loop
    select
      capacity.*,
      compatible.ordinality
    into picked
    from unnest(public.get_compatible_fuel_types(
      candidate.preferred_fuel_type,
      candidate.fuel_preference_mode
    )) with ordinality compatible(fuel_type, ordinality)
    join queue_allocation_capacity capacity on capacity.fuel_type = compatible.fuel_type
    where capacity.vehicle_used < capacity.vehicle_limit
      and (
        capacity.liters_limit is null
        or capacity.liters_used + candidate.requested_liters <= capacity.liters_limit
      )
    order by
      compatible.ordinality,
      least(
        capacity.vehicle_limit - capacity.vehicle_used,
        case
          when capacity.liters_limit is null then capacity.vehicle_limit - capacity.vehicle_used
          else floor((capacity.liters_limit - capacity.liters_used) / candidate.requested_liters)::integer
        end
      ) desc,
      capacity.allocation_order,
      capacity.station_id
    limit 1;

    if picked.station_id is null then
      if candidate.allocation_id is not null then
        paused_count := paused_count + 1;
      end if;
      continue;
    end if;

    current_daily_position := current_daily_position + 1;

    select
      coalesce(max(station_position), 0) + 1,
      coalesce(max(station_fuel_position), 0) + 1
    into current_station_position, current_station_fuel_position
    from queue_station_positions
    where station_id = picked.station_id
      and fuel_category = public.get_fuel_queue_category(picked.fuel_type);

    insert into queue_station_positions (station_id, fuel_category, station_position, station_fuel_position)
    values (
      picked.station_id,
      public.get_fuel_queue_category(picked.fuel_type),
      current_station_position,
      current_station_fuel_position
    )
    on conflict (station_id, fuel_category) do update
    set station_position = excluded.station_position,
        station_fuel_position = excluded.station_fuel_position;

    computed_arrival_at :=
      ((target_date + picked.start_time) at time zone 'Europe/Moscow')
      + make_interval(mins => (
          floor((current_station_fuel_position - 1)::numeric / picked.vehicles_per_interval)::integer
          * picked.interval_minutes
        ));

    insert into public.daily_queue_allocations (
      allocation_date,
      queue_entry_id,
      station_id,
      assigned_fuel_type,
      allocated_liters,
      daily_position,
      station_position,
      station_fuel_position,
      arrival_at,
      status,
      call_status,
      paused_at,
      paused_reason
    )
    values (
      target_date,
      candidate.id,
      picked.station_id,
      picked.fuel_type,
      candidate.requested_liters,
      current_daily_position,
      current_station_position,
      current_station_fuel_position,
      computed_arrival_at,
      'ACTIVE',
      'NOT_CALLED',
      null,
      null
    )
    on conflict (allocation_date, queue_entry_id) do update
    set station_id = excluded.station_id,
        assigned_fuel_type = excluded.assigned_fuel_type,
        allocated_liters = excluded.allocated_liters,
        daily_position = excluded.daily_position,
        station_position = excluded.station_position,
        station_fuel_position = excluded.station_fuel_position,
        arrival_at = excluded.arrival_at,
        status = 'ACTIVE',
        paused_at = null,
        paused_reason = null;

    update queue_allocation_capacity
    set vehicle_used = vehicle_used + 1,
        liters_used = liters_used + candidate.requested_liters
    where station_id = picked.station_id
      and fuel_type = picked.fuel_type;

    active_count := active_count + 1;
    picked := null;
  end loop;

  select count(*)::integer
  into paused_count
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'PAUSED_BY_LIMIT';

  return jsonb_build_object(
    'date', target_date,
    'active_count', active_count,
    'paused_count', paused_count
  );
end;
$$;


ALTER FUNCTION "public"."allocate_daily_queue"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_registration"("target_profile_id" "uuid", "target_role" "text", "target_station_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  actor_profile_id uuid;
  actor_role text;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
  assigned_station_id uuid;
begin
  actor_profile_id := public.get_current_profile_id();
  actor_role := public.get_current_user_role();
  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'pending' then
    raise exception 'PROFILE_NOT_PENDING';
  end if;

  if old_profile.role not in ('cashier', 'mayor_assistant') then
    raise exception 'INVALID_ROLE';
  end if;

  if target_role <> old_profile.role then
    raise exception 'ROLE_CHANGE_DENIED';
  end if;

  if old_profile.role = 'cashier' then
    if target_station_ids is null or cardinality(target_station_ids) = 0 then
      raise exception 'STATIONS_REQUIRED';
    end if;

    foreach assigned_station_id in array target_station_ids loop
      if actor_role <> 'mayor' and not public.can_access_station(assigned_station_id) then
        raise exception 'STATION_ACCESS_DENIED';
      end if;
    end loop;
  end if;

  if old_profile.role = 'mayor_assistant' and actor_role <> 'mayor' then
    raise exception 'ROLE_ASSIGNMENT_DENIED';
  end if;

  update public.profiles
  set role = old_profile.role,
      is_active = true,
      approval_status = 'approved',
      approved_by = actor_profile_id,
      approved_at = now(),
      rejected_by = null,
      rejected_at = null,
      rejection_reason = null,
      deactivated_by = null,
      deactivated_at = null,
      deactivation_reason = null
  where id = target_profile_id
  returning * into saved_profile;

  delete from public.user_stations
  where user_id = target_profile_id;

  if old_profile.role = 'cashier' then
    foreach assigned_station_id in array target_station_ids loop
      insert into public.user_stations (user_id, station_id)
      values (target_profile_id, assigned_station_id)
      on conflict (user_id, station_id) do nothing;
    end loop;
  end if;

  perform public.audit_action(
    'APPROVE_REGISTRATION',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'role', saved_profile.role,
    'is_active', saved_profile.is_active,
    'approved_by', saved_profile.approved_by,
    'approved_at', saved_profile.approved_at
  );
end;
$$;


ALTER FUNCTION "public"."approve_registration"("target_profile_id" "uuid", "target_role" "text", "target_station_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_action"("action" "text", "entity_type" "text", "entity_id" "uuid" DEFAULT NULL::"uuid", "old_value" "jsonb" DEFAULT NULL::"jsonb", "new_value" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
  values (public.get_current_profile_id(), action, entity_type, entity_id, old_value, new_value);
end;
$$;


ALTER FUNCTION "public"."audit_action"("action" "text", "entity_type" "text", "entity_id" "uuid", "old_value" "jsonb", "new_value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_station"("target_station_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.get_current_user_role() in ('mayor', 'mayor_assistant'), false)
    or exists (
      select 1
      from public.user_stations us
      where us.user_id = public.get_current_profile_id()
        and us.station_id = target_station_id
    )
$$;


ALTER FUNCTION "public"."can_access_station"("target_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_my_reservation"("reservation_id" "uuid", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where fqe.id = reservation_id and pv.profile_id = public.get_current_profile_id()
  ) then raise exception 'FORBIDDEN'; end if;
  return public.cancel_reservation(reservation_id, 'CONSUMER_CANCELLED', null, client_mutation_id);
end;
$$;


ALTER FUNCTION "public"."cancel_my_reservation"("reservation_id" "uuid", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_preferential_queue_entry"("entry_id" "uuid", "comment" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  old_entry_row public.preferential_queue_entries%rowtype;
  saved_entry_row public.preferential_queue_entries%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into old_entry_row
  from public.preferential_queue_entries pqe
  where pqe.id = cancel_preferential_queue_entry.entry_id
  for update;

  if old_entry_row.id is null then
    raise exception 'PREFERENTIAL_ENTRY_NOT_FOUND';
  end if;

  if old_entry_row.status <> 'ACTIVE' then
    raise exception 'PREFERENTIAL_ENTRY_NOT_ACTIVE';
  end if;

  update public.preferential_queue_entries
  set status = 'CANCELLED',
      cancelled_comment = nullif(trim(cancel_preferential_queue_entry.comment), ''),
      cancelled_by = current_profile_id,
      cancelled_at = now()
  where id = old_entry_row.id
  returning * into saved_entry_row;

  perform public.audit_action(
    'CANCEL_PREFERENTIAL_QUEUE_ENTRY',
    'preferential_queue_entry',
    saved_entry_row.id,
    to_jsonb(old_entry_row),
    to_jsonb(saved_entry_row)
  );

  return jsonb_build_object(
    'id', saved_entry_row.id,
    'queue_id', saved_entry_row.queue_id,
    'status', saved_entry_row.status,
    'cancelled_comment', saved_entry_row.cancelled_comment,
    'cancelled_at', saved_entry_row.cancelled_at
  );
end;
$$;


ALTER FUNCTION "public"."cancel_preferential_queue_entry"("entry_id" "uuid", "comment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_reservation"("reservation_id" "uuid", "reason" "text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  update public.fuel_queue_entries
  set status = 'CANCELLED',
      cancelled_by = current_profile_id,
      cancelled_at = now(),
      cancel_reason = reason,
      cancel_comment = nullif(trim(coalesce(comment, '')), '')
  where id = reservation_id and status = 'WAITING'
  returning * into saved_entry;
  if saved_entry.id is null then raise exception 'QUEUE_ENTRY_NOT_WAITING'; end if;
  update public.daily_queue_allocations
  set status = 'EXPIRED', finalized_at = now()
  where queue_entry_id = saved_entry.id and status in ('ACTIVE', 'PAUSED_BY_LIMIT');
  perform public.allocate_daily_queue((now() at time zone 'Europe/Moscow')::date);
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'cancelled_by', saved_entry.cancelled_by,
    'cancelled_at', saved_entry.cancelled_at,
    'cancel_reason', saved_entry.cancel_reason,
    'cancel_comment', saved_entry.cancel_comment
  );
end;
$$;


ALTER FUNCTION "public"."cancel_reservation"("reservation_id" "uuid", "reason" "text", "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_public_queue_position"("plate_number" "text", "phone_last4" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  matched record;
begin
  if regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g') !~ '^[0-9]{4}$' then
    return jsonb_build_object('status', 'INVALID_INPUT', 'public_status', 'INVALID_INPUT', 'remaining_attempts', 10);
  end if;
  select fqe.*, dqa.id as allocation_id, dqa.daily_position, dqa.station_position,
    dqa.arrival_at, dqa.status as allocation_status, dqa.assigned_fuel_type, dqa.call_status
  into matched
  from public.fuel_queue_entries fqe
  join public.vehicles v on v.id = fqe.vehicle_id
  left join public.drivers d on d.id = fqe.driver_id
  left join public.daily_queue_allocations dqa
    on dqa.queue_entry_id = fqe.id
   and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
  where v.normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 4) = regexp_replace(phone_last4, '\D', '', 'g')
  order by fqe.permanent_number desc
  limit 1;
  if matched.id is null then
    return jsonb_build_object('status', 'NOT_FOUND', 'public_status', 'NOT_FOUND', 'remaining_attempts', 10);
  end if;
  return jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched.permanent_number,
    'ticket_number', matched.permanent_number,
    'permanent_number', matched.permanent_number,
    'current_position', matched.daily_position,
    'people_ahead', case when matched.daily_position is null then null else greatest(matched.daily_position - 1, 0) end,
    'preferred_fuel_type', matched.preferred_fuel_type,
    'fuel_preference_mode', matched.fuel_preference_mode,
    'allocation_status', matched.allocation_status,
    'arrival_at', matched.arrival_at,
    'public_status', case
      when matched.status <> 'WAITING' then 'COMPLETED_OR_CANCELLED'
      when matched.allocation_id is null then 'QUEUE_NOT_READY'
      when matched.allocation_status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT'
      when matched.allocation_status = 'ACTIVE' then 'IN_CALL_LIST'
      else 'QUEUE_NOT_READY'
    end,
    'is_within_today_limit', matched.allocation_status = 'ACTIVE',
    'is_callable_now', matched.allocation_status = 'ACTIVE',
    'matched_fuel_type', matched.assigned_fuel_type,
    'remaining_attempts', 10
  );
end;
$_$;


ALTER FUNCTION "public"."check_public_queue_position"("plate_number" "text", "phone_last4" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_vehicle_access"("plate_number" "text", "station_id" "uuid", "check_date" "date" DEFAULT CURRENT_DATE) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  allocation_row record;
begin
  if public.get_current_profile_id() is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'PROFILE_NOT_FOUND', 'normalized_plate_number', normalized_plate);
  end if;
  if not public.can_access_station(station_id) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'STATION_ACCESS_DENIED', 'normalized_plate_number', normalized_plate);
  end if;
  select * into vehicle_row from public.vehicles where normalized_plate_number = normalized_plate limit 1;
  if vehicle_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate);
  end if;
  if vehicle_row.is_blocked then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'VEHICLE_BLOCKED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'block_reason', vehicle_row.block_reason);
  end if;
  if exists (
    select 1 from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id and fr.date = check_date and coalesce(fr.is_manual_override, false) = false
  ) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'ALREADY_FUELED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id);
  end if;

  select
    dqa.*,
    fqe.permanent_number,
    fqe.preferred_fuel_type,
    fqe.fuel_preference_mode,
    fqe.requested_liters
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where fqe.vehicle_id = vehicle_row.id
    and dqa.allocation_date = check_date
  limit 1;

  if allocation_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id);
  end if;
  if allocation_row.status <> 'ACTIVE' or allocation_row.station_id <> check_vehicle_access.station_id then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'allocation_id', allocation_row.id,
      'reservation_id', allocation_row.id,
      'reservation_station_id', allocation_row.station_id,
      'queue_entry_id', allocation_row.queue_entry_id,
      'queue_number', allocation_row.permanent_number,
      'matched_fuel_type', allocation_row.assigned_fuel_type,
      'is_within_today_limit', false
    );
  end if;
  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'date', check_date,
    'station_id', station_id,
    'vehicle_id', vehicle_row.id,
    'allocation_id', allocation_row.id,
    'reservation_id', allocation_row.id,
    'queue_entry_id', allocation_row.queue_entry_id,
    'queue_number', allocation_row.permanent_number,
    'fuel_type', allocation_row.preferred_fuel_type,
    'preferred_fuel_type', allocation_row.preferred_fuel_type,
    'fuel_preference_mode', allocation_row.fuel_preference_mode,
    'matched_fuel_type', allocation_row.assigned_fuel_type,
    'requested_liters', allocation_row.requested_liters,
    'effective_liters', allocation_row.allocated_liters,
    'category_position', allocation_row.station_fuel_position,
    'is_within_today_limit', true,
    'is_callable_now', true,
    'arrival_at', allocation_row.arrival_at,
    'call_status', allocation_row.call_status
  );
end;
$$;


ALTER FUNCTION "public"."check_vehicle_access"("plate_number" "text", "station_id" "uuid", "check_date" "date") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "middle_name" "text",
    "position" "text",
    "signature_name" "text",
    "requested_station_id" "uuid",
    "approval_status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "rejected_by" "uuid",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "deactivated_by" "uuid",
    "deactivated_at" timestamp with time zone,
    "deactivation_reason" "text",
    "email" "text",
    "phone" "text",
    "avatar_url" "text",
    "auth_provider" "text",
    CONSTRAINT "profiles_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['mayor'::"text", 'station_manager'::"text", 'cashier'::"text", 'mayor_assistant'::"text", 'consumer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_consumer_profile"("p_first_name" "text", "p_last_name" "text", "p_middle_name" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  saved_profile public.profiles%rowtype;
  normalized_first_name text := nullif(trim(p_first_name), '');
  normalized_last_name text := nullif(trim(p_last_name), '');
  normalized_middle_name text := nullif(trim(coalesce(p_middle_name, '')), '');
  normalized_phone text := nullif(trim(p_phone), '');
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_first_name is null then
    raise exception 'FIRST_NAME_REQUIRED';
  end if;

  if normalized_last_name is null then
    raise exception 'LAST_NAME_REQUIRED';
  end if;

  if normalized_phone is null then
    raise exception 'PHONE_REQUIRED';
  end if;

  update public.profiles
  set
    first_name = normalized_first_name,
    last_name = normalized_last_name,
    middle_name = normalized_middle_name,
    phone = normalized_phone,
    full_name = trim(concat_ws(' ', normalized_last_name, normalized_first_name, normalized_middle_name))
  where id = current_profile_id
    and role = 'consumer'
  returning * into saved_profile;

  if saved_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return saved_profile;
end;
$$;


ALTER FUNCTION "public"."complete_consumer_profile"("p_first_name" "text", "p_last_name" "text", "p_middle_name" "text", "p_phone" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_vehicles_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'BLOCKED'::"text"])))
);


ALTER TABLE "public"."profile_vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plate_number" "text" NOT NULL,
    "normalized_plate_number" "text" NOT NULL,
    "is_blocked" boolean DEFAULT false NOT NULL,
    "block_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vehicles_normalized_plate_not_empty" CHECK (("normalized_plate_number" <> ''::"text"))
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consumer_vehicle_to_json"("profile_vehicle_row" "public"."profile_vehicles", "vehicle_row" "public"."vehicles") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'id', (vehicle_row).id,
    'profile_vehicle_id', (profile_vehicle_row).id,
    'plate_number', (vehicle_row).plate_number,
    'normalized_plate_number', (vehicle_row).normalized_plate_number,
    'is_blocked', (vehicle_row).is_blocked,
    'block_reason', (vehicle_row).block_reason,
    'status', (profile_vehicle_row).status,
    'created_at', (profile_vehicle_row).created_at,
    'updated_at', (profile_vehicle_row).updated_at
  )
$$;


ALTER FUNCTION "public"."consumer_vehicle_to_json"("profile_vehicle_row" "public"."profile_vehicles", "vehicle_row" "public"."vehicles") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_consumer_reservation"("vehicle_id" "uuid", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "fuel_preference_mode" "text" DEFAULT 'EXACT'::"text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  driver_row public.drivers%rowtype;
  vehicle_row public.vehicles%rowtype;
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null or public.get_current_user_role() <> 'consumer' then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.profile_vehicles pv
    where pv.profile_id = current_profile_id and pv.vehicle_id = create_consumer_reservation.vehicle_id
  ) then raise exception 'VEHICLE_NOT_OWNED'; end if;
  select * into vehicle_row from public.vehicles where id = create_consumer_reservation.vehicle_id;
  if vehicle_row.id is null or vehicle_row.is_blocked then raise exception 'VEHICLE_BLOCKED'; end if;
  if exists (select 1 from public.fuel_queue_entries where vehicle_id = vehicle_row.id and status = 'WAITING') then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;
  if trim(coalesce(driver_full_name, '')) = '' or trim(coalesce(driver_phone, '')) = '' then
    raise exception 'INVALID_DRIVER';
  end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE')
    or (fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100')) then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if requested_liters is null or requested_liters <= 0 then raise exception 'INVALID_REQUESTED_LITERS'; end if;

  select * into saved_entry from public.fuel_queue_entries
  where fuel_queue_entries.client_mutation_id = create_consumer_reservation.client_mutation_id limit 1;
  if saved_entry.id is not null then return public.queue_entry_to_json(saved_entry); end if;

  insert into public.drivers (full_name, phone)
  values (trim(driver_full_name), trim(driver_phone)) returning * into driver_row;
  insert into public.fuel_queue_entries (
    vehicle_id, driver_id, preferred_fuel_type, fuel_preference_mode,
    requested_liters, operator_id, comment, client_mutation_id
  ) values (
    vehicle_row.id, driver_row.id, fuel_type, fuel_preference_mode,
    requested_liters, current_profile_id, nullif(trim(coalesce(comment, '')), ''),
    coalesce(client_mutation_id, gen_random_uuid())
  ) returning * into saved_entry;
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone
  );
end;
$$;


ALTER FUNCTION "public"."create_consumer_reservation"("vehicle_id" "uuid", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "fuel_preference_mode" "text", "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_consumer_vehicle"("plate_number" "text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  profile_vehicle_row public.profile_vehicles%rowtype;
  active_vehicle_count integer;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  perform pg_advisory_xact_lock(hashtext('consumer_vehicle_' || current_profile_id::text));

  select count(*)
  into active_vehicle_count
  from public.profile_vehicles pv
  where pv.profile_id = current_profile_id
    and pv.status = 'ACTIVE';

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  select *
  into profile_vehicle_row
  from public.profile_vehicles pv
  where pv.profile_id = current_profile_id
    and pv.vehicle_id = vehicle_row.id
  limit 1;

  if profile_vehicle_row.id is not null then
    if profile_vehicle_row.status <> 'ACTIVE' then
      if active_vehicle_count >= 3 then
        raise exception 'CONSUMER_VEHICLE_LIMIT_EXCEEDED';
      end if;

      update public.profile_vehicles
      set status = 'ACTIVE'
      where id = profile_vehicle_row.id
      returning * into profile_vehicle_row;
    end if;

    return public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row);
  end if;

  if active_vehicle_count >= 3 then
    raise exception 'CONSUMER_VEHICLE_LIMIT_EXCEEDED';
  end if;

  insert into public.profile_vehicles (profile_id, vehicle_id, status)
  values (current_profile_id, vehicle_row.id, 'ACTIVE')
  returning * into profile_vehicle_row;

  perform public.audit_action(
    'CREATE_CONSUMER_VEHICLE',
    'profile_vehicle',
    profile_vehicle_row.id,
    null,
    public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row)
  );

  return public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row);
end;
$$;


ALTER FUNCTION "public"."create_consumer_vehicle"("plate_number" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_daily_limit"("target_date" "date", "fuel_type_limits" "jsonb" DEFAULT '[]'::"jsonb", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"(), "target_station_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_daily_limit.client_mutation_id, gen_random_uuid());
  existing_limit_row public.daily_limits%rowtype;
  saved_limit_row public.daily_limits%rowtype;
  item jsonb;
  item_fuel_type text;
  item_status text;
  item_vehicle_limit integer;
  item_liters_limit numeric;
  fuel_type_rows jsonb;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if target_station_id is null or not exists (
    select 1
    from public.stations s
    where s.id = target_station_id
      and s.is_active
  ) then
    raise exception 'INVALID_STATION';
  end if;

  if jsonb_typeof(coalesce(fuel_type_limits, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_FUEL_TYPE_LIMITS';
  end if;

  select *
  into existing_limit_row
  from public.daily_limits dl
  where dl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_limit_row.id is not null
    and (
      existing_limit_row.date is distinct from target_date
      or existing_limit_row.station_id is distinct from target_station_id
    ) then
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;

  if existing_limit_row.id is null then
    insert into public.daily_limits (
      date,
      station_id,
      total_vehicle_limit,
      max_liters_per_vehicle,
      status,
      created_by,
      client_mutation_id
    )
    values (
      target_date,
      target_station_id,
      0,
      20,
      'OPEN',
      current_profile_id,
      effective_client_mutation_id
    )
    on conflict (date, station_id) where station_id is not null do update
    set status = 'OPEN',
        created_by = excluded.created_by,
        client_mutation_id = excluded.client_mutation_id
    returning * into saved_limit_row;
  else
    saved_limit_row := existing_limit_row;
  end if;

  for item in
    select value
    from jsonb_array_elements(coalesce(fuel_type_limits, '[]'::jsonb))
  loop
    item_fuel_type := item->>'fuel_type';
    item_status := item->>'status';
    item_vehicle_limit := coalesce(nullif(item->>'vehicle_limit', '')::integer, 0);
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;

    if item_fuel_type is null
      or item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_status is null or item_status not in ('OPEN', 'PAUSED') then
      raise exception 'INVALID_FUEL_STATUS';
    end if;

    if item_vehicle_limit < 0 then
      raise exception 'INVALID_VEHICLE_LIMIT';
    end if;

    if item_liters_limit is not null and item_liters_limit < 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;

    insert into public.daily_fuel_type_limits (
      daily_limit_id,
      fuel_type,
      fuel_category,
      limit_mode,
      status,
      vehicle_limit,
      liters_limit
    )
    values (
      saved_limit_row.id,
      item_fuel_type,
      public.get_fuel_queue_category(item_fuel_type),
      'vehicle_count',
      item_status,
      item_vehicle_limit,
      item_liters_limit
    )
    on conflict (daily_limit_id, fuel_type) do update
    set fuel_category = excluded.fuel_category,
        limit_mode = excluded.limit_mode,
        status = excluded.status,
        vehicle_limit = excluded.vehicle_limit,
        liters_limit = excluded.liters_limit;
  end loop;

  update public.daily_limits
  set total_vehicle_limit = (
        select coalesce(sum(vehicle_limit) filter (where status = 'OPEN'), 0)
        from public.daily_fuel_type_limits dftl
        where dftl.daily_limit_id = saved_limit_row.id
      ),
      max_liters_per_vehicle = 20
  where id = saved_limit_row.id
  returning * into saved_limit_row;

  perform public.audit_action(
    'CREATE_DAILY_LIMIT',
    'daily_limit',
    saved_limit_row.id,
    case when existing_limit_row.id is null then null else to_jsonb(existing_limit_row) end,
    to_jsonb(saved_limit_row)
  );

  select jsonb_agg(
    jsonb_build_object(
      'fuel_type', dftl.fuel_type,
      'fuel_category', dftl.fuel_category,
      'status', dftl.status,
      'vehicle_limit', dftl.vehicle_limit,
      'liters_limit', dftl.liters_limit
    )
    order by case dftl.fuel_type
      when 'AI_92' then 1
      when 'AI_95' then 2
      when 'AI_100' then 3
      when 'DIESEL' then 4
      when 'GAS' then 5
      else 6
    end
  )
  into fuel_type_rows
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = saved_limit_row.id
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS');

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'station_id', saved_limit_row.station_id,
    'status', saved_limit_row.status,
    'client_mutation_id', saved_limit_row.client_mutation_id,
    'fuel_type_limits', coalesce(fuel_type_rows, '[]'::jsonb),
    'category_limits', coalesce(fuel_type_rows, '[]'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."create_daily_limit"("target_date" "date", "fuel_type_limits" "jsonb", "client_mutation_id" "uuid", "target_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_fueling_record_for_allocation"("allocation_id" "uuid", "liters" numeric, "fueled_at" timestamp with time zone DEFAULT "now"(), "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  allocation_row record;
  saved_record public.fueling_records%rowtype;
begin
  if current_profile_id is null or not public.has_role(array['mayor', 'station_manager', 'cashier']) then
    raise exception 'FORBIDDEN';
  end if;
  if liters is null or liters <= 0 then raise exception 'INVALID_LITERS'; end if;
  select dqa.*, fqe.vehicle_id, fqe.driver_id
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where dqa.id = allocation_id
  for update;
  if allocation_row.id is null or allocation_row.status <> 'ACTIVE' then raise exception 'ALLOCATION_NOT_ACTIVE'; end if;
  if not public.can_access_station(allocation_row.station_id) then raise exception 'STATION_ACCESS_DENIED'; end if;
  if liters > allocation_row.allocated_liters then raise exception 'LITERS_LIMIT_EXCEEDED'; end if;
  if exists (
    select 1 from public.fueling_records fr
    where fr.vehicle_id = allocation_row.vehicle_id
      and fr.date = allocation_row.allocation_date
      and coalesce(fr.is_manual_override, false) = false
  ) then raise exception 'ALREADY_FUELED'; end if;

  select * into saved_record from public.fueling_records
  where fueling_records.client_mutation_id = create_fueling_record_for_allocation.client_mutation_id limit 1;
  if saved_record.id is null then
    insert into public.fueling_records (
      date, station_id, vehicle_id, driver_id, allocation_id, queue_entry_id,
      fuel_type, liters, cashier_id, is_manual_override, comment,
      client_mutation_id, sync_status, fueled_at
    ) values (
      allocation_row.allocation_date, allocation_row.station_id, allocation_row.vehicle_id,
      allocation_row.driver_id, allocation_row.id, allocation_row.queue_entry_id,
      allocation_row.assigned_fuel_type, liters, current_profile_id, false,
      nullif(trim(coalesce(comment, '')), ''), coalesce(client_mutation_id, gen_random_uuid()),
      'SYNCED', coalesce(fueled_at, now())
    ) returning * into saved_record;
    update public.daily_queue_allocations
    set status = 'FUELED', fueled_at = saved_record.fueled_at, finalized_at = now()
    where id = allocation_row.id;
    update public.fuel_queue_entries set status = 'FUELED' where id = allocation_row.queue_entry_id;
    perform public.allocate_daily_queue(allocation_row.allocation_date);
  end if;
  return jsonb_build_object(
    'id', saved_record.id,
    'date', saved_record.date,
    'station_id', saved_record.station_id,
    'vehicle_id', saved_record.vehicle_id,
    'driver_id', saved_record.driver_id,
    'allocation_id', saved_record.allocation_id,
    'reservation_id', saved_record.queue_entry_id,
    'queue_entry_id', saved_record.queue_entry_id,
    'preferential_queue_entry_id', null,
    'fuel_type', saved_record.fuel_type,
    'liters', saved_record.liters,
    'is_manual_override', saved_record.is_manual_override,
    'override_id', saved_record.override_id,
    'comment', saved_record.comment,
    'client_mutation_id', saved_record.client_mutation_id,
    'sync_status', saved_record.sync_status,
    'fueled_at', saved_record.fueled_at
  );
end;
$$;


ALTER FUNCTION "public"."create_fueling_record_for_allocation"("allocation_id" "uuid", "liters" numeric, "fueled_at" timestamp with time zone, "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.has_role(array['shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  raise exception 'RPC_NOT_IMPLEMENTED: create_manual_override';
end;
$$;


ALTER FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_manual_override.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  existing_override_row public.manual_overrides%rowtype;
  saved_override_row public.manual_overrides%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if coalesce(trim(reason), '') = '' then
    raise exception 'INVALID_REASON';
  end if;

  if expires_at is not null and expires_at <= now() then
    raise exception 'INVALID_EXPIRES_AT';
  end if;

  select *
  into existing_override_row
  from public.manual_overrides
  where manual_overrides.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_override_row.id is not null then
    select *
    into vehicle_row
    from public.vehicles
    where id = existing_override_row.vehicle_id;

    return jsonb_build_object(
      'id', existing_override_row.id,
      'date', existing_override_row.date,
      'station_id', existing_override_row.station_id,
      'vehicle_id', existing_override_row.vehicle_id,
      'normalized_plate_number', vehicle_row.normalized_plate_number,
      'reason', existing_override_row.reason,
      'approved_by', existing_override_row.approved_by,
      'expires_at', existing_override_row.expires_at,
      'used_at', existing_override_row.used_at,
      'client_mutation_id', existing_override_row.client_mutation_id,
      'sync_status', existing_override_row.sync_status
    );
  end if;

  insert into public.vehicles (
    plate_number,
    normalized_plate_number
  )
  values (
    plate_number,
    normalized_plate
  )
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  insert into public.manual_overrides (
    date,
    station_id,
    vehicle_id,
    reason,
    approved_by,
    expires_at,
    client_mutation_id,
    sync_status
  )
  values (
    target_date,
    target_station_id,
    vehicle_row.id,
    trim(reason),
    current_profile_id,
    create_manual_override.expires_at,
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_override_row;

  perform public.audit_action(
    'CREATE_MANUAL_OVERRIDE',
    'manual_override',
    saved_override_row.id,
    null,
    to_jsonb(saved_override_row)
  );

  return jsonb_build_object(
    'id', saved_override_row.id,
    'date', saved_override_row.date,
    'station_id', saved_override_row.station_id,
    'vehicle_id', saved_override_row.vehicle_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'reason', saved_override_row.reason,
    'approved_by', saved_override_row.approved_by,
    'expires_at', saved_override_row.expires_at,
    'used_at', saved_override_row.used_at,
    'client_mutation_id', saved_override_row.client_mutation_id,
    'sync_status', saved_override_row.sync_status
  );
end;
$$;


ALTER FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone, "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_personal_vehicle_liter_limit"("target_date" "date", "plate_number" "text", "liters" numeric, "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  current_role text;
  effective_client_mutation_id uuid := coalesce(create_personal_vehicle_liter_limit.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  saved_limit_row public.personal_vehicle_liter_limits%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  current_role := public.get_current_user_role();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or current_role not in ('mayor', 'mayor_assistant') then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select *
  into saved_limit_row
  from public.personal_vehicle_liter_limits
  where personal_vehicle_liter_limits.client_mutation_id = effective_client_mutation_id
  limit 1;

  if saved_limit_row.id is not null then
    return jsonb_build_object(
      'id', saved_limit_row.id,
      'date', saved_limit_row.date,
      'vehicle_id', saved_limit_row.vehicle_id,
      'normalized_plate_number', normalized_plate,
      'liters', saved_limit_row.liters,
      'comment', saved_limit_row.comment,
      'client_mutation_id', saved_limit_row.client_mutation_id
    );
  end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  insert into public.personal_vehicle_liter_limits (
    date,
    vehicle_id,
    liters,
    approved_by,
    comment,
    client_mutation_id
  )
  values (
    target_date,
    vehicle_row.id,
    liters,
    current_profile_id,
    nullif(trim(comment), ''),
    effective_client_mutation_id
  )
  on conflict (date, vehicle_id) do update
  set liters = excluded.liters,
      approved_by = excluded.approved_by,
      comment = excluded.comment,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_limit_row;

  perform public.audit_action(
    'CREATE_PERSONAL_VEHICLE_LITER_LIMIT',
    'personal_vehicle_liter_limit',
    saved_limit_row.id,
    null,
    to_jsonb(saved_limit_row)
  );

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'vehicle_id', saved_limit_row.vehicle_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'liters', saved_limit_row.liters,
    'comment', saved_limit_row.comment,
    'client_mutation_id', saved_limit_row.client_mutation_id
  );
end;
$$;


ALTER FUNCTION "public"."create_personal_vehicle_liter_limit"("target_date" "date", "plate_number" "text", "liters" numeric, "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_preferential_queue"("name" "text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_preferential_queue.client_mutation_id, gen_random_uuid());
  saved_queue_row public.preferential_queues%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(name), '') = '' then
    raise exception 'INVALID_QUEUE_NAME';
  end if;

  select *
  into saved_queue_row
  from public.preferential_queues pq
  where pq.client_mutation_id = effective_client_mutation_id
  limit 1;

  if saved_queue_row.id is null then
    insert into public.preferential_queues (name, status, created_by, client_mutation_id)
    values (trim(name), 'ACTIVE', current_profile_id, effective_client_mutation_id)
    returning * into saved_queue_row;

    perform public.audit_action(
      'CREATE_PREFERENTIAL_QUEUE',
      'preferential_queue',
      saved_queue_row.id,
      null,
      to_jsonb(saved_queue_row)
    );
  end if;

  return jsonb_build_object(
    'id', saved_queue_row.id,
    'name', saved_queue_row.name,
    'status', saved_queue_row.status,
    'created_by', saved_queue_row.created_by,
    'client_mutation_id', saved_queue_row.client_mutation_id,
    'created_at', saved_queue_row.created_at,
    'updated_at', saved_queue_row.updated_at
  );
end;
$$;


ALTER FUNCTION "public"."create_preferential_queue"("name" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_preferential_queue_entry"("queue_id" "uuid", "plate_number" "text", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_preferential_queue_entry.client_mutation_id, gen_random_uuid());
  queue_row public.preferential_queues%rowtype;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  saved_entry_row public.preferential_queue_entries%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if queue_id is null then
    raise exception 'INVALID_QUEUE_ID';
  end if;

  select *
  into queue_row
  from public.preferential_queues pq
  where pq.id = create_preferential_queue_entry.queue_id
    and pq.status = 'ACTIVE'
  limit 1;

  if queue_row.id is null then
    raise exception 'PREFERENTIAL_QUEUE_NOT_FOUND';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if coalesce(trim(driver_full_name), '') = '' then
    raise exception 'INVALID_DRIVER_FULL_NAME';
  end if;

  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

  select *
  into saved_entry_row
  from public.preferential_queue_entries pqe
  where pqe.client_mutation_id = effective_client_mutation_id
  limit 1;

  if saved_entry_row.id is not null then
    return jsonb_build_object(
      'id', saved_entry_row.id,
      'queue_id', saved_entry_row.queue_id,
      'queue_name', queue_row.name,
      'vehicle_id', saved_entry_row.vehicle_id,
      'driver_id', saved_entry_row.driver_id,
      'normalized_plate_number', normalized_plate,
      'driver_full_name', driver_full_name,
      'driver_phone', driver_phone,
      'fuel_type', saved_entry_row.fuel_type,
      'requested_liters', saved_entry_row.requested_liters,
      'status', saved_entry_row.status,
      'comment', saved_entry_row.comment,
      'client_mutation_id', saved_entry_row.client_mutation_id,
      'created_at', saved_entry_row.created_at,
      'updated_at', saved_entry_row.updated_at
    );
  end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  select *
  into driver_row
  from public.drivers
  where lower(full_name) = lower(trim(driver_full_name))
    and coalesce(phone, '') = coalesce(nullif(trim(driver_phone), ''), '')
  order by created_at asc
  limit 1;

  if driver_row.id is null then
    insert into public.drivers (full_name, phone)
    values (trim(driver_full_name), nullif(trim(driver_phone), ''))
    returning * into driver_row;
  end if;

  if exists (
    select 1
    from public.preferential_queue_entries pqe
    where pqe.vehicle_id = vehicle_row.id
      and pqe.status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_PREFERENTIAL_ENTRY_ALREADY_EXISTS';
  end if;

  insert into public.preferential_queue_entries (
    queue_id,
    vehicle_id,
    driver_id,
    fuel_type,
    requested_liters,
    status,
    comment,
    created_by,
    client_mutation_id
  )
  values (
    queue_row.id,
    vehicle_row.id,
    driver_row.id,
    create_preferential_queue_entry.fuel_type,
    requested_liters,
    'ACTIVE',
    nullif(trim(comment), ''),
    current_profile_id,
    effective_client_mutation_id
  )
  returning * into saved_entry_row;

  perform public.audit_action(
    'CREATE_PREFERENTIAL_QUEUE_ENTRY',
    'preferential_queue_entry',
    saved_entry_row.id,
    null,
    to_jsonb(saved_entry_row)
  );

  return jsonb_build_object(
    'id', saved_entry_row.id,
    'queue_id', saved_entry_row.queue_id,
    'queue_name', queue_row.name,
    'vehicle_id', saved_entry_row.vehicle_id,
    'driver_id', saved_entry_row.driver_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone,
    'fuel_type', saved_entry_row.fuel_type,
    'requested_liters', saved_entry_row.requested_liters,
    'status', saved_entry_row.status,
    'comment', saved_entry_row.comment,
    'client_mutation_id', saved_entry_row.client_mutation_id,
    'created_at', saved_entry_row.created_at,
    'updated_at', saved_entry_row.updated_at
  );
end;
$$;


ALTER FUNCTION "public"."create_preferential_queue_entry"("queue_id" "uuid", "plate_number" "text", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reservation"("plate_number" "text", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "fuel_preference_mode" "text" DEFAULT 'EXACT'::"text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null
    or not public.has_role(array['mayor', 'station_manager', 'mayor_assistant']) then
    raise exception 'FORBIDDEN';
  end if;
  if normalized_plate = '' then raise exception 'INVALID_PLATE_NUMBER'; end if;
  if trim(coalesce(driver_full_name, '')) = '' then raise exception 'INVALID_DRIVER_FULL_NAME'; end if;
  if trim(coalesce(driver_phone, '')) = '' then raise exception 'INVALID_DRIVER_PHONE'; end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then raise exception 'INVALID_FUEL_PREFERENCE_MODE'; end if;
  if fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if requested_liters is null or requested_liters <= 0 then raise exception 'INVALID_REQUESTED_LITERS'; end if;

  select * into saved_entry
  from public.fuel_queue_entries
  where fuel_queue_entries.client_mutation_id = create_reservation.client_mutation_id
  limit 1;
  if saved_entry.id is not null then return public.queue_entry_to_json(saved_entry); end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (normalized_plate, normalized_plate)
  on conflict (normalized_plate_number) do update set plate_number = excluded.plate_number
  returning * into vehicle_row;
  if vehicle_row.is_blocked then raise exception 'VEHICLE_BLOCKED'; end if;
  if exists (select 1 from public.fuel_queue_entries where vehicle_id = vehicle_row.id and status = 'WAITING') then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  insert into public.drivers (full_name, phone)
  values (trim(driver_full_name), trim(driver_phone))
  returning * into driver_row;

  insert into public.fuel_queue_entries (
    vehicle_id, driver_id, preferred_fuel_type, fuel_preference_mode,
    requested_liters, operator_id, comment, client_mutation_id
  ) values (
    vehicle_row.id, driver_row.id, fuel_type, fuel_preference_mode,
    requested_liters, current_profile_id, nullif(trim(coalesce(comment, '')), ''),
    coalesce(client_mutation_id, gen_random_uuid())
  ) returning * into saved_entry;

  perform public.audit_action('CREATE_QUEUE_ENTRY', 'fuel_queue_entry', saved_entry.id, null, to_jsonb(saved_entry));
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone
  );
end;
$$;


ALTER FUNCTION "public"."create_reservation"("plate_number" "text", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "fuel_preference_mode" "text", "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_reservation_call_log"("reservation_id" "uuid", "status" "text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_log public.daily_queue_allocation_call_logs%rowtype;
  caller public.profiles%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  if status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER') then raise exception 'INVALID_CALL_STATUS'; end if;
  if not exists (
    select 1 from public.daily_queue_allocations
    where id = reservation_id and status = 'ACTIVE' and public.can_access_station(station_id)
  ) then raise exception 'ALLOCATION_NOT_ACTIVE'; end if;

  select * into saved_log from public.daily_queue_allocation_call_logs
  where daily_queue_allocation_call_logs.client_mutation_id = create_reservation_call_log.client_mutation_id
  limit 1;
  if saved_log.id is null then
    insert into public.daily_queue_allocation_call_logs (
      allocation_id, status, called_by, comment, client_mutation_id
    ) values (
      reservation_id, status, current_profile_id,
      nullif(trim(coalesce(comment, '')), ''), coalesce(client_mutation_id, gen_random_uuid())
    ) returning * into saved_log;
    update public.daily_queue_allocations
    set call_status = status
    where id = reservation_id;
  end if;
  select * into caller from public.profiles where id = saved_log.called_by;
  return jsonb_build_object(
    'id', saved_log.id,
    'allocation_id', saved_log.allocation_id,
    'reservation_id', saved_log.allocation_id,
    'status', saved_log.status,
    'called_by_profile_id', saved_log.called_by,
    'called_by_full_name', caller.full_name,
    'called_by_role', caller.role,
    'called_by_signature_name', caller.signature_name,
    'called_at', saved_log.called_at,
    'comment', saved_log.comment,
    'client_mutation_id', saved_log.client_mutation_id,
    'sync_status', saved_log.sync_status
  );
end;
$$;


ALTER FUNCTION "public"."create_reservation_call_log"("reservation_id" "uuid", "status" "text", "comment" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_auth_aal"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select nullif(auth.jwt()->>'aal', '')
$$;


ALTER FUNCTION "public"."current_auth_aal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deactivate_profile"("target_profile_id" "uuid", "reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  actor_profile_id uuid;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
begin
  actor_profile_id := public.get_current_profile_id();
  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'approved' then
    raise exception 'PROFILE_NOT_APPROVED';
  end if;

  if coalesce(trim(reason), '') = '' then
    raise exception 'DEACTIVATION_REASON_REQUIRED';
  end if;

  update public.profiles
  set is_active = false,
      deactivated_by = actor_profile_id,
      deactivated_at = now(),
      deactivation_reason = trim(reason)
  where id = target_profile_id
  returning * into saved_profile;

  perform public.audit_action(
    'DEACTIVATE_PROFILE',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'is_active', saved_profile.is_active,
    'deactivated_by', saved_profile.deactivated_by,
    'deactivated_at', saved_profile.deactivated_at,
    'deactivation_reason', saved_profile.deactivation_reason
  );
end;
$$;


ALTER FUNCTION "public"."deactivate_profile"("target_profile_id" "uuid", "reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_fueling_record_liters_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  daily_limit_row public.daily_limits%rowtype;
  fuel_type_limit_row public.daily_fuel_type_limits%rowtype;
  already_fueled_liters numeric := 0;
begin
  if new.date is null or new.station_id is null or new.fuel_type is null or new.liters is null then
    return new;
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = new.date
    and dl.station_id = new.station_id
    and dl.status = 'OPEN'
  limit 1;

  if daily_limit_row.id is null then
    return new;
  end if;

  select *
  into fuel_type_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = daily_limit_row.id
    and dftl.fuel_type = new.fuel_type
  for update;

  if fuel_type_limit_row.id is null
    or fuel_type_limit_row.limit_mode <> 'fuel_liters'
    or fuel_type_limit_row.liters_limit is null then
    return new;
  end if;

  select coalesce(sum(fr.liters), 0)
  into already_fueled_liters
  from public.fueling_records fr
  where fr.date = new.date
    and fr.station_id = new.station_id
    and fr.fuel_type = new.fuel_type
    and fr.is_manual_override = false
    and fr.id <> new.id;

  if coalesce(new.is_manual_override, false) is false
    and already_fueled_liters + new.liters > fuel_type_limit_row.liters_limit then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_fueling_record_liters_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_can_manage_profile"("target_profile_id" "uuid") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  actor_profile_id uuid;
  actor_role text;
  target_profile public.profiles%rowtype;
begin
  actor_profile_id := public.get_current_profile_id();
  actor_role := public.get_current_user_role();

  if actor_profile_id is null or actor_role not in ('station_manager', 'mayor') then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into target_profile
  from public.profiles
  where id = target_profile_id;

  if target_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if target_profile.id = actor_profile_id then
    raise exception 'CANNOT_MANAGE_SELF';
  end if;

  if actor_role = 'mayor' then
    return target_profile;
  end if;

  if target_profile.role <> 'cashier' then
    raise exception 'PROFILE_ACCESS_DENIED';
  end if;

  if target_profile.requested_station_id is not null
    and public.can_access_station(target_profile.requested_station_id) then
    return target_profile;
  end if;

  if exists (
    select 1
    from public.user_stations us
    where us.user_id = target_profile.id
      and public.can_access_station(us.station_id)
  ) then
    return target_profile;
  end if;

  raise exception 'PROFILE_ACCESS_DENIED';
end;
$$;


ALTER FUNCTION "public"."ensure_can_manage_profile"("target_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."export_queue_backup"("target_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'queue_entry_id', fqe.id,
    'permanent_number', fqe.permanent_number,
    'queue_number', fqe.permanent_number,
    'ticket_number', fqe.permanent_number,
    'normalized_plate_number', v.normalized_plate_number,
    'driver_full_name', d.full_name,
    'driver_phone', d.phone,
    'preferred_fuel_type', fqe.preferred_fuel_type,
    'fuel_preference_mode', fqe.fuel_preference_mode,
    'requested_liters', fqe.requested_liters,
    'queue_status', fqe.status,
    'allocation_id', dqa.id,
    'date', dqa.allocation_date,
    'station_id', dqa.station_id,
    'station_name', s.name,
    'assigned_fuel_type', dqa.assigned_fuel_type,
    'daily_position', dqa.daily_position,
    'station_position', dqa.station_position,
    'station_fuel_position', dqa.station_fuel_position,
    'arrival_at', dqa.arrival_at,
    'allocation_status', dqa.status,
    'latest_call_status', dqa.call_status,
    'created_at', fqe.created_at,
    'updated_at', greatest(fqe.updated_at, dqa.updated_at)
  ) order by fqe.permanent_number, dqa.allocation_date), '[]'::jsonb)
  from public.fuel_queue_entries fqe
  join public.vehicles v on v.id = fqe.vehicle_id
  left join public.drivers d on d.id = fqe.driver_id
  left join public.daily_queue_allocations dqa
    on dqa.queue_entry_id = fqe.id
   and (target_date is null or dqa.allocation_date = target_date)
  left join public.stations s on s.id = dqa.station_id
  where target_date is null or dqa.id is not null;
$$;


ALTER FUNCTION "public"."export_queue_backup"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_daily_queue"("target_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  missed_count integer;
  expired_count integer;
  grace_days integer := public.get_reservation_no_show_grace_days();
begin
  if target_date is null then raise exception 'INVALID_DATE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finalize_daily_queue:' || target_date::text, 0));
  with marked as (
    update public.daily_queue_allocations dqa
    set status = 'MISSED', missed_at = now(), finalized_at = now()
    where dqa.allocation_date = target_date
      and dqa.status = 'ACTIVE'
      and dqa.call_status in ('CONTACTED', 'NO_ANSWER')
      and not exists (select 1 from public.fueling_records fr where fr.allocation_id = dqa.id)
    returning queue_entry_id
  ) select count(*)::integer into missed_count from marked;

  with marked as (
    update public.daily_queue_allocations dqa
    set status = 'EXPIRED', finalized_at = now()
    where dqa.allocation_date = target_date
      and dqa.status = 'ACTIVE'
      and dqa.call_status = 'NOT_CALLED'
      and not exists (select 1 from public.fueling_records fr where fr.allocation_id = dqa.id)
    returning queue_entry_id
  ) select count(*)::integer into expired_count from marked;

  if grace_days > 0 then
    update public.fuel_queue_entries fqe
    set status = 'NO_SHOW'
    where fqe.status = 'WAITING'
      and (select count(*) from public.daily_queue_allocations dqa where dqa.queue_entry_id = fqe.id and dqa.status = 'MISSED') >= grace_days;
  end if;
  return jsonb_build_object('date', target_date, 'missed_count', missed_count, 'expired_count', expired_count);
end;
$$;


ALTER FUNCTION "public"."finalize_daily_queue"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cancelled_reservations"("page_size" integer DEFAULT 25, "cursor_cancelled_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "cursor_id" "uuid" DEFAULT NULL::"uuid", "plate_search" "text" DEFAULT ''::"text", "date_from" "date" DEFAULT NULL::"date", "date_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with rows as (
    select
      fqe.id,
      fqe.permanent_number as queue_number,
      fqe.permanent_number as ticket_number,
      fqe.vehicle_id,
      fqe.driver_id,
      fqe.preferred_fuel_type as fuel_type,
      fqe.fuel_preference_mode,
      fqe.requested_liters,
      fqe.status,
      fqe.comment,
      fqe.cancelled_by,
      fqe.cancelled_at,
      fqe.cancel_reason,
      fqe.cancel_comment,
      fqe.created_at,
      fqe.updated_at,
      v.normalized_plate_number,
      d.full_name as driver_full_name,
      d.phone as driver_phone,
      creator.full_name as created_by_full_name,
      creator.role as created_by_role,
      creator.signature_name as created_by_signature_name,
      canceller.full_name as cancelled_by_full_name,
      canceller.role as cancelled_by_role,
      canceller.signature_name as cancelled_by_signature_name
    from public.fuel_queue_entries fqe
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.drivers d on d.id = fqe.driver_id
    left join public.profiles creator on creator.id = fqe.operator_id
    left join public.profiles canceller on canceller.id = fqe.cancelled_by
    where fqe.status = 'CANCELLED'
      and (coalesce(plate_search, '') = '' or v.normalized_plate_number like '%' || public.normalize_plate_number(plate_search) || '%')
      and (date_from is null or fqe.cancelled_at::date >= date_from)
      and (date_to is null or fqe.cancelled_at::date <= date_to)
      and (
        cursor_cancelled_at is null
        or (fqe.cancelled_at, fqe.id) < (cursor_cancelled_at, cursor_id)
      )
    order by fqe.cancelled_at desc nulls last, fqe.id desc
    limit greatest(1, least(coalesce(page_size, 25), 100)) + 1
  ), limited as (
    select *, row_number() over () as rn from rows
  ), cursor_row as (
    select cancelled_at, id
    from limited
    where rn = greatest(1, least(coalesce(page_size, 25), 100)) + 1
    limit 1
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(limited) - 'rn' order by rn) from limited where rn <= greatest(1, least(coalesce(page_size, 25), 100))), '[]'::jsonb),
    'next_cursor', (select jsonb_build_object('cancelled_at', cancelled_at, 'id', id) from cursor_row)
  );
$$;


ALTER FUNCTION "public"."get_cancelled_reservations"("page_size" integer, "cursor_cancelled_at" timestamp with time zone, "cursor_id" "uuid", "plate_search" "text", "date_from" "date", "date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_compatible_fuel_types"("fuel_type" "text", "fuel_preference_mode" "text" DEFAULT 'EXACT'::"text") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when fuel_preference_mode <> 'ANY_GASOLINE' then array[fuel_type]::text[]
    when fuel_type = 'AI_92' then array['AI_92', 'AI_95', 'AI_100']::text[]
    when fuel_type = 'AI_95' then array['AI_95', 'AI_92', 'AI_100']::text[]
    when fuel_type = 'AI_100' then array['AI_100', 'AI_92', 'AI_95']::text[]
    else array[fuel_type]::text[]
  end;
$$;


ALTER FUNCTION "public"."get_compatible_fuel_types"("fuel_type" "text", "fuel_preference_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_profile_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
    and approval_status = 'approved'
  limit 1
$$;


ALTER FUNCTION "public"."get_current_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_profile_role_unrestricted"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
    and approval_status = 'approved'
  limit 1
$$;


ALTER FUNCTION "public"."get_current_profile_role_unrestricted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
    and approval_status = 'approved'
  limit 1
$$;


ALTER FUNCTION "public"."get_current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_fueling_schedule"("target_date" "date" DEFAULT CURRENT_DATE, "target_station_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', dfs.id,
    'date', dfs.date,
    'station_id', dfs.station_id,
    'fuel_category', dfs.fuel_category,
    'start_time', to_char(dfs.start_time, 'HH24:MI'),
    'interval_minutes', dfs.interval_minutes,
    'vehicles_per_interval', dfs.vehicles_per_interval,
    'updated_at', dfs.updated_at,
    'client_mutation_id', dfs.client_mutation_id
  ) order by s.allocation_order, dfs.fuel_category), '[]'::jsonb)
  from public.daily_fueling_schedules dfs
  join public.stations s on s.id = dfs.station_id
  where dfs.date = target_date
    and (target_station_id is null or dfs.station_id = target_station_id);
$$;


ALTER FUNCTION "public"."get_daily_fueling_schedule"("target_date" "date", "target_station_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_limit_overview"("target_date" "date") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with fuel_types(fuel_type, label, sort_order) as (
    values
      ('AI_92'::text, 'AI-92', 1),
      ('AI_95'::text, 'AI-95', 2),
      ('AI_100'::text, 'AI-100', 3),
      ('DIESEL'::text, 'Р”РёР·РµР»СЊ', 4),
      ('GAS'::text, 'Р“Р°Р·', 5)
  ),
  active_stations as (
    select
      s.id as station_id,
      s.name as station_name,
      s.address as station_address,
      s.allocation_order
    from public.stations s
    where s.is_active
  ),
  station_fuel_grid as (
    select
      s.station_id,
      s.station_name,
      s.station_address,
      s.allocation_order,
      ft.fuel_type,
      ft.label,
      ft.sort_order,
      public.get_fuel_queue_category(ft.fuel_type) as fuel_category
    from active_stations s
    cross join fuel_types ft
  ),
  limit_rows as (
    select
      grid.station_id,
      grid.station_name,
      grid.station_address,
      grid.allocation_order,
      grid.fuel_type,
      grid.label,
      grid.sort_order,
      grid.fuel_category,
      dl.id,
      dl.date,
      dl.status as limit_status,
      dl.updated_at,
      coalesce(dftl.vehicle_limit, 0)::integer as vehicle_limit,
      dftl.liters_limit,
      coalesce(dftl.status, 'OPEN') as fuel_status
    from station_fuel_grid grid
    left join public.daily_limits dl
      on dl.date = target_date
     and dl.station_id = grid.station_id
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = dl.id
     and dftl.fuel_type = grid.fuel_type
  ),
  allocation_usage as (
    select
      dqa.station_id,
      dqa.assigned_fuel_type as fuel_type,
      count(*) filter (where dqa.status in ('ACTIVE', 'FUELED'))::integer as vehicle_count,
      coalesce(sum(coalesce(fr.liters, dqa.allocated_liters)) filter (where dqa.status in ('ACTIVE', 'FUELED')), 0)::numeric as liters_count,
      max(fqe.permanent_number) filter (where dqa.status in ('ACTIVE', 'FUELED')) as projected_number
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    left join public.fueling_records fr on fr.allocation_id = dqa.id
    where dqa.allocation_date = target_date
    group by dqa.station_id, dqa.assigned_fuel_type
  ),
  enriched as (
    select
      lr.*,
      coalesce(au.vehicle_count, 0) as used_vehicles,
      coalesce(au.liters_count, 0) as used_liters,
      au.projected_number
    from limit_rows lr
    left join allocation_usage au
      on au.station_id = lr.station_id
     and au.fuel_type = lr.fuel_type
  ),
  station_json as (
    select
      station_id,
      jsonb_build_object(
        'exists', true,
        'id', (array_agg(id order by id::text) filter (where id is not null))[1],
        'date', target_date,
        'station_id', station_id,
        'station_name', max(station_name),
        'station_address', max(station_address),
        'status', coalesce(max(limit_status), 'OPEN'),
        'updated_at', max(updated_at),
        'category_overviews', jsonb_agg(jsonb_build_object(
          'fuel_type', fuel_type,
          'fuel_category', fuel_category,
          'label', label,
          'limit_mode', 'vehicle_count',
          'vehicle_limit', vehicle_limit,
          'liters_limit', liters_limit,
          'queue_count', used_vehicles,
          'queued_liters', used_liters,
          'covered_vehicle_count', used_vehicles,
          'covered_liters', used_liters,
          'remaining_vehicle_count', greatest(vehicle_limit - used_vehicles, 0),
          'remaining_liters', case when liters_limit is null then null else greatest(liters_limit - used_liters, 0) end,
          'projected_queue_number', projected_number,
          'status', fuel_status
        ) order by sort_order)
      ) as value
    from enriched
    group by station_id, allocation_order
  ),
  global_category_rows as (
    select jsonb_build_object(
      'fuel_type', fuel_type,
      'fuel_category', max(fuel_category),
      'label', max(label),
      'limit_mode', 'vehicle_count',
      'vehicle_limit', sum(vehicle_limit)::integer,
      'liters_limit', case when count(liters_limit) = 0 then null else sum(liters_limit) end,
      'queue_count', sum(used_vehicles)::integer,
      'queued_liters', sum(used_liters),
      'covered_vehicle_count', sum(used_vehicles)::integer,
      'covered_liters', sum(used_liters),
      'remaining_vehicle_count', greatest(sum(vehicle_limit) - sum(used_vehicles), 0)::integer,
      'remaining_liters', case when count(liters_limit) = 0 then null else greatest(sum(liters_limit) - sum(used_liters), 0) end,
      'projected_queue_number', max(projected_number)
    ) as value,
    fuel_type,
    max(sort_order) as sort_order
    from enriched
    group by fuel_type
  ),
  global_categories as (
    select jsonb_agg(value order by sort_order) as value
    from global_category_rows
  )
  select jsonb_build_object(
    'exists', exists(select 1 from active_stations),
    'id', null,
    'date', target_date,
    'station_id', null,
    'station_name', 'Р’СЃРµ РђР—РЎ',
    'station_address', null,
    'status', case when exists(select 1 from active_stations) then 'OPEN' else null end,
    'category_overviews', coalesce((select value from global_categories), '[]'::jsonb),
    'station_overviews', coalesce((select jsonb_agg(value order by station_id) from station_json), '[]'::jsonb),
    'updated_at', (select max(updated_at) from limit_rows)
  );
$$;


ALTER FUNCTION "public"."get_daily_limit_overview"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fuel_preference_label"("fuel_type" "text", "fuel_preference_mode" "text" DEFAULT 'EXACT'::"text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when fuel_preference_mode = 'ANY_GASOLINE'
      and fuel_type in ('AI_92', 'AI_95', 'AI_100')
      then 'РџРѕРґРѕР№РґС‘С‚ РђР-92/95/100'
    else 'РўРѕР»СЊРєРѕ ' || case fuel_type
      when 'AI_92' then 'РђР-92'
      when 'AI_95' then 'РђР-95'
      when 'AI_100' then 'РђР-100'
      when 'DIESEL' then 'РґРёР·РµР»СЊ'
      when 'GAS' then 'РіР°Р·'
      else fuel_type
    end
  end
$$;


ALTER FUNCTION "public"."get_fuel_preference_label"("fuel_type" "text", "fuel_preference_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fuel_queue_category"("fuel_type" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when fuel_type in ('AI_92', 'AI_95', 'AI_100') then 'GASOLINE'
    when fuel_type = 'DIESEL' then 'DIESEL'
    when fuel_type = 'GAS' then 'GAS'
    else 'OTHER'
  end
$$;


ALTER FUNCTION "public"."get_fuel_queue_category"("fuel_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fueling_report"("date_from" "date", "date_to" "date", "station_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if coalesce(public.get_current_user_role(), '') <> 'mayor' then
    raise exception 'REPORT_ACCESS_DENIED';
  end if;

  if date_from is null or date_to is null or date_from > date_to then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;

  return (
    with filtered_records as (
      select
        fr.id,
        fr.date,
        fr.station_id,
        fr.vehicle_id,
        fr.fuel_type,
        fr.liters
      from public.fueling_records fr
      where fr.date between get_fueling_report.date_from and get_fueling_report.date_to
        and (
          get_fueling_report.station_ids is null
          or cardinality(get_fueling_report.station_ids) = 0
          or fr.station_id = any(get_fueling_report.station_ids)
        )
    ),
    summary as (
      select
        coalesce(sum(fr.liters), 0)::numeric as total_liters,
        count(*)::integer as fueling_count,
        count(distinct fr.vehicle_id)::integer as unique_vehicle_count,
        coalesce(sum(fr.liters) / nullif(count(*), 0), 0)::numeric as average_liters_per_fueling
      from filtered_records fr
    )
    select jsonb_build_object(
      'summary', (
        select jsonb_build_object(
          'total_liters', summary.total_liters,
          'fueling_count', summary.fueling_count,
          'unique_vehicle_count', summary.unique_vehicle_count,
          'average_liters_per_fueling', summary.average_liters_per_fueling
        )
        from summary
      ),
      'by_station', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'station_id', station_summary.station_id,
            'station_name', station_summary.station_name,
            'total_liters', station_summary.total_liters,
            'fueling_count', station_summary.fueling_count,
            'unique_vehicle_count', station_summary.unique_vehicle_count
          )
          order by station_summary.station_name
        )
        from (
          select
            fr.station_id,
            s.name as station_name,
            coalesce(sum(fr.liters), 0)::numeric as total_liters,
            count(*)::integer as fueling_count,
            count(distinct fr.vehicle_id)::integer as unique_vehicle_count
          from filtered_records fr
          join public.stations s on s.id = fr.station_id
          group by fr.station_id, s.name
        ) station_summary
      ), '[]'::jsonb),
      'by_fuel_type', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'fuel_type', fuel_type_summary.fuel_type,
            'total_liters', fuel_type_summary.total_liters,
            'fueling_count', fuel_type_summary.fueling_count,
            'unique_vehicle_count', fuel_type_summary.unique_vehicle_count
          )
          order by fuel_type_summary.fuel_type
        )
        from (
          select
            fr.fuel_type,
            coalesce(sum(fr.liters), 0)::numeric as total_liters,
            count(*)::integer as fueling_count,
            count(distinct fr.vehicle_id)::integer as unique_vehicle_count
          from filtered_records fr
          group by fr.fuel_type
        ) fuel_type_summary
      ), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'date', day_summary.date,
            'total_liters', day_summary.total_liters,
            'fueling_count', day_summary.fueling_count,
            'unique_vehicle_count', day_summary.unique_vehicle_count
          )
          order by day_summary.date
        )
        from (
          select
            fr.date,
            coalesce(sum(fr.liters), 0)::numeric as total_liters,
            count(*)::integer as fueling_count,
            count(distinct fr.vehicle_id)::integer as unique_vehicle_count
          from filtered_records fr
          group by fr.date
        ) day_summary
      ), '[]'::jsonb)
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_fueling_report"("date_from" "date", "date_to" "date", "station_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_queue_status"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  return (
    select public.queue_entry_to_json(fqe) || jsonb_build_object(
      'normalized_plate_number', v.normalized_plate_number,
      'driver_full_name', d.full_name,
      'driver_phone', d.phone,
      'allocation', case when dqa.id is null then null else jsonb_build_object(
        'id', dqa.id,
        'date', dqa.allocation_date,
        'station_id', dqa.station_id,
        'station_name', s.name,
        'station_address', s.address,
        'assigned_fuel_type', dqa.assigned_fuel_type,
        'daily_position', dqa.daily_position,
        'station_position', dqa.station_position,
        'station_fuel_position', dqa.station_fuel_position,
        'arrival_at', dqa.arrival_at,
        'status', dqa.status,
        'call_status', dqa.call_status
      ) end,
      'date', dqa.allocation_date,
      'station_id', dqa.station_id,
      'station_name', s.name,
      'station_address', s.address,
      'current_position', dqa.daily_position,
      'people_ahead', case when dqa.daily_position is null then null else greatest(dqa.daily_position - 1, 0) end,
      'matched_fuel_type', dqa.assigned_fuel_type,
      'is_within_today_limit', dqa.status = 'ACTIVE',
      'is_callable_now', dqa.status = 'ACTIVE'
      ,'is_fuel_preference_update_locked', dqa.id is not null and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT')
    )
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id and pv.profile_id = current_profile_id
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.drivers d on d.id = fqe.driver_id
    left join public.daily_queue_allocations dqa
      on dqa.queue_entry_id = fqe.id
     and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
    left join public.stations s on s.id = dqa.station_id
    where fqe.status = 'WAITING'
    order by fqe.permanent_number
    limit 1
  );
end;
$$;


ALTER FUNCTION "public"."get_my_queue_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_today_fueling_status"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((
    select jsonb_build_object(
      'fueled', true,
      'station_id', fr.station_id,
      'fuel_type', fr.fuel_type,
      'liters', fr.liters,
      'fueled_at', fr.fueled_at,
      'allocation_id', fr.allocation_id,
      'queue_entry_id', fr.queue_entry_id
    )
    from public.fueling_records fr
    join public.profile_vehicles pv on pv.vehicle_id = fr.vehicle_id
    where pv.profile_id = public.get_current_profile_id()
      and fr.date = (now() at time zone 'Europe/Moscow')::date
      and coalesce(fr.is_manual_override, false) = false
    order by fr.fueled_at desc
    limit 1
  ), jsonb_build_object('fueled', false));
$$;


ALTER FUNCTION "public"."get_my_today_fueling_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reservation_no_show_grace_days"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select greatest(coalesce((value->>'days')::integer, 0), 0)
  from public.app_settings
  where key = 'reservation_no_show_grace_days'
  union all
  select 0
  limit 1
$$;


ALTER FUNCTION "public"."get_reservation_no_show_grace_days"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_reservation_refuel_cooldown"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select greatest(coalesce((value->>'days')::integer, 0), 0)
  from public.app_settings
  where key = 'reservation_refuel_cooldown_days'
  union all
  select 0
  limit 1
$$;


ALTER FUNCTION "public"."get_reservation_refuel_cooldown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_today_call_list"("target_date" "date" DEFAULT CURRENT_DATE, "page_size" integer DEFAULT 25, "cursor_queue_number" integer DEFAULT NULL::integer, "cursor_id" "uuid" DEFAULT NULL::"uuid", "plate_search" "text" DEFAULT NULL::"text", "created_by_profile_id" "uuid" DEFAULT NULL::"uuid", "call_filter" "text" DEFAULT 'all'::"text", "gasoline_fuel_filter" "text" DEFAULT 'all'::"text", "fuel_category_filter" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  normalized_search text := public.normalize_plate_number(plate_search);
  effective_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;

  return (
    with base as (
      select
        coalesce(dqa.id, fqe.id) as id,
        dqa.id as allocation_id,
        fqe.id as queue_entry_id,
        fqe.permanent_number,
        fqe.permanent_number as queue_number,
        fqe.permanent_number as ticket_number,
        dqa.allocation_date as date,
        dqa.station_id,
        s.name as station_name,
        s.address as station_address,
        fqe.vehicle_id,
        fqe.driver_id,
        fqe.operator_id,
        fqe.preferred_fuel_type as fuel_type,
        fqe.preferred_fuel_type,
        fqe.fuel_preference_mode,
        fqe.requested_liters,
        dqa.assigned_fuel_type,
        dqa.assigned_fuel_type as matched_fuel_type,
        coalesce(dqa.daily_position, fqe.permanent_number) as daily_position,
        coalesce(dqa.daily_position, fqe.permanent_number) as current_position,
        greatest(coalesce(dqa.daily_position, fqe.permanent_number) - 1, 0) as people_ahead,
        dqa.station_position,
        dqa.station_fuel_position,
        dqa.arrival_at,
        coalesce(dqa.status, 'PAUSED_BY_LIMIT') as allocation_status,
        fqe.status,
        fqe.sync_status,
        fqe.comment,
        fqe.client_mutation_id,
        dqa.status = 'ACTIVE' as is_within_today_limit,
        dqa.status = 'ACTIVE' as is_callable_now,
        case
          when dqa.status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT'
          when dqa.id is null then 'OUTSIDE_TODAY_LIMIT'
          else null
        end as call_unavailable_reason,
        dqa.call_status as latest_call_status,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        op.full_name as created_by_full_name,
        op.role as created_by_role,
        op.signature_name as created_by_signature_name,
        greatest(fqe.updated_at, coalesce(dqa.updated_at, fqe.updated_at)) as updated_at,
        public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)) as effective_fuel_category,
        coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type) as effective_fuel_type
      from public.fuel_queue_entries fqe
      join public.vehicles v on v.id = fqe.vehicle_id
      left join public.drivers d on d.id = fqe.driver_id
      left join public.profiles op on op.id = fqe.operator_id
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = target_date
       and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
      left join public.stations s on s.id = dqa.station_id
      where fqe.status = 'WAITING'
        and (
          dqa.id is null
          or dqa.station_id is null
          or public.can_access_station(dqa.station_id)
        )
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = target_date
            and coalesce(fr.is_manual_override, false) = false
        )
    ),
    filtered as (
      select * from base
      where (normalized_search = '' or normalized_plate_number ilike '%' || normalized_search || '%')
        and (created_by_profile_id is null or operator_id = created_by_profile_id)
        and (gasoline_fuel_filter = 'all' or effective_fuel_type = gasoline_fuel_filter)
        and (fuel_category_filter is null or effective_fuel_category = fuel_category_filter)
        and (
          call_filter = 'all'
          or (call_filter = 'call' and allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED')
          or (call_filter = 'contacted' and latest_call_status = 'CONTACTED')
          or (call_filter = 'no_answer' and latest_call_status = 'NO_ANSWER')
        )
        and (
          cursor_queue_number is null or cursor_id is null
          or (daily_position, id) > (cursor_queue_number, cursor_id)
        )
      order by daily_position, id
      limit effective_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(row_value) order by daily_position, id)
        from (select * from filtered limit effective_size) row_value), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > effective_size then (
        select jsonb_build_object('queue_number', daily_position, 'id', id)
        from filtered order by daily_position, id offset effective_size - 1 limit 1
      ) else null end,
      'summary', jsonb_build_object(
        'total_count', (select count(*) from base),
        'callable_count', (select count(*) from base where allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED'),
        'contacted_count', (select count(*) from base where latest_call_status = 'CONTACTED'),
        'no_answer_count', (select count(*) from base where latest_call_status = 'NO_ANSWER'),
        'category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where effective_fuel_category = 'GASOLINE'),
          'DIESEL', (select count(*) from base where effective_fuel_category = 'DIESEL'),
          'GAS', (select count(*) from base where effective_fuel_category = 'GAS')
        ),
        'callable_category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'GASOLINE'),
          'DIESEL', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'DIESEL'),
          'GAS', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'GAS')
        )
      )
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_today_call_list"("target_date" "date", "page_size" integer, "cursor_queue_number" integer, "cursor_id" "uuid", "plate_search" "text", "created_by_profile_id" "uuid", "call_filter" "text", "gasoline_fuel_filter" "text", "fuel_category_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_today_queue_authors"("target_date" "date" DEFAULT CURRENT_DATE, "plate_search" "text" DEFAULT NULL::"text", "call_filter" "text" DEFAULT 'all'::"text", "gasoline_fuel_filter" "text" DEFAULT 'all'::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'display_name', p.full_name,
    'role', p.role,
    'signature_name', p.signature_name
  ) order by p.full_name), '[]'::jsonb)
  from public.profiles p
  where exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.daily_queue_allocations dqa
      on dqa.queue_entry_id = fqe.id
     and dqa.allocation_date = target_date
     and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
    where fqe.status = 'WAITING'
      and fqe.operator_id = p.id
      and (public.normalize_plate_number(plate_search) = '' or v.normalized_plate_number ilike '%' || public.normalize_plate_number(plate_search) || '%')
      and (gasoline_fuel_filter = 'all' or coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type) = gasoline_fuel_filter)
      and (
        call_filter = 'all'
        or (call_filter = 'call' and dqa.status = 'ACTIVE' and dqa.call_status <> 'CONTACTED')
        or (call_filter = 'contacted' and dqa.call_status = 'CONTACTED')
        or (call_filter = 'no_answer' and dqa.call_status = 'NO_ANSWER')
      )
  );
$$;


ALTER FUNCTION "public"."get_today_queue_authors"("target_date" "date", "plate_search" "text", "call_filter" "text", "gasoline_fuel_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vehicle_fueling_history"("plate_number" "text", "page_limit" integer DEFAULT 10, "page_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  effective_page_limit integer;
  effective_page_offset integer;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);
  effective_page_limit := least(greatest(coalesce(page_limit, 10), 1), 10);
  effective_page_offset := greatest(coalesce(page_offset, 0), 0);

  if current_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if normalized_plate = '' then
    return jsonb_build_object(
      'normalized_plate_number', normalized_plate,
      'vehicle_id', null,
      'vehicle_found', false,
      'total_fueling_count', 0,
      'regular_fueling_count', 0,
      'manual_override_fueling_count', 0,
      'total_liters', 0,
      'first_fueled_at', null,
      'last_fueled_at', null,
      'station_summaries', '[]'::jsonb,
      'fuel_type_summaries', '[]'::jsonb,
      'records', '[]'::jsonb,
      'has_more', false
    );
  end if;

  select *
  into vehicle_row
  from public.vehicles v
  where v.normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object(
      'normalized_plate_number', normalized_plate,
      'vehicle_id', null,
      'vehicle_found', false,
      'total_fueling_count', 0,
      'regular_fueling_count', 0,
      'manual_override_fueling_count', 0,
      'total_liters', 0,
      'first_fueled_at', null,
      'last_fueled_at', null,
      'station_summaries', '[]'::jsonb,
      'fuel_type_summaries', '[]'::jsonb,
      'records', '[]'::jsonb,
      'has_more', false
    );
  end if;

  return jsonb_build_object(
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'vehicle_found', true,
    'total_fueling_count', (
      select count(*)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ),
    'regular_fueling_count', (
      select count(*)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
        and fr.is_manual_override = false
    ),
    'manual_override_fueling_count', (
      select count(*)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
        and fr.is_manual_override = true
    ),
    'total_liters', coalesce((
      select sum(fr.liters)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ), 0),
    'first_fueled_at', (
      select min(fr.fueled_at)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ),
    'last_fueled_at', (
      select max(fr.fueled_at)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ),
    'station_summaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'station_id', station_summary.station_id,
          'station_name', station_summary.station_name,
          'fueling_count', station_summary.fueling_count,
          'total_liters', station_summary.total_liters
        )
        order by station_summary.station_name
      )
      from (
        select
          fr.station_id,
          s.name as station_name,
          count(*) as fueling_count,
          coalesce(sum(fr.liters), 0) as total_liters
        from public.fueling_records fr
        join public.stations s on s.id = fr.station_id
        where fr.vehicle_id = vehicle_row.id
        group by fr.station_id, s.name
      ) station_summary
    ), '[]'::jsonb),
    'fuel_type_summaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fuel_type', fuel_summary.fuel_type,
          'fueling_count', fuel_summary.fueling_count,
          'total_liters', fuel_summary.total_liters
        )
        order by fuel_summary.fuel_type
      )
      from (
        select
          fr.fuel_type,
          count(*) as fueling_count,
          coalesce(sum(fr.liters), 0) as total_liters
        from public.fueling_records fr
        where fr.vehicle_id = vehicle_row.id
        group by fr.fuel_type
      ) fuel_summary
    ), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', history_page.id,
          'date', history_page.date,
          'fueled_at', history_page.fueled_at,
          'liters', history_page.liters,
          'station_id', history_page.station_id,
          'station_name', history_page.station_name,
          'fuel_type', history_page.fuel_type,
          'is_manual_override', history_page.is_manual_override,
          'sync_status', history_page.sync_status
        )
        order by history_page.fueled_at desc, history_page.id
      )
      from (
        select
          fr.id,
          fr.date,
          fr.fueled_at,
          fr.liters,
          fr.station_id,
          s.name as station_name,
          fr.fuel_type,
          fr.is_manual_override,
          fr.sync_status
        from public.fueling_records fr
        join public.stations s on s.id = fr.station_id
        where fr.vehicle_id = vehicle_row.id
        order by fr.fueled_at desc, fr.id
        limit effective_page_limit
        offset effective_page_offset
      ) history_page
    ), '[]'::jsonb),
    'has_more', (
      effective_page_offset + effective_page_limit < (
        select count(*)
        from public.fueling_records fr
        where fr.vehicle_id = vehicle_row.id
      )
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_vehicle_fueling_history"("plate_number" "text", "page_limit" integer, "page_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vehicle_recent_fueling_history"("plate_number" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.get_vehicle_fueling_history(plate_number, 3, 0);
$$;


ALTER FUNCTION "public"."get_vehicle_recent_fueling_history"("plate_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  provider_value text := nullif(
    trim(coalesce(app_meta->>'provider', meta->>'provider', '')),
    ''
  );
  is_yandex_oauth boolean := provider_value in ('custom:yandex', 'yandex')
    or coalesce(app_meta->'providers', '[]'::jsonb) ? 'custom:yandex'
    or coalesce(app_meta->'providers', '[]'::jsonb) ? 'yandex';
  email_value text := nullif(trim(coalesce(new.email, meta->>'email', meta->>'default_email', '')), '');
  requested_role_meta text := nullif(
    trim(coalesce(meta->>'requested_role', meta->>'role', '')),
    ''
  );
  first_name_value text := nullif(trim(coalesce(meta->>'first_name', meta->>'given_name', '')), '');
  last_name_value text := nullif(trim(coalesce(meta->>'last_name', meta->>'family_name', '')), '');
  middle_name_value text := nullif(trim(meta->>'middle_name'), '');
  full_name_value text;
  avatar_url_value text := nullif(trim(coalesce(meta->>'avatar_url', meta->>'picture', '')), '');
  requested_role_value text := case
    when is_yandex_oauth then 'consumer'
    when requested_role_meta = 'consumer' then 'consumer'
    when requested_role_meta in ('cashier', 'mayor_assistant') then requested_role_meta
    else 'cashier'
  end;
  requested_station_value uuid;
begin
  full_name_value := nullif(
    trim(coalesce(
      nullif(trim(concat_ws(' ', last_name_value, first_name_value, middle_name_value)), ''),
      meta->>'full_name',
      meta->>'display_name',
      meta->>'real_name',
      meta->>'name',
      ''
    )),
    ''
  );

  if requested_role_value = 'cashier'
    and nullif(meta->>'requested_station_id', '') is not null then
    requested_station_value := (meta->>'requested_station_id')::uuid;
  end if;

  insert into public.profiles (
    auth_user_id,
    email,
    phone,
    avatar_url,
    auth_provider,
    full_name,
    first_name,
    last_name,
    middle_name,
    position,
    signature_name,
    requested_station_id,
    role,
    is_active,
    approval_status
  )
  values (
    new.id,
    email_value,
    nullif(trim(meta->>'phone'), ''),
    avatar_url_value,
    provider_value,
    coalesce(full_name_value, email_value, 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЇРЅРґРµРєСЃ ID'),
    first_name_value,
    last_name_value,
    middle_name_value,
    case when is_yandex_oauth then null else nullif(trim(meta->>'position'), '') end,
    case
      when is_yandex_oauth then null
      else coalesce(nullif(trim(meta->>'signature_name'), ''), full_name_value, email_value)
    end,
    case when is_yandex_oauth then null else requested_station_value end,
    requested_role_value,
    requested_role_value = 'consumer',
    case when requested_role_value = 'consumer' then 'approved' else 'pending' end
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_aal2"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.current_auth_aal() = 'aal2', false)
$$;


ALTER FUNCTION "public"."has_aal2"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_privileged_profile_unrestricted"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    public.get_current_profile_role_unrestricted()
      in ('mayor', 'station_manager', 'cashier', 'mayor_assistant'),
    false
  )
$$;


ALTER FUNCTION "public"."has_privileged_profile_unrestricted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("required_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with current_user_role_row as (
    select public.get_current_user_role() as role
  )
  select coalesce(
    role = 'mayor'
      or role = any(required_roles)
      or (
        role = 'station_manager'
        and required_roles && array[
          'station_manager',
          'station_admin',
          'shift_supervisor',
          'operator',
          'cashier'
        ]
      )
      or (
        role = 'cashier'
        and required_roles && array['cashier']
      )
      or (
        role = 'mayor_assistant'
        and required_roles && array['mayor_assistant', 'operator']
      ),
    false
  )
  from current_user_role_row
$$;


ALTER FUNCTION "public"."has_role"("required_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_managed_profiles"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with actor as (
    select public.get_current_profile_id() as profile_id, public.get_current_user_role() as role
  ),
  visible_profiles as (
    select p.*
    from public.profiles p
    cross join actor a
    where a.profile_id is not null
      and a.role in ('station_manager', 'mayor')
      and p.id <> a.profile_id
      and (
        a.role = 'mayor'
        or (
          p.role = 'cashier'
          and (
            (
              p.requested_station_id is not null
              and public.can_access_station(p.requested_station_id)
            )
            or exists (
              select 1
              from public.user_stations us
              where us.user_id = p.id
                and public.can_access_station(us.station_id)
            )
          )
        )
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'auth_user_id', p.auth_user_id,
        'full_name', p.full_name,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'middle_name', p.middle_name,
        'position', p.position,
        'signature_name', p.signature_name,
        'role', p.role,
        'is_active', p.is_active,
        'approval_status', p.approval_status,
        'requested_station_id', p.requested_station_id,
        'requested_station_name', rs.name,
        'approved_by', p.approved_by,
        'approved_by_name', approver.full_name,
        'approved_at', p.approved_at,
        'rejected_by', p.rejected_by,
        'rejected_by_name', rejector.full_name,
        'rejected_at', p.rejected_at,
        'rejection_reason', p.rejection_reason,
        'deactivated_by', p.deactivated_by,
        'deactivated_by_name', deactivator.full_name,
        'deactivated_at', p.deactivated_at,
        'deactivation_reason', p.deactivation_reason,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'stations', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'name', s.name,
              'address', s.address
            )
            order by s.name
          )
          from public.user_stations us
          join public.stations s on s.id = us.station_id
          where us.user_id = p.id
        ), '[]'::jsonb)
      )
      order by
        case p.approval_status when 'pending' then 0 when 'approved' then 1 else 2 end,
        p.created_at desc
    ),
    '[]'::jsonb
  )
  from visible_profiles p
  left join public.stations rs on rs.id = p.requested_station_id
  left join public.profiles approver on approver.id = p.approved_by
  left join public.profiles rejector on rejector.id = p.rejected_by
  left join public.profiles deactivator on deactivator.id = p.deactivated_by;
$$;


ALTER FUNCTION "public"."list_managed_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_my_vehicles"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(public.consumer_vehicle_to_json(pv, v) order by pv.created_at asc)
    from public.profile_vehicles pv
    join public.vehicles v on v.id = pv.vehicle_id
    where pv.profile_id = current_profile_id
      and pv.status = 'ACTIVE'
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."list_my_vehicles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_plate_number"("value" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  normalized text;
begin
  normalized := upper(regexp_replace(coalesce(value, ''), '[^0-9A-Za-zРђР’Р•РљРњРќРћР РЎРўРЈРҐР°РІРµРєРјРЅРѕСЂСЃС‚СѓС…]', '', 'g'));
  normalized := translate(
    normalized,
    'ABEKMHOPCTYXabekmhopctyx',
    'РђР’Р•РљРњРќРћР РЎРўРЈРҐРђР’Р•РљРњРќРћР РЎРўРЈРҐ'
  );
  normalized := regexp_replace(normalized, '[^0-9РђР’Р•РљРњРќРћР РЎРўРЈРҐ]', '', 'g');

  return normalized;
end;
$$;


ALTER FUNCTION "public"."normalize_plate_number"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_plate_number"("value" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  normalized text;
begin
  normalized := upper(regexp_replace(
    coalesce(value, ''),
    U&'[^0-9A-Za-z\0410\0412\0415\041A\041C\041D\041E\0420\0421\0422\0423\0425\0430\0432\0435\043A\043C\043D\043E\0440\0441\0442\0443\0445]',
    '',
    'g'
  ));
  normalized := translate(
    normalized,
    'ABEKMHOPCTYX',
    U&'\0410\0412\0415\041A\041C\041D\041E\0420\0421\0422\0423\0425'
  );
  normalized := regexp_replace(
    normalized,
    U&'[^0-9\0410\0412\0415\041A\041C\041D\041E\0420\0421\0422\0423\0425]',
    '',
    'g'
  );

  return normalized;
end;
$$;


ALTER FUNCTION "public"."normalize_plate_number"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_vehicle_plate_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.normalized_plate_number := public.normalize_plate_number(
    coalesce(new.normalized_plate_number, new.plate_number)
  );
  new.plate_number := new.normalized_plate_number;
  return new;
end;
$$;


ALTER FUNCTION "public"."normalize_vehicle_plate_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_permanent_number_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.permanent_number is distinct from old.permanent_number then
    raise exception 'PERMANENT_NUMBER_IMMUTABLE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_permanent_number_change"() OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."fuel_queue_permanent_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."fuel_queue_permanent_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fuel_queue_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "permanent_number" bigint DEFAULT "nextval"('"public"."fuel_queue_permanent_number_seq"'::"regclass") NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "preferred_fuel_type" "text" NOT NULL,
    "fuel_preference_mode" "text" DEFAULT 'EXACT'::"text" NOT NULL,
    "requested_liters" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'WAITING'::"text" NOT NULL,
    "operator_id" "uuid" NOT NULL,
    "comment" "text",
    "client_mutation_id" "uuid",
    "sync_status" "text" DEFAULT 'SYNCED'::"text" NOT NULL,
    "cancelled_by" "uuid",
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "cancel_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "any_gasoline_requires_gasoline" CHECK ((("fuel_preference_mode" <> 'ANY_GASOLINE'::"text") OR ("preferred_fuel_type" = ANY (ARRAY['AI_92'::"text", 'AI_95'::"text", 'AI_100'::"text"])))),
    CONSTRAINT "fuel_queue_entries_fuel_preference_mode_check" CHECK (("fuel_preference_mode" = ANY (ARRAY['EXACT'::"text", 'ANY_GASOLINE'::"text"]))),
    CONSTRAINT "fuel_queue_entries_preferred_fuel_type_check" CHECK (("preferred_fuel_type" = ANY (ARRAY['AI_92'::"text", 'AI_95'::"text", 'AI_100'::"text", 'DIESEL'::"text", 'GAS'::"text"]))),
    CONSTRAINT "fuel_queue_entries_requested_liters_check" CHECK (("requested_liters" > (0)::numeric)),
    CONSTRAINT "fuel_queue_entries_status_check" CHECK (("status" = ANY (ARRAY['WAITING'::"text", 'FUELED'::"text", 'CANCELLED'::"text", 'NO_SHOW'::"text", 'ERROR'::"text", 'CONFLICT'::"text"]))),
    CONSTRAINT "fuel_queue_entries_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['SYNCED'::"text", 'PENDING'::"text", 'SYNCING'::"text", 'FAILED'::"text", 'CONFLICT'::"text"])))
);


ALTER TABLE "public"."fuel_queue_entries" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_entry_to_json"("entry_row" "public"."fuel_queue_entries") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'id', entry_row.id,
    'queue_entry_id', entry_row.id,
    'permanent_number', entry_row.permanent_number,
    'queue_number', entry_row.permanent_number,
    'ticket_number', entry_row.permanent_number,
    'vehicle_id', entry_row.vehicle_id,
    'driver_id', entry_row.driver_id,
    'fuel_type', entry_row.preferred_fuel_type,
    'preferred_fuel_type', entry_row.preferred_fuel_type,
    'fuel_preference_mode', entry_row.fuel_preference_mode,
    'requested_liters', entry_row.requested_liters,
    'status', entry_row.status,
    'operator_id', entry_row.operator_id,
    'comment', entry_row.comment,
    'client_mutation_id', entry_row.client_mutation_id,
    'sync_status', entry_row.sync_status,
    'created_at', entry_row.created_at,
    'updated_at', entry_row.updated_at
  );
$$;


ALTER FUNCTION "public"."queue_entry_to_json"("entry_row" "public"."fuel_queue_entries") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_registration"("target_profile_id" "uuid", "reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  actor_profile_id uuid;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
begin
  actor_profile_id := public.get_current_profile_id();
  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'pending' then
    raise exception 'PROFILE_NOT_PENDING';
  end if;

  if coalesce(trim(reason), '') = '' then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  update public.profiles
  set is_active = false,
      approval_status = 'rejected',
      rejected_by = actor_profile_id,
      rejected_at = now(),
      rejection_reason = trim(reason)
  where id = target_profile_id
  returning * into saved_profile;

  perform public.audit_action(
    'REJECT_REGISTRATION',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'is_active', saved_profile.is_active,
    'rejected_by', saved_profile.rejected_by,
    'rejected_at', saved_profile.rejected_at,
    'rejection_reason', saved_profile.rejection_reason
  );
end;
$$;


ALTER FUNCTION "public"."reject_registration"("target_profile_id" "uuid", "reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_daily_fueling_schedule"("target_date" "date", "target_station_id" "uuid", "schedules" "jsonb", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  item jsonb;
begin
  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.stations where id = target_station_id and is_active) then
    raise exception 'INVALID_STATION';
  end if;
  for item in select value from jsonb_array_elements(schedules)
  loop
    insert into public.daily_fueling_schedules (
      date, station_id, fuel_category, start_time, interval_minutes,
      vehicles_per_interval, updated_by, client_mutation_id
    ) values (
      target_date,
      target_station_id,
      item->>'fuel_category',
      (item->>'start_time')::time,
      (item->>'interval_minutes')::integer,
      (item->>'vehicles_per_interval')::integer,
      current_profile_id,
      coalesce(client_mutation_id, gen_random_uuid())
    )
    on conflict (date, station_id, fuel_category) do update
    set start_time = excluded.start_time,
        interval_minutes = excluded.interval_minutes,
        vehicles_per_interval = excluded.vehicles_per_interval,
        updated_by = excluded.updated_by,
        client_mutation_id = excluded.client_mutation_id;
  end loop;
  perform public.allocate_daily_queue(target_date);
  return public.get_daily_fueling_schedule(target_date, target_station_id);
end;
$$;


ALTER FUNCTION "public"."set_daily_fueling_schedule"("target_date" "date", "target_station_id" "uuid", "schedules" "jsonb", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_reservation_no_show_grace_days"("days" integer, "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(set_reservation_no_show_grace_days.client_mutation_id, gen_random_uuid());
  existing_setting public.app_settings%rowtype;
  saved_setting public.app_settings%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if days is null or days < 0 or days > 3650 then
    raise exception 'INVALID_NO_SHOW_GRACE_DAYS';
  end if;

  select *
  into existing_setting
  from public.app_settings
  where app_settings.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_setting.key is not null then
    return jsonb_build_object(
      'days', greatest(coalesce((existing_setting.value->>'days')::integer, 0), 0),
      'updated_at', existing_setting.updated_at,
      'client_mutation_id', existing_setting.client_mutation_id
    );
  end if;

  insert into public.app_settings (key, value, updated_by, client_mutation_id)
  values (
    'reservation_no_show_grace_days',
    jsonb_build_object('days', days),
    current_profile_id,
    effective_client_mutation_id
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_setting;

  perform public.audit_action(
    'SET_RESERVATION_NO_SHOW_GRACE',
    'app_setting',
    null,
    case when existing_setting.key is null then null else to_jsonb(existing_setting) end,
    to_jsonb(saved_setting)
  );

  return jsonb_build_object(
    'days', days,
    'updated_at', saved_setting.updated_at,
    'client_mutation_id', saved_setting.client_mutation_id
  );
end;
$$;


ALTER FUNCTION "public"."set_reservation_no_show_grace_days"("days" integer, "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_reservation_refuel_cooldown"("days" integer, "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(set_reservation_refuel_cooldown.client_mutation_id, gen_random_uuid());
  existing_setting public.app_settings%rowtype;
  saved_setting public.app_settings%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if days is null or days < 0 or days > 3650 then
    raise exception 'INVALID_REFUEL_COOLDOWN_DAYS';
  end if;

  select *
  into existing_setting
  from public.app_settings
  where app_settings.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_setting.key is not null then
    return jsonb_build_object(
      'days', greatest(coalesce((existing_setting.value->>'days')::integer, 0), 0),
      'updated_at', existing_setting.updated_at,
      'client_mutation_id', existing_setting.client_mutation_id
    );
  end if;

  insert into public.app_settings (key, value, updated_by, client_mutation_id)
  values (
    'reservation_refuel_cooldown_days',
    jsonb_build_object('days', days),
    current_profile_id,
    effective_client_mutation_id
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_setting;

  perform public.audit_action(
    'SET_RESERVATION_REFUEL_COOLDOWN',
    'app_setting',
    null,
    case when existing_setting.key is null then null else to_jsonb(existing_setting) end,
    to_jsonb(saved_setting)
  );

  return jsonb_build_object(
    'days', days,
    'updated_at', saved_setting.updated_at,
    'client_mutation_id', saved_setting.client_mutation_id
  );
end;
$$;


ALTER FUNCTION "public"."set_reservation_refuel_cooldown"("days" integer, "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_offline_mutation"("client_mutation_id" "uuid", "operation_type" "text", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;
  begin
    case operation_type
      when 'CREATE_RESERVATION' then
        result := public.create_reservation(
          payload->>'plate_number', payload->>'driver_full_name', payload->>'driver_phone',
          payload->>'fuel_type', (payload->>'requested_liters')::numeric,
          coalesce(payload->>'fuel_preference_mode', 'EXACT'), payload->>'comment', client_mutation_id
        );
      when 'CREATE_ALLOCATION_CALL_LOG' then
        result := public.create_reservation_call_log(
          coalesce((payload->>'allocation_id')::uuid, (payload->>'reservation_id')::uuid),
          payload->>'status', payload->>'comment', client_mutation_id
        );
      when 'CREATE_FUELING_RECORD' then
        result := public.create_fueling_record_for_allocation(
          (payload->>'allocation_id')::uuid,
          (payload->>'liters')::numeric,
          coalesce((payload->>'fueled_at')::timestamptz, now()),
          payload->>'comment', client_mutation_id
        );
      else
        raise exception 'UNSUPPORTED_OPERATION';
    end case;
    return jsonb_build_object(
      'status', 'SYNCED', 'operation_type', operation_type,
      'client_mutation_id', client_mutation_id, 'data', result
    );
  exception when others then
    return jsonb_build_object(
      'status', 'CONFLICT', 'operation_type', operation_type,
      'client_mutation_id', client_mutation_id, 'reason', sqlerrm, 'payload', payload
    );
  end;
end;
$$;


ALTER FUNCTION "public"."sync_offline_mutation"("client_mutation_id" "uuid", "operation_type" "text", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_reservation_fuel_preference"("reservation_id" "uuid", "fuel_type" "text", "fuel_preference_mode" "text" DEFAULT 'EXACT'::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE')
    or (fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100')) then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if exists (
    select 1 from public.daily_queue_allocations
    where queue_entry_id = reservation_id and status in ('ACTIVE', 'PAUSED_BY_LIMIT')
  ) then raise exception 'FUEL_PREFERENCE_LOCKED_BY_ALLOCATION'; end if;
  update public.fuel_queue_entries
  set preferred_fuel_type = fuel_type,
      fuel_preference_mode = update_reservation_fuel_preference.fuel_preference_mode
  where id = reservation_id and status = 'WAITING'
  returning * into saved_entry;
  if saved_entry.id is null then raise exception 'QUEUE_ENTRY_NOT_WAITING'; end if;
  return public.queue_entry_to_json(saved_entry);
end;
$$;


ALTER FUNCTION "public"."update_reservation_fuel_preference"("reservation_id" "uuid", "fuel_type" "text", "fuel_preference_mode" "text", "client_mutation_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_by" "uuid",
    "client_mutation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "old_value" "jsonb",
    "new_value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_fuel_type_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_limit_id" "uuid" NOT NULL,
    "fuel_type" "text" NOT NULL,
    "vehicle_limit" integer NOT NULL,
    "liters_limit" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fuel_category" "text" NOT NULL,
    "limit_mode" "text" DEFAULT 'vehicle_count'::"text" NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    CONSTRAINT "daily_fuel_type_limits_fuel_category_check" CHECK (("fuel_category" = ANY (ARRAY['GASOLINE'::"text", 'DIESEL'::"text", 'GAS'::"text"]))),
    CONSTRAINT "daily_fuel_type_limits_fuel_type_check" CHECK (("fuel_type" = ANY (ARRAY['AI_92'::"text", 'AI_95'::"text", 'AI_100'::"text", 'DIESEL'::"text", 'GAS'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "daily_fuel_type_limits_limit_mode_check" CHECK (("limit_mode" = ANY (ARRAY['vehicle_count'::"text", 'fuel_liters'::"text"]))),
    CONSTRAINT "daily_fuel_type_limits_liters_limit_check" CHECK ((("liters_limit" IS NULL) OR ("liters_limit" >= (0)::numeric))),
    CONSTRAINT "daily_fuel_type_limits_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'PAUSED'::"text"]))),
    CONSTRAINT "daily_fuel_type_limits_vehicle_limit_check" CHECK (("vehicle_limit" >= 0))
);


ALTER TABLE "public"."daily_fuel_type_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_fueling_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "fuel_category" "text" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "interval_minutes" integer NOT NULL,
    "vehicles_per_interval" integer NOT NULL,
    "updated_by" "uuid",
    "client_mutation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "station_id" "uuid" NOT NULL,
    CONSTRAINT "daily_fueling_schedules_fuel_category_check" CHECK (("fuel_category" = ANY (ARRAY['GASOLINE'::"text", 'DIESEL'::"text", 'GAS'::"text"]))),
    CONSTRAINT "daily_fueling_schedules_interval_minutes_check" CHECK ((("interval_minutes" >= 1) AND ("interval_minutes" <= 240))),
    CONSTRAINT "daily_fueling_schedules_vehicles_per_interval_check" CHECK ((("vehicles_per_interval" >= 1) AND ("vehicles_per_interval" <= 100)))
);


ALTER TABLE "public"."daily_fueling_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "station_id" "uuid",
    "total_vehicle_limit" integer NOT NULL,
    "max_liters_per_vehicle" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_mutation_id" "uuid",
    CONSTRAINT "daily_limits_max_liters_per_vehicle_check" CHECK (("max_liters_per_vehicle" > (0)::numeric)),
    CONSTRAINT "daily_limits_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'CLOSED'::"text", 'PAUSED'::"text"]))),
    CONSTRAINT "daily_limits_total_vehicle_limit_check" CHECK (("total_vehicle_limit" >= 0))
);


ALTER TABLE "public"."daily_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_queue_allocation_call_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocation_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "called_by" "uuid" NOT NULL,
    "comment" "text",
    "client_mutation_id" "uuid",
    "sync_status" "text" DEFAULT 'SYNCED'::"text" NOT NULL,
    "called_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_queue_allocation_call_logs_status_check" CHECK (("status" = ANY (ARRAY['NOT_CALLED'::"text", 'CONTACTED'::"text", 'NO_ANSWER'::"text"]))),
    CONSTRAINT "daily_queue_allocation_call_logs_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['SYNCED'::"text", 'PENDING'::"text", 'SYNCING'::"text", 'FAILED'::"text", 'CONFLICT'::"text"])))
);


ALTER TABLE "public"."daily_queue_allocation_call_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_queue_allocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocation_date" "date" NOT NULL,
    "queue_entry_id" "uuid" NOT NULL,
    "station_id" "uuid" NOT NULL,
    "assigned_fuel_type" "text" NOT NULL,
    "allocated_liters" numeric(10,2) NOT NULL,
    "daily_position" integer NOT NULL,
    "station_position" integer NOT NULL,
    "station_fuel_position" integer NOT NULL,
    "arrival_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "call_status" "text" DEFAULT 'NOT_CALLED'::"text" NOT NULL,
    "paused_at" timestamp with time zone,
    "paused_reason" "text",
    "fueled_at" timestamp with time zone,
    "missed_at" timestamp with time zone,
    "finalized_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_queue_allocations_allocated_liters_check" CHECK (("allocated_liters" > (0)::numeric)),
    CONSTRAINT "daily_queue_allocations_assigned_fuel_type_check" CHECK (("assigned_fuel_type" = ANY (ARRAY['AI_92'::"text", 'AI_95'::"text", 'AI_100'::"text", 'DIESEL'::"text", 'GAS'::"text"]))),
    CONSTRAINT "daily_queue_allocations_call_status_check" CHECK (("call_status" = ANY (ARRAY['NOT_CALLED'::"text", 'CONTACTED'::"text", 'NO_ANSWER'::"text"]))),
    CONSTRAINT "daily_queue_allocations_daily_position_check" CHECK (("daily_position" > 0)),
    CONSTRAINT "daily_queue_allocations_station_fuel_position_check" CHECK (("station_fuel_position" > 0)),
    CONSTRAINT "daily_queue_allocations_station_position_check" CHECK (("station_position" > 0)),
    CONSTRAINT "daily_queue_allocations_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'PAUSED_BY_LIMIT'::"text", 'FUELED'::"text", 'MISSED'::"text", 'EXPIRED'::"text"])))
);


ALTER TABLE "public"."daily_queue_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."drivers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fueling_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "station_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "queue_entry_id" "uuid",
    "fuel_type" "text" NOT NULL,
    "liters" numeric(10,2) NOT NULL,
    "cashier_id" "uuid" NOT NULL,
    "is_manual_override" boolean DEFAULT false NOT NULL,
    "override_id" "uuid",
    "comment" "text",
    "client_mutation_id" "uuid",
    "sync_status" "text" DEFAULT 'SYNCED'::"text" NOT NULL,
    "fueled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preferential_queue_entry_id" "uuid",
    "allocation_id" "uuid",
    CONSTRAINT "fueling_records_fuel_type_check" CHECK (("fuel_type" = ANY (ARRAY['AI_92'::"text", 'AI_95'::"text", 'AI_100'::"text", 'DIESEL'::"text", 'GAS'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "fueling_records_liters_check" CHECK (("liters" > (0)::numeric)),
    CONSTRAINT "fueling_records_regular_allocation_required" CHECK (("is_manual_override" OR (("allocation_id" IS NOT NULL) AND ("queue_entry_id" IS NOT NULL)))),
    CONSTRAINT "fueling_records_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['SYNCED'::"text", 'PENDING'::"text", 'SYNCING'::"text", 'FAILED'::"text", 'CONFLICT'::"text"])))
);


ALTER TABLE "public"."fueling_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manual_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "station_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "expires_at" timestamp with time zone,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_mutation_id" "uuid",
    "sync_status" "text" DEFAULT 'SYNCED'::"text" NOT NULL,
    CONSTRAINT "manual_overrides_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['SYNCED'::"text", 'PENDING'::"text", 'SYNCING'::"text", 'FAILED'::"text", 'CONFLICT'::"text"])))
);


ALTER TABLE "public"."manual_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."personal_vehicle_liter_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "liters" numeric(10,2) NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "comment" "text",
    "client_mutation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "personal_vehicle_liter_limits_liters_check" CHECK (("liters" > (0)::numeric))
);


ALTER TABLE "public"."personal_vehicle_liter_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."preferential_queue_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "queue_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "driver_id" "uuid",
    "fuel_type" "text" NOT NULL,
    "requested_liters" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "comment" "text",
    "cancelled_comment" "text",
    "created_by" "uuid" NOT NULL,
    "cancelled_by" "uuid",
    "cancelled_at" timestamp with time zone,
    "client_mutation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preferential_queue_entries_fuel_type_check" CHECK (("fuel_type" = ANY (ARRAY['AI_92'::"text", 'AI_95'::"text", 'AI_100'::"text", 'DIESEL'::"text", 'GAS'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "preferential_queue_entries_requested_liters_check" CHECK ((("requested_liters" >= (0)::numeric) AND (("status" <> 'ACTIVE'::"text") OR ("requested_liters" > (0)::numeric)))),
    CONSTRAINT "preferential_queue_entries_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'FUELED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."preferential_queue_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."preferential_queues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "client_mutation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preferential_queues_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'ARCHIVED'::"text"])))
);


ALTER TABLE "public"."preferential_queues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_queue_check_attempts" (
    "attempt_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scope" "text" NOT NULL,
    "attempt_key" "text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_queue_check_attempts_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "public_queue_check_attempts_scope_check" CHECK (("scope" = ANY (ARRAY['IP'::"text", 'LOOKUP'::"text"])))
);


ALTER TABLE "public"."public_queue_check_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refusal_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "station_id" "uuid" NOT NULL,
    "vehicle_id" "uuid",
    "driver_id" "uuid",
    "queue_entry_id" "uuid",
    "reason" "text" NOT NULL,
    "comment" "text",
    "user_id" "uuid" NOT NULL,
    "client_mutation_id" "uuid",
    "sync_status" "text" DEFAULT 'SYNCED'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refusal_records_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['SYNCED'::"text", 'PENDING'::"text", 'SYNCING'::"text", 'FAILED'::"text", 'CONFLICT'::"text"])))
);


ALTER TABLE "public"."refusal_records" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."stations_allocation_order_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."stations_allocation_order_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allocation_order" integer DEFAULT "nextval"('"public"."stations_allocation_order_seq"'::"regclass") NOT NULL
);


ALTER TABLE "public"."stations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_stations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "station_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_stations" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_fuel_type_limits"
    ADD CONSTRAINT "daily_fuel_type_limits_daily_limit_id_fuel_type_key" UNIQUE ("daily_limit_id", "fuel_type");



ALTER TABLE ONLY "public"."daily_fuel_type_limits"
    ADD CONSTRAINT "daily_fuel_type_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_fueling_schedules"
    ADD CONSTRAINT "daily_fueling_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_limits"
    ADD CONSTRAINT "daily_limits_date_station_id_key" UNIQUE ("date", "station_id");



ALTER TABLE ONLY "public"."daily_limits"
    ADD CONSTRAINT "daily_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_queue_allocation_call_logs"
    ADD CONSTRAINT "daily_queue_allocation_call_logs_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."daily_queue_allocation_call_logs"
    ADD CONSTRAINT "daily_queue_allocation_call_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_queue_allocations"
    ADD CONSTRAINT "daily_queue_allocations_allocation_date_queue_entry_id_key" UNIQUE ("allocation_date", "queue_entry_id");



ALTER TABLE ONLY "public"."daily_queue_allocations"
    ADD CONSTRAINT "daily_queue_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_permanent_number_key" UNIQUE ("permanent_number");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manual_overrides"
    ADD CONSTRAINT "manual_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."personal_vehicle_liter_limits"
    ADD CONSTRAINT "personal_vehicle_liter_limits_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."personal_vehicle_liter_limits"
    ADD CONSTRAINT "personal_vehicle_liter_limits_date_vehicle_id_key" UNIQUE ("date", "vehicle_id");



ALTER TABLE ONLY "public"."personal_vehicle_liter_limits"
    ADD CONSTRAINT "personal_vehicle_liter_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preferential_queues"
    ADD CONSTRAINT "preferential_queues_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."preferential_queues"
    ADD CONSTRAINT "preferential_queues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_vehicles"
    ADD CONSTRAINT "profile_vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_vehicles"
    ADD CONSTRAINT "profile_vehicles_profile_id_vehicle_id_key" UNIQUE ("profile_id", "vehicle_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_queue_check_attempts"
    ADD CONSTRAINT "public_queue_check_attempts_scope_key_unique" UNIQUE ("attempt_date", "scope", "attempt_key");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_client_mutation_id_key" UNIQUE ("client_mutation_id");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stations"
    ADD CONSTRAINT "stations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_stations"
    ADD CONSTRAINT "user_stations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_stations"
    ADD CONSTRAINT "user_stations_user_id_station_id_key" UNIQUE ("user_id", "station_id");



ALTER TABLE "public"."vehicles"
    ADD CONSTRAINT "vehicles_normalized_plate_format" CHECK (("normalized_plate_number" ~ '^[РђР’Р•РљРњРќРћР РЎРўРЈРҐ][0-9]{3}[РђР’Р•РљРњРќРћР РЎРўРЈРҐ]{2}[0-9]{2,3}$'::"text")) NOT VALID;



ALTER TABLE "public"."vehicles"
    DROP CONSTRAINT "vehicles_normalized_plate_format";


ALTER TABLE "public"."vehicles"
    ADD CONSTRAINT "vehicles_normalized_plate_format" CHECK (("normalized_plate_number" ~ U&'^[\0410\0412\0415\041A\041C\041D\041E\0420\0421\0422\0423\0425][0-9]{3}[\0410\0412\0415\041A\041C\041D\041E\0420\0421\0422\0423\0425]{2}[0-9]{2,3}$'::"text")) NOT VALID;


ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_normalized_plate_number_key" UNIQUE ("normalized_plate_number");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "app_settings_client_mutation_id_unique" ON "public"."app_settings" USING "btree" ("client_mutation_id") WHERE ("client_mutation_id" IS NOT NULL);



CREATE UNIQUE INDEX "daily_fuel_type_limits_exact_unique" ON "public"."daily_fuel_type_limits" USING "btree" ("daily_limit_id", "fuel_type");



CREATE UNIQUE INDEX "daily_fueling_schedules_station_category_unique" ON "public"."daily_fueling_schedules" USING "btree" ("date", "station_id", "fuel_category");



CREATE UNIQUE INDEX "daily_limits_client_mutation_id_unique" ON "public"."daily_limits" USING "btree" ("client_mutation_id") WHERE ("client_mutation_id" IS NOT NULL);



CREATE UNIQUE INDEX "daily_limits_global_date_unique" ON "public"."daily_limits" USING "btree" ("date") WHERE ("station_id" IS NULL);



CREATE UNIQUE INDEX "daily_limits_station_date_unique" ON "public"."daily_limits" USING "btree" ("date", "station_id") WHERE ("station_id" IS NOT NULL);



CREATE UNIQUE INDEX "daily_queue_allocations_active_daily_position" ON "public"."daily_queue_allocations" USING "btree" ("allocation_date", "daily_position") WHERE ("status" = ANY (ARRAY['ACTIVE'::"text", 'FUELED'::"text"]));



CREATE INDEX "daily_queue_allocations_station_date" ON "public"."daily_queue_allocations" USING "btree" ("allocation_date", "station_id", "status", "station_fuel_position");



CREATE UNIQUE INDEX "fuel_queue_entries_one_waiting_vehicle" ON "public"."fuel_queue_entries" USING "btree" ("vehicle_id") WHERE ("status" = 'WAITING'::"text");



CREATE INDEX "fuel_queue_entries_waiting_number" ON "public"."fuel_queue_entries" USING "btree" ("permanent_number", "id") WHERE ("status" = 'WAITING'::"text");



CREATE UNIQUE INDEX "fueling_records_allocation_unique" ON "public"."fueling_records" USING "btree" ("allocation_id") WHERE (("allocation_id" IS NOT NULL) AND ("is_manual_override" = false));



CREATE UNIQUE INDEX "fueling_records_vehicle_date_regular_unique" ON "public"."fueling_records" USING "btree" ("date", "vehicle_id") WHERE (("is_manual_override" = false) AND ("preferential_queue_entry_id" IS NULL));



CREATE INDEX "idx_audit_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_daily_fuel_type_limits_exact" ON "public"."daily_fuel_type_limits" USING "btree" ("daily_limit_id", "fuel_type");



CREATE INDEX "idx_daily_fuel_type_limits_limit" ON "public"."daily_fuel_type_limits" USING "btree" ("daily_limit_id");



CREATE INDEX "idx_daily_fueling_schedules_date" ON "public"."daily_fueling_schedules" USING "btree" ("date");



CREATE INDEX "idx_fueling_preferential_queue_entry" ON "public"."fueling_records" USING "btree" ("preferential_queue_entry_id");



CREATE INDEX "idx_fueling_vehicle_date" ON "public"."fueling_records" USING "btree" ("vehicle_id", "date");



CREATE INDEX "idx_manual_overrides_vehicle_date" ON "public"."manual_overrides" USING "btree" ("vehicle_id", "date");



CREATE INDEX "idx_preferential_queue_entries_queue_status" ON "public"."preferential_queue_entries" USING "btree" ("queue_id", "status", "created_at");



CREATE INDEX "idx_profile_vehicles_profile_status" ON "public"."profile_vehicles" USING "btree" ("profile_id", "status");



CREATE INDEX "idx_profile_vehicles_vehicle" ON "public"."profile_vehicles" USING "btree" ("vehicle_id");



CREATE INDEX "idx_profiles_approval_status" ON "public"."profiles" USING "btree" ("approval_status");



CREATE INDEX "idx_profiles_requested_station" ON "public"."profiles" USING "btree" ("requested_station_id");



CREATE INDEX "idx_public_queue_check_attempts_date" ON "public"."public_queue_check_attempts" USING "btree" ("attempt_date");



CREATE INDEX "idx_vehicles_normalized_plate" ON "public"."vehicles" USING "btree" ("normalized_plate_number");



CREATE INDEX "idx_vehicles_normalized_plate_number_trgm" ON "public"."vehicles" USING "gin" ("normalized_plate_number" "extensions"."gin_trgm_ops");



CREATE UNIQUE INDEX "manual_overrides_client_mutation_id_unique" ON "public"."manual_overrides" USING "btree" ("client_mutation_id") WHERE ("client_mutation_id" IS NOT NULL);



CREATE UNIQUE INDEX "preferential_queue_entries_active_vehicle_unique" ON "public"."preferential_queue_entries" USING "btree" ("vehicle_id") WHERE ("status" = 'ACTIVE'::"text");



CREATE UNIQUE INDEX "preferential_queues_active_name_unique" ON "public"."preferential_queues" USING "btree" ("lower"("name")) WHERE ("status" = 'ACTIVE'::"text");



CREATE UNIQUE INDEX "stations_allocation_order_unique" ON "public"."stations" USING "btree" ("allocation_order");



CREATE OR REPLACE TRIGGER "enforce_fueling_record_liters_limit_trigger" BEFORE INSERT OR UPDATE OF "date", "station_id", "fuel_type", "liters" ON "public"."fueling_records" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_fueling_record_liters_limit"();



CREATE OR REPLACE TRIGGER "normalize_vehicle_plate_columns" BEFORE INSERT OR UPDATE OF "plate_number", "normalized_plate_number" ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_vehicle_plate_columns"();



CREATE OR REPLACE TRIGGER "prevent_fuel_queue_permanent_number_change" BEFORE UPDATE ON "public"."fuel_queue_entries" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_permanent_number_change"();



CREATE OR REPLACE TRIGGER "set_app_settings_updated_at" BEFORE UPDATE ON "public"."app_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_daily_fuel_type_limits_updated_at" BEFORE UPDATE ON "public"."daily_fuel_type_limits" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_daily_fueling_schedules_updated_at" BEFORE UPDATE ON "public"."daily_fueling_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_daily_limits_updated_at" BEFORE UPDATE ON "public"."daily_limits" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_daily_queue_allocations_updated_at" BEFORE UPDATE ON "public"."daily_queue_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_drivers_updated_at" BEFORE UPDATE ON "public"."drivers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_fuel_queue_entries_updated_at" BEFORE UPDATE ON "public"."fuel_queue_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_fueling_records_updated_at" BEFORE UPDATE ON "public"."fueling_records" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_manual_overrides_updated_at" BEFORE UPDATE ON "public"."manual_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_personal_vehicle_liter_limits_updated_at" BEFORE UPDATE ON "public"."personal_vehicle_liter_limits" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_preferential_queue_entries_updated_at" BEFORE UPDATE ON "public"."preferential_queue_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_preferential_queues_updated_at" BEFORE UPDATE ON "public"."preferential_queues" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profile_vehicles_updated_at" BEFORE UPDATE ON "public"."profile_vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_stations_updated_at" BEFORE UPDATE ON "public"."stations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_vehicles_updated_at" BEFORE UPDATE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."daily_fuel_type_limits"
    ADD CONSTRAINT "daily_fuel_type_limits_daily_limit_id_fkey" FOREIGN KEY ("daily_limit_id") REFERENCES "public"."daily_limits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_fueling_schedules"
    ADD CONSTRAINT "daily_fueling_schedules_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."daily_fueling_schedules"
    ADD CONSTRAINT "daily_fueling_schedules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."daily_limits"
    ADD CONSTRAINT "daily_limits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."daily_limits"
    ADD CONSTRAINT "daily_limits_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."daily_queue_allocation_call_logs"
    ADD CONSTRAINT "daily_queue_allocation_call_logs_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "public"."daily_queue_allocations"("id");



ALTER TABLE ONLY "public"."daily_queue_allocation_call_logs"
    ADD CONSTRAINT "daily_queue_allocation_call_logs_called_by_fkey" FOREIGN KEY ("called_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."daily_queue_allocations"
    ADD CONSTRAINT "daily_queue_allocations_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "public"."fuel_queue_entries"("id");



ALTER TABLE ONLY "public"."daily_queue_allocations"
    ADD CONSTRAINT "daily_queue_allocations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."fuel_queue_entries"
    ADD CONSTRAINT "fuel_queue_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "public"."daily_queue_allocations"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_fuel_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "public"."fuel_queue_entries"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "public"."manual_overrides"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_preferential_queue_entry_id_fkey" FOREIGN KEY ("preferential_queue_entry_id") REFERENCES "public"."preferential_queue_entries"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."fueling_records"
    ADD CONSTRAINT "fueling_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."manual_overrides"
    ADD CONSTRAINT "manual_overrides_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."manual_overrides"
    ADD CONSTRAINT "manual_overrides_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."manual_overrides"
    ADD CONSTRAINT "manual_overrides_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."personal_vehicle_liter_limits"
    ADD CONSTRAINT "personal_vehicle_liter_limits_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."personal_vehicle_liter_limits"
    ADD CONSTRAINT "personal_vehicle_liter_limits_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "public"."preferential_queues"("id");



ALTER TABLE ONLY "public"."preferential_queue_entries"
    ADD CONSTRAINT "preferential_queue_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."preferential_queues"
    ADD CONSTRAINT "preferential_queues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profile_vehicles"
    ADD CONSTRAINT "profile_vehicles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_vehicles"
    ADD CONSTRAINT "profile_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_requested_station_id_fkey" FOREIGN KEY ("requested_station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_fuel_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "public"."fuel_queue_entries"("id");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."refusal_records"
    ADD CONSTRAINT "refusal_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."user_stations"
    ADD CONSTRAINT "user_stations_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_stations"
    ADD CONSTRAINT "user_stations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_select_authenticated" ON "public"."app_settings" FOR SELECT TO "authenticated" USING (("public"."get_current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_select_admin" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ("public"."has_role"(ARRAY['shift_supervisor'::"text", 'station_admin'::"text", 'city_admin'::"text"]));



ALTER TABLE "public"."daily_fuel_type_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_fuel_type_limits_select_accessible" ON "public"."daily_fuel_type_limits" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."daily_limits" "dl"
  WHERE (("dl"."id" = "daily_fuel_type_limits"."daily_limit_id") AND "public"."can_access_station"("dl"."station_id")))));



ALTER TABLE "public"."daily_fueling_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_fueling_schedules_select_authenticated" ON "public"."daily_fueling_schedules" FOR SELECT TO "authenticated" USING (("public"."get_current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."daily_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_limits_select_accessible" ON "public"."daily_limits" FOR SELECT TO "authenticated" USING ("public"."can_access_station"("station_id"));



ALTER TABLE "public"."daily_queue_allocation_call_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_queue_allocations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_queue_allocations_select_accessible" ON "public"."daily_queue_allocations" FOR SELECT TO "authenticated" USING (("public"."can_access_station"("station_id") OR (EXISTS ( SELECT 1
   FROM ("public"."fuel_queue_entries" "fqe"
     JOIN "public"."profile_vehicles" "pv" ON (("pv"."vehicle_id" = "fqe"."vehicle_id")))
  WHERE (("fqe"."id" = "daily_queue_allocations"."queue_entry_id") AND ("pv"."profile_id" = "public"."get_current_profile_id"()))))));



CREATE POLICY "daily_queue_call_logs_select_accessible" ON "public"."daily_queue_allocation_call_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."daily_queue_allocations" "dqa"
  WHERE (("dqa"."id" = "daily_queue_allocation_call_logs"."allocation_id") AND "public"."can_access_station"("dqa"."station_id")))));



ALTER TABLE "public"."drivers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fuel_queue_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fuel_queue_entries_select_accessible" ON "public"."fuel_queue_entries" FOR SELECT TO "authenticated" USING (("public"."has_role"(ARRAY['mayor'::"text", 'mayor_assistant'::"text"]) OR (EXISTS ( SELECT 1
   FROM "public"."profile_vehicles" "pv"
  WHERE (("pv"."profile_id" = "public"."get_current_profile_id"()) AND ("pv"."vehicle_id" = "fuel_queue_entries"."vehicle_id")))) OR (EXISTS ( SELECT 1
   FROM "public"."daily_queue_allocations" "dqa"
  WHERE (("dqa"."queue_entry_id" = "fuel_queue_entries"."id") AND "public"."can_access_station"("dqa"."station_id"))))));



ALTER TABLE "public"."fueling_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fueling_records_select_accessible" ON "public"."fueling_records" FOR SELECT TO "authenticated" USING ("public"."can_access_station"("station_id"));



ALTER TABLE "public"."manual_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "manual_overrides_select_accessible" ON "public"."manual_overrides" FOR SELECT TO "authenticated" USING ("public"."can_access_station"("station_id"));



ALTER TABLE "public"."personal_vehicle_liter_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "personal_vehicle_liter_limits_select_authenticated" ON "public"."personal_vehicle_liter_limits" FOR SELECT TO "authenticated" USING (("public"."get_current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."preferential_queue_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "preferential_queue_entries_select_authenticated" ON "public"."preferential_queue_entries" FOR SELECT TO "authenticated" USING (("public"."get_current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."preferential_queues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "preferential_queues_select_authenticated" ON "public"."preferential_queues" FOR SELECT TO "authenticated" USING (("public"."get_current_profile_id"() IS NOT NULL));



ALTER TABLE "public"."profile_vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profile_vehicles_select_own_or_staff" ON "public"."profile_vehicles" FOR SELECT TO "authenticated" USING ((("profile_id" = "public"."get_current_profile_id"()) OR (COALESCE("public"."get_current_user_role"(), ''::"text") = ANY (ARRAY['mayor'::"text", 'station_manager'::"text", 'mayor_assistant'::"text"]))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth_user_id" = "auth"."uid"()) OR "public"."has_role"(ARRAY['city_admin'::"text"]) OR ("public"."has_role"(ARRAY['station_admin'::"text"]) AND ((("requested_station_id" IS NOT NULL) AND "public"."can_access_station"("requested_station_id")) OR (EXISTS ( SELECT 1
   FROM "public"."user_stations" "us"
  WHERE (("us"."user_id" = "profiles"."id") AND "public"."can_access_station"("us"."station_id"))))))));



ALTER TABLE "public"."public_queue_check_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refusal_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "refusal_records_select_accessible" ON "public"."refusal_records" FOR SELECT TO "authenticated" USING ("public"."can_access_station"("station_id"));



ALTER TABLE "public"."stations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stations_select_accessible" ON "public"."stations" FOR SELECT TO "authenticated" USING ((("is_active" = true) AND "public"."can_access_station"("id")));



ALTER TABLE "public"."user_stations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_stations_select_own_or_admin" ON "public"."user_stations" FOR SELECT TO "authenticated" USING ((("user_id" = "public"."get_current_profile_id"()) OR "public"."has_role"(ARRAY['station_admin'::"text", 'city_admin'::"text"])));



ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicles_select_authenticated" ON "public"."vehicles" FOR SELECT TO "authenticated" USING (((COALESCE("public"."get_current_user_role"(), ''::"text") <> 'consumer'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."profile_vehicles" "pv"
  WHERE (("pv"."vehicle_id" = "vehicles"."id") AND ("pv"."profile_id" = "public"."get_current_profile_id"()) AND ("pv"."status" = 'ACTIVE'::"text"))))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."allocate_daily_queue"("target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."allocate_daily_queue"("target_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_registration"("target_profile_id" "uuid", "target_role" "text", "target_station_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_registration"("target_profile_id" "uuid", "target_role" "text", "target_station_ids" "uuid"[]) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."audit_action"("action" "text", "entity_type" "text", "entity_id" "uuid", "old_value" "jsonb", "new_value" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."can_access_station"("target_station_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_station"("target_station_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."cancel_my_reservation"("reservation_id" "uuid", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."cancel_preferential_queue_entry"("entry_id" "uuid", "comment" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."cancel_reservation"("reservation_id" "uuid", "reason" "text", "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."check_public_queue_position"("plate_number" "text", "phone_last4" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_public_queue_position"("plate_number" "text", "phone_last4" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_public_queue_position"("plate_number" "text", "phone_last4" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."check_vehicle_access"("plate_number" "text", "station_id" "uuid", "check_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_vehicle_access"("plate_number" "text", "station_id" "uuid", "check_date" "date") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_consumer_profile"("p_first_name" "text", "p_last_name" "text", "p_middle_name" "text", "p_phone" "text") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_vehicles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_vehicles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profile_vehicles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_consumer_reservation"("vehicle_id" "uuid", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "fuel_preference_mode" "text", "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_consumer_vehicle"("plate_number" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_daily_limit"("target_date" "date", "fuel_type_limits" "jsonb", "client_mutation_id" "uuid", "target_station_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_fueling_record_for_allocation"("allocation_id" "uuid", "liters" numeric, "fueled_at" timestamp with time zone, "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone) TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_manual_override"("target_date" "date", "target_station_id" "uuid", "plate_number" "text", "reason" "text", "expires_at" timestamp with time zone, "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_personal_vehicle_liter_limit"("target_date" "date", "plate_number" "text", "liters" numeric, "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_preferential_queue"("name" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_preferential_queue_entry"("queue_id" "uuid", "plate_number" "text", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_reservation"("plate_number" "text", "driver_full_name" "text", "driver_phone" "text", "fuel_type" "text", "requested_liters" numeric, "fuel_preference_mode" "text", "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."create_reservation_call_log"("reservation_id" "uuid", "status" "text", "comment" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."current_auth_aal"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."deactivate_profile"("target_profile_id" "uuid", "reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deactivate_profile"("target_profile_id" "uuid", "reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ensure_can_manage_profile"("target_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_can_manage_profile"("target_profile_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."export_queue_backup"("target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."export_queue_backup"("target_date" "date") TO "service_role";
GRANT ALL ON FUNCTION "public"."export_queue_backup"("target_date" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finalize_daily_queue"("target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_daily_queue"("target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cancelled_reservations"("page_size" integer, "cursor_cancelled_at" timestamp with time zone, "cursor_id" "uuid", "plate_search" "text", "date_from" "date", "date_to" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_compatible_fuel_types"("fuel_type" "text", "fuel_preference_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_compatible_fuel_types"("fuel_type" "text", "fuel_preference_mode" "text") TO "anon";



REVOKE ALL ON FUNCTION "public"."get_current_profile_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_profile_id"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_current_profile_role_unrestricted"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_user_role"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_daily_fueling_schedule"("target_date" "date", "target_station_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_daily_limit_overview"("target_date" "date") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_fuel_preference_label"("fuel_type" "text", "fuel_preference_mode" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_fuel_queue_category"("fuel_type" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_fueling_report"("date_from" "date", "date_to" "date", "station_ids" "uuid"[]) TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_my_queue_status"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_my_today_fueling_status"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_reservation_no_show_grace_days"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_reservation_refuel_cooldown"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_today_call_list"("target_date" "date", "page_size" integer, "cursor_queue_number" integer, "cursor_id" "uuid", "plate_search" "text", "created_by_profile_id" "uuid", "call_filter" "text", "gasoline_fuel_filter" "text", "fuel_category_filter" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_today_queue_authors"("target_date" "date", "plate_search" "text", "call_filter" "text", "gasoline_fuel_filter" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_vehicle_fueling_history"("plate_number" "text", "page_limit" integer, "page_offset" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_vehicle_recent_fueling_history"("plate_number" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_auth_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_aal2"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."has_privileged_profile_unrestricted"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."has_role"("required_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_role"("required_roles" "text"[]) TO "authenticated";









REVOKE ALL ON FUNCTION "public"."list_managed_profiles"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_managed_profiles"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."list_my_vehicles"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."normalize_plate_number"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_plate_number"("value" "text") TO "authenticated";



GRANT UPDATE ON SEQUENCE "public"."fuel_queue_permanent_number_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."fuel_queue_permanent_number_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."fuel_queue_permanent_number_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fuel_queue_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."fuel_queue_entries" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reject_registration"("target_profile_id" "uuid", "reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_registration"("target_profile_id" "uuid", "reason" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_daily_fueling_schedule"("target_date" "date", "target_station_id" "uuid", "schedules" "jsonb", "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_reservation_no_show_grace_days"("days" integer, "client_mutation_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_reservation_refuel_cooldown"("days" integer, "client_mutation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."sync_offline_mutation"("client_mutation_id" "uuid", "operation_type" "text", "payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_offline_mutation"("client_mutation_id" "uuid", "operation_type" "text", "payload" "jsonb") TO "authenticated";



GRANT ALL ON FUNCTION "public"."update_reservation_fuel_preference"("reservation_id" "uuid", "fuel_type" "text", "fuel_preference_mode" "text", "client_mutation_id" "uuid") TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."app_settings" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."app_settings" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."app_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_fuel_type_limits" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_fuel_type_limits" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_fuel_type_limits" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_fueling_schedules" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_fueling_schedules" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_fueling_schedules" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_limits" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_limits" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_limits" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_queue_allocation_call_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."daily_queue_allocation_call_logs" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."daily_queue_allocations" TO "service_role";
GRANT SELECT ON TABLE "public"."daily_queue_allocations" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."drivers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."drivers" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."drivers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fueling_records" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fueling_records" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."fueling_records" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."manual_overrides" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."manual_overrides" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."manual_overrides" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."personal_vehicle_liter_limits" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."personal_vehicle_liter_limits" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."personal_vehicle_liter_limits" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preferential_queue_entries" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preferential_queue_entries" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preferential_queue_entries" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preferential_queues" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preferential_queues" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preferential_queues" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."public_queue_check_attempts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."refusal_records" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."refusal_records" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."refusal_records" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."stations_allocation_order_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."stations_allocation_order_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."stations_allocation_order_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."stations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_stations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_stations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_stations" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";


DROP TRIGGER IF EXISTS "on_auth_user_created_create_profile" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created_create_profile"
AFTER INSERT ON "auth"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_auth_user"();




