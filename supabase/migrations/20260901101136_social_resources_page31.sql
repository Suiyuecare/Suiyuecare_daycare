-- Page 31: tenant/branch scoped social-resource catalogue.
--
-- Resource types, audiences, qualification text, contacts, validity and
-- confirmation cadence are institution-owned facts.  This migration stores
-- them without inventing public-benefit eligibility rules. Missing and not
-- applicable are explicit states, never overloaded as empty strings.

insert into public.permissions (permission_key, description, risk_level)
values
  ('social_resources.read', 'Read branch social-resource catalogue', 1),
  ('social_resources.manage', 'Create, update, confirm and deactivate social resources', 2)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission
  on permission.permission_key in ('social_resources.read', 'social_resources.manage')
where role.is_system
  and role.role_key in (
    'organization_manager',
    'branch_supervisor',
    'case_manager_social_worker'
  )
on conflict (role_id, permission_id) do nothing;

create table public.social_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  reference_year integer not null,
  name text not null,
  resource_type text not null,
  audience_state text not null,
  audience_detail text,
  eligibility_state text not null,
  eligibility_detail text,
  contact_state text not null,
  contact_detail text,
  validity_state text not null,
  valid_from date,
  valid_until date,
  last_confirmed_on date,
  status text not null default 'active',
  inactive_reason text,
  inactivated_at timestamptz,
  inactivated_by uuid references auth.users(id) on delete restrict,
  row_version bigint not null default 1,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint social_resources_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint social_resources_id_scope_key
    unique (id, organization_id, branch_id),
  constraint social_resources_reference_year_check
    check (reference_year between 2000 and 2200),
  constraint social_resources_name_check check (
    char_length(name) between 1 and 160
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  constraint social_resources_type_check check (
    char_length(resource_type) between 1 and 80
    and resource_type = btrim(resource_type)
    and resource_type !~ '[[:cntrl:]]'
  ),
  constraint social_resources_audience_state_check
    check (audience_state in ('provided', 'not_applicable', 'missing')),
  constraint social_resources_audience_alignment_check check (
    (audience_state = 'provided'
      and audience_detail is not null
      and char_length(audience_detail) between 1 and 500
      and audience_detail = btrim(audience_detail)
      and audience_detail !~ '[[:cntrl:]]')
    or (audience_state <> 'provided' and audience_detail is null)
  ),
  constraint social_resources_eligibility_state_check
    check (eligibility_state in ('provided', 'not_applicable', 'missing')),
  constraint social_resources_eligibility_alignment_check check (
    (eligibility_state = 'provided'
      and eligibility_detail is not null
      and char_length(eligibility_detail) between 1 and 2000
      and eligibility_detail = btrim(eligibility_detail)
      and eligibility_detail !~ '[[:cntrl:]]')
    or (eligibility_state <> 'provided' and eligibility_detail is null)
  ),
  constraint social_resources_contact_state_check
    check (contact_state in ('provided', 'not_applicable', 'missing')),
  constraint social_resources_contact_alignment_check check (
    (contact_state = 'provided'
      and contact_detail is not null
      and char_length(contact_detail) between 1 and 1000
      and contact_detail = btrim(contact_detail)
      and contact_detail !~ '[[:cntrl:]]')
    or (contact_state <> 'provided' and contact_detail is null)
  ),
  constraint social_resources_validity_state_check check (
    validity_state in ('date_range', 'open_ended', 'not_applicable', 'missing')
  ),
  constraint social_resources_validity_alignment_check check (
    (validity_state = 'date_range'
      and valid_until is not null
      and (valid_from is null or valid_until >= valid_from))
    or (validity_state = 'open_ended'
      and valid_from is not null
      and valid_until is null)
    or (validity_state in ('not_applicable', 'missing')
      and valid_from is null
      and valid_until is null)
  ),
  constraint social_resources_status_check check (status in ('active', 'inactive')),
  constraint social_resources_inactive_alignment_check check (
    (status = 'active'
      and inactive_reason is null
      and inactivated_at is null
      and inactivated_by is null)
    or (status = 'inactive'
      and inactive_reason is not null
      and char_length(inactive_reason) between 1 and 500
      and inactive_reason = btrim(inactive_reason)
      and inactive_reason !~ '[[:cntrl:]]'
      and inactivated_at is not null
      and inactivated_by is not null)
  ),
  constraint social_resources_row_version_check check (row_version > 0)
);

