set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.get_callable_reservations(target_date date default current_date)
returns table (
  reservation_id uuid,
  is_within_today_limit boolean,
  is_callable_now boolean,
  call_unavailable_reason text,
  matched_fuel_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive open_limits as (
    select dl.*
    from public.daily_limits dl
    where dl.date = target_date
      and dl.station_id is not null
      and dl.status = 'OPEN'
  ),
  fuel_types as (
    select *
    from (values
      ('AI_92'::text, 1),
      ('AI_95'::text, 2),
      ('AI_100'::text, 3),
      ('DIESEL'::text, 4),
      ('GAS'::text, 5)
    ) as ft(fuel_type, sort_order)
  ),
  limit_rows as (
    select
      ft.fuel_type,
      coalesce(dftl.limit_mode, 'vehicle_count') as limit_mode,
      coalesce(dftl.vehicle_limit, 0)::integer as vehicle_limit,
      coalesce(dftl.liters_limit, 0)::numeric as liters_limit
    from open_limits ol
    cross join fuel_types ft
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = ol.id
     and dftl.fuel_type = ft.fuel_type
  ),
  fueled_usage as (
    select
      fr.fuel_type,
      count(*) filter (
        where fr.is_manual_override = false
          and dftl.limit_mode = 'vehicle_count'
      )::integer as fueled_vehicle_count,
      coalesce(sum(fr.liters) filter (
        where fr.is_manual_override = false
          and dftl.limit_mode = 'fuel_liters'
      ), 0)::numeric as fueled_liters
    from public.fueling_records fr
    join public.daily_limits dl
      on dl.date = fr.date
     and dl.station_id = fr.station_id
     and dl.status = 'OPEN'
    join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = dl.id
     and dftl.fuel_type = fr.fuel_type
    where fr.date = target_date
      and fr.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    group by fr.fuel_type
  ),
  limit_state as (
    select
      ft.fuel_type,
      greatest(
        coalesce(sum(lr.vehicle_limit) filter (where lr.limit_mode = 'vehicle_count'), 0)
        - coalesce(max(fu.fueled_vehicle_count), 0),
        0
      )::integer as vehicle_remaining,
      greatest(
        coalesce(sum(lr.liters_limit) filter (where lr.limit_mode = 'fuel_liters'), 0)
        - coalesce(max(fu.fueled_liters), 0),
        0
      )::numeric as liters_remaining,
      coalesce(sum(lr.vehicle_limit) filter (where lr.limit_mode = 'vehicle_count'), 0)::integer as vehicle_limit,
      coalesce(sum(lr.liters_limit) filter (where lr.limit_mode = 'fuel_liters'), 0)::numeric as liters_limit
    from fuel_types ft
    left join limit_rows lr on lr.fuel_type = ft.fuel_type
    left join fueled_usage fu on fu.fuel_type = ft.fuel_type
    group by ft.fuel_type
  ),
  all_active as (
    select
      fr.id,
      fr.station_id,
      fr.vehicle_id,
      fr.fuel_type,
      fr.fuel_preference_mode,
      fr.queue_number,
      fr.status,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
      v.is_blocked,
      exists (
        select 1
        from public.fueling_records fueling
        where fueling.vehicle_id = fr.vehicle_id
          and fueling.date = target_date
          and fueling.is_manual_override = false
      ) as already_fueled
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ),
  ordered as (
    select
      row_number() over (order by all_active.queue_number asc, all_active.id asc)::integer as rn,
      all_active.*
    from all_active
  ),
  allocation as (
    select
      0::integer as rn,
      null::uuid as reservation_id,
      null::text as matched_fuel_type,
      false::boolean as is_within_today_limit,
      coalesce(max(vehicle_remaining) filter (where fuel_type = 'AI_92'), 0)::integer as ai92_vehicle_remaining,
      coalesce(max(liters_remaining) filter (where fuel_type = 'AI_92'), 0)::numeric as ai92_liters_remaining,
      coalesce(max(vehicle_remaining) filter (where fuel_type = 'AI_95'), 0)::integer as ai95_vehicle_remaining,
      coalesce(max(liters_remaining) filter (where fuel_type = 'AI_95'), 0)::numeric as ai95_liters_remaining,
      coalesce(max(vehicle_remaining) filter (where fuel_type = 'AI_100'), 0)::integer as ai100_vehicle_remaining,
      coalesce(max(liters_remaining) filter (where fuel_type = 'AI_100'), 0)::numeric as ai100_liters_remaining,
      coalesce(max(vehicle_remaining) filter (where fuel_type = 'DIESEL'), 0)::integer as diesel_vehicle_remaining,
      coalesce(max(liters_remaining) filter (where fuel_type = 'DIESEL'), 0)::numeric as diesel_liters_remaining,
      coalesce(max(vehicle_remaining) filter (where fuel_type = 'GAS'), 0)::integer as gas_vehicle_remaining,
      coalesce(max(liters_remaining) filter (where fuel_type = 'GAS'), 0)::numeric as gas_liters_remaining
    from limit_state

    union all

    select
      o.rn,
      o.id,
      choice.matched_fuel_type,
      choice.matched_fuel_type is not null,
      case
        when choice.matched_fuel_type = 'AI_92' and allocation.ai92_vehicle_remaining > 0
          then allocation.ai92_vehicle_remaining - 1
        else allocation.ai92_vehicle_remaining
      end,
      case
        when choice.matched_fuel_type = 'AI_92' and allocation.ai92_vehicle_remaining <= 0
          then allocation.ai92_liters_remaining - o.effective_liters
        else allocation.ai92_liters_remaining
      end,
      case
        when choice.matched_fuel_type = 'AI_95' and allocation.ai95_vehicle_remaining > 0
          then allocation.ai95_vehicle_remaining - 1
        else allocation.ai95_vehicle_remaining
      end,
      case
        when choice.matched_fuel_type = 'AI_95' and allocation.ai95_vehicle_remaining <= 0
          then allocation.ai95_liters_remaining - o.effective_liters
        else allocation.ai95_liters_remaining
      end,
      case
        when choice.matched_fuel_type = 'AI_100' and allocation.ai100_vehicle_remaining > 0
          then allocation.ai100_vehicle_remaining - 1
        else allocation.ai100_vehicle_remaining
      end,
      case
        when choice.matched_fuel_type = 'AI_100' and allocation.ai100_vehicle_remaining <= 0
          then allocation.ai100_liters_remaining - o.effective_liters
        else allocation.ai100_liters_remaining
      end,
      case
        when choice.matched_fuel_type = 'DIESEL' and allocation.diesel_vehicle_remaining > 0
          then allocation.diesel_vehicle_remaining - 1
        else allocation.diesel_vehicle_remaining
      end,
      case
        when choice.matched_fuel_type = 'DIESEL' and allocation.diesel_vehicle_remaining <= 0
          then allocation.diesel_liters_remaining - o.effective_liters
        else allocation.diesel_liters_remaining
      end,
      case
        when choice.matched_fuel_type = 'GAS' and allocation.gas_vehicle_remaining > 0
          then allocation.gas_vehicle_remaining - 1
        else allocation.gas_vehicle_remaining
      end,
      case
        when choice.matched_fuel_type = 'GAS' and allocation.gas_vehicle_remaining <= 0
          then allocation.gas_liters_remaining - o.effective_liters
        else allocation.gas_liters_remaining
      end
    from allocation
    join ordered o on o.rn = allocation.rn + 1
    cross join lateral (
      select (
        select candidate.fuel_type
        from unnest(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode))
          with ordinality as candidate(fuel_type, sort_order)
        where not o.is_blocked
          and not o.already_fueled
          and (
            (candidate.fuel_type = 'AI_92' and (allocation.ai92_vehicle_remaining > 0 or allocation.ai92_liters_remaining >= o.effective_liters))
            or (candidate.fuel_type = 'AI_95' and (allocation.ai95_vehicle_remaining > 0 or allocation.ai95_liters_remaining >= o.effective_liters))
            or (candidate.fuel_type = 'AI_100' and (allocation.ai100_vehicle_remaining > 0 or allocation.ai100_liters_remaining >= o.effective_liters))
            or (candidate.fuel_type = 'DIESEL' and (allocation.diesel_vehicle_remaining > 0 or allocation.diesel_liters_remaining >= o.effective_liters))
            or (candidate.fuel_type = 'GAS' and (allocation.gas_vehicle_remaining > 0 or allocation.gas_liters_remaining >= o.effective_liters))
          )
        order by candidate.sort_order
        limit 1
      ) as matched_fuel_type
    ) choice
  ),
  latest_calls as (
    select distinct on (rcl.reservation_id)
      rcl.reservation_id,
      rcl.status
    from public.reservation_call_logs rcl
    order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
  )
  select
    o.id as reservation_id,
    coalesce(a.is_within_today_limit, false) as is_within_today_limit,
    (
      coalesce(a.is_within_today_limit, false)
      and not o.is_blocked
      and not o.already_fueled
      and coalesce(lc.status, 'NOT_CALLED') <> 'CONTACTED'
    ) as is_callable_now,
    case
      when o.is_blocked then 'VEHICLE_BLOCKED'
      when o.already_fueled then 'ALREADY_FUELED'
      when coalesce(lc.status, 'NOT_CALLED') = 'CONTACTED' then 'ALREADY_CONTACTED'
      when not exists (select 1 from open_limits) then 'NO_OPEN_DAILY_LIMIT'
      when coalesce(a.is_within_today_limit, false) then null
      when not exists (
        select 1
        from limit_state ls
        where ls.fuel_type = any(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode))
          and (ls.vehicle_limit > 0 or ls.liters_limit > 0)
      ) then 'NO_COMPATIBLE_FUEL'
      else 'OUTSIDE_TODAY_LIMIT'
    end as call_unavailable_reason,
    a.matched_fuel_type
  from all_active o
  left join allocation a on a.reservation_id = o.id
  left join latest_calls lc on lc.reservation_id = o.id
  order by o.queue_number asc, o.id asc
