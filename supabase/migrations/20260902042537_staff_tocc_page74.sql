-- Page 74: immutable, scoped employee TOCC facts. This slice is deliberately
-- separate from client TOCC authorization. Valid-through is supplied per row
-- with a human-readable source; no institutional duration rule, diagnostic
-- taxonomy, reminder schedule, or attachment pipeline is inferred here.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_tocc.read', 'Read scoped sensitive employee TOCC records', 3),
  ('staff_tocc.manage', 'Append scoped sensitive employee TOCC versions', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('staff_tocc.read', 'staff_tocc.manage')
on conflict (role_id, permission_id) do nothing;

create table public.staff_tocc_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  tocc_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  staff_membership_id uuid not null references public.memberships(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_display_name text not null,
  staff_employee_code text,
  assessed_on date not null,
  valid_through date not null,
  validity_source text not null,
  result_text text not null,
  manual_attention_flag boolean not null,
  attention_note text,
  evidence_status text not null,
  attachment_reference text,
  attachment_sha256 text,
  disposition_status text not null,
  disposition_note text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint staff_tocc_branch_scope_fkey foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_tocc_id_scope_key unique (id, organization_id, branch_id, tocc_key),
  constraint staff_tocc_id_branch_scope_key unique (id, organization_id, branch_id),
  constraint staff_tocc_chain_key unique (tocc_key, version),
  constraint staff_tocc_previous_unique unique (previous_version_id),
  constraint staff_tocc_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, tocc_key
  ) references public.staff_tocc_versions(
    id, organization_id, branch_id, tocc_key
  ) on delete restrict,
  constraint staff_tocc_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null)
      or (version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000))
  ),
  constraint staff_tocc_status_check check (record_status in ('active', 'voided')),
  constraint staff_tocc_dates_check check (
    extract(year from assessed_on) between 1900 and 2200
    and extract(year from valid_through) between 1900 and 2200
    and valid_through >= assessed_on
  ),
  constraint staff_tocc_validity_source_check check (
    char_length(validity_source) between 1 and 240
    and validity_source !~ '[[:cntrl:]]'
  ),
  constraint staff_tocc_result_check check (
    char_length(result_text) between 1 and 1000
    and translate(result_text, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint staff_tocc_attention_alignment_check check (
    (manual_attention_flag and char_length(attention_note) between 1 and 1000)
    or (not manual_attention_flag and attention_note is null)
  ),
  constraint staff_tocc_evidence_check check (
    evidence_status in ('provided', 'missing', 'not_applicable')
    and ((evidence_status = 'provided'
      and char_length(attachment_reference) between 1 and 500
      and attachment_sha256 ~ '^[a-f0-9]{64}$')
      or (evidence_status in ('missing', 'not_applicable')
        and attachment_reference is null and attachment_sha256 is null))
  ),
  constraint staff_tocc_disposition_check check (
    disposition_status in ('not_recorded', 'pending', 'in_progress', 'completed')
    and ((disposition_status = 'not_recorded' and disposition_note is null)
      or (disposition_status <> 'not_recorded'
        and char_length(disposition_note) between 1 and 1000))
  ),
  constraint staff_tocc_staff_snapshot_check check (
    char_length(staff_display_name) between 1 and 120
    and staff_display_name !~ '[[:cntrl:]]'
    and (staff_employee_code is null or (
      char_length(staff_employee_code) between 1 and 120
      and staff_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_tocc_multiline_text_check check (
    (correction_reason is null or
      translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (attention_note is null or
      translate(attention_note, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (disposition_note is null or
      translate(disposition_note, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (attachment_reference is null or attachment_reference !~ '[[:cntrl:]]')
  ),
  constraint staff_tocc_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_tocc_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_version_id uuid not null,
  result_evaluated_on date not null,
  result_expiry_warning boolean not null,
  result_manual_attention_warning boolean not null,
  result_warning_basis text not null,
  created_at timestamptz not null,
  constraint staff_tocc_operation_actor_key unique (actor_user_id, idempotency_key),
  constraint staff_tocc_operation_result_scope_fkey foreign key (
    result_record_version_id, organization_id, branch_id
  ) references public.staff_tocc_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_tocc_operation_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint staff_tocc_operation_warning_check check (
    result_warning_basis = 'manual_valid_through_and_manual_attention_flag'
  )
);

create index staff_tocc_scope_validity_idx on public.staff_tocc_versions(
  organization_id, branch_id, valid_through, assessed_on desc, tocc_key, version desc
);
create index staff_tocc_membership_idx on public.staff_tocc_versions(staff_membership_id);
create index staff_tocc_staff_user_idx on public.staff_tocc_versions(staff_user_id);
create index staff_tocc_recorded_by_idx on public.staff_tocc_versions(recorded_by);
create index staff_tocc_previous_idx on public.staff_tocc_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_tocc_operation_actor_idx
  on private.staff_tocc_operations(actor_user_id, idempotency_key);
create index staff_tocc_operation_result_idx on private.staff_tocc_operations(
  result_record_version_id, organization_id, branch_id
);
create index staff_tocc_operation_scope_idx
  on private.staff_tocc_operations(organization_id, branch_id);

create or replace function private.staff_tocc_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger staff_tocc_versions_append_only before update or delete
on public.staff_tocc_versions for each row
execute function private.staff_tocc_append_only();
create trigger staff_tocc_operations_append_only before update or delete
on private.staff_tocc_operations for each row
execute function private.staff_tocc_append_only();
create trigger staff_tocc_versions_audit_row_change after insert
on public.staff_tocc_versions for each row execute function private.audit_row_change();

create or replace function private.staff_tocc_current_authority(
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

create or replace function private.staff_tocc_target_in_scope(
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

create or replace function private.staff_tocc_can_access_target(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_tocc_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_tocc.read'
    )
    and private.staff_tocc_target_in_scope(
      p_expected_organization_id, p_expected_branch_id, p_staff_membership_id, false
    )
    and (
      exists (
        select 1 from public.memberships membership
        where membership.id = p_staff_membership_id
          and membership.profile_id = auth.uid()
      )
      or private.has_permission(
        p_expected_organization_id, p_expected_branch_id, 'staff_tocc.manage'
      )
    );
$$;

create or replace function private.append_staff_tocc_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_tocc_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_assessed_on date,
  p_valid_through date,
  p_validity_source text,
  p_result_text text,
  p_manual_attention_flag boolean,
  p_attention_note text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_disposition_status text,
  p_disposition_note text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, tocc_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  evaluated_on date, expiry_warning boolean,
  manual_attention_warning boolean, warning_basis text,
  recorded_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_validity_source text := nullif(btrim(p_validity_source), '');
  v_result_text text := nullif(btrim(p_result_text), '');
  v_attention_note text := nullif(btrim(p_attention_note), '');
  v_evidence_status text := lower(btrim(coalesce(p_evidence_status, '')));
  v_attachment_reference text := nullif(btrim(p_attachment_reference), '');
  v_attachment_sha256 text := lower(nullif(btrim(p_attachment_sha256), ''));
  v_disposition_status text := lower(btrim(coalesce(p_disposition_status, '')));
  v_disposition_note text := nullif(btrim(p_disposition_note), '');
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_request_hash text;
  v_content_hash text;
  v_now timestamptz;
  v_evaluated_on date;
  v_version integer;
  v_record_status text;
  v_expiry_warning boolean;
  v_manual_attention_warning boolean;
  v_staff_user_id uuid;
  v_staff_display_name text;
  v_staff_employee_code text;
  v_operation private.staff_tocc_operations%rowtype;
  v_previous public.staff_tocc_versions%rowtype;
  v_result public.staff_tocc_versions%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_tocc_key is null or p_staff_membership_id is null
     or p_idempotency_key is null or p_expected_base_version is null
     or p_expected_base_version < 0 or v_action not in ('create', 'correct', 'void')
     or not private.staff_tocc_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_tocc.manage'
     ) then
    raise exception using errcode = '42501', message = 'staff TOCC write is not permitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-tocc-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
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
      raise exception using errcode = '22023', message = 'new staff TOCC base is invalid';
    end if;
  elsif p_previous_version_id is null or p_expected_base_version < 1
     or v_correction_reason is null or char_length(v_correction_reason) > 1000
     or translate(v_correction_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'staff TOCC correction base or reason is invalid';
  end if;

  if v_action in ('create', 'correct') then
    if p_assessed_on is null or p_valid_through is null
       or extract(year from p_assessed_on) not between 1900 and 2200
       or extract(year from p_valid_through) not between 1900 and 2200
       or p_valid_through < p_assessed_on
       or v_validity_source is null or char_length(v_validity_source) > 240
       or v_validity_source ~ '[[:cntrl:]]'
       or v_result_text is null or char_length(v_result_text) > 1000
       or translate(v_result_text, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_manual_attention_flag is null
       or (p_manual_attention_flag and (
         v_attention_note is null or char_length(v_attention_note) > 1000
         or translate(v_attention_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
       ))
       or (not p_manual_attention_flag and v_attention_note is not null)
       or v_evidence_status not in ('missing', 'not_applicable')
       or v_attachment_reference is not null or v_attachment_sha256 is not null
       or v_disposition_status not in (
         'not_recorded', 'pending', 'in_progress', 'completed'
       )
       or (v_disposition_status = 'not_recorded' and v_disposition_note is not null)
       or (v_disposition_status <> 'not_recorded' and (
         v_disposition_note is null or char_length(v_disposition_note) > 1000
         or translate(v_disposition_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
       )) then
      raise exception using errcode = '22023',
        message = 'staff TOCC content or attachment evidence is invalid';
    end if;
  elsif p_assessed_on is not null or p_valid_through is not null
     or v_validity_source is not null or v_result_text is not null
     or p_manual_attention_flag is not null or v_attention_note is not null
     or v_evidence_status <> '' or v_attachment_reference is not null
     or v_attachment_sha256 is not null or v_disposition_status <> ''
     or v_disposition_note is not null then
    raise exception using errcode = '22023',
      message = 'void operation must copy immutable prior TOCC content';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'tocc_key', p_tocc_key,
    'previous_version_id', p_previous_version_id,
    'expected_base_version', p_expected_base_version,
    'staff_membership_id', p_staff_membership_id,
    'assessed_on', p_assessed_on,
    'valid_through', p_valid_through,
    'validity_source', v_validity_source,
    'result_text', v_result_text,
    'manual_attention_flag', p_manual_attention_flag,
    'attention_note', v_attention_note,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'disposition_status', v_disposition_status,
    'disposition_note', v_disposition_note,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_tocc_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'staff TOCC idempotency key reused with different content';
    end if;
    select record.* into v_result
    from public.staff_tocc_versions record
    where record.id = v_operation.result_record_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.tocc_key = p_tocc_key
      and record.staff_membership_id = p_staff_membership_id;
    if not found or not private.staff_tocc_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'staff_tocc.manage'
       ) then
      raise exception using errcode = '42501',
        message = 'staff TOCC replay is no longer permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.tocc_key, v_result.id, v_result.version,
      v_result.previous_version_id, v_result.record_status,
      v_result.staff_membership_id, v_result.content_hash,
      v_operation.result_evaluated_on, v_operation.result_expiry_warning,
      v_operation.result_manual_attention_warning,
      v_operation.result_warning_basis, v_result.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-tocc:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_tocc_key::text, 0
  ));
  if v_action = 'create' then
    if exists (
      select 1 from public.staff_tocc_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.tocc_key = p_tocc_key
    ) then
      raise exception using errcode = '23505', message = 'staff TOCC key already exists';
    end if;
    v_version := 1;
    v_record_status := 'active';
  else
    select record.* into v_previous
    from public.staff_tocc_versions record
    where record.id = p_previous_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.tocc_key = p_tocc_key
      and record.staff_membership_id = p_staff_membership_id
    for share;
    if not found or v_previous.version <> p_expected_base_version
       or v_previous.record_status <> 'active'
       or exists (
         select 1 from public.staff_tocc_versions later
         where later.tocc_key = p_tocc_key and later.version > v_previous.version
       ) then
      raise exception using errcode = '40001', message = 'staff TOCC base version is stale';
    end if;
    v_version := v_previous.version + 1;
    v_record_status := case when v_action = 'void' then 'voided' else 'active' end;
    if v_action = 'void' then
      p_assessed_on := v_previous.assessed_on;
      p_valid_through := v_previous.valid_through;
      v_validity_source := v_previous.validity_source;
      v_result_text := v_previous.result_text;
      p_manual_attention_flag := v_previous.manual_attention_flag;
      v_attention_note := v_previous.attention_note;
      v_evidence_status := v_previous.evidence_status;
      v_attachment_reference := v_previous.attachment_reference;
      v_attachment_sha256 := v_previous.attachment_sha256;
      v_disposition_status := v_previous.disposition_status;
      v_disposition_note := v_previous.disposition_note;
    end if;
  end if;

  v_now := clock_timestamp();
  v_evaluated_on := (v_now at time zone 'Asia/Taipei')::date;
  v_expiry_warning := v_record_status = 'active' and p_valid_through < v_evaluated_on;
  v_manual_attention_warning := v_record_status = 'active' and p_manual_attention_flag;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'tocc_key', p_tocc_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_status', v_record_status,
    'correction_reason', v_correction_reason,
    'staff_membership_id', p_staff_membership_id,
    'staff_user_id', v_staff_user_id,
    'staff_display_name', v_staff_display_name,
    'staff_employee_code', v_staff_employee_code,
    'assessed_on', p_assessed_on,
    'valid_through', p_valid_through,
    'validity_source', v_validity_source,
    'result_text', v_result_text,
    'manual_attention_flag', p_manual_attention_flag,
    'attention_note', v_attention_note,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'disposition_status', v_disposition_status,
    'disposition_note', v_disposition_note,
    'recorded_by', v_actor,
    'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.staff_tocc_versions (
    organization_id, branch_id, tocc_key, version, previous_version_id,
    record_status, correction_reason, staff_membership_id, staff_user_id,
    staff_display_name, staff_employee_code, assessed_on, valid_through,
    validity_source, result_text, manual_attention_flag, attention_note,
    evidence_status, attachment_reference, attachment_sha256,
    disposition_status, disposition_note, recorded_by, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_tocc_key,
    v_version, p_previous_version_id, v_record_status, v_correction_reason,
    p_staff_membership_id, v_staff_user_id, v_staff_display_name,
    v_staff_employee_code, p_assessed_on, p_valid_through,
    v_validity_source, v_result_text, p_manual_attention_flag, v_attention_note,
    v_evidence_status, v_attachment_reference, v_attachment_sha256,
    v_disposition_status, v_disposition_note, v_actor, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_tocc_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_tocc.manage'
     ) or not private.staff_tocc_target_in_scope(
       p_expected_organization_id, p_expected_branch_id, p_staff_membership_id, true
     ) then
    raise exception using errcode = '40001', message = 'staff TOCC final verification failed';
  end if;

  insert into private.staff_tocc_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_record_version_id, result_evaluated_on,
    result_expiry_warning, result_manual_attention_warning,
    result_warning_basis, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_evaluated_on,
    v_expiry_warning, v_manual_attention_warning,
    'manual_valid_through_and_manual_attention_flag', v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    v_result.tocc_key, v_result.id, v_result.version,
    v_result.previous_version_id, v_result.record_status,
    v_result.staff_membership_id, v_result.content_hash,
    v_evaluated_on, v_expiry_warning, v_manual_attention_warning,
    'manual_valid_through_and_manual_attention_flag'::text,
    v_result.recorded_at, false;
end;
$$;

create or replace function private.staff_tocc_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_staff_membership_id uuid,
  p_validity_status text,
  p_attention_status text,
  p_disposition_status text,
  p_date_from date,
  p_date_to date,
  p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Taipei')::date;
  v_validity_status text := lower(btrim(coalesce(p_validity_status, 'all')));
  v_attention_status text := lower(btrim(coalesce(p_attention_status, 'all')));
  v_disposition_status text := lower(btrim(coalesce(p_disposition_status, 'all')));
  v_search text := lower(nullif(btrim(p_search), ''));
  v_records jsonb := '[]'::jsonb;
  v_record_total bigint := 0;
  v_history jsonb := '[]'::jsonb;
  v_history_total bigint := 0;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_active_total bigint := 0;
  v_expired_total bigint := 0;
  v_manual_attention_total bigint := 0;
  v_action_required_total bigint := 0;
begin
  with latest as (
    select distinct on (record.tocc_key) record.*
    from public.staff_tocc_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_tocc_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.tocc_key, record.version desc
  ), derived as (
    select latest.*,
      case
        when record_status = 'voided' then 'voided'
        when valid_through < v_today then 'expired'
        else 'active'
      end as validity_status,
      record_status = 'active' and valid_through < v_today as expiry_warning,
      record_status = 'active' and manual_attention_flag as manual_attention_warning,
      record_status = 'active' and manual_attention_flag
        and disposition_status <> 'completed' as action_required,
      case
        when record_status = 'voided' then '[]'::jsonb
        else to_jsonb(array_remove(array[
          case when valid_through < v_today then 'expired_manual_valid_through' end,
          case when manual_attention_flag then 'manual_attention_flag' end
        ], null))
      end as warning_reasons
    from latest
  ), filtered as (
    select derived.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from derived
    left join public.profiles recorder on recorder.id = derived.recorded_by
    where (p_staff_membership_id is null
        or derived.staff_membership_id = p_staff_membership_id)
      and (v_validity_status = 'all' or derived.validity_status = v_validity_status)
      and (v_attention_status = 'all'
        or (v_attention_status = 'flagged' and derived.manual_attention_warning)
        or (v_attention_status = 'not_flagged' and not derived.manual_attention_warning))
      and (v_disposition_status = 'all'
        or derived.disposition_status = v_disposition_status)
      and (p_date_from is null or derived.assessed_on >= p_date_from)
      and (p_date_to is null or derived.assessed_on <= p_date_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        derived.staff_display_name, derived.staff_employee_code,
        derived.result_text, derived.validity_source,
        derived.attention_note, derived.disposition_note
      ))) > 0)
  ), ranked as (
    select filtered.*, row_number() over (
      order by case when expiry_warning or manual_attention_warning then 0 else 1 end,
        valid_through, staff_display_name collate "C", tocc_key
    ) as row_number
    from filtered
  )
  select count(*)::bigint,
    count(*) filter (where validity_status = 'active')::bigint,
    count(*) filter (where validity_status = 'expired')::bigint,
    count(*) filter (where manual_attention_warning)::bigint,
    count(*) filter (where action_required)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'tocc_key', tocc_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'staff_display_name', staff_display_name,
      'staff_employee_code', staff_employee_code,
      'assessed_on', assessed_on,
      'valid_through', valid_through,
      'validity_source', validity_source,
      'result_text', result_text,
      'manual_attention_flag', manual_attention_flag,
      'attention_note', attention_note,
      'evidence_status', evidence_status,
      'disposition_status', disposition_status,
      'disposition_note', disposition_note,
      'validity_status', validity_status,
      'expiry_warning', expiry_warning,
      'manual_attention_warning', manual_attention_warning,
      'action_required', action_required,
      'warning_reasons', warning_reasons,
      'warning_basis', 'manual_valid_through_and_manual_attention_flag',
      'medical_interpretation_status', 'not_evaluated',
      'recorded_by', recorded_by,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by case when expiry_warning or manual_attention_warning then 0 else 1 end,
      valid_through, staff_display_name collate "C", tocc_key)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_record_total, v_active_total, v_expired_total,
    v_manual_attention_total, v_action_required_total, v_records
  from ranked;

  with latest as (
    select distinct on (record.tocc_key) record.*
    from public.staff_tocc_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_tocc_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.tocc_key, record.version desc
  ), derived as (
    select latest.*,
      case when record_status = 'voided' then 'voided'
        when valid_through < v_today then 'expired' else 'active' end
        as validity_status,
      record_status = 'active' and manual_attention_flag
        as manual_attention_warning
    from latest
  ), filtered_keys as (
    select derived.tocc_key from derived
    where (p_staff_membership_id is null
        or derived.staff_membership_id = p_staff_membership_id)
      and (v_validity_status = 'all' or derived.validity_status = v_validity_status)
      and (v_attention_status = 'all'
        or (v_attention_status = 'flagged' and derived.manual_attention_warning)
        or (v_attention_status = 'not_flagged' and not derived.manual_attention_warning))
      and (v_disposition_status = 'all'
        or derived.disposition_status = v_disposition_status)
      and (p_date_from is null or derived.assessed_on >= p_date_from)
      and (p_date_to is null or derived.assessed_on <= p_date_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        derived.staff_display_name, derived.staff_employee_code,
        derived.result_text, derived.validity_source,
        derived.attention_note, derived.disposition_note
      ))) > 0)
  ), visible as (
    select record.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from public.staff_tocc_versions record
    join filtered_keys on filtered_keys.tocc_key = record.tocc_key
    left join public.profiles recorder on recorder.id = record.recorded_by
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_tocc_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
  ), ranked as (
    select visible.*, row_number() over (
      order by tocc_key, version desc
    ) as row_number from visible
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'tocc_key', tocc_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'assessed_on', assessed_on,
      'valid_through', valid_through,
      'validity_source', validity_source,
      'result_text', result_text,
      'manual_attention_flag', manual_attention_flag,
      'attention_note', attention_note,
      'evidence_status', evidence_status,
      'disposition_status', disposition_status,
      'disposition_note', disposition_note,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by tocc_key, version desc)
      filter (where row_number <= 500), '[]'::jsonb)
  into v_history_total, v_history from ranked;

  with latest as (
    select distinct on (record.tocc_key) record.*
    from public.staff_tocc_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_tocc_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.tocc_key, record.version desc
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
      and private.staff_tocc_can_access_target(
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
    'manual_attention_total', v_manual_attention_total,
    'action_required_total', v_action_required_total,
    'history', v_history,
    'history_total', v_history_total,
    'history_truncated', v_history_total > 500,
    'staff_options', v_staff_options,
    'staff_total', v_staff_total,
    'staff_truncated', v_staff_total > 200,
    'validity_rule_status', 'not_configured',
    'valid_through_source_mode', 'manual_per_record',
    'warning_basis', 'manual_valid_through_and_manual_attention_flag',
    'medical_interpretation_status', 'not_evaluated',
    'expiry_reminder_schedule_status', 'not_configured',
    'expiry_notice_days', null,
    'expiring_total', null,
    'attachment_pipeline_status', 'not_configured',
    'attachment_scan_status', 'not_configured'
  );
end;
$$;

create or replace function private.staff_tocc_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_validity_status text,
  p_attention_status text,
  p_disposition_status text,
  p_date_from date,
  p_date_to date,
  p_search text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, active_total bigint, expired_total bigint,
  manual_attention_total bigint, action_required_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  validity_rule_status text, valid_through_source_mode text,
  warning_basis text, medical_interpretation_status text,
  expiry_reminder_schedule_status text, expiry_notice_days integer,
  expiring_total bigint, attachment_pipeline_status text,
  attachment_scan_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_validity_status text := lower(btrim(coalesce(p_validity_status, 'all')));
  v_attention_status text := lower(btrim(coalesce(p_attention_status, 'all')));
  v_disposition_status text := lower(btrim(coalesce(p_disposition_status, 'all')));
  v_search text := nullif(btrim(p_search), '');
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_validity_status not in ('all', 'active', 'expired', 'voided')
     or v_attention_status not in ('all', 'flagged', 'not_flagged')
     or v_disposition_status not in (
       'all', 'not_recorded', 'pending', 'in_progress', 'completed'
     )
     or (p_date_from is not null and extract(year from p_date_from) not between 1900 and 2200)
     or (p_date_to is not null and extract(year from p_date_to) not between 1900 and 2200)
     or (p_date_from is not null and p_date_to is not null and p_date_to < p_date_from)
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]'
     ))
     or not private.staff_tocc_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_tocc.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff TOCC snapshot is not permitted';
  end if;
  if p_staff_membership_id is not null
     and not private.staff_tocc_can_access_target(
       p_expected_organization_id, p_expected_branch_id, p_staff_membership_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff TOCC target is outside current scope';
  end if;

  v_now := clock_timestamp();
  v_bundle := private.staff_tocc_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_validity_status, v_attention_status,
    v_disposition_status, p_date_from, p_date_to, v_search
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_tocc_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page74_staff_tocc_v1',
      'generated_at', v_now,
      'staff_filter_present', p_staff_membership_id is not null,
      'validity_status', v_validity_status,
      'attention_status', v_attention_status,
      'disposition_status', v_disposition_status,
      'date_from_present', p_date_from is not null,
      'date_to_present', p_date_to is not null,
      'search_present', v_search is not null,
      'record_total', v_bundle -> 'record_total',
      'warning_total',
        (v_bundle ->> 'expired_total')::bigint
        + (v_bundle ->> 'manual_attention_total')::bigint
    )
  );

  if not private.staff_tocc_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_tocc.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff TOCC snapshot final verification failed';
  end if;
  v_after := private.staff_tocc_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_validity_status, v_attention_status,
    v_disposition_status, p_date_from, p_date_to, v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff TOCC snapshot changed during audit';
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
    (v_bundle ->> 'manual_attention_total')::bigint,
    (v_bundle ->> 'action_required_total')::bigint,
    v_bundle -> 'history',
    (v_bundle ->> 'history_total')::bigint,
    (v_bundle ->> 'history_truncated')::boolean,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle ->> 'validity_rule_status',
    v_bundle ->> 'valid_through_source_mode',
    v_bundle ->> 'warning_basis',
    v_bundle ->> 'medical_interpretation_status',
    v_bundle ->> 'expiry_reminder_schedule_status',
    (v_bundle ->> 'expiry_notice_days')::integer,
    (v_bundle ->> 'expiring_total')::bigint,
    v_bundle ->> 'attachment_pipeline_status',
    v_bundle ->> 'attachment_scan_status';
