-- Page 63: deterministic, rule-assisted staff scheduling.
--
-- This slice intentionally does not implement AI or infer labor, clinical,
-- facility, vehicle, or capacity rules. A complete immutable
-- manual_unstandardized rule version must already cover the requested slot;
-- otherwise creation and publication fail closed. Qualification evidence is
-- consumed only from the Page-72 terminal certificate projection.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_scheduling.read', 'Read scoped deterministic staff scheduling snapshots', 2),
  ('staff_scheduling.manage', 'Create and revise immutable scheduling drafts', 3),
  ('staff_scheduling.approve', 'Independently publish or reject scheduling drafts', 3),
  ('staff_scheduling.override', 'Independently approve an explained conflicting draft', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key like 'staff_scheduling.%'
on conflict (role_id, permission_id) do nothing;

create or replace function private.staff_scheduling_text_ok(
  p_value text, p_min integer, p_max integer, p_multiline boolean default false
)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_value is not null
    and char_length(btrim(p_value)) between p_min and p_max
    and case when p_multiline
      then translate(p_value, E'\n\r\t', '') !~ '[[:cntrl:]]'
      else p_value !~ '[[:cntrl:]]'
    end;
$$;

create or replace function private.staff_scheduling_rule_payload_ok(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_item jsonb;
  v_integer integer;
begin
  if jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ?& array[
       'qualification_rules','work_rules','facilities','vehicles',
       'branch_capacity','source_status'
     ])
     or p_payload - array[
       'qualification_rules','work_rules','facilities','vehicles',
       'branch_capacity','source_status'
     ] <> '{}'::jsonb
     or p_payload ->> 'source_status' <> 'manual_unstandardized'
     or jsonb_typeof(p_payload -> 'qualification_rules') <> 'array'
     or jsonb_array_length(p_payload -> 'qualification_rules') not between 1 and 50
     or jsonb_typeof(p_payload -> 'work_rules') <> 'object'
     or jsonb_typeof(p_payload -> 'facilities') <> 'array'
     or jsonb_array_length(p_payload -> 'facilities') not between 1 and 100
     or jsonb_typeof(p_payload -> 'vehicles') <> 'array'
     or jsonb_array_length(p_payload -> 'vehicles') not between 1 and 100
     or jsonb_typeof(p_payload -> 'branch_capacity') <> 'number' then
    return false;
  end if;

  if not (p_payload -> 'work_rules' ?& array[
       'max_shift_minutes','min_rest_minutes','source_status'
     ])
     or (p_payload -> 'work_rules') - array[
       'max_shift_minutes','min_rest_minutes','source_status'
     ] <> '{}'::jsonb
     or p_payload -> 'work_rules' ->> 'source_status' <> 'manual_unstandardized'
     or jsonb_typeof(p_payload -> 'work_rules' -> 'max_shift_minutes') <> 'number'
     or jsonb_typeof(p_payload -> 'work_rules' -> 'min_rest_minutes') <> 'number'
     or (p_payload -> 'work_rules' ->> 'max_shift_minutes') !~ '^[0-9]+$'
     or (p_payload -> 'work_rules' ->> 'min_rest_minutes') !~ '^[0-9]+$' then
    return false;
  end if;
  begin
    if (p_payload -> 'work_rules' ->> 'max_shift_minutes')::integer not between 1 and 10080
       or (p_payload -> 'work_rules' ->> 'min_rest_minutes')::integer not between 0 and 10080
       or (p_payload ->> 'branch_capacity') !~ '^[0-9]+$'
       or (p_payload ->> 'branch_capacity')::integer not between 1 and 10000 then
      return false;
    end if;
  exception when others then return false;
  end;

  for v_item in select value from jsonb_array_elements(
    p_payload -> 'qualification_rules'
  ) loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'role_text','required_certificate_type','taxonomy_status'
       ])
       or v_item - array[
         'role_text','required_certificate_type','taxonomy_status'
       ] <> '{}'::jsonb
       or not private.staff_scheduling_text_ok(v_item ->> 'role_text', 1, 160)
       or not private.staff_scheduling_text_ok(
         v_item ->> 'required_certificate_type', 1, 160
       )
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then
      return false;
    end if;
  end loop;
  if exists (
    select 1 from (
      select lower(btrim(value ->> 'role_text')) as role_key, count(*)
      from jsonb_array_elements(p_payload -> 'qualification_rules')
      group by lower(btrim(value ->> 'role_text')) having count(*) > 1
    ) duplicate
  ) then return false; end if;

  for v_item in
    select value from jsonb_array_elements(p_payload -> 'facilities')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'facility_code','name','capacity','taxonomy_status'
       ])
       or v_item - array[
         'facility_code','name','capacity','taxonomy_status'
       ] <> '{}'::jsonb
       or coalesce(v_item ->> 'facility_code','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
       or not private.staff_scheduling_text_ok(v_item ->> 'name', 1, 160)
       or jsonb_typeof(v_item -> 'capacity') <> 'number'
       or coalesce(v_item ->> 'capacity','') !~ '^[0-9]+$'
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then
      return false;
    end if;
    begin v_integer := (v_item ->> 'capacity')::integer;
    exception when others then return false; end;
    if v_integer not between 1 and 10000 then return false; end if;
  end loop;
  if exists (
    select 1 from (
      select lower(value ->> 'facility_code') as resource_key, count(*)
      from jsonb_array_elements(p_payload -> 'facilities')
      group by lower(value ->> 'facility_code') having count(*) > 1
    ) duplicate
  ) then return false; end if;

  for v_item in
    select value from jsonb_array_elements(p_payload -> 'vehicles')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'vehicle_code','name','capacity','taxonomy_status'
       ])
       or v_item - array[
         'vehicle_code','name','capacity','taxonomy_status'
       ] <> '{}'::jsonb
       or coalesce(v_item ->> 'vehicle_code','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
       or not private.staff_scheduling_text_ok(v_item ->> 'name', 1, 160)
       or jsonb_typeof(v_item -> 'capacity') <> 'number'
       or coalesce(v_item ->> 'capacity','') !~ '^[0-9]+$'
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then
      return false;
    end if;
    begin v_integer := (v_item ->> 'capacity')::integer;
    exception when others then return false; end;
    if v_integer not between 1 and 10000 then return false; end if;
  end loop;
  if exists (
    select 1 from (
      select lower(value ->> 'vehicle_code') as resource_key, count(*)
      from jsonb_array_elements(p_payload -> 'vehicles')
      group by lower(value ->> 'vehicle_code') having count(*) > 1
    ) duplicate
  ) then return false; end if;
  return true;
end;
$$;

create table private.staff_scheduling_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  rule_set_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  effective_from date not null,
  effective_to date,
  source_status text not null default 'manual_unstandardized',
  rule_payload jsonb not null,
  publication_note text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  content_hash text not null default repeat('0',64),
  constraint staff_scheduling_rules_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_scheduling_rules_id_scope_key
    unique (id, organization_id, branch_id),
  constraint staff_scheduling_rules_chain_key unique (rule_set_key, version),
  constraint staff_scheduling_rules_previous_unique unique (previous_version_id),
  constraint staff_scheduling_rules_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id
  ) references private.staff_scheduling_rule_versions(
    id, organization_id, branch_id
  ) on delete restrict,
  constraint staff_scheduling_rules_version_check check (
    (version = 1 and previous_version_id is null)
    or (version > 1 and previous_version_id is not null)
  ),
  constraint staff_scheduling_rules_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint staff_scheduling_rules_source_check
    check (source_status = 'manual_unstandardized'),
  constraint staff_scheduling_rules_payload_check
    check (private.staff_scheduling_rule_payload_ok(rule_payload)),
  constraint staff_scheduling_rules_note_check check (
    private.staff_scheduling_text_ok(publication_note, 1, 1000, true)
  ),
  constraint staff_scheduling_rules_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create or replace function private.prepare_staff_scheduling_rule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_previous private.staff_scheduling_rule_versions%rowtype;