$$;

create or replace function public.enforce_fueling_record_liters_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists enforce_fueling_record_liters_limit_trigger on public.fueling_records;

create trigger enforce_fueling_record_liters_limit_trigger
before insert or update of date, station_id, fuel_type, liters
on public.fueling_records
for each row
execute function public.enforce_fueling_record_liters_limit();

create or replace function public.check_vehicle_access(
  plate_number text,
  station_id uuid,
  check_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  current_profile_is_mayor boolean := false;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  preferential_entry_row public.preferential_queue_entries%rowtype;
  preferential_queue_row public.preferential_queues%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  station_daily_limit_row public.daily_limits%rowtype;
  station_fuel_limit_row public.daily_fuel_type_limits%rowtype;
  station_used_vehicle_count integer := 0;
  station_used_liters numeric := 0;
  callable_reservation_id uuid;
  callable_is_within_today_limit boolean;
  callable_is_callable_now boolean;
  callable_unavailable_reason text;
  callable_matched_fuel_type text;
  manual_override_is_mayor boolean := false;
  cooldown_days integer;
  next_allowed_date date;
  effective_liters numeric;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'PROFILE_NOT_FOUND', 'normalized_plate_number', normalized_plate);
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = current_profile_id
      and p.role = 'mayor'
  )
  into current_profile_is_mayor;

  if normalized_plate = '' then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'INVALID_PLATE_NUMBER', 'normalized_plate_number', normalized_plate);
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'STATION_ACCESS_DENIED', 'normalized_plate_number', normalized_plate, 'station_id', station_id, 'date', check_date);
  end if;

  select * into vehicle_row
  from public.vehicles v
  where v.normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'station_id', station_id, 'date', check_date);
  end if;

  select * into manual_override_row
  from public.manual_overrides mo
  where mo.vehicle_id = vehicle_row.id
    and mo.station_id = check_vehicle_access.station_id
    and mo.date = check_vehicle_access.check_date
    and mo.used_at is null
    and (mo.expires_at is null or mo.expires_at > now())
  order by mo.created_at desc
  limit 1;

  if manual_override_row.id is not null then
    select exists (
      select 1
      from public.profiles p
      where p.id = manual_override_row.approved_by
        and p.role = 'mayor'
    )
    into manual_override_is_mayor;
  end if;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'VEHICLE_BLOCKED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'block_reason', vehicle_row.block_reason);
  end if;

  select pqe.*
  into preferential_entry_row
  from public.preferential_queue_entries pqe
  join public.preferential_queues pq on pq.id = pqe.queue_id
  where pqe.vehicle_id = vehicle_row.id
    and pqe.status = 'ACTIVE'
    and pq.status = 'ACTIVE'
  order by pqe.created_at asc
  limit 1;

  if preferential_entry_row.id is not null then
    select *
    into preferential_queue_row
    from public.preferential_queues pq
    where pq.id = preferential_entry_row.queue_id
    limit 1;
  end if;

  select * into last_fueling_row
  from public.fueling_records fr
  where fr.vehicle_id = vehicle_row.id
    and fr.is_manual_override = false
  order by fr.date desc, fr.fueled_at desc
  limit 1;

  if preferential_entry_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'PREFERENTIAL_QUEUE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'preferential_queue_entry_id', preferential_entry_row.id,
      'preferential_queue_id', preferential_entry_row.queue_id,
      'preferential_queue_name', case
        when current_profile_is_mayor then preferential_queue_row.name
        else null
      end,
      'station_id', station_id,
      'date', check_date,
      'fuel_type', preferential_entry_row.fuel_type,
      'preferred_fuel_type', preferential_entry_row.fuel_type,
      'matched_fuel_type', preferential_entry_row.fuel_type,
      'is_within_today_limit', true,
      'is_callable_now', true,
      'call_unavailable_reason', null,
      'fuel_category', public.get_fuel_queue_category(preferential_entry_row.fuel_type),
      'requested_liters', preferential_entry_row.requested_liters,
      'effective_liters', preferential_entry_row.requested_liters
    );
  end if;

  if last_fueling_row.id is not null
    and last_fueling_row.date = check_vehicle_access.check_date
    and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'last_fueling_record_id', last_fueling_row.id,
      'last_fueling_station_id', last_fueling_row.station_id,
      'last_fueled_at', last_fueling_row.fueled_at,
      'last_fueling_date', last_fueling_row.date
    );
  end if;

  cooldown_days := public.get_reservation_refuel_cooldown();

  if cooldown_days > 0 and last_fueling_row.id is not null and not manual_override_is_mayor then
    next_allowed_date := last_fueling_row.date + cooldown_days;

    if check_vehicle_access.check_date < next_allowed_date then
      return jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'REFUEL_COOLDOWN_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'station_id', station_id,
        'date', check_date,
        'last_fueling_record_id', last_fueling_row.id,
        'last_fueling_station_id', last_fueling_row.station_id,
        'last_fueled_at', last_fueling_row.fueled_at,
        'last_fueling_date', last_fueling_row.date,
        'next_allowed_date', next_allowed_date,
        'cooldown_days', cooldown_days,
        'days_since_last_fueling', check_vehicle_access.check_date - last_fueling_row.date
      );
    end if;
  end if;

  select * into reservation_row
  from public.fuel_reservations fr
  where fr.vehicle_id = vehicle_row.id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  order by fr.queue_number asc
  limit 1;

  if reservation_row.id is null then
    if manual_override_row.id is not null then
      return jsonb_build_object(
        'status', 'ALLOWED',
        'reason', 'MANUAL_OVERRIDE_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'manual_override_id', manual_override_row.id,
        'station_id', station_id,
        'date', check_date,
        'is_within_today_limit', true,
        'is_callable_now', true,
        'call_unavailable_reason', null,
        'matched_fuel_type', null
      );
    end if;

    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'station_id', station_id, 'date', check_date);
  end if;

  effective_liters := coalesce((
    select pvll.liters
    from public.personal_vehicle_liter_limits pvll
    where pvll.vehicle_id = vehicle_row.id
      and pvll.date = check_vehicle_access.check_date
    limit 1
  ), reservation_row.requested_liters, 20);

  if manual_override_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'MANUAL_OVERRIDE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'effective_liters', effective_liters,
      'matched_fuel_type', null,
      'is_within_today_limit', true,
      'is_callable_now', true,
      'call_unavailable_reason', null,
      'manual_override_id', manual_override_row.id
    );
  end if;

  if public.get_fuel_queue_category(reservation_row.fuel_type) is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'matched_fuel_type', null,
      'is_within_today_limit', false,
      'is_callable_now', false,
      'call_unavailable_reason', 'NO_COMPATIBLE_FUEL'
    );
  end if;

  select
    cr.reservation_id,
    cr.is_within_today_limit,
    cr.is_callable_now,
    cr.call_unavailable_reason,
    cr.matched_fuel_type
  into
    callable_reservation_id,
    callable_is_within_today_limit,
    callable_is_callable_now,
    callable_unavailable_reason,
    callable_matched_fuel_type
  from public.get_callable_reservations(check_vehicle_access.check_date) cr
  where cr.reservation_id = reservation_row.id
  limit 1;

  if callable_reservation_id is null or callable_is_within_today_limit is not true then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'effective_liters', effective_liters,
      'matched_fuel_type', callable_matched_fuel_type,
      'is_within_today_limit', coalesce(callable_is_within_today_limit, false),
      'is_callable_now', coalesce(callable_is_callable_now, false),
      'call_unavailable_reason', callable_unavailable_reason
    );
  end if;

  select *
  into station_daily_limit_row
  from public.daily_limits dl
  where dl.date = check_vehicle_access.check_date
    and dl.station_id = check_vehicle_access.station_id
    and dl.status = 'OPEN'
  limit 1;

  if station_daily_limit_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_OPEN_DAILY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'matched_fuel_type', callable_matched_fuel_type,
      'is_within_today_limit', true,
      'is_callable_now', callable_is_callable_now,
      'call_unavailable_reason', 'NO_OPEN_DAILY_LIMIT'
    );
  end if;

  select *
  into station_fuel_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = station_daily_limit_row.id
    and dftl.fuel_type = callable_matched_fuel_type
  limit 1;

  if station_fuel_limit_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_COMPATIBLE_FUEL',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'matched_fuel_type', callable_matched_fuel_type,
      'is_within_today_limit', true,
      'is_callable_now', callable_is_callable_now,
      'call_unavailable_reason', 'NO_COMPATIBLE_FUEL'
    );
  end if;

  select
    count(*)::integer,
    coalesce(sum(fr.liters), 0)::numeric
  into station_used_vehicle_count, station_used_liters
  from public.fueling_records fr
  where fr.date = check_vehicle_access.check_date
    and fr.station_id = check_vehicle_access.station_id
    and fr.fuel_type = callable_matched_fuel_type
    and fr.is_manual_override = false;

  if (
    station_fuel_limit_row.limit_mode = 'vehicle_count'
    and station_used_vehicle_count >= coalesce(station_fuel_limit_row.vehicle_limit, 0)
  ) or (
    station_fuel_limit_row.limit_mode = 'fuel_liters'
    and station_used_liters + effective_liters > coalesce(station_fuel_limit_row.liters_limit, 0)
  ) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_COMPATIBLE_FUEL',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'matched_fuel_type', callable_matched_fuel_type,
      'is_within_today_limit', true,
      'is_callable_now', callable_is_callable_now,
      'call_unavailable_reason', 'NO_COMPATIBLE_FUEL'
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'reservation_id', reservation_row.id,
    'station_id', station_id,
    'date', check_date,
    'queue_number', reservation_row.queue_number,
    'fuel_type', reservation_row.fuel_type,
    'preferred_fuel_type', reservation_row.fuel_type,
    'fuel_preference_mode', reservation_row.fuel_preference_mode,
    'matched_fuel_type', callable_matched_fuel_type,
    'is_within_today_limit', callable_is_within_today_limit,
    'is_callable_now', callable_is_callable_now,
    'call_unavailable_reason', callable_unavailable_reason,
    'fuel_category', public.get_fuel_queue_category(coalesce(callable_matched_fuel_type, reservation_row.fuel_type)),
    'requested_liters', reservation_row.requested_liters,
    'effective_liters', effective_liters
  );
