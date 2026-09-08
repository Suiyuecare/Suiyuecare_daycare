-- Page 59: governed staff membership and employment management.
-- profiles, memberships, membership_roles, roles and Page-72 terminal
-- certificate versions remain the only authoritative identity, access and
-- qualification sources. This slice adds immutable governance evidence,
-- concurrency tokens and a measurable, fail-closed session-revocation queue.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_management.read', 'Read the scoped staff management projection', 2),
  ('staff_management.identity.read', 'Read scoped staff identity fields', 2),
  ('staff_management.employment.read', 'Read scoped employment fields', 2),
  ('staff_management.roles.read', 'Read scoped staff role assignments', 2),
  ('staff_management.qualifications.read', 'Read Page-72 terminal qualification summaries', 2),
  ('staff_management.manage', 'Submit governed staff changes', 3),
  ('staff_management.approve', 'Independently decide governed staff changes', 3),
  ('staff_management.employment.manage', 'Manage employment fields', 3),
  ('staff_management.roles.manage', 'Request governed role assignment changes', 3),
  ('staff_management.termination.manage', 'Request and approve staff termination', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key like 'staff_management.%'
on conflict (role_id, permission_id) do nothing;

alter table public.memberships
  add column staff_management_version bigint not null default 1;
alter table public.memberships
  add constraint memberships_staff_management_version_check
  check (staff_management_version > 0);

create table public.staff_employment_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  membership_id uuid not null,
  version integer not null,
  previous_version_id uuid,
  membership_version bigint not null,
  action text not null,
  membership_status public.membership_status not null,
  starts_on date not null,
  ends_on date,
  employment_type_text text,
  job_title_text text,
  registration_status_text text,
  change_reason text not null,
  source_proposal_id uuid not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  content_hash text not null,
  constraint staff_employment_version_membership_scope_fkey
    foreign key (membership_id, organization_id, branch_id)
    references public.memberships(id, organization_id, branch_id) on delete restrict,
  constraint staff_employment_version_id_scope_key
    unique (id, organization_id, branch_id),
  constraint staff_employment_version_chain_key unique (membership_id, version),
  constraint staff_employment_version_previous_unique unique (previous_version_id),
  constraint staff_employment_version_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id
  ) references public.staff_employment_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_employment_version_shape_check check (
    version > 0 and membership_version > 0
    and action in ('onboard', 'employment_change', 'terminate')
    and membership_status in ('active', 'suspended', 'ended')
    and (ends_on is null or ends_on >= starts_on)
  ),
  constraint staff_employment_version_chain_shape_check check (
    (version = 1 and previous_version_id is null)
    or (version > 1 and previous_version_id is not null)
  ),
  constraint staff_employment_version_fields_check check (
    (action in ('onboard', 'employment_change')
      and employment_type_text is not null
      and job_title_text is not null
      and registration_status_text is not null)
    or action = 'terminate'
  ),
  constraint staff_employment_version_text_check check (
    (employment_type_text is null or (
      char_length(btrim(employment_type_text)) between 1 and 120
      and employment_type_text !~ '[[:cntrl:]]'))
    and (job_title_text is null or (
      char_length(btrim(job_title_text)) between 1 and 160
      and job_title_text !~ '[[:cntrl:]]'))
    and (registration_status_text is null or (
      char_length(btrim(registration_status_text)) between 1 and 160
      and registration_status_text !~ '[[:cntrl:]]'))
    and char_length(btrim(change_reason)) between 1 and 1000
    and translate(change_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint staff_employment_version_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.staff_management_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  proposal_key uuid not null,
  proposal_number bigint generated always as identity,
  action text not null,
  target_membership_id uuid not null,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  expected_membership_version bigint not null,
  target_membership_status public.membership_status not null,
  starts_on date not null,
  ends_on date,
  employment_type_text text,
  job_title_text text,
  registration_status_text text,
  termination_effective_on date,
  change_reason text not null,
  target_display_name_snapshot text not null,
  target_employee_code_snapshot text,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete restrict,
  requester_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  requested_at timestamptz not null,
  request_idempotency_key uuid not null,
  request_hash text not null,
  content_hash text not null,
  decision text,
  decision_reason text,
  decided_by uuid references auth.users(id) on delete restrict,
  decider_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  decided_at timestamptz,
  decision_idempotency_key uuid,
  decision_hash text,
  result_employment_version_id uuid,
  result_membership_version bigint,
  result_revocation_job_id uuid,
  constraint staff_management_proposal_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_management_proposal_id_scope_key
    unique (id, organization_id, branch_id),
  constraint staff_management_proposal_key_scope_key
    unique (organization_id, proposal_key),
  constraint staff_management_proposal_request_key
    unique (requested_by, request_idempotency_key),
  constraint staff_management_proposal_action_check check (
    action in ('onboard', 'employment_change', 'terminate')
  ),
  constraint staff_management_proposal_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint staff_management_proposal_dates_check check (
    extract(year from starts_on) between 1900 and 2200
    and (ends_on is null or (
      ends_on >= starts_on and extract(year from ends_on) between 1900 and 2200))
    and (termination_effective_on is null or
      extract(year from termination_effective_on) between 1900 and 2200)
  ),
  constraint staff_management_proposal_action_shape_check check (
    (action = 'onboard' and expected_membership_version = 0
      and target_membership_status = 'active'
      and termination_effective_on is null
      and employment_type_text is not null and job_title_text is not null
      and registration_status_text is not null)
    or (action = 'employment_change' and expected_membership_version > 0
      and target_membership_status in ('active', 'suspended')
      and termination_effective_on is null
      and employment_type_text is not null and job_title_text is not null
      and registration_status_text is not null)
    or (action = 'terminate' and expected_membership_version > 0
      and target_membership_status = 'ended'
      and termination_effective_on is not null)
  ),
  constraint staff_management_proposal_text_check check (
    char_length(btrim(target_display_name_snapshot)) between 1 and 120
    and target_display_name_snapshot !~ '[[:cntrl:]]'
    and (target_employee_code_snapshot is null or (
      char_length(btrim(target_employee_code_snapshot)) between 1 and 120
      and target_employee_code_snapshot !~ '[[:cntrl:]]'))
    and (employment_type_text is null or (
      char_length(btrim(employment_type_text)) between 1 and 120
      and employment_type_text !~ '[[:cntrl:]]'))
    and (job_title_text is null or (
      char_length(btrim(job_title_text)) between 1 and 160
      and job_title_text !~ '[[:cntrl:]]'))
    and (registration_status_text is null or (
      char_length(btrim(registration_status_text)) between 1 and 160
      and registration_status_text !~ '[[:cntrl:]]'))
    and char_length(btrim(change_reason)) between 1 and 1000
    and translate(change_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    and (decision_reason is null or (
      char_length(btrim(decision_reason)) between 1 and 1000
      and translate(decision_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'))
  ),
  constraint staff_management_proposal_decision_shape_check check (
    (status = 'pending' and decision is null and decision_reason is null
      and decided_by is null and decider_reauth_challenge_id is null
      and decided_at is null and decision_idempotency_key is null
      and decision_hash is null and result_employment_version_id is null
      and result_membership_version is null and result_revocation_job_id is null)
    or (status = 'rejected' and decision = 'reject'
      and decision_reason is not null and decided_by is not null
      and decided_by <> requested_by and decider_reauth_challenge_id is not null
      and decider_reauth_challenge_id <> requester_reauth_challenge_id
      and decided_at is not null and decision_idempotency_key is not null
      and decision_hash ~ '^[a-f0-9]{64}$'
      and result_employment_version_id is null
      and result_membership_version is null and result_revocation_job_id is null)
    or (status = 'approved' and decision = 'approve'
      and decision_reason is not null and decided_by is not null
      and decided_by <> requested_by and decider_reauth_challenge_id is not null
      and decider_reauth_challenge_id <> requester_reauth_challenge_id
      and decided_at is not null and decision_idempotency_key is not null
      and decision_hash ~ '^[a-f0-9]{64}$'
      and result_employment_version_id is not null
      and result_membership_version is not null)
  ),
  constraint staff_management_proposal_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create unique index staff_management_proposal_decision_key
  on public.staff_management_proposals(decided_by, decision_idempotency_key)
  where decided_by is not null and decision_idempotency_key is not null;
alter table public.staff_management_proposals
  add constraint staff_management_proposal_revocation_result_check check (
    status <> 'approved'
    or (action = 'terminate' and result_revocation_job_id is not null)
    or (action <> 'terminate' and result_revocation_job_id is null)
  );

create table private.staff_session_revocation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  membership_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  source_proposal_id uuid not null,
  provider_status text not null default 'not_configured',
  delivery_status text not null default 'queued',
  verification_status text not null default 'not_verified',
  queued_at timestamptz not null,
  deadline_at timestamptz not null,
  completed_at timestamptz,
  failed_at timestamptz,
  provider_receipt text,
  content_hash text not null,
  constraint staff_session_revocation_job_membership_scope_fkey
    foreign key (membership_id, organization_id, branch_id)
    references public.memberships(id, organization_id, branch_id) on delete restrict,
  constraint staff_session_revocation_job_proposal_scope_fkey
    foreign key (source_proposal_id, organization_id, branch_id)
    references public.staff_management_proposals(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_session_revocation_job_proposal_key unique (source_proposal_id),
  constraint staff_session_revocation_job_id_scope_key
    unique (id, organization_id, branch_id),
  constraint staff_session_revocation_job_status_check check (
    provider_status = 'not_configured'
    and delivery_status = 'queued'
    and verification_status = 'not_verified'
    and completed_at is null and failed_at is null and provider_receipt is null
  ),
  constraint staff_session_revocation_job_deadline_check
    check (deadline_at = queued_at + interval '5 minutes'),
  constraint staff_session_revocation_job_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_role_request_versions (
  request_id uuid primary key references public.role_governance_requests(id)
    on delete restrict,
  organization_id uuid not null,
  branch_id uuid not null,
  target_membership_id uuid not null,
  expected_membership_version bigint not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  content_hash text not null,
  constraint staff_role_request_version_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_role_request_version_membership_scope_fkey
    foreign key (target_membership_id, organization_id, branch_id)
    references public.memberships(id, organization_id, branch_id) on delete restrict,
  constraint staff_role_request_version_check
    check (expected_membership_version > 0),
  constraint staff_role_request_version_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

alter table public.staff_management_proposals
  add constraint staff_management_proposal_result_version_fkey
  foreign key (result_employment_version_id, organization_id, branch_id)
  references public.staff_employment_versions(id, organization_id, branch_id)
  on delete restrict;
alter table public.staff_management_proposals
  add constraint staff_management_proposal_result_job_fkey
  foreign key (result_revocation_job_id, organization_id, branch_id)
  references private.staff_session_revocation_jobs(id, organization_id, branch_id)
  on delete restrict;
alter table public.staff_employment_versions
  add constraint staff_employment_version_source_proposal_fkey
  foreign key (source_proposal_id, organization_id, branch_id)
  references public.staff_management_proposals(id, organization_id, branch_id)
  on delete restrict;

create index staff_employment_version_scope_idx on public.staff_employment_versions(
  organization_id, branch_id, membership_id, version desc
);
create index staff_employment_version_previous_idx
  on public.staff_employment_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_employment_version_approved_by_idx
  on public.staff_employment_versions(approved_by);
create index staff_employment_version_source_idx
  on public.staff_employment_versions(source_proposal_id, organization_id, branch_id);
create index staff_management_proposal_queue_idx on public.staff_management_proposals(
  organization_id, branch_id, status, requested_at desc
);
create index staff_management_proposal_target_idx on public.staff_management_proposals(
  target_membership_id, expected_membership_version
);
create index staff_management_proposal_profile_idx
  on public.staff_management_proposals(target_profile_id);
create index staff_management_proposal_requester_challenge_idx
  on public.staff_management_proposals(requester_reauth_challenge_id);
create index staff_management_proposal_decider_challenge_idx
  on public.staff_management_proposals(decider_reauth_challenge_id)
  where decider_reauth_challenge_id is not null;
create index staff_management_proposal_result_version_idx
  on public.staff_management_proposals(
    result_employment_version_id, organization_id, branch_id
  ) where result_employment_version_id is not null;
create index staff_management_proposal_result_job_idx
  on public.staff_management_proposals(
    result_revocation_job_id, organization_id, branch_id
  ) where result_revocation_job_id is not null;
create index staff_session_revocation_job_queue_idx
  on private.staff_session_revocation_jobs(
    organization_id, branch_id, delivery_status, deadline_at
  );
create index staff_session_revocation_job_membership_idx
  on private.staff_session_revocation_jobs(
    membership_id, organization_id, branch_id, queued_at desc
  );
create index staff_session_revocation_job_profile_idx
  on private.staff_session_revocation_jobs(profile_id);
create index staff_role_request_version_scope_idx
  on private.staff_role_request_versions(
    organization_id, branch_id, target_membership_id, expected_membership_version
  );
create index staff_role_request_version_requester_idx
  on private.staff_role_request_versions(requested_by);

create or replace function private.staff_management_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'staff management evidence is append only';
end;
$$;

create trigger staff_employment_versions_append_only
before update or delete on public.staff_employment_versions
for each row execute function private.staff_management_append_only();
create trigger staff_session_revocation_jobs_append_only
before update or delete on private.staff_session_revocation_jobs
for each row execute function private.staff_management_append_only();
create trigger staff_role_request_versions_append_only
before update or delete on private.staff_role_request_versions
for each row execute function private.staff_management_append_only();

create or replace function private.protect_staff_management_proposal()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'staff management proposals cannot be deleted';
  end if;
  if old.status <> 'pending' or new.status not in ('approved', 'rejected')
     or new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.branch_id is distinct from old.branch_id
     or new.proposal_key is distinct from old.proposal_key
     or new.proposal_number is distinct from old.proposal_number
     or new.action is distinct from old.action
     or new.target_membership_id is distinct from old.target_membership_id
     or new.target_profile_id is distinct from old.target_profile_id
     or new.expected_membership_version is distinct from old.expected_membership_version
     or new.target_membership_status is distinct from old.target_membership_status
     or new.starts_on is distinct from old.starts_on
     or new.ends_on is distinct from old.ends_on
     or new.employment_type_text is distinct from old.employment_type_text
     or new.job_title_text is distinct from old.job_title_text
     or new.registration_status_text is distinct from old.registration_status_text
     or new.termination_effective_on is distinct from old.termination_effective_on
     or new.change_reason is distinct from old.change_reason
     or new.target_display_name_snapshot is distinct from old.target_display_name_snapshot
     or new.target_employee_code_snapshot is distinct from old.target_employee_code_snapshot
     or new.requested_by is distinct from old.requested_by
     or new.requester_reauth_challenge_id is distinct from old.requester_reauth_challenge_id
     or new.requested_at is distinct from old.requested_at
     or new.request_idempotency_key is distinct from old.request_idempotency_key
     or new.request_hash is distinct from old.request_hash
     or new.content_hash is distinct from old.content_hash then
    raise exception using errcode = '55000',
      message = 'staff management proposal content is immutable';
  end if;
  return new;
end;
$$;

create trigger staff_management_proposals_protect
before update or delete on public.staff_management_proposals
for each row execute function private.protect_staff_management_proposal();

create or replace function private.bump_staff_management_version_for_role()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_membership_id uuid := case when tg_op = 'DELETE'
    then old.membership_id else new.membership_id end;
begin
  update public.memberships membership
  set staff_management_version = membership.staff_management_version + 1,
      updated_at = clock_timestamp()
  where membership.id = v_membership_id;
  if not found then
    raise exception using errcode = '23503', message = 'role membership is missing';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger membership_roles_bump_staff_management_version
after insert or delete on public.membership_roles
for each row execute function private.bump_staff_management_version_for_role();

create trigger staff_employment_versions_audit_row_change
after insert or update or delete on public.staff_employment_versions
for each row execute function private.audit_row_change();
create trigger staff_management_proposals_audit_row_change
after insert or update or delete on public.staff_management_proposals
for each row execute function private.audit_row_change();
create trigger staff_session_revocation_jobs_audit_row_change
after insert or update or delete on private.staff_session_revocation_jobs
for each row execute function private.audit_row_change();
create trigger staff_role_request_versions_audit_row_change
after insert or update or delete on private.staff_role_request_versions
for each row execute function private.audit_row_change();

alter table public.staff_employment_versions enable row level security;
alter table public.staff_employment_versions force row level security;
alter table public.staff_management_proposals enable row level security;
alter table public.staff_management_proposals force row level security;
alter table private.staff_session_revocation_jobs enable row level security;
alter table private.staff_session_revocation_jobs force row level security;
alter table private.staff_role_request_versions enable row level security;
alter table private.staff_role_request_versions force row level security;

revoke all on table public.staff_employment_versions
  from public, anon, authenticated, service_role;
revoke all on table public.staff_management_proposals
  from public, anon, authenticated, service_role;
revoke all on table private.staff_session_revocation_jobs
  from public, anon, authenticated, service_role;
revoke all on table private.staff_role_request_versions
  from public, anon, authenticated, service_role;
-- Membership state and role assignments are now changed only by governed RPCs.
revoke insert, update, delete on table public.memberships
  from authenticated, service_role;
revoke insert, update, delete on table public.membership_roles
  from authenticated, service_role;

create or replace function private.staff_management_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_expected_organization_id is not null
    and p_expected_branch_id is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.profiles profile
      join public.memberships membership on membership.profile_id = profile.id
      join public.membership_roles membership_role
        on membership_role.membership_id = membership.id
      join public.roles role on role.id = membership_role.role_id and role.is_active
      join public.role_permissions role_permission
        on role_permission.role_id = role.id
      join public.permissions permission on permission.id = role_permission.permission_id
      where profile.id = auth.uid() and profile.is_active
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
        and membership.organization_id = p_expected_organization_id
        and membership.status = 'active'
        and membership.starts_at <= clock_timestamp()
        and (membership.ends_at is null or membership.ends_at > clock_timestamp())
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and (role.organization_id is null or role.organization_id = p_expected_organization_id)
        and permission.permission_key = p_permission
    );
$$;

create or replace function private.staff_management_has_read_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.read')
    and private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.identity.read')
    and private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.employment.read')
    and private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.roles.read')
    and private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.qualifications.read')
    and private.staff_certificate_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_certificates.read');
$$;

create or replace function private.staff_management_has_manage_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_domain text,
  p_approve boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.read')
    and private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_management.manage')
    and (p_domain is null or case p_domain
      when 'employment' then
        private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.identity.read')
        and private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.employment.read')
        and private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.employment.manage')
      when 'roles' then
        private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.identity.read')
        and private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.roles.read')
        and private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.roles.manage')
        and private.has_permission(
          p_expected_organization_id, p_expected_branch_id, 'roles.manage')
      when 'termination' then
        private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.identity.read')
        and private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.employment.read')
        and private.staff_management_current_authority(
          p_expected_organization_id, p_expected_branch_id,
          'staff_management.termination.manage')
      else false end)
    and (not p_approve or private.staff_management_current_authority(
      p_expected_organization_id, p_expected_branch_id,
      'staff_management.approve'));
$$;

create or replace function private.require_staff_management_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current same-session staff management AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session staff management AAL2 evidence is required';
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
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1 for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session staff management AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.submit_staff_management_proposal_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_proposal_key uuid,
  p_target_membership_id uuid,
  p_target_profile_id uuid,
  p_expected_membership_version bigint,
  p_target_membership_status text,
  p_starts_on date,
  p_ends_on date,
  p_employment_type_text text,
  p_job_title_text text,
  p_registration_status_text text,
  p_termination_effective_on date,
  p_change_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, proposal_id uuid,
  proposal_key uuid, proposal_number bigint, action text,
  proposal_status text, target_membership_id uuid, target_profile_id uuid,
  expected_membership_version bigint, content_hash text,
  requested_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_action text;
  v_status text;
  v_employment_type text;
  v_job_title text;
  v_registration_status text;
  v_reason text;
  v_profile public.profiles%rowtype;
  v_membership public.memberships%rowtype;
  v_latest public.staff_employment_versions%rowtype;
  v_existing public.staff_management_proposals%rowtype;
  v_created public.staff_management_proposals%rowtype;
  v_challenge_id uuid;
  v_request_hash text;
  v_content_hash text;
begin
  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id, null, false
     ) then
    raise exception using errcode = '42501',
      message = 'staff management proposal is not permitted';
  end if;
  v_challenge_id := private.require_staff_management_reauth(v_actor, v_now);

  v_action := lower(btrim(coalesce(p_action, '')));
  v_status := lower(btrim(coalesce(p_target_membership_status, '')));
  v_employment_type := nullif(btrim(p_employment_type_text), '');
  v_job_title := nullif(btrim(p_job_title_text), '');
  v_registration_status := nullif(btrim(p_registration_status_text), '');
  v_reason := nullif(btrim(p_change_reason), '');
  if p_proposal_key is null or p_target_membership_id is null
     or p_target_profile_id is null or p_expected_membership_version is null
     or p_idempotency_key is null
     or v_action not in ('onboard', 'employment_change', 'terminate')
     or v_status not in ('active', 'suspended', 'ended')
     or p_starts_on is null
     or extract(year from p_starts_on) not between 1900 and 2200
     or (p_ends_on is not null and (
       p_ends_on < p_starts_on or extract(year from p_ends_on) not between 1900 and 2200))
     or v_reason is null or char_length(v_reason) > 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'valid staff management proposal fields are required';
  end if;
  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id,
       case when v_action = 'terminate' then 'termination' else 'employment' end,
       false
     ) then
    raise exception using errcode = '42501',
      message = 'staff management proposal field authority is missing';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'proposal_key', p_proposal_key,
    'target_membership_id', p_target_membership_id,
    'target_profile_id', p_target_profile_id,
    'expected_membership_version', p_expected_membership_version,
    'target_membership_status', v_status,
    'starts_on', p_starts_on,
    'ends_on', p_ends_on,
    'employment_type_text', v_employment_type,
    'job_title_text', v_job_title,
    'registration_status_text', v_registration_status,
    'termination_effective_on', p_termination_effective_on,
    'change_reason', v_reason,
    'requested_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-management-proposal:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));
  select proposal.* into v_existing
  from public.staff_management_proposals proposal
  where proposal.requested_by = v_actor
    and proposal.request_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'staff management idempotency conflict';
    end if;
    return query select v_existing.organization_id, v_existing.branch_id,
      v_existing.id, v_existing.proposal_key, v_existing.proposal_number,
      v_existing.action, v_existing.status, v_existing.target_membership_id,
      v_existing.target_profile_id, v_existing.expected_membership_version,
      v_existing.content_hash, v_existing.requested_at, true;
    return;
  end if;

  -- A profile is a platform identity, not proof that this organization may
  -- employ or even discover that person. Until an organization-scoped,
  -- governed invitation/candidate relation exists, onboarding must stay
  -- unavailable at the database boundary rather than accepting an arbitrary
  -- global profile UUID supplied by a caller.
  if v_action = 'onboard' then
    raise exception using errcode = '55000',
      message = 'staff onboarding candidate source is not configured';
  end if;

  select profile.* into v_profile from public.profiles profile
  where profile.id = p_target_profile_id
    and profile.kind in ('staff', 'professional', 'driver', 'finance')
  for share;
  if not found then
    raise exception using errcode = '42501',
      message = 'staff profile is outside the operational audience';
  end if;

  if v_action = 'onboard' then
    if p_expected_membership_version <> 0 or v_status <> 'active'
       or p_termination_effective_on is not null
       or v_employment_type is null or char_length(v_employment_type) > 120
       or v_job_title is null or char_length(v_job_title) > 160
       or v_registration_status is null or char_length(v_registration_status) > 160
       or v_employment_type ~ '[[:cntrl:]]' or v_job_title ~ '[[:cntrl:]]'
       or v_registration_status ~ '[[:cntrl:]]'
       or exists (select 1 from public.memberships membership
         where membership.id = p_target_membership_id)
       or exists (select 1 from public.memberships membership
         where membership.organization_id = p_expected_organization_id
           and membership.branch_id = p_expected_branch_id
           and membership.profile_id = p_target_profile_id) then
      raise exception using errcode = '23514',
        message = 'staff onboarding target or fields are invalid';
    end if;
  else
    select membership.* into v_membership
    from public.memberships membership
    where membership.id = p_target_membership_id
      and membership.organization_id = p_expected_organization_id
      and membership.branch_id = p_expected_branch_id
      and membership.profile_id = p_target_profile_id
    for update;
    if not found then
      raise exception using errcode = '42501',
        message = 'staff membership is outside the selected branch';
    end if;
    if v_membership.staff_management_version <> p_expected_membership_version then
      raise exception using errcode = '40001',
        message = 'staff membership version changed';
    end if;
    select employment.* into v_latest
    from public.staff_employment_versions employment
    where employment.membership_id = v_membership.id
    order by employment.version desc limit 1 for share;

    if v_action = 'employment_change' then
      if v_status not in ('active', 'suspended')
         or p_termination_effective_on is not null
         or v_membership.status = 'ended'
         or v_employment_type is null or char_length(v_employment_type) > 120
         or v_job_title is null or char_length(v_job_title) > 160
         or v_registration_status is null or char_length(v_registration_status) > 160
         or v_employment_type ~ '[[:cntrl:]]' or v_job_title ~ '[[:cntrl:]]'
         or v_registration_status ~ '[[:cntrl:]]' then
        raise exception using errcode = '23514',
          message = 'staff employment change fields are invalid';
      end if;
    else
      if v_status <> 'ended' or p_termination_effective_on is null
         or p_termination_effective_on > (v_now at time zone 'Asia/Taipei')::date
         or v_membership.status = 'ended' or v_membership.starts_at >= v_now then
        raise exception using errcode = '23514',
          message = 'staff termination must be immediate and target an active period';
      end if;
      v_employment_type := v_latest.employment_type_text;
      v_job_title := v_latest.job_title_text;
      v_registration_status := v_latest.registration_status_text;
    end if;
  end if;

  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id,
       case when v_action = 'terminate' then 'termination' else 'employment' end,
       false
     ) then
    raise exception using errcode = '42501',
      message = 'staff management proposal authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'request_hash', v_request_hash,
    'display_name', btrim(v_profile.display_name),
    'employee_code', nullif(btrim(v_profile.employee_code), ''),
    'employment_type_text', v_employment_type,
    'job_title_text', v_job_title,
    'registration_status_text', v_registration_status
  )::text, 'UTF8')), 'hex');

  insert into public.staff_management_proposals(
    organization_id, branch_id, proposal_key, action,
    target_membership_id, target_profile_id, expected_membership_version,
    target_membership_status, starts_on, ends_on, employment_type_text,
    job_title_text, registration_status_text, termination_effective_on,
    change_reason, target_display_name_snapshot, target_employee_code_snapshot,
    requested_by, requester_reauth_challenge_id, requested_at,
    request_idempotency_key, request_hash, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_proposal_key, v_action,
    p_target_membership_id, p_target_profile_id, p_expected_membership_version,
    v_status::public.membership_status, p_starts_on, p_ends_on, v_employment_type,
    v_job_title, v_registration_status, p_termination_effective_on,
    v_reason, btrim(v_profile.display_name),
    nullif(btrim(v_profile.employee_code), ''), v_actor, v_challenge_id, v_now,
    p_idempotency_key, v_request_hash, v_content_hash
  ) returning * into v_created;

  return query select v_created.organization_id, v_created.branch_id,
    v_created.id, v_created.proposal_key, v_created.proposal_number,
    v_created.action, v_created.status, v_created.target_membership_id,
    v_created.target_profile_id, v_created.expected_membership_version,
    v_created.content_hash, v_created.requested_at, false;
