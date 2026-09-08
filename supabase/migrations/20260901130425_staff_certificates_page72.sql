-- Page 72: immutable employee certificate records and finite, independently
-- approved exceptions. No restricted-service taxonomy or reminder interval is
-- inferred here; both remain explicitly not configured until published by the
-- institution through a future governed rule version.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_certificates.read', 'Read scoped employee certificate records', 2),
  ('staff_certificates.manage', 'Append employee certificate versions', 3),
  ('staff_certificates.exceptions', 'Request and approve certificate exceptions', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in (
    'staff_certificates.read', 'staff_certificates.manage',
    'staff_certificates.exceptions'
  )
on conflict (role_id, permission_id) do nothing;

create table public.staff_certificate_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  certificate_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  staff_membership_id uuid not null references public.memberships(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_display_name text not null,
  staff_employee_code text,
  certificate_type text not null,
  certificate_number text not null,
  effective_on date not null,
  expires_on date,
  registration_status text not null,
  verification_status text not null,
  evidence_status text not null,
  attachment_reference text,
  attachment_sha256 text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint staff_certificate_branch_scope_fkey foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_certificate_id_scope_key unique (
    id, organization_id, branch_id, certificate_key
  ),
  constraint staff_certificate_id_branch_scope_key unique (id, organization_id, branch_id),
  constraint staff_certificate_chain_key unique (certificate_key, version),
  constraint staff_certificate_previous_unique unique (previous_version_id),
  constraint staff_certificate_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, certificate_key
  ) references public.staff_certificate_versions(
    id, organization_id, branch_id, certificate_key
  ) on delete restrict,
  constraint staff_certificate_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null)
      or (version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000))
  ),
  constraint staff_certificate_status_check check (record_status in ('active', 'voided')),
  constraint staff_certificate_type_check check (
    char_length(certificate_type) between 1 and 120
    and certificate_type !~ '[[:cntrl:]]'
  ),
  constraint staff_certificate_number_check check (
    char_length(certificate_number) between 1 and 160
    and certificate_number !~ '[[:cntrl:]]'
  ),
  constraint staff_certificate_dates_check check (
    extract(year from effective_on) between 1900 and 2200
    and (expires_on is null or (
      expires_on >= effective_on and extract(year from expires_on) between 1900 and 2200
    ))
  ),
  constraint staff_certificate_registration_check check (
    registration_status in ('pending', 'registered', 'not_required', 'suspended')
  ),
  constraint staff_certificate_verification_check check (
    verification_status in ('pending', 'verified', 'rejected')
  ),
  constraint staff_certificate_evidence_check check (
    evidence_status in ('provided', 'missing', 'not_applicable')
    and ((evidence_status = 'provided'
      and char_length(attachment_reference) between 1 and 500
      and attachment_sha256 ~ '^[a-f0-9]{64}$')
      or (evidence_status in ('missing', 'not_applicable')
        and attachment_reference is null and attachment_sha256 is null))
  ),
  constraint staff_certificate_staff_snapshot_check check (
    char_length(staff_display_name) between 1 and 120
    and staff_display_name !~ '[[:cntrl:]]'
    and (staff_employee_code is null or (
      char_length(staff_employee_code) between 1 and 120
      and staff_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_certificate_text_check check (
    (correction_reason is null or
      translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (attachment_reference is null or attachment_reference !~ '[[:cntrl:]]')
  ),
  constraint staff_certificate_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_certificate_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_version_id uuid not null,
  created_at timestamptz not null,
  constraint staff_certificate_operation_actor_key unique (actor_user_id, idempotency_key),
  constraint staff_certificate_operation_result_scope_fkey foreign key (
    result_record_version_id, organization_id, branch_id
  ) references public.staff_certificate_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_certificate_operation_hash_check check (request_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_certificate_exception_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  certificate_key uuid not null,
  certificate_version_id uuid not null,
  expected_certificate_version integer not null,
  valid_from date not null,
  valid_through date not null,
  reason text not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requester_display_name text not null,
  requester_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  requested_at timestamptz not null,
  content_hash text not null,
  constraint staff_certificate_exception_request_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_certificate_exception_request_certificate_scope_fkey
    foreign key (certificate_version_id, organization_id, branch_id, certificate_key)
    references public.staff_certificate_versions(
      id, organization_id, branch_id, certificate_key
    ) on delete restrict,
  constraint staff_certificate_exception_request_id_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint staff_certificate_exception_request_dates_check check (
    valid_through >= valid_from
    and extract(year from valid_from) between 1900 and 2200
    and extract(year from valid_through) between 1900 and 2200
  ),
  constraint staff_certificate_exception_request_reason_check check (
    char_length(reason) between 1 and 1000
    and translate(reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint staff_certificate_exception_request_snapshot_check check (
    expected_certificate_version > 0
    and char_length(requester_display_name) between 1 and 120
    and requester_display_name !~ '[[:cntrl:]]'
  ),
  constraint staff_certificate_exception_request_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.staff_certificate_exception_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  request_id uuid not null,
  approval_number integer not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approver_display_name text not null,
  approver_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  approved_at timestamptz not null,
  content_hash text not null,
  constraint staff_certificate_exception_approval_request_scope_fkey
    foreign key (request_id, organization_id, branch_id)
    references private.staff_certificate_exception_requests(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_certificate_exception_approval_number_key unique (
    request_id, approval_number
  ),
  constraint staff_certificate_exception_approval_actor_key unique (
    request_id, approved_by
  ),
  constraint staff_certificate_exception_approval_number_check check (
    approval_number in (1, 2)
  ),
  constraint staff_certificate_exception_approval_snapshot_check check (
    char_length(approver_display_name) between 1 and 120
    and approver_display_name !~ '[[:cntrl:]]'
  ),
  constraint staff_certificate_exception_approval_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.staff_certificate_exception_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_request_id uuid not null,
  result_approval_id uuid,
  result_approval_count integer not null,
  result_status text not null,
  created_at timestamptz not null,
  constraint staff_certificate_exception_operation_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint staff_certificate_exception_operation_request_scope_fkey
    foreign key (result_request_id, organization_id, branch_id)
    references private.staff_certificate_exception_requests(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_certificate_exception_operation_approval_fkey
    foreign key (result_approval_id) references private.staff_certificate_exception_approvals(id)
    on delete restrict,
  constraint staff_certificate_exception_operation_shape_check check (
    (operation_kind = 'request' and result_approval_id is null
      and result_approval_count = 0 and result_status = 'pending')
    or (operation_kind = 'approve' and result_approval_id is not null
      and result_approval_count in (1, 2)
      and result_status in ('pending', 'approved'))
  ),
  constraint staff_certificate_exception_operation_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create index staff_certificate_scope_expiry_idx on public.staff_certificate_versions(
  organization_id, branch_id, expires_on, certificate_key, version desc
);
create index staff_certificate_membership_idx on public.staff_certificate_versions(staff_membership_id);
create index staff_certificate_staff_user_idx on public.staff_certificate_versions(staff_user_id);
create index staff_certificate_recorded_by_idx on public.staff_certificate_versions(recorded_by);
create index staff_certificate_previous_idx on public.staff_certificate_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_certificate_operation_result_idx on private.staff_certificate_operations(
  result_record_version_id, organization_id, branch_id
);
create index staff_certificate_exception_request_certificate_idx
  on private.staff_certificate_exception_requests(
    certificate_version_id, organization_id, branch_id, certificate_key
  );
create index staff_certificate_exception_requester_idx
  on private.staff_certificate_exception_requests(requested_by);
create index staff_certificate_exception_request_reauth_idx
  on private.staff_certificate_exception_requests(requester_reauth_challenge_id);
create index staff_certificate_exception_approval_request_idx
  on private.staff_certificate_exception_approvals(request_id, approval_number);
create index staff_certificate_exception_approver_idx
  on private.staff_certificate_exception_approvals(approved_by);
create index staff_certificate_exception_approval_reauth_idx
  on private.staff_certificate_exception_approvals(approver_reauth_challenge_id);
create index staff_certificate_exception_approval_scope_idx
  on private.staff_certificate_exception_approvals(organization_id, branch_id);
create index staff_certificate_exception_operation_request_idx
  on private.staff_certificate_exception_operations(result_request_id);
create index staff_certificate_exception_operation_approval_idx
  on private.staff_certificate_exception_operations(result_approval_id)
  where result_approval_id is not null;
create index staff_certificate_exception_operation_scope_idx
  on private.staff_certificate_exception_operations(organization_id, branch_id);

create or replace function private.staff_certificate_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger staff_certificate_versions_append_only before update or delete
on public.staff_certificate_versions for each row
execute function private.staff_certificate_append_only();
create trigger staff_certificate_operations_append_only before update or delete
on private.staff_certificate_operations for each row
execute function private.staff_certificate_append_only();
create trigger staff_certificate_exception_requests_append_only before update or delete
on private.staff_certificate_exception_requests for each row
execute function private.staff_certificate_append_only();
create trigger staff_certificate_exception_approvals_append_only before update or delete
on private.staff_certificate_exception_approvals for each row
execute function private.staff_certificate_append_only();
create trigger staff_certificate_exception_operations_append_only before update or delete
on private.staff_certificate_exception_operations for each row
execute function private.staff_certificate_append_only();

create trigger staff_certificate_versions_audit_row_change after insert
on public.staff_certificate_versions for each row execute function private.audit_row_change();
create trigger staff_certificate_exception_requests_audit_row_change after insert
on private.staff_certificate_exception_requests for each row execute function private.audit_row_change();
create trigger staff_certificate_exception_approvals_audit_row_change after insert
on private.staff_certificate_exception_approvals for each row execute function private.audit_row_change();

create or replace function private.staff_certificate_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
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

create or replace function private.staff_certificate_user_has_permission(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_user_id uuid,
  p_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where profile.id = p_user_id and profile.is_active
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

create or replace function private.staff_certificate_target_in_scope(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_require_current boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships membership
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

create or replace function private.staff_certificate_can_access_target(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_certificate_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_certificates.read'
    )
    and private.staff_certificate_target_in_scope(
      p_expected_organization_id, p_expected_branch_id, p_staff_membership_id, false
    )
    and (
      exists (
        select 1 from public.memberships membership
        where membership.id = p_staff_membership_id
          and membership.profile_id = auth.uid()
      )
      or private.has_permission(
        p_expected_organization_id, p_expected_branch_id,
        'staff_certificates.manage'
      )
    );
$$;

create or replace function private.require_staff_certificate_reauth(
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
      message = 'recent certificate AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'recent certificate AAL2 evidence is required';
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
      message = 'recent certificate AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.append_staff_certificate_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_certificate_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_certificate_type text,
  p_certificate_number text,
  p_effective_on date,
  p_expires_on date,
  p_registration_status text,
  p_verification_status text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, certificate_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  recorded_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_certificate_type text := nullif(btrim(p_certificate_type), '');
  v_certificate_number text := nullif(btrim(p_certificate_number), '');
  v_registration_status text := lower(btrim(coalesce(p_registration_status, '')));
  v_verification_status text := lower(btrim(coalesce(p_verification_status, '')));
  v_evidence_status text := lower(btrim(coalesce(p_evidence_status, '')));
  v_attachment_reference text := nullif(btrim(p_attachment_reference), '');
  v_attachment_sha256 text := lower(nullif(btrim(p_attachment_sha256), ''));
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_request_hash text;
  v_content_hash text;
  v_now timestamptz;
  v_version integer;
  v_record_status text;
  v_staff_user_id uuid;
  v_staff_display_name text;
  v_staff_employee_code text;
  v_operation private.staff_certificate_operations%rowtype;
  v_previous public.staff_certificate_versions%rowtype;
  v_result public.staff_certificate_versions%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_certificate_key is null or p_staff_membership_id is null
     or p_idempotency_key is null or p_expected_base_version is null
     or p_expected_base_version < 0 or v_action not in ('create', 'correct', 'void')
     or not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.manage'
     ) then
    raise exception using errcode = '42501',
      message = 'staff certificate write is not permitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-certificate-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
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
        message = 'new certificate base is invalid';
    end if;
  elsif p_previous_version_id is null or p_expected_base_version < 1
     or v_correction_reason is null or char_length(v_correction_reason) > 1000
     or translate(v_correction_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'certificate correction base or reason is invalid';
  end if;

  if v_action in ('create', 'correct') then
    if v_certificate_type is null or char_length(v_certificate_type) > 120
       or v_certificate_type ~ '[[:cntrl:]]'
       or v_certificate_number is null or char_length(v_certificate_number) > 160
       or v_certificate_number ~ '[[:cntrl:]]'
       or p_effective_on is null
       or extract(year from p_effective_on) not between 1900 and 2200
       or (p_expires_on is not null and (
         p_expires_on < p_effective_on
         or extract(year from p_expires_on) not between 1900 and 2200
       ))
       or v_registration_status not in (
         'pending', 'registered', 'not_required', 'suspended'
       )
       or v_verification_status not in ('pending', 'verified', 'rejected')
       or v_evidence_status not in ('missing', 'not_applicable')
       or v_attachment_reference is not null or v_attachment_sha256 is not null then
      raise exception using errcode = '22023',
        message = 'certificate content or attachment evidence is invalid';
    end if;
  elsif v_certificate_type is not null or v_certificate_number is not null
     or p_effective_on is not null or p_expires_on is not null
     or v_registration_status <> '' or v_verification_status <> ''
     or v_evidence_status <> '' or v_attachment_reference is not null
     or v_attachment_sha256 is not null then
    raise exception using errcode = '22023',
      message = 'void operation must copy immutable prior content';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'certificate_key', p_certificate_key,
    'previous_version_id', p_previous_version_id,
    'expected_base_version', p_expected_base_version,
    'staff_membership_id', p_staff_membership_id,
    'certificate_type', v_certificate_type,
    'certificate_number', v_certificate_number,
    'effective_on', p_effective_on,
    'expires_on', p_expires_on,
    'registration_status', v_registration_status,
    'verification_status', v_verification_status,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_certificate_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'certificate idempotency key reused with different content';
    end if;
    select record.* into v_result
    from public.staff_certificate_versions record
    where record.id = v_operation.result_record_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.certificate_key = p_certificate_key
      and record.staff_membership_id = p_staff_membership_id;
    if not found or not private.staff_certificate_current_authority(
         p_expected_organization_id, p_expected_branch_id,
         'staff_certificates.manage'
       ) then
      raise exception using errcode = '42501',
        message = 'certificate replay is no longer permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.certificate_key, v_result.id, v_result.version,
      v_result.previous_version_id, v_result.record_status,
      v_result.staff_membership_id, v_result.content_hash,
      v_result.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-certificate:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_certificate_key::text, 0
  ));
  if v_action = 'create' then
    if exists (
      select 1 from public.staff_certificate_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.certificate_key = p_certificate_key
    ) then
      raise exception using errcode = '23505',
        message = 'certificate key already exists';
    end if;
    v_version := 1;
    v_record_status := 'active';
  else
    select record.* into v_previous
    from public.staff_certificate_versions record
    where record.id = p_previous_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.certificate_key = p_certificate_key
      and record.staff_membership_id = p_staff_membership_id
    for share;
    if not found or v_previous.version <> p_expected_base_version
       or v_previous.record_status <> 'active'
       or exists (
         select 1 from public.staff_certificate_versions later
         where later.certificate_key = p_certificate_key
           and later.version > v_previous.version
       ) then
      raise exception using errcode = '40001',
        message = 'certificate base version is stale';
    end if;
    v_version := v_previous.version + 1;
    v_record_status := case when v_action = 'void' then 'voided' else 'active' end;
    if v_action = 'void' then
      v_certificate_type := v_previous.certificate_type;
      v_certificate_number := v_previous.certificate_number;
      p_effective_on := v_previous.effective_on;
      p_expires_on := v_previous.expires_on;
      v_registration_status := v_previous.registration_status;
      v_verification_status := v_previous.verification_status;
      v_evidence_status := v_previous.evidence_status;
      v_attachment_reference := v_previous.attachment_reference;
      v_attachment_sha256 := v_previous.attachment_sha256;
    end if;
  end if;

  v_now := clock_timestamp();
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'certificate_key', p_certificate_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_status', v_record_status,
    'correction_reason', v_correction_reason,
    'staff_membership_id', p_staff_membership_id,
    'staff_user_id', v_staff_user_id,
    'staff_display_name', v_staff_display_name,
    'staff_employee_code', v_staff_employee_code,
    'certificate_type', v_certificate_type,
    'certificate_number', v_certificate_number,
    'effective_on', p_effective_on,
    'expires_on', p_expires_on,
    'registration_status', v_registration_status,
    'verification_status', v_verification_status,
    'evidence_status', v_evidence_status,
    'recorded_by', v_actor,
    'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.staff_certificate_versions (
    organization_id, branch_id, certificate_key, version, previous_version_id,
    record_status, correction_reason, staff_membership_id, staff_user_id,
    staff_display_name, staff_employee_code, certificate_type,
    certificate_number, effective_on, expires_on, registration_status,
    verification_status, evidence_status, attachment_reference,
    attachment_sha256, recorded_by, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_certificate_key,
    v_version, p_previous_version_id, v_record_status, v_correction_reason,
    p_staff_membership_id, v_staff_user_id, v_staff_display_name,
    v_staff_employee_code, v_certificate_type, v_certificate_number,
    p_effective_on, p_expires_on, v_registration_status,
    v_verification_status, v_evidence_status, v_attachment_reference,
    v_attachment_sha256, v_actor, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.manage'
     ) or not private.staff_certificate_target_in_scope(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id, true
     ) then
    raise exception using errcode = '40001',
      message = 'certificate final verification failed';
  end if;

  insert into private.staff_certificate_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_record_version_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    v_result.certificate_key, v_result.id, v_result.version,
    v_result.previous_version_id, v_result.record_status,
    v_result.staff_membership_id, v_result.content_hash,
    v_result.recorded_at, false;
end;
$$;

create or replace function private.request_staff_certificate_exception_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_certificate_key uuid,
  p_certificate_version_id uuid,
  p_expected_certificate_version integer,
  p_valid_from date,
  p_valid_through date,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, action text, request_id uuid,
  certificate_key uuid, certificate_version_id uuid,
  expected_certificate_version integer, approval_id uuid,
  approval_count integer, exception_status text, valid_from date,
  valid_through date, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_today date;
  v_reason text := nullif(btrim(p_reason), '');
  v_challenge_id uuid;
  v_display_name text;
  v_request_hash text;
  v_content_hash text;
  v_record public.staff_certificate_versions%rowtype;
  v_operation private.staff_certificate_exception_operations%rowtype;
  v_result private.staff_certificate_exception_requests%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_certificate_key is null or p_certificate_version_id is null
     or p_expected_certificate_version is null
     or p_expected_certificate_version < 1 or p_idempotency_key is null
     or not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.exceptions'
     ) then
    raise exception using errcode = '42501',
      message = 'certificate exception request is not permitted';
  end if;
  if p_valid_from is null or p_valid_through is null
     or p_valid_through < p_valid_from
     or extract(year from p_valid_from) not between 1900 and 2200
     or extract(year from p_valid_through) not between 1900 and 2200
     or v_reason is null or char_length(v_reason) > 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'certificate exception period or reason is invalid';
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Asia/Taipei')::date;
  if p_valid_through < v_today then
    raise exception using errcode = '22023',
      message = 'certificate exception must have a finite future end date';
  end if;
  v_challenge_id := private.require_staff_certificate_reauth(v_actor, v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-certificate-exception-operation:' || v_actor::text || ':' ||
      p_idempotency_key::text, 0
  ));

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', 'request',
    'certificate_key', p_certificate_key,
    'certificate_version_id', p_certificate_version_id,
    'expected_certificate_version', p_expected_certificate_version,
    'valid_from', p_valid_from,
    'valid_through', p_valid_through,
    'reason', v_reason
  )::text, 'UTF8')), 'hex');
  select operation.* into v_operation
  from private.staff_certificate_exception_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash
       or v_operation.operation_kind <> 'request' then
      raise exception using errcode = '23505',
        message = 'certificate exception key reused with different content';
    end if;
    select request.* into v_result
    from private.staff_certificate_exception_requests request
    where request.id = v_operation.result_request_id
      and request.organization_id = p_expected_organization_id
      and request.branch_id = p_expected_branch_id
      and request.certificate_key = p_certificate_key;
    if not found or not private.staff_certificate_current_authority(
         p_expected_organization_id, p_expected_branch_id,
         'staff_certificates.exceptions'
       ) then
      raise exception using errcode = '42501',
        message = 'certificate exception replay is no longer permitted';
    end if;
    perform private.require_staff_certificate_reauth(v_actor, clock_timestamp());
    return query select v_result.organization_id, v_result.branch_id,
      'request'::text, v_result.id, v_result.certificate_key,
      v_result.certificate_version_id, v_result.expected_certificate_version,
      null::uuid, 0, 'pending'::text, v_result.valid_from,
      v_result.valid_through, v_result.requested_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-certificate:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_certificate_key::text, 0
  ));
  select record.* into v_record
  from public.staff_certificate_versions record
  where record.id = p_certificate_version_id
    and record.organization_id = p_expected_organization_id
    and record.branch_id = p_expected_branch_id
    and record.certificate_key = p_certificate_key
  for share;
  if not found or v_record.version <> p_expected_certificate_version
     or v_record.record_status <> 'active'
     or exists (
       select 1 from public.staff_certificate_versions later
       where later.certificate_key = p_certificate_key
         and later.version > v_record.version
     )
     or not private.staff_certificate_can_access_target(
       p_expected_organization_id, p_expected_branch_id,
       v_record.staff_membership_id
     ) then
    raise exception using errcode = '40001',
      message = 'certificate exception base version is stale or out of scope';
  end if;

  select btrim(profile.display_name) into v_display_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_display_name is null then
    raise exception using errcode = '42501',
      message = 'certificate exception requester identity is unavailable';
  end if;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'certificate_key', p_certificate_key,
    'certificate_version_id', p_certificate_version_id,
    'expected_certificate_version', p_expected_certificate_version,
    'valid_from', p_valid_from,
    'valid_through', p_valid_through,
    'reason', v_reason,
    'requested_by', v_actor,
    'requester_reauth_challenge_id', v_challenge_id,
    'requested_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into private.staff_certificate_exception_requests (
    organization_id, branch_id, certificate_key, certificate_version_id,
    expected_certificate_version, valid_from, valid_through, reason,
    requested_by, requester_display_name, requester_reauth_challenge_id,
    requested_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_certificate_key,
    p_certificate_version_id, p_expected_certificate_version,
    p_valid_from, p_valid_through, v_reason, v_actor, v_display_name,
    v_challenge_id, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.exceptions'
     ) or private.require_staff_certificate_reauth(
       v_actor, clock_timestamp()
     ) is null then
    raise exception using errcode = '42501',
      message = 'certificate exception request final verification failed';
  end if;

  insert into private.staff_certificate_exception_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_request_id, result_approval_id,
    result_approval_count, result_status, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'request', v_request_hash, v_result.id, null,
    0, 'pending', v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    'request'::text, v_result.id, v_result.certificate_key,
    v_result.certificate_version_id, v_result.expected_certificate_version,
    null::uuid, 0, 'pending'::text, v_result.valid_from,
    v_result.valid_through, v_result.requested_at, false;