comment on table public.social_resources is
  'Page 31 branch resource catalogue. Free text is institution-owned; no external qualification rule is inferred.';
comment on column public.social_resources.last_confirmed_on is
  'Explicit staff confirmation date. NULL means never confirmed; no confirmation cadence is inferred.';

create index social_resources_scope_filter_idx
  on public.social_resources (
    organization_id,
    branch_id,
    reference_year desc,
    status,
    resource_type,
    name
  );
create index social_resources_scope_validity_idx
  on public.social_resources (
    organization_id,
    branch_id,
    valid_until
  ) where validity_state = 'date_range';
create index social_resources_created_by_idx on public.social_resources (created_by);
create index social_resources_updated_by_idx on public.social_resources (updated_by);
create index social_resources_inactivated_by_idx
  on public.social_resources (inactivated_by) where inactivated_by is not null;

create table private.social_resource_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  resource_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_row_version bigint not null,
  result_status text not null,
  result_last_confirmed_on date,
  created_at timestamptz not null default clock_timestamp(),
  constraint social_resource_operations_resource_scope_fkey
    foreign key (resource_id, organization_id, branch_id)
    references public.social_resources(id, organization_id, branch_id)
    on delete restrict,
  constraint social_resource_operations_kind_check
    check (operation_kind in ('create', 'update', 'confirm', 'deactivate')),
  constraint social_resource_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint social_resource_operations_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint social_resource_operations_result_version_check
    check (result_row_version > 0),
  constraint social_resource_operations_result_status_check
    check (result_status in ('active', 'inactive'))
);

comment on table private.social_resource_operations is
  'Append-only actor-scoped exact-replay receipts for page 31 writes.';

create index social_resource_operations_scope_time_idx
  on private.social_resource_operations (
    organization_id,
    branch_id,
    created_at desc
  );
create index social_resource_operations_resource_idx
  on private.social_resource_operations (resource_id, created_at desc);

alter table public.social_resources enable row level security;
alter table public.social_resources force row level security;
alter table private.social_resource_operations enable row level security;
alter table private.social_resource_operations force row level security;

revoke all on table public.social_resources from public, anon, authenticated, service_role;
revoke all on table private.social_resource_operations from public, anon, authenticated, service_role;

create policy social_resources_staff_select
on public.social_resources for select
to authenticated
using (
  (select private.has_permission(
    organization_id,
    branch_id,
    'social_resources.read'
  ))
);

create or replace function private.prevent_social_resource_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'social resource operation receipts are immutable';
end;
$$;

create trigger social_resource_operations_immutable
before update or delete on private.social_resource_operations
for each row execute function private.prevent_social_resource_operation_mutation();

create trigger social_resources_set_updated_at
before update on public.social_resources
for each row execute function private.set_updated_at();

create trigger social_resources_audit_row_change
after insert or update or delete on public.social_resources
for each row execute function private.audit_row_change();

create trigger social_resource_operations_audit_row_change
after insert or update or delete on private.social_resource_operations
for each row execute function private.audit_row_change();