end;
$$;

create or replace function private.decide_staff_management_proposal_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_proposal_id uuid,
  p_expected_proposal_number bigint,
  p_expected_membership_version bigint,
  p_expected_content_hash text,
  p_decision text,
  p_decision_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, proposal_id uuid,
  proposal_number bigint, action text, decision text, proposal_status text,
  target_membership_id uuid, target_profile_id uuid,
  result_employment_version_id uuid, result_employment_version integer,
  result_membership_version bigint, result_revocation_job_id uuid,
  revocation_provider_status text, revocation_verification_status text,
  revocation_queued_at timestamptz, revocation_deadline_at timestamptz,
  content_hash text, decided_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_decision text;
  v_reason text;
  v_challenge_id uuid;
  v_proposal public.staff_management_proposals%rowtype;
  v_membership public.memberships%rowtype;
  v_previous public.staff_employment_versions%rowtype;
  v_employment public.staff_employment_versions%rowtype;
  v_job private.staff_session_revocation_jobs%rowtype;
  v_decision_hash text;
  v_version integer;
  v_membership_version bigint;
begin
  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id, null, true
     ) then
    raise exception using errcode = '42501',
      message = 'staff management decision is not permitted';
  end if;
  v_challenge_id := private.require_staff_management_reauth(v_actor, v_now);
  v_decision := lower(btrim(coalesce(p_decision, '')));
  v_reason := nullif(btrim(p_decision_reason), '');
  if p_proposal_id is null or p_expected_proposal_number is null
     or p_expected_proposal_number < 1
     or p_expected_membership_version is null
     or p_expected_membership_version < 0
     or p_expected_content_hash !~ '^[a-f0-9]{64}$'
     or v_decision not in ('approve', 'reject')
     or v_reason is null or char_length(v_reason) > 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'valid staff management decision fields are required';
  end if;

  select proposal.* into v_proposal
  from public.staff_management_proposals proposal
  where proposal.id = p_proposal_id
    and proposal.organization_id = p_expected_organization_id
    and proposal.branch_id = p_expected_branch_id
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'staff management proposal is outside current scope';
  end if;

  v_decision_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'proposal_id', p_proposal_id,
    'proposal_number', p_expected_proposal_number,
    'expected_membership_version', p_expected_membership_version,
    'expected_content_hash', p_expected_content_hash,
    'decision', v_decision, 'decision_reason', v_reason,
    'decided_by', v_actor
  )::text, 'UTF8')), 'hex');

  if v_proposal.status <> 'pending' then
    if v_proposal.decided_by = v_actor
       and v_proposal.decision_idempotency_key = p_idempotency_key
       and v_proposal.decision_hash = v_decision_hash then
      if v_proposal.result_employment_version_id is not null then
        select employment.* into v_employment
        from public.staff_employment_versions employment
        where employment.id = v_proposal.result_employment_version_id;
      end if;
      if v_proposal.result_revocation_job_id is not null then
        select job.* into v_job from private.staff_session_revocation_jobs job
        where job.id = v_proposal.result_revocation_job_id;
      end if;
      return query select v_proposal.organization_id, v_proposal.branch_id,
        v_proposal.id, v_proposal.proposal_number, v_proposal.action,
        v_proposal.decision, v_proposal.status, v_proposal.target_membership_id,
        v_proposal.target_profile_id, v_proposal.result_employment_version_id,
        v_employment.version, v_proposal.result_membership_version,
        v_proposal.result_revocation_job_id, v_job.provider_status,
        v_job.verification_status, v_job.queued_at, v_job.deadline_at,
        v_proposal.content_hash, v_proposal.decided_at, true;
      return;
    end if;
    raise exception using errcode = '23505',
      message = 'staff management proposal was already decided';
  end if;
  if v_proposal.requested_by = v_actor then
    raise exception using errcode = '42501',
      message = 'staff management proposal requires an independent reviewer';
  end if;
  if v_proposal.proposal_number <> p_expected_proposal_number
     or v_proposal.expected_membership_version <> p_expected_membership_version
     or v_proposal.content_hash <> p_expected_content_hash then
    raise exception using errcode = '40001',
      message = 'staff management proposal expectation changed';
  end if;

  -- A migrated legacy onboarding proposal may remain visible as immutable
  -- history, but it cannot create a membership until an organization-scoped
  -- candidate source and Auth account adapter are actually governed.
  if v_proposal.action = 'onboard' and v_decision = 'approve' then
    raise exception using errcode = '55000',
      message = 'staff onboarding candidate source is not configured';
  end if;

  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id,
       case when v_proposal.action = 'terminate'
         then 'termination' else 'employment' end, true
     ) then
    raise exception using errcode = '42501',
      message = 'staff management decision field authority is missing';
  end if;

  if v_decision = 'approve' then
    if v_proposal.action = 'onboard' then
      if exists (select 1 from public.memberships membership
           where membership.id = v_proposal.target_membership_id)
         or exists (select 1 from public.memberships membership
           where membership.organization_id = v_proposal.organization_id
             and membership.branch_id = v_proposal.branch_id
             and membership.profile_id = v_proposal.target_profile_id) then
        raise exception using errcode = '40001',
          message = 'staff onboarding target changed before approval';
      end if;
      insert into public.memberships(
        id, organization_id, branch_id, profile_id, status,
        starts_at, ends_at, staff_management_version
      ) values (
        v_proposal.target_membership_id, v_proposal.organization_id,
        v_proposal.branch_id, v_proposal.target_profile_id, 'active',
        v_proposal.starts_on::timestamp at time zone 'Asia/Taipei', null, 1
      ) returning * into v_membership;
    else
      select membership.* into v_membership
      from public.memberships membership
      where membership.id = v_proposal.target_membership_id
        and membership.organization_id = v_proposal.organization_id
        and membership.branch_id = v_proposal.branch_id
        and membership.profile_id = v_proposal.target_profile_id
      for update;
      if not found or v_membership.staff_management_version <>
          v_proposal.expected_membership_version then
        raise exception using errcode = '40001',
          message = 'staff membership changed before approval';
      end if;
      if v_proposal.action = 'employment_change' then
        if v_membership.status = 'ended' then
          raise exception using errcode = '40001',
            message = 'ended membership cannot be reactivated here';
        end if;
        update public.memberships membership
        set status = v_proposal.target_membership_status,
            starts_at = v_proposal.starts_on::timestamp at time zone 'Asia/Taipei',
            ends_at = case when v_proposal.ends_on is null then null
              else (v_proposal.ends_on + 1)::timestamp at time zone 'Asia/Taipei' end,
            staff_management_version = membership.staff_management_version + 1,
            updated_at = v_now
        where membership.id = v_membership.id returning * into v_membership;
      else
        if v_membership.status = 'ended' or v_membership.starts_at >= v_now then
          raise exception using errcode = '40001',
            message = 'staff termination target is no longer active';
        end if;
        update public.memberships membership
        set status = 'ended', ends_at = v_now,
            staff_management_version = membership.staff_management_version + 1,
            updated_at = v_now
        where membership.id = v_membership.id returning * into v_membership;
      end if;
    end if;

    select employment.* into v_previous
    from public.staff_employment_versions employment
    where employment.membership_id = v_proposal.target_membership_id
    order by employment.version desc limit 1 for update;
    v_version := coalesce(v_previous.version, 0) + 1;
    v_membership_version := v_membership.staff_management_version;
    insert into public.staff_employment_versions(
      organization_id, branch_id, membership_id, version, previous_version_id,
      membership_version, action, membership_status, starts_on, ends_on,
      employment_type_text, job_title_text, registration_status_text,
      change_reason, source_proposal_id, approved_by, approved_at, content_hash
    ) values (
      v_proposal.organization_id, v_proposal.branch_id,
      v_proposal.target_membership_id, v_version, v_previous.id,
      v_membership_version, v_proposal.action, v_proposal.target_membership_status,
      v_proposal.starts_on,
      case when v_proposal.action = 'terminate'
        then v_proposal.termination_effective_on else v_proposal.ends_on end,
      v_proposal.employment_type_text, v_proposal.job_title_text,
      v_proposal.registration_status_text, v_proposal.change_reason,
      v_proposal.id, v_actor, v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 1, 'proposal_content_hash', v_proposal.content_hash,
        'membership_version', v_membership_version,
        'employment_version', v_version, 'approved_by', v_actor
      )::text, 'UTF8')), 'hex')
    ) returning * into v_employment;

    if v_proposal.action = 'terminate' then
      insert into private.staff_session_revocation_jobs(
        organization_id, branch_id, membership_id, profile_id,
        source_proposal_id, queued_at, deadline_at, content_hash
      ) values (
        v_proposal.organization_id, v_proposal.branch_id,
        v_proposal.target_membership_id, v_proposal.target_profile_id,
        v_proposal.id, v_now, v_now + interval '5 minutes',
        encode(sha256(convert_to(jsonb_build_object(
          'schema_version', 1, 'proposal_id', v_proposal.id,
          'membership_id', v_proposal.target_membership_id,
          'profile_id', v_proposal.target_profile_id,
          'provider_status', 'not_configured',
          'verification_status', 'not_verified', 'queued_at', v_now
        )::text, 'UTF8')), 'hex')
      ) returning * into v_job;
    end if;
  end if;

  update public.staff_management_proposals proposal
  set status = case when v_decision = 'approve' then 'approved' else 'rejected' end,
      decision = v_decision, decision_reason = v_reason,
      decided_by = v_actor, decider_reauth_challenge_id = v_challenge_id,
      decided_at = v_now, decision_idempotency_key = p_idempotency_key,
      decision_hash = v_decision_hash,
      result_employment_version_id = v_employment.id,
      result_membership_version = v_membership_version,
      result_revocation_job_id = v_job.id
  where proposal.id = v_proposal.id returning * into v_proposal;

  return query select v_proposal.organization_id, v_proposal.branch_id,
    v_proposal.id, v_proposal.proposal_number, v_proposal.action,
    v_proposal.decision, v_proposal.status, v_proposal.target_membership_id,
    v_proposal.target_profile_id, v_proposal.result_employment_version_id,
    v_employment.version, v_proposal.result_membership_version,
    v_proposal.result_revocation_job_id, v_job.provider_status,
    v_job.verification_status, v_job.queued_at, v_job.deadline_at,
    v_proposal.content_hash, v_proposal.decided_at, false;
