-- Harden client identity reads behind audited, assignment-safe projections.
-- The base table remains available to owner-only SECURITY DEFINER workflows,
-- but is no longer a browser/service-role read surface.

create type public.client_directory_purpose as enum (
  'case_center',
  'core_daily',
  'blood_glucose',
  'client_registry',
  'client_lifecycle',
  'care_plans',
  'service_usage',
  'offline_sync',
  'medication_plan'
);

revoke all on type public.client_directory_purpose
  from public, anon, authenticated, service_role;
grant usage on type public.client_directory_purpose to authenticated;

insert into public.permissions (permission_key, description, risk_level)
values (
  'clients.demographics.read',
  'Read authorized client demographic fields such as date of birth',
  2
)
on conflict (permission_key) do update
set
  description = excluded.description,
  risk_level = excluded.risk_level,
  updated_at = clock_timestamp();

insert into public.role_permissions (role_id, permission_id)
select role_id, permission.id
from unnest(array[
  '10000000-0000-4000-8000-000000000002'::uuid,
  '10000000-0000-4000-8000-000000000003'::uuid,
  '10000000-0000-4000-8000-000000000004'::uuid,
  '10000000-0000-4000-8000-000000000005'::uuid
]) as allowed(role_id)
cross join public.permissions permission
where permission.permission_key = 'clients.demographics.read'
on conflict (role_id, permission_id) do nothing;

-- A session may retain more than one consumed challenge while reauth_events is
-- the unique mutable pointer to the current one. Filter freshness first and
-- still order deterministically before binding the immutable write receipt.
create or replace function private.current_client_master_reauth_challenge()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := clock_timestamp();
  v_challenge_id uuid;
begin
  if v_actor is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for client master changes';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for client master changes';
  end;

  select challenge.id
    into v_challenge_id
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = v_actor
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and reauth.verified_at >= v_now - interval '15 minutes'
    and reauth.verified_at <= v_now + interval '1 minute'
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
    and challenge.factor_verified_at >= v_now - interval '15 minutes'
    and challenge.factor_verified_at <= v_now + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  if v_challenge_id is null then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for client master changes';
  end if;

  return v_challenge_id;
end;
$$;

-- Preserve the page-60 RPC signature while masking DOB independently from the
-- general identity permission. Audit metadata remains aggregate-only.
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
  v_can_read_demographics boolean;
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

  v_can_read_demographics := (select private.has_permission(
    p_expected_organization_id,
    p_expected_branch_id,
    'clients.demographics.read'
  ));

  return query
    select
      client.id,
      client.organization_id,
      client.branch_id,
      client.client_code,
      client.display_name,
      case when v_can_read_demographics then client.date_of_birth else null end,
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
      'result_count', v_result_count,
      'demographics_included', v_can_read_demographics
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
  'Returns the page-60 minimum client projection in assigned scope, masks demographics without field permission, and audits each view/search.';

-- General app client lists use this smaller projection. It cannot return DOB,
-- identifiers, ciphertext, or source evidence, and every bounded page is
-- purpose-labelled and audited.
create or replace function private.client_directory_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_purpose public.client_directory_purpose,
  p_page_size integer default 200,
  p_after_client_code text default null,
  p_after_client_id uuid default null,
  p_exact_client_id uuid default null
)
returns table(
  client_id uuid,
  organization_id uuid,
  branch_id uuid,
  client_code text,
  display_name text,
  status public.client_status,
  admitted_on date,
  ended_on date,
  row_version bigint,
  updated_at timestamptz,
  visible_count bigint,
  has_more boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_required_permission text;
  v_result_count integer;
begin
  v_required_permission := case p_purpose
    when 'blood_glucose' then 'health.read'
    when 'care_plans' then 'care_plans.read'
    when 'service_usage' then 'services.read'
    when 'offline_sync' then 'sync.use'
    when 'medication_plan' then 'medications.read'
    else 'clients.read'
  end;

  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_purpose is null
     or p_page_size is null
     or p_page_size not between 1 and 200
     or ((p_after_client_code is null) <> (p_after_client_id is null))
     or (p_after_client_code is not null and (
       char_length(p_after_client_code) not between 1 and 64
       or p_after_client_code <> btrim(p_after_client_code)
       or p_after_client_code ~ '[[:cntrl:]]'
     ))
     or (p_exact_client_id is not null and p_after_client_id is not null)
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
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       v_required_permission
     )) then
    raise exception using
      errcode = '42501',
      message = 'client directory snapshot is not permitted in the selected tenant context';
  end if;

  return query
    with visible as materialized (
      select
        client.id,
        client.organization_id,
        client.branch_id,
        client.client_code,
        client.display_name,
        client.status,
        client.admitted_on,
        client.ended_on,
        client.row_version,
        client.updated_at
      from public.clients client
      where client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
        and (p_exact_client_id is null or client.id = p_exact_client_id)
        and (select private.can_staff_access_client(client.id, 'clients.read'))
    ),
    paged as materialized (
      select visible.*
      from visible
      where p_after_client_code is null
         or (visible.client_code, visible.id) >
            (p_after_client_code, p_after_client_id)
      order by visible.client_code, visible.id
      limit p_page_size + 1
    )
    select
      paged.id,
      paged.organization_id,
      paged.branch_id,
      paged.client_code,
      paged.display_name,
      paged.status,
      paged.admitted_on,
      paged.ended_on,
      paged.row_version,
      paged.updated_at,
      (select count(*)::bigint from visible),
      (select count(*) > p_page_size from paged)
    from paged
    order by paged.client_code, paged.id
    limit p_page_size;

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
      'projection', 'client_directory_minimal',
      'purpose', p_purpose,
      'result_count', v_result_count,
      'page_size', p_page_size,
      'has_cursor', p_after_client_id is not null,
      'exact_lookup', p_exact_client_id is not null
    )
  );
