-- Page 21: bounded, branch-scoped, assignment-scoped client lookup. Search text
-- is never copied into audit metadata or a URL. The final assessment snapshot
-- still rechecks the selected client's current authority independently.
begin;
set local lock_timeout = '5s';

create function private.abcd_assessment_client_search(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_query text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_query text := btrim(p_query);
  v_pattern text;
  v_recent_count bigint;
  v_clients jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  if not private.abcd_assessment_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'abcd_assessments.read') then
    raise exception using errcode = '42501', message = 'ABCD client search is not permitted';
  end if;
  if v_query is null or char_length(v_query) not between 2 and 64
    or v_query ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'ABCD client search query is invalid';
  end if;

  -- Audit rows are the durable rate ledger. Serialize this actor's lookups so
  -- simultaneous tabs cannot race past the twenty-search/minute bound.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('abcd_assessment_client_search'),
    pg_catalog.hashtext(v_actor::text));
  v_now := clock_timestamp();
  select count(*) into v_recent_count from public.audit_events event
  where event.actor_user_id = v_actor and event.action = 'select'
    and event.table_name = 'abcd_assessment_client_search'
    and event.occurred_at >= v_now - interval '1 minute';
  if v_recent_count >= 20 then
    raise exception using errcode = 'P4290', message = 'ABCD client search rate limit exceeded';
  end if;

  -- Treat percent, underscore and backslash as literal input, never patterns.
  v_pattern := '%' || replace(replace(replace(v_query,
    chr(92), chr(92) || chr(92)), '%', chr(92) || '%'),
    '_', chr(92) || '_') || '%';
  with candidates as materialized (
    select client.id, client.display_name, client.client_code
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and (client.display_name ilike v_pattern escape E'\\'
        or client.client_code ilike v_pattern escape E'\\')
      and private.abcd_assessment_visible_client(client.id, 'clients.read')
      and private.abcd_assessment_visible_client(client.id, 'abcd_assessments.read')
    order by client.display_name collate "C", client.id
    limit 21
  ), ranked as (
    select candidate.*,
      row_number() over (order by candidate.display_name collate "C", candidate.id) as rank
    from candidates candidate
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', ranked.id,
      'display_name', ranked.display_name,
      'client_code', left(ranked.client_code, 64),
      'client_code_truncated', char_length(ranked.client_code) > 64
    ) order by ranked.rank) filter (where ranked.rank <= 20), '[]'::jsonb),
    count(*) > 20
  into v_clients, v_has_more
  from ranked;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata, occurred_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'abcd_assessment_client_search', 'bounded_lookup', array[]::text[],
    jsonb_build_object('workflow', 'page21_client_picker',
      'query_logged', false, 'result_count', jsonb_array_length(v_clients),
      'has_more', v_has_more), v_now
  );
  if not private.abcd_assessment_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'abcd_assessments.read') then
    raise exception using errcode = '42501', message = 'ABCD client search authority expired';
  end if;
  return jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'clients', v_clients,
    'has_more', v_has_more
  );
end;
$$;

create function public.abcd_assessment_client_search(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_query text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select private.abcd_assessment_client_search(
    p_expected_organization_id, p_expected_branch_id, p_query);
$$;

revoke all on function private.abcd_assessment_client_search(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.abcd_assessment_client_search(uuid, uuid, text)
  to authenticated;
revoke all on function public.abcd_assessment_client_search(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.abcd_assessment_client_search(uuid, uuid, text)
  to authenticated;
commit;
