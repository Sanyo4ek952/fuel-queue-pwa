create or replace function public.cancel_preferential_queue_entry(
  entry_id uuid,
  comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
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

grant execute on function public.cancel_preferential_queue_entry(uuid, text) to authenticated;
