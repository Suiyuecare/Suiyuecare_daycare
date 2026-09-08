-- Page 71: immutable employee training records and institution-owned rules.
--
-- No statutory point threshold, course taxonomy, attachment upload pipeline,
-- retention period or external reporting rule is inferred by this migration.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_training.read', 'Read scoped employee training records and progress', 1),
  ('staff_training.manage', 'Append employee training records and corrections', 2),
  ('staff_training.rules', 'Propose and publish employee training rules', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional', 'driver', 'finance_claims'
  )
  and permission.permission_key = 'staff_training.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('staff_training.manage', 'staff_training.rules')
on conflict (role_id, permission_id) do nothing;

create table public.staff_training_record_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  training_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  staff_membership_id uuid not null references public.memberships(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_display_name text not null,
  staff_employee_code text,
  course_title text not null,
  training_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  course_type text not null,
  hours numeric(18,4) not null,
  credits numeric(18,4),
  provider_name text not null,
  evidence_status text not null,
  attachment_reference text,
  attachment_sha256 text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint staff_training_record_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_training_record_id_scope_key unique (
    id, organization_id, branch_id, training_key
  ),
  constraint staff_training_record_id_branch_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint staff_training_record_chain_key unique (training_key, version),
  constraint staff_training_record_previous_unique unique (previous_version_id),
  constraint staff_training_record_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, training_key)
    references public.staff_training_record_versions(
      id, organization_id, branch_id, training_key
    ) on delete restrict,
  constraint staff_training_record_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null)
      or (version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000))
  ),
  constraint staff_training_record_status_check check (
    record_status in ('active', 'voided')
  ),
  constraint staff_training_record_course_title_check check (
    char_length(course_title) between 1 and 240
    and course_title !~ '[[:cntrl:]]'
  ),
  constraint staff_training_record_course_type_check check (
    char_length(course_type) between 1 and 120
    and course_type !~ '[[:cntrl:]]'
  ),
  constraint staff_training_record_provider_check check (
    char_length(provider_name) between 1 and 200
    and provider_name !~ '[[:cntrl:]]'
  ),
  constraint staff_training_record_staff_snapshot_check check (
    char_length(staff_display_name) between 1 and 120
    and staff_display_name !~ '[[:cntrl:]]'
    and (staff_employee_code is null or (
      char_length(staff_employee_code) between 1 and 120
      and staff_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_training_record_time_check check (
    ends_at > starts_at
    and training_date = (starts_at at time zone 'Asia/Taipei')::date
    and extract(year from training_date) between 2000 and 2200
  ),
  constraint staff_training_record_decimal_check check (
    hours > 0 and hours <= 99999999999999.9999 and scale(hours) <= 4
    and (credits is null or (
      credits >= 0 and credits <= 99999999999999.9999 and scale(credits) <= 4
    ))
  ),
  constraint staff_training_record_evidence_check check (
    evidence_status in ('provided', 'missing', 'not_applicable')
    and (
      (evidence_status = 'provided'
        and char_length(attachment_reference) between 1 and 500
        and attachment_sha256 ~ '^[a-f0-9]{64}$')
      or (evidence_status in ('missing', 'not_applicable')
        and attachment_reference is null and attachment_sha256 is null)
    )
  ),
  constraint staff_training_record_text_check check (
    (correction_reason is null or
      translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (attachment_reference is null or attachment_reference !~ '[[:cntrl:]]')
  ),
  constraint staff_training_record_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_training_rule_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  effective_from date not null,
  effective_to date,
  window_years integer not null,
  required_credits numeric(18,4) not null,
  expiry_notice_days integer not null,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposer_display_name text not null,
  proposer_role_keys text[] not null,
  proposer_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  proposed_at timestamptz not null,
  content_hash text not null,
  constraint staff_training_rule_proposal_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_training_rule_proposal_id_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint staff_training_rule_proposal_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint staff_training_rule_proposal_values_check check (
    window_years between 1 and 50
    and required_credits > 0
    and required_credits <= 99999999999999.9999
    and scale(required_credits) <= 4
    and expiry_notice_days between 0 and 3650
  ),
  constraint staff_training_rule_proposer_check check (
    char_length(proposer_display_name) between 1 and 120
    and proposer_display_name !~ '[[:cntrl:]]'
    and cardinality(proposer_role_keys) between 1 and 64
  ),
  constraint staff_training_rule_proposal_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.staff_training_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  version integer not null,
  proposal_id uuid not null unique,
  effective_from date not null,
  effective_to date,
  window_years integer not null,
  required_credits numeric(18,4) not null,
  expiry_notice_days integer not null,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  publisher_display_name text not null,
  publisher_role_keys text[] not null,
  publisher_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  published_at timestamptz not null,
  content_hash text not null,
  constraint staff_training_rule_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_training_rule_proposal_scope_fkey
    foreign key (proposal_id, organization_id, branch_id)
    references private.staff_training_rule_proposals(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_training_rule_id_scope_key unique (id, organization_id, branch_id),
  constraint staff_training_rule_version_key unique (organization_id, branch_id, version),
  constraint staff_training_rule_distinct_actors_check check (published_by <> proposed_by),
  constraint staff_training_rule_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint staff_training_rule_values_check check (
    version > 0 and window_years between 1 and 50
    and required_credits > 0
    and required_credits <= 99999999999999.9999
    and scale(required_credits) <= 4
    and expiry_notice_days between 0 and 3650
  ),
  constraint staff_training_rule_publisher_check check (
    char_length(publisher_display_name) between 1 and 120
    and publisher_display_name !~ '[[:cntrl:]]'
    and cardinality(publisher_role_keys) between 1 and 64
  ),
  constraint staff_training_rule_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_training_record_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_version_id uuid not null,
  created_at timestamptz not null,
  constraint staff_training_record_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint staff_training_record_operations_result_scope_fkey
    foreign key (result_record_version_id, organization_id, branch_id)
    references public.staff_training_record_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_training_record_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.staff_training_rule_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_proposal_id uuid not null,
  result_rule_version_id uuid,
  created_at timestamptz not null,
  constraint staff_training_rule_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint staff_training_rule_operations_proposal_scope_fkey
    foreign key (result_proposal_id, organization_id, branch_id)
    references private.staff_training_rule_proposals(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_training_rule_operations_rule_scope_fkey
    foreign key (result_rule_version_id, organization_id, branch_id)
    references private.staff_training_rule_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_training_rule_operations_kind_check check (
    (operation_kind = 'propose' and result_rule_version_id is null)
    or (operation_kind = 'publish' and result_rule_version_id is not null)
  ),
  constraint staff_training_rule_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create index staff_training_record_previous_idx
  on public.staff_training_record_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_training_record_membership_idx
  on public.staff_training_record_versions(staff_membership_id);
create index staff_training_record_staff_user_idx
  on public.staff_training_record_versions(staff_user_id);
create index staff_training_record_recorded_by_idx
  on public.staff_training_record_versions(recorded_by);
create index staff_training_record_scope_date_idx
  on public.staff_training_record_versions(
    organization_id, branch_id, training_date desc, training_key, version desc
  );
create index staff_training_rule_proposal_branch_idx
  on private.staff_training_rule_proposals(branch_id, organization_id, effective_from);
create index staff_training_rule_proposal_proposed_by_idx
  on private.staff_training_rule_proposals(proposed_by);
create index staff_training_rule_proposal_reauth_idx
  on private.staff_training_rule_proposals(proposer_reauth_challenge_id);
create index staff_training_rule_branch_idx
  on private.staff_training_rule_versions(branch_id, organization_id, effective_from);
create index staff_training_rule_proposed_by_idx
  on private.staff_training_rule_versions(proposed_by);
create index staff_training_rule_published_by_idx
  on private.staff_training_rule_versions(published_by);
create index staff_training_rule_publisher_reauth_idx
  on private.staff_training_rule_versions(publisher_reauth_challenge_id);
create index staff_training_record_operation_result_idx
  on private.staff_training_record_operations(
    result_record_version_id, organization_id, branch_id
  );
create index staff_training_rule_operation_proposal_idx
  on private.staff_training_rule_operations(
    result_proposal_id, organization_id, branch_id
  );
create index staff_training_rule_operation_rule_idx
  on private.staff_training_rule_operations(
    result_rule_version_id, organization_id, branch_id
  ) where result_rule_version_id is not null;

create or replace function private.staff_training_records_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger staff_training_record_versions_append_only
before update or delete on public.staff_training_record_versions
for each row execute function private.staff_training_records_are_append_only();
create trigger staff_training_rule_proposals_append_only
before update or delete on private.staff_training_rule_proposals
for each row execute function private.staff_training_records_are_append_only();
create trigger staff_training_rule_versions_append_only
before update or delete on private.staff_training_rule_versions
for each row execute function private.staff_training_records_are_append_only();
create trigger staff_training_record_operations_append_only
before update or delete on private.staff_training_record_operations
for each row execute function private.staff_training_records_are_append_only();
create trigger staff_training_rule_operations_append_only
before update or delete on private.staff_training_rule_operations
for each row execute function private.staff_training_records_are_append_only();

create trigger staff_training_record_versions_audit_row_change
after insert on public.staff_training_record_versions
for each row execute function private.audit_row_change();
create trigger staff_training_rule_proposals_audit_row_change
after insert on private.staff_training_rule_proposals
for each row execute function private.audit_row_change();
create trigger staff_training_rule_versions_audit_row_change
after insert on private.staff_training_rule_versions
for each row execute function private.audit_row_change();

comment on table public.staff_training_record_versions is
  'Immutable employee training originals, corrections and void versions addressed by stable membership id.';
comment on table private.staff_training_rule_versions is
  'Institution-owned effective-dated training rules published by a second recent-AAL2 actor.';

create or replace function private.staff_training_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.staff_training_user_has_current_permission(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_user_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where profile.id = p_user_id
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and (role.organization_id is null or role.organization_id = p_expected_organization_id)
      and permission.permission_key = p_permission
  );
$$;

create or replace function private.staff_training_target_is_current(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.id = p_staff_membership_id
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
  );
$$;

create or replace function private.staff_training_can_access_target(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.staff_training_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_training.read'
    )
    and exists (
      select 1
      from public.memberships membership
      where membership.id = p_staff_membership_id
        and membership.organization_id = p_expected_organization_id
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and (
          membership.profile_id = auth.uid()
          or private.has_permission(
            p_expected_organization_id, p_expected_branch_id,
            'staff_training.manage'
          )
        )
    );
$$;

create or replace function private.require_staff_training_reauth_evidence(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current staff training AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current staff training AAL2 evidence is required';
  end;
  if v_session_id is null then
    raise exception using errcode = '42501',
      message = 'current staff training AAL2 evidence is required';
  end if;

  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
   and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor
    and event.session_id = v_session_id
    and event.aal = 'aal2'
    and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of event, challenge;

  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current staff training AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.append_staff_training_record_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_training_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_course_title text,
  p_training_date date,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_course_type text,
  p_hours numeric,
  p_credits numeric,
  p_provider_name text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  training_key uuid,
  record_version_id uuid,
  version integer,
  previous_version_id uuid,
  record_status text,
  staff_membership_id uuid,
  content_hash text,
  recorded_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_now timestamptz;
  v_course_title text := nullif(btrim(p_course_title), '');
  v_course_type text := nullif(btrim(p_course_type), '');
  v_provider_name text := nullif(btrim(p_provider_name), '');
  v_attachment_reference text := nullif(btrim(p_attachment_reference), '');
  v_attachment_sha256 text := lower(nullif(btrim(p_attachment_sha256), ''));
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_request_hash text;
  v_operation private.staff_training_record_operations%rowtype;
  v_previous public.staff_training_record_versions%rowtype;
  v_result public.staff_training_record_versions%rowtype;
  v_staff_user_id uuid;
  v_staff_display_name text;
  v_staff_employee_code text;
  v_version integer;
  v_status text;
  v_content_hash text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_training_key is null or p_staff_membership_id is null
     or p_idempotency_key is null
     or v_action not in ('create', 'correct', 'void')
     or p_expected_base_version is null or p_expected_base_version < 0
     or not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.manage'
     ) then
    raise exception using errcode = '42501',
      message = 'staff training record write is not permitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-training-record-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select membership.profile_id, btrim(profile.display_name),
      nullif(btrim(profile.employee_code), '')
    into v_staff_user_id, v_staff_display_name, v_staff_employee_code
  from public.memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.id = p_staff_membership_id
    and membership.organization_id = p_expected_organization_id
    and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    and membership.status = 'active'
    and membership.starts_at <= clock_timestamp()
    and (membership.ends_at is null or membership.ends_at > clock_timestamp())
    and profile.kind in ('staff', 'professional', 'driver', 'finance')
    and profile.is_active
  for share of membership, profile;

  if v_staff_user_id is null then
    raise exception using errcode = '42501',
      message = 'target employee is not current in this branch';
  end if;

  if v_action = 'create' then
    if p_previous_version_id is not null or p_expected_base_version <> 0
       or v_correction_reason is not null then
      raise exception using errcode = '22023',
        message = 'new staff training record base is invalid';
    end if;
  elsif p_previous_version_id is null or p_expected_base_version < 1
     or v_correction_reason is null
     or char_length(v_correction_reason) > 1000
     or translate(v_correction_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'staff training correction base or reason is invalid';
  end if;

  if v_action in ('create', 'correct') then
    if v_course_title is null or char_length(v_course_title) > 240
       or v_course_title ~ '[[:cntrl:]]'
       or v_course_type is null or char_length(v_course_type) > 120
       or v_course_type ~ '[[:cntrl:]]'
       or v_provider_name is null or char_length(v_provider_name) > 200
       or v_provider_name ~ '[[:cntrl:]]'
       or p_training_date is null
       or extract(year from p_training_date) not between 2000 and 2200
       or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
       or p_training_date <> (p_starts_at at time zone 'Asia/Taipei')::date
       or p_hours is null or p_hours <= 0 or p_hours > 99999999999999.9999
       or scale(p_hours) > 4
       or (p_credits is not null and (
         p_credits < 0 or p_credits > 99999999999999.9999 or scale(p_credits) > 4
       ))
       or p_evidence_status not in ('provided', 'missing', 'not_applicable')
       or (p_evidence_status in ('missing', 'not_applicable') and (
         v_attachment_reference is not null or v_attachment_sha256 is not null
       ))
       or p_evidence_status = 'provided' then
      raise exception using errcode = '22023',
        message = 'staff training content or attachment evidence is invalid';
    end if;
  elsif v_course_title is not null or p_training_date is not null
     or p_starts_at is not null or p_ends_at is not null
     or v_course_type is not null or p_hours is not null or p_credits is not null
     or v_provider_name is not null or p_evidence_status is not null
     or v_attachment_reference is not null or v_attachment_sha256 is not null then
    raise exception using errcode = '22023',
      message = 'void operation must copy immutable prior content';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'training_key', p_training_key,
    'previous_version_id', p_previous_version_id,
    'expected_base_version', p_expected_base_version,
    'staff_membership_id', p_staff_membership_id,
    'course_title', v_course_title,
    'training_date', p_training_date,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'course_type', v_course_type,
    'hours', p_hours,
    'credits', p_credits,
    'provider_name', v_provider_name,
    'evidence_status', p_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_training_record_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;

  if found then
    if v_operation.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'staff training idempotency key reused with different content';
    end if;
    select record.* into v_result
    from public.staff_training_record_versions record
    where record.id = v_operation.result_record_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.training_key = p_training_key
      and record.staff_membership_id = p_staff_membership_id;
    if not found or not private.staff_training_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'staff_training.manage'
       ) or not private.staff_training_target_is_current(
         p_expected_organization_id, p_expected_branch_id, p_staff_membership_id
       ) then
      raise exception using errcode = '42501',
        message = 'staff training replay is no longer permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.training_key, v_result.id, v_result.version,
      v_result.previous_version_id, v_result.record_status,
      v_result.staff_membership_id, v_result.content_hash,
      v_result.recorded_at, true;
    return;
  end if;

  v_now := clock_timestamp();
  if v_action in ('create', 'correct') and p_ends_at > v_now then
    raise exception using errcode = '22023',
      message = 'future training completion cannot be recorded';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-training-record:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_training_key::text,
    0
  ));

  if v_action = 'create' then
    if exists (
      select 1 from public.staff_training_record_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.training_key = p_training_key
    ) then
      raise exception using errcode = '23505',
        message = 'staff training key already exists';
    end if;
    v_version := 1;
    v_status := 'active';
  else
    select record.* into v_previous
    from public.staff_training_record_versions record
    where record.id = p_previous_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.training_key = p_training_key
      and record.staff_membership_id = p_staff_membership_id
    for share;
    if not found or v_previous.version <> p_expected_base_version
       or v_previous.record_status <> 'active'
       or exists (
         select 1 from public.staff_training_record_versions later
         where later.training_key = p_training_key
           and later.version > v_previous.version
       ) then
      raise exception using errcode = '40001',
        message = 'staff training base version is stale';
    end if;
    v_version := v_previous.version + 1;
    v_status := case when v_action = 'void' then 'voided' else 'active' end;
    if v_action = 'void' then
      v_course_title := v_previous.course_title;
      p_training_date := v_previous.training_date;
      p_starts_at := v_previous.starts_at;
      p_ends_at := v_previous.ends_at;
      v_course_type := v_previous.course_type;
      p_hours := v_previous.hours;
      p_credits := v_previous.credits;
      v_provider_name := v_previous.provider_name;
      p_evidence_status := v_previous.evidence_status;
      v_attachment_reference := v_previous.attachment_reference;
      v_attachment_sha256 := v_previous.attachment_sha256;
    end if;
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'training_key', p_training_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_status', v_status,
    'correction_reason', v_correction_reason,
    'staff_membership_id', p_staff_membership_id,
    'staff_user_id', v_staff_user_id,
    'staff_display_name', v_staff_display_name,
    'staff_employee_code', v_staff_employee_code,
    'course_title', v_course_title,
    'training_date', p_training_date,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'course_type', v_course_type,
    'hours', p_hours,
    'credits', p_credits,
    'provider_name', v_provider_name,
    'evidence_status', p_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'recorded_by', v_actor,
    'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.staff_training_record_versions (
    organization_id, branch_id, training_key, version, previous_version_id,
    record_status, correction_reason, staff_membership_id, staff_user_id,
    staff_display_name, staff_employee_code, course_title, training_date,
    starts_at, ends_at, course_type, hours, credits, provider_name,
    evidence_status, attachment_reference, attachment_sha256, recorded_by,
    recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_training_key,
    v_version, p_previous_version_id, v_status, v_correction_reason,
    p_staff_membership_id, v_staff_user_id, v_staff_display_name,
    v_staff_employee_code, v_course_title, p_training_date, p_starts_at,
    p_ends_at, v_course_type, p_hours, p_credits, v_provider_name,
    p_evidence_status, v_attachment_reference, v_attachment_sha256,
    v_actor, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.manage'
     ) or not private.staff_training_target_is_current(
       p_expected_organization_id, p_expected_branch_id, p_staff_membership_id
     ) or not exists (
       select 1 from public.staff_training_record_versions record
       where record.id = v_result.id and record.content_hash = v_content_hash
         and not exists (
           select 1 from public.staff_training_record_versions later
           where later.training_key = record.training_key
             and later.version > record.version
         )
     ) then
    raise exception using errcode = '40001',
      message = 'staff training final verification failed';
  end if;

  insert into private.staff_training_record_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_record_version_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    v_result.training_key, v_result.id, v_result.version,
    v_result.previous_version_id, v_result.record_status,
    v_result.staff_membership_id, v_result.content_hash,
    v_result.recorded_at, false;
end;
$$;

create or replace function private.propose_staff_training_rule_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_window_years integer,
  p_required_credits numeric,
  p_expiry_notice_days integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  action text,
  proposal_id uuid,
  rule_version_id uuid,
  version integer,
  effective_from date,
  effective_to date,
  window_years integer,
  required_credits text,
  expiry_notice_days integer,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_today date;
  v_challenge_id uuid;
  v_display_name text;
  v_role_keys text[];
  v_request_hash text;
  v_content_hash text;
  v_operation private.staff_training_rule_operations%rowtype;
  v_result private.staff_training_rule_proposals%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null
     or not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
     ) then
    raise exception using errcode = '42501',
      message = 'staff training rule proposal is not permitted';
  end if;
  if p_effective_from is null
     or (p_effective_to is not null and p_effective_to < p_effective_from)
     or p_window_years not between 1 and 50
     or p_required_credits is null or p_required_credits <= 0
     or p_required_credits > 99999999999999.9999
     or scale(p_required_credits) > 4
     or p_expiry_notice_days not between 0 and 3650 then
    raise exception using errcode = '22023',
      message = 'staff training rule proposal is invalid';
  end if;

  v_now := clock_timestamp();
  v_challenge_id := private.require_staff_training_reauth_evidence(v_actor, v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-training-rule-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', 'propose',
    'effective_from', p_effective_from,
    'effective_to', p_effective_to,
    'window_years', p_window_years,
    'required_credits', p_required_credits,
    'expiry_notice_days', p_expiry_notice_days
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_training_rule_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash
       or v_operation.operation_kind <> 'propose' then
      raise exception using errcode = '23505',
        message = 'staff training rule key reused with different content';
    end if;
    select proposal.* into v_result
    from private.staff_training_rule_proposals proposal
    where proposal.id = v_operation.result_proposal_id
      and proposal.organization_id = p_expected_organization_id
      and proposal.branch_id = p_expected_branch_id;
    if not found or not private.staff_training_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
       ) then
      raise exception using errcode = '42501',
        message = 'staff training rule replay is no longer permitted';
    end if;
    perform private.require_staff_training_reauth_evidence(v_actor, clock_timestamp());
    return query select v_result.organization_id, v_result.branch_id,
      'propose'::text, v_result.id, null::uuid, null::integer,
      v_result.effective_from, v_result.effective_to, v_result.window_years,
      v_result.required_credits::text, v_result.expiry_notice_days,
      v_result.proposed_at, true;
    return;
  end if;

  v_today := (v_now at time zone 'Asia/Taipei')::date;
  if p_effective_from < v_today then
    raise exception using errcode = '22023',
      message = 'staff training rule cannot be proposed retroactively';
  end if;

  select btrim(profile.display_name),
      array_agg(distinct role.role_key order by role.role_key)
    into v_display_name, v_role_keys
  from public.profiles profile
  join public.memberships membership on membership.profile_id = profile.id
  join public.membership_roles membership_role
    on membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id and role.is_active
  join public.role_permissions role_permission on role_permission.role_id = role.id
  join public.permissions permission on permission.id = role_permission.permission_id
  where profile.id = v_actor
    and profile.is_active
    and membership.organization_id = p_expected_organization_id
    and membership.status = 'active'
    and membership.starts_at <= v_now
    and (membership.ends_at is null or membership.ends_at > v_now)
    and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    and (role.organization_id is null or role.organization_id = p_expected_organization_id)
    and permission.permission_key = 'staff_training.rules'
  group by profile.display_name;
  if v_display_name is null or coalesce(cardinality(v_role_keys), 0) = 0 then
    raise exception using errcode = '42501',
      message = 'staff training rule proposer identity is unavailable';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'effective_from', p_effective_from,
    'effective_to', p_effective_to,
    'window_years', p_window_years,
    'required_credits', p_required_credits,
    'expiry_notice_days', p_expiry_notice_days,
    'proposed_by', v_actor,
    'proposer_display_name', v_display_name,
    'proposer_role_keys', v_role_keys,
    'proposer_reauth_challenge_id', v_challenge_id,
    'proposed_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into private.staff_training_rule_proposals (
    organization_id, branch_id, effective_from, effective_to, window_years,
    required_credits, expiry_notice_days, proposed_by, proposer_display_name,
    proposer_role_keys, proposer_reauth_challenge_id, proposed_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_effective_from,
    p_effective_to, p_window_years, p_required_credits, p_expiry_notice_days,
    v_actor, v_display_name, v_role_keys, v_challenge_id, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
     ) or private.require_staff_training_reauth_evidence(
       v_actor, clock_timestamp()
     ) is null then
    raise exception using errcode = '42501',
      message = 'staff training rule proposal final verification failed';
  end if;

  insert into private.staff_training_rule_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_proposal_id,
    result_rule_version_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'propose', v_request_hash, v_result.id, null, v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    'propose'::text, v_result.id, null::uuid, null::integer,
    v_result.effective_from, v_result.effective_to, v_result.window_years,
    v_result.required_credits::text, v_result.expiry_notice_days,
    v_result.proposed_at, false;
end;
$$;

create or replace function private.publish_staff_training_rule_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_proposal_id uuid,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  action text,
  proposal_id uuid,
  rule_version_id uuid,
  version integer,
  effective_from date,
  effective_to date,
  window_years integer,
  required_credits text,
  expiry_notice_days integer,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_today date;
  v_challenge_id uuid;
  v_display_name text;
  v_role_keys text[];
  v_request_hash text;
  v_content_hash text;
  v_operation private.staff_training_rule_operations%rowtype;
  v_proposal private.staff_training_rule_proposals%rowtype;
  v_result private.staff_training_rule_versions%rowtype;
  v_version integer;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_proposal_id is null or p_idempotency_key is null
     or not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
     ) then
    raise exception using errcode = '42501',
      message = 'staff training rule publication is not permitted';
  end if;
  v_now := clock_timestamp();
  v_challenge_id := private.require_staff_training_reauth_evidence(v_actor, v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-training-rule-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', 'publish',
    'proposal_id', p_proposal_id
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_training_rule_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash
       or v_operation.operation_kind <> 'publish' then
      raise exception using errcode = '23505',
        message = 'staff training rule key reused with different content';
    end if;
    select rule.* into v_result
    from private.staff_training_rule_versions rule
    where rule.id = v_operation.result_rule_version_id
      and rule.proposal_id = p_proposal_id
      and rule.organization_id = p_expected_organization_id
      and rule.branch_id = p_expected_branch_id;
    if not found or not private.staff_training_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
       ) then
      raise exception using errcode = '42501',
        message = 'staff training rule replay is no longer permitted';
    end if;
    perform private.require_staff_training_reauth_evidence(v_actor, clock_timestamp());
    return query select v_result.organization_id, v_result.branch_id,
      'publish'::text, v_result.proposal_id, v_result.id, v_result.version,
      v_result.effective_from, v_result.effective_to, v_result.window_years,
      v_result.required_credits::text, v_result.expiry_notice_days,
      v_result.published_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-training-rules:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text,
    0
  ));
  select proposal.* into v_proposal
  from private.staff_training_rule_proposals proposal
  where proposal.id = p_proposal_id
    and proposal.organization_id = p_expected_organization_id
    and proposal.branch_id = p_expected_branch_id
  for share;
  if not found or v_proposal.proposed_by = v_actor
     or exists (
       select 1 from private.staff_training_rule_versions rule
       where rule.proposal_id = p_proposal_id
     )
     or not private.staff_training_user_has_current_permission(
       p_expected_organization_id, p_expected_branch_id,
       v_proposal.proposed_by, 'staff_training.rules'
     ) then
    raise exception using errcode = '42501',
      message = 'staff training rule requires a distinct current approver';
  end if;

  v_today := (v_now at time zone 'Asia/Taipei')::date;
  if v_proposal.effective_from < v_today then
    raise exception using errcode = '22023',
      message = 'staff training rule cannot be published retroactively';
  end if;
  if exists (
    select 1 from private.staff_training_rule_versions rule
    where rule.organization_id = p_expected_organization_id
      and rule.branch_id = p_expected_branch_id
      and daterange(
        rule.effective_from,
        coalesce(rule.effective_to + 1, 'infinity'::date), '[)'
      ) && daterange(
        v_proposal.effective_from,
        coalesce(v_proposal.effective_to + 1, 'infinity'::date), '[)'
      )
  ) then
    raise exception using errcode = '23514',
      message = 'staff training rule effective periods overlap';
  end if;

  select btrim(profile.display_name),
      array_agg(distinct role.role_key order by role.role_key)
    into v_display_name, v_role_keys
  from public.profiles profile
  join public.memberships membership on membership.profile_id = profile.id
  join public.membership_roles membership_role
    on membership_role.membership_id = membership.id
  join public.roles role on role.id = membership_role.role_id and role.is_active
  join public.role_permissions role_permission on role_permission.role_id = role.id
  join public.permissions permission on permission.id = role_permission.permission_id
  where profile.id = v_actor
    and profile.is_active
    and membership.organization_id = p_expected_organization_id
    and membership.status = 'active'
    and membership.starts_at <= v_now
    and (membership.ends_at is null or membership.ends_at > v_now)
    and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    and (role.organization_id is null or role.organization_id = p_expected_organization_id)
    and permission.permission_key = 'staff_training.rules'
  group by profile.display_name;
  if v_display_name is null or coalesce(cardinality(v_role_keys), 0) = 0 then
    raise exception using errcode = '42501',
      message = 'staff training rule publisher identity is unavailable';
  end if;

  select coalesce(max(rule.version), 0) + 1 into v_version
  from private.staff_training_rule_versions rule
  where rule.organization_id = p_expected_organization_id
    and rule.branch_id = p_expected_branch_id;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'version', v_version,
    'proposal_id', v_proposal.id,
    'effective_from', v_proposal.effective_from,
    'effective_to', v_proposal.effective_to,
    'window_years', v_proposal.window_years,
    'required_credits', v_proposal.required_credits,
    'expiry_notice_days', v_proposal.expiry_notice_days,
    'proposed_by', v_proposal.proposed_by,
    'published_by', v_actor,
    'publisher_display_name', v_display_name,
    'publisher_role_keys', v_role_keys,
    'publisher_reauth_challenge_id', v_challenge_id,
    'published_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into private.staff_training_rule_versions (
    organization_id, branch_id, version, proposal_id, effective_from,
    effective_to, window_years, required_credits, expiry_notice_days,
    proposed_by, published_by, publisher_display_name, publisher_role_keys,
    publisher_reauth_challenge_id, published_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_version,
    v_proposal.id, v_proposal.effective_from, v_proposal.effective_to,
    v_proposal.window_years, v_proposal.required_credits,
    v_proposal.expiry_notice_days, v_proposal.proposed_by, v_actor,
    v_display_name, v_role_keys, v_challenge_id, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
     ) or not private.staff_training_user_has_current_permission(
       p_expected_organization_id, p_expected_branch_id,
       v_proposal.proposed_by, 'staff_training.rules'
     ) or private.require_staff_training_reauth_evidence(
       v_actor, clock_timestamp()
     ) is null then
    raise exception using errcode = '42501',
      message = 'staff training rule publication final verification failed';
  end if;

  insert into private.staff_training_rule_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_proposal_id,
    result_rule_version_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'publish', v_request_hash, v_result.proposal_id,
    v_result.id, v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    'publish'::text, v_result.proposal_id, v_result.id, v_result.version,
    v_result.effective_from, v_result.effective_to, v_result.window_years,
    v_result.required_credits::text, v_result.expiry_notice_days,
    v_result.published_at, false;
