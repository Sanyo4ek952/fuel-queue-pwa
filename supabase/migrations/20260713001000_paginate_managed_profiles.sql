CREATE OR REPLACE FUNCTION "public"."list_managed_profiles_page"(
  "section" "text",
  "page_limit" integer DEFAULT 10,
  "page_offset" integer DEFAULT 0
) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with params as (
    select
      case
        when section in ('pending', 'active', 'rejected', 'disabled') then section
        else 'pending'
      end as profile_section,
      least(greatest(coalesce(page_limit, 10), 1), 50) as take,
      greatest(coalesce(page_offset, 0), 0) as skip
  ),
  actor as (
    select public.get_current_profile_id() as profile_id, public.get_current_user_role() as role
  ),
  visible_profiles as (
    select p.*
    from public.profiles p
    cross join actor a
    where a.profile_id is not null
      and a.role in ('station_manager', 'mayor')
      and p.id <> a.profile_id
      and (
        a.role = 'mayor'
        or (
          p.role = 'cashier'
          and (
            (
              p.requested_station_id is not null
              and public.can_access_station(p.requested_station_id)
            )
            or exists (
              select 1
              from public.user_stations us
              where us.user_id = p.id
                and public.can_access_station(us.station_id)
            )
          )
        )
      )
  ),
  filtered_profiles as (
    select p.*
    from visible_profiles p
    cross join params prm
    where (
      (prm.profile_section = 'pending' and p.approval_status = 'pending')
      or (prm.profile_section = 'active' and p.approval_status = 'approved' and p.is_active)
      or (prm.profile_section = 'rejected' and p.approval_status = 'rejected')
      or (prm.profile_section = 'disabled' and p.approval_status = 'approved' and not p.is_active)
    )
  ),
  counted_profiles as (
    select p.*, count(*) over () as total_count
    from filtered_profiles p
  ),
  total_profiles as (
    select count(*) as total_count
    from filtered_profiles
  ),
  page_profiles as (
    select p.*
    from counted_profiles p
    cross join params prm
    order by
      case when prm.profile_section = 'active' then lower(p.full_name) end asc nulls last,
      case when prm.profile_section <> 'active' then p.created_at end desc nulls last,
      p.id
    limit (select take from params)
    offset (select skip from params)
  )
  select jsonb_build_object(
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'auth_user_id', p.auth_user_id,
          'full_name', p.full_name,
          'first_name', p.first_name,
          'last_name', p.last_name,
          'middle_name', p.middle_name,
          'position', p.position,
          'signature_name', p.signature_name,
          'role', p.role,
          'is_active', p.is_active,
          'approval_status', p.approval_status,
          'requested_station_id', p.requested_station_id,
          'requested_station_name', rs.name,
          'approved_by', p.approved_by,
          'approved_by_name', approver.full_name,
          'approved_at', p.approved_at,
          'rejected_by', p.rejected_by,
          'rejected_by_name', rejector.full_name,
          'rejected_at', p.rejected_at,
          'rejection_reason', p.rejection_reason,
          'deactivated_by', p.deactivated_by,
          'deactivated_by_name', deactivator.full_name,
          'deactivated_at', p.deactivated_at,
          'deactivation_reason', p.deactivation_reason,
          'created_at', p.created_at,
          'updated_at', p.updated_at,
          'stations', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'address', s.address
              )
              order by s.name
            )
            from public.user_stations us
            join public.stations s on s.id = us.station_id
            where us.user_id = p.id
          ), '[]'::jsonb)
        )
        order by
          case when prm.profile_section = 'active' then lower(p.full_name) end asc nulls last,
          case when prm.profile_section <> 'active' then p.created_at end desc nulls last,
          p.id
      ) filter (where p.id is not null),
      '[]'::jsonb
    ),
    'total_count', total.total_count,
    'has_more', ((select skip from params) + (select take from params)) < total.total_count
  )
  from params prm
  cross join total_profiles total
  left join page_profiles p on true
  left join public.stations rs on rs.id = p.requested_station_id
  left join public.profiles approver on approver.id = p.approved_by
  left join public.profiles rejector on rejector.id = p.rejected_by
  left join public.profiles deactivator on deactivator.id = p.deactivated_by
  group by prm.profile_section, total.total_count;
$$;


ALTER FUNCTION "public"."list_managed_profiles_page"("section" "text", "page_limit" integer, "page_offset" integer) OWNER TO "postgres";


REVOKE ALL ON FUNCTION "public"."list_managed_profiles_page"("section" "text", "page_limit" integer, "page_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_managed_profiles_page"("section" "text", "page_limit" integer, "page_offset" integer) TO "authenticated";
