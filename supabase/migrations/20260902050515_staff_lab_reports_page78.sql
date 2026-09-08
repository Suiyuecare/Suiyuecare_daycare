-- Page 78: immutable employee laboratory report facts. Employee health access
-- is deliberately separate from general staff-directory access. Every read and
-- write requires recent same-session AAL2. Validity remains human supplied;
-- reminder schedules, medical interpretation, and browser attachment trust are
-- not inferred by this slice.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_health.read', 'Read scoped sensitive employee health records', 3),
  ('staff_health.manage', 'Append scoped sensitive employee health records', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('staff_health.read', 'staff_health.manage')
on conflict (role_id, permission_id) do nothing;

create table public.staff_lab_report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  report_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  staff_membership_id uuid not null references public.memberships(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_display_name text not null,
  staff_employee_code text,
  report_type text not null,
  tested_on date not null,
  provider_name text not null,
  result_text text not null,
  valid_through date not null,
  validity_basis text not null,
  evidence_status text not null,
  attachment_reference text,
  attachment_sha256 text,
  completion_status text not null default 'completed',
  duplicate_fingerprint text not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint staff_lab_report_branch_scope_fkey foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_lab_report_id_scope_key unique (id, organization_id, branch_id),
  constraint staff_lab_report_id_chain_scope_key unique (
    id, organization_id, branch_id, report_key
  ),
  constraint staff_lab_report_chain_key unique (report_key, version),
  constraint staff_lab_report_previous_unique unique (previous_version_id),
  constraint staff_lab_report_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, report_key
  ) references public.staff_lab_report_versions(
    id, organization_id, branch_id, report_key
  ) on delete restrict,
  constraint staff_lab_report_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null)
      or (version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000))
  ),
  constraint staff_lab_report_status_check check (record_status in ('active', 'voided')),
  constraint staff_lab_report_completion_check check (completion_status = 'completed'),
  constraint staff_lab_report_dates_check check (
    extract(year from tested_on) between 1900 and 2200
    and extract(year from valid_through) between 1900 and 2200
    and valid_through >= tested_on
  ),
  constraint staff_lab_report_type_check check (
    char_length(report_type) between 1 and 160 and report_type !~ '[[:cntrl:]]'
  ),
  constraint staff_lab_report_provider_check check (
    char_length(provider_name) between 1 and 200 and provider_name !~ '[[:cntrl:]]'
  ),
  constraint staff_lab_report_result_check check (
    char_length(result_text) between 1 and 2000
    and translate(result_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint staff_lab_report_validity_basis_check check (
    char_length(validity_basis) between 1 and 500
    and translate(validity_basis, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint staff_lab_report_evidence_check check (
    evidence_status in ('provided', 'missing', 'not_applicable')
    and ((evidence_status = 'provided'
      and char_length(attachment_reference) between 1 and 500
      and attachment_sha256 ~ '^[a-f0-9]{64}$')
      or (evidence_status in ('missing', 'not_applicable')
        and attachment_reference is null and attachment_sha256 is null))
  ),
  constraint staff_lab_report_staff_snapshot_check check (
    char_length(staff_display_name) between 1 and 120
    and staff_display_name !~ '[[:cntrl:]]'
    and (staff_employee_code is null or (
      char_length(staff_employee_code) between 1 and 120
      and staff_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_lab_report_text_check check (
    (correction_reason is null or
      translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (attachment_reference is null or attachment_reference !~ '[[:cntrl:]]')
  ),
  constraint staff_lab_report_duplicate_fingerprint_check check (
    duplicate_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint staff_lab_report_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_lab_report_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_version_id uuid not null,
  result_exact_duplicate_count integer not null,
  result_key_field_duplicate_count integer not null,
  result_duplicate_basis text not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null,
  constraint staff_lab_report_operation_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint staff_lab_report_operation_result_scope_fkey foreign key (
    result_record_version_id, organization_id, branch_id
  ) references public.staff_lab_report_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_lab_report_operation_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint staff_lab_report_operation_duplicate_check check (
    result_exact_duplicate_count >= 0
    and result_key_field_duplicate_count >= result_exact_duplicate_count
    and result_duplicate_basis =
      'exact_content_or_same_staff_type_tested_on_provider'
  )
);

create index staff_lab_report_scope_date_idx on public.staff_lab_report_versions(
  organization_id, branch_id, tested_on desc, report_key, version desc
);
create index staff_lab_report_duplicate_key_idx on public.staff_lab_report_versions(
  organization_id, branch_id, staff_membership_id,
  lower(btrim(report_type)), tested_on, lower(btrim(provider_name)), version desc
);
create index staff_lab_report_fingerprint_idx on public.staff_lab_report_versions(
  organization_id, branch_id, duplicate_fingerprint, version desc
);
create index staff_lab_report_membership_idx
  on public.staff_lab_report_versions(staff_membership_id);
create index staff_lab_report_staff_user_idx
  on public.staff_lab_report_versions(staff_user_id);
create index staff_lab_report_recorded_by_idx
  on public.staff_lab_report_versions(recorded_by);
create index staff_lab_report_reauth_idx
  on public.staff_lab_report_versions(reauth_challenge_id);
create index staff_lab_report_previous_idx
  on public.staff_lab_report_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_lab_report_operation_actor_idx
  on private.staff_lab_report_operations(actor_user_id, idempotency_key);
create index staff_lab_report_operation_result_idx
  on private.staff_lab_report_operations(
    result_record_version_id, organization_id, branch_id
  );
create index staff_lab_report_operation_scope_idx
  on private.staff_lab_report_operations(organization_id, branch_id);
create index staff_lab_report_operation_reauth_idx
  on private.staff_lab_report_operations(reauth_challenge_id);

create or replace function private.staff_lab_report_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;


create trigger staff_lab_report_versions_append_only before update or delete
on public.staff_lab_report_versions for each row
execute function private.staff_lab_report_append_only();
create trigger staff_lab_report_operations_append_only before update or delete
on private.staff_lab_report_operations for each row
execute function private.staff_lab_report_append_only();
create trigger staff_lab_report_versions_audit_row_change after insert
on public.staff_lab_report_versions for each row execute function private.audit_row_change();

create or replace function private.staff_lab_report_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default true
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and (not p_require_recent_aal2 or private.has_recent_aal2(15))
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

create or replace function private.staff_lab_report_target_in_scope(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_require_current boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.id = p_staff_membership_id
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and (not p_require_current or (
        membership.status = 'active'
        and membership.starts_at <= clock_timestamp()
        and (membership.ends_at is null or membership.ends_at > clock_timestamp())
        and profile.is_active
      ))
  );
$$;

create or replace function private.staff_lab_report_can_access_target(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_lab_report_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_health.read', true
    )
    and private.staff_lab_report_target_in_scope(
      p_expected_organization_id, p_expected_branch_id,
      p_staff_membership_id, false
    )
    and (
      exists (
        select 1 from public.memberships membership
        where membership.id = p_staff_membership_id
          and membership.profile_id = auth.uid()
      )
      or private.has_permission(
        p_expected_organization_id, p_expected_branch_id, 'staff_health.manage'
      )
    );
$$;

create or replace function private.require_staff_lab_report_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'recent staff lab report AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'recent staff lab report AAL2 evidence is required';
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
      message = 'recent staff lab report AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.append_staff_lab_report_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_report_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_report_type text,
  p_tested_on date,
  p_provider_name text,
  p_result_text text,
  p_valid_through date,
  p_validity_basis text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, report_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, completion_status text, staff_membership_id uuid,
  content_hash text, exact_duplicate_count integer,
  key_field_duplicate_count integer, duplicate_warning boolean,
  duplicate_basis text, recorded_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_report_type text := nullif(btrim(p_report_type), '');
  v_provider_name text := nullif(btrim(p_provider_name), '');
  v_result_text text := nullif(btrim(p_result_text), '');
  v_validity_basis text := nullif(btrim(p_validity_basis), '');
  v_evidence_status text := lower(btrim(coalesce(p_evidence_status, '')));
  v_attachment_reference text := nullif(btrim(p_attachment_reference), '');
  v_attachment_sha256 text := lower(nullif(btrim(p_attachment_sha256), ''));
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_request_hash text;
  v_duplicate_fingerprint text;
  v_content_hash text;
  v_now timestamptz;
  v_version integer;
  v_record_status text;
  v_staff_user_id uuid;
  v_staff_display_name text;
  v_staff_employee_code text;
  v_reauth_challenge_id uuid;
  v_exact_count integer := 0;
  v_key_count integer := 0;
  v_operation private.staff_lab_report_operations%rowtype;
  v_previous public.staff_lab_report_versions%rowtype;
  v_result public.staff_lab_report_versions%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_report_key is null or p_staff_membership_id is null
     or p_idempotency_key is null or p_expected_base_version is null
     or p_expected_base_version < 0
     or v_action not in ('create', 'correct', 'void')
     or not private.staff_lab_report_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.manage', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff lab report write is not permitted';
  end if;

  v_now := clock_timestamp();
  v_reauth_challenge_id := private.require_staff_lab_report_reauth(v_actor, v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-lab-report-operation:' || v_actor::text || ':' ||
      p_idempotency_key::text, 0
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
    and membership.starts_at <= v_now
    and (membership.ends_at is null or membership.ends_at > v_now)
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
        message = 'new staff lab report base is invalid';
    end if;
  elsif p_previous_version_id is null or p_expected_base_version < 1
     or v_correction_reason is null or char_length(v_correction_reason) > 1000
     or translate(v_correction_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'staff lab report correction base or reason is invalid';
  end if;

  if v_action in ('create', 'correct') then
    if v_report_type is null or char_length(v_report_type) > 160
       or v_report_type ~ '[[:cntrl:]]'
       or p_tested_on is null or p_valid_through is null
       or extract(year from p_tested_on) not between 1900 and 2200
       or extract(year from p_valid_through) not between 1900 and 2200
       or p_valid_through < p_tested_on
       or v_provider_name is null or char_length(v_provider_name) > 200
       or v_provider_name ~ '[[:cntrl:]]'
       or v_result_text is null or char_length(v_result_text) > 2000
       or translate(v_result_text, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_validity_basis is null or char_length(v_validity_basis) > 500
       or translate(v_validity_basis, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_evidence_status not in ('missing', 'not_applicable')
       or v_attachment_reference is not null or v_attachment_sha256 is not null then
      raise exception using errcode = '22023',
        message = 'staff lab report content or attachment evidence is invalid';
    end if;
  elsif v_report_type is not null or p_tested_on is not null
     or v_provider_name is not null or v_result_text is not null
     or p_valid_through is not null or v_validity_basis is not null
     or v_evidence_status <> '' or v_attachment_reference is not null
     or v_attachment_sha256 is not null then
    raise exception using errcode = '22023',
      message = 'void operation must copy immutable prior lab report content';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'report_key', p_report_key,
    'previous_version_id', p_previous_version_id,
    'expected_base_version', p_expected_base_version,
    'staff_membership_id', p_staff_membership_id,
    'report_type', v_report_type,
    'tested_on', p_tested_on,
    'provider_name', v_provider_name,
    'result_text', v_result_text,
    'valid_through', p_valid_through,
    'validity_basis', v_validity_basis,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_lab_report_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'staff lab report idempotency key reused with different content';
    end if;
    select record.* into v_result
    from public.staff_lab_report_versions record
    where record.id = v_operation.result_record_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.report_key = p_report_key
      and record.staff_membership_id = p_staff_membership_id;
    if not found or not private.staff_lab_report_authority(
         p_expected_organization_id, p_expected_branch_id,
         'staff_health.manage', true
       ) then
      raise exception using errcode = '42501',
        message = 'staff lab report replay is no longer permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.report_key, v_result.id, v_result.version,
      v_result.previous_version_id, v_result.record_status,
      v_result.completion_status, v_result.staff_membership_id,
      v_result.content_hash,
      v_operation.result_exact_duplicate_count,
      v_operation.result_key_field_duplicate_count,
      v_operation.result_key_field_duplicate_count > 0,
      v_operation.result_duplicate_basis, v_result.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-lab-report:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_report_key::text, 0
  ));
  if v_action = 'create' then
    if exists (
      select 1 from public.staff_lab_report_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.report_key = p_report_key
    ) then
      raise exception using errcode = '23505',
        message = 'staff lab report key already exists';
    end if;
    v_version := 1;
    v_record_status := 'active';
  else
    select record.* into v_previous
    from public.staff_lab_report_versions record
    where record.id = p_previous_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.report_key = p_report_key
      and record.staff_membership_id = p_staff_membership_id
    for share;
    if not found or v_previous.version <> p_expected_base_version
       or v_previous.record_status <> 'active'
       or exists (
         select 1 from public.staff_lab_report_versions later
         where later.report_key = p_report_key and later.version > v_previous.version
       ) then
      raise exception using errcode = '40001',
        message = 'staff lab report base version is stale';
    end if;
    v_version := v_previous.version + 1;
    v_record_status := case when v_action = 'void' then 'voided' else 'active' end;
    if v_action = 'void' then
      v_report_type := v_previous.report_type;
      p_tested_on := v_previous.tested_on;
      v_provider_name := v_previous.provider_name;
      v_result_text := v_previous.result_text;
      p_valid_through := v_previous.valid_through;
      v_validity_basis := v_previous.validity_basis;
      v_evidence_status := v_previous.evidence_status;
      v_attachment_reference := v_previous.attachment_reference;
      v_attachment_sha256 := v_previous.attachment_sha256;
    end if;
  end if;

  v_duplicate_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'staff_membership_id', p_staff_membership_id,
    'report_type', v_report_type,
    'tested_on', p_tested_on,
    'provider_name', v_provider_name,
    'result_text', v_result_text,
    'valid_through', p_valid_through,
    'validity_basis', v_validity_basis,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256
  )::text, 'UTF8')), 'hex');
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'report_key', p_report_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_status', v_record_status,
    'correction_reason', v_correction_reason,
    'staff_membership_id', p_staff_membership_id,
    'staff_user_id', v_staff_user_id,
    'staff_display_name', v_staff_display_name,
    'staff_employee_code', v_staff_employee_code,
    'report_type', v_report_type,
    'tested_on', p_tested_on,
    'provider_name', v_provider_name,
    'result_text', v_result_text,
    'valid_through', p_valid_through,
    'validity_basis', v_validity_basis,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'completion_status', 'completed',
    'recorded_by', v_actor,
    'reauth_challenge_id', v_reauth_challenge_id,
    'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.staff_lab_report_versions (
    organization_id, branch_id, report_key, version, previous_version_id,
    record_status, correction_reason, staff_membership_id, staff_user_id,
    staff_display_name, staff_employee_code, report_type, tested_on,
    provider_name, result_text, valid_through, validity_basis,
    evidence_status, attachment_reference, attachment_sha256,
    completion_status, duplicate_fingerprint, recorded_by,
    reauth_challenge_id, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_report_key,
    v_version, p_previous_version_id, v_record_status, v_correction_reason,
    p_staff_membership_id, v_staff_user_id, v_staff_display_name,
    v_staff_employee_code, v_report_type, p_tested_on, v_provider_name,
    v_result_text, p_valid_through, v_validity_basis, v_evidence_status,
    v_attachment_reference, v_attachment_sha256, 'completed',
    v_duplicate_fingerprint, v_actor, v_reauth_challenge_id, v_now,
    v_content_hash
  ) returning * into v_result;

  if v_record_status = 'active' then
    with latest as (
      select distinct on (record.report_key) record.*
      from public.staff_lab_report_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
      order by record.report_key, record.version desc
    )
    select count(*) filter (
        where other.duplicate_fingerprint = v_duplicate_fingerprint
      )::integer,
      count(*)::integer
    into v_exact_count, v_key_count
    from latest other
    where other.record_status = 'active'
      and other.report_key <> p_report_key
      and other.staff_membership_id = p_staff_membership_id
      and lower(btrim(other.report_type)) = lower(v_report_type)
      and other.tested_on = p_tested_on
      and lower(btrim(other.provider_name)) = lower(v_provider_name);
  end if;

  if not private.staff_lab_report_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.manage', true
     ) or not private.staff_lab_report_target_in_scope(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id, true
     ) then
    raise exception using errcode = '40001',
      message = 'staff lab report final verification failed';
  end if;

  insert into private.staff_lab_report_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_record_version_id, result_exact_duplicate_count,
    result_key_field_duplicate_count, result_duplicate_basis,
    reauth_challenge_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_exact_count,
    v_key_count, 'exact_content_or_same_staff_type_tested_on_provider',
    v_reauth_challenge_id, v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    v_result.report_key, v_result.id, v_result.version,
    v_result.previous_version_id, v_result.record_status,
    v_result.completion_status, v_result.staff_membership_id,
    v_result.content_hash, v_exact_count, v_key_count, v_key_count > 0,
    'exact_content_or_same_staff_type_tested_on_provider'::text,
    v_result.recorded_at, false;
end;
$$;

create or replace function private.staff_lab_report_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_staff_membership_id uuid,
  p_report_type text,
  p_validity_status text,
  p_duplicate_status text,
  p_evidence_status text,
  p_date_from date,
  p_date_to date,
  p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Taipei')::date;
  v_report_type text := nullif(btrim(p_report_type), '');
  v_validity_status text := lower(btrim(coalesce(p_validity_status, 'all')));
  v_duplicate_status text := lower(btrim(coalesce(p_duplicate_status, 'all')));
  v_evidence_status text := lower(btrim(coalesce(p_evidence_status, 'all')));
  v_search text := lower(nullif(btrim(p_search), ''));
  v_records jsonb := '[]'::jsonb;
  v_record_total bigint := 0;
  v_active_total bigint := 0;
  v_expired_total bigint := 0;
  v_missing_evidence_total bigint := 0;
  v_duplicate_warning_total bigint := 0;
  v_history jsonb := '[]'::jsonb;
  v_history_total bigint := 0;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_type_options jsonb := '[]'::jsonb;
  v_type_total bigint := 0;
begin
  with latest as (
    select distinct on (record.report_key) record.*
    from public.staff_lab_report_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_lab_report_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.report_key, record.version desc
  ), classified as (
    select latest.*,
      case when latest.record_status = 'voided' then 'voided'
        when latest.valid_through < v_today then 'expired' else 'active' end
        as validity_status,
      coalesce(duplicates.exact_count, 0)::integer as exact_duplicate_count,
      coalesce(duplicates.key_count, 0)::integer as key_field_duplicate_count,
      coalesce(duplicates.key_count, 0) > 0 as duplicate_warning,
      to_jsonb(array_remove(array[
        case when coalesce(duplicates.exact_count, 0) > 0
          then 'exact_content' end,
        case when coalesce(duplicates.key_count, 0) >
            coalesce(duplicates.exact_count, 0)
          then 'same_staff_type_tested_on_provider' end
      ], null)) as duplicate_bases,
      coalesce(duplicates.matches, '[]'::jsonb) as duplicate_matches,
      coalesce(duplicates.key_count, 0) > 200 as duplicate_matches_truncated
    from latest
    left join lateral (
      select count(*) filter (
          where other.duplicate_fingerprint = latest.duplicate_fingerprint
        )::integer as exact_count,
        count(*)::integer as key_count,
        coalesce(jsonb_agg(jsonb_build_object(
          'report_key', other.report_key,
          'record_version_id', other.id,
          'tested_on', other.tested_on,
          'match_kind', case
            when other.duplicate_fingerprint = latest.duplicate_fingerprint
              then 'exact_content'
            else 'same_staff_type_tested_on_provider'
          end
        ) order by other.tested_on desc, other.report_key)
          filter (where duplicate_rank <= 200), '[]'::jsonb) as matches
      from (
        select candidate.*,
          row_number() over (order by candidate.tested_on desc, candidate.report_key)
            as duplicate_rank
        from latest candidate
        where latest.record_status = 'active'
          and candidate.record_status = 'active'
          and candidate.report_key <> latest.report_key
          and candidate.staff_membership_id = latest.staff_membership_id
          and lower(btrim(candidate.report_type)) = lower(btrim(latest.report_type))
          and candidate.tested_on = latest.tested_on
          and lower(btrim(candidate.provider_name)) = lower(btrim(latest.provider_name))
      ) other
    ) duplicates on true
  ), filtered as (
    select classified.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from classified
    left join public.profiles recorder on recorder.id = classified.recorded_by
    where (p_staff_membership_id is null
        or classified.staff_membership_id = p_staff_membership_id)
      and (v_report_type is null or classified.report_type = v_report_type)
      and (v_validity_status = 'all'
        or classified.validity_status = v_validity_status)
      and (v_duplicate_status = 'all'
        or (v_duplicate_status = 'any' and classified.duplicate_warning)
        or (v_duplicate_status = 'exact'
          and classified.exact_duplicate_count > 0)
        or (v_duplicate_status = 'key_fields'
          and classified.key_field_duplicate_count >
            classified.exact_duplicate_count)
        or (v_duplicate_status = 'none' and not classified.duplicate_warning))
      and (v_evidence_status = 'all'
        or classified.evidence_status = v_evidence_status)
      and (p_date_from is null or classified.tested_on >= p_date_from)
      and (p_date_to is null or classified.tested_on <= p_date_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        classified.staff_display_name, classified.staff_employee_code,
        classified.report_type, classified.provider_name,
        classified.result_text, classified.validity_basis
      ))) > 0)
  ), ranked as (
    select filtered.*, row_number() over (
      order by case when duplicate_warning then 0 else 1 end,
        case when validity_status = 'expired' then 0 else 1 end,
        tested_on desc, staff_display_name collate "C", report_key
    ) as row_number
    from filtered
  )
  select count(*)::bigint,
    count(*) filter (where validity_status = 'active')::bigint,
    count(*) filter (where validity_status = 'expired')::bigint,
    count(*) filter (where evidence_status = 'missing')::bigint,
    count(*) filter (where duplicate_warning)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'report_key', report_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'completion_status', completion_status,
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'staff_display_name', staff_display_name,
      'staff_employee_code', staff_employee_code,
      'report_type', report_type,
      'tested_on', tested_on,
      'provider_name', provider_name,
      'result_text', result_text,
      'valid_through', valid_through,
      'validity_basis', validity_basis,
      'evidence_status', evidence_status,
      'attachment_reference', attachment_reference,
      'attachment_sha256', attachment_sha256,
      'validity_status', validity_status,
      'exact_duplicate_count', exact_duplicate_count,
      'key_field_duplicate_count', key_field_duplicate_count,
      'duplicate_warning', duplicate_warning,
      'duplicate_bases', duplicate_bases,
      'duplicate_matches', duplicate_matches,
      'duplicate_matches_truncated', duplicate_matches_truncated,
      'duplicate_basis', 'exact_content_or_same_staff_type_tested_on_provider',
      'medical_interpretation_status', 'not_evaluated',
      'recorded_by', recorded_by,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by case when duplicate_warning then 0 else 1 end,
      case when validity_status = 'expired' then 0 else 1 end,
      tested_on desc, staff_display_name collate "C", report_key)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_record_total, v_active_total, v_expired_total,
    v_missing_evidence_total, v_duplicate_warning_total, v_records
  from ranked;

  with latest as (
    select distinct on (record.report_key) record.*
    from public.staff_lab_report_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_lab_report_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.report_key, record.version desc
  ), duplicate_counts as (
    select latest.*,
      case when latest.record_status = 'voided' then 'voided'
        when latest.valid_through < v_today then 'expired' else 'active' end
        as validity_status,
      (select count(*)::integer from latest other
        where latest.record_status = 'active'
          and other.record_status = 'active'
          and other.report_key <> latest.report_key
          and other.staff_membership_id = latest.staff_membership_id
          and lower(btrim(other.report_type)) = lower(btrim(latest.report_type))
          and other.tested_on = latest.tested_on
          and lower(btrim(other.provider_name)) = lower(btrim(latest.provider_name))
          and other.duplicate_fingerprint = latest.duplicate_fingerprint)
        as exact_count,
      (select count(*)::integer from latest other
        where latest.record_status = 'active'
          and other.record_status = 'active'
          and other.report_key <> latest.report_key
          and other.staff_membership_id = latest.staff_membership_id
          and lower(btrim(other.report_type)) = lower(btrim(latest.report_type))
          and other.tested_on = latest.tested_on
          and lower(btrim(other.provider_name)) = lower(btrim(latest.provider_name)))
        as key_count
    from latest
  ), filtered_keys as (
    select duplicate_counts.report_key from duplicate_counts
    where (p_staff_membership_id is null
        or duplicate_counts.staff_membership_id = p_staff_membership_id)
      and (v_report_type is null or duplicate_counts.report_type = v_report_type)
      and (v_validity_status = 'all'
        or duplicate_counts.validity_status = v_validity_status)
      and (v_duplicate_status = 'all'
        or (v_duplicate_status = 'any' and duplicate_counts.key_count > 0)
        or (v_duplicate_status = 'exact' and duplicate_counts.exact_count > 0)
        or (v_duplicate_status = 'key_fields'
          and duplicate_counts.key_count > duplicate_counts.exact_count)
        or (v_duplicate_status = 'none' and duplicate_counts.key_count = 0))
      and (v_evidence_status = 'all'
        or duplicate_counts.evidence_status = v_evidence_status)
      and (p_date_from is null or duplicate_counts.tested_on >= p_date_from)
      and (p_date_to is null or duplicate_counts.tested_on <= p_date_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        duplicate_counts.staff_display_name,
        duplicate_counts.staff_employee_code,
        duplicate_counts.report_type, duplicate_counts.provider_name,
        duplicate_counts.result_text, duplicate_counts.validity_basis
      ))) > 0)
  ), visible as (
    select record.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from public.staff_lab_report_versions record
    join filtered_keys on filtered_keys.report_key = record.report_key
    left join public.profiles recorder on recorder.id = record.recorded_by
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_lab_report_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
  ), ranked as (
    select visible.*, row_number() over (
      order by report_key, version desc
    ) as row_number from visible
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'report_key', report_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'completion_status', completion_status,
      'report_type', report_type,
      'tested_on', tested_on,
      'provider_name', provider_name,
      'result_text', result_text,
      'valid_through', valid_through,
      'validity_basis', validity_basis,
      'evidence_status', evidence_status,
      'attachment_reference', attachment_reference,
      'attachment_sha256', attachment_sha256,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by report_key, version desc)
      filter (where row_number <= 500), '[]'::jsonb)
  into v_history_total, v_history from ranked;

  with latest as (
    select distinct on (record.report_key) record.*
    from public.staff_lab_report_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_lab_report_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.report_key, record.version desc
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
      and private.staff_lab_report_can_access_target(
        p_expected_organization_id, p_expected_branch_id, membership.id
      )
    union all
    select latest.staff_membership_id, latest.staff_user_id,
      latest.staff_display_name, latest.staff_employee_code, false, 2
    from latest
  ), unique_staff as (
    select distinct on (staff_membership_id) * from candidates
    order by staff_membership_id, precedence
  ), ranked as (
    select unique_staff.*, row_number() over (
      order by display_name collate "C", staff_membership_id
    ) as row_number from unique_staff
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
  into v_staff_total, v_staff_options from ranked;

  with latest as (
    select distinct on (record.report_key) record.*
    from public.staff_lab_report_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_lab_report_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.report_key, record.version desc
  ), grouped as (
    select report_type, count(*)::bigint as record_count
    from latest group by report_type
  ), ranked as (
    select grouped.*, row_number() over (
      order by report_type collate "C"
    ) as row_number from grouped
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'report_type', report_type, 'record_count', record_count
    ) order by report_type collate "C")
      filter (where row_number <= 200), '[]'::jsonb)
  into v_type_total, v_type_options from ranked;

  return jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_now,
    'snapshot_date', v_today,
    'records', v_records,
    'record_total', v_record_total,
    'records_truncated', v_record_total > 200,
    'active_total', v_active_total,
    'expired_total', v_expired_total,
    'missing_evidence_total', v_missing_evidence_total,
    'duplicate_warning_total', v_duplicate_warning_total,
    'history', v_history,
    'history_total', v_history_total,
    'history_truncated', v_history_total > 500,
    'staff_options', v_staff_options,
    'staff_total', v_staff_total,
    'staff_truncated', v_staff_total > 200,
    'type_options', v_type_options,
    'type_total', v_type_total,
    'types_truncated', v_type_total > 200,
    'validity_rule_status', 'not_configured',
    'valid_through_source_mode', 'manual_per_record',
    'expiry_reminder_schedule_status', 'not_configured',
    'expiry_notice_days', null,
    'expiring_total', null,
    'duplicate_rule_status', 'configured',
    'duplicate_basis', 'exact_content_or_same_staff_type_tested_on_provider',
    'duplicate_resolution', 'warning_only_no_auto_merge',
    'medical_interpretation_status', 'not_evaluated',
    'attachment_pipeline_status', 'not_configured',
    'attachment_scan_status', 'not_configured',
    'recent_aal2_max_age_minutes', 15
  );