end;
$$;

create or replace function public.client_directory_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_purpose public.client_directory_purpose,
  p_page_size integer default 200,
  p_after_client_code text default null,
  p_after_client_id uuid default null,
  p_exact_client_id uuid default null
)
returns table(
  client_id uuid,
  organization_id uuid,
  branch_id uuid,
  client_code text,
  display_name text,
  status public.client_status,
  admitted_on date,
  ended_on date,
  row_version bigint,
  updated_at timestamptz,
  visible_count bigint,
  has_more boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.client_directory_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_purpose,
    p_page_size,
    p_after_client_code,
    p_after_client_id,
    p_exact_client_id
  );
$$;

comment on function public.client_directory_snapshot(
  uuid, uuid, public.client_directory_purpose, integer, text, uuid, uuid
) is
  'Returns an audited, assignment-safe, keyset-paginated minimum client directory without demographics or source evidence.';

-- The public write RPCs are the only authenticated entrypoints. Their DB-side
-- checks now exactly include the API read+manage+demographic-field contract;
-- creation additionally requires branch-wide visibility so the new unassigned
-- row cannot disappear from the creator immediately after commit. Until the
-- API supports field-preserving PATCH, callers without DOB read authority must
-- not blindly erase or replace that field through the combined form.
create or replace function private.create_local_client_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.demographics.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.view_all'
     )) then
    raise exception using
      errcode = '42501',
      message = 'local client creation requires read, manage, demographic field, and branch-wide client authority';
  end if;

  return query
    select created.operation_id, created.client_id,
           created.row_version, created.replayed
    from private.create_local_client_atomic(
      p_expected_organization_id,
      p_expected_branch_id,
      p_client_code,
      p_display_name,
      p_date_of_birth,
      p_idempotency_key
    ) created;
end;
$$;