end;
$$;

create or replace function public.append_staff_tocc(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_tocc_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_assessed_on date,
  p_valid_through date,
  p_validity_source text,
  p_result_text text,
  p_manual_attention_flag boolean,
  p_attention_note text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_disposition_status text,
  p_disposition_note text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, tocc_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  evaluated_on date, expiry_warning boolean,
  manual_attention_warning boolean, warning_basis text,
  recorded_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_staff_tocc_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_tocc_key, p_previous_version_id, p_expected_base_version,
    p_staff_membership_id, p_assessed_on, p_valid_through,
    p_validity_source, p_result_text, p_manual_attention_flag,
    p_attention_note, p_evidence_status, p_attachment_reference,
    p_attachment_sha256, p_disposition_status, p_disposition_note,
    p_correction_reason, p_idempotency_key
  );
$$;

create or replace function public.staff_tocc_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid default null,
  p_validity_status text default 'all',
  p_attention_status text default 'all',
  p_disposition_status text default 'all',
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, active_total bigint, expired_total bigint,
  manual_attention_total bigint, action_required_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  validity_rule_status text, valid_through_source_mode text,
  warning_basis text, medical_interpretation_status text,
  expiry_reminder_schedule_status text, expiry_notice_days integer,
  expiring_total bigint, attachment_pipeline_status text,
  attachment_scan_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.staff_tocc_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_staff_membership_id, p_validity_status, p_attention_status,
    p_disposition_status, p_date_from, p_date_to, p_search
  );
