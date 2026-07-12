alter table public.fueling_records
  drop constraint if exists fueling_records_regular_allocation_required;

alter table public.fueling_records
  add constraint fueling_records_regular_allocation_required
  check (
    is_manual_override
    or (allocation_id is not null and queue_entry_id is not null)
    or preferential_queue_entry_id is not null
  );
