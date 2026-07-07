set check_function_bodies = off;
set search_path = public, extensions;

create table if not exists public.reservation_call_logs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.fuel_reservations(id) on delete cascade,
  status text not null,
  called_by uuid not null references public.profiles(id),
  called_at timestamptz not null default now(),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_mutation_id),
  constraint reservation_call_logs_status_check
    check (status in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER', 'CALL_LATER', 'WRONG_NUMBER')),
  constraint reservation_call_logs_sync_status_check
    check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT'))
);

drop trigger if exists set_reservation_call_logs_updated_at on public.reservation_call_logs;
create trigger set_reservation_call_logs_updated_at
before update on public.reservation_call_logs
for each row execute function public.set_updated_at();

alter table public.reservation_call_logs enable row level security;

drop policy if exists reservation_call_logs_select_authenticated on public.reservation_call_logs;
create policy reservation_call_logs_select_authenticated
on public.reservation_call_logs
for select
to authenticated
using (public.get_current_profile_id() is not null);

create index if not exists idx_reservation_call_logs_reservation_called_at
on public.reservation_call_logs (reservation_id, called_at desc);

create or replace function public.reservation_call_log_to_json(call_row public.reservation_call_logs)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', call_row.id,
    'reservation_id', call_row.reservation_id,
    'status', call_row.status,
    'called_by_profile_id', call_row.called_by,
    'called_by_full_name', p.full_name,
    'called_by_role', p.role,
    'called_by_signature_name', p.signature_name,
    'called_at', call_row.called_at,
    'comment', call_row.comment,
    'client_mutation_id', call_row.client_mutation_id,
    'sync_status', call_row.sync_status
  )
  from public.profiles p
  where p.id = call_row.called_by
$$;