end;
$$;
create or replace function private.staff_lab_report_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_report_type text,
  p_validity_status text,
  p_duplicate_status text,
  p_evidence_status text,
  p_date_from date,
  p_date_to date,
  p_search text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, active_total bigint, expired_total bigint,
  missing_evidence_total bigint, duplicate_warning_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  type_options jsonb, type_total bigint, types_truncated boolean,
  validity_rule_status text, valid_through_source_mode text,
  expiry_reminder_schedule_status text, expiry_notice_days integer,
  expiring_total bigint, duplicate_rule_status text, duplicate_basis text,
  duplicate_resolution text, medical_interpretation_status text,
  attachment_pipeline_status text, attachment_scan_status text,
  recent_aal2_max_age_minutes integer
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_report_type text := nullif(btrim(p_report_type), '');
  v_validity_status text := lower(btrim(coalesce(p_validity_status, 'all')));
  v_duplicate_status text := lower(btrim(coalesce(p_duplicate_status, 'all')));
  v_evidence_status text := lower(btrim(coalesce(p_evidence_status, 'all')));
  v_search text := nullif(btrim(p_search), '');
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_validity_status not in ('all', 'active', 'expired', 'voided')
     or v_duplicate_status not in ('all', 'any', 'exact', 'key_fields', 'none')
     or v_evidence_status not in ('all', 'provided', 'missing', 'not_applicable')
     or (v_report_type is not null and (
       char_length(v_report_type) > 160 or v_report_type ~ '[[:cntrl:]]'
     ))
     or (p_date_from is not null
       and extract(year from p_date_from) not between 1900 and 2200)
     or (p_date_to is not null
       and extract(year from p_date_to) not between 1900 and 2200)
     or (p_date_from is not null and p_date_to is not null
       and p_date_to < p_date_from)
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]'
     ))
     or not private.staff_lab_report_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.read', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff lab report snapshot is not permitted';
  end if;
  if p_staff_membership_id is not null
     and not private.staff_lab_report_can_access_target(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff lab report target is outside current scope';
  end if;

  v_now := clock_timestamp();
  perform private.require_staff_lab_report_reauth(v_actor, v_now);
  v_bundle := private.staff_lab_report_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_report_type, v_validity_status,
    v_duplicate_status, v_evidence_status, p_date_from, p_date_to,
    v_search
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_lab_report_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page78_staff_lab_reports_v1',
      'generated_at', v_now,
      'staff_filter_present', p_staff_membership_id is not null,
      'report_type_filter_present', v_report_type is not null,
      'validity_status', v_validity_status,
      'duplicate_status', v_duplicate_status,
      'evidence_status', v_evidence_status,
      'date_from_present', p_date_from is not null,
      'date_to_present', p_date_to is not null,
      'search_present', v_search is not null,
      'record_total', v_bundle -> 'record_total',
      'duplicate_warning_total', v_bundle -> 'duplicate_warning_total',
      'expired_total', v_bundle -> 'expired_total'
    )
  );

  if not private.staff_lab_report_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.read', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff lab report snapshot final verification failed';
  end if;
  v_after := private.staff_lab_report_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_report_type, v_validity_status,
    v_duplicate_status, v_evidence_status, p_date_from, p_date_to,
    v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff lab report snapshot changed during audit';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    (v_bundle ->> 'active_total')::bigint,
    (v_bundle ->> 'expired_total')::bigint,
    (v_bundle ->> 'missing_evidence_total')::bigint,
    (v_bundle ->> 'duplicate_warning_total')::bigint,
    v_bundle -> 'history',
    (v_bundle ->> 'history_total')::bigint,
    (v_bundle ->> 'history_truncated')::boolean,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'type_options',
    (v_bundle ->> 'type_total')::bigint,
    (v_bundle ->> 'types_truncated')::boolean,
    v_bundle ->> 'validity_rule_status',
    v_bundle ->> 'valid_through_source_mode',
    v_bundle ->> 'expiry_reminder_schedule_status',
    (v_bundle ->> 'expiry_notice_days')::integer,
    (v_bundle ->> 'expiring_total')::bigint,
    v_bundle ->> 'duplicate_rule_status',
    v_bundle ->> 'duplicate_basis',
    v_bundle ->> 'duplicate_resolution',
    v_bundle ->> 'medical_interpretation_status',
    v_bundle ->> 'attachment_pipeline_status',
    v_bundle ->> 'attachment_scan_status',
    (v_bundle ->> 'recent_aal2_max_age_minutes')::integer;