end;
$$;

create or replace function private.approve_staff_certificate_exception_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_expected_certificate_version integer,
  p_expected_approval_count integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, action text, request_id uuid,
  certificate_key uuid, certificate_version_id uuid,
  expected_certificate_version integer, approval_id uuid,
  approval_count integer, exception_status text, valid_from date,
  valid_through date, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_today date;
  v_challenge_id uuid;
  v_display_name text;
  v_request_hash text;
  v_content_hash text;
  v_operation private.staff_certificate_exception_operations%rowtype;
  v_request private.staff_certificate_exception_requests%rowtype;
  v_record public.staff_certificate_versions%rowtype;
  v_result private.staff_certificate_exception_approvals%rowtype;
  v_current_approval_count integer;
  v_new_approval_count integer;
  v_status text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_request_id is null or p_expected_certificate_version is null
     or p_expected_certificate_version < 1
     or p_expected_approval_count not in (0, 1) or p_idempotency_key is null
     or not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.exceptions'
     ) then
    raise exception using errcode = '42501',
      message = 'certificate exception approval is not permitted';
  end if;
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Asia/Taipei')::date;
  v_challenge_id := private.require_staff_certificate_reauth(v_actor, v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-certificate-exception-operation:' || v_actor::text || ':' ||
      p_idempotency_key::text, 0
  ));
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', 'approve',
    'request_id', p_request_id,
    'expected_certificate_version', p_expected_certificate_version,
    'expected_approval_count', p_expected_approval_count
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_certificate_exception_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash
       or v_operation.operation_kind <> 'approve' then
      raise exception using errcode = '23505',
        message = 'certificate exception key reused with different content';
    end if;
    select request.* into v_request
    from private.staff_certificate_exception_requests request
    where request.id = v_operation.result_request_id
      and request.organization_id = p_expected_organization_id
      and request.branch_id = p_expected_branch_id;
    select approval.* into v_result
    from private.staff_certificate_exception_approvals approval
    where approval.id = v_operation.result_approval_id
      and approval.request_id = p_request_id;
    if v_request.id is null or v_result.id is null
       or not private.staff_certificate_current_authority(
         p_expected_organization_id, p_expected_branch_id,
         'staff_certificates.exceptions'
       ) then
      raise exception using errcode = '42501',
        message = 'certificate exception replay is no longer permitted';
    end if;
    perform private.require_staff_certificate_reauth(v_actor, clock_timestamp());
    return query select v_request.organization_id, v_request.branch_id,
      'approve'::text, v_request.id, v_request.certificate_key,
      v_request.certificate_version_id, v_request.expected_certificate_version,
      v_result.id, v_operation.result_approval_count,
      v_operation.result_status, v_request.valid_from, v_request.valid_through,
      v_result.approved_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-certificate-exception:' || p_request_id::text, 0
  ));
  select request.* into v_request
  from private.staff_certificate_exception_requests request
  where request.id = p_request_id
    and request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id
  for share;
  if not found or v_request.requested_by = v_actor
     or v_request.expected_certificate_version <> p_expected_certificate_version
     or v_request.valid_through < v_today then
    raise exception using errcode = '42501',
      message = 'certificate exception requires a distinct current approver';
  end if;
  select record.* into v_record
  from public.staff_certificate_versions record
  where record.id = v_request.certificate_version_id
    and record.organization_id = p_expected_organization_id
    and record.branch_id = p_expected_branch_id
    and record.certificate_key = v_request.certificate_key
  for share;
  if not found or v_record.version <> p_expected_certificate_version
     or v_record.record_status <> 'active'
     or exists (
       select 1 from public.staff_certificate_versions later
       where later.certificate_key = v_request.certificate_key
         and later.version > v_record.version
     )
     or not private.staff_certificate_user_has_permission(
       p_expected_organization_id, p_expected_branch_id,
       v_request.requested_by, 'staff_certificates.exceptions'
     )
     or not private.staff_certificate_can_access_target(
       p_expected_organization_id, p_expected_branch_id,
       v_record.staff_membership_id
     ) then
    raise exception using errcode = '40001',
      message = 'certificate exception base or requester authority changed';
  end if;

  select count(*)::integer into v_current_approval_count
  from private.staff_certificate_exception_approvals approval
  where approval.request_id = p_request_id;
  if v_current_approval_count <> p_expected_approval_count
     or v_current_approval_count >= 2
     or exists (
       select 1 from private.staff_certificate_exception_approvals approval
       where approval.request_id = p_request_id
         and approval.approved_by = v_actor
     ) then
    raise exception using errcode = '40001',
      message = 'certificate exception approval count is stale';
  end if;

  select btrim(profile.display_name) into v_display_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_display_name is null then
    raise exception using errcode = '42501',
      message = 'certificate exception approver identity is unavailable';
  end if;
  v_new_approval_count := v_current_approval_count + 1;
  v_status := case when v_new_approval_count = 2 then 'approved' else 'pending' end;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'request_id', p_request_id,
    'approval_number', v_new_approval_count,
    'approved_by', v_actor,
    'approver_reauth_challenge_id', v_challenge_id,
    'approved_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into private.staff_certificate_exception_approvals (
    organization_id, branch_id, request_id, approval_number,
    approved_by, approver_display_name, approver_reauth_challenge_id,
    approved_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_request_id,
    v_new_approval_count, v_actor, v_display_name, v_challenge_id,
    v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.exceptions'
     ) or private.require_staff_certificate_reauth(
       v_actor, clock_timestamp()
     ) is null then
    raise exception using errcode = '42501',
      message = 'certificate exception approval final verification failed';
  end if;

  insert into private.staff_certificate_exception_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_request_id, result_approval_id,
    result_approval_count, result_status, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'approve', v_request_hash, p_request_id, v_result.id,
    v_new_approval_count, v_status, v_now
  );

  return query select v_request.organization_id, v_request.branch_id,
    'approve'::text, v_request.id, v_request.certificate_key,
    v_request.certificate_version_id, v_request.expected_certificate_version,
    v_result.id, v_new_approval_count, v_status,
    v_request.valid_from, v_request.valid_through, v_result.approved_at, false;
