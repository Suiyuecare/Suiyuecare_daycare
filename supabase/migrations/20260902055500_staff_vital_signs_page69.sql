-- Page 69: immutable employee vital-sign facts. Employee health access is
-- separate from general staff-directory access. Reads and writes require
-- recent same-session AAL2. No threshold, diagnosis, attachment, export, or
-- offline behavior is inferred by this slice.

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

create table public.staff_vital_sign_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  vital_sign_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  staff_membership_id uuid not null references public.memberships(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_display_name text not null,
  staff_employee_code text,
  measurement_type text not null,
  value_status text not null,
  value_decimal_text text,
  unit text,
  status_reason text,
  occurred_at timestamptz not null,
  source text not null,
  note text,
  completion_status text not null default 'completed',
  recorded_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint staff_vital_sign_branch_scope_fkey foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_vital_sign_id_scope_key unique (id, organization_id, branch_id),
  constraint staff_vital_sign_id_chain_scope_key unique (
    id, organization_id, branch_id, vital_sign_key
  ),
  constraint staff_vital_sign_chain_key unique (vital_sign_key, version),
  constraint staff_vital_sign_previous_unique unique (previous_version_id),
  constraint staff_vital_sign_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, vital_sign_key
  ) references public.staff_vital_sign_versions(
    id, organization_id, branch_id, vital_sign_key
  ) on delete restrict,
  constraint staff_vital_sign_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null)
      or (version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000))
  ),
  constraint staff_vital_sign_record_status_check check (
    record_status in ('active', 'voided')
  ),
  constraint staff_vital_sign_completion_check check (completion_status = 'completed'),
  constraint staff_vital_sign_measurement_type_check check (
    char_length(measurement_type) between 1 and 120
    and measurement_type !~ '[[:cntrl:]]'
  ),
  constraint staff_vital_sign_value_contract_check check (
    (value_status = 'measured'
      and value_decimal_text ~ '^[+-]?([0-9]{1,18}(\.[0-9]{1,12})?|\.[0-9]{1,12})$'
      and char_length(unit) between 1 and 40
      and unit !~ '[[:cntrl:]]'
      and status_reason is null)
    or
    (value_status in ('missing', 'not_applicable')
      and value_decimal_text is null and unit is null
      and char_length(status_reason) between 1 and 500
      and translate(status_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
  ),
  constraint staff_vital_sign_occurred_at_check check (
    extract(year from occurred_at at time zone 'Asia/Taipei') between 1900 and 2200
  ),
  constraint staff_vital_sign_source_check check (
    char_length(source) between 1 and 160 and source !~ '[[:cntrl:]]'
  ),
  constraint staff_vital_sign_staff_snapshot_check check (
    char_length(staff_display_name) between 1 and 120
    and staff_display_name !~ '[[:cntrl:]]'
    and (staff_employee_code is null or (
      char_length(staff_employee_code) between 1 and 120
      and staff_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_vital_sign_text_check check (
    (correction_reason is null or
      translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (note is null or (
      char_length(note) between 1 and 1000
      and translate(note, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_vital_sign_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_vital_sign_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_version_id uuid not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null,
  constraint staff_vital_sign_operation_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint staff_vital_sign_operation_result_scope_fkey foreign key (
    result_record_version_id, organization_id, branch_id
  ) references public.staff_vital_sign_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_vital_sign_operation_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create index staff_vital_sign_scope_time_idx on public.staff_vital_sign_versions(
  organization_id, branch_id, occurred_at desc, vital_sign_key, version desc
);
create index staff_vital_sign_scope_type_idx on public.staff_vital_sign_versions(
  organization_id, branch_id, measurement_type, occurred_at desc
);
create index staff_vital_sign_membership_idx
  on public.staff_vital_sign_versions(staff_membership_id);
create index staff_vital_sign_staff_user_idx
  on public.staff_vital_sign_versions(staff_user_id);
create index staff_vital_sign_recorded_by_idx
  on public.staff_vital_sign_versions(recorded_by);
create index staff_vital_sign_reauth_idx
  on public.staff_vital_sign_versions(reauth_challenge_id);
create index staff_vital_sign_previous_idx
  on public.staff_vital_sign_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_vital_sign_operation_actor_idx
  on private.staff_vital_sign_operations(actor_user_id, idempotency_key);
create index staff_vital_sign_operation_result_idx
  on private.staff_vital_sign_operations(
    result_record_version_id, organization_id, branch_id
  );
create index staff_vital_sign_operation_scope_idx
  on private.staff_vital_sign_operations(organization_id, branch_id);
create index staff_vital_sign_operation_reauth_idx
  on private.staff_vital_sign_operations(reauth_challenge_id);

create or replace function private.staff_vital_sign_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger staff_vital_sign_versions_append_only before update or delete
on public.staff_vital_sign_versions for each row
execute function private.staff_vital_sign_append_only();
create trigger staff_vital_sign_operations_append_only before update or delete
on private.staff_vital_sign_operations for each row
execute function private.staff_vital_sign_append_only();
create trigger staff_vital_sign_versions_audit_row_change after insert
on public.staff_vital_sign_versions for each row execute function private.audit_row_change();

create or replace function private.staff_vital_sign_authority(
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

create or replace function private.staff_vital_sign_target_in_scope(
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

create or replace function private.staff_vital_sign_can_access_target(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_vital_sign_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_health.read', true
    )
    and private.staff_vital_sign_target_in_scope(
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

create or replace function private.require_staff_vital_sign_reauth(
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
      message = 'recent staff vital sign AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'recent staff vital sign AAL2 evidence is required';
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
      message = 'recent staff vital sign AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.append_staff_vital_sign_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_vital_sign_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_measurement_type text,
  p_value_status text,
  p_value_decimal_text text,
  p_unit text,
  p_status_reason text,
  p_occurred_at timestamptz,
  p_source text,
  p_note text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, vital_sign_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, completion_status text, staff_membership_id uuid,
  content_hash text, threshold_evaluation_status text,
  recorded_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_measurement_type text;
  v_value_status text;
  v_value_decimal_text text;
  v_unit text;
  v_status_reason text;
  v_source text;
  v_note text;
  v_correction_reason text;
  v_request_hash text;
  v_content_hash text;
  v_now timestamptz;
  v_version integer;
  v_record_status text;
  v_staff_user_id uuid;
  v_staff_display_name text;
  v_staff_employee_code text;
  v_reauth_challenge_id uuid;
  v_operation private.staff_vital_sign_operations%rowtype;
  v_previous public.staff_vital_sign_versions%rowtype;
  v_result public.staff_vital_sign_versions%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_vital_sign_key is null or p_staff_membership_id is null
     or p_idempotency_key is null or p_expected_base_version is null
     or p_expected_base_version < 0
     or v_action not in ('create', 'correct', 'void')
     or not private.staff_vital_sign_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.manage', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff vital sign write is not permitted';
  end if;

  v_now := clock_timestamp();
  v_reauth_challenge_id := private.require_staff_vital_sign_reauth(v_actor, v_now);
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-vital-sign-operation:' || v_actor::text || ':' ||
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

  -- Health content normalization starts only after authority, recent reauth,
  -- and target membership scope have all passed.
  v_measurement_type := nullif(btrim(p_measurement_type), '');
  v_value_status := lower(btrim(coalesce(p_value_status, '')));
  v_value_decimal_text := nullif(btrim(p_value_decimal_text), '');
  v_unit := nullif(btrim(p_unit), '');
  v_status_reason := nullif(btrim(p_status_reason), '');
  v_source := nullif(btrim(p_source), '');
  v_note := nullif(btrim(p_note), '');
  v_correction_reason := nullif(btrim(p_correction_reason), '');

  if v_action = 'create' then
    if p_previous_version_id is not null or p_expected_base_version <> 0
       or v_correction_reason is not null then
      raise exception using errcode = '22023',
        message = 'new staff vital sign base is invalid';
    end if;
  elsif p_previous_version_id is null or p_expected_base_version < 1
     or v_correction_reason is null or char_length(v_correction_reason) > 1000
     or translate(v_correction_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'staff vital sign correction base or reason is invalid';
  end if;

  if v_action in ('create', 'correct') then
    if v_measurement_type is null or char_length(v_measurement_type) > 120
       or v_measurement_type ~ '[[:cntrl:]]'
       or v_value_status not in ('measured', 'missing', 'not_applicable')
       or p_occurred_at is null
       or extract(year from p_occurred_at at time zone 'Asia/Taipei')
         not between 1900 and 2200
       or v_source is null or char_length(v_source) > 160
       or v_source ~ '[[:cntrl:]]'
       or (v_note is not null and (char_length(v_note) > 1000
         or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]'))
       or (v_value_status = 'measured' and (
         v_value_decimal_text is null
         or v_value_decimal_text !~ '^[+-]?([0-9]{1,18}(\.[0-9]{1,12})?|\.[0-9]{1,12})$'
         or v_unit is null or char_length(v_unit) > 40
         or v_unit ~ '[[:cntrl:]]' or v_status_reason is not null
       ))
       or (v_value_status in ('missing', 'not_applicable') and (
         v_value_decimal_text is not null or v_unit is not null
         or v_status_reason is null or char_length(v_status_reason) > 500
         or translate(v_status_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       )) then
      raise exception using errcode = '22023',
        message = 'staff vital sign content or value-state contract is invalid';
    end if;
  elsif v_measurement_type is not null or v_value_status <> ''
     or v_value_decimal_text is not null or v_unit is not null
     or v_status_reason is not null or p_occurred_at is not null
     or v_source is not null or v_note is not null then
    raise exception using errcode = '22023',
      message = 'void operation must copy immutable prior vital sign content';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'vital_sign_key', p_vital_sign_key,
    'previous_version_id', p_previous_version_id,
    'expected_base_version', p_expected_base_version,
    'staff_membership_id', p_staff_membership_id,
    'measurement_type', v_measurement_type,
    'value_status', v_value_status,
    'value_decimal_text', v_value_decimal_text,
    'unit', v_unit,
    'status_reason', v_status_reason,
    'occurred_at', p_occurred_at,
    'source', v_source,
    'note', v_note,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_vital_sign_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'staff vital sign idempotency key reused with different content';
    end if;
    select record.* into v_result
    from public.staff_vital_sign_versions record
    where record.id = v_operation.result_record_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.vital_sign_key = p_vital_sign_key
      and record.staff_membership_id = p_staff_membership_id;
    if not found or not private.staff_vital_sign_authority(
         p_expected_organization_id, p_expected_branch_id,
         'staff_health.manage', true
       ) then
      raise exception using errcode = '42501',
        message = 'staff vital sign replay is no longer permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.vital_sign_key, v_result.id, v_result.version,
      v_result.previous_version_id, v_result.record_status,
      v_result.completion_status, v_result.staff_membership_id,
      v_result.content_hash, 'not_configured'::text,
      v_result.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-vital-sign:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_vital_sign_key::text, 0
  ));
  if v_action = 'create' then
    if exists (
      select 1 from public.staff_vital_sign_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.vital_sign_key = p_vital_sign_key
    ) then
      raise exception using errcode = '23505',
        message = 'staff vital sign key already exists';
    end if;
    v_version := 1;
    v_record_status := 'active';
  else
    select record.* into v_previous
    from public.staff_vital_sign_versions record
    where record.id = p_previous_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.vital_sign_key = p_vital_sign_key
      and record.staff_membership_id = p_staff_membership_id
    for share;
    if not found or v_previous.version <> p_expected_base_version
       or v_previous.record_status <> 'active'
       or exists (
         select 1 from public.staff_vital_sign_versions later
         where later.vital_sign_key = p_vital_sign_key
           and later.version > v_previous.version
       ) then
      raise exception using errcode = '40001',
        message = 'staff vital sign base version is stale';
    end if;
    v_version := v_previous.version + 1;
    v_record_status := case when v_action = 'void' then 'voided' else 'active' end;
    if v_action = 'void' then
      v_measurement_type := v_previous.measurement_type;
      v_value_status := v_previous.value_status;
      v_value_decimal_text := v_previous.value_decimal_text;
      v_unit := v_previous.unit;
      v_status_reason := v_previous.status_reason;
      p_occurred_at := v_previous.occurred_at;
      v_source := v_previous.source;
      v_note := v_previous.note;
    end if;
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'vital_sign_key', p_vital_sign_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_status', v_record_status,
    'correction_reason', v_correction_reason,
    'staff_membership_id', p_staff_membership_id,
    'staff_user_id', v_staff_user_id,
    'staff_display_name', v_staff_display_name,
    'staff_employee_code', v_staff_employee_code,
    'measurement_type', v_measurement_type,
    'value_status', v_value_status,
    'value_decimal_text', v_value_decimal_text,
    'unit', v_unit,
    'status_reason', v_status_reason,
    'occurred_at', p_occurred_at,
    'source', v_source,
    'note', v_note,
    'completion_status', 'completed',
    'recorded_by', v_actor,
    'reauth_challenge_id', v_reauth_challenge_id,
    'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.staff_vital_sign_versions (
    organization_id, branch_id, vital_sign_key, version,
    previous_version_id, record_status, correction_reason,
    staff_membership_id, staff_user_id, staff_display_name,
    staff_employee_code, measurement_type, value_status,
    value_decimal_text, unit, status_reason, occurred_at, source, note,
    completion_status, recorded_by, reauth_challenge_id, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_vital_sign_key,
    v_version, p_previous_version_id, v_record_status, v_correction_reason,
    p_staff_membership_id, v_staff_user_id, v_staff_display_name,
    v_staff_employee_code, v_measurement_type, v_value_status,
    v_value_decimal_text, v_unit, v_status_reason, p_occurred_at,
    v_source, v_note, 'completed', v_actor, v_reauth_challenge_id,
    v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_vital_sign_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.manage', true
     ) or not private.staff_vital_sign_target_in_scope(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id, true
     ) then
    raise exception using errcode = '40001',
      message = 'staff vital sign final verification failed';
  end if;

  insert into private.staff_vital_sign_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_record_version_id, reauth_challenge_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id,
    v_reauth_challenge_id, v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    v_result.vital_sign_key, v_result.id, v_result.version,
    v_result.previous_version_id, v_result.record_status,
    v_result.completion_status, v_result.staff_membership_id,
    v_result.content_hash, 'not_configured'::text,
    v_result.recorded_at, false;
end;
$$;

create or replace function private.staff_vital_sign_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_staff_membership_id uuid,
  p_measurement_type text,
  p_state_status text,
  p_date_from date,
  p_date_to date,
  p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Taipei')::date;
  v_measurement_type text := nullif(btrim(p_measurement_type), '');
  v_state_status text := lower(btrim(coalesce(p_state_status, 'all')));
  v_search text := lower(nullif(btrim(p_search), ''));
  v_records jsonb := '[]'::jsonb;
  v_record_total bigint := 0;
  v_measured_total bigint := 0;
  v_missing_total bigint := 0;
  v_not_applicable_total bigint := 0;
  v_voided_total bigint := 0;
  v_history jsonb := '[]'::jsonb;
  v_history_total bigint := 0;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_type_options jsonb := '[]'::jsonb;
  v_type_total bigint := 0;
begin
  with latest as (
    select distinct on (record.vital_sign_key) record.*
    from public.staff_vital_sign_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_vital_sign_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vital_sign_key, record.version desc
  ), filtered as (
    select latest.*,
      case when latest.record_status = 'voided' then 'voided'
        else latest.value_status end as projection_state,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from latest
    left join public.profiles recorder on recorder.id = latest.recorded_by
    where (p_staff_membership_id is null
        or latest.staff_membership_id = p_staff_membership_id)
      and (v_measurement_type is null
        or latest.measurement_type = v_measurement_type)
      and (v_state_status = 'all'
        or case when latest.record_status = 'voided' then 'voided'
          else latest.value_status end = v_state_status)
      and (p_date_from is null or
        (latest.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (latest.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        latest.staff_display_name, latest.staff_employee_code,
        latest.measurement_type, latest.source,
        latest.status_reason, latest.note
      ))) > 0)
  ), ranked as (
    select filtered.*, row_number() over (
      order by occurred_at desc, staff_display_name collate "C", vital_sign_key
    ) as row_number
    from filtered
  )
  select count(*)::bigint,
    count(*) filter (where projection_state = 'measured')::bigint,
    count(*) filter (where projection_state = 'missing')::bigint,
    count(*) filter (where projection_state = 'not_applicable')::bigint,
    count(*) filter (where projection_state = 'voided')::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'vital_sign_key', vital_sign_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'completion_status', completion_status,
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'staff_display_name', staff_display_name,
      'staff_employee_code', staff_employee_code,
      'measurement_type', measurement_type,
      'value_status', value_status,
      'value_decimal_text', value_decimal_text,
      'unit', unit,
      'status_reason', status_reason,
      'occurred_at', occurred_at,
      'source', source,
      'note', note,
      'threshold_evaluation_status', 'not_configured',
      'threshold_version_id', null,
      'warning_status', null,
      'medical_interpretation_status', 'not_evaluated',
      'recorded_by', recorded_by,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by occurred_at desc, staff_display_name collate "C", vital_sign_key)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_record_total, v_measured_total, v_missing_total,
    v_not_applicable_total, v_voided_total, v_records
  from ranked;

  with latest as (
    select distinct on (record.vital_sign_key) record.*
    from public.staff_vital_sign_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_vital_sign_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vital_sign_key, record.version desc
  ), filtered_keys as (
    select latest.vital_sign_key from latest
    where (p_staff_membership_id is null
        or latest.staff_membership_id = p_staff_membership_id)
      and (v_measurement_type is null
        or latest.measurement_type = v_measurement_type)
      and (v_state_status = 'all'
        or case when latest.record_status = 'voided' then 'voided'
          else latest.value_status end = v_state_status)
      and (p_date_from is null or
        (latest.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (latest.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        latest.staff_display_name, latest.staff_employee_code,
        latest.measurement_type, latest.source,
        latest.status_reason, latest.note
      ))) > 0)
  ), visible as (
    select record.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from public.staff_vital_sign_versions record
    join filtered_keys on filtered_keys.vital_sign_key = record.vital_sign_key
    left join public.profiles recorder on recorder.id = record.recorded_by
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_vital_sign_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
  ), ranked as (
    select visible.*, row_number() over (
      order by vital_sign_key, version desc
    ) as row_number from visible
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'vital_sign_key', vital_sign_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'completion_status', completion_status,
      'measurement_type', measurement_type,
      'value_status', value_status,
      'value_decimal_text', value_decimal_text,
      'unit', unit,
      'status_reason', status_reason,
      'occurred_at', occurred_at,
      'source', source,
      'note', note,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by vital_sign_key, version desc)
      filter (where row_number <= 500), '[]'::jsonb)
  into v_history_total, v_history from ranked;

  with latest as (
    select distinct on (record.vital_sign_key) record.*
    from public.staff_vital_sign_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_vital_sign_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vital_sign_key, record.version desc
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
      and private.staff_vital_sign_can_access_target(
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
    select distinct on (record.vital_sign_key) record.*
    from public.staff_vital_sign_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_vital_sign_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vital_sign_key, record.version desc
  ), grouped as (
    select measurement_type, count(*)::bigint as record_count
    from latest group by measurement_type
  ), ranked as (
    select grouped.*, row_number() over (
      order by measurement_type collate "C"
    ) as row_number from grouped
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'measurement_type', measurement_type, 'record_count', record_count
    ) order by measurement_type collate "C")
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
    'measured_total', v_measured_total,
    'missing_total', v_missing_total,
    'not_applicable_total', v_not_applicable_total,
    'voided_total', v_voided_total,
    'history', v_history,
    'history_total', v_history_total,
    'history_truncated', v_history_total > 500,
    'staff_options', v_staff_options,
    'staff_total', v_staff_total,
    'staff_truncated', v_staff_total > 200,
    'type_options', v_type_options,
    'type_total', v_type_total,
    'types_truncated', v_type_total > 200,
    'threshold_rule_status', 'not_configured',
    'threshold_version_id', null,
    'threshold_warning_total', null,
    'threshold_pending_confirmation_total', null,
    'scheduled_missing_rule_status', 'not_configured',
    'scheduled_missing_total', null,
    'decimal_preservation', 'verbatim_after_outer_trim',
    'value_status_separation', 'measured_missing_not_applicable',
    'medical_interpretation_status', 'not_evaluated',
    'attachment_pipeline_status', 'not_configured',
    'export_status', 'disabled',
    'offline_status', 'disabled',
    'recent_aal2_max_age_minutes', 15
  );
end;
$$;

create or replace function private.staff_vital_sign_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_measurement_type text,
  p_state_status text,
  p_date_from date,
  p_date_to date,
  p_search text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, measured_total bigint, missing_total bigint,
  not_applicable_total bigint, voided_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  type_options jsonb, type_total bigint, types_truncated boolean,
  threshold_rule_status text, threshold_version_id uuid,
  threshold_warning_total bigint, threshold_pending_confirmation_total bigint,
  scheduled_missing_rule_status text, scheduled_missing_total bigint,
  decimal_preservation text, value_status_separation text,
  medical_interpretation_status text, attachment_pipeline_status text,
  export_status text, offline_status text, recent_aal2_max_age_minutes integer
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_measurement_type text;
  v_state_status text;
  v_search text;
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or not private.staff_vital_sign_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.read', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff vital sign snapshot is not permitted';
  end if;
  v_now := clock_timestamp();
  perform private.require_staff_vital_sign_reauth(v_actor, v_now);

  -- Only parse filter text after the sensitive read boundary is authorized.
  v_measurement_type := nullif(btrim(p_measurement_type), '');
  v_state_status := lower(btrim(coalesce(p_state_status, 'all')));
  v_search := nullif(btrim(p_search), '');
  if v_state_status not in ('all', 'measured', 'missing', 'not_applicable', 'voided')
     or (v_measurement_type is not null and (
       char_length(v_measurement_type) > 120
       or v_measurement_type ~ '[[:cntrl:]]'
     ))
     or (p_date_from is not null
       and extract(year from p_date_from) not between 1900 and 2200)
     or (p_date_to is not null
       and extract(year from p_date_to) not between 1900 and 2200)
     or (p_date_from is not null and p_date_to is not null
       and p_date_to < p_date_from)
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023',
      message = 'staff vital sign snapshot filters are invalid';
  end if;
  if p_staff_membership_id is not null
     and not private.staff_vital_sign_can_access_target(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff vital sign target is outside current scope';
  end if;

  v_bundle := private.staff_vital_sign_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_measurement_type, v_state_status,
    p_date_from, p_date_to, v_search
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_vital_sign_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page69_staff_vital_signs_v1',
      'generated_at', v_now,
      'staff_filter_present', p_staff_membership_id is not null,
      'measurement_type_filter_present', v_measurement_type is not null,
      'state_status', v_state_status,
      'date_from_present', p_date_from is not null,
      'date_to_present', p_date_to is not null,
      'search_present', v_search is not null,
      'record_total', v_bundle -> 'record_total',
      'measured_total', v_bundle -> 'measured_total',
      'missing_total', v_bundle -> 'missing_total',
      'not_applicable_total', v_bundle -> 'not_applicable_total',
      'voided_total', v_bundle -> 'voided_total'
    )
  );

  if not private.staff_vital_sign_authority(
       p_expected_organization_id, p_expected_branch_id,
       'staff_health.read', true
     ) then
    raise exception using errcode = '42501',
      message = 'staff vital sign snapshot final verification failed';
  end if;
  v_after := private.staff_vital_sign_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_measurement_type, v_state_status,
    p_date_from, p_date_to, v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff vital sign snapshot changed during audit';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    (v_bundle ->> 'measured_total')::bigint,
    (v_bundle ->> 'missing_total')::bigint,
    (v_bundle ->> 'not_applicable_total')::bigint,
    (v_bundle ->> 'voided_total')::bigint,
    v_bundle -> 'history',
    (v_bundle ->> 'history_total')::bigint,
    (v_bundle ->> 'history_truncated')::boolean,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'type_options',
    (v_bundle ->> 'type_total')::bigint,
    (v_bundle ->> 'types_truncated')::boolean,
    v_bundle ->> 'threshold_rule_status',
    (v_bundle ->> 'threshold_version_id')::uuid,
    (v_bundle ->> 'threshold_warning_total')::bigint,
    (v_bundle ->> 'threshold_pending_confirmation_total')::bigint,
    v_bundle ->> 'scheduled_missing_rule_status',
    (v_bundle ->> 'scheduled_missing_total')::bigint,
    v_bundle ->> 'decimal_preservation',
    v_bundle ->> 'value_status_separation',
    v_bundle ->> 'medical_interpretation_status',
    v_bundle ->> 'attachment_pipeline_status',
    v_bundle ->> 'export_status',
    v_bundle ->> 'offline_status',
    (v_bundle ->> 'recent_aal2_max_age_minutes')::integer;
end;
$$;

create or replace function public.append_staff_vital_sign(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_vital_sign_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_measurement_type text,
  p_value_status text,
  p_value_decimal_text text,
  p_unit text,
  p_status_reason text,
  p_occurred_at timestamptz,
  p_source text,
  p_note text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, vital_sign_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, completion_status text, staff_membership_id uuid,
  content_hash text, threshold_evaluation_status text,
  recorded_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_staff_vital_sign_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_vital_sign_key, p_previous_version_id, p_expected_base_version,
    p_staff_membership_id, p_measurement_type, p_value_status,
    p_value_decimal_text, p_unit, p_status_reason, p_occurred_at,
    p_source, p_note, p_correction_reason, p_idempotency_key
  );
$$;

create or replace function public.staff_vital_sign_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid default null,
  p_measurement_type text default null,
  p_state_status text default 'all',
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, measured_total bigint, missing_total bigint,
  not_applicable_total bigint, voided_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  type_options jsonb, type_total bigint, types_truncated boolean,
  threshold_rule_status text, threshold_version_id uuid,
  threshold_warning_total bigint, threshold_pending_confirmation_total bigint,
  scheduled_missing_rule_status text, scheduled_missing_total bigint,
  decimal_preservation text, value_status_separation text,
  medical_interpretation_status text, attachment_pipeline_status text,
  export_status text, offline_status text, recent_aal2_max_age_minutes integer
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.staff_vital_sign_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_staff_membership_id, p_measurement_type, p_state_status,
    p_date_from, p_date_to, p_search
  );
$$;

alter table public.staff_vital_sign_versions enable row level security;
alter table public.staff_vital_sign_versions force row level security;
create policy staff_vital_sign_versions_select
on public.staff_vital_sign_versions for select to authenticated
using (private.staff_vital_sign_can_access_target(
  organization_id, branch_id, staff_membership_id
));

revoke all on table public.staff_vital_sign_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_vital_sign_operations
  from public, anon, authenticated, service_role;

revoke all on function private.staff_vital_sign_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_vital_sign_authority(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_vital_sign_target_in_scope(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_vital_sign_can_access_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_staff_vital_sign_reauth(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.append_staff_vital_sign_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, text,
  text, text, timestamptz, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.staff_vital_sign_snapshot_bundle(
  uuid, uuid, timestamptz, uuid, text, text, date, date, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_vital_sign_snapshot_response(
  uuid, uuid, uuid, text, text, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function public.append_staff_vital_sign(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, text,
  text, text, timestamptz, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.staff_vital_sign_snapshot(
  uuid, uuid, uuid, text, text, date, date, text
) from public, anon, authenticated, service_role;

grant execute on function public.append_staff_vital_sign(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, text,
  text, text, timestamptz, text, text, text, uuid
) to authenticated;
grant execute on function public.staff_vital_sign_snapshot(
  uuid, uuid, uuid, text, text, date, date, text
) to authenticated;
grant execute on function private.append_staff_vital_sign_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, text,
  text, text, timestamptz, text, text, text, uuid
) to authenticated;
grant execute on function private.staff_vital_sign_snapshot_response(
  uuid, uuid, uuid, text, text, date, date, text
) to authenticated;

comment on table public.staff_vital_sign_versions is
  'Immutable employee vital-sign facts and correction chain; decimal text is preserved and no threshold or medical conclusion is inferred.';
comment on function public.staff_vital_sign_snapshot(
  uuid, uuid, uuid, text, text, date, date, text
) is
  'Returns one audited Page 69 snapshot; trend is derived from the same bounded records while thresholds, attachments, export, and offline remain unavailable.';