end;
$$;

create or replace function public.append_staff_lab_report(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_report_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_report_type text,
  p_tested_on date,
  p_provider_name text,
  p_result_text text,
  p_valid_through date,
  p_validity_basis text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, report_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, completion_status text, staff_membership_id uuid,
  content_hash text, exact_duplicate_count integer,
  key_field_duplicate_count integer, duplicate_warning boolean,
  duplicate_basis text, recorded_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_staff_lab_report_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_report_key, p_previous_version_id, p_expected_base_version,
    p_staff_membership_id, p_report_type, p_tested_on, p_provider_name,
    p_result_text, p_valid_through, p_validity_basis, p_evidence_status,
    p_attachment_reference, p_attachment_sha256, p_correction_reason,
    p_idempotency_key
  );
$$;

create or replace function public.staff_lab_report_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid default null,
  p_report_type text default null,
  p_validity_status text default 'all',
  p_duplicate_status text default 'all',
  p_evidence_status text default 'all',
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, active_total bigint, expired_total bigint,
  missing_evidence_total bigint, duplicate_warning_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  type_options jsonb, type_total bigint, types_truncated boolean,
  validity_rule_status text, valid_through_source_mode text,
  expiry_reminder_schedule_status text, expiry_notice_days integer,
  expiring_total bigint, duplicate_rule_status text, duplicate_basis text,
  duplicate_resolution text, medical_interpretation_status text,
  attachment_pipeline_status text, attachment_scan_status text,
  recent_aal2_max_age_minutes integer
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.staff_lab_report_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_staff_membership_id, p_report_type, p_validity_status,
    p_duplicate_status, p_evidence_status, p_date_from, p_date_to,
    p_search
  );