end;
$$;

create or replace function private.staff_training_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_date_from date,
  p_date_to date,
  p_staff_membership_id uuid,
  p_course_type text,
  p_status text,
  p_search text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot_date date := (p_now at time zone 'Asia/Taipei')::date;
  v_course_type text := nullif(btrim(p_course_type), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_search text := lower(nullif(btrim(p_search), ''));
  v_rule private.staff_training_rule_versions%rowtype;
  v_policy_status text := 'not_configured';
  v_records jsonb := '[]'::jsonb;
  v_record_total bigint := 0;
  v_hours_total text := '0.0000';
  v_credits_total text;
  v_credited_record_total bigint := 0;
  v_missing_credit_total bigint := 0;
  v_missing_evidence_total bigint := 0;
  v_expiring_total bigint;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_course_types jsonb := '[]'::jsonb;
  v_course_type_total bigint := 0;
  v_progress jsonb := '[]'::jsonb;
  v_progress_total bigint := 0;
  v_gap_staff_total bigint;
  v_indeterminate_staff_total bigint;
  v_pending_proposals jsonb := '[]'::jsonb;
  v_pending_proposal_total bigint := 0;
begin
  select rule.* into v_rule
  from private.staff_training_rule_versions rule
  where rule.organization_id = p_expected_organization_id
    and rule.branch_id = p_expected_branch_id
    and rule.effective_from <= v_snapshot_date
    and (rule.effective_to is null or rule.effective_to >= v_snapshot_date)
  order by rule.version desc
  limit 1;
  if found then
    v_policy_status := 'published';
  end if;

  with latest as (
    select distinct on (record.training_key) record.*
    from public.staff_training_record_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_training_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.training_key, record.version desc
  ), derived as (
    select latest.*,
      case when v_policy_status = 'published' and latest.credits is not null
        then (latest.training_date + make_interval(years => v_rule.window_years))::date
        else null::date end as credit_expires_on,
      case when v_policy_status = 'published' and latest.credits is not null
        then (latest.training_date + make_interval(years => v_rule.window_years))::date
          > v_snapshot_date
          and (latest.training_date + make_interval(years => v_rule.window_years))::date
            <= v_snapshot_date + v_rule.expiry_notice_days
        else null::boolean end as is_expiring
    from latest
  ), filtered as (
    select derived.*, profile.display_name as recorded_by_display_name
    from derived
    left join public.profiles profile on profile.id = derived.recorded_by
    where (p_date_from is null or derived.training_date >= p_date_from)
      and (p_date_to is null or derived.training_date <= p_date_to)
      and (p_staff_membership_id is null
        or derived.staff_membership_id = p_staff_membership_id)
      and (v_course_type is null or derived.course_type = v_course_type)
      and (
        v_status = 'all'
        or (v_status = 'active' and derived.record_status = 'active')
        or (v_status = 'voided' and derived.record_status = 'voided')
        or (v_status = 'missing_evidence'
          and derived.record_status = 'active'
          and derived.evidence_status = 'missing')
        or (v_status = 'expiring' and derived.record_status = 'active'
          and derived.is_expiring is true)
      )
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        derived.staff_display_name, derived.staff_employee_code,
        derived.course_title, derived.course_type, derived.provider_name
      ))) > 0)
  ), ranked as (
    select filtered.*,
      row_number() over (
        order by training_date desc, starts_at desc, training_key, version desc
      ) as row_number
    from filtered
  )
  select count(*)::bigint,
      coalesce(sum(hours) filter (where record_status = 'active'), 0)::text,
      case when count(credits) filter (where record_status = 'active') = 0
        then null
        else sum(credits) filter (where record_status = 'active')::text
      end,
      count(credits) filter (where record_status = 'active')::bigint,
      count(*) filter (
        where record_status = 'active' and credits is null
      )::bigint,
      count(*) filter (
        where record_status = 'active' and evidence_status = 'missing'
      )::bigint,
      case when v_policy_status = 'published' then
        count(*) filter (
          where record_status = 'active' and is_expiring is true
        )::bigint
      else null::bigint end,
      coalesce(jsonb_agg(jsonb_build_object(
        'record_version_id', id,
        'training_key', training_key,
        'version', version,
        'previous_version_id', previous_version_id,
        'record_status', record_status,
        'correction_reason', correction_reason,
        'staff_membership_id', staff_membership_id,
        'staff_user_id', staff_user_id,
        'staff_display_name', staff_display_name,
        'staff_employee_code', staff_employee_code,
        'course_title', course_title,
        'training_date', training_date,
        'starts_at', starts_at,
        'ends_at', ends_at,
        'course_type', course_type,
        'hours', hours::text,
        'credits', credits::text,
        'provider_name', provider_name,
        'evidence_status', evidence_status,
        'credit_expires_on', credit_expires_on,
        'is_expiring', is_expiring,
        'recorded_by', recorded_by,
        'recorded_by_display_name', coalesce(recorded_by_display_name, '已停用帳號'),
        'recorded_at', recorded_at,
        'content_hash', content_hash
      ) order by training_date desc, starts_at desc, training_key, version desc)
        filter (where row_number <= 200), '[]'::jsonb)
    into v_record_total, v_hours_total, v_credits_total,
      v_credited_record_total, v_missing_credit_total,
      v_missing_evidence_total, v_expiring_total, v_records
  from ranked;

  with latest as (
    select distinct on (record.training_key) record.*
    from public.staff_training_record_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_training_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.training_key, record.version desc
  ), candidates as (
    select membership.id as staff_membership_id,
      membership.profile_id as staff_user_id,
      btrim(profile.display_name) as display_name,
      nullif(btrim(profile.employee_code), '') as employee_code,
      true as is_current, 1 as precedence
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= p_now
      and (membership.ends_at is null or membership.ends_at > p_now)
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and private.staff_training_can_access_target(
        p_expected_organization_id, p_expected_branch_id, membership.id
      )
    union all
    select latest.staff_membership_id, latest.staff_user_id,
      latest.staff_display_name, latest.staff_employee_code,
      false, 2
    from latest
  ), unique_staff as (
    select distinct on (staff_membership_id) *
    from candidates
    order by staff_membership_id, precedence
  ), ranked as (
    select unique_staff.*,
      row_number() over (
        order by display_name collate "C", staff_membership_id
      ) as row_number
    from unique_staff
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'display_name', display_name,
      'employee_code', employee_code,
      'is_current', is_current
    ) order by display_name collate "C", staff_membership_id)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_staff_total, v_staff_options
  from ranked;

  with latest as (
    select distinct on (record.training_key) record.*
    from public.staff_training_record_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_training_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.training_key, record.version desc
  ), types as (
    select course_type, count(*)::bigint as record_count
    from latest
    group by course_type
  ), ranked as (
    select types.*,
      row_number() over (order by course_type collate "C") as row_number
    from types
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'course_type', course_type, 'record_count', record_count
    ) order by course_type collate "C") filter (where row_number <= 200), '[]'::jsonb)
  into v_course_type_total, v_course_types
  from ranked;

  with current_staff as (
    select membership.id as staff_membership_id,
      membership.profile_id as staff_user_id,
      btrim(profile.display_name) as display_name,
      nullif(btrim(profile.employee_code), '') as employee_code
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= p_now
      and (membership.ends_at is null or membership.ends_at > p_now)
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and (p_staff_membership_id is null or membership.id = p_staff_membership_id)
      and private.staff_training_can_access_target(
        p_expected_organization_id, p_expected_branch_id, membership.id
      )
  ), latest as (
    select distinct on (record.training_key) record.*
    from public.staff_training_record_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
    order by record.training_key, record.version desc
  ), progress_source as (
    select staff.*,
      count(latest.id) filter (where latest.record_status = 'active')::bigint
        as active_record_count,
      coalesce(sum(latest.credits) filter (
        where latest.record_status = 'active' and latest.credits is not null
      ), 0)::numeric as known_credits,
      count(*) filter (
        where latest.record_status = 'active' and latest.credits is null
          and latest.id is not null
      )::bigint as missing_credit_count
    from current_staff staff
    left join latest on latest.staff_membership_id = staff.staff_membership_id
      and v_policy_status = 'published'
      and latest.training_date >= (
        v_snapshot_date - make_interval(years => v_rule.window_years)
      )::date
      and latest.training_date <= v_snapshot_date
    group by staff.staff_membership_id, staff.staff_user_id,
      staff.display_name, staff.employee_code
  ), progress_derived as (
    select progress_source.*,
      case
        when v_policy_status <> 'published' then 'not_configured'
        when missing_credit_count > 0 then 'indeterminate'
        when known_credits >= v_rule.required_credits then 'complete'
        else 'incomplete'
      end as progress_status,
      case when v_policy_status = 'published' and missing_credit_count = 0
        then greatest(v_rule.required_credits - known_credits, 0)::text
        else null::text end as credit_gap
    from progress_source
  ), ranked as (
    select progress_derived.*,
      row_number() over (
        order by display_name collate "C", staff_membership_id
      ) as row_number
    from progress_derived
  )
  select count(*)::bigint,
    case when v_policy_status = 'published' then
      count(*) filter (where progress_status = 'incomplete')::bigint
      else null::bigint end,
    case when v_policy_status = 'published' then
      count(*) filter (where progress_status = 'indeterminate')::bigint
      else null::bigint end,
    coalesce(jsonb_agg(jsonb_build_object(
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'display_name', display_name,
      'employee_code', employee_code,
      'active_record_count', active_record_count,
      'known_credits', case when v_policy_status = 'published'
        then known_credits::text else null end,
      'missing_credit_count', case when v_policy_status = 'published'
        then missing_credit_count else null end,
      'required_credits', case when v_policy_status = 'published'
        then v_rule.required_credits::text else null end,
      'credit_gap', credit_gap,
      'progress_status', progress_status,
      'window_start', case when v_policy_status = 'published'
        then (v_snapshot_date - make_interval(years => v_rule.window_years))::date
        else null end,
      'window_end', case when v_policy_status = 'published'
        then v_snapshot_date else null end,
      'rule_version', case when v_policy_status = 'published'
        then v_rule.version else null end
    ) order by display_name collate "C", staff_membership_id)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_progress_total, v_gap_staff_total,
    v_indeterminate_staff_total, v_progress
  from ranked;

  if private.has_permission(
    p_expected_organization_id, p_expected_branch_id, 'staff_training.rules'
  ) then
    with pending as (
      select proposal.*,
        row_number() over (
          order by proposal.proposed_at desc, proposal.id
        ) as row_number
      from private.staff_training_rule_proposals proposal
      where proposal.organization_id = p_expected_organization_id
        and proposal.branch_id = p_expected_branch_id
        and not exists (
          select 1 from private.staff_training_rule_versions rule
          where rule.proposal_id = proposal.id
        )
    )
    select count(*)::bigint,
      coalesce(jsonb_agg(jsonb_build_object(
        'proposal_id', id,
        'effective_from', effective_from,
        'effective_to', effective_to,
        'window_years', window_years,
        'required_credits', required_credits::text,
        'expiry_notice_days', expiry_notice_days,
        'proposed_by', proposed_by,
        'proposer_display_name', proposer_display_name,
        'proposed_at', proposed_at,
        'content_hash', content_hash
      ) order by proposed_at desc, id) filter (where row_number <= 200), '[]'::jsonb)
    into v_pending_proposal_total, v_pending_proposals
    from pending;
  end if;

  return jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_now,
    'snapshot_date', v_snapshot_date,
    'policy_status', v_policy_status,
    'rule_version_id', case when v_policy_status = 'published' then v_rule.id else null end,
    'rule_version', case when v_policy_status = 'published' then v_rule.version else null end,
    'rule_effective_from', case when v_policy_status = 'published' then v_rule.effective_from else null end,
    'rule_effective_to', case when v_policy_status = 'published' then v_rule.effective_to else null end,
    'window_years', case when v_policy_status = 'published' then v_rule.window_years else null end,
    'required_credits', case when v_policy_status = 'published' then v_rule.required_credits::text else null end,
    'expiry_notice_days', case when v_policy_status = 'published' then v_rule.expiry_notice_days else null end,
    'records', v_records,
    'record_total', v_record_total,
    'records_truncated', v_record_total > 200,
    'hours_total', v_hours_total,
    'credits_total', v_credits_total,
    'credited_record_total', v_credited_record_total,
    'missing_credit_total', v_missing_credit_total,
    'missing_evidence_total', v_missing_evidence_total,
    'expiring_total', v_expiring_total,
    'staff_options', v_staff_options,
    'staff_total', v_staff_total,
    'staff_truncated', v_staff_total > 200,
    'course_type_options', v_course_types,
    'course_type_total', v_course_type_total,
    'course_types_truncated', v_course_type_total > 200,
    'staff_progress', v_progress,
    'progress_total', v_progress_total,
    'progress_truncated', v_progress_total > 200,
    'gap_staff_total', v_gap_staff_total,
    'indeterminate_staff_total', v_indeterminate_staff_total,
    'pending_rule_proposals', v_pending_proposals,
    'pending_rule_proposal_total', v_pending_proposal_total,
    'pending_rule_proposals_truncated', v_pending_proposal_total > 200,
    'attachment_pipeline_status', 'not_configured',
    'attachment_scan_status', 'not_configured',
    'external_reporting', 'not_implemented',
    'progress_scope', 'published_rule_window_all_course_types'
  );