create or replace function public.create_local_client(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.create_local_client_guarded(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_code,
    p_display_name,
    p_date_of_birth,
    p_idempotency_key
  );
$$;

create or replace function private.update_local_client_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.demographics.read'
     ))
     or not (select private.can_staff_access_client(
       p_client_id, 'clients.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'local client update requires current assignment, read, manage, and demographic field authority';
  end if;

  return query
    select updated.operation_id, updated.client_id,
           updated.row_version, updated.replayed
    from private.update_local_client_atomic(
      p_expected_organization_id,
      p_expected_branch_id,
      p_client_id,
      p_client_code,
      p_display_name,
      p_date_of_birth,
      p_expected_row_version,
      p_idempotency_key
    ) updated;
end;
$$;

create or replace function public.update_local_client(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.update_local_client_guarded(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_client_code,
    p_display_name,
    p_date_of_birth,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

revoke all on function private.client_master_snapshot(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.client_master_snapshot(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.client_directory_snapshot(
  uuid, uuid, public.client_directory_purpose, integer, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.client_directory_snapshot(
  uuid, uuid, public.client_directory_purpose, integer, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.create_local_client_atomic(
  uuid, uuid, text, text, date, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.update_local_client_atomic(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.create_local_client_guarded(
  uuid, uuid, text, text, date, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.update_local_client_guarded(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.create_local_client(
  uuid, uuid, text, text, date, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.update_local_client(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.client_master_snapshot(uuid, uuid, text)
  to authenticated;
grant execute on function private.client_master_snapshot(uuid, uuid, text)
  to authenticated;
grant execute on function public.client_directory_snapshot(
  uuid, uuid, public.client_directory_purpose, integer, text, uuid, uuid
) to authenticated;
grant execute on function private.client_directory_snapshot(
  uuid, uuid, public.client_directory_purpose, integer, text, uuid, uuid
) to authenticated;
grant execute on function private.create_local_client_guarded(
  uuid, uuid, text, text, date, uuid
) to authenticated;
grant execute on function private.update_local_client_guarded(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) to authenticated;
grant execute on function public.create_local_client(
  uuid, uuid, text, text, date, uuid
) to authenticated;
grant execute on function public.update_local_client(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) to authenticated;

-- Keep the daily service summary callable after raw client reads are revoked.
-- Client existence and all five assignment-safe permissions are established by
-- the existing SECURITY DEFINER access predicate; the public summary remains
-- SECURITY INVOKER and never reads the client base table itself.
create or replace function public.daily_service_summary(
  p_client_id uuid,
  p_service_date date default ((now() at time zone 'Asia/Taipei')::date)
)
returns table(
  client_id uuid,
  service_date date,
  authorized_care_plan_id uuid,
  client_service_plan_id uuid,
  attendance_count bigint,
  measurement_count bigint,
  care_record_count bigint,
  service_event_count bigint,
  attendance_source_ids uuid[],
  measurement_source_ids uuid[],
  care_record_source_ids uuid[],
  service_event_source_ids uuid[],
  snapshot_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select p_client_id as id
    where p_service_date is not null
      and (select private.can_staff_access_client(p_client_id, 'care_plans.read'))
      and (select private.can_staff_access_client(p_client_id, 'attendance.read'))
      and (select private.can_staff_access_client(p_client_id, 'health.read'))
      and (select private.can_staff_access_client(p_client_id, 'care_records.read'))
      and (select private.can_staff_access_client(p_client_id, 'services.read'))
  ),
  authorized_stream_terminal as (
    select distinct on (plan.plan_key)
      plan.id, plan.plan_key, plan.status, plan.version, plan.created_at
    from public.authorized_care_plans plan
    join target on target.id = plan.client_id
    where plan.status in ('signed', 'voided')
      and p_service_date between plan.effective_from and plan.effective_to
    order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
  ),
  authorized_terminal as (
    select terminal.id, terminal.status
    from authorized_stream_terminal terminal
    where terminal.status = 'signed'
      and (
        select count(*)
        from authorized_stream_terminal candidate
        where candidate.status = 'signed'
      ) = 1
  ),
  service_stream_terminal as (
    select distinct on (plan.plan_key)
      plan.id, plan.plan_key, plan.authorized_care_plan_id, plan.status,
      plan.version, plan.created_at
    from public.client_service_plans plan
    join target on target.id = plan.client_id
    where plan.status in ('signed', 'voided')
      and p_service_date between plan.effective_from and plan.effective_to
    order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
  ),
  service_terminal as (
    select terminal.id, terminal.status
    from service_stream_terminal terminal
    where terminal.status = 'signed'
      and terminal.authorized_care_plan_id = (
        select authorized.id
        from authorized_terminal authorized
        where authorized.status = 'signed'
      )
      and (
        select count(*)
        from service_stream_terminal candidate
        where candidate.status = 'signed'
      ) = 1
  ),
  attendance_source as (
    select coalesce(array_agg(record.id order by record.created_at, record.id), '{}'::uuid[]) as ids
    from public.attendance_records record
    join target on target.id = record.client_id
    where record.service_date = p_service_date
      and record.status <> 'cancelled'
  ),
  measurement_source as (
    select coalesce(array_agg(record.id order by record.measured_at, record.id), '{}'::uuid[]) as ids
    from public.measurements record
    join target on target.id = record.client_id
    where record.measured_at >= (p_service_date::timestamp at time zone 'Asia/Taipei')
      and record.measured_at < ((p_service_date + 1)::timestamp at time zone 'Asia/Taipei')
  ),
  care_source as (
    select coalesce(array_agg(record.id order by record.occurred_at, record.id), '{}'::uuid[]) as ids
    from public.care_records record
    join target on target.id = record.client_id
    where record.occurred_at >= (p_service_date::timestamp at time zone 'Asia/Taipei')
      and record.occurred_at < ((p_service_date + 1)::timestamp at time zone 'Asia/Taipei')
      and record.status <> 'voided'
  ),
  service_source as (
    select coalesce(array_agg(record.id order by record.started_at, record.id), '{}'::uuid[]) as ids
    from public.service_events record
    join target on target.id = record.client_id
    where record.started_at >= (p_service_date::timestamp at time zone 'Asia/Taipei')
      and record.started_at < ((p_service_date + 1)::timestamp at time zone 'Asia/Taipei')
      and record.status <> 'voided'
  )
  select
    target.id,
    p_service_date,
    (select id from authorized_terminal where status = 'signed'),
    (select id from service_terminal where status = 'signed'),
    cardinality(attendance_source.ids)::bigint,
    cardinality(measurement_source.ids)::bigint,
    cardinality(care_source.ids)::bigint,
    cardinality(service_source.ids)::bigint,
    attendance_source.ids,
    measurement_source.ids,
    care_source.ids,
    service_source.ids,
    statement_timestamp()
  from target
  cross join attendance_source
  cross join measurement_source
  cross join care_source
  cross join service_source;
$$;

revoke select on table public.clients
  from public, anon, authenticated, service_role;