end;
$$;

create or replace function private.staff_certificate_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_staff_membership_id uuid,
  p_certificate_type text,
  p_status text,
  p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Taipei')::date;
  v_certificate_type text := nullif(btrim(p_certificate_type), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_search text := lower(nullif(btrim(p_search), ''));
  v_records jsonb := '[]'::jsonb;
  v_record_total bigint := 0;
  v_history jsonb := '[]'::jsonb;
  v_history_total bigint := 0;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_type_options jsonb := '[]'::jsonb;
  v_type_total bigint := 0;
  v_exception_requests jsonb := '[]'::jsonb;
  v_exception_total bigint := 0;
  v_valid_total bigint := 0;
  v_expired_total bigint := 0;
  v_pending_verification_total bigint := 0;
begin
  with latest as (
    select distinct on (record.certificate_key) record.*
    from public.staff_certificate_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_certificate_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.certificate_key, record.version desc
  ), exception_state as (
    select request.id as request_id,
      request.certificate_version_id,
      request.valid_from,
      request.valid_through,
      count(approval.id)::integer as approval_count
    from private.staff_certificate_exception_requests request
    left join private.staff_certificate_exception_approvals approval
      on approval.request_id = request.id
    where request.organization_id = p_expected_organization_id
      and request.branch_id = p_expected_branch_id
    group by request.id
  ), derived as (
    select latest.*,
      case
        when latest.record_status = 'voided' then 'voided'
        when latest.effective_on > v_today then 'upcoming'
        when latest.expires_on is not null and latest.expires_on < v_today then 'expired'
        when latest.verification_status <> 'verified' then 'pending_verification'
        when latest.registration_status not in ('registered', 'not_required')
          then 'registration_not_active'
        else 'active'
      end as validity_status,
      coalesce((select bool_or(state.approval_count = 2
        and v_today between state.valid_from and state.valid_through)
        from exception_state state
        where state.certificate_version_id = latest.id), false) as has_active_exception,
      coalesce((select max(state.approval_count)
        from exception_state state
        where state.certificate_version_id = latest.id), 0) as approval_count
    from latest
  ), filtered as (
    select derived.*, coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from derived
    left join public.profiles recorder on recorder.id = derived.recorded_by
    where (p_staff_membership_id is null
        or derived.staff_membership_id = p_staff_membership_id)
      and (v_certificate_type is null
        or derived.certificate_type = v_certificate_type)
      and (v_status = 'all' or derived.validity_status = v_status)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        derived.staff_display_name, derived.staff_employee_code,
        derived.certificate_type, derived.certificate_number
      ))) > 0)
  ), ranked as (
    select filtered.*, row_number() over (
      order by coalesce(expires_on, 'infinity'::date),
        staff_display_name collate "C", certificate_key
    ) as row_number
    from filtered
  )
  select count(*)::bigint,
    count(*) filter (where validity_status = 'active')::bigint,
    count(*) filter (where validity_status = 'expired')::bigint,
    count(*) filter (where validity_status = 'pending_verification')::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'certificate_key', certificate_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'staff_display_name', staff_display_name,
      'staff_employee_code', staff_employee_code,
      'certificate_type', certificate_type,
      'certificate_number', certificate_number,
      'effective_on', effective_on,
      'expires_on', expires_on,
      'registration_status', registration_status,
      'verification_status', verification_status,
      'evidence_status', evidence_status,
      'validity_status', validity_status,
      'has_active_exception', has_active_exception,
      'approval_count', approval_count,
      'service_eligibility_status', 'not_evaluated',
      'recorded_by', recorded_by,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by coalesce(expires_on, 'infinity'::date),
      staff_display_name collate "C", certificate_key)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_record_total, v_valid_total, v_expired_total,
    v_pending_verification_total, v_records
  from ranked;

  with visible as (
    select record.*, coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from public.staff_certificate_versions record
    left join public.profiles recorder on recorder.id = record.recorded_by
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_certificate_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
      and (p_staff_membership_id is null
        or record.staff_membership_id = p_staff_membership_id)
      and (v_certificate_type is null
        or record.certificate_type = v_certificate_type)
  ), ranked as (
    select visible.*, row_number() over (
      order by certificate_key, version desc
    ) as row_number from visible
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'certificate_key', certificate_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'certificate_type', certificate_type,
      'certificate_number', certificate_number,
      'effective_on', effective_on,
      'expires_on', expires_on,
      'registration_status', registration_status,
      'verification_status', verification_status,
      'evidence_status', evidence_status,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by certificate_key, version desc)
      filter (where row_number <= 500), '[]'::jsonb)
  into v_history_total, v_history from ranked;

  with latest as (
    select distinct on (record.certificate_key) record.*
    from public.staff_certificate_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_certificate_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.certificate_key, record.version desc
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
      and private.staff_certificate_can_access_target(
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
    select distinct on (record.certificate_key) record.*
    from public.staff_certificate_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_certificate_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.certificate_key, record.version desc
  ), grouped as (
    select certificate_type, count(*)::bigint as record_count
    from latest group by certificate_type
  ), ranked as (
    select grouped.*, row_number() over (
      order by certificate_type collate "C"
    ) as row_number from grouped
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'certificate_type', certificate_type,
      'record_count', record_count
    ) order by certificate_type collate "C")
      filter (where row_number <= 200), '[]'::jsonb)
  into v_type_total, v_type_options from ranked;

  if private.has_permission(
    p_expected_organization_id, p_expected_branch_id,
    'staff_certificates.exceptions'
  ) then
    with states as (
      select request.*,
        count(approval.id)::integer as approval_count,
        coalesce(jsonb_agg(jsonb_build_object(
          'approval_number', approval.approval_number,
          'approved_by', approval.approved_by,
          'approver_display_name', approval.approver_display_name,
          'approved_at', approval.approved_at
        ) order by approval.approval_number)
          filter (where approval.id is not null), '[]'::jsonb) as approvals
      from private.staff_certificate_exception_requests request
      left join private.staff_certificate_exception_approvals approval
        on approval.request_id = request.id
      where request.organization_id = p_expected_organization_id
        and request.branch_id = p_expected_branch_id
      group by request.id
    ), visible as (
      select states.*,
        case
          when valid_through < v_today then 'expired'
          when approval_count = 2 then 'approved'
          else 'pending'
        end as exception_status
      from states
      join public.staff_certificate_versions record
        on record.id = states.certificate_version_id
      where private.staff_certificate_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    ), ranked as (
      select visible.*, row_number() over (
        order by case exception_status when 'pending' then 0 else 1 end,
          valid_through, id
      ) as row_number from visible
    )
    select count(*)::bigint,
      coalesce(jsonb_agg(jsonb_build_object(
        'request_id', id,
        'certificate_key', certificate_key,
        'certificate_version_id', certificate_version_id,
        'expected_certificate_version', expected_certificate_version,
        'valid_from', valid_from,
        'valid_through', valid_through,
        'reason', reason,
        'requested_by', requested_by,
        'requester_display_name', requester_display_name,
        'requested_at', requested_at,
        'approval_count', approval_count,
        'exception_status', exception_status,
        'approvals', approvals
      ) order by case exception_status when 'pending' then 0 else 1 end,
        valid_through, id) filter (where row_number <= 200), '[]'::jsonb)
    into v_exception_total, v_exception_requests from ranked;
  end if;

  return jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_now,
    'snapshot_date', v_today,
    'records', v_records,
    'record_total', v_record_total,
    'records_truncated', v_record_total > 200,
    'valid_total', v_valid_total,
    'expired_total', v_expired_total,
    'pending_verification_total', v_pending_verification_total,
    'history', v_history,
    'history_total', v_history_total,
    'history_truncated', v_history_total > 500,
    'staff_options', v_staff_options,
    'staff_total', v_staff_total,
    'staff_truncated', v_staff_total > 200,
    'certificate_type_options', v_type_options,
    'certificate_type_total', v_type_total,
    'certificate_types_truncated', v_type_total > 200,
    'exception_requests', v_exception_requests,
    'exception_request_total', v_exception_total,
    'exception_requests_truncated', v_exception_total > 200,
    'expiry_reminder_policy_status', 'not_configured',
    'expiry_notice_days', null,
    'expiring_total', null,
    'restricted_service_policy_status', 'not_configured',
    'service_eligibility_scope', 'not_evaluated',
    'attachment_pipeline_status', 'not_configured',
    'attachment_scan_status', 'not_configured'
  );