create or replace function private.social_resource_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reference_year integer default null,
  p_resource_type text default null,
  p_status text default 'all',
  p_audience text default null,
  p_query text default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  effective_total bigint,
  pending_confirmation_total bigint,
  inactive_total bigint,
  expired_total bigint,
  items_truncated boolean,
  type_options jsonb,
  audience_options jsonb,
  type_options_truncated boolean,
  audience_options_truncated boolean,
  expiry_rule_status text,
  confirmation_rule_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_query text := nullif(btrim(p_query), '');
  v_resource_type text := nullif(btrim(p_resource_type), '');
  v_audience text := nullif(btrim(p_audience), '');
  v_items jsonb;
  v_item_total bigint;
  v_effective_total bigint;
  v_pending_confirmation_total bigint;
  v_inactive_total bigint;
  v_expired_total bigint;
  v_type_options jsonb;
  v_audience_options jsonb;
  v_type_options_truncated boolean;
  v_audience_options_truncated boolean;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or (p_reference_year is not null and p_reference_year not between 2000 and 2200)
     or p_status not in ('all', 'active', 'inactive')
     or (v_resource_type is not null and char_length(v_resource_type) > 80)
     or (v_audience is not null and char_length(v_audience) > 500)
     or (v_query is not null and char_length(v_query) > 120) then
    raise exception using
      errcode = '22023',
      message = 'social resource snapshot filters are invalid';
  end if;

  if v_actor is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.profiles profile
       where profile.id = v_actor
         and profile.kind <> 'family'
         and profile.is_active
     )
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'social_resources.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'social resource snapshot is not permitted in the selected tenant context';
  end if;

  with eligible_base as materialized (
    select
      resource.*,
      resource.validity_state = 'date_range'
        and resource.valid_until < v_today as expired,
      resource.status = 'active'
        and resource.validity_state <> 'missing'
        and (
          resource.validity_state = 'not_applicable'
          or (
            (resource.valid_from is null or resource.valid_from <= v_today)
            and (resource.valid_until is null or resource.valid_until >= v_today)
          )
        ) as effective
    from public.social_resources resource
    where resource.organization_id = p_expected_organization_id
      and resource.branch_id = p_expected_branch_id
  ), filtered as materialized (
    select resource.*
    from eligible_base resource
    where (p_reference_year is null or resource.reference_year = p_reference_year)
      and (v_resource_type is null or resource.resource_type = v_resource_type)
      and (p_status = 'all' or resource.status = p_status)
      and (
        v_audience is null
        or (v_audience = '__missing__' and resource.audience_state = 'missing')
        or (v_audience = '__not_applicable__' and resource.audience_state = 'not_applicable')
        or (resource.audience_state = 'provided' and resource.audience_detail = v_audience)
      )
      and (
        v_query is null
        or position(lower(v_query) in lower(concat_ws(
          ' ',
          resource.name,
          resource.resource_type,
          resource.audience_detail,
          resource.eligibility_detail,
          resource.contact_detail
        ))) > 0
      )
  ), stats as (
    select
      count(*)::bigint as item_total,
      count(*) filter (where resource.effective)::bigint as effective_total,
      count(*) filter (
        where resource.status = 'active'
          and resource.last_confirmed_on is null
      )::bigint
        as pending_confirmation_total,
      count(*) filter (where resource.status = 'inactive')::bigint as inactive_total,
      -- Expiry is a validity fact independent from lifecycle status. It may
      -- overlap inactive_total and is intentionally not an additive bucket.
      count(*) filter (where resource.expired)::bigint as expired_total
    from filtered resource
  ), limited as materialized (
    select resource.*
    from filtered resource
    order by
      (resource.status = 'active') desc,
      (resource.last_confirmed_on is null) desc,
      resource.reference_year desc,
      resource.name collate "C",
      resource.id
    limit 200
  ), options as (
    select
      coalesce((
        select jsonb_agg(option.resource_type order by option.resource_type collate "C")
        from (
          select distinct resource.resource_type collate "C" as resource_type
          from eligible_base resource
          order by resource_type
          limit 200
        ) option
      ), '[]'::jsonb) as type_options,
      coalesce((
        select jsonb_agg(option.audience_detail order by option.audience_detail collate "C")
        from (
          select distinct resource.audience_detail collate "C" as audience_detail
          from eligible_base resource
          where resource.audience_state = 'provided'
          order by audience_detail
          limit 200
        ) option
      ), '[]'::jsonb) as audience_options,
      (select count(distinct resource.resource_type) > 200
       from eligible_base resource) as type_options_truncated,
      (select count(distinct resource.audience_detail) > 200
       from eligible_base resource
       where resource.audience_state = 'provided') as audience_options_truncated
  )
  select
    stats.item_total,
    stats.effective_total,
    stats.pending_confirmation_total,
    stats.inactive_total,
    stats.expired_total,
    options.type_options,
    options.audience_options,
    options.type_options_truncated,
    options.audience_options_truncated,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'resource_id', resource.id,
        'reference_year', resource.reference_year,
        'name', resource.name,
        'resource_type', resource.resource_type,
        'audience_state', resource.audience_state,
        'audience_detail', resource.audience_detail,
        'eligibility_state', resource.eligibility_state,
        'eligibility_detail', resource.eligibility_detail,
        'contact_state', resource.contact_state,
        'contact_detail', resource.contact_detail,
        'validity_state', resource.validity_state,
        'valid_from', resource.valid_from,
        'valid_until', resource.valid_until,
        'last_confirmed_on', resource.last_confirmed_on,
        'status', resource.status,
        'row_version', resource.row_version,
        'updated_at', resource.updated_at,
        'expired', resource.expired,
        'effective', resource.effective
      ) order by
        (resource.status = 'active') desc,
        (resource.last_confirmed_on is null) desc,
        resource.reference_year desc,
        resource.name collate "C",
        resource.id)
      from limited resource
    ), '[]'::jsonb)
  into
    v_item_total,
    v_effective_total,
    v_pending_confirmation_total,
    v_inactive_total,
    v_expired_total,
    v_type_options,
    v_audience_options,
    v_type_options_truncated,
    v_audience_options_truncated,
    v_items
  from stats cross join options;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'social_resources.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'social resource snapshot authority expired';
  end if;

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
    'social_resources',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page31_social_resources_v1',
      'interaction', case when v_query is null
        and p_reference_year is null
        and v_resource_type is null
        and p_status = 'all'
        and v_audience is null then 'view' else 'search' end,
      'result_count', jsonb_array_length(v_items),
      'result_total', v_item_total,
      'items_truncated', v_item_total > jsonb_array_length(v_items),
      'item_limit', 200,
      'type_options_truncated', v_type_options_truncated,
      'audience_options_truncated', v_audience_options_truncated,
      'expiry_rule_status', 'not_configured',
      'confirmation_rule_status', 'missing_date_only'
    )
  );

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'social_resources.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'social resource snapshot authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_items,
    v_item_total,
    v_effective_total,
    v_pending_confirmation_total,
    v_inactive_total,
    v_expired_total,
    v_item_total > jsonb_array_length(v_items),
    v_type_options,
    v_audience_options,
    v_type_options_truncated,
    v_audience_options_truncated,
    'not_configured'::text,
    'missing_date_only'::text;