begin
  if exists (
    select 1 from private.staff_scheduling_rule_versions existing
    where existing.organization_id = new.organization_id
      and existing.branch_id = new.branch_id
      and daterange(existing.effective_from,
        coalesce(existing.effective_to + 1, 'infinity'::date), '[)')
        && daterange(new.effective_from,
          coalesce(new.effective_to + 1, 'infinity'::date), '[)')
  ) then
    raise exception using errcode = '23P01',
      message = 'staff scheduling rule periods cannot overlap';
  end if;
  if new.version = 1 then
    if exists (select 1 from private.staff_scheduling_rule_versions prior
      where prior.rule_set_key = new.rule_set_key) then
      raise exception using errcode = '23505',
        message = 'staff scheduling rule version must continue its chain';
    end if;
  else
    select * into v_previous from private.staff_scheduling_rule_versions prior
    where prior.id = new.previous_version_id
      and prior.organization_id = new.organization_id
      and prior.branch_id = new.branch_id
      and prior.rule_set_key = new.rule_set_key
    order by prior.version desc limit 1 for share;
    if not found or v_previous.version + 1 <> new.version then
      raise exception using errcode = '40001',
        message = 'staff scheduling rule chain is stale';
    end if;
  end if;
  new.content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id',new.organization_id,'branch_id',new.branch_id,
    'rule_set_key',new.rule_set_key,'version',new.version,
    'previous_version_id',new.previous_version_id,
    'effective_from',new.effective_from,'effective_to',new.effective_to,
    'source_status',new.source_status,'rule_payload',new.rule_payload,
    'publication_note',btrim(new.publication_note)
  )::text,'UTF8')),'hex');
  return new;
end;
$$;

create trigger staff_scheduling_rule_prepare
before insert on private.staff_scheduling_rule_versions
for each row execute function private.prepare_staff_scheduling_rule();

create table public.staff_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  schedule_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  status text not null,
  review_mode text,
  rule_version_id uuid not null,
  staff_membership_id uuid not null,
  staff_user_id uuid not null references public.profiles(id) on delete restrict,
  staff_display_name_snapshot text not null,
  staff_employee_code_snapshot text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  role_text text not null,
  service_need_text text not null,
  facility_code text not null,
  vehicle_code text not null,
  planned_clients integer not null,
  conflict_count integer not null,
  conflicts jsonb not null,
  qualification_evidence jsonb not null,
  revision_reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  creator_display_name text not null,
  creator_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewer_display_name text,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint staff_schedule_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_schedule_rule_scope_fkey foreign key (
    rule_version_id, organization_id, branch_id
  ) references private.staff_scheduling_rule_versions(
    id, organization_id, branch_id
  ) on delete restrict,
  constraint staff_schedule_membership_scope_fkey foreign key (
    staff_membership_id, organization_id, branch_id
  ) references public.memberships(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_schedule_id_scope_key unique (id, organization_id, branch_id),
  constraint staff_schedule_chain_key unique (schedule_key, version),
  constraint staff_schedule_previous_unique unique (previous_version_id),
  constraint staff_schedule_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id
  ) references public.staff_schedule_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_schedule_version_check check (
    (version = 1 and previous_version_id is null)
    or (version > 1 and previous_version_id is not null)
  ),
  constraint staff_schedule_status_check check (
    status in ('draft_ready','draft_conflicted','published','voided')
  ),
  constraint staff_schedule_review_check check (
    (status in ('draft_ready','draft_conflicted')
      and review_mode is null and reviewed_by is null
      and reviewer_display_name is null and reviewed_at is null
      and review_reason is null)
    or (status = 'published' and review_mode in ('standard','override')
      and reviewed_by is not null and reviewer_display_name is not null
      and reviewed_at is not null and review_reason is not null)
    or (status = 'voided' and review_mode = 'rejected'
      and reviewed_by is not null and reviewer_display_name is not null
      and reviewed_at is not null and review_reason is not null)
  ),
  constraint staff_schedule_time_check check (
    ends_at > starts_at and ends_at <= starts_at + interval '7 days'
  ),
  constraint staff_schedule_text_check check (
    private.staff_scheduling_text_ok(staff_display_name_snapshot,1,120)
    and (staff_employee_code_snapshot is null or
      private.staff_scheduling_text_ok(staff_employee_code_snapshot,1,80))
    and private.staff_scheduling_text_ok(role_text,1,160)
    and private.staff_scheduling_text_ok(service_need_text,1,500,true)
    and facility_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
    and vehicle_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
    and private.staff_scheduling_text_ok(revision_reason,1,1000,true)
    and private.staff_scheduling_text_ok(creator_display_name,1,120)
    and (reviewer_display_name is null or
      private.staff_scheduling_text_ok(reviewer_display_name,1,120))
    and (review_reason is null or
      private.staff_scheduling_text_ok(review_reason,1,1000,true))
  ),
  constraint staff_schedule_clients_check check (planned_clients between 1 and 10000),
  constraint staff_schedule_conflicts_check check (
    conflict_count between 0 and 20
    and jsonb_typeof(conflicts) = 'array'
    and jsonb_array_length(conflicts) = conflict_count
    and jsonb_typeof(qualification_evidence) = 'array'
    and jsonb_array_length(qualification_evidence) <= 20
    and ((status = 'draft_ready' and conflict_count = 0)
      or (status = 'draft_conflicted' and conflict_count > 0)
      or status in ('published','voided'))
    and (review_mode <> 'standard' or conflict_count = 0)
    and (review_mode <> 'override' or conflict_count > 0)
  ),
  constraint staff_schedule_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.staff_schedule_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  schedule_key uuid not null,
  decided_version_id uuid not null,
  expected_version integer not null,
  expected_content_hash text not null,
  expected_conflict_count integer not null,
  decision text not null,
  reason text not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decider_display_name text not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  result_version_id uuid not null,
  result_version integer not null,
  decided_at timestamptz not null,
  content_hash text not null,
  constraint staff_schedule_decision_id_scope_key
    unique (id, organization_id, branch_id),
  constraint staff_schedule_decision_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_schedule_decided_version_scope_fkey foreign key (
    decided_version_id, organization_id, branch_id
  ) references public.staff_schedule_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_schedule_result_version_scope_fkey foreign key (
    result_version_id, organization_id, branch_id
  ) references public.staff_schedule_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_schedule_decision_shape_check check (
    expected_version > 0 and result_version = expected_version + 1
    and expected_conflict_count between 0 and 20
    and decision in ('publish','override','reject')
    and ((decision = 'publish' and expected_conflict_count = 0)
      or (decision = 'override' and expected_conflict_count > 0)
      or decision = 'reject')
  ),
  constraint staff_schedule_decision_text_check check (
    private.staff_scheduling_text_ok(reason,1,1000,true)
    and private.staff_scheduling_text_ok(decider_display_name,1,120)
  ),
  constraint staff_schedule_decision_hashes_check check (
    expected_content_hash ~ '^[a-f0-9]{64}$'
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.staff_scheduling_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null,
  request_hash text not null,
  result_schedule_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_status text not null,
  result_conflict_count integer not null,
  result_rule_version_id uuid not null,
  result_decision_id uuid,
  committed_at timestamptz not null,
  constraint staff_scheduling_operation_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_scheduling_operation_result_scope_fkey foreign key (
    result_version_id, organization_id, branch_id
  ) references public.staff_schedule_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_scheduling_operation_rule_scope_fkey foreign key (
    result_rule_version_id, organization_id, branch_id
  ) references private.staff_scheduling_rule_versions(
    id, organization_id, branch_id
  ) on delete restrict,
  constraint staff_scheduling_operation_decision_scope_fkey foreign key (
    result_decision_id, organization_id, branch_id
  ) references public.staff_schedule_decisions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_scheduling_operation_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint staff_scheduling_operation_shape_check check (
    operation in ('create','revise','publish','override','reject')
    and result_version > 0 and result_conflict_count between 0 and 20
    and result_status in ('draft_ready','draft_conflicted','published','voided')
    and ((operation in ('create','revise') and result_decision_id is null)
      or (operation in ('publish','override','reject')
        and result_decision_id is not null))
  ),
  constraint staff_scheduling_operation_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$')
);

