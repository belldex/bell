CREATE OR REPLACE FUNCTION public.bump_api_quota(p_scope text, p_resource text, p_period text, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_used numeric(39,0);
BEGIN
  INSERT INTO quota_counters (account_scope, resource, period, estimated_usage, observed_usage, reserved_allowance)
  VALUES (p_scope, p_resource, p_period, 1, 0, 0)
  ON CONFLICT (account_scope, resource, period) DO UPDATE
    SET estimated_usage = quota_counters.estimated_usage + 1
  RETURNING estimated_usage INTO v_used;
  -- Retention: discard periods older than 10 minutes (the table is small and inexpensive).
  DELETE FROM quota_counters WHERE resource = p_resource AND period < to_char(now() - interval '10 minutes', 'YYYY-MM-DD"T"HH24:MI');
  RETURN jsonb_build_object('used', v_used, 'admitted', v_used <= p_limit);
END $$;
REVOKE ALL ON FUNCTION public.bump_api_quota(text, text, text, integer) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.bump_api_quota(text, text, text, integer) TO service_role;