end;
$$;

create or replace function private.request_staff_role_change_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_operation text,
  p_target_membership_id uuid,
  p_target_role_id uuid,
  p_expected_membership_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, request_id uuid, operation text,
  target_membership_id uuid, target_role_id uuid,
  expected_membership_version bigint, request_status text,
  request_hash text, requested_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_operation text;
  v_membership public.memberships%rowtype;
  v_request_id uuid;
  v_status text;
  v_request_hash text;
  v_replayed boolean;
  v_request public.role_governance_requests%rowtype;
  v_companion private.staff_role_request_versions%rowtype;
  v_content_hash text;
begin
  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id, 'roles', false
     ) then
    raise exception using errcode = '42501',
      message = 'staff role request is not permitted';
  end if;
  v_operation := lower(btrim(coalesce(p_operation, '')));
  if v_operation not in ('assign_role', 'revoke_role')
     or p_target_membership_id is null or p_target_role_id is null
     or p_expected_membership_version is null
     or p_expected_membership_version < 1 or p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'valid staff role request fields are required';
  end if;

  select membership.* into v_membership
  from public.memberships membership
  where membership.id = p_target_membership_id
    and membership.organization_id = p_expected_organization_id
    and membership.branch_id = p_expected_branch_id
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'staff role target is outside the selected branch';
  end if;

  -- The Page-81 core retains the authoritative immutable role request and
  -- same-session AAL2 evidence. This companion binds its target to Page-59's
  -- exact membership concurrency version without copying role state.
  select result.request_id, result.status, result.request_hash, result.replayed
    into v_request_id, v_status, v_request_hash, v_replayed
  from private.request_role_governance_change_atomic(
    p_expected_organization_id, p_expected_branch_id, v_operation,
    p_target_role_id, p_target_membership_id, null, null, null, null,
    p_idempotency_key
  ) result;

  select companion.* into v_companion
  from private.staff_role_request_versions companion
  where companion.request_id = v_request_id
  for update;
  if found then
    if v_companion.organization_id <> p_expected_organization_id
       or v_companion.branch_id <> p_expected_branch_id
       or v_companion.target_membership_id <> p_target_membership_id
       or v_companion.expected_membership_version <>
          p_expected_membership_version then
      raise exception using errcode = '23505',
        message = 'staff role request idempotency conflict';
    end if;
  else
    if v_replayed or v_membership.staff_management_version <>
        p_expected_membership_version then
      raise exception using errcode = '40001',
        message = 'staff role request version changed';
    end if;
    v_content_hash := encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1, 'request_id', v_request_id,
      'request_hash', v_request_hash, 'target_membership_id', p_target_membership_id,
      'expected_membership_version', p_expected_membership_version,
      'requested_by', v_actor
    )::text, 'UTF8')), 'hex');
    insert into private.staff_role_request_versions(
      request_id, organization_id, branch_id, target_membership_id,
      expected_membership_version, requested_by, created_at, content_hash
    ) values (
      v_request_id, p_expected_organization_id, p_expected_branch_id,
      p_target_membership_id, p_expected_membership_version, v_actor,
      clock_timestamp(), v_content_hash
    ) returning * into v_companion;
  end if;

  select request.* into v_request from public.role_governance_requests request
  where request.id = v_request_id;
  return query select p_expected_organization_id, p_expected_branch_id,
    v_request_id, v_operation, p_target_membership_id, p_target_role_id,
    p_expected_membership_version, v_status, v_request_hash,
    v_request.requested_at, v_replayed;