end;
$$;

create or replace function private.staff_certificate_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_certificate_type text,
  p_status text,
  p_search text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, valid_total bigint, expired_total bigint,
  pending_verification_total bigint, history jsonb, history_total bigint,
  history_truncated boolean, staff_options jsonb, staff_total bigint,
  staff_truncated boolean, certificate_type_options jsonb,
  certificate_type_total bigint, certificate_types_truncated boolean,
  exception_requests jsonb, exception_request_total bigint,
  exception_requests_truncated boolean, expiry_reminder_policy_status text,
  expiry_notice_days integer, expiring_total bigint,
  restricted_service_policy_status text, service_eligibility_scope text,
  attachment_pipeline_status text, attachment_scan_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_type text := nullif(btrim(p_certificate_type), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_search text := nullif(btrim(p_search), '');
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_status not in (
       'all', 'active', 'upcoming', 'expired', 'pending_verification',
       'registration_not_active', 'voided'
     )
     or (v_type is not null and (
       char_length(v_type) > 120 or v_type ~ '[[:cntrl:]]'
     ))
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]'
     ))
     or not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff certificate snapshot is not permitted';
  end if;
  if p_staff_membership_id is not null
     and not private.staff_certificate_can_access_target(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff certificate target is outside current scope';
  end if;
  v_now := clock_timestamp();
  v_bundle := private.staff_certificate_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_type, v_status, v_search
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_certificate_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page72_staff_certificates_v1',
      'generated_at', v_now,
      'staff_filter_present', p_staff_membership_id is not null,
      'certificate_type_filter_present', v_type is not null,
      'status', v_status,
      'search_present', v_search is not null,
      'record_total', v_bundle -> 'record_total',
      'exception_request_total', v_bundle -> 'exception_request_total'
    )
  );

  if not private.staff_certificate_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_certificates.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff certificate snapshot final verification failed';
  end if;
  v_after := private.staff_certificate_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_type, v_status, v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff certificate snapshot changed during audit';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    (v_bundle ->> 'valid_total')::bigint,
    (v_bundle ->> 'expired_total')::bigint,
    (v_bundle ->> 'pending_verification_total')::bigint,
    v_bundle -> 'history',
    (v_bundle ->> 'history_total')::bigint,
    (v_bundle ->> 'history_truncated')::boolean,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'certificate_type_options',
    (v_bundle ->> 'certificate_type_total')::bigint,
    (v_bundle ->> 'certificate_types_truncated')::boolean,
    v_bundle -> 'exception_requests',
    (v_bundle ->> 'exception_request_total')::bigint,
    (v_bundle ->> 'exception_requests_truncated')::boolean,
    v_bundle ->> 'expiry_reminder_policy_status',
    (v_bundle ->> 'expiry_notice_days')::integer,
    (v_bundle ->> 'expiring_total')::bigint,
    v_bundle ->> 'restricted_service_policy_status',
    v_bundle ->> 'service_eligibility_scope',
    v_bundle ->> 'attachment_pipeline_status',
    v_bundle ->> 'attachment_scan_status';
