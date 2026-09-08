-- Page 5: insulin administration is a dedicated immutable, two-person flow.
-- Page 8 remains the sole medication-plan authority. A plan is visible here
-- only after an explicit governed insulin designation. Until a published
-- qualification/timing/dose rule exists, all production actions fail closed.

insert into public.permissions(permission_key, description, risk_level) values
  ('insulin_administrations.read', 'Read governed insulin administration slots and evidence', 3),
  ('insulin_administrations.execute', 'Execute a governed insulin administration', 3),
  ('insulin_administrations.verify', 'Independently verify insulin administration', 3),
  ('insulin_administrations.authorize_late', 'Authorize a late insulin entry', 3)
on conflict (permission_key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in (
    'insulin_administrations.read', 'insulin_administrations.authorize_late'
  )
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.role_key = 'nurse'
  and permission.permission_key in (
    'insulin_administrations.read', 'insulin_administrations.execute',
    'insulin_administrations.verify'
  )
on conflict do nothing;

create table public.insulin_governance_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  version integer not null,
  status text not null default 'published',
  effective_from timestamptz not null,
  effective_to timestamptz,
  dose_unit text not null,
  dose_min_text text not null,
  dose_max_text text not null,
  early_window_minutes integer not null,
  late_after_minutes integer not null,
  executor_role_keys text[] not null,
  reviewer_role_keys text[] not null,
  supervisor_role_keys text[] not null,
  executor_certificate_types text[] not null,
  reviewer_certificate_types text[] not null,
  supervisor_certificate_types text[] not null,
  published_at timestamptz not null,
  published_by uuid not null references auth.users(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint insulin_governance_versions_branch_scope_fkey
    foreign key(branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint insulin_governance_versions_version_key
    unique(organization_id, branch_id, version),
  constraint insulin_governance_versions_id_scope_key
    unique(id, organization_id, branch_id),
  constraint insulin_governance_versions_state_check check (
    version > 0 and status = 'published'
    and (effective_to is null or effective_to > effective_from)
  ),
  constraint insulin_governance_versions_decimal_check check (
    char_length(btrim(dose_unit)) between 1 and 32
    and dose_unit !~ '[[:cntrl:]]'
    and dose_unit = btrim(dose_unit)
    and
    dose_min_text ~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$'
    and dose_max_text ~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$'
    and dose_min_text::numeric > 0
    and dose_max_text::numeric >= dose_min_text::numeric
  ),
  constraint insulin_governance_versions_timing_check check (
    early_window_minutes between 0 and 1440
    and late_after_minutes between 0 and 10080
  ),
  constraint insulin_governance_versions_roles_check check (
    cardinality(executor_role_keys) between 1 and 50
    and cardinality(reviewer_role_keys) between 1 and 50
    and cardinality(supervisor_role_keys) between 1 and 50
    and cardinality(executor_certificate_types) between 1 and 50
    and cardinality(reviewer_certificate_types) between 1 and 50
    and cardinality(supervisor_certificate_types) between 1 and 50
    and array_position(executor_role_keys, '') is null
    and array_position(reviewer_role_keys, '') is null
    and array_position(supervisor_role_keys, '') is null
    and array_position(executor_certificate_types, '') is null
    and array_position(reviewer_certificate_types, '') is null
    and array_position(supervisor_certificate_types, '') is null
    and array_to_string(
      executor_certificate_types || reviewer_certificate_types || supervisor_certificate_types,
      ''
    ) !~ '[[:cntrl:]]'
  ),
  constraint insulin_governance_versions_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.insulin_governance_versions is
  'Published qualification, timing, and dose-rule evidence. The table is intentionally empty until governance publication; Page 5 then fails closed as not_configured.';

create table public.insulin_plan_designations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  medication_plan_id uuid not null,
  governance_version_id uuid not null,
  designation_kind text not null default 'insulin',
  evidence_source text not null default 'manual_governed',
  published_at timestamptz not null,
  published_by uuid not null references auth.users(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint insulin_plan_designations_plan_scope_fkey
    foreign key(medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint insulin_plan_designations_client_scope_fkey
    foreign key(client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint insulin_plan_designations_governance_scope_fkey
    foreign key(governance_version_id, organization_id, branch_id)
    references public.insulin_governance_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint insulin_plan_designations_plan_key unique(medication_plan_id),
  constraint insulin_plan_designations_kind_check check (
    designation_kind = 'insulin' and evidence_source = 'manual_governed'
  ),
  constraint insulin_plan_designations_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.insulin_plan_designations is
  'Classification evidence only; it never creates, changes, stops, or replaces a Page-8 medication plan.';

create table public.insulin_administration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  administration_key uuid not null,
  event_sequence integer not null,
  previous_event_id uuid,
  event_kind text not null,
  state text not null,
  medication_plan_id uuid not null,
  medication_plan_version integer not null,
  medication_plan_content_hash text not null,
  governance_version_id uuid not null,
  scheduled_for timestamptz not null,
  dose_text text,
  dose_unit text,
  site_code text,
  site_text text,
  executed_at timestamptz,
  executor_user_id uuid references auth.users(id) on delete restrict,
  executor_membership_id uuid references public.memberships(id) on delete restrict,
  executor_display_name text,
  executor_role_keys text[] not null default '{}'::text[],
  executor_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  executor_qualification_version_id uuid
    references public.staff_certificate_versions(id) on delete restrict,
  late_entry boolean not null,
  late_reason text,
  late_authorized_at timestamptz,
  late_authorizer_user_id uuid references auth.users(id) on delete restrict,
  late_authorizer_membership_id uuid references public.memberships(id) on delete restrict,
  late_authorizer_display_name text,
  late_authorizer_role_keys text[] not null default '{}'::text[],
  late_authorizer_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  late_authorizer_qualification_version_id uuid
    references public.staff_certificate_versions(id) on delete restrict,
  reviewed_at timestamptz,
  reviewer_user_id uuid references auth.users(id) on delete restrict,
  reviewer_membership_id uuid references public.memberships(id) on delete restrict,
  reviewer_display_name text,
  reviewer_role_keys text[] not null default '{}'::text[],
  reviewer_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  reviewer_qualification_version_id uuid
    references public.staff_certificate_versions(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint insulin_administration_events_id_scope_key
    unique(id, organization_id, branch_id, client_id),
  constraint insulin_administration_events_stream_key
    unique(organization_id, branch_id, administration_key, event_sequence),
  constraint insulin_administration_events_previous_scope_fkey
    foreign key(previous_event_id, organization_id, branch_id, client_id)
    references public.insulin_administration_events(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint insulin_administration_events_plan_scope_fkey
    foreign key(medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint insulin_administration_events_client_scope_fkey
    foreign key(client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint insulin_administration_events_governance_scope_fkey
    foreign key(governance_version_id, organization_id, branch_id)
    references public.insulin_governance_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint insulin_administration_events_sequence_check check (
    event_sequence > 0 and (event_sequence = 1) = (previous_event_id is null)
  ),
  constraint insulin_administration_events_plan_evidence_check check (
    medication_plan_version > 0
    and medication_plan_content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint insulin_administration_events_decimal_check check (
    dose_text is null
    or (
      dose_text ~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$'
      and dose_text::numeric > 0
    )
  ),
  constraint insulin_administration_events_site_check check (
    site_code is null or site_code ~ '^[A-Z][A-Z0-9_]{0,39}$'
  ),
  constraint insulin_administration_events_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint insulin_administration_events_state_check check (
    (
      event_kind = 'late_authorized' and state = 'late_authorized'
      and event_sequence = 1 and late_entry
      and dose_text is null and dose_unit is null and site_code is null and site_text is null
      and executed_at is null and executor_user_id is null
      and executor_membership_id is null and executor_display_name is null
      and cardinality(executor_role_keys) = 0 and executor_reauth_challenge_id is null
      and executor_qualification_version_id is null
      and char_length(btrim(late_reason)) between 2 and 1000
      and late_authorized_at is not null and late_authorizer_user_id is not null
      and late_authorizer_membership_id is not null and late_authorizer_display_name is not null
      and cardinality(late_authorizer_role_keys) > 0
      and late_authorizer_reauth_challenge_id is not null
      and late_authorizer_qualification_version_id is not null
      and reviewed_at is null and reviewer_user_id is null and reviewer_membership_id is null
      and reviewer_display_name is null and cardinality(reviewer_role_keys) = 0
      and reviewer_reauth_challenge_id is null
      and reviewer_qualification_version_id is null
    ) or (
      event_kind = 'executed' and state = 'pending_review'
      and dose_text is not null and char_length(btrim(dose_unit)) between 1 and 32
      and site_code is not null and char_length(btrim(site_text)) between 2 and 120
      and executed_at is not null and executor_user_id is not null
      and executor_membership_id is not null and executor_display_name is not null
      and cardinality(executor_role_keys) > 0 and executor_reauth_challenge_id is not null
      and executor_qualification_version_id is not null
      and reviewed_at is null and reviewer_user_id is null and reviewer_membership_id is null
      and reviewer_display_name is null and cardinality(reviewer_role_keys) = 0
      and reviewer_reauth_challenge_id is null
      and reviewer_qualification_version_id is null
      and (
        (not late_entry and late_reason is null and late_authorized_at is null
          and late_authorizer_user_id is null and late_authorizer_membership_id is null
          and late_authorizer_display_name is null and cardinality(late_authorizer_role_keys) = 0
          and late_authorizer_reauth_challenge_id is null
          and late_authorizer_qualification_version_id is null)
        or
        (late_entry and char_length(btrim(late_reason)) between 2 and 1000
          and late_authorized_at is not null and late_authorizer_user_id is not null
          and late_authorizer_user_id <> executor_user_id
          and late_authorizer_membership_id is not null and late_authorizer_display_name is not null
          and cardinality(late_authorizer_role_keys) > 0
          and late_authorizer_reauth_challenge_id is not null
          and late_authorizer_qualification_version_id is not null)
      )
    ) or (
      event_kind = 'reviewed' and state = 'completed'
      and dose_text is not null and char_length(btrim(dose_unit)) between 1 and 32
      and site_code is not null and char_length(btrim(site_text)) between 2 and 120
      and executed_at is not null and executor_user_id is not null
      and executor_membership_id is not null and executor_display_name is not null
      and cardinality(executor_role_keys) > 0 and executor_reauth_challenge_id is not null
      and executor_qualification_version_id is not null
      and reviewed_at is not null and reviewed_at >= executed_at
      and reviewer_user_id is not null and reviewer_user_id <> executor_user_id
      and reviewer_membership_id is not null and reviewer_display_name is not null
      and cardinality(reviewer_role_keys) > 0 and reviewer_reauth_challenge_id is not null
      and reviewer_qualification_version_id is not null
      and (
        (not late_entry and late_reason is null and late_authorized_at is null
          and late_authorizer_user_id is null and late_authorizer_membership_id is null
          and late_authorizer_display_name is null and cardinality(late_authorizer_role_keys) = 0
          and late_authorizer_reauth_challenge_id is null
          and late_authorizer_qualification_version_id is null)
        or
        (late_entry and char_length(btrim(late_reason)) between 2 and 1000
          and late_authorized_at is not null and late_authorizer_user_id is not null
          and late_authorizer_user_id <> executor_user_id
          and late_authorizer_membership_id is not null and late_authorizer_display_name is not null
          and cardinality(late_authorizer_role_keys) > 0
          and late_authorizer_reauth_challenge_id is not null
          and late_authorizer_qualification_version_id is not null)
      )
    )
  )
);

create unique index insulin_administration_events_one_execution_per_slot_idx
  on public.insulin_administration_events(medication_plan_id, scheduled_for)
  where event_kind = 'executed';
create unique index insulin_administration_events_one_review_idx
  on public.insulin_administration_events(administration_key)
  where event_kind = 'reviewed';

create table private.insulin_administration_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  administration_key uuid not null,
  event_id uuid not null,
  event_sequence integer not null,
  previous_event_id uuid,
  state text not null,
  medication_plan_id uuid not null,
  governance_version_id uuid not null,
  scheduled_for timestamptz not null,
  executed_at timestamptz,
  reviewed_at timestamptz,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint insulin_administration_operations_actor_key
    unique(actor_user_id, idempotency_key),
  constraint insulin_administration_operations_event_scope_fkey
    foreign key(event_id, organization_id, branch_id, client_id)
    references public.insulin_administration_events(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint insulin_administration_operations_plan_scope_fkey
    foreign key(medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint insulin_administration_operations_governance_scope_fkey
    foreign key(governance_version_id, organization_id, branch_id)
    references public.insulin_governance_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint insulin_administration_operations_kind_check check (
    operation_kind in ('authorize_late', 'execute', 'review')
  ),
  constraint insulin_administration_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and content_hash ~ '^[a-f0-9]{64}$'
  )
);

-- Every FK column participates in an index so full-schema foundation checks
-- remain deterministic even at the seven-year target volume.
create index insulin_governance_versions_published_by_idx
  on public.insulin_governance_versions(published_by);
create index insulin_plan_designations_scope_idx
  on public.insulin_plan_designations(organization_id, branch_id, client_id);
create index insulin_plan_designations_governance_idx
  on public.insulin_plan_designations(governance_version_id);
create index insulin_plan_designations_published_by_idx
  on public.insulin_plan_designations(published_by);
create index insulin_administration_events_scope_idx
  on public.insulin_administration_events(organization_id, branch_id, client_id, scheduled_for);
create index insulin_administration_events_previous_idx
  on public.insulin_administration_events(previous_event_id) where previous_event_id is not null;
create index insulin_administration_events_plan_idx
  on public.insulin_administration_events(medication_plan_id);
create index insulin_administration_events_governance_idx
  on public.insulin_administration_events(governance_version_id);
create index insulin_administration_events_executor_user_idx
  on public.insulin_administration_events(executor_user_id) where executor_user_id is not null;
create index insulin_administration_events_executor_membership_idx
  on public.insulin_administration_events(executor_membership_id) where executor_membership_id is not null;
create index insulin_administration_events_executor_reauth_idx
  on public.insulin_administration_events(executor_reauth_challenge_id) where executor_reauth_challenge_id is not null;
create index insulin_administration_events_executor_qualification_idx
  on public.insulin_administration_events(executor_qualification_version_id) where executor_qualification_version_id is not null;
create index insulin_administration_events_authorizer_user_idx
  on public.insulin_administration_events(late_authorizer_user_id) where late_authorizer_user_id is not null;
create index insulin_administration_events_authorizer_membership_idx
  on public.insulin_administration_events(late_authorizer_membership_id) where late_authorizer_membership_id is not null;
create index insulin_administration_events_authorizer_reauth_idx
  on public.insulin_administration_events(late_authorizer_reauth_challenge_id) where late_authorizer_reauth_challenge_id is not null;
create index insulin_administration_events_authorizer_qualification_idx
  on public.insulin_administration_events(late_authorizer_qualification_version_id) where late_authorizer_qualification_version_id is not null;
create index insulin_administration_events_reviewer_user_idx
  on public.insulin_administration_events(reviewer_user_id) where reviewer_user_id is not null;
create index insulin_administration_events_reviewer_membership_idx
  on public.insulin_administration_events(reviewer_membership_id) where reviewer_membership_id is not null;
create index insulin_administration_events_reviewer_reauth_idx
  on public.insulin_administration_events(reviewer_reauth_challenge_id) where reviewer_reauth_challenge_id is not null;
create index insulin_administration_events_reviewer_qualification_idx
  on public.insulin_administration_events(reviewer_qualification_version_id) where reviewer_qualification_version_id is not null;
create index insulin_administration_operations_scope_idx
  on private.insulin_administration_operations(organization_id, branch_id, client_id);
create index insulin_administration_operations_actor_idx
  on private.insulin_administration_operations(actor_user_id);
create index insulin_administration_operations_event_idx
  on private.insulin_administration_operations(event_id);
create index insulin_administration_operations_previous_idx
  on private.insulin_administration_operations(previous_event_id) where previous_event_id is not null;
create index insulin_administration_operations_plan_idx
  on private.insulin_administration_operations(medication_plan_id);
create index insulin_administration_operations_governance_idx
  on private.insulin_administration_operations(governance_version_id);

alter table public.insulin_governance_versions enable row level security;
alter table public.insulin_governance_versions force row level security;
alter table public.insulin_plan_designations enable row level security;
alter table public.insulin_plan_designations force row level security;
alter table public.insulin_administration_events enable row level security;
alter table public.insulin_administration_events force row level security;
alter table private.insulin_administration_operations enable row level security;
alter table private.insulin_administration_operations force row level security;

revoke all on table public.insulin_governance_versions from anon, authenticated, service_role;
revoke all on table public.insulin_plan_designations from anon, authenticated, service_role;
revoke all on table public.insulin_administration_events from anon, authenticated, service_role;
revoke all on table private.insulin_administration_operations from anon, authenticated, service_role;

create or replace function private.prevent_insulin_ledger_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = tg_table_name || ' is append-only';
end;
$$;

create trigger insulin_governance_versions_prevent_mutation
before update or delete on public.insulin_governance_versions
for each row execute function private.prevent_insulin_ledger_mutation();
create trigger insulin_plan_designations_prevent_mutation
before update or delete on public.insulin_plan_designations
for each row execute function private.prevent_insulin_ledger_mutation();
create trigger insulin_administration_events_prevent_mutation
before update or delete on public.insulin_administration_events
for each row execute function private.prevent_insulin_ledger_mutation();
create trigger insulin_administration_operations_prevent_mutation
before update or delete on private.insulin_administration_operations
for each row execute function private.prevent_insulin_ledger_mutation();

create trigger insulin_governance_versions_audit_row_change
after insert on public.insulin_governance_versions
for each row execute function private.audit_row_change();
create trigger insulin_plan_designations_audit_row_change
after insert on public.insulin_plan_designations
for each row execute function private.audit_row_change();
create trigger insulin_administration_events_audit_row_change
after insert on public.insulin_administration_events
for each row execute function private.audit_row_change();

create or replace function private.insulin_staff_snapshot(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_reference_time timestamptz
)
returns table(membership_id uuid, display_name text, role_keys text[])
language sql stable security definer set search_path = '' as $$
  select membership.id, btrim(profile.display_name),
    array_agg(distinct role.role_key order by role.role_key)
  from public.profiles profile
  join public.memberships membership on membership.profile_id = profile.id
  join public.membership_roles membership_role on membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id and role.is_active
  where profile.id = p_user_id and profile.is_active
    and profile.kind in ('staff', 'professional')
    and membership.organization_id = p_organization_id
    and membership.status = 'active'
    and membership.starts_at <= p_reference_time
    and (membership.ends_at is null or membership.ends_at > p_reference_time)
    and (membership.branch_id is null or membership.branch_id = p_branch_id)
    and (role.organization_id is null or role.organization_id = p_organization_id)
  group by membership.id, profile.display_name, membership.branch_id
  order by (membership.branch_id = p_branch_id) desc, membership.id
  limit 1;
$$;

create or replace function private.insulin_qualification_version(
  p_organization_id uuid,
  p_branch_id uuid,
  p_membership_id uuid,
  p_user_id uuid,
  p_allowed_certificate_types text[],
  p_reference_time timestamptz
)
returns uuid language sql stable security definer set search_path = '' as $$
  select certificate.id
  from public.staff_certificate_versions certificate
  where certificate.organization_id = p_organization_id
    and certificate.branch_id = p_branch_id
    and certificate.staff_membership_id = p_membership_id
    and certificate.staff_user_id = p_user_id
    and certificate.certificate_type = any(p_allowed_certificate_types)
    and certificate.record_status = 'active'
    and certificate.registration_status = 'registered'
    and certificate.verification_status = 'verified'
    and certificate.evidence_status = 'provided'
    and certificate.effective_on <= (p_reference_time at time zone 'Asia/Taipei')::date
    and (certificate.expires_on is null
      or certificate.expires_on >= (p_reference_time at time zone 'Asia/Taipei')::date)
    and not exists (
      select 1 from public.staff_certificate_versions later
      where later.certificate_key = certificate.certificate_key
        and later.version > certificate.version
    )
  order by certificate.expires_on desc nulls first,
    certificate.certificate_type collate "C", certificate.id
  limit 1;
$$;

comment on function private.insulin_qualification_version(
  uuid, uuid, uuid, uuid, text[], timestamptz
) is 'Returns current terminal Page-72 certificate evidence matching a published Page-5 taxonomy. Missing, expired, unverified, unregistered, superseded, or attachment-less evidence fails closed.';

create or replace function private.require_insulin_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current same-session insulin AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session insulin AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and event.verified_at >= p_reference_time - interval '15 minutes'
    and event.verified_at <= p_reference_time + interval '30 seconds'
  order by event.verified_at desc, event.id desc limit 1;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session insulin AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.insulin_base_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, 'clients.read')
    and private.has_permission(p_organization_id, p_branch_id, 'medications.read')
    and private.has_permission(p_organization_id, p_branch_id, 'insulin_administrations.read')
    and private.has_permission(p_organization_id, p_branch_id, p_permission);
$$;

create or replace function private.insulin_governance_id(
  p_organization_id uuid,
  p_branch_id uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_count bigint; v_id uuid;
begin
  select count(*), min(rule.id::text)::uuid into v_count, v_id
  from public.insulin_governance_versions rule
  where rule.organization_id = p_organization_id
    and rule.branch_id = p_branch_id
    and rule.status = 'published'
    and rule.published_at <= p_reference_time
    and rule.effective_from <= p_reference_time
    and (rule.effective_to is null or rule.effective_to > p_reference_time);
  if v_count <> 1 then return null; end if;
  return v_id;
end;
$$;

create or replace function private.insulin_plan_slot_is_valid(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_id uuid,
  p_plan_id uuid,
  p_governance_version_id uuid,
  p_scheduled_for timestamptz
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_and(
    plan.workflow_version = 2
    and plan.workflow_state = 'approved'
    and plan.status = 'active'
    and plan.signed_at is not null
    and plan.signed_by is not null
    and plan.content_hash ~ '^[a-f0-9]{64}$'
    and plan.effective_from <= p_scheduled_for
    and (plan.effective_to is null or plan.effective_to > p_scheduled_for)
    and private.medication_plan_is_unique_at_occurrence(
      plan.organization_id, plan.branch_id, plan.client_id,
      plan.record_key, plan.id, p_scheduled_for
    )
    and jsonb_typeof(plan.schedule -> 'times') = 'array'
    and exists (
      select 1 from jsonb_array_elements_text(plan.schedule -> 'times') schedule_time(value)
      where schedule_time.value ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        and schedule_time.value = to_char(
          p_scheduled_for at time zone 'Asia/Taipei', 'HH24:MI'
        )
    )
  ), false)
  from public.medication_plans plan
  join public.insulin_plan_designations designation
    on designation.medication_plan_id = plan.id
   and designation.organization_id = plan.organization_id
   and designation.branch_id = plan.branch_id
   and designation.client_id = plan.client_id
  join public.insulin_governance_versions designation_rule
    on designation_rule.id = designation.governance_version_id
   and designation_rule.id = p_governance_version_id
   and designation_rule.status = 'published'
   and designation_rule.published_at <= p_scheduled_for
   and designation_rule.effective_from <= p_scheduled_for
   and (designation_rule.effective_to is null
     or designation_rule.effective_to > p_scheduled_for)
  where plan.id = p_plan_id
    and plan.organization_id = p_organization_id
    and plan.branch_id = p_branch_id
    and plan.client_id = p_client_id
    and designation.governance_version_id = p_governance_version_id
    and designation.published_at <= p_scheduled_for
    and plan.dose_unit = designation_rule.dose_unit;
$$;

create or replace function private.mutate_insulin_administration_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_administration_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_medication_plan_id uuid,
  p_scheduled_for timestamptz,
  p_dose_text text,
  p_dose_unit text,
  p_site_code text,
  p_site_text text,
  p_late_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, operation_kind text,
  administration_key uuid, event_id uuid, event_sequence integer,
  previous_event_id uuid, state text, medication_plan_id uuid,
  governance_version_id uuid, scheduled_for timestamptz,
  executed_at timestamptz, reviewed_at timestamptz, content_hash text,
  qualification_status text, dose_rule_status text, late_entry_rule_status text,
  completion_status text, offline_status text, replayed boolean, committed_at timestamptz
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_permission text; v_request_hash text; v_reauth uuid;
  v_membership uuid; v_actor_name text; v_actor_roles text[];
  v_qualification uuid;
  v_governance public.insulin_governance_versions%rowtype;
  v_plan public.medication_plans%rowtype; v_client public.clients%rowtype;
  v_previous public.insulin_administration_events%rowtype;
  v_created public.insulin_administration_events%rowtype;
  v_operation private.insulin_administration_operations%rowtype;
  v_key uuid; v_event_id uuid := gen_random_uuid(); v_sequence integer;
  v_is_late boolean; v_hash text; v_late_reason text := nullif(btrim(p_late_reason), '');
  v_dose_text text := nullif(btrim(p_dose_text), '');
  v_dose_unit text := nullif(btrim(p_dose_unit), '');
  v_site_code text := upper(nullif(btrim(p_site_code), ''));
  v_site_text text := nullif(btrim(p_site_text), '');
begin
  if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null
     or p_action not in ('authorize_late', 'execute', 'review') then
    raise exception using errcode = '22023', message = 'insulin operation request is invalid';
  end if;

  v_permission := case p_action
    when 'authorize_late' then 'insulin_administrations.authorize_late'
    when 'execute' then 'insulin_administrations.execute'
    else 'insulin_administrations.verify' end;
  if not private.insulin_base_authority(
       p_expected_organization_id, p_expected_branch_id, v_permission
     ) then
    raise exception using errcode = '42501', message = 'insulin operation authority is not permitted';
  end if;

  select rule.* into v_governance
  from public.insulin_governance_versions rule
  where rule.id = private.insulin_governance_id(
    p_expected_organization_id, p_expected_branch_id, v_now
  );
  if not found then
    raise exception using errcode = '55000',
      message = 'insulin qualification, dose, and late-entry governance is not configured';
  end if;

  select staff.membership_id, staff.display_name, staff.role_keys
    into v_membership, v_actor_name, v_actor_roles
  from private.insulin_staff_snapshot(
    p_expected_organization_id, p_expected_branch_id, v_actor, v_now
  ) staff;
  if v_membership is null or cardinality(v_actor_roles) = 0
     or not (v_actor_roles && case p_action
       when 'authorize_late' then v_governance.supervisor_role_keys
       when 'execute' then v_governance.executor_role_keys
       else v_governance.reviewer_role_keys end) then
    raise exception using errcode = '42501',
      message = 'insulin current staff qualification is not permitted';
  end if;
  v_qualification := private.insulin_qualification_version(
    p_expected_organization_id, p_expected_branch_id, v_membership,
    v_actor,
    case p_action
      when 'authorize_late' then v_governance.supervisor_certificate_types
      when 'execute' then v_governance.executor_certificate_types
      else v_governance.reviewer_certificate_types
    end,
    v_now
  );
  if v_qualification is null then
    raise exception using errcode = '42501',
      message = 'current terminal Page-72 insulin qualification is not permitted';
  end if;
  v_reauth := private.require_insulin_reauth(v_actor, v_now);

  if p_action = 'authorize_late' and (
       p_administration_key is not null or p_previous_event_id is not null
       or p_expected_sequence is distinct from 0 or p_medication_plan_id is null
       or p_scheduled_for is null or v_late_reason is null
       or v_dose_text is not null or v_dose_unit is not null
       or v_site_code is not null or v_site_text is not null
     ) then
    raise exception using errcode = '22023', message = 'late authorization payload is invalid';
  elsif p_action = 'execute' and (
       p_expected_sequence is null or p_medication_plan_id is null
       or p_scheduled_for is null or v_dose_text is null or v_dose_unit is null
       or v_site_code is null or v_site_text is null or v_late_reason is not null
     ) then
    raise exception using errcode = '22023', message = 'insulin execution payload is invalid';
  elsif p_action = 'review' and (
       p_administration_key is null or p_previous_event_id is null
       or p_expected_sequence is null or p_expected_sequence <= 0
       or p_medication_plan_id is not null or p_scheduled_for is not null
       or v_dose_text is not null or v_dose_unit is not null
       or v_site_code is not null or v_site_text is not null or v_late_reason is not null
     ) then
    raise exception using errcode = '22023', message = 'insulin review payload is invalid';
  end if;

  if v_dose_text is not null and (
       v_dose_text !~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$'
       or v_dose_text::numeric <= 0
     ) then
    raise exception using errcode = '22023', message = 'insulin decimal dose text is invalid';
  end if;
  if v_dose_unit is not null and char_length(v_dose_unit) > 32 then
    raise exception using errcode = '22023', message = 'insulin dose unit is invalid';
  end if;
  if v_site_code is not null and (
       v_site_code !~ '^[A-Z][A-Z0-9_]{0,39}$'
       or char_length(v_site_text) not between 2 and 120
     ) then
    raise exception using errcode = '22023', message = 'insulin manual site evidence is invalid';
  end if;
  if v_late_reason is not null and char_length(v_late_reason) not between 2 and 1000 then
    raise exception using errcode = '22023', message = 'insulin late reason is invalid';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'action', p_action,
    'administration_key', p_administration_key, 'previous_event_id', p_previous_event_id,
    'expected_sequence', p_expected_sequence, 'medication_plan_id', p_medication_plan_id,
    'scheduled_for', p_scheduled_for, 'dose_text', v_dose_text,
    'dose_unit', v_dose_unit, 'site_code', v_site_code, 'site_text', v_site_text,
    'late_reason', v_late_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'insulin-operation:' || v_actor::text || ':' || p_idempotency_key::text, 5
  ));
  select operation.* into v_operation
  from private.insulin_administration_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id then
      raise exception using errcode = '42501', message = 'insulin receipt is outside current scope';
    end if;
    if v_operation.operation_kind <> p_action or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'insulin idempotency conflict';
    end if;
    if not private.can_staff_access_client(v_operation.client_id, v_permission) then
      raise exception using errcode = '42501', message = 'insulin client scope is not permitted';
    end if;
    return query select v_operation.organization_id, v_operation.branch_id,
      v_operation.id, v_operation.operation_kind, v_operation.administration_key,
      v_operation.event_id, v_operation.event_sequence, v_operation.previous_event_id,
      v_operation.state, v_operation.medication_plan_id, v_operation.governance_version_id,
      v_operation.scheduled_for, v_operation.executed_at, v_operation.reviewed_at,
      v_operation.content_hash, 'published'::text, 'published'::text, 'published'::text,
      case when v_operation.state = 'completed' then 'completed'
        else 'pending_independent_review' end::text,
      'not_configured'::text, true, v_operation.created_at;
    return;
  end if;

  if p_action = 'review' then
    perform pg_advisory_xact_lock(hashtextextended(
      'insulin-stream:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_administration_key::text, 5
    ));
    select event.* into v_previous
    from public.insulin_administration_events event
    where event.id = p_previous_event_id
      and event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.administration_key = p_administration_key
      and event.event_sequence = p_expected_sequence
    for key share;
    if not found or v_previous.event_kind <> 'executed' or v_previous.state <> 'pending_review'
       or v_previous.governance_version_id <> v_governance.id
       or exists (
         select 1 from public.insulin_administration_events newer
         where newer.organization_id = v_previous.organization_id
           and newer.branch_id = v_previous.branch_id
           and newer.administration_key = v_previous.administration_key
           and newer.event_sequence > v_previous.event_sequence
       ) then
      raise exception using errcode = '40001', message = 'insulin review base event is stale';
    end if;
    if v_previous.executor_user_id = v_actor then
      raise exception using errcode = '42501', message = 'insulin executor cannot independently review';
    end if;
    if not private.can_staff_access_client(v_previous.client_id, v_permission) then
      raise exception using errcode = '42501', message = 'insulin review client scope is not permitted';
    end if;
    v_key := v_previous.administration_key;
    v_sequence := v_previous.event_sequence + 1;
    v_hash := encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1, 'event_kind', 'reviewed', 'previous_hash', v_previous.content_hash,
      'reviewed_at', v_now, 'reviewer_user_id', v_actor,
      'reviewer_membership_id', v_membership, 'reviewer_role_keys', v_actor_roles,
      'reviewer_reauth_challenge_id', v_reauth,
      'reviewer_qualification_version_id', v_qualification
    )::text, 'UTF8')), 'hex');
    insert into public.insulin_administration_events(
      id, organization_id, branch_id, client_id, administration_key,
      event_sequence, previous_event_id, event_kind, state,
      medication_plan_id, medication_plan_version, medication_plan_content_hash,
      governance_version_id, scheduled_for, dose_text, dose_unit, site_code, site_text,
      executed_at, executor_user_id, executor_membership_id, executor_display_name,
      executor_role_keys, executor_reauth_challenge_id,
      executor_qualification_version_id, late_entry, late_reason,
      late_authorized_at, late_authorizer_user_id, late_authorizer_membership_id,
      late_authorizer_display_name, late_authorizer_role_keys,
      late_authorizer_reauth_challenge_id, late_authorizer_qualification_version_id,
      reviewed_at, reviewer_user_id,
      reviewer_membership_id, reviewer_display_name, reviewer_role_keys,
      reviewer_reauth_challenge_id, reviewer_qualification_version_id,
      content_hash, created_at
    ) values (
      v_event_id, v_previous.organization_id, v_previous.branch_id, v_previous.client_id,
      v_key, v_sequence, v_previous.id, 'reviewed', 'completed',
      v_previous.medication_plan_id, v_previous.medication_plan_version,
      v_previous.medication_plan_content_hash, v_governance.id,
      v_previous.scheduled_for, v_previous.dose_text, v_previous.dose_unit,
      v_previous.site_code, v_previous.site_text, v_previous.executed_at,
      v_previous.executor_user_id, v_previous.executor_membership_id,
      v_previous.executor_display_name, v_previous.executor_role_keys,
      v_previous.executor_reauth_challenge_id,
      v_previous.executor_qualification_version_id, v_previous.late_entry,
      v_previous.late_reason, v_previous.late_authorized_at,
      v_previous.late_authorizer_user_id, v_previous.late_authorizer_membership_id,
      v_previous.late_authorizer_display_name, v_previous.late_authorizer_role_keys,
      v_previous.late_authorizer_reauth_challenge_id,
      v_previous.late_authorizer_qualification_version_id, v_now, v_actor,
      v_membership, v_actor_name, v_actor_roles, v_reauth, v_qualification,
      v_hash, v_now
    ) returning * into v_created;
  else
    select plan.* into v_plan
    from public.medication_plans plan
    where plan.id = p_medication_plan_id
      and plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id;
    if not found then
      raise exception using errcode = '42501', message = 'insulin plan is outside current scope';
    end if;
    select client.* into v_client from public.clients client
    where client.id = v_plan.client_id
      and client.organization_id = v_plan.organization_id
      and client.branch_id = v_plan.branch_id;
    if not found or v_client.status <> 'active' or v_client.admitted_on is null
       or v_client.ended_on is not null
       or not private.can_staff_access_client(v_client.id, v_permission) then
      raise exception using errcode = '42501', message = 'insulin client scope is not permitted';
    end if;
    if not private.insulin_plan_slot_is_valid(
       v_plan.organization_id, v_plan.branch_id, v_plan.client_id,
       v_plan.id, v_governance.id, p_scheduled_for
    ) then
      raise exception using errcode = '23514',
        message = 'exactly one approved effective designated Page-8 plan is required';
    end if;
    if v_now < p_scheduled_for - make_interval(mins => v_governance.early_window_minutes) then
      raise exception using errcode = '22023', message = 'insulin slot is earlier than published timing rule';
    end if;
    v_is_late := v_now > p_scheduled_for + make_interval(mins => v_governance.late_after_minutes);
    perform pg_advisory_xact_lock(hashtextextended(
      'insulin-slot:' || v_plan.id::text || ':' || p_scheduled_for::text, 5
    ));

    if p_action = 'authorize_late' then
      if not v_is_late then
        raise exception using errcode = '22023', message = 'insulin slot is not late under published rule';
      end if;
      if exists (
        select 1 from public.insulin_administration_events event
        where event.medication_plan_id = v_plan.id and event.scheduled_for = p_scheduled_for
      ) then
        raise exception using errcode = '23505', message = 'insulin slot already has a stream';
      end if;
      v_key := gen_random_uuid(); v_sequence := 1;
      v_hash := encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 1, 'event_kind', 'late_authorized',
        'organization_id', v_plan.organization_id, 'branch_id', v_plan.branch_id,
        'client_id', v_plan.client_id, 'medication_plan_id', v_plan.id,
        'medication_plan_version', v_plan.version,
        'medication_plan_content_hash', v_plan.content_hash,
        'governance_version_id', v_governance.id, 'scheduled_for', p_scheduled_for,
        'late_reason', v_late_reason, 'late_authorized_at', v_now,
        'late_authorizer_user_id', v_actor, 'late_authorizer_membership_id', v_membership,
        'late_authorizer_role_keys', v_actor_roles,
        'late_authorizer_reauth_challenge_id', v_reauth,
        'late_authorizer_qualification_version_id', v_qualification
      )::text, 'UTF8')), 'hex');
      insert into public.insulin_administration_events(
        id, organization_id, branch_id, client_id, administration_key,
        event_sequence, previous_event_id, event_kind, state,
        medication_plan_id, medication_plan_version, medication_plan_content_hash,
        governance_version_id, scheduled_for, late_entry, late_reason,
        late_authorized_at, late_authorizer_user_id, late_authorizer_membership_id,
        late_authorizer_display_name, late_authorizer_role_keys,
        late_authorizer_reauth_challenge_id, late_authorizer_qualification_version_id,
        content_hash, created_at
      ) values (
        v_event_id, v_plan.organization_id, v_plan.branch_id, v_plan.client_id,
        v_key, 1, null, 'late_authorized', 'late_authorized', v_plan.id,
        v_plan.version, v_plan.content_hash, v_governance.id, p_scheduled_for,
        true, v_late_reason, v_now, v_actor, v_membership, v_actor_name,
        v_actor_roles, v_reauth, v_qualification, v_hash, v_now
      ) returning * into v_created;
    else
      if v_dose_unit <> v_plan.dose_unit
         or v_dose_unit <> v_governance.dose_unit
         or v_dose_text::numeric <> v_plan.dose then
        raise exception using errcode = '23514',
          message = 'insulin dose and unit must exactly match approved Page-8 plan';
      end if;
      if v_dose_text::numeric < v_governance.dose_min_text::numeric
         or v_dose_text::numeric > v_governance.dose_max_text::numeric then
        raise exception using errcode = '23514',
          message = 'insulin dose is outside published versioned organization rule';
      end if;

      if v_is_late then
        if p_administration_key is null or p_previous_event_id is null
           or p_expected_sequence is distinct from 1 then
          raise exception using errcode = '42501',
            message = 'late insulin execution requires supervisor authorization evidence';
        end if;
        perform pg_advisory_xact_lock(hashtextextended(
          'insulin-stream:' || p_expected_organization_id::text || ':' ||
          p_expected_branch_id::text || ':' || p_administration_key::text, 5
        ));
        select event.* into v_previous
        from public.insulin_administration_events event
        where event.id = p_previous_event_id
          and event.organization_id = p_expected_organization_id
          and event.branch_id = p_expected_branch_id
          and event.administration_key = p_administration_key
          and event.event_sequence = 1
        for key share;
        if not found or v_previous.event_kind <> 'late_authorized'
           or v_previous.state <> 'late_authorized'
           or v_previous.medication_plan_id <> v_plan.id
           or v_previous.scheduled_for <> p_scheduled_for
           or v_previous.governance_version_id <> v_governance.id
           or v_previous.late_authorizer_user_id = v_actor
           or exists (
             select 1 from public.insulin_administration_events newer
             where newer.organization_id = v_previous.organization_id
               and newer.branch_id = v_previous.branch_id
               and newer.administration_key = v_previous.administration_key
               and newer.event_sequence > 1
           ) then
          raise exception using errcode = '40001', message = 'late authorization is stale or invalid';
        end if;
        v_key := v_previous.administration_key; v_sequence := 2;
      else
        if p_administration_key is not null or p_previous_event_id is not null
           or p_expected_sequence is distinct from 0 then
          raise exception using errcode = '22023', message = 'on-time insulin execution chain is invalid';
        end if;
        if exists (
          select 1 from public.insulin_administration_events event
          where event.medication_plan_id = v_plan.id and event.scheduled_for = p_scheduled_for
        ) then
          raise exception using errcode = '23505', message = 'insulin slot already has a stream';
        end if;
        v_key := gen_random_uuid(); v_sequence := 1;
      end if;

      v_hash := encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 1, 'event_kind', 'executed',
        'previous_hash', case when v_is_late then v_previous.content_hash else null end,
        'organization_id', v_plan.organization_id, 'branch_id', v_plan.branch_id,
        'client_id', v_plan.client_id, 'medication_plan_id', v_plan.id,
        'medication_plan_version', v_plan.version,
        'medication_plan_content_hash', v_plan.content_hash,
        'governance_version_id', v_governance.id, 'scheduled_for', p_scheduled_for,
        'dose_text', v_dose_text, 'dose_unit', v_dose_unit,
        'site_code', v_site_code, 'site_text', v_site_text,
        'executed_at', v_now, 'executor_user_id', v_actor,
        'executor_membership_id', v_membership, 'executor_role_keys', v_actor_roles,
        'executor_reauth_challenge_id', v_reauth,
        'executor_qualification_version_id', v_qualification,
        'late_entry', v_is_late
      )::text, 'UTF8')), 'hex');
      insert into public.insulin_administration_events(
        id, organization_id, branch_id, client_id, administration_key,
        event_sequence, previous_event_id, event_kind, state,
        medication_plan_id, medication_plan_version, medication_plan_content_hash,
        governance_version_id, scheduled_for, dose_text, dose_unit, site_code, site_text,
        executed_at, executor_user_id, executor_membership_id, executor_display_name,
        executor_role_keys, executor_reauth_challenge_id,
        executor_qualification_version_id, late_entry, late_reason,
        late_authorized_at, late_authorizer_user_id, late_authorizer_membership_id,
        late_authorizer_display_name, late_authorizer_role_keys,
        late_authorizer_reauth_challenge_id, late_authorizer_qualification_version_id,
        content_hash, created_at
      ) values (
        v_event_id, v_plan.organization_id, v_plan.branch_id, v_plan.client_id,
        v_key, v_sequence, case when v_is_late then v_previous.id else null end,
        'executed', 'pending_review', v_plan.id, v_plan.version, v_plan.content_hash,
        v_governance.id, p_scheduled_for, v_dose_text, v_dose_unit,
        v_site_code, v_site_text, v_now, v_actor, v_membership, v_actor_name,
        v_actor_roles, v_reauth, v_qualification, v_is_late,
        case when v_is_late then v_previous.late_reason else null end,
        case when v_is_late then v_previous.late_authorized_at else null end,
        case when v_is_late then v_previous.late_authorizer_user_id else null end,
        case when v_is_late then v_previous.late_authorizer_membership_id else null end,
        case when v_is_late then v_previous.late_authorizer_display_name else null end,
        case when v_is_late then v_previous.late_authorizer_role_keys else '{}'::text[] end,
        case when v_is_late then v_previous.late_authorizer_reauth_challenge_id else null end,
        case when v_is_late then v_previous.late_authorizer_qualification_version_id else null end,
        v_hash, v_now
      ) returning * into v_created;
    end if;
  end if;

  insert into private.insulin_administration_operations(
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, administration_key, event_id, event_sequence,
    previous_event_id, state, medication_plan_id, governance_version_id,
    scheduled_for, executed_at, reviewed_at, content_hash, created_at
  ) values (
    v_created.organization_id, v_created.branch_id, v_created.client_id,
    v_actor, p_idempotency_key, p_action, v_request_hash,
    v_created.administration_key, v_created.id, v_created.event_sequence,
    v_created.previous_event_id, v_created.state, v_created.medication_plan_id,
    v_created.governance_version_id, v_created.scheduled_for,
    v_created.executed_at, v_created.reviewed_at, v_created.content_hash, v_now
  ) returning * into v_operation;

  if not private.insulin_base_authority(
       p_expected_organization_id, p_expected_branch_id, v_permission
     ) or not private.can_staff_access_client(v_created.client_id, v_permission) then
    raise exception using errcode = '42501', message = 'insulin authority expired before commit';
  end if;
  return query select v_operation.organization_id, v_operation.branch_id,
    v_operation.id, v_operation.operation_kind, v_operation.administration_key,
    v_operation.event_id, v_operation.event_sequence, v_operation.previous_event_id,
    v_operation.state, v_operation.medication_plan_id, v_operation.governance_version_id,
    v_operation.scheduled_for, v_operation.executed_at, v_operation.reviewed_at,
    v_operation.content_hash, 'published'::text, 'published'::text, 'published'::text,
    case when v_operation.state = 'completed' then 'completed'
      else 'pending_independent_review' end::text,
    'not_configured'::text, false, v_operation.created_at;