create or replace function public.create_reservation_call_log(
  reservation_id uuid,
  status text,
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
  effective_client_mutation_id uuid := coalesce(create_reservation_call_log.client_mutation_id, gen_random_uuid());
  existing_call_row public.reservation_call_logs%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  saved_call_row public.reservation_call_logs%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if create_reservation_call_log.status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER', 'CALL_LATER', 'WRONG_NUMBER') then
    raise exception 'INVALID_CALL_STATUS';
  end if;

  select *
  into existing_call_row
  from public.reservation_call_logs rcl
  where rcl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_call_row.id is not null then
    return public.reservation_call_log_to_json(existing_call_row);
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = create_reservation_call_log.reservation_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  limit 1;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  insert into public.reservation_call_logs (
    reservation_id,
    status,
    called_by,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    create_reservation_call_log.reservation_id,
    create_reservation_call_log.status,
    current_profile_id,
    nullif(trim(coalesce(create_reservation_call_log.comment, '')), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_call_row;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, new_value)
  values (
    current_profile_id,
    'CREATE_RESERVATION_CALL_LOG',
    'reservation_call_log',
    saved_call_row.id,
    public.reservation_call_log_to_json(saved_call_row)
  );

  return public.reservation_call_log_to_json(saved_call_row);
end;
$$;

create or replace function public.get_today_call_list(target_date date default current_date)
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

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  return coalesce((
    with daily_limit as (
      select *
      from public.daily_limits dl
      where dl.date = target_date
        and dl.station_id is null
      limit 1
    ),
    active_reservations as (
      select
        fr.id,
        fr.date,
        fr.station_id,
        fr.vehicle_id,
        fr.driver_id,
        fr.operator_id,
        fr.fuel_type,
        public.get_fuel_queue_category(fr.fuel_type) as fuel_category,
        fr.requested_liters,
        coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
        fr.queue_number,
        fr.status,
        fr.comment,
        fr.client_mutation_id,
        fr.sync_status,
        fr.created_at,
        fr.updated_at
      from public.fuel_reservations fr
      left join public.personal_vehicle_liter_limits pvll
        on pvll.vehicle_id = fr.vehicle_id
       and pvll.date = target_date
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and public.get_fuel_queue_category(fr.fuel_type) in ('GASOLINE', 'DIESEL', 'GAS')
    ),
    ranked as (
      select
        ar.*,
        row_number() over (partition by ar.fuel_category order by ar.queue_number asc, ar.id asc)::integer as category_position,
        sum(ar.effective_liters) over (partition by ar.fuel_category order by ar.queue_number asc, ar.id asc)::numeric as category_liters
      from active_reservations ar
    ),
    projected as (
      select
        r.*,
        (
          dl.id is not null
          and (
            (dftl.limit_mode = 'vehicle_count' and r.category_position <= dftl.vehicle_limit)
            or (dftl.limit_mode = 'fuel_liters' and r.category_liters <= coalesce(dftl.liters_limit, 0))
          )
        ) as is_within_today_limit
      from ranked r
      left join daily_limit dl on true
      left join public.daily_fuel_type_limits dftl
        on dftl.daily_limit_id = dl.id
       and dftl.fuel_category = r.fuel_category
    ),
    latest_calls as (
      select distinct on (rcl.reservation_id)
        rcl.reservation_id,
        rcl.status,
        rcl.called_by,
        rcl.called_at,
        rcl.comment,
        rcl.client_mutation_id,
        rcl.sync_status
      from public.reservation_call_logs rcl
      order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'date', p.date,
        'station_id', p.station_id,
        'vehicle_id', p.vehicle_id,
        'driver_id', p.driver_id,
        'operator_id', p.operator_id,
        'fuel_type', p.fuel_type,
        'fuel_category', p.fuel_category,
        'requested_liters', p.requested_liters,
        'effective_liters', p.effective_liters,
        'queue_number', p.queue_number,
        'status', p.status,
        'comment', p.comment,
        'client_mutation_id', p.client_mutation_id,
        'sync_status', p.sync_status,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'is_within_today_limit', p.is_within_today_limit,
        'normalized_plate_number', v.normalized_plate_number,
        'driver_full_name', d.full_name,
        'driver_phone', d.phone,
        'created_by_full_name', op.full_name,
        'created_by_role', op.role,
        'created_by_signature_name', op.signature_name,
        'latest_call_status', lc.status,
        'latest_called_by_profile_id', lc.called_by,
        'latest_called_by_full_name', cp.full_name,
        'latest_called_by_role', cp.role,
        'latest_called_by_signature_name', cp.signature_name,
        'latest_called_at', lc.called_at,
        'latest_call_comment', lc.comment,
        'latest_call_client_mutation_id', lc.client_mutation_id,
        'latest_call_sync_status', lc.sync_status
      )
      order by p.queue_number asc, p.id asc
    )
    from projected p
    left join public.vehicles v on v.id = p.vehicle_id
    left join public.drivers d on d.id = p.driver_id
    left join public.profiles op on op.id = p.operator_id
    left join latest_calls lc on lc.reservation_id = p.id
    left join public.profiles cp on cp.id = lc.called_by
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sync_offline_mutation(
  client_mutation_id uuid,
  operation_type text,
  payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if operation_type = 'CREATE_RESERVATION' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_reservation(
        payload->>'plate_number',
        payload->>'driver_full_name',
        payload->>'driver_phone',
        payload->>'fuel_type',
        (payload->>'requested_liters')::numeric,
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  if operation_type = 'CREATE_FUELING_RECORD' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_fueling_record(
        (payload->>'station_id')::uuid,
        payload->>'plate_number',
        (payload->>'liters')::numeric,
        payload->>'fuel_type',
        (payload->>'target_date')::date,
        (payload->>'fueled_at')::timestamptz,
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  if operation_type = 'CREATE_MANUAL_OVERRIDE' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_manual_override(
        (payload->>'target_date')::date,
        (payload->>'station_id')::uuid,
        payload->>'plate_number',
        payload->>'reason',
        nullif(payload->>'expires_at', '')::timestamptz,
        client_mutation_id
      )
    );
  end if;

  if operation_type = 'CREATE_RESERVATION_CALL_LOG' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_reservation_call_log(
        (payload->>'reservation_id')::uuid,
        payload->>'status',
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  raise exception 'UNSUPPORTED_OFFLINE_OPERATION';
exception
  when others then
    return jsonb_build_object(
      'status', 'CONFLICT',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'reason', sqlerrm,
      'payload', payload
    );
end;
$$;

grant execute on function public.create_reservation_call_log(uuid, text, text, uuid) to authenticated;
grant execute on function public.get_today_call_list(date) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