end;
$$;

create or replace function private.approve_staff_role_change_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_expected_membership_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, request_id uuid, operation text,
  target_membership_id uuid, target_role_id uuid,
  expected_membership_version bigint, result_membership_version bigint,
  request_status text, applied_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_companion private.staff_role_request_versions%rowtype;
  v_request public.role_governance_requests%rowtype;
  v_membership public.memberships%rowtype;
  v_result_id uuid;
  v_status text;
  v_applied_at timestamptz;
  v_replayed boolean;
begin
  if not private.staff_management_has_manage_authority(
       p_expected_organization_id, p_expected_branch_id, 'roles', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff role approval is not permitted';
  end if;
  if p_request_id is null or p_expected_membership_version is null
     or p_expected_membership_version < 1 or p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'valid staff role approval fields are required';
  end if;

  select companion.* into v_companion
  from private.staff_role_request_versions companion
  where companion.request_id = p_request_id
    and companion.organization_id = p_expected_organization_id
    and companion.branch_id = p_expected_branch_id
  for update;
  if not found or v_companion.expected_membership_version <>
      p_expected_membership_version then
    raise exception using errcode = '42501',
      message = 'staff role request is outside current version scope';
  end if;
  select request.* into v_request from public.role_governance_requests request
  where request.id = p_request_id and request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id
    and request.operation in ('assign_role', 'revoke_role')
    and request.target_membership_id = v_companion.target_membership_id
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'staff role request left the selected branch';
  end if;
  select membership.* into v_membership from public.memberships membership
  where membership.id = v_companion.target_membership_id
    and membership.organization_id = p_expected_organization_id
    and membership.branch_id = p_expected_branch_id
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'staff role membership left the selected branch';
  end if;

  if v_request.status = 'pending'
     and v_membership.staff_management_version <>
       v_companion.expected_membership_version then
    raise exception using errcode = '40001',
      message = 'staff role membership changed before approval';
  end if;

  select result.request_id, result.status, result.applied_at, result.replayed
    into v_result_id, v_status, v_applied_at, v_replayed
  from private.approve_role_governance_change_atomic(
    p_expected_organization_id, p_expected_branch_id, p_request_id,
    p_idempotency_key
  ) result;

  select membership.* into v_membership from public.memberships membership
  where membership.id = v_companion.target_membership_id;
  if v_membership.staff_management_version <>
      v_companion.expected_membership_version + 1 then
    raise exception using errcode = '40001',
      message = 'staff role result membership version is inconsistent';
  end if;

  return query select p_expected_organization_id, p_expected_branch_id,
    v_result_id, v_request.operation, v_companion.target_membership_id,
    v_request.target_role_id, v_companion.expected_membership_version,
    v_membership.staff_management_version, v_status, v_applied_at, v_replayed;
end;
$$;

create or replace function private.staff_management_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_status text,
  p_role_id uuid,
  p_qualification text,
  p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Taipei')::date;
  v_employee_total bigint := 0;
  v_active_total bigint := 0;
  v_ended_total bigint := 0;
  v_disabled_total bigint := 0;
  v_expired_qualification_membership_total bigint := 0;
  v_employees jsonb := '[]'::jsonb;
  v_history_total bigint := 0;
  v_history jsonb := '[]'::jsonb;
  v_proposal_total bigint := 0;
  v_pending_proposal_total bigint := 0;
  v_proposals jsonb := '[]'::jsonb;
  v_role_request_total bigint := 0;
  v_pending_role_request_total bigint := 0;
  v_role_requests jsonb := '[]'::jsonb;
  v_role_option_total bigint := 0;
  v_role_options jsonb := '[]'::jsonb;
  v_profile_option_total bigint := 0;
  v_profile_options jsonb := '[]'::jsonb;
  v_revocation_job_total bigint := 0;
  v_pending_revocation_total bigint := 0;
  v_overdue_revocation_total bigint := 0;
  v_revocation_jobs jsonb := '[]'::jsonb;
begin
  with latest_employment as (
    select distinct on (employment.membership_id) employment.*
    from public.staff_employment_versions employment
    where employment.organization_id = p_expected_organization_id
      and employment.branch_id = p_expected_branch_id
    order by employment.membership_id, employment.version desc
  ), base as (
    select membership.id as membership_id,
      membership.profile_id, membership.staff_management_version,
      membership.status::text as membership_status,
      (membership.starts_at at time zone 'Asia/Taipei')::date as membership_starts_on,
      case when membership.ends_at is null then null else
        (membership.ends_at at time zone 'Asia/Taipei')::date end as membership_ends_on,
      profile.display_name, profile.employee_code, profile.kind::text as profile_kind,
      profile.is_active as profile_is_active,
      employment.id as employment_version_id,
      employment.version as employment_version,
      employment.employment_type_text, employment.job_title_text,
      employment.registration_status_text,
      coalesce(role_data.roles, '[]'::jsonb) as roles,
      coalesce(role_data.role_count, 0) as role_count,
      coalesce(certificate_data.certificate_total, 0) as certificate_total,
      coalesce(certificate_data.expired_total, 0) as expired_certificate_total,
      certificate_data.nearest_expiry,
      job.id as revocation_job_id, job.provider_status,
      job.delivery_status as revocation_delivery_status,
      job.verification_status as revocation_verification_status,
      job.queued_at as revocation_queued_at, job.deadline_at as revocation_deadline_at
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    left join latest_employment employment on employment.membership_id = membership.id
    left join lateral (
      select count(*)::bigint as role_count,
        coalesce(jsonb_agg(jsonb_build_object(
          'role_id', role.id, 'role_key', role.role_key,
          'role_name', role.name
        ) order by role.name collate "C", role.id), '[]'::jsonb) as roles
      from public.membership_roles assignment
      join public.roles role on role.id = assignment.role_id
      where assignment.membership_id = membership.id
    ) role_data on true
    left join lateral (
      with latest as (
        select distinct on (certificate.certificate_key) certificate.*
        from public.staff_certificate_versions certificate
        where certificate.organization_id = p_expected_organization_id
          and certificate.branch_id = p_expected_branch_id
          and certificate.staff_membership_id = membership.id
        order by certificate.certificate_key, certificate.version desc
      )
      select count(*) filter (where record_status = 'active')::bigint
          as certificate_total,
        count(*) filter (where record_status = 'active'
          and expires_on is not null and expires_on < v_today)::bigint
          as expired_total,
        min(expires_on) filter (where record_status = 'active'
          and expires_on is not null) as nearest_expiry
      from latest
    ) certificate_data on true
    left join lateral (
      select revocation.* from private.staff_session_revocation_jobs revocation
      where revocation.membership_id = membership.id
      order by revocation.queued_at desc, revocation.id desc limit 1
    ) job on true
    where membership.organization_id = p_expected_organization_id
      and membership.branch_id = p_expected_branch_id
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
  ), filtered as (
    select base.* from base
    where (p_status = 'all' or base.membership_status = p_status)
      and (p_role_id is null or exists (
        select 1 from jsonb_array_elements(base.roles) role
        where (role ->> 'role_id')::uuid = p_role_id
      ))
      and (p_qualification = 'all'
        or p_qualification = 'not_evaluated'
        or (p_qualification = 'has_expired' and base.expired_certificate_total > 0)
        or (p_qualification = 'no_certificates' and base.certificate_total = 0))
      and (p_search is null
        or base.display_name ilike '%' || p_search || '%'
        or coalesce(base.employee_code, '') ilike '%' || p_search || '%'
        or coalesce(base.job_title_text, '') ilike '%' || p_search || '%'
        or exists (select 1 from jsonb_array_elements(base.roles) role
          where (role ->> 'role_name') ilike '%' || p_search || '%'))
  ), ranked as (
    select filtered.*, row_number() over (
      order by case membership_status when 'active' then 0 when 'invited' then 1
        when 'suspended' then 2 else 3 end,
        display_name collate "C", membership_id
    ) as row_number from filtered
  )
  select count(*)::bigint,
    count(*) filter (where membership_status = 'active' and profile_is_active)::bigint,
    count(*) filter (where membership_status = 'ended')::bigint,
    count(*) filter (where membership_status <> 'active' or not profile_is_active)::bigint,
    count(*) filter (where expired_certificate_total > 0)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'membership_id', membership_id, 'profile_id', profile_id,
      'membership_version', staff_management_version,
      'display_name', display_name, 'employee_code', employee_code,
      'profile_kind', profile_kind, 'profile_is_active', profile_is_active,
      'membership_status', membership_status,
      'membership_starts_on', membership_starts_on,
      'membership_ends_on', membership_ends_on,
      'employment_version_id', employment_version_id,
      'employment_version', employment_version,
      'employment_type_text', employment_type_text,
      'job_title_text', job_title_text,
      'registration_status_text', registration_status_text,
      'employment_governance_status', case when employment_version_id is null
        then 'not_initialized' else 'versioned' end,
      'roles', roles, 'role_count', role_count,
      'certificate_total', certificate_total,
      'expired_certificate_total', expired_certificate_total,
      'nearest_certificate_expiry', nearest_expiry,
      'qualification_evaluation_status', 'not_evaluated',
      'revocation_job_id', revocation_job_id,
      'revocation_provider_status', provider_status,
      'revocation_delivery_status', revocation_delivery_status,
      'revocation_verification_status', revocation_verification_status,
      'revocation_queued_at', revocation_queued_at,
      'revocation_deadline_at', revocation_deadline_at
    ) order by case membership_status when 'active' then 0 when 'invited' then 1
      when 'suspended' then 2 else 3 end,
      display_name collate "C", membership_id)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_employee_total, v_active_total, v_ended_total, v_disabled_total,
    v_expired_qualification_membership_total, v_employees
  from ranked;

  with ranked as (
    select employment.*, profile.display_name as approved_by_display_name,
      row_number() over (order by employment.approved_at desc,
        employment.membership_id, employment.version desc) as row_number
    from public.staff_employment_versions employment
    join public.profiles profile on profile.id = employment.approved_by
    where employment.organization_id = p_expected_organization_id
      and employment.branch_id = p_expected_branch_id
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'employment_version_id', id, 'membership_id', membership_id,
      'version', version, 'previous_version_id', previous_version_id,
      'membership_version', membership_version, 'action', action,
      'membership_status', membership_status, 'starts_on', starts_on,
      'ends_on', ends_on, 'employment_type_text', employment_type_text,
      'job_title_text', job_title_text,
      'registration_status_text', registration_status_text,
      'change_reason', change_reason, 'source_proposal_id', source_proposal_id,
      'approved_by_display_name', approved_by_display_name,
      'approved_at', approved_at, 'content_hash', content_hash
    ) order by approved_at desc, membership_id, version desc)
      filter (where row_number <= 500), '[]'::jsonb)
  into v_history_total, v_history from ranked;

  with ranked as (
    select proposal.*, requester.display_name as requested_by_display_name,
      decider.display_name as decided_by_display_name,
      row_number() over (order by case proposal.status when 'pending' then 0 else 1 end,
        proposal.requested_at desc, proposal.id) as row_number
    from public.staff_management_proposals proposal
    join public.profiles requester on requester.id = proposal.requested_by
    left join public.profiles decider on decider.id = proposal.decided_by
    where proposal.organization_id = p_expected_organization_id
      and proposal.branch_id = p_expected_branch_id
  )
  select count(*)::bigint,
    count(*) filter (where status = 'pending')::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'proposal_id', id, 'proposal_key', proposal_key,
      'proposal_number', proposal_number, 'action', action,
      'target_membership_id', target_membership_id,
      'target_profile_id', target_profile_id,
      'target_display_name', target_display_name_snapshot,
      'target_employee_code', target_employee_code_snapshot,
      'expected_membership_version', expected_membership_version,
      'target_membership_status', target_membership_status,
      'starts_on', starts_on, 'ends_on', ends_on,
      'employment_type_text', employment_type_text,
      'job_title_text', job_title_text,
      'registration_status_text', registration_status_text,
      'termination_effective_on', termination_effective_on,
      'change_reason', change_reason, 'status', status,
      'requested_by', requested_by,
      'requested_by_display_name', requested_by_display_name,
      'requested_at', requested_at, 'content_hash', content_hash,
      'decision', decision, 'decision_reason', decision_reason,
      'decided_by', decided_by, 'decided_by_display_name', decided_by_display_name,
      'decided_at', decided_at,
      'result_employment_version_id', result_employment_version_id,
      'result_membership_version', result_membership_version,
      'result_revocation_job_id', result_revocation_job_id
    ) order by case status when 'pending' then 0 else 1 end,
      requested_at desc, id) filter (where row_number <= 200), '[]'::jsonb)
  into v_proposal_total, v_pending_proposal_total, v_proposals from ranked;

  with ranked as (
    select request.*, companion.expected_membership_version,
      requester.display_name as requested_by_display_name,
      approver.display_name as approved_by_display_name,
      role.role_key as target_role_key, role.name as target_role_name,
      row_number() over (order by case request.status when 'pending' then 0 else 1 end,
        request.requested_at desc, request.id) as row_number
    from private.staff_role_request_versions companion
    join public.role_governance_requests request on request.id = companion.request_id
    join public.roles role on role.id = request.target_role_id
    join public.profiles requester on requester.id = request.requested_by
    left join public.profiles approver on approver.id = request.approved_by
    where companion.organization_id = p_expected_organization_id
      and companion.branch_id = p_expected_branch_id
  )
  select count(*)::bigint,
    count(*) filter (where status = 'pending')::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'request_id', id, 'operation', operation,
      'target_membership_id', target_membership_id,
      'target_role_id', target_role_id, 'role_key', target_role_key,
      'role_name', target_role_name,
      'expected_membership_version', expected_membership_version,
      'status', status, 'requested_by', requested_by,
      'requested_by_display_name', requested_by_display_name,
      'requested_at', requested_at, 'request_hash', request_hash,
      'approved_by', approved_by,
      'approved_by_display_name', approved_by_display_name,
      'approved_at', approved_at, 'applied_at', applied_at
    ) order by case status when 'pending' then 0 else 1 end,
      requested_at desc, id) filter (where row_number <= 200), '[]'::jsonb)
  into v_role_request_total, v_pending_role_request_total, v_role_requests
  from ranked;

  with ranked as (
    select role.*, row_number() over (order by role.name collate "C", role.id)
      as row_number
    from public.roles role
    where role.is_active
      and (role.organization_id is null or role.organization_id = p_expected_organization_id)
      and role.role_key not in ('family', 'platform_ops')
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'role_id', id, 'role_key', role_key, 'role_name', name,
      'is_system', is_system
    ) order by name collate "C", id) filter (where row_number <= 100), '[]'::jsonb)
  into v_role_option_total, v_role_options from ranked;

  -- Global profiles have no organization ownership. Exposing them as
  -- candidates would leak names and employee codes across tenants. The first
  -- release therefore returns no onboarding options until a governed,
  -- organization-scoped candidate source is published.
  v_profile_option_total := 0;
  v_profile_options := '[]'::jsonb;

  with ranked as (
    select job.*, row_number() over (order by job.queued_at desc, job.id)
      as row_number
    from private.staff_session_revocation_jobs job
    where job.organization_id = p_expected_organization_id
      and job.branch_id = p_expected_branch_id
  )
  select count(*)::bigint,
    count(*) filter (where delivery_status = 'queued')::bigint,
    count(*) filter (where verification_status = 'not_verified'
      and deadline_at < p_now)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'job_id', id, 'membership_id', membership_id,
      'profile_id', profile_id, 'source_proposal_id', source_proposal_id,
      'provider_status', provider_status, 'delivery_status', delivery_status,
      'verification_status', verification_status, 'queued_at', queued_at,
      'deadline_at', deadline_at, 'completed_at', completed_at,
      'failed_at', failed_at, 'content_hash', content_hash,
      'sla_status', case when completed_at is not null then 'completed'
        when failed_at is not null then 'failed'
        when deadline_at < p_now then 'overdue_not_verified'
        else 'pending_not_verified' end
    ) order by queued_at desc, id) filter (where row_number <= 200), '[]'::jsonb)
  into v_revocation_job_total, v_pending_revocation_total,
    v_overdue_revocation_total, v_revocation_jobs from ranked;

  return jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_now,
    'snapshot_date', v_today,
    'employees', v_employees,
    'employee_total', v_employee_total,
    'employees_truncated', v_employee_total > 200,
    'active_employee_total', v_active_total,
    'ended_employee_total', v_ended_total,
    'disabled_account_total', v_disabled_total,
    'expired_qualification_membership_total', v_expired_qualification_membership_total,
    'employment_history', v_history,
    'employment_history_total', v_history_total,
    'employment_history_truncated', v_history_total > 500,
    'proposals', v_proposals,
    'proposal_total', v_proposal_total,
    'pending_proposal_total', v_pending_proposal_total,
    'proposals_truncated', v_proposal_total > 200,
    'role_requests', v_role_requests,
    'role_request_total', v_role_request_total,
    'pending_role_request_total', v_pending_role_request_total,
    'role_requests_truncated', v_role_request_total > 200,
    'role_options', v_role_options,
    'role_option_total', v_role_option_total,
    'role_options_truncated', v_role_option_total > 100,
    'profile_options', v_profile_options,
    'profile_option_total', v_profile_option_total,
    'profile_options_truncated', v_profile_option_total > 100
  ) || jsonb_build_object(
    'onboarding_candidate_source_status', 'not_configured',
    'revocation_jobs', v_revocation_jobs,
    'revocation_job_total', v_revocation_job_total,
    'pending_revocation_total', v_pending_revocation_total,
    'overdue_revocation_total', v_overdue_revocation_total,
    'identity_source', 'profiles_memberships',
    'role_source', 'membership_roles_role_governance',
    'qualification_source', 'page72_terminal_projection',
    'employment_taxonomy_status', 'manual_unstandardized',
    'registration_taxonomy_status', 'manual_unstandardized',
    'qualification_reminder_policy_status', 'not_configured',
    'qualification_notice_days', null,
    'expiring_qualification_total', null,
    'restricted_service_policy_status', 'not_configured',
    'qualification_evaluation_status', 'not_evaluated',
    'session_revocation_provider_status', 'not_configured',
    'session_revocation_sla_minutes', 5,
    'session_revocation_verification_status', 'not_verified',
    'recent_aal2_max_age_minutes', 15,
    'full_hr_payroll_scope', 'excluded',
    'attachment_pipeline_status', 'not_configured',
    'export_status', 'disabled',
    'offline_status', 'disabled'
  );