$$;

alter table public.staff_tocc_versions enable row level security;
alter table public.staff_tocc_versions force row level security;
create policy staff_tocc_versions_select
on public.staff_tocc_versions for select to authenticated
using (private.staff_tocc_can_access_target(
  organization_id, branch_id, staff_membership_id
));

revoke all on table public.staff_tocc_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_tocc_operations
  from public, anon, authenticated, service_role;

revoke all on function private.staff_tocc_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_tocc_current_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_tocc_target_in_scope(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_tocc_can_access_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.append_staff_tocc_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, date, date, text,
  text, boolean, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.staff_tocc_snapshot_bundle(
  uuid, uuid, timestamptz, uuid, text, text, text, date, date, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_tocc_snapshot_response(
  uuid, uuid, uuid, text, text, text, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function public.append_staff_tocc(
  uuid, uuid, text, uuid, uuid, integer, uuid, date, date, text,
  text, boolean, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.staff_tocc_snapshot(
  uuid, uuid, uuid, text, text, text, date, date, text
) from public, anon, authenticated, service_role;

grant execute on function public.append_staff_tocc(
  uuid, uuid, text, uuid, uuid, integer, uuid, date, date, text,
  text, boolean, text, text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.staff_tocc_snapshot(
  uuid, uuid, uuid, text, text, text, date, date, text
) to authenticated;
grant execute on function private.append_staff_tocc_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, date, date, text,
  text, boolean, text, text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.staff_tocc_snapshot_response(
  uuid, uuid, uuid, text, text, text, date, date, text
) to authenticated;

comment on table public.staff_tocc_versions is
  'Immutable employee TOCC facts and correction chain; valid-through and alert flags are human supplied and not diagnostic.';
comment on function public.staff_tocc_snapshot(
  uuid, uuid, uuid, text, text, text, date, date, text
) is
  'Returns one audited Page 74 snapshot with manual validity and attention warnings; rules, reminders and attachments remain explicitly unconfigured.';