end;
$$;

create or replace function public.create_fueling_record(
  target_station_id uuid,
  plate_number text,
  liters numeric,
  fuel_type text default null,
  target_date date default current_date,
  fueled_at timestamptz default now(),
  comment text default null,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_fueling_record.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  preferential_entry_row public.preferential_queue_entries%rowtype;
  saved_preferential_entry_row public.preferential_queue_entries%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  existing_fueling_row public.fueling_records%rowtype;
  saved_fueling_row public.fueling_records%rowtype;
  access_result jsonb;
  effective_fuel_type text;
  effective_driver_id uuid;
  is_override boolean := false;
  remaining_preferential_liters numeric;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['cashier', 'station_manager', 'mayor']) then
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

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select *
  into existing_fueling_row
  from public.fueling_records
  where fueling_records.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_fueling_row.id is not null then
    return jsonb_build_object(
      'id', existing_fueling_row.id,
      'date', existing_fueling_row.date,
      'station_id', existing_fueling_row.station_id,
      'vehicle_id', existing_fueling_row.vehicle_id,
      'driver_id', existing_fueling_row.driver_id,
      'reservation_id', existing_fueling_row.reservation_id,
      'queue_entry_id', existing_fueling_row.queue_entry_id,
      'preferential_queue_entry_id', existing_fueling_row.preferential_queue_entry_id,
      'fuel_type', existing_fueling_row.fuel_type,
      'liters', existing_fueling_row.liters,
      'is_manual_override', existing_fueling_row.is_manual_override,
      'override_id', existing_fueling_row.override_id,
      'client_mutation_id', existing_fueling_row.client_mutation_id,
      'sync_status', existing_fueling_row.sync_status,
      'fueled_at', existing_fueling_row.fueled_at
    );
  end if;

  access_result := public.check_vehicle_access(normalized_plate, target_station_id, target_date);

  if access_result->>'status' <> 'ALLOWED' then
    raise exception '%', access_result->>'reason';
  end if;

  select * into vehicle_row
  from public.vehicles
  where normalized_plate_number = normalized_plate
  limit 1;

  select * into reservation_row
  from public.fuel_reservations
  where id = nullif(access_result->>'reservation_id', '')::uuid
  limit 1
  for update;

  select * into preferential_entry_row
  from public.preferential_queue_entries
  where id = nullif(access_result->>'preferential_queue_entry_id', '')::uuid
  limit 1
  for update;

  select * into manual_override_row
  from public.manual_overrides
  where id = nullif(access_result->>'manual_override_id', '')::uuid
  limit 1;

  is_override := manual_override_row.id is not null;

  if preferential_entry_row.id is not null then
    if preferential_entry_row.status <> 'ACTIVE' then
      raise exception 'PREFERENTIAL_ENTRY_NOT_ACTIVE';
    end if;

    if preferential_entry_row.requested_liters < liters then
      raise exception 'LITERS_LIMIT_EXCEEDED';
    end if;
  end if;

  effective_fuel_type := coalesce(
    preferential_entry_row.fuel_type,
    nullif(access_result->>'matched_fuel_type', ''),
    reservation_row.fuel_type,
    nullif(fuel_type, '')
  );
  effective_driver_id := coalesce(preferential_entry_row.driver_id, reservation_row.driver_id);

  if effective_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  insert into public.fueling_records (
    date,
    station_id,
    vehicle_id,
    driver_id,
    reservation_id,
    preferential_queue_entry_id,
    fuel_type,
    liters,
    cashier_id,
    is_manual_override,
    override_id,
    comment,
    client_mutation_id,
    sync_status,
    fueled_at
  )
  values (
    target_date,
    target_station_id,
    vehicle_row.id,
    effective_driver_id,
    reservation_row.id,
    preferential_entry_row.id,
    effective_fuel_type,
    liters,
    current_profile_id,
    is_override,
    manual_override_row.id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED',
    coalesce(create_fueling_record.fueled_at, now())
  )
  returning * into saved_fueling_row;

  if reservation_row.id is not null then
    update public.fuel_reservations
    set status = 'FUELED',
        date = coalesce(date, target_date),
        station_id = coalesce(station_id, target_station_id),
        approved_by = coalesce(approved_by, current_profile_id)
    where id = reservation_row.id;
  end if;

  if preferential_entry_row.id is not null then
    remaining_preferential_liters := preferential_entry_row.requested_liters - liters;

    update public.preferential_queue_entries
    set requested_liters = remaining_preferential_liters,
        status = case when remaining_preferential_liters <= 0 then 'FUELED' else 'ACTIVE' end
    where id = preferential_entry_row.id
    returning * into saved_preferential_entry_row;

    perform public.audit_action(
      'UPDATE_PREFERENTIAL_QUEUE_ENTRY_AFTER_FUELING',
      'preferential_queue_entry',
      saved_preferential_entry_row.id,
      to_jsonb(preferential_entry_row),
      to_jsonb(saved_preferential_entry_row)
    );
  end if;

  if manual_override_row.id is not null then
    update public.manual_overrides
    set used_at = coalesce(create_fueling_record.fueled_at, now())
    where id = manual_override_row.id;
  end if;

  perform public.audit_action('CREATE_FUELING_RECORD', 'fueling_record', saved_fueling_row.id, null, to_jsonb(saved_fueling_row));

  return jsonb_build_object(
    'id', saved_fueling_row.id,
    'date', saved_fueling_row.date,
    'station_id', saved_fueling_row.station_id,
    'vehicle_id', saved_fueling_row.vehicle_id,
    'driver_id', saved_fueling_row.driver_id,
    'reservation_id', saved_fueling_row.reservation_id,
    'queue_entry_id', saved_fueling_row.queue_entry_id,
    'preferential_queue_entry_id', saved_fueling_row.preferential_queue_entry_id,
    'fuel_type', saved_fueling_row.fuel_type,
    'liters', saved_fueling_row.liters,
    'is_manual_override', saved_fueling_row.is_manual_override,
    'override_id', saved_fueling_row.override_id,
    'client_mutation_id', saved_fueling_row.client_mutation_id,
    'sync_status', saved_fueling_row.sync_status,
    'fueled_at', saved_fueling_row.fueled_at
  );