create index staff_scheduling_rules_branch_period_idx
  on private.staff_scheduling_rule_versions(organization_id,branch_id,effective_from,effective_to);
create index staff_scheduling_rules_created_by_idx
  on private.staff_scheduling_rule_versions(created_by);
create index staff_scheduling_rules_previous_idx
  on private.staff_scheduling_rule_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_schedule_branch_time_idx
  on public.staff_schedule_versions(organization_id,branch_id,starts_at,ends_at);
create index staff_schedule_rule_idx on public.staff_schedule_versions(rule_version_id);
create index staff_schedule_staff_idx
  on public.staff_schedule_versions(staff_membership_id,starts_at,ends_at);
create index staff_schedule_staff_user_idx on public.staff_schedule_versions(staff_user_id);
create index staff_schedule_previous_idx on public.staff_schedule_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_schedule_created_by_idx on public.staff_schedule_versions(created_by);
create index staff_schedule_creator_reauth_idx
  on public.staff_schedule_versions(creator_reauth_challenge_id);
create index staff_schedule_reviewed_by_idx on public.staff_schedule_versions(reviewed_by)
  where reviewed_by is not null;
create index staff_schedule_decision_branch_idx
  on public.staff_schedule_decisions(organization_id,branch_id,decided_at);
create index staff_schedule_decision_decided_version_idx
  on public.staff_schedule_decisions(decided_version_id);
create index staff_schedule_decision_result_version_idx
  on public.staff_schedule_decisions(result_version_id);
create index staff_schedule_decision_decided_by_idx
  on public.staff_schedule_decisions(decided_by);
create index staff_schedule_decision_reauth_idx
  on public.staff_schedule_decisions(reauth_challenge_id);
create index staff_scheduling_operations_branch_idx
  on private.staff_scheduling_operations(organization_id,branch_id,committed_at);
create index staff_scheduling_operations_result_version_idx
  on private.staff_scheduling_operations(result_version_id);
create index staff_scheduling_operations_rule_idx
  on private.staff_scheduling_operations(result_rule_version_id);
create index staff_scheduling_operations_decision_idx
  on private.staff_scheduling_operations(result_decision_id)
  where result_decision_id is not null;

create or replace function private.staff_scheduling_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'staff scheduling evidence is append-only';
end;
$$;
create trigger staff_scheduling_rules_append_only before update or delete
on private.staff_scheduling_rule_versions for each row
execute function private.staff_scheduling_append_only();
create trigger staff_schedule_versions_append_only before update or delete
on public.staff_schedule_versions for each row
execute function private.staff_scheduling_append_only();
create trigger staff_schedule_decisions_append_only before update or delete
on public.staff_schedule_decisions for each row
execute function private.staff_scheduling_append_only();
create trigger staff_scheduling_operations_append_only before update or delete
on private.staff_scheduling_operations for each row
execute function private.staff_scheduling_append_only();
create trigger staff_scheduling_rules_audit after insert
on private.staff_scheduling_rule_versions for each row execute function private.audit_row_change();
create trigger staff_schedule_versions_audit_row_change after insert
on public.staff_schedule_versions for each row execute function private.audit_row_change();
create trigger staff_schedule_decisions_audit_row_change after insert
on public.staff_schedule_decisions for each row execute function private.audit_row_change();
create trigger staff_scheduling_operations_audit after insert
on private.staff_scheduling_operations for each row execute function private.audit_row_change();

alter table private.staff_scheduling_rule_versions enable row level security;
alter table private.staff_scheduling_rule_versions force row level security;
alter table public.staff_schedule_versions enable row level security;
alter table public.staff_schedule_versions force row level security;
alter table public.staff_schedule_decisions enable row level security;
alter table public.staff_schedule_decisions force row level security;
alter table private.staff_scheduling_operations enable row level security;
alter table private.staff_scheduling_operations force row level security;
revoke all on table private.staff_scheduling_rule_versions
  from public,anon,authenticated,service_role;
revoke all on table public.staff_schedule_versions
  from public,anon,authenticated,service_role;
revoke all on table public.staff_schedule_decisions
  from public,anon,authenticated,service_role;
revoke all on table private.staff_scheduling_operations
  from public,anon,authenticated,service_role;

