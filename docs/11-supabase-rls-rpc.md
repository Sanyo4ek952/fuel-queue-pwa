# 11. Supabase RLS and RPC

## Rule

Critical business writes go through RPC. UI code must not insert or update queue, allocation, limit, call, fueling, refusal, or sync-conflict rows directly.

## Queue RPC

`create_reservation` and `create_consumer_reservation` create permanent `fuel_queue_entries`.

They do not accept date, station, or time. They return the saved queue entry and the confirmed `permanent_number`.

The server validates:

- actor role and active profile;
- vehicle and driver data;
- vehicle block state;
- duplicate active `WAITING` entry for the vehicle;
- idempotency by `client_mutation_id`.

`create_consumer_vehicle` rejects `VEHICLE_IN_ACTIVE_QUEUE` when a consumer tries to
add a госномер that already has a `WAITING` queue entry and the vehicle was not linked
to that consumer before the queue entry was created. The number can be added after the
entry leaves the active queue (`FUELED`, `CANCELLED`, `NO_SHOW`, `ERROR`, `CONFLICT`).

## Allocation RPC

`create_daily_limit` and `set_daily_fueling_schedule` save station/date configuration and then call the private allocator.

`allocate_daily_queue(target_date)` is private. Client roles do not get execute grants.

The allocator persists:

- station;
- assigned exact fuel type;
- daily and station positions;
- `arrival_at`;
- allocation status.

## Staff Queue RPC

`get_today_call_list` returns saved `daily_queue_allocations` joined with `fuel_queue_entries`.

Pagination and filters use persisted `daily_position` and IDs. They do not recalculate positions, summaries, counters, or ETA.

`create_reservation_call_log` accepts an `allocation_id`. It stores the call log in `daily_queue_allocation_call_logs` and updates `daily_queue_allocations.call_status`.

Allowed call statuses:

- `NOT_CALLED`.
- `CONTACTED`.
- `NO_ANSWER`.

Calling status does not decide fueling access.

## Access and Fueling RPC

`check_vehicle_access` allows normal fueling only when the requested date and station have an `ACTIVE` allocation for that vehicle. The exact assigned fuel type must match the fueling request.

`create_fueling_record` accepts an allocation. It rechecks:

- active allocation;
- station;
- exact assigned fuel type;
- one regular fueling per vehicle per date across all stations;
- vehicle block/manual override rules.

On success it writes `fueling_records`, marks the allocation `FUELED`, and marks the permanent queue entry `FUELED`.

## Public and Consumer RPC

`get_my_queue_status`, public queue check, reports, and backup return the permanent queue entry plus a nullable saved daily allocation.

`get_my_queue_status` and `cancel_my_reservation` expose/modify a consumer queue entry
only when the consumer created that entry or had the vehicle linked before the entry
was created. A profile link created after a `WAITING` entry does not give access to
view or cancel that queue entry.

Public responses must not expose personal data.

## Finalizer

`finalize_daily_queue(target_date)` is service-role-only and idempotent.

It converts unfinished active allocations:

- `CONTACTED` or `NO_ANSWER` to `MISSED`;
- `NOT_CALLED` to `EXPIRED`;
- `PAUSED_BY_LIMIT` stays unchanged.

Miss counters are derived from finalized daily allocations. After the configured `reservation_no_show_grace_days` threshold, the permanent queue entry becomes `NO_SHOW`.

## Offline RPC

`sync_offline_mutation` accepts:

- `CREATE_RESERVATION`;
- `CREATE_ALLOCATION_CALL_LOG`;
- `CREATE_FUELING_RECORD`;
- `CREATE_REFUSAL_RECORD`;
- `CREATE_MANUAL_OVERRIDE`;
- limit and settings mutations used by staff.

Offline-created queue entries are pending until the server returns a real `permanent_number`. Offline calls and fueling are allowed only from a cached saved allocation snapshot.

## Grants

Authenticated users receive execute grants only for public/staff RPC they need. Private allocator and finalizer are not callable by browser roles.

Direct table writes are blocked for critical queue tables by RLS and grants.