end;
$$;

create or replace function public.append_staff_certificate(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_certificate_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_certificate_type text,
  p_certificate_number text,
  p_effective_on date,
  p_expires_on date,
  p_registration_status text,
  p_verification_status text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, certificate_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  recorded_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_staff_certificate_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_certificate_key, p_previous_version_id, p_expected_base_version,
    p_staff_membership_id, p_certificate_type, p_certificate_number,
    p_effective_on, p_expires_on, p_registration_status,
    p_verification_status, p_evidence_status, p_attachment_reference,
    p_attachment_sha256, p_correction_reason, p_idempotency_key
  );
$$;

create or replace function public.request_staff_certificate_exception(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_certificate_key uuid,
  p_certificate_version_id uuid,
  p_expected_certificate_version integer,
  p_valid_from date,
  p_valid_through date,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, action text, request_id uuid,
  certificate_key uuid, certificate_version_id uuid,
  expected_certificate_version integer, approval_id uuid,
  approval_count integer, exception_status text, valid_from date,
  valid_through date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.request_staff_certificate_exception_guarded(
    p_expected_organization_id, p_expected_branch_id, p_certificate_key,
    p_certificate_version_id, p_expected_certificate_version,
    p_valid_from, p_valid_through, p_reason, p_idempotency_key
  );
$$;

create or replace function public.approve_staff_certificate_exception(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_expected_certificate_version integer,
  p_expected_approval_count integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, action text, request_id uuid,
  certificate_key uuid, certificate_version_id uuid,
  expected_certificate_version integer, approval_id uuid,
  approval_count integer, exception_status text, valid_from date,
  valid_through date, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.approve_staff_certificate_exception_guarded(
    p_expected_organization_id, p_expected_branch_id, p_request_id,
    p_expected_certificate_version, p_expected_approval_count,
    p_idempotency_key
  );
$$;

create or replace function public.staff_certificate_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid default null,
  p_certificate_type text default null,
  p_status text default 'all',
  p_search text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, valid_total bigint, expired_total bigint,
  pending_verification_total bigint, history jsonb, history_total bigint,
  history_truncated boolean, staff_options jsonb, staff_total bigint,
  staff_truncated boolean, certificate_type_options jsonb,
  certificate_type_total bigint, certificate_types_truncated boolean,
  exception_requests jsonb, exception_request_total bigint,
  exception_requests_truncated boolean, expiry_reminder_policy_status text,
  expiry_notice_days integer, expiring_total bigint,
  restricted_service_policy_status text, service_eligibility_scope text,
  attachment_pipeline_status text, attachment_scan_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.staff_certificate_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_staff_membership_id, p_certificate_type, p_status, p_search
  );
$$;

alter table public.staff_certificate_versions enable row level security;
alter table public.staff_certificate_versions force row level security;
create policy staff_certificate_versions_select
on public.staff_certificate_versions for select to authenticated
using (private.staff_certificate_can_access_target(
  organization_id, branch_id, staff_membership_id
));

revoke all on table public.staff_certificate_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_certificate_operations
  from public, anon, authenticated, service_role;
revoke all on table private.staff_certificate_exception_requests
  from public, anon, authenticated, service_role;
revoke all on table private.staff_certificate_exception_approvals
  from public, anon, authenticated, service_role;
revoke all on table private.staff_certificate_exception_operations
  from public, anon, authenticated, service_role;

revoke all on function private.staff_certificate_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_certificate_current_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_certificate_user_has_permission(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_certificate_target_in_scope(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_certificate_can_access_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_staff_certificate_reauth(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.append_staff_certificate_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date, date,
  text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.request_staff_certificate_exception_guarded(
  uuid, uuid, uuid, uuid, integer, date, date, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.approve_staff_certificate_exception_guarded(
  uuid, uuid, uuid, integer, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.staff_certificate_snapshot_bundle(
  uuid, uuid, timestamptz, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_certificate_snapshot_response(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.append_staff_certificate(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date, date,
  text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.request_staff_certificate_exception(
  uuid, uuid, uuid, uuid, integer, date, date, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.approve_staff_certificate_exception(
  uuid, uuid, uuid, integer, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.staff_certificate_snapshot(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.append_staff_certificate(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date, date,
  text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.request_staff_certificate_exception(
  uuid, uuid, uuid, uuid, integer, date, date, text, uuid
) to authenticated;
grant execute on function public.approve_staff_certificate_exception(
  uuid, uuid, uuid, integer, integer, uuid
) to authenticated;
grant execute on function public.staff_certificate_snapshot(
  uuid, uuid, uuid, text, text, text
) to authenticated;

grant execute on function private.append_staff_certificate_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date, date,
  text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.request_staff_certificate_exception_guarded(
  uuid, uuid, uuid, uuid, integer, date, date, text, uuid
) to authenticated;
grant execute on function private.approve_staff_certificate_exception_guarded(
  uuid, uuid, uuid, integer, integer, uuid
) to authenticated;
grant execute on function private.staff_certificate_snapshot_response(
  uuid, uuid, uuid, text, text, text
) to authenticated;

comment on table public.staff_certificate_versions is
  'Immutable employee certificate originals, corrections and void versions; evidence is a trusted server reference only.';
comment on function public.staff_certificate_snapshot(uuid, uuid, uuid, text, text, text) is
  'Returns one audited page-72 snapshot. Service eligibility and reminder policy remain not evaluated until institution rules are published.';
comment on function public.approve_staff_certificate_exception(uuid, uuid, uuid, integer, integer, uuid) is
  'Appends one of two distinct recent-AAL2 approvals; the requester cannot approve their own finite exception.';