create or replace function private.staff_scheduling_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles profile
      where profile.id=auth.uid() and profile.is_active
        and profile.kind in ('staff','professional','driver','finance'))
    and exists (select 1 from public.branches branch
      where branch.id=p_expected_branch_id
        and branch.organization_id=p_expected_organization_id
        and branch.is_active)
    and private.has_permission(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and private.has_permission(
      p_expected_organization_id,p_expected_branch_id,'staff_certificates.read')
    and (not p_require_recent_aal2 or (
      coalesce(auth.jwt()->>'aal','')='aal2'
      and private.has_recent_aal2(15)
    ));
$$;

create or replace function private.require_staff_scheduling_reauth(
  p_actor uuid, p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt()->>'aal','') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode='42501',
      message='recent same-session staff scheduling AAL2 evidence is required';
  end if;
  begin v_session_id := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',
      message='recent same-session staff scheduling AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id=event.challenge_id and challenge.user_id=event.user_id
   and challenge.session_id=event.session_id
  where event.user_id=p_actor and event.session_id=v_session_id
    and event.aal='aal2' and event.revoked_at is null
    and event.verification_method in ('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and challenge.factor_verified_at=event.verified_at
    and challenge.factor_verified_at >= p_reference_time-interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time+interval '1 minute'
  order by challenge.factor_verified_at desc,challenge.id desc
  limit 1 for share of event,challenge;
  if v_challenge_id is null then
    raise exception using errcode='42501',
      message='recent same-session staff scheduling AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.staff_scheduling_evaluate(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_schedule_key uuid,
  p_staff_membership_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_role_text text,
  p_facility_code text,
  p_vehicle_code text,
  p_planned_clients integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule private.staff_scheduling_rule_versions%rowtype;
  v_qualification_rule jsonb;
  v_facility_rule jsonb;
  v_vehicle_rule jsonb;
  v_certificate_bundle jsonb;
  v_certificate_record jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_evidence jsonb := '[]'::jsonb;
  v_max_shift integer;
  v_min_rest integer;
  v_duration integer;
  v_existing_count bigint;
  v_existing_clients bigint;
begin
  select * into v_rule from private.staff_scheduling_rule_versions rule
  where rule.organization_id=p_expected_organization_id
    and rule.branch_id=p_expected_branch_id
    and rule.effective_from <= (p_starts_at at time zone 'Asia/Taipei')::date
    and (rule.effective_to is null or
      rule.effective_to >= (p_ends_at at time zone 'Asia/Taipei')::date)
  order by rule.version desc limit 2;
  if not found then
    raise exception using errcode='55000',
      message='staff scheduling rules are not configured for this period';
  end if;

  select value into v_qualification_rule
  from jsonb_array_elements(v_rule.rule_payload->'qualification_rules') item(value)
  where lower(btrim(value->>'role_text'))=lower(btrim(p_role_text)) limit 1;
  if v_qualification_rule is null then
    raise exception using errcode='55000',
      message='staff scheduling qualification rule is not configured for this role';
  end if;
  select value into v_facility_rule
  from jsonb_array_elements(v_rule.rule_payload->'facilities') item(value)
  where lower(value->>'facility_code')=lower(p_facility_code) limit 1;
  if v_facility_rule is null then
    raise exception using errcode='55000',
      message='staff scheduling facility rule is not configured';
  end if;
  select value into v_vehicle_rule
  from jsonb_array_elements(v_rule.rule_payload->'vehicles') item(value)
  where lower(value->>'vehicle_code')=lower(p_vehicle_code) limit 1;
  if v_vehicle_rule is null then
    raise exception using errcode='55000',
      message='staff scheduling vehicle rule is not configured';
  end if;

  v_max_shift := (v_rule.rule_payload->'work_rules'->>'max_shift_minutes')::integer;
  v_min_rest := (v_rule.rule_payload->'work_rules'->>'min_rest_minutes')::integer;
  v_duration := ceil(extract(epoch from (p_ends_at-p_starts_at))/60)::integer;
  if v_duration > v_max_shift then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','work_time','code','shift_duration_exceeded',
      'message','班次長度超過所選人工規則版本的上限。',
      'observed_minutes',v_duration,'rule_minutes',v_max_shift
    ));
  end if;

  v_certificate_bundle := private.staff_certificate_snapshot_bundle(
    p_expected_organization_id,p_expected_branch_id,p_starts_at,
    p_staff_membership_id,v_qualification_rule->>'required_certificate_type',
    'all',null
  );
  if coalesce((v_certificate_bundle->>'records_truncated')::boolean,false) then
    raise exception using errcode='55000',
      message='Page-72 qualification projection is truncated';
  end if;
  select value into v_certificate_record
  from jsonb_array_elements(v_certificate_bundle->'records') item(value)
  where value->>'record_status'='active'
    and (value->>'validity_status'='active'
      or coalesce((value->>'has_active_exception')::boolean,false))
  order by (value->>'version')::integer desc limit 1;
  if v_certificate_record is null then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','qualification','code','terminal_certificate_evidence_missing',
      'message','第 72 頁終端投影沒有符合此人工職務規則的有效證照證據。',
      'required_certificate_type',v_qualification_rule->>'required_certificate_type',
      'source_page',72
    ));
  else
    v_evidence := jsonb_build_array(jsonb_build_object(
      'source_page',72,
      'record_version_id',v_certificate_record->>'record_version_id',
      'certificate_key',v_certificate_record->>'certificate_key',
      'version',(v_certificate_record->>'version')::integer,
      'certificate_type',v_certificate_record->>'certificate_type',
      'validity_status',v_certificate_record->>'validity_status',
      'has_active_exception',coalesce(
        (v_certificate_record->>'has_active_exception')::boolean,false),
      'snapshot_date',v_certificate_bundle->>'snapshot_date'
    ));
  end if;

  with latest as (
    select distinct on (schedule.schedule_key) schedule.*
    from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
      and schedule.schedule_key<>p_schedule_key
    order by schedule.schedule_key,schedule.version desc
  )
  select count(*) into v_existing_count from latest
  where status='published' and staff_membership_id=p_staff_membership_id
    and starts_at<p_ends_at and ends_at>p_starts_at;
  if v_existing_count>0 then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','work_time','code','staff_time_overlap',
      'message','此員工已有重疊的已發布班次。',
      'overlapping_schedule_count',v_existing_count
    ));
  end if;

  with latest as (
    select distinct on (schedule.schedule_key) schedule.*
    from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
      and schedule.schedule_key<>p_schedule_key
    order by schedule.schedule_key,schedule.version desc
  )
  select count(*) into v_existing_count from latest
  where status='published' and staff_membership_id=p_staff_membership_id
    and ((ends_at<=p_starts_at and
      extract(epoch from (p_starts_at-ends_at))/60<v_min_rest)
      or (starts_at>=p_ends_at and
      extract(epoch from (starts_at-p_ends_at))/60<v_min_rest));
  if v_existing_count>0 then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','rest','code','minimum_rest_not_met',
      'message','此班次與既有已發布班次之間未達人工休息規則。',
      'nearby_schedule_count',v_existing_count,'rule_minutes',v_min_rest
    ));
  end if;

  with latest as (
    select distinct on (schedule.schedule_key) schedule.*
    from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
      and schedule.schedule_key<>p_schedule_key
    order by schedule.schedule_key,schedule.version desc
  )
  select coalesce(sum(planned_clients),0)::bigint into v_existing_clients from latest
  where status='published' and lower(facility_code)=lower(p_facility_code)
    and starts_at<p_ends_at and ends_at>p_starts_at;
  if v_existing_clients+p_planned_clients>(v_facility_rule->>'capacity')::integer then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','facility','code','facility_capacity_exceeded',
      'message','重疊班次的人數超過人工場地容量規則。',
      'existing_clients',v_existing_clients,'planned_clients',p_planned_clients,
      'rule_capacity',(v_facility_rule->>'capacity')::integer
    ));
  end if;

  with latest as (
    select distinct on (schedule.schedule_key) schedule.*
    from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
      and schedule.schedule_key<>p_schedule_key
    order by schedule.schedule_key,schedule.version desc
  )
  select coalesce(sum(planned_clients),0)::bigint into v_existing_clients from latest
  where status='published' and lower(vehicle_code)=lower(p_vehicle_code)
    and starts_at<p_ends_at and ends_at>p_starts_at;
  if v_existing_clients+p_planned_clients>(v_vehicle_rule->>'capacity')::integer then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','vehicle','code','vehicle_capacity_exceeded',
      'message','重疊班次的人數超過人工車輛容量規則。',
      'existing_clients',v_existing_clients,'planned_clients',p_planned_clients,
      'rule_capacity',(v_vehicle_rule->>'capacity')::integer
    ));
  end if;

  with latest as (
    select distinct on (schedule.schedule_key) schedule.*
    from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
      and schedule.schedule_key<>p_schedule_key
    order by schedule.schedule_key,schedule.version desc
  )
  select coalesce(sum(planned_clients),0)::bigint into v_existing_clients from latest
  where status='published' and starts_at<p_ends_at and ends_at>p_starts_at;
  if v_existing_clients+p_planned_clients>
     (v_rule.rule_payload->>'branch_capacity')::integer then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'domain','branch_capacity','code','branch_capacity_exceeded',
      'message','重疊班次的人數超過人工分支容量規則。',
      'existing_clients',v_existing_clients,'planned_clients',p_planned_clients,
      'rule_capacity',(v_rule.rule_payload->>'branch_capacity')::integer
    ));
  end if;

  return jsonb_build_object(
    'rule_version_id',v_rule.id,
    'rule_version',v_rule.version,
    'rule_content_hash',v_rule.content_hash,
    'rule_source_status',v_rule.source_status,
    'conflicts',v_conflicts,
    'conflict_count',jsonb_array_length(v_conflicts),
    'qualification_evidence',v_evidence,
    'qualification_projection','page72_terminal',
    'qualification_exception_status','page72_projection_only'
  );
end;
$$;

create or replace function private.submit_staff_schedule_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_schedule_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_expected_content_hash text,
  p_staff_membership_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_role_text text,
  p_service_need_text text,
  p_facility_code text,
  p_vehicle_code text,
  p_planned_clients integer,
  p_revision_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, schedule_key uuid,
  schedule_version_id uuid, schedule_version integer,
  schedule_status text, staff_membership_id uuid,
  rule_version_id uuid, conflict_count integer,
  content_hash text, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
  v_actor_name text; v_staff public.memberships%rowtype; v_staff_profile public.profiles%rowtype;
  v_reauth uuid; v_request_hash text; v_evaluation jsonb;
  v_existing private.staff_scheduling_operations%rowtype;
  v_previous public.staff_schedule_versions%rowtype;
  v_result public.staff_schedule_versions%rowtype;
  v_version integer; v_status text; v_hash text;