$$;

alter table public.staff_lab_report_versions enable row level security;
alter table public.staff_lab_report_versions force row level security;
create policy staff_lab_report_versions_select
on public.staff_lab_report_versions for select to authenticated
using (private.staff_lab_report_can_access_target(
  organization_id, branch_id, staff_membership_id
));

revoke all on table public.staff_lab_report_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_lab_report_operations
  from public, anon, authenticated, service_role;

revoke all on function private.staff_lab_report_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_lab_report_authority(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_lab_report_target_in_scope(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_lab_report_can_access_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_staff_lab_report_reauth(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.append_staff_lab_report_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, text, text,
  date, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.staff_lab_report_snapshot_bundle(
  uuid, uuid, timestamptz, uuid, text, text, text, text, date, date, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_lab_report_snapshot_response(
  uuid, uuid, uuid, text, text, text, text, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function public.append_staff_lab_report(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, text, text,
  date, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.staff_lab_report_snapshot(
  uuid, uuid, uuid, text, text, text, text, date, date, text
) from public, anon, authenticated, service_role;

grant execute on function public.append_staff_lab_report(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, text, text,
  date, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.staff_lab_report_snapshot(
  uuid, uuid, uuid, text, text, text, text, date, date, text
) to authenticated;
grant execute on function private.append_staff_lab_report_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, date, text, text,
  date, text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.staff_lab_report_snapshot_response(
  uuid, uuid, uuid, text, text, text, text, date, date, text
) to authenticated;

comment on table public.staff_lab_report_versions is
  'Immutable employee laboratory report facts and correction chain; validity is human supplied and no medical conclusion is inferred.';
comment on function public.staff_lab_report_snapshot(
  uuid, uuid, uuid, text, text, text, text, date, date, text
) is
  'Returns one audited Page 78 snapshot with explainable duplicate and manual-expiry warnings; reminders and attachment trust remain explicitly unconfigured.';
