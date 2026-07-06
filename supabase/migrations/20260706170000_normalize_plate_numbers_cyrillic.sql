set search_path = public, extensions;

create or replace function public.normalize_plate_number(value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := upper(regexp_replace(coalesce(value, ''), '[^0-9A-Za-zАВЕКМНОРСТУХавекмнорстух]', '', 'g'));
  normalized := translate(
    normalized,
    'ABEKMHOPCTYXabekmhopctyx',
    'АВЕКМНОРСТУХАВЕКМНОРСТУХ'
  );
  normalized := regexp_replace(normalized, '[^0-9АВЕКМНОРСТУХ]', '', 'g');

  return normalized;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.vehicles
    group by public.normalize_plate_number(normalized_plate_number)
    having count(*) > 1
  ) then
    raise exception 'Cannot migrate vehicles.normalized_plate_number to Cyrillic: duplicate normalized values found.';
  end if;
end;
$$;

update public.vehicles
set
  normalized_plate_number = public.normalize_plate_number(normalized_plate_number),
  plate_number = coalesce(
    nullif(public.normalize_plate_number(plate_number), ''),
    public.normalize_plate_number(normalized_plate_number)
  );

update public.vehicles
set plate_number = normalized_plate_number;

create or replace function public.normalize_vehicle_plate_columns()
returns trigger
language plpgsql
as $$
begin
  new.normalized_plate_number := public.normalize_plate_number(
    coalesce(new.normalized_plate_number, new.plate_number)
  );
  new.plate_number := new.normalized_plate_number;
  return new;
end;
$$;

drop trigger if exists normalize_vehicle_plate_columns on public.vehicles;

create trigger normalize_vehicle_plate_columns
before insert or update of plate_number, normalized_plate_number
on public.vehicles
for each row
execute function public.normalize_vehicle_plate_columns();

alter table public.vehicles
drop constraint if exists vehicles_normalized_plate_format;

alter table public.vehicles
add constraint vehicles_normalized_plate_format
check (normalized_plate_number ~ '^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}[0-9]{2,3}$')
not valid;