begin
  if p_action not in ('create','revise') or p_schedule_key is null
     or p_staff_membership_id is null or p_starts_at is null or p_ends_at is null
     or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '7 days'
     or p_planned_clients not between 1 and 10000
     or not private.staff_scheduling_text_ok(p_role_text,1,160)
     or not private.staff_scheduling_text_ok(p_service_need_text,1,500,true)
     or coalesce(p_facility_code,'') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
     or coalesce(p_vehicle_code,'') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'
     or not private.staff_scheduling_text_ok(p_revision_reason,1,1000,true)
     or p_idempotency_key is null
     or (p_action='create' and (p_previous_version_id is not null
       or p_expected_version<>0 or p_expected_content_hash is not null))
     or (p_action='revise' and (p_previous_version_id is null
       or p_expected_version<1 or p_expected_content_hash !~ '^[a-f0-9]{64}$')) then
    raise exception using errcode='22023',message='staff scheduling input is invalid';
  end if;
  if not private.staff_scheduling_authority(
    p_expected_organization_id,p_expected_branch_id,'staff_scheduling.manage',true
  ) then raise exception using errcode='42501',message='staff scheduling write is not permitted';
  end if;
  select display_name into v_actor_name from public.profiles
  where id=v_actor and is_active;
  if v_actor_name is null then raise exception using errcode='42501',message='staff scheduling actor is inactive'; end if;
  v_reauth:=private.require_staff_scheduling_reauth(v_actor,v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-scheduling-idempotency:'||p_expected_organization_id::text||':'||
    v_actor::text||':'||p_idempotency_key::text,0));
  v_request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'action',p_action,'schedule_key',p_schedule_key,
    'previous_version_id',p_previous_version_id,'expected_version',p_expected_version,
    'expected_content_hash',p_expected_content_hash,
    'staff_membership_id',p_staff_membership_id,'starts_at',p_starts_at,
    'ends_at',p_ends_at,'role_text',btrim(p_role_text),
    'service_need_text',btrim(p_service_need_text),
    'facility_code',p_facility_code,'vehicle_code',p_vehicle_code,
    'planned_clients',p_planned_clients,'revision_reason',btrim(p_revision_reason)
  )::text,'UTF8')),'hex');
  select * into v_existing from private.staff_scheduling_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>v_request_hash or v_existing.operation<>p_action then
      raise exception using errcode='23505',message='staff scheduling idempotency key conflict';
    end if;
    return query select v_existing.organization_id,v_existing.branch_id,
      v_existing.result_schedule_key,v_existing.result_version_id,
      v_existing.result_version,v_existing.result_status,
      replay.staff_membership_id,v_existing.result_rule_version_id,
      v_existing.result_conflict_count,replay.content_hash,
      v_existing.committed_at,true
    from public.staff_schedule_versions replay where replay.id=v_existing.result_version_id;
    return;
  end if;
  select * into v_staff from public.memberships membership
  where membership.id=p_staff_membership_id
    and membership.organization_id=p_expected_organization_id
    and membership.branch_id=p_expected_branch_id
    and membership.status='active'
    and membership.starts_at<=p_starts_at
    and (membership.ends_at is null or membership.ends_at>=p_ends_at)
  for share;
  if not found then raise exception using errcode='42501',message='scheduled staff is outside current branch or employment period'; end if;
  select * into v_staff_profile from public.profiles profile
  where profile.id=v_staff.profile_id and profile.is_active
    and profile.kind in ('staff','professional','driver','finance') for share;
  if not found then raise exception using errcode='42501',message='scheduled staff profile is unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-scheduling-chain:'||p_schedule_key::text,0));
  if p_action='create' then
    if exists(select 1 from public.staff_schedule_versions schedule
      where schedule.schedule_key=p_schedule_key) then
      raise exception using errcode='23505',message='staff scheduling key already exists';
    end if;
    v_version:=1;
  else
    select * into v_previous from public.staff_schedule_versions schedule
    where schedule.schedule_key=p_schedule_key
      and schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
    order by schedule.version desc limit 1 for update;
    if not found or v_previous.id<>p_previous_version_id
       or v_previous.version<>p_expected_version
       or v_previous.content_hash<>p_expected_content_hash
       or v_previous.status not in ('draft_ready','draft_conflicted') then
      raise exception using errcode='40001',message='staff scheduling chain is stale';
    end if;
    v_version:=v_previous.version+1;
  end if;
  v_evaluation:=private.staff_scheduling_evaluate(
    p_expected_organization_id,p_expected_branch_id,p_schedule_key,
    p_staff_membership_id,p_starts_at,p_ends_at,btrim(p_role_text),
    p_facility_code,p_vehicle_code,p_planned_clients);
  v_status:=case when (v_evaluation->>'conflict_count')::integer=0
    then 'draft_ready' else 'draft_conflicted' end;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'schedule_key',p_schedule_key,'version',v_version,
    'previous_version_id',p_previous_version_id,'status',v_status,
    'rule_version_id',(v_evaluation->>'rule_version_id')::uuid,
    'staff_membership_id',p_staff_membership_id,'staff_user_id',v_staff.profile_id,
    'starts_at',p_starts_at,'ends_at',p_ends_at,'role_text',btrim(p_role_text),
    'service_need_text',btrim(p_service_need_text),
    'facility_code',p_facility_code,'vehicle_code',p_vehicle_code,
    'planned_clients',p_planned_clients,'conflicts',v_evaluation->'conflicts',
    'qualification_evidence',v_evaluation->'qualification_evidence',
    'revision_reason',btrim(p_revision_reason)
  )::text,'UTF8')),'hex');
  insert into public.staff_schedule_versions(
    organization_id,branch_id,schedule_key,version,previous_version_id,status,
    review_mode,rule_version_id,staff_membership_id,staff_user_id,
    staff_display_name_snapshot,staff_employee_code_snapshot,starts_at,ends_at,
    role_text,service_need_text,facility_code,vehicle_code,planned_clients,
    conflict_count,conflicts,qualification_evidence,revision_reason,
    created_by,creator_display_name,creator_reauth_challenge_id,content_hash
  ) values (
    p_expected_organization_id,p_expected_branch_id,p_schedule_key,v_version,
    p_previous_version_id,v_status,null,(v_evaluation->>'rule_version_id')::uuid,
    p_staff_membership_id,v_staff.profile_id,btrim(v_staff_profile.display_name),
    nullif(btrim(v_staff_profile.employee_code),''),p_starts_at,p_ends_at,
    btrim(p_role_text),btrim(p_service_need_text),p_facility_code,p_vehicle_code,
    p_planned_clients,(v_evaluation->>'conflict_count')::integer,
    v_evaluation->'conflicts',v_evaluation->'qualification_evidence',
    btrim(p_revision_reason),v_actor,btrim(v_actor_name),v_reauth,v_hash
  ) returning * into v_result;
  insert into private.staff_scheduling_operations(
    organization_id,branch_id,actor_user_id,idempotency_key,operation,
    request_hash,result_schedule_key,result_version_id,result_version,
    result_status,result_conflict_count,result_rule_version_id,
    result_decision_id,committed_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
    p_action,v_request_hash,p_schedule_key,v_result.id,v_result.version,
    v_result.status,v_result.conflict_count,v_result.rule_version_id,null,v_now
  );
  return query select p_expected_organization_id,p_expected_branch_id,p_schedule_key,
    v_result.id,v_result.version,v_result.status,p_staff_membership_id,
    v_result.rule_version_id,v_result.conflict_count,v_result.content_hash,v_now,false;
end;
$$;

create or replace function private.decide_staff_schedule_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_schedule_version_id uuid,
  p_expected_schedule_key uuid,
  p_expected_version integer,
  p_expected_content_hash text,
  p_expected_conflict_count integer,
  p_decision text,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, schedule_key uuid,
  decided_version_id uuid, expected_version integer,
  decision_id uuid, decision text, result_version_id uuid,
  result_version integer, result_status text, review_mode text,
  conflict_count integer, rule_version_id uuid, content_hash text,
  decided_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
  v_actor_name text; v_reauth uuid; v_request_hash text;
  v_existing private.staff_scheduling_operations%rowtype;
  v_draft public.staff_schedule_versions%rowtype;
  v_latest public.staff_schedule_versions%rowtype;
  v_evaluation jsonb; v_result public.staff_schedule_versions%rowtype;
  v_decision public.staff_schedule_decisions%rowtype;
  v_result_status text; v_review_mode text; v_hash text; v_decision_hash text;
