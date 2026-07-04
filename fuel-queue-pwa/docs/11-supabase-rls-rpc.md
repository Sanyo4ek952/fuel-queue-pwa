# 11. Supabase RLS and RPC

## Цель

Supabase должен защищать данные на уровне базы.

Нужны:

- RLS;
- функции доступа;
- RPC для критичных операций;
- audit logs.

## Почему RLS обязательно

Если полагаться только на UI, пользователь может попытаться вызвать API напрямую.

RLS ограничивает доступ на уровне базы.

## Helper functions

Нужны PostgreSQL helper functions:

```sql
get_current_profile_id()
get_current_user_role()
can_access_station(station_id uuid)
has_role(required_roles text[])
```

## RPC функции

### check_vehicle_access

Параметры:

```text
plate_number
station_id
date
```

Проверяет:

- нормализацию номера;
- запись на дату;
- факт заправки по всем АЗС;
- блокировку;
- ручные разрешения;
- доступ пользователя к АЗС.

### create_reservation

Проверяет:

- роль пользователя;
- доступ к АЗС;
- лимит на дату;
- лимит по топливу;
- отсутствие активной записи автомобиля на эту дату;
- блокировку автомобиля.

### create_fueling_record

Проверяет:

- роль cashier/shift_supervisor/station_admin;
- наличие активной записи;
- отсутствие заправки сегодня по всем АЗС;
- лимит литров;
- ручное разрешение, если есть.

### create_daily_limit

Проверяет:

- роль shift_supervisor/station_admin;
- доступ к АЗС;
- корректность лимитов.

### create_manual_override

Проверяет:

- роль shift_supervisor/station_admin;
- причину;
- дату;
- автомобиль.

### sync_offline_mutation

Принимает:

```text
client_mutation_id
operation_type
payload
```

Сервер сам решает:

- применить;
- отклонить;
- вернуть конфликт.

## Idempotency

Все mutation RPC должны учитывать `client_mutation_id`.

Если операция с таким `client_mutation_id` уже была применена, сервер не должен создавать дубль.

## Транзакции

Критичные операции должны выполняться атомарно:

- проверка лимита;
- создание записи;
- присвоение queue_number;
- audit log.

## Audit log

RPC должен писать audit log для:

- создания записи;
- изменения статуса;
- заправки;
- отказа;
- ручного разрешения;
- изменения лимита;
- решения конфликта.

## Запрещено

Нельзя:

- делать критичные insert/update напрямую с клиента;
- доверять роли из localStorage;
- проверять лимит только на frontend;
- создавать fueling_record без проверки на сервере.