end;
$$;

create or replace function public.mutate_insulin_administration(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_administration_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_medication_plan_id uuid,
  p_scheduled_for timestamptz,
  p_dose_text text,
  p_dose_unit text,
  p_site_code text,
  p_site_text text,
  p_late_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, operation_kind text,
  administration_key uuid, event_id uuid, event_sequence integer,
  previous_event_id uuid, state text, medication_plan_id uuid,
  governance_version_id uuid, scheduled_for timestamptz,
  executed_at timestamptz, reviewed_at timestamptz, content_hash text,
  qualification_status text, dose_rule_status text, late_entry_rule_status text,
  completion_status text, offline_status text, replayed boolean, committed_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_insulin_administration_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_administration_key, p_previous_event_id, p_expected_sequence,
    p_medication_plan_id, p_scheduled_for, p_dose_text, p_dose_unit,
    p_site_code, p_site_text, p_late_reason, p_idempotency_key
  );
$$;

create or replace function private.insulin_administration_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_service_date date,
  p_shift text,
  p_client_id uuid,
  p_status text
)
returns table(
  organization_id uuid, organization_name text,
  branch_id uuid, branch_name text, generated_at timestamptz,
  service_date date, snapshot_token text, items jsonb,
  matching_total bigint, scheduled_total bigint, late_authorized_total bigint,
  pending_review_total bigint, completed_total bigint, late_exception_total bigint,
  items_truncated boolean, client_options jsonb,
  governance_status text, plan_designation_status text,
  qualification_status text, dose_rule_status text, late_entry_rule_status text,
  can_execute boolean, can_review boolean, can_authorize_late boolean,
  offline_status text, attachment_status text, external_delivery_status text,
  delivery_claim text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_governance public.insulin_governance_versions%rowtype;
  v_membership uuid; v_actor_name text; v_actor_roles text[];
  v_organization_name text; v_branch_name text; v_items jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb; v_matching bigint := 0; v_scheduled bigint := 0;
  v_authorized bigint := 0; v_pending bigint := 0; v_completed bigint := 0;
  v_late bigint := 0; v_designations bigint := 0;
  v_can_execute boolean := false; v_can_review boolean := false;
  v_can_authorize boolean := false;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_service_date is null or p_shift not in ('all', 'morning', 'afternoon', 'evening')
     or p_status not in ('all', 'scheduled', 'late_authorized', 'pending_review', 'completed', 'late')
     or not private.insulin_base_authority(
       p_expected_organization_id, p_expected_branch_id, 'insulin_administrations.read'
     ) then
    raise exception using errcode = '42501', message = 'insulin snapshot is not permitted';
  end if;
  if p_client_id is not null and (
       not private.can_staff_access_client(p_client_id, 'clients.read')
       or not private.can_staff_access_client(p_client_id, 'medications.read')
       or not private.can_staff_access_client(p_client_id, 'insulin_administrations.read')
     ) then
    raise exception using errcode = '42501', message = 'insulin client filter is outside current scope';
  end if;
  select organization.name, branch.name
    into v_organization_name, v_branch_name
  from public.organizations organization
  join public.branches branch
    on branch.id = p_expected_branch_id
   and branch.organization_id = organization.id
   and branch.is_active
  where organization.id = p_expected_organization_id;
  if v_organization_name is null then
    raise exception using errcode = '42501', message = 'insulin tenant scope is unavailable';
  end if;

  select rule.* into v_governance
  from public.insulin_governance_versions rule
  where rule.id = private.insulin_governance_id(
    p_expected_organization_id, p_expected_branch_id, v_now
  );

  if found then
    select staff.membership_id, staff.display_name, staff.role_keys
      into v_membership, v_actor_name, v_actor_roles
    from private.insulin_staff_snapshot(
      p_expected_organization_id, p_expected_branch_id, v_actor, v_now
    ) staff;
    v_can_execute := v_membership is not null
      and v_actor_roles && v_governance.executor_role_keys
      and private.insulin_qualification_version(
        p_expected_organization_id, p_expected_branch_id, v_membership,
        v_actor,
        v_governance.executor_certificate_types, v_now
      ) is not null
      and private.insulin_base_authority(
        p_expected_organization_id, p_expected_branch_id,
        'insulin_administrations.execute'
      ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and private.has_recent_aal2(15);
    v_can_review := v_membership is not null
      and v_actor_roles && v_governance.reviewer_role_keys
      and private.insulin_qualification_version(
        p_expected_organization_id, p_expected_branch_id, v_membership,
        v_actor,
        v_governance.reviewer_certificate_types, v_now
      ) is not null
      and private.insulin_base_authority(
        p_expected_organization_id, p_expected_branch_id,
        'insulin_administrations.verify'
      ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and private.has_recent_aal2(15);
    v_can_authorize := v_membership is not null
      and v_actor_roles && v_governance.supervisor_role_keys
      and private.insulin_qualification_version(
        p_expected_organization_id, p_expected_branch_id, v_membership,
        v_actor,
        v_governance.supervisor_certificate_types, v_now
      ) is not null
      and private.insulin_base_authority(
        p_expected_organization_id, p_expected_branch_id,
        'insulin_administrations.authorize_late'
      ) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and private.has_recent_aal2(15);

    select count(*) into v_designations
    from public.insulin_plan_designations designation
    join public.medication_plans plan on plan.id = designation.medication_plan_id
    where designation.organization_id = p_expected_organization_id
      and designation.branch_id = p_expected_branch_id
      and designation.governance_version_id = v_governance.id
      and plan.workflow_version = 2 and plan.workflow_state = 'approved';

    with designated_slots as materialized (
      select plan.id medication_plan_id, plan.version medication_plan_version,
        plan.content_hash medication_plan_content_hash, plan.client_id,
        client.client_code, client.display_name client_display_name,
        plan.medication_name,
        trim_scale(plan.dose)::text ordered_dose_text,
        plan.dose_unit, plan.route medication_route,
        (
          (p_service_date::text || ' ' || schedule_time.value)::timestamp
          at time zone 'Asia/Taipei'
        ) scheduled_for
      from public.insulin_plan_designations designation
      join public.medication_plans plan
        on plan.id = designation.medication_plan_id
       and plan.organization_id = designation.organization_id
       and plan.branch_id = designation.branch_id
       and plan.client_id = designation.client_id
      join public.clients client
        on client.id = plan.client_id
       and client.organization_id = plan.organization_id
       and client.branch_id = plan.branch_id
      cross join lateral jsonb_array_elements_text(plan.schedule -> 'times') schedule_time(value)
      where plan.organization_id = p_expected_organization_id
        and plan.branch_id = p_expected_branch_id
        and designation.governance_version_id = v_governance.id
        and client.status = 'active' and client.admitted_on is not null
        and client.ended_on is null
        and schedule_time.value ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        and private.can_staff_access_client(client.id, 'clients.read')
        and private.can_staff_access_client(client.id, 'medications.read')
        and private.can_staff_access_client(client.id, 'insulin_administrations.read')
    ), valid_slots as materialized (
      select slot.*
      from designated_slots slot
      where private.insulin_plan_slot_is_valid(
        p_expected_organization_id, p_expected_branch_id, slot.client_id,
        slot.medication_plan_id, v_governance.id, slot.scheduled_for
      )
    ), current_rows as materialized (
      select slot.*, latest.id event_id, latest.administration_key,
        coalesce(latest.event_sequence, 0) event_sequence,
        latest.previous_event_id, coalesce(latest.state, 'scheduled') state,
        latest.event_kind, latest.dose_text, latest.dose_unit actual_dose_unit,
        latest.site_code, latest.site_text, latest.executed_at,
        latest.executor_user_id, latest.executor_display_name,
        latest.late_entry, latest.late_reason, latest.late_authorized_at,
        latest.late_authorizer_user_id, latest.late_authorizer_display_name,
        latest.reviewed_at, latest.reviewer_user_id, latest.reviewer_display_name,
        latest.content_hash,
        v_now > slot.scheduled_for + make_interval(mins => v_governance.late_after_minutes)
          and coalesce(latest.state, 'scheduled') in ('scheduled', 'late_authorized') is_late,
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'event_id', history.id, 'event_sequence', history.event_sequence,
            'previous_event_id', history.previous_event_id,
            'event_kind', history.event_kind, 'state', history.state,
            'occurred_at', history.created_at,
            'actor_display_name', case history.event_kind
              when 'late_authorized' then history.late_authorizer_display_name
              when 'executed' then history.executor_display_name
              else history.reviewer_display_name end,
            'content_hash', history.content_hash
          ) order by history.event_sequence desc), '[]'::jsonb)
          from public.insulin_administration_events history
          where history.organization_id = p_expected_organization_id
            and history.branch_id = p_expected_branch_id
            and history.medication_plan_id = slot.medication_plan_id
            and history.scheduled_for = slot.scheduled_for
        ) history
      from valid_slots slot
      left join lateral (
        select event.* from public.insulin_administration_events event
        where event.organization_id = p_expected_organization_id
          and event.branch_id = p_expected_branch_id
          and event.medication_plan_id = slot.medication_plan_id
          and event.scheduled_for = slot.scheduled_for
        order by event.event_sequence desc limit 1
      ) latest on true
    ), filtered as materialized (
      select * from current_rows current
      where (p_client_id is null or current.client_id = p_client_id)
        and (p_shift = 'all'
          or (p_shift = 'morning' and extract(hour from current.scheduled_for at time zone 'Asia/Taipei') < 12)
          or (p_shift = 'afternoon' and extract(hour from current.scheduled_for at time zone 'Asia/Taipei') between 12 and 17)
          or (p_shift = 'evening' and extract(hour from current.scheduled_for at time zone 'Asia/Taipei') >= 18))
        and (p_status = 'all' or current.state = p_status
          or (p_status = 'late' and current.is_late))
    ), selected as materialized (
      select * from filtered order by scheduled_for, client_display_name collate "C", medication_plan_id
      limit 200
    ), bundle as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'medication_plan_id', selected.medication_plan_id,
        'medication_plan_version', selected.medication_plan_version,
        'medication_plan_content_hash', selected.medication_plan_content_hash,
        'client_id', selected.client_id, 'client_code', selected.client_code,
        'client_display_name', selected.client_display_name,
        'medication_name', selected.medication_name,
        'ordered_dose_text', selected.ordered_dose_text,
        'dose_unit', selected.dose_unit, 'medication_route', selected.medication_route,
        'scheduled_for', selected.scheduled_for, 'event_id', selected.event_id,
        'administration_key', selected.administration_key,
        'event_sequence', selected.event_sequence,
        'previous_event_id', selected.previous_event_id, 'state', selected.state,
        'event_kind', selected.event_kind, 'actual_dose_text', selected.dose_text,
        'actual_dose_unit', selected.actual_dose_unit,
        'site_code', selected.site_code, 'site_text', selected.site_text,
        'executed_at', selected.executed_at,
        'executor_user_id', selected.executor_user_id,
        'executor_display_name', selected.executor_display_name,
        'late_entry', coalesce(selected.late_entry, false),
        'late_reason', selected.late_reason,
        'late_authorized_at', selected.late_authorized_at,
        'late_authorizer_user_id', selected.late_authorizer_user_id,
        'late_authorizer_display_name', selected.late_authorizer_display_name,
        'reviewed_at', selected.reviewed_at,
        'reviewer_user_id', selected.reviewer_user_id,
        'reviewer_display_name', selected.reviewer_display_name,
        'content_hash', selected.content_hash, 'is_late', selected.is_late,
        'history', selected.history
      ) order by selected.scheduled_for, selected.client_display_name collate "C",
        selected.medication_plan_id), '[]'::jsonb) value from selected
    ), metrics as (
      select count(*) matching,
        count(*) filter(where state = 'scheduled') scheduled,
        count(*) filter(where state = 'late_authorized') authorized,
        count(*) filter(where state = 'pending_review') pending,
        count(*) filter(where state = 'completed') completed,
        count(*) filter(where is_late) late
      from filtered
    ), options as (
      select coalesce(jsonb_agg(jsonb_build_object(
        'client_id', option.client_id, 'client_code', option.client_code,
        'display_name', option.client_display_name
      ) order by option.client_display_name collate "C", option.client_id), '[]'::jsonb) value
      from (select distinct client_id, client_code, client_display_name from valid_slots) option
    )
    select bundle.value, metrics.matching, metrics.scheduled, metrics.authorized,
      metrics.pending, metrics.completed, metrics.late, options.value
    into v_items, v_matching, v_scheduled, v_authorized,
      v_pending, v_completed, v_late, v_clients
    from bundle cross join metrics cross join options;
  end if;

  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'insulin_administration_snapshot', null, '{}'::text[], jsonb_build_object(
      'workflow', 'page5_insulin_v1', 'service_date', p_service_date,
      'shift', p_shift, 'client_filter_present', p_client_id is not null,
      'status', p_status, 'matching_total', v_matching,
      'governance_configured', v_governance.id is not null,
      'designation_configured', v_designations > 0
    )
  );
  if not private.insulin_base_authority(
       p_expected_organization_id, p_expected_branch_id,
       'insulin_administrations.read'
     ) then
    raise exception using errcode = '42501', message = 'insulin snapshot authority expired';
  end if;
  return query select p_expected_organization_id, v_organization_name,
    p_expected_branch_id, v_branch_name, v_now, p_service_date,
    encode(sha256(convert_to(jsonb_build_object(
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id, 'service_date', p_service_date,
      'items', v_items, 'governance_version_id', v_governance.id
    )::text, 'UTF8')), 'hex'),
    v_items, v_matching, v_scheduled, v_authorized, v_pending, v_completed,
    v_late, v_matching > jsonb_array_length(v_items), v_clients,
    case when v_governance.id is null then 'not_configured' else 'published' end,
    case when v_designations = 0 then 'not_configured' else 'published' end,
    case when v_governance.id is null then 'not_configured' else 'published' end,
    case when v_governance.id is null then 'not_configured' else 'published' end,
    case when v_governance.id is null then 'not_configured' else 'published' end,
    v_can_execute and v_designations > 0,
    v_can_review and v_designations > 0,
    v_can_authorize and v_designations > 0,
    'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 'no_external_delivery_claim'::text;