begin
  if p_schedule_version_id is null or p_expected_schedule_key is null
     or p_expected_version<1 or p_expected_content_hash !~ '^[a-f0-9]{64}$'
     or p_expected_conflict_count not between 0 and 20
     or p_decision not in ('publish','override','reject')
     or not private.staff_scheduling_text_ok(p_reason,1,1000,true)
     or p_idempotency_key is null then
    raise exception using errcode='22023',message='staff scheduling decision input is invalid';
  end if;
  if not private.staff_scheduling_authority(
    p_expected_organization_id,p_expected_branch_id,'staff_scheduling.approve',true
  ) or (p_decision='override' and not private.staff_scheduling_authority(
    p_expected_organization_id,p_expected_branch_id,'staff_scheduling.override',true
  )) then raise exception using errcode='42501',message='staff scheduling decision is not permitted';
  end if;
  select display_name into v_actor_name from public.profiles where id=v_actor and is_active;
  if v_actor_name is null then raise exception using errcode='42501',message='staff scheduling reviewer is inactive'; end if;
  v_reauth:=private.require_staff_scheduling_reauth(v_actor,v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-scheduling-idempotency:'||p_expected_organization_id::text||':'||
    v_actor::text||':'||p_idempotency_key::text,0));
  v_request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'schedule_version_id',p_schedule_version_id,
    'expected_schedule_key',p_expected_schedule_key,
    'expected_version',p_expected_version,'expected_content_hash',p_expected_content_hash,
    'expected_conflict_count',p_expected_conflict_count,
    'decision',p_decision,'reason',btrim(p_reason)
  )::text,'UTF8')),'hex');
  select * into v_existing from private.staff_scheduling_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>v_request_hash or v_existing.operation<>p_decision then
      raise exception using errcode='23505',message='staff scheduling idempotency key conflict';
    end if;
    return query select v_existing.organization_id,v_existing.branch_id,
      v_existing.result_schedule_key,decision_row.decided_version_id,
      decision_row.expected_version,decision_row.id,decision_row.decision,
      v_existing.result_version_id,v_existing.result_version,v_existing.result_status,
      replay.review_mode,v_existing.result_conflict_count,
      v_existing.result_rule_version_id,replay.content_hash,
      v_existing.committed_at,true
    from public.staff_schedule_decisions decision_row
    join public.staff_schedule_versions replay on replay.id=v_existing.result_version_id
    where decision_row.id=v_existing.result_decision_id;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-scheduling-chain:'||p_expected_schedule_key::text,0));
  select * into v_latest from public.staff_schedule_versions schedule
  where schedule.schedule_key=p_expected_schedule_key
    and schedule.organization_id=p_expected_organization_id
    and schedule.branch_id=p_expected_branch_id
  order by schedule.version desc limit 1 for update;
  if not found or v_latest.id<>p_schedule_version_id
     or v_latest.version<>p_expected_version
     or v_latest.content_hash<>p_expected_content_hash
     or v_latest.conflict_count<>p_expected_conflict_count
     or v_latest.status not in ('draft_ready','draft_conflicted') then
    raise exception using errcode='40001',message='staff scheduling decision target is stale';
  end if;
  v_draft:=v_latest;
  if v_draft.created_by=v_actor then
    raise exception using errcode='42501',message='staff scheduling creator cannot review the same draft';
  end if;
  if (p_decision='publish' and v_draft.conflict_count<>0)
     or (p_decision='override' and v_draft.conflict_count=0) then
    raise exception using errcode='22023',message='staff scheduling decision does not match conflicts';
  end if;
  if p_decision<>'reject' then
    perform pg_advisory_xact_lock(hashtextextended(
      'staff-scheduling-staff:'||v_draft.staff_membership_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended(
      'staff-scheduling-facility:'||p_expected_branch_id::text||':'||lower(v_draft.facility_code),0));
    perform pg_advisory_xact_lock(hashtextextended(
      'staff-scheduling-vehicle:'||p_expected_branch_id::text||':'||lower(v_draft.vehicle_code),0));
    perform pg_advisory_xact_lock(hashtextextended(
      'staff-scheduling-branch:'||p_expected_branch_id::text,0));
    v_evaluation:=private.staff_scheduling_evaluate(
      p_expected_organization_id,p_expected_branch_id,v_draft.schedule_key,
      v_draft.staff_membership_id,v_draft.starts_at,v_draft.ends_at,
      v_draft.role_text,v_draft.facility_code,v_draft.vehicle_code,
      v_draft.planned_clients);
    if (v_evaluation->>'rule_version_id')::uuid<>v_draft.rule_version_id
       or (v_evaluation->>'conflict_count')::integer<>v_draft.conflict_count
       or v_evaluation->'conflicts' is distinct from v_draft.conflicts
       or v_evaluation->'qualification_evidence'
          is distinct from v_draft.qualification_evidence then
      raise exception using errcode='40001',message='staff scheduling evidence changed before review';
    end if;
  end if;
  v_result_status:=case when p_decision='reject' then 'voided' else 'published' end;
  v_review_mode:=case p_decision when 'publish' then 'standard'
    when 'override' then 'override' else 'rejected' end;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'organization_id',v_draft.organization_id,'branch_id',v_draft.branch_id,
    'schedule_key',v_draft.schedule_key,'version',v_draft.version+1,
    'previous_version_id',v_draft.id,'status',v_result_status,
    'review_mode',v_review_mode,'rule_version_id',v_draft.rule_version_id,
    'staff_membership_id',v_draft.staff_membership_id,
    'staff_user_id',v_draft.staff_user_id,'starts_at',v_draft.starts_at,
    'ends_at',v_draft.ends_at,'role_text',v_draft.role_text,
    'service_need_text',v_draft.service_need_text,
    'facility_code',v_draft.facility_code,'vehicle_code',v_draft.vehicle_code,
    'planned_clients',v_draft.planned_clients,'conflicts',v_draft.conflicts,
    'qualification_evidence',v_draft.qualification_evidence,
    'revision_reason',v_draft.revision_reason,
    'reviewed_by',v_actor,'reviewed_at',v_now,'review_reason',btrim(p_reason)
  )::text,'UTF8')),'hex');
  insert into public.staff_schedule_versions(
    organization_id,branch_id,schedule_key,version,previous_version_id,status,
    review_mode,rule_version_id,staff_membership_id,staff_user_id,
    staff_display_name_snapshot,staff_employee_code_snapshot,starts_at,ends_at,
    role_text,service_need_text,facility_code,vehicle_code,planned_clients,
    conflict_count,conflicts,qualification_evidence,revision_reason,
    created_by,creator_display_name,creator_reauth_challenge_id,
    reviewed_by,reviewer_display_name,reviewed_at,review_reason,content_hash
  ) values (
    v_draft.organization_id,v_draft.branch_id,v_draft.schedule_key,v_draft.version+1,
    v_draft.id,v_result_status,v_review_mode,v_draft.rule_version_id,
    v_draft.staff_membership_id,v_draft.staff_user_id,
    v_draft.staff_display_name_snapshot,v_draft.staff_employee_code_snapshot,
    v_draft.starts_at,v_draft.ends_at,v_draft.role_text,v_draft.service_need_text,
    v_draft.facility_code,v_draft.vehicle_code,v_draft.planned_clients,
    v_draft.conflict_count,v_draft.conflicts,v_draft.qualification_evidence,
    v_draft.revision_reason,v_draft.created_by,v_draft.creator_display_name,
    v_draft.creator_reauth_challenge_id,v_actor,btrim(v_actor_name),v_now,btrim(p_reason),v_hash
  ) returning * into v_result;
  v_decision_hash:=encode(sha256(convert_to(jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'schedule_key',p_expected_schedule_key,'decided_version_id',v_draft.id,
    'expected_version',p_expected_version,'expected_content_hash',p_expected_content_hash,
    'expected_conflict_count',p_expected_conflict_count,'decision',p_decision,
    'reason',btrim(p_reason),'decided_by',v_actor,
    'result_version_id',v_result.id,'result_version',v_result.version
  )::text,'UTF8')),'hex');
  insert into public.staff_schedule_decisions(
    organization_id,branch_id,schedule_key,decided_version_id,expected_version,
    expected_content_hash,expected_conflict_count,decision,reason,decided_by,
    decider_display_name,reauth_challenge_id,result_version_id,result_version,
    decided_at,content_hash
  ) values (
    p_expected_organization_id,p_expected_branch_id,p_expected_schedule_key,
    v_draft.id,p_expected_version,p_expected_content_hash,p_expected_conflict_count,
    p_decision,btrim(p_reason),v_actor,btrim(v_actor_name),v_reauth,
    v_result.id,v_result.version,v_now,v_decision_hash
  ) returning * into v_decision;
  insert into private.staff_scheduling_operations(
    organization_id,branch_id,actor_user_id,idempotency_key,operation,
    request_hash,result_schedule_key,result_version_id,result_version,
    result_status,result_conflict_count,result_rule_version_id,
    result_decision_id,committed_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
    p_decision,v_request_hash,p_expected_schedule_key,v_result.id,v_result.version,
    v_result.status,v_result.conflict_count,v_result.rule_version_id,v_decision.id,v_now
  );
  return query select p_expected_organization_id,p_expected_branch_id,
    p_expected_schedule_key,v_draft.id,p_expected_version,v_decision.id,p_decision,
    v_result.id,v_result.version,v_result.status,v_result.review_mode,
    v_result.conflict_count,v_result.rule_version_id,v_result.content_hash,v_now,false;