end;
$$;

create or replace function private.staff_training_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_staff_membership_id uuid,
  p_course_type text,
  p_status text,
  p_search text
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  snapshot_date date,
  policy_status text,
  rule_version_id uuid,
  rule_version integer,
  rule_effective_from date,
  rule_effective_to date,
  window_years integer,
  required_credits text,
  expiry_notice_days integer,
  records jsonb,
  record_total bigint,
  records_truncated boolean,
  hours_total text,
  credits_total text,
  credited_record_total bigint,
  missing_credit_total bigint,
  missing_evidence_total bigint,
  expiring_total bigint,
  staff_options jsonb,
  staff_total bigint,
  staff_truncated boolean,
  course_type_options jsonb,
  course_type_total bigint,
  course_types_truncated boolean,
  staff_progress jsonb,
  progress_total bigint,
  progress_truncated boolean,
  gap_staff_total bigint,
  indeterminate_staff_total bigint,
  pending_rule_proposals jsonb,
  pending_rule_proposal_total bigint,
  pending_rule_proposals_truncated boolean,
  attachment_pipeline_status text,
  attachment_scan_status text,
  external_reporting text,
  progress_scope text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_course_type text := nullif(btrim(p_course_type), '');
  v_search text := nullif(btrim(p_search), '');
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or (p_date_from is not null and p_date_to is not null
       and p_date_from > p_date_to)
     or v_status not in (
       'all', 'active', 'voided', 'missing_evidence', 'expiring'
     )
     or (v_course_type is not null and (
       char_length(v_course_type) > 120 or v_course_type ~ '[[:cntrl:]]'
     ))
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]'
     ))
     or not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff training snapshot is not permitted';
  end if;
  if p_staff_membership_id is not null and not private.staff_training_can_access_target(
    p_expected_organization_id, p_expected_branch_id, p_staff_membership_id
  ) then
    raise exception using errcode = '42501',
      message = 'staff training target is outside current scope';
  end if;

  v_now := clock_timestamp();
  v_bundle := private.staff_training_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_date_from, p_date_to, p_staff_membership_id,
    v_course_type, v_status, v_search
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_training_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page71_staff_training_v1',
      'generated_at', v_now,
      'date_filter_present', p_date_from is not null or p_date_to is not null,
      'staff_filter_present', p_staff_membership_id is not null,
      'course_type_filter_present', v_course_type is not null,
      'status', v_status,
      'search_present', v_search is not null,
      'record_total', v_bundle -> 'record_total',
      'progress_total', v_bundle -> 'progress_total'
    )
  );

  if not private.staff_training_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_training.read'
     ) or (p_staff_membership_id is not null and not
       private.staff_training_can_access_target(
         p_expected_organization_id, p_expected_branch_id,
         p_staff_membership_id
       )) then
    raise exception using errcode = '42501',
      message = 'staff training snapshot final verification failed';
  end if;
  v_after := private.staff_training_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_date_from, p_date_to, p_staff_membership_id,
    v_course_type, v_status, v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff training snapshot changed during audit';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle ->> 'policy_status',
    (v_bundle ->> 'rule_version_id')::uuid,
    (v_bundle ->> 'rule_version')::integer,
    (v_bundle ->> 'rule_effective_from')::date,
    (v_bundle ->> 'rule_effective_to')::date,
    (v_bundle ->> 'window_years')::integer,
    v_bundle ->> 'required_credits',
    (v_bundle ->> 'expiry_notice_days')::integer,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    v_bundle ->> 'hours_total',
    v_bundle ->> 'credits_total',
    (v_bundle ->> 'credited_record_total')::bigint,
    (v_bundle ->> 'missing_credit_total')::bigint,
    (v_bundle ->> 'missing_evidence_total')::bigint,
    (v_bundle ->> 'expiring_total')::bigint,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'course_type_options',
    (v_bundle ->> 'course_type_total')::bigint,
    (v_bundle ->> 'course_types_truncated')::boolean,
    v_bundle -> 'staff_progress',
    (v_bundle ->> 'progress_total')::bigint,
    (v_bundle ->> 'progress_truncated')::boolean,
    (v_bundle ->> 'gap_staff_total')::bigint,
    (v_bundle ->> 'indeterminate_staff_total')::bigint,
    v_bundle -> 'pending_rule_proposals',
    (v_bundle ->> 'pending_rule_proposal_total')::bigint,
    (v_bundle ->> 'pending_rule_proposals_truncated')::boolean,
    v_bundle ->> 'attachment_pipeline_status',
    v_bundle ->> 'attachment_scan_status',
    v_bundle ->> 'external_reporting',
    v_bundle ->> 'progress_scope';