end;
$$;

create or replace function public.social_resource_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reference_year integer default null,
  p_resource_type text default null,
  p_status text default 'all',
  p_audience text default null,
  p_query text default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  effective_total bigint,
  pending_confirmation_total bigint,
  inactive_total bigint,
  expired_total bigint,
  items_truncated boolean,
  type_options jsonb,
  audience_options jsonb,
  type_options_truncated boolean,
  audience_options_truncated boolean,
  expiry_rule_status text,
  confirmation_rule_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.social_resource_snapshot_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_reference_year,
    p_resource_type,
    p_status,
    p_audience,
    p_query
  );
$$;

create or replace function private.manage_social_resource_atomic(
  p_operation_kind text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_resource_id uuid,
  p_reference_year integer,
  p_name text,
  p_resource_type text,
  p_audience_state text,
  p_audience_detail text,
  p_eligibility_state text,
  p_eligibility_detail text,
  p_contact_state text,
  p_contact_detail text,
  p_validity_state text,
  p_valid_from date,
  p_valid_until date,
  p_expected_row_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  resource_id uuid,
  row_version bigint,
  status text,
  last_confirmed_on date,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_name text := nullif(btrim(p_name), '');
  v_resource_type text := nullif(btrim(p_resource_type), '');
  v_audience_detail text := nullif(btrim(p_audience_detail), '');
  v_eligibility_detail text := nullif(btrim(p_eligibility_detail), '');
  v_contact_detail text := nullif(btrim(p_contact_detail), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_request_hash text;
  v_operation private.social_resource_operations%rowtype;
  v_resource public.social_resources%rowtype;
begin
  if p_operation_kind not in ('create', 'update', 'confirm', 'deactivate')
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_idempotency_key is null
     or (p_operation_kind <> 'create' and p_resource_id is null)
     or (p_operation_kind in ('update', 'confirm', 'deactivate')
       and (p_expected_row_version is null or p_expected_row_version < 1)) then
    raise exception using
      errcode = '22023',
      message = 'social resource operation, scope, target, version and idempotency key are required';
  end if;

  if v_actor is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.profiles profile
       where profile.id = v_actor
         and profile.kind <> 'family'
         and profile.is_active
     )
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'social_resources.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'social resource operation is not permitted in the selected tenant context';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'operation_kind', p_operation_kind,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'resource_id', p_resource_id,
    'reference_year', p_reference_year,
    'name', v_name,
    'resource_type', v_resource_type,
    'audience_state', p_audience_state,
    'audience_detail', v_audience_detail,
    'eligibility_state', p_eligibility_state,
    'eligibility_detail', v_eligibility_detail,
    'contact_state', p_contact_state,
    'contact_detail', v_contact_detail,
    'validity_state', p_validity_state,
    'valid_from', p_valid_from,
    'valid_until', p_valid_until,
    'expected_row_version', p_expected_row_version,
    'reason', v_reason
  )::text, 'utf8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'social-resource:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.social_resource_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.operation_kind <> p_operation_kind
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'social resource idempotency conflict';
    end if;
    if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
       or not (select private.has_permission(
         p_expected_organization_id,
         p_expected_branch_id,
         'social_resources.manage'
       )) then
      raise exception using
        errcode = '42501',
        message = 'social resource replay authority expired';
    end if;
    return query select
      v_operation.id,
      v_operation.resource_id,
      v_operation.result_row_version,
      v_operation.result_status,
      v_operation.result_last_confirmed_on,
      true;
    return;
  end if;

  if p_operation_kind in ('create', 'update') then
    if p_reference_year is null or p_reference_year not between 2000 and 2200
       or v_name is null or char_length(v_name) > 160
       or v_resource_type is null or char_length(v_resource_type) > 80
       or p_audience_state not in ('provided', 'not_applicable', 'missing')
       or p_eligibility_state not in ('provided', 'not_applicable', 'missing')
       or p_contact_state not in ('provided', 'not_applicable', 'missing')
       or p_validity_state not in ('date_range', 'open_ended', 'not_applicable', 'missing')
       or (p_audience_state = 'provided' and (v_audience_detail is null or char_length(v_audience_detail) > 500))
       or (p_audience_state <> 'provided' and v_audience_detail is not null)
       or (p_eligibility_state = 'provided' and (v_eligibility_detail is null or char_length(v_eligibility_detail) > 2000))
       or (p_eligibility_state <> 'provided' and v_eligibility_detail is not null)
       or (p_contact_state = 'provided' and (v_contact_detail is null or char_length(v_contact_detail) > 1000))
       or (p_contact_state <> 'provided' and v_contact_detail is not null)
       or (p_validity_state = 'date_range' and (p_valid_until is null or (p_valid_from is not null and p_valid_until < p_valid_from)))
       or (p_validity_state = 'open_ended' and (p_valid_from is null or p_valid_until is not null))
       or (p_validity_state in ('not_applicable', 'missing') and (p_valid_from is not null or p_valid_until is not null)) then
      raise exception using
        errcode = '22023',
        message = 'social resource fields or explicit information states are invalid';
    end if;
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'social_resources.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'social resource operation authority expired';
  end if;

  if p_operation_kind = 'create' then
    insert into public.social_resources (
      organization_id,
      branch_id,
      reference_year,
      name,
      resource_type,
      audience_state,
      audience_detail,
      eligibility_state,
      eligibility_detail,
      contact_state,
      contact_detail,
      validity_state,
      valid_from,
      valid_until,
      created_by,
      updated_by
    ) values (
      p_expected_organization_id,
      p_expected_branch_id,
      p_reference_year,
      v_name,
      v_resource_type,
      p_audience_state,
      v_audience_detail,
      p_eligibility_state,
      v_eligibility_detail,
      p_contact_state,
      v_contact_detail,
      p_validity_state,
      p_valid_from,
      p_valid_until,
      v_actor,
      v_actor
    ) returning * into v_resource;
  else
    select resource.* into v_resource
    from public.social_resources resource
    where resource.id = p_resource_id
      and resource.organization_id = p_expected_organization_id
      and resource.branch_id = p_expected_branch_id
    for update;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'social resource target is not available in the selected tenant context';
    end if;
    if v_resource.row_version <> p_expected_row_version then
      raise exception using
        errcode = '40001',
        message = 'social resource version conflict';
    end if;
    if v_resource.status <> 'active' then
      raise exception using
        errcode = '23514',
        message = 'inactive social resources are immutable';
    end if;

    if p_operation_kind = 'update' then
      update public.social_resources resource set
        reference_year = p_reference_year,
        name = v_name,
        resource_type = v_resource_type,
        audience_state = p_audience_state,
        audience_detail = v_audience_detail,
        eligibility_state = p_eligibility_state,
        eligibility_detail = v_eligibility_detail,
        contact_state = p_contact_state,
        contact_detail = v_contact_detail,
        validity_state = p_validity_state,
        valid_from = p_valid_from,
        valid_until = p_valid_until,
        row_version = resource.row_version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
      where resource.id = v_resource.id
      returning * into v_resource;
    elsif p_operation_kind = 'confirm' then
      update public.social_resources resource set
        last_confirmed_on = v_today,
        row_version = resource.row_version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
      where resource.id = v_resource.id
      returning * into v_resource;
    else
      if v_reason is null or char_length(v_reason) > 500 then
        raise exception using
          errcode = '22023',
          message = 'a bounded deactivation reason is required';
      end if;
      update public.social_resources resource set
        status = 'inactive',
        inactive_reason = v_reason,
        inactivated_at = clock_timestamp(),
        inactivated_by = v_actor,
        row_version = resource.row_version + 1,
        updated_by = v_actor,
        updated_at = clock_timestamp()
      where resource.id = v_resource.id
      returning * into v_resource;
    end if;
  end if;

  insert into private.social_resource_operations (
    organization_id,
    branch_id,
    resource_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    result_row_version,
    result_status,
    result_last_confirmed_on
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_resource.id,
    v_actor,
    p_operation_kind,
    p_idempotency_key,
    v_request_hash,
    v_resource.row_version,
    v_resource.status,
    v_resource.last_confirmed_on
  ) returning * into v_operation;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    idempotency_key,
    changed_fields,
    metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    case when p_operation_kind = 'create' then 'insert' else 'update' end,
    'social_resources',
    v_resource.id::text,
    p_idempotency_key,
    case p_operation_kind
      when 'create' then array[
        'reference_year', 'name', 'resource_type', 'audience_state',
        'eligibility_state', 'contact_state', 'validity_state', 'status'
      ]
      when 'update' then array[
        'reference_year', 'name', 'resource_type', 'audience_state',
        'eligibility_state', 'contact_state', 'validity_state', 'row_version'
      ]
      when 'confirm' then array['last_confirmed_on', 'row_version']
      else array['status', 'inactive_reason', 'row_version']
    end,
    jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_kind', p_operation_kind,
      'row_version', v_resource.row_version,
      'projection', 'page31_social_resources_v1'
    )
  );

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'social_resources.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'social resource operation authority expired';
  end if;

  return query select
    v_operation.id,
    v_resource.id,
    v_resource.row_version,
    v_resource.status,
    v_resource.last_confirmed_on,
    false;