end;
$$;

create or replace function public.get_my_queue_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  return (
    with active_positions as (
      select
        fr.id,
        row_number() over (
          partition by public.get_fuel_queue_category(fr.fuel_type)
          order by fr.queue_number asc, fr.id asc
        )::integer as current_position
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    ),
    fueling_lock as (
      select exists (
        select 1
        from public.fuel_reservations fr
        where fr.status = 'FUELING'
      ) as is_locked
    )
    select jsonb_build_object(
      'id', fr.id,
      'date', fr.date,
      'station_id', fr.station_id,
      'station_name', s.name,
      'station_address', s.address,
      'vehicle_id', fr.vehicle_id,
      'driver_id', fr.driver_id,
      'normalized_plate_number', v.normalized_plate_number,
      'driver_full_name', d.full_name,
      'driver_phone', d.phone,
      'fuel_type', fr.fuel_type,
      'fuel_preference_mode', fr.fuel_preference_mode,
      'requested_liters', fr.requested_liters,
      'queue_number', fr.queue_number,
      'ticket_number', fr.queue_number,
      'current_position', ap.current_position,
      'people_ahead', greatest(ap.current_position - 1, 0),
      'is_within_today_limit', coalesce(c.is_within_today_limit, false),
      'is_callable_now', coalesce(c.is_callable_now, false),
      'matched_fuel_type', c.matched_fuel_type,
      'is_fuel_preference_update_locked', fueling_lock.is_locked,
      'status', fr.status,
      'client_mutation_id', fr.client_mutation_id,
      'created_at', fr.created_at,
      'updated_at', fr.updated_at
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join public.stations s on s.id = fr.station_id
    left join active_positions ap on ap.id = fr.id
    left join public.get_callable_reservations(current_date) c on c.reservation_id = fr.id
    cross join fueling_lock
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

grant execute on function public.get_callable_reservations(date) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
grant execute on function public.create_fueling_record(uuid, text, numeric, text, date, timestamptz, text, uuid) to authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
