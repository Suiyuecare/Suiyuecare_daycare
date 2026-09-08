-- Page 60 minimal read projection. Date of birth is sensitive, so every view
-- or search is authorization-checked and leaves a non-PII audit event.

create or replace function private.client_master_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_interaction text
)
returns table(
  client_id uuid,
  organization_id uuid,
  branch_id uuid,
  client_code text,
  display_name text,
  date_of_birth date,
  status public.client_status,
  admitted_on date,
  ended_on date,
  source_system text,
  source_updated_at timestamptz,
  row_version bigint,
  updated_at timestamptz,
  visible_count bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_interaction not in ('view', 'search')
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'client master snapshot is not permitted in the selected tenant context';
  end if;

  return query
    select
      client.id,
      client.organization_id,
      client.branch_id,
      client.client_code,
      client.display_name,
      client.date_of_birth,
      client.status,
      client.admitted_on,
      client.ended_on,
      client.source_system,
      client.source_updated_at,
      client.row_version,
      client.updated_at,
      count(*) over ()::bigint
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and (select private.can_staff_access_client(client.id, 'clients.read'))
    order by client.client_code, client.id;

  get diagnostics v_result_count = row_count;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    changed_fields,
    metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'clients',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page60_minimal',
      'interaction', p_interaction,
      'result_count', v_result_count
    )
  );
end;
$$;

create or replace function public.client_master_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_interaction text
)
returns table(
  client_id uuid,
  organization_id uuid,
  branch_id uuid,
  client_code text,
  display_name text,
  date_of_birth date,
  status public.client_status,
  admitted_on date,
  ended_on date,
  source_system text,
  source_updated_at timestamptz,
  row_version bigint,
  updated_at timestamptz,
  visible_count bigint
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.client_master_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_interaction
  );
$$;

comment on function public.client_master_snapshot(uuid, uuid, text) is
  'Returns the page-60 minimum client projection in assigned scope and audits each view/search without recording PII.';

revoke all on function private.client_master_snapshot(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.client_master_snapshot(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function private.client_master_snapshot(uuid, uuid, text)
  to authenticated;
grant execute on function public.client_master_snapshot(uuid, uuid, text)
  to authenticated;