end;
$$;

create or replace function public.create_social_resource(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reference_year integer,
  p_name text,
  p_resource_type text,
  p_audience_state text,
  p_audience_detail text,
  p_eligibility_state text,
  p_eligibility_detail text,
  p_contact_state text,
  p_contact_detail text,
  p_validity_state text,
  p_valid_from date,
  p_valid_until date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  resource_id uuid,
  row_version bigint,
  status text,
  last_confirmed_on date,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.manage_social_resource_atomic(
    'create', p_expected_organization_id, p_expected_branch_id, null,
    p_reference_year, p_name, p_resource_type,
    p_audience_state, p_audience_detail,
    p_eligibility_state, p_eligibility_detail,
    p_contact_state, p_contact_detail,
    p_validity_state, p_valid_from, p_valid_until,
    null, null, p_idempotency_key
  );
$$;

create or replace function public.update_social_resource(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_resource_id uuid,
  p_reference_year integer,
  p_name text,
  p_resource_type text,
  p_audience_state text,
  p_audience_detail text,
  p_eligibility_state text,
  p_eligibility_detail text,
  p_contact_state text,
  p_contact_detail text,
  p_validity_state text,
  p_valid_from date,
  p_valid_until date,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  resource_id uuid,
  row_version bigint,
  status text,
  last_confirmed_on date,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.manage_social_resource_atomic(
    'update', p_expected_organization_id, p_expected_branch_id, p_resource_id,
    p_reference_year, p_name, p_resource_type,
    p_audience_state, p_audience_detail,
    p_eligibility_state, p_eligibility_detail,
    p_contact_state, p_contact_detail,
    p_validity_state, p_valid_from, p_valid_until,
    p_expected_row_version, null, p_idempotency_key
  );
$$;

create or replace function public.confirm_social_resource(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_resource_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  resource_id uuid,
  row_version bigint,
  status text,
  last_confirmed_on date,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.manage_social_resource_atomic(
    'confirm', p_expected_organization_id, p_expected_branch_id, p_resource_id,
    null, null, null, null, null, null, null, null, null, null, null, null,
    p_expected_row_version, null, p_idempotency_key
  );
$$;

create or replace function public.deactivate_social_resource(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_resource_id uuid,
  p_expected_row_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  resource_id uuid,
  row_version bigint,
  status text,
  last_confirmed_on date,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.manage_social_resource_atomic(
    'deactivate', p_expected_organization_id, p_expected_branch_id, p_resource_id,
    null, null, null, null, null, null, null, null, null, null, null, null,
    p_expected_row_version, p_reason, p_idempotency_key
  );
$$;

comment on function public.social_resource_snapshot(uuid, uuid, integer, text, text, text, text) is
  'Bounded audited page 31 projection. Filters never broaden beyond the exact tenant and branch.';
comment on function public.create_social_resource(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, uuid) is
  'Creates one page 31 resource through an actor-scoped idempotent boundary.';
comment on function public.update_social_resource(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, bigint, uuid) is
  'Optimistically updates one active page 31 resource through an actor-scoped idempotent boundary.';
comment on function public.confirm_social_resource(uuid, uuid, uuid, bigint, uuid) is
  'Records the server-derived Taiwan confirmation date for one active page 31 resource.';
comment on function public.deactivate_social_resource(uuid, uuid, uuid, bigint, text, uuid) is
  'Deactivates one page 31 resource with a required reason; inactive rows are immutable.';

revoke all on function private.prevent_social_resource_operation_mutation() from public, anon, authenticated, service_role;
revoke all on function private.social_resource_snapshot_response(uuid, uuid, integer, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.manage_social_resource_atomic(text, uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, bigint, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.social_resource_snapshot(uuid, uuid, integer, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.create_social_resource(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_social_resource(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_social_resource(uuid, uuid, uuid, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.deactivate_social_resource(uuid, uuid, uuid, bigint, text, uuid) from public, anon, authenticated, service_role;

grant execute on function private.social_resource_snapshot_response(uuid, uuid, integer, text, text, text, text) to authenticated;
grant execute on function private.manage_social_resource_atomic(text, uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, bigint, text, uuid) to authenticated;
grant execute on function public.social_resource_snapshot(uuid, uuid, integer, text, text, text, text) to authenticated;
grant execute on function public.create_social_resource(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, uuid) to authenticated;
grant execute on function public.update_social_resource(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, text, date, date, bigint, uuid) to authenticated;
grant execute on function public.confirm_social_resource(uuid, uuid, uuid, bigint, uuid) to authenticated;
grant execute on function public.deactivate_social_resource(uuid, uuid, uuid, bigint, text, uuid) to authenticated;
