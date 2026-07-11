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

- роль mayor/station_manager/mayor_assistant;
- доступ к АЗС;
- лимит на дату;
- лимит по топливу;
- отсутствие активной записи автомобиля на эту дату;
- блокировку автомобиля.
- сохраняет автора записи в `fuel_reservations.operator_id`.
- сохраняет `fuel_preference_mode`, по умолчанию `EXACT`.

### get_today_call_list

Возвращает общую очередь по `queue_number` и серверные поля обзвона:

```text
is_callable_now
call_unavailable_reason
matched_fuel_type
fuel_preference_mode
preferred_fuel_type
```

`is_callable_now` вычисляется на сервере по активному статусу записи, факту заправки, блокировке автомобиля, совместимости топлива и точному дневному лимиту выбранной марки.
Для заявок из личного кабинета без `station_id` дневной лимит считается по
сумме открытых лимитов всех АЗС; конкретная АЗС проверяется уже при допуске к
заправке.

### create_reservation_call_log

Проверяет активность записи.

Allowed statuses are `NOT_CALLED`, `CONTACTED`, and `NO_ANSWER`.
`CALL_LATER` and `WRONG_NUMBER` are rejected with `INVALID_CALL_STATUS`.

Для любого нового статуса звонка требует `is_callable_now = true`; иначе возвращает ошибку `RESERVATION_NOT_CALLABLE`.
`NOT_CALLED` is additionally allowed only as a reset after latest `CONTACTED`.

`NO_ANSWER` is a valid call result. If the reservation remains `RESERVED`, is within the exact daily fuel limit, and the vehicle has not fueled on the date, access can be allowed for that date. If the driver still does not fuel, the no-show policy counts the date as one missed fueling day.

### check_public_queue_position

Публичный RPC не раскрывает ФИО, телефон, комментарии и автора записи.

Безопасные поля ответа:

```text
queue_number
preferred_fuel_type
fuel_preference_mode
public_status
is_within_today_limit
is_callable_now
matched_fuel_type
```

### create_fueling_record

Проверяет:

- роль mayor/station_manager/cashier;
- наличие активной записи;
- отсутствие заправки сегодня по всем АЗС;
- лимит литров;
- ручное разрешение, если есть.

### create_daily_limit

Проверяет:

- роль mayor/station_manager;
- доступ к АЗС;
- корректность лимитов.

### create_manual_override

Проверяет:

- роль mayor/station_manager;
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