end;
$$;

create or replace function public.append_staff_training_record(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_training_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_course_title text,
  p_training_date date,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_course_type text,
  p_hours numeric,
  p_credits numeric,
  p_provider_name text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, training_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  recorded_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_staff_training_record_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_training_key, p_previous_version_id, p_expected_base_version,
    p_staff_membership_id, p_course_title, p_training_date, p_starts_at,
    p_ends_at, p_course_type, p_hours, p_credits, p_provider_name,
    p_evidence_status, p_attachment_reference, p_attachment_sha256,
    p_correction_reason, p_idempotency_key
  );
$$;

create or replace function public.propose_staff_training_rule(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_window_years integer,
  p_required_credits numeric,
  p_expiry_notice_days integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, action text, proposal_id uuid,
  rule_version_id uuid, version integer, effective_from date,
  effective_to date, window_years integer, required_credits text,
  expiry_notice_days integer, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.propose_staff_training_rule_guarded(
    p_expected_organization_id, p_expected_branch_id, p_effective_from,
    p_effective_to, p_window_years, p_required_credits,
    p_expiry_notice_days, p_idempotency_key
  );
$$;

create or replace function public.publish_staff_training_rule(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_proposal_id uuid,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, action text, proposal_id uuid,
  rule_version_id uuid, version integer, effective_from date,
  effective_to date, window_years integer, required_credits text,
  expiry_notice_days integer, committed_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.publish_staff_training_rule_guarded(
    p_expected_organization_id, p_expected_branch_id,
    p_proposal_id, p_idempotency_key
  );
$$;

create or replace function public.staff_training_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_staff_membership_id uuid default null,
  p_course_type text default null,
  p_status text default 'all',
  p_search text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, policy_status text, rule_version_id uuid,
  rule_version integer, rule_effective_from date, rule_effective_to date,
  window_years integer, required_credits text, expiry_notice_days integer,
  records jsonb, record_total bigint, records_truncated boolean,
  hours_total text, credits_total text, credited_record_total bigint,
  missing_credit_total bigint, missing_evidence_total bigint,
  expiring_total bigint, staff_options jsonb, staff_total bigint,
  staff_truncated boolean, course_type_options jsonb,
  course_type_total bigint, course_types_truncated boolean,
  staff_progress jsonb, progress_total bigint, progress_truncated boolean,
  gap_staff_total bigint, indeterminate_staff_total bigint,
  pending_rule_proposals jsonb, pending_rule_proposal_total bigint,
  pending_rule_proposals_truncated boolean,
  attachment_pipeline_status text, attachment_scan_status text,
  external_reporting text, progress_scope text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.staff_training_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from,
    p_date_to, p_staff_membership_id, p_course_type, p_status, p_search
  );
$$;

alter table public.staff_training_record_versions enable row level security;
alter table public.staff_training_record_versions force row level security;

create policy staff_training_record_versions_select
on public.staff_training_record_versions
for select to authenticated
using (
  private.staff_training_can_access_target(
    organization_id, branch_id, staff_membership_id
  )
);

revoke all on table public.staff_training_record_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_training_rule_proposals
  from public, anon, authenticated, service_role;
revoke all on table private.staff_training_rule_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_training_record_operations
  from public, anon, authenticated, service_role;
revoke all on table private.staff_training_rule_operations
  from public, anon, authenticated, service_role;

revoke all on function private.staff_training_records_are_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_training_current_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_training_user_has_current_permission(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_training_target_is_current(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_training_can_access_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_staff_training_reauth_evidence(
  uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.append_staff_training_record_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, timestamptz,
  timestamptz, text, numeric, numeric, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.propose_staff_training_rule_guarded(
  uuid, uuid, date, date, integer, numeric, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.publish_staff_training_rule_guarded(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.staff_training_snapshot_bundle(
  uuid, uuid, timestamptz, date, date, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_training_snapshot_response(
  uuid, uuid, date, date, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.append_staff_training_record(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, timestamptz,
  timestamptz, text, numeric, numeric, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.propose_staff_training_rule(
  uuid, uuid, date, date, integer, numeric, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.publish_staff_training_rule(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.staff_training_snapshot(
  uuid, uuid, date, date, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.append_staff_training_record(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, timestamptz,
  timestamptz, text, numeric, numeric, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.propose_staff_training_rule(
  uuid, uuid, date, date, integer, numeric, integer, uuid
) to authenticated;
grant execute on function public.publish_staff_training_rule(uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.staff_training_snapshot(
  uuid, uuid, date, date, uuid, text, text, text
) to authenticated;

grant execute on function private.append_staff_training_record_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, timestamptz,
  timestamptz, text, numeric, numeric, text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.propose_staff_training_rule_guarded(
  uuid, uuid, date, date, integer, numeric, integer, uuid
) to authenticated;
grant execute on function private.publish_staff_training_rule_guarded(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function private.staff_training_snapshot_response(
  uuid, uuid, date, date, uuid, text, text, text
) to authenticated;

comment on function public.append_staff_training_record(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, timestamptz,
  timestamptz, text, numeric, numeric, text, text, text, text, text, uuid
) is 'Appends one immutable employee training original, correction or void with exact actor replay.';
comment on function public.staff_training_snapshot(
  uuid, uuid, date, date, uuid, text, text, text
) is 'Returns one bounded audited page-71 snapshot with frozen rule progress and minimal evidence disclosure.';