end;
$$;

create or replace function private.staff_scheduling_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_period_start date,
  p_period_end date,
  p_staff_membership_id uuid,
  p_status text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_records jsonb:='[]'::jsonb; v_record_total bigint:=0;
  v_history jsonb:='[]'::jsonb; v_history_total bigint:=0;
  v_staff jsonb:='[]'::jsonb; v_staff_total bigint:=0;
  v_ready bigint:=0; v_conflicted bigint:=0; v_published bigint:=0;
  v_overridden bigint:=0; v_rejected bigint:=0;
  v_rule private.staff_scheduling_rule_versions%rowtype;
  v_rule_count integer:=0;
begin
  select count(*)::integer into v_rule_count
  from private.staff_scheduling_rule_versions rule
  where rule.organization_id=p_expected_organization_id
    and rule.branch_id=p_expected_branch_id
    and rule.effective_from<=p_period_start
    and (rule.effective_to is null or rule.effective_to>=p_period_end);
  if v_rule_count=1 then
    select * into v_rule from private.staff_scheduling_rule_versions rule
    where rule.organization_id=p_expected_organization_id
      and rule.branch_id=p_expected_branch_id
      and rule.effective_from<=p_period_start
      and (rule.effective_to is null or rule.effective_to>=p_period_end)
    order by version desc limit 1;
  end if;

  with latest as (
    select distinct on (schedule.schedule_key) schedule.*
    from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
    order by schedule.schedule_key,schedule.version desc
  ), filtered as (
    select latest.* from latest
    where starts_at < ((p_period_end+1)::timestamp at time zone 'Asia/Taipei')
      and ends_at >= (p_period_start::timestamp at time zone 'Asia/Taipei')
      and (p_staff_membership_id is null or staff_membership_id=p_staff_membership_id)
      and (p_status='all'
        or (p_status='ready' and status='draft_ready')
        or (p_status='conflicted' and status='draft_conflicted')
        or (p_status='published' and status='published' and review_mode='standard')
        or (p_status='overridden' and status='published' and review_mode='override')
        or (p_status='rejected' and status='voided'))
  ), ranked as (
    select filtered.*,row_number() over(order by starts_at,staff_display_name_snapshot collate "C",schedule_key) row_number
    from filtered
  )
  select count(*)::bigint,
    count(*) filter(where status='draft_ready')::bigint,
    count(*) filter(where status='draft_conflicted')::bigint,
    count(*) filter(where status='published')::bigint,
    count(*) filter(where status='published' and review_mode='override')::bigint,
    count(*) filter(where status='voided')::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'schedule_version_id',id,'schedule_key',schedule_key,'version',version,
      'previous_version_id',previous_version_id,'status',status,
      'review_mode',review_mode,'rule_version_id',rule_version_id,
      'staff_membership_id',staff_membership_id,'staff_user_id',staff_user_id,
      'staff_display_name',staff_display_name_snapshot,
      'staff_employee_code',staff_employee_code_snapshot,
      'starts_at',starts_at,'ends_at',ends_at,'role_text',role_text,
      'service_need_text',service_need_text,'facility_code',facility_code,
      'vehicle_code',vehicle_code,'planned_clients',planned_clients,
      'conflict_count',conflict_count,'conflicts',conflicts,
      'qualification_evidence',qualification_evidence,
      'qualification_projection','page72_terminal',
      'revision_reason',revision_reason,'created_by',created_by,
      'creator_display_name',creator_display_name,'created_at',created_at,
      'reviewed_by',reviewed_by,'reviewer_display_name',reviewer_display_name,
      'reviewed_at',reviewed_at,'review_reason',review_reason,
      'content_hash',content_hash
    ) order by starts_at,staff_display_name_snapshot collate "C",schedule_key)
      filter(where row_number<=200),'[]'::jsonb)
  into v_record_total,v_ready,v_conflicted,v_published,v_overridden,v_rejected,v_records
  from ranked;

  with visible as (
    select schedule.* from public.staff_schedule_versions schedule
    where schedule.organization_id=p_expected_organization_id
      and schedule.branch_id=p_expected_branch_id
      and starts_at < ((p_period_end+1)::timestamp at time zone 'Asia/Taipei')
      and ends_at >= (p_period_start::timestamp at time zone 'Asia/Taipei')
      and (p_staff_membership_id is null or staff_membership_id=p_staff_membership_id)
  ), ranked as (
    select visible.*,row_number() over(order by schedule_key,version desc) row_number
    from visible
  )
  select count(*)::bigint,coalesce(jsonb_agg(jsonb_build_object(
    'schedule_version_id',id,'schedule_key',schedule_key,'version',version,
    'previous_version_id',previous_version_id,'status',status,
    'review_mode',review_mode,'rule_version_id',rule_version_id,
    'conflict_count',conflict_count,'content_hash',content_hash,
    'created_at',created_at,'creator_display_name',creator_display_name,
    'reviewed_at',reviewed_at,'reviewer_display_name',reviewer_display_name
  ) order by schedule_key,version desc) filter(where row_number<=500),'[]'::jsonb)
  into v_history_total,v_history from ranked;

  with candidates as (
    select membership.id staff_membership_id,membership.profile_id staff_user_id,
      profile.display_name,profile.employee_code
    from public.memberships membership
    join public.profiles profile on profile.id=membership.profile_id
    where membership.organization_id=p_expected_organization_id
      and membership.branch_id=p_expected_branch_id
      and membership.status='active' and membership.starts_at<=p_now
      and (membership.ends_at is null or membership.ends_at>p_now)
      and profile.is_active
      and profile.kind in ('staff','professional','driver','finance')
  ), ranked as (
    select candidates.*,row_number() over(order by display_name collate "C",staff_membership_id) row_number
    from candidates
  )
  select count(*)::bigint,coalesce(jsonb_agg(jsonb_build_object(
    'staff_membership_id',staff_membership_id,'staff_user_id',staff_user_id,
    'display_name',display_name,'employee_code',employee_code
  ) order by display_name collate "C",staff_membership_id)
    filter(where row_number<=200),'[]'::jsonb)
  into v_staff_total,v_staff from ranked;

  return jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'generated_at',p_now,'period_start',p_period_start,'period_end',p_period_end,
    'records',v_records,'record_total',v_record_total,
    'records_truncated',v_record_total>200,
    'ready_total',v_ready,'conflicted_total',v_conflicted,
    'published_total',v_published,'overridden_total',v_overridden,
    'rejected_total',v_rejected,
    'history',v_history,'history_total',v_history_total,
    'history_truncated',v_history_total>500,
    'staff_options',v_staff,'staff_total',v_staff_total,
    'staff_truncated',v_staff_total>200,
    'rule_configuration_status',case when v_rule_count=1
      then 'configured_manual_unstandardized' else 'not_configured' end,
    'rule_version',case when v_rule_count=1 then jsonb_build_object(
      'rule_version_id',v_rule.id,'rule_set_key',v_rule.rule_set_key,
      'version',v_rule.version,'effective_from',v_rule.effective_from,
      'effective_to',v_rule.effective_to,'source_status',v_rule.source_status,
      'rule_payload',v_rule.rule_payload,'content_hash',v_rule.content_hash
    ) else null end,
    'qualification_rule_status',case when v_rule_count=1 then
      'configured_manual_unstandardized' else 'not_configured' end,
    'work_time_rule_status',case when v_rule_count=1 then
      'configured_manual_unstandardized' else 'not_configured' end,
    'rest_rule_status',case when v_rule_count=1 then
      'configured_manual_unstandardized' else 'not_configured' end,
    'facility_rule_status',case when v_rule_count=1 then
      'configured_manual_unstandardized' else 'not_configured' end,
    'vehicle_rule_status',case when v_rule_count=1 then
      'configured_manual_unstandardized' else 'not_configured' end,
    'capacity_rule_status',case when v_rule_count=1 then
      'configured_manual_unstandardized' else 'not_configured' end,
    'qualification_projection','page72_terminal',
    'decision_engine','deterministic_rule_assisted',
    'ai_status','not_used','automatic_publish_status','disabled',
    'export_status','disabled','offline_status','disabled'
  );
