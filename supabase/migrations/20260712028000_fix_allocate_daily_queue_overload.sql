ALTER FUNCTION public.allocate_daily_queue(date, boolean) RENAME TO allocate_daily_queue_impl;

REVOKE ALL ON FUNCTION public.allocate_daily_queue_impl(date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue_impl(date, boolean) FROM authenticated;
GRANT ALL ON FUNCTION public.allocate_daily_queue_impl(date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.allocate_daily_queue(
  target_date date,
  preserve_existing_eta boolean
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  select public.allocate_daily_queue_impl(target_date, preserve_existing_eta);
$$;

CREATE OR REPLACE FUNCTION public.allocate_daily_queue(target_date date) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  select public.allocate_daily_queue_impl(target_date, false);
$$;

ALTER FUNCTION public.allocate_daily_queue_impl(date, boolean) OWNER TO postgres;
ALTER FUNCTION public.allocate_daily_queue(date, boolean) OWNER TO postgres;
ALTER FUNCTION public.allocate_daily_queue(date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.allocate_daily_queue(date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date) FROM authenticated;

GRANT ALL ON FUNCTION public.allocate_daily_queue(date, boolean) TO service_role;
GRANT ALL ON FUNCTION public.allocate_daily_queue(date) TO service_role;