end;
$$;

create or replace function private.staff_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_status text,
  p_role_id uuid,
  p_qualification text,
  p_search text
)
returns table(payload jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_qualification text := lower(btrim(coalesce(p_qualification, 'all')));
  v_search text := nullif(btrim(p_search), '');
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if not private.staff_management_has_read_authority(
       p_expected_organization_id, p_expected_branch_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff management snapshot is not permitted';
  end if;
  if v_status not in ('all', 'invited', 'active', 'suspended', 'ended')
     or v_qualification not in (
       'all', 'has_expired', 'no_certificates', 'not_evaluated'
     )
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023',
      message = 'staff management filters are invalid';
  end if;
  if p_role_id is not null and not exists (
    select 1 from public.roles role where role.id = p_role_id
      and role.is_active
      and (role.organization_id is null
        or role.organization_id = p_expected_organization_id)
  ) then
    raise exception using errcode = '42501',
      message = 'staff role filter is outside current scope';
  end if;

  v_now := clock_timestamp();
  v_bundle := private.staff_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    v_status, p_role_id, v_qualification, v_search
  );
  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_management_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page59_staff_management_v1',
      'generated_at', v_now,
      'status', v_status,
      'role_filter_present', p_role_id is not null,
      'qualification_filter', v_qualification,
      'search_present', v_search is not null,
      'employee_total', v_bundle -> 'employee_total',
      'pending_proposal_total', v_bundle -> 'pending_proposal_total',
      'pending_role_request_total', v_bundle -> 'pending_role_request_total'
    )
  );
  if not private.staff_management_has_read_authority(
       p_expected_organization_id, p_expected_branch_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff management snapshot final verification failed';
  end if;
  v_after := private.staff_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    v_status, p_role_id, v_qualification, v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff management snapshot changed during audit';
  end if;
  return query select v_bundle;
end;
$$;

create or replace function public.submit_staff_management_proposal(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_action text, p_proposal_key uuid, p_target_membership_id uuid,
  p_target_profile_id uuid, p_expected_membership_version bigint,
  p_target_membership_status text, p_starts_on date, p_ends_on date,
  p_employment_type_text text, p_job_title_text text,
  p_registration_status_text text, p_termination_effective_on date,
  p_change_reason text, p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, proposal_id uuid,
  proposal_key uuid, proposal_number bigint, action text,
  proposal_status text, target_membership_id uuid, target_profile_id uuid,
  expected_membership_version bigint, content_hash text,
  requested_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.submit_staff_management_proposal_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_proposal_key, p_target_membership_id, p_target_profile_id,
    p_expected_membership_version, p_target_membership_status,
    p_starts_on, p_ends_on, p_employment_type_text, p_job_title_text,
    p_registration_status_text, p_termination_effective_on,
    p_change_reason, p_idempotency_key
  );
$$;

create or replace function public.decide_staff_management_proposal(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_proposal_id uuid, p_expected_proposal_number bigint,
  p_expected_membership_version bigint, p_expected_content_hash text,
  p_decision text, p_decision_reason text, p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, proposal_id uuid,
  proposal_number bigint, action text, decision text, proposal_status text,
  target_membership_id uuid, target_profile_id uuid,
  result_employment_version_id uuid, result_employment_version integer,
  result_membership_version bigint, result_revocation_job_id uuid,
  revocation_provider_status text, revocation_verification_status text,
  revocation_queued_at timestamptz, revocation_deadline_at timestamptz,
  content_hash text, decided_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.decide_staff_management_proposal_guarded(
    p_expected_organization_id, p_expected_branch_id, p_proposal_id,
    p_expected_proposal_number, p_expected_membership_version,
    p_expected_content_hash, p_decision, p_decision_reason,
    p_idempotency_key
  );
$$;

create or replace function public.request_staff_role_change(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_operation text, p_target_membership_id uuid, p_target_role_id uuid,
  p_expected_membership_version bigint, p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, request_id uuid, operation text,
  target_membership_id uuid, target_role_id uuid,
  expected_membership_version bigint, request_status text,
  request_hash text, requested_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.request_staff_role_change_guarded(
    p_expected_organization_id, p_expected_branch_id, p_operation,
    p_target_membership_id, p_target_role_id,
    p_expected_membership_version, p_idempotency_key
  );
$$;

create or replace function public.approve_staff_role_change(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_request_id uuid, p_expected_membership_version bigint,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, request_id uuid, operation text,
  target_membership_id uuid, target_role_id uuid,
  expected_membership_version bigint, result_membership_version bigint,
  request_status text, applied_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.approve_staff_role_change_guarded(
    p_expected_organization_id, p_expected_branch_id, p_request_id,
    p_expected_membership_version, p_idempotency_key
  );
$$;

create or replace function public.staff_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_status text default 'all',
  p_role_id uuid default null,
  p_qualification text default 'all',
  p_search text default null
)
returns table(payload jsonb)
language sql volatile security invoker set search_path = '' as $$
  select * from private.staff_management_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_status, p_role_id, p_qualification, p_search
  );
$$;

revoke all on function private.staff_management_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_staff_management_proposal()
  from public, anon, authenticated, service_role;
revoke all on function private.bump_staff_management_version_for_role()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_management_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_management_has_read_authority(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_management_has_manage_authority(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.require_staff_management_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_management_snapshot_bundle(
  uuid,uuid,timestamptz,text,uuid,text,text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_management_snapshot_response(
  uuid,uuid,text,uuid,text,text
) from public, anon, authenticated, service_role;
revoke all on function private.submit_staff_management_proposal_guarded(
  uuid,uuid,text,uuid,uuid,uuid,bigint,text,date,date,text,text,text,date,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.decide_staff_management_proposal_guarded(
  uuid,uuid,uuid,bigint,bigint,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.request_staff_role_change_guarded(
  uuid,uuid,text,uuid,uuid,bigint,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.approve_staff_role_change_guarded(
  uuid,uuid,uuid,bigint,uuid
) from public, anon, authenticated, service_role;

revoke all on function public.submit_staff_management_proposal(
  uuid,uuid,text,uuid,uuid,uuid,bigint,text,date,date,text,text,text,date,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.decide_staff_management_proposal(
  uuid,uuid,uuid,bigint,bigint,text,text,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.request_staff_role_change(
  uuid,uuid,text,uuid,uuid,bigint,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.approve_staff_role_change(
  uuid,uuid,uuid,bigint,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.staff_management_snapshot(
  uuid,uuid,text,uuid,text,text
) from public, anon, authenticated, service_role;

grant execute on function private.submit_staff_management_proposal_guarded(
  uuid,uuid,text,uuid,uuid,uuid,bigint,text,date,date,text,text,text,date,text,uuid
) to authenticated;
grant execute on function private.decide_staff_management_proposal_guarded(
  uuid,uuid,uuid,bigint,bigint,text,text,text,uuid
) to authenticated;
grant execute on function private.request_staff_role_change_guarded(
  uuid,uuid,text,uuid,uuid,bigint,uuid
) to authenticated;
grant execute on function private.approve_staff_role_change_guarded(
  uuid,uuid,uuid,bigint,uuid
) to authenticated;
grant execute on function private.staff_management_snapshot_response(
  uuid,uuid,text,uuid,text,text
) to authenticated;

grant execute on function public.submit_staff_management_proposal(
  uuid,uuid,text,uuid,uuid,uuid,bigint,text,date,date,text,text,text,date,text,uuid
) to authenticated;
grant execute on function public.decide_staff_management_proposal(
  uuid,uuid,uuid,bigint,bigint,text,text,text,uuid
) to authenticated;
grant execute on function public.request_staff_role_change(
  uuid,uuid,text,uuid,uuid,bigint,uuid
) to authenticated;
grant execute on function public.approve_staff_role_change(
  uuid,uuid,uuid,bigint,uuid
) to authenticated;
grant execute on function public.staff_management_snapshot(
  uuid,uuid,text,uuid,text,text
) to authenticated;

comment on function public.staff_management_snapshot(uuid,uuid,text,uuid,text,text) is
  'Page-59 snapshot projected from profiles, memberships, membership_roles and Page-72 terminal certificates; every search is minimally audited.';
comment on function public.submit_staff_management_proposal(
  uuid,uuid,text,uuid,uuid,uuid,bigint,text,date,date,text,text,text,date,text,uuid
) is 'Creates an immutable, expected-version staff employment proposal with same-session AAL2 evidence.';
comment on function public.request_staff_role_change(
  uuid,uuid,text,uuid,uuid,bigint,uuid
) is 'Wraps the existing Page-81 authoritative role workflow with a Page-59 membership expected-version binding.';
comment on table private.staff_session_revocation_jobs is
  'Fail-closed termination receipt. Provider is not configured and remote Auth session revocation is not verified.';