end;
$$;

create or replace function private.staff_scheduling_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_period_start date,
  p_period_end date,
  p_staff_membership_id uuid,
  p_status text
)
returns table(payload jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
  v_bundle jsonb; v_after jsonb; v_status text:=lower(btrim(coalesce(p_status,'all')));
begin
  if not private.staff_scheduling_authority(
    p_expected_organization_id,p_expected_branch_id,'staff_scheduling.read',false
  ) then raise exception using errcode='42501',message='staff scheduling snapshot is not permitted';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start
     or p_period_end>p_period_start+62
     or v_status not in ('all','ready','conflicted','published','overridden','rejected') then
    raise exception using errcode='22023',message='staff scheduling filters are invalid';
  end if;
  if p_staff_membership_id is not null and not exists(
    select 1 from public.memberships membership
    where membership.id=p_staff_membership_id
      and membership.organization_id=p_expected_organization_id
      and membership.branch_id=p_expected_branch_id
  ) then raise exception using errcode='42501',message='staff scheduling staff filter is outside scope';
  end if;
  v_bundle:=private.staff_scheduling_snapshot_bundle(
    p_expected_organization_id,p_expected_branch_id,v_now,p_period_start,
    p_period_end,p_staff_membership_id,v_status);
  insert into public.audit_events(
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'staff_scheduling_snapshot',p_expected_branch_id::text,
    array['bounded_snapshot'],jsonb_build_object(
      'workflow','page63_staff_scheduling_v1','generated_at',v_now,
      'period_days',(p_period_end-p_period_start)+1,'status',v_status,
      'staff_filter_present',p_staff_membership_id is not null,
      'record_total',v_bundle->'record_total',
      'rules_configured',v_bundle->>'rule_configuration_status'<>'not_configured'
    )
  );
  if not private.staff_scheduling_authority(
    p_expected_organization_id,p_expected_branch_id,'staff_scheduling.read',false
  ) then raise exception using errcode='42501',message='staff scheduling snapshot final verification failed';
  end if;
  v_after:=private.staff_scheduling_snapshot_bundle(
    p_expected_organization_id,p_expected_branch_id,v_now,p_period_start,
    p_period_end,p_staff_membership_id,v_status);
  if v_after is distinct from v_bundle then
    raise exception using errcode='40001',message='staff scheduling snapshot changed during audit';
  end if;
  return query select v_bundle;
end;
$$;

create or replace function public.submit_staff_schedule(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
  p_schedule_key uuid,p_previous_version_id uuid,p_expected_version integer,
  p_expected_content_hash text,p_staff_membership_id uuid,
  p_starts_at timestamptz,p_ends_at timestamptz,p_role_text text,
  p_service_need_text text,p_facility_code text,p_vehicle_code text,
  p_planned_clients integer,p_revision_reason text,p_idempotency_key uuid
)
returns table(
  organization_id uuid,branch_id uuid,schedule_key uuid,schedule_version_id uuid,
  schedule_version integer,schedule_status text,staff_membership_id uuid,
  rule_version_id uuid,conflict_count integer,content_hash text,
  committed_at timestamptz,replayed boolean
)
language sql volatile security invoker set search_path='' as $$
  select * from private.submit_staff_schedule_guarded(
    p_expected_organization_id,p_expected_branch_id,p_action,p_schedule_key,
    p_previous_version_id,p_expected_version,p_expected_content_hash,
    p_staff_membership_id,p_starts_at,p_ends_at,p_role_text,p_service_need_text,
    p_facility_code,p_vehicle_code,p_planned_clients,p_revision_reason,p_idempotency_key
  );
$$;

create or replace function public.decide_staff_schedule(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_schedule_version_id uuid,p_expected_schedule_key uuid,
  p_expected_version integer,p_expected_content_hash text,
  p_expected_conflict_count integer,p_decision text,p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,branch_id uuid,schedule_key uuid,decided_version_id uuid,
  expected_version integer,decision_id uuid,decision text,result_version_id uuid,
  result_version integer,result_status text,review_mode text,
  conflict_count integer,rule_version_id uuid,content_hash text,
  decided_at timestamptz,replayed boolean
)
language sql volatile security invoker set search_path='' as $$
  select * from private.decide_staff_schedule_guarded(
    p_expected_organization_id,p_expected_branch_id,p_schedule_version_id,
    p_expected_schedule_key,p_expected_version,p_expected_content_hash,
    p_expected_conflict_count,p_decision,p_reason,p_idempotency_key
  );
$$;

create or replace function public.staff_scheduling_snapshot(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_period_start date,p_period_end date,p_staff_membership_id uuid default null,
  p_status text default 'all'
)
returns table(payload jsonb)
language sql volatile security invoker set search_path='' as $$
  select * from private.staff_scheduling_snapshot_response(
    p_expected_organization_id,p_expected_branch_id,p_period_start,p_period_end,
    p_staff_membership_id,p_status
  );
$$;

revoke all on function private.staff_scheduling_text_ok(text,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.staff_scheduling_rule_payload_ok(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.prepare_staff_scheduling_rule()
  from public,anon,authenticated,service_role;
revoke all on function private.staff_scheduling_append_only()
  from public,anon,authenticated,service_role;
revoke all on function private.staff_scheduling_authority(uuid,uuid,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.require_staff_scheduling_reauth(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.staff_scheduling_evaluate(
  uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text,text,integer
) from public,anon,authenticated,service_role;
revoke all on function private.submit_staff_schedule_guarded(
  uuid,uuid,text,uuid,uuid,integer,text,uuid,timestamptz,timestamptz,
  text,text,text,text,integer,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.decide_staff_schedule_guarded(
  uuid,uuid,uuid,uuid,integer,text,integer,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.staff_scheduling_snapshot_bundle(
  uuid,uuid,timestamptz,date,date,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function private.staff_scheduling_snapshot_response(
  uuid,uuid,date,date,uuid,text
) from public,anon,authenticated,service_role;
revoke all on function public.submit_staff_schedule(
  uuid,uuid,text,uuid,uuid,integer,text,uuid,timestamptz,timestamptz,
  text,text,text,text,integer,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.decide_staff_schedule(
  uuid,uuid,uuid,uuid,integer,text,integer,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.staff_scheduling_snapshot(
  uuid,uuid,date,date,uuid,text
) from public,anon,authenticated,service_role;

grant execute on function private.submit_staff_schedule_guarded(
  uuid,uuid,text,uuid,uuid,integer,text,uuid,timestamptz,timestamptz,
  text,text,text,text,integer,text,uuid
) to authenticated;
grant execute on function private.decide_staff_schedule_guarded(
  uuid,uuid,uuid,uuid,integer,text,integer,text,text,uuid
) to authenticated;
grant execute on function private.staff_scheduling_snapshot_response(
  uuid,uuid,date,date,uuid,text
) to authenticated;
grant execute on function public.submit_staff_schedule(
  uuid,uuid,text,uuid,uuid,integer,text,uuid,timestamptz,timestamptz,
  text,text,text,text,integer,text,uuid
) to authenticated;
grant execute on function public.decide_staff_schedule(
  uuid,uuid,uuid,uuid,integer,text,integer,text,text,uuid
) to authenticated;
grant execute on function public.staff_scheduling_snapshot(
  uuid,uuid,date,date,uuid,text
) to authenticated;

comment on function public.staff_scheduling_snapshot(uuid,uuid,date,date,uuid,text) is
  'Returns a scoped Page-63 deterministic scheduling snapshot. AI is not used; missing institution rules remain not_configured.';
