# 05. Database Schema

## Current Queue Model

The queue is split into two durable records.

`fuel_queue_entries` is the permanent city queue entry. It stores only the immutable city number, vehicle, driver, preferred fuel type, preference mode, requested liters, author, sync/idempotency metadata, comments, and the permanent status.

`daily_queue_allocations` is the saved daily assignment. It stores date, queue entry, station, assigned exact fuel type, allocated liters snapshot, daily position, station position, station fuel position, `arrival_at`, allocation status, call status, pause/fueling/finalization timestamps, and audit timestamps.

Station, date, position, counters, and ETA are not computed on the client and are not recomputed during reads. They are written by the server allocator.

## Core Tables

### stations

Stations have a stable `allocation_order`. The allocator uses it as a tie-breaker after remaining capacity, then UUID.

### fuel_queue_entries

Important fields:

- `permanent_number bigint`: generated from `fuel_queue_permanent_number_seq`, unique and immutable.
- `vehicle_id`, `driver_id`.
- `preferred_fuel_type`: `AI_92`, `AI_95`, `AI_100`, `DIESEL`, or `GAS`.
- `fuel_preference_mode`: `EXACT` or `ANY_GASOLINE`.
- `requested_liters`.
- `status`: `WAITING`, `FUELED`, `CANCELLED`, `NO_SHOW`, `ERROR`, `CONFLICT`.
- `operator_id`, `comment`, `client_mutation_id`, `sync_status`.

Only one `WAITING` queue entry is allowed per vehicle. The permanent number is never reused.

### daily_queue_allocations

Important fields:

- `allocation_date`.
- `queue_entry_id`.
- `station_id`.
- `assigned_fuel_type`.
- `allocated_liters`.
- `daily_position`, `station_position`, `station_fuel_position`.
- `arrival_at`.
- `status`: `ACTIVE`, `PAUSED_BY_LIMIT`, `FUELED`, `MISSED`, `EXPIRED`.
- `call_status`: `NOT_CALLED`, `CONTACTED`, `NO_ANSWER`.

There is at most one allocation for `(allocation_date, queue_entry_id)`. Active and fueled allocations have persisted daily positions.

### daily_queue_allocation_call_logs

Call logs reference only `daily_queue_allocations`. The call status is also denormalized onto the allocation so access checks do not need to replay call history.

### daily_limits and daily_fuel_type_limits

`daily_limits` stores the station and date envelope. `daily_fuel_type_limits` stores exact fuel limits:

- `fuel_type`.
- `vehicle_limit`.
- optional cumulative `liters_limit`.
- `status`: `OPEN` or `PAUSED`.

Vehicle and liters limits apply together. A missing liters limit means only the vehicle limit is applied.

### daily_fueling_schedules

Schedules are unique by `(date, station_id, fuel_category)`.

Fuel categories:

- `GASOLINE`.
- `DIESEL`.
- `GAS`.

The allocator uses the schedule for the allocation station and the assigned fuel category to persist `arrival_at`.

### fueling_records

Regular fueling records must reference both:

- `allocation_id`.
- `queue_entry_id`.

The record also stores the actual station, vehicle, driver, exact fuel type, liters, cashier, sync metadata, and `fueled_at`. The daily one-fueling rule is enforced for regular fueling records across all stations.

Manual overrides may exist without a queue allocation.

### refusal_records, manual_overrides, audit_logs

These remain supporting operational tables. Refusals and manual overrides are still date/station scoped, while the normal fueling path is driven by the saved allocation.

## Allocation Functions

`allocate_daily_queue(target_date)` runs under an advisory lock and is not granted to client roles. It is called after saving daily limits or fueling schedules.

The allocator:

- keeps already fueled allocations unchanged;
- processes old `PAUSED_BY_LIMIT` allocations first by permanent number;
- processes the remaining `WAITING` queue entries by permanent number;
- matches `EXACT` only to the requested exact fuel;
- matches `ANY_GASOLINE` to the requested gasoline first, then `AI_92`, `AI_95`, `AI_100`;
- chooses the station with the largest remaining capacity;
- persists station, fuel, positions, and `arrival_at`;
- pauses non-fueled rows that no longer fit as `PAUSED_BY_LIMIT`.

`finalize_daily_queue(target_date)` is service-role-only and idempotent. It turns contacted or no-answer unfinished active allocations into `MISSED`, turns not-called unfinished active allocations into `EXPIRED`, skips `PAUSED_BY_LIMIT`, and advances the permanent queue entry to `NO_SHOW` after the configured missed-allocation threshold.

## RPC Surface

Critical writes go through RPC:

- `create_reservation`.
- `create_consumer_reservation`.
- `create_daily_limit`.
- `set_daily_fueling_schedule`.
- `create_reservation_call_log`.
- `check_vehicle_access`.
- `create_fueling_record`.
- `sync_offline_mutation`.
- `finalize_daily_queue` for service role.

Public and consumer queries return the permanent queue entry plus a nullable saved daily allocation.
