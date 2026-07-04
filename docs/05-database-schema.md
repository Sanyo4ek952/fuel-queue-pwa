# 05. Database Schema

## Общие правила

База данных — Supabase PostgreSQL.

Критичные операции должны быть защищены:

- RLS;
- RPC;
- транзакциями;
- уникальными ограничениями;
- audit log.

## Таблицы

### stations

```sql
create table stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### profiles

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### user_stations

```sql
create table user_stations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, station_id)
);
```

### vehicles

```sql
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null,
  normalized_plate_number text not null unique,
  is_blocked boolean not null default false,
  block_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### drivers

```sql
create table drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### daily_limits

```sql
create table daily_limits (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references stations(id),
  total_vehicle_limit integer not null,
  max_liters_per_vehicle numeric(10,2) not null,
  status text not null default 'OPEN',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(date, station_id)
);
```

### daily_fuel_type_limits

```sql
create table daily_fuel_type_limits (
  id uuid primary key default gen_random_uuid(),
  daily_limit_id uuid not null references daily_limits(id) on delete cascade,
  fuel_type text not null,
  vehicle_limit integer not null,
  liters_limit numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(daily_limit_id, fuel_type)
);
```

### fuel_reservations

```sql
create table fuel_reservations (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references stations(id),
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  fuel_type text not null,
  requested_liters numeric(10,2) not null,
  queue_number integer not null,
  status text not null default 'RESERVED',
  operator_id uuid not null references profiles(id),
  approved_by uuid references profiles(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(date, station_id, queue_number)
);
```

Частичный уникальный индекс:

```sql
create unique index unique_active_reservation_per_vehicle_day
on fuel_reservations(date, vehicle_id)
where status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');
```

### queue_entries

```sql
create table queue_entries (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references stations(id),
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  reservation_id uuid references fuel_reservations(id),
  fuel_type text not null,
  requested_liters numeric(10,2) not null,
  status text not null default 'WAITING',
  operator_id uuid not null references profiles(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### fueling_records

```sql
create table fueling_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references stations(id),
  vehicle_id uuid not null references vehicles(id),
  driver_id uuid references drivers(id),
  reservation_id uuid references fuel_reservations(id),
  queue_entry_id uuid references queue_entries(id),
  fuel_type text not null,
  liters numeric(10,2) not null,
  cashier_id uuid not null references profiles(id),
  is_manual_override boolean not null default false,
  override_id uuid,
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED',
  fueled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Индекс для обычных заправок:

```sql
create unique index unique_regular_fueling_per_vehicle_day
on fueling_records(date, vehicle_id)
where is_manual_override = false;
```

### refusal_records

```sql
create table refusal_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references stations(id),
  vehicle_id uuid references vehicles(id),
  driver_id uuid references drivers(id),
  reservation_id uuid references fuel_reservations(id),
  queue_entry_id uuid references queue_entries(id),
  reason text not null,
  comment text,
  user_id uuid not null references profiles(id),
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED',
  created_at timestamptz not null default now()
);
```

### manual_overrides

```sql
create table manual_overrides (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references stations(id),
  vehicle_id uuid not null references vehicles(id),
  reason text not null,
  approved_by uuid not null references profiles(id),
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### audit_logs

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
```

## Enum значения

### roles

```text
operator
cashier
shift_supervisor
station_admin
city_admin
viewer
```

### fuel types

```text
AI_92
AI_95
AI_100
DIESEL
GAS
OTHER
```

### statuses

```text
RESERVED
ARRIVED
APPROVED
FUELING
FUELED
REJECTED
CANCELLED
NO_SHOW
EXPIRED
ERROR
CONFLICT
```

### sync statuses

```text
SYNCED
PENDING
SYNCING
FAILED
CONFLICT
```

## Индексы

```sql
create index idx_vehicles_normalized_plate on vehicles(normalized_plate_number);
create index idx_reservations_date_station on fuel_reservations(date, station_id);
create index idx_reservations_vehicle_date on fuel_reservations(vehicle_id, date);
create index idx_fueling_vehicle_date on fueling_records(vehicle_id, date);
create index idx_queue_date_station on queue_entries(date, station_id);
create index idx_audit_entity on audit_logs(entity_type, entity_id);
```