end;
$$;

create or replace function public.insulin_administration_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_service_date date,
  p_shift text default 'all',
  p_client_id uuid default null,
  p_status text default 'all'
)
returns table(
  organization_id uuid, organization_name text,
  branch_id uuid, branch_name text, generated_at timestamptz,
  service_date date, snapshot_token text, items jsonb,
  matching_total bigint, scheduled_total bigint, late_authorized_total bigint,
  pending_review_total bigint, completed_total bigint, late_exception_total bigint,
  items_truncated boolean, client_options jsonb,
  governance_status text, plan_designation_status text,
  qualification_status text, dose_rule_status text, late_entry_rule_status text,
  can_execute boolean, can_review boolean, can_authorize_late boolean,
  offline_status text, attachment_status text, external_delivery_status text,
  delivery_claim text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.insulin_administration_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_service_date,
    p_shift, p_client_id, p_status
  );
$$;

revoke all on function private.prevent_insulin_ledger_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.insulin_staff_snapshot(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.insulin_qualification_version(uuid, uuid, uuid, uuid, text[], timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_insulin_reauth(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.insulin_base_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.insulin_governance_id(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.insulin_plan_slot_is_valid(uuid, uuid, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_insulin_administration_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.insulin_administration_snapshot_response(
  uuid, uuid, date, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.mutate_insulin_administration(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) from public, anon, service_role;
revoke all on function public.insulin_administration_snapshot(
  uuid, uuid, date, text, uuid, text
) from public, anon, service_role;

grant execute on function public.mutate_insulin_administration(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.insulin_administration_snapshot(
  uuid, uuid, date, text, uuid, text
) to authenticated;
grant execute on function private.mutate_insulin_administration_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.insulin_administration_snapshot_response(
  uuid, uuid, date, text, uuid, text
) to authenticated;

comment on function public.mutate_insulin_administration(
  uuid, uuid, text, uuid, uuid, integer, uuid, timestamptz,
  text, text, text, text, text, uuid
) is 'Append-only Page-5 late authorization, execution, and independent review. Public wrapper is SECURITY INVOKER; private core is pinned.';
comment on function public.insulin_administration_snapshot(
  uuid, uuid, date, text, uuid, text
) is 'Server-only Page-5 projection. Empty governance/designation remains explicit not_configured and never grants a write capability.';
