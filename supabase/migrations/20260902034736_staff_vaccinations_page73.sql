-- Page 73: immutable, scoped employee vaccination facts. This slice records
-- what the institution was told and never infers medical validity, a required
-- schedule, or a next dose. Attachment ingestion and reminder schedules stay
-- fail-closed until separately governed services are published.

insert into public.permissions (permission_key, description, risk_level) values
  ('staff_health.read', 'Read scoped sensitive employee health records', 3),
  ('staff_health.manage', 'Append scoped sensitive employee health record versions', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('staff_health.read', 'staff_health.manage')
on conflict (role_id, permission_id) do nothing;

create table public.staff_vaccination_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  vaccination_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_status text not null,
  correction_reason text,
  staff_membership_id uuid not null references public.memberships(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  staff_display_name text not null,
  staff_employee_code text,
  vaccine_name text not null,
  dose_number text not null,
  vaccinated_on date not null,
  lot_number text,
  provider_name text not null,
  evidence_status text not null,
  attachment_reference text,
  attachment_sha256 text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  content_hash text not null,
  constraint staff_vaccination_branch_scope_fkey foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_vaccination_id_scope_key unique (
    id, organization_id, branch_id, vaccination_key
  ),
  constraint staff_vaccination_id_branch_scope_key unique (id, organization_id, branch_id),
  constraint staff_vaccination_chain_key unique (vaccination_key, version),
  constraint staff_vaccination_previous_unique unique (previous_version_id),
  constraint staff_vaccination_previous_scope_fkey foreign key (
    previous_version_id, organization_id, branch_id, vaccination_key
  ) references public.staff_vaccination_versions(
    id, organization_id, branch_id, vaccination_key
  ) on delete restrict,
  constraint staff_vaccination_version_check check (
    version > 0
    and ((version = 1 and previous_version_id is null and correction_reason is null)
      or (version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000))
  ),
  constraint staff_vaccination_status_check check (record_status in ('active', 'voided')),
  constraint staff_vaccination_name_check check (
    char_length(vaccine_name) between 1 and 160 and vaccine_name !~ '[[:cntrl:]]'
  ),
  constraint staff_vaccination_dose_check check (
    char_length(dose_number) between 1 and 80 and dose_number !~ '[[:cntrl:]]'
  ),
  constraint staff_vaccination_date_check check (
    extract(year from vaccinated_on) between 1900 and 2200
  ),
  constraint staff_vaccination_lot_check check (
    lot_number is null or (
      char_length(lot_number) between 1 and 160 and lot_number !~ '[[:cntrl:]]'
    )
  ),
  constraint staff_vaccination_provider_check check (
    char_length(provider_name) between 1 and 200 and provider_name !~ '[[:cntrl:]]'
  ),
  constraint staff_vaccination_evidence_check check (
    evidence_status in ('provided', 'missing', 'not_applicable')
    and ((evidence_status = 'provided'
      and char_length(attachment_reference) between 1 and 500
      and attachment_sha256 ~ '^[a-f0-9]{64}$')
      or (evidence_status in ('missing', 'not_applicable')
        and attachment_reference is null and attachment_sha256 is null))
  ),
  constraint staff_vaccination_staff_snapshot_check check (
    char_length(staff_display_name) between 1 and 120
    and staff_display_name !~ '[[:cntrl:]]'
    and (staff_employee_code is null or (
      char_length(staff_employee_code) between 1 and 120
      and staff_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint staff_vaccination_text_check check (
    (correction_reason is null or
      translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (attachment_reference is null or attachment_reference !~ '[[:cntrl:]]')
  ),
  constraint staff_vaccination_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.staff_vaccination_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_version_id uuid not null,
  result_duplicate_count integer not null,
  result_duplicate_basis text not null,
  created_at timestamptz not null,
  constraint staff_vaccination_operation_actor_key unique (actor_user_id, idempotency_key),
  constraint staff_vaccination_operation_result_scope_fkey foreign key (
    result_record_version_id, organization_id, branch_id
  ) references public.staff_vaccination_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint staff_vaccination_operation_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint staff_vaccination_operation_duplicate_check check (
    result_duplicate_count >= 0
    and result_duplicate_basis = 'same_staff_normalized_vaccine_and_dose'
  )
);

create index staff_vaccination_scope_date_idx on public.staff_vaccination_versions(
  organization_id, branch_id, vaccinated_on desc, vaccination_key, version desc
);
create index staff_vaccination_duplicate_lookup_idx on public.staff_vaccination_versions(
  organization_id, branch_id, staff_membership_id,
  lower(btrim(vaccine_name)), lower(btrim(dose_number)), vaccination_key, version desc
);
create index staff_vaccination_membership_idx
  on public.staff_vaccination_versions(staff_membership_id);
create index staff_vaccination_staff_user_idx
  on public.staff_vaccination_versions(staff_user_id);
create index staff_vaccination_recorded_by_idx
  on public.staff_vaccination_versions(recorded_by);
create index staff_vaccination_previous_idx
  on public.staff_vaccination_versions(previous_version_id)
  where previous_version_id is not null;
create index staff_vaccination_operation_result_idx
  on private.staff_vaccination_operations(
    result_record_version_id, organization_id, branch_id
  );
create index staff_vaccination_operation_scope_idx
  on private.staff_vaccination_operations(organization_id, branch_id);

create or replace function private.staff_vaccination_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger staff_vaccination_versions_append_only before update or delete
on public.staff_vaccination_versions for each row
execute function private.staff_vaccination_append_only();
create trigger staff_vaccination_operations_append_only before update or delete
on private.staff_vaccination_operations for each row
execute function private.staff_vaccination_append_only();
create trigger staff_vaccination_versions_audit_row_change after insert
on public.staff_vaccination_versions for each row execute function private.audit_row_change();

create or replace function private.staff_health_current_authority(
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

create or replace function private.staff_health_target_in_scope(
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

create or replace function private.staff_health_can_access_target(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_health_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'staff_health.read'
    )
    and private.staff_health_target_in_scope(
      p_expected_organization_id, p_expected_branch_id, p_staff_membership_id, false
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

create or replace function private.append_staff_vaccination_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_vaccination_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_vaccine_name text,
  p_dose_number text,
  p_vaccinated_on date,
  p_lot_number text,
  p_provider_name text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, vaccination_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  duplicate_warning boolean, duplicate_count integer,
  duplicate_basis text, recorded_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_vaccine_name text := nullif(btrim(p_vaccine_name), '');
  v_dose_number text := nullif(btrim(p_dose_number), '');
  v_lot_number text := nullif(btrim(p_lot_number), '');
  v_provider_name text := nullif(btrim(p_provider_name), '');
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
  v_duplicate_count integer := 0;
  v_operation private.staff_vaccination_operations%rowtype;
  v_previous public.staff_vaccination_versions%rowtype;
  v_result public.staff_vaccination_versions%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_vaccination_key is null or p_staff_membership_id is null
     or p_idempotency_key is null or p_expected_base_version is null
     or p_expected_base_version < 0 or v_action not in ('create', 'correct', 'void')
     or not private.staff_health_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_health.manage'
     ) then
    raise exception using errcode = '42501',
      message = 'staff vaccination write is not permitted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-vaccination-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
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
        message = 'new staff vaccination base is invalid';
    end if;
  elsif p_previous_version_id is null or p_expected_base_version < 1
     or v_correction_reason is null or char_length(v_correction_reason) > 1000
     or translate(v_correction_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'staff vaccination correction base or reason is invalid';
  end if;

  if v_action in ('create', 'correct') then
    if v_vaccine_name is null or char_length(v_vaccine_name) > 160
       or v_vaccine_name ~ '[[:cntrl:]]'
       or v_dose_number is null or char_length(v_dose_number) > 80
       or v_dose_number ~ '[[:cntrl:]]'
       or p_vaccinated_on is null
       or extract(year from p_vaccinated_on) not between 1900 and 2200
       or (v_lot_number is not null and (
         char_length(v_lot_number) > 160 or v_lot_number ~ '[[:cntrl:]]'
       ))
       or v_provider_name is null or char_length(v_provider_name) > 200
       or v_provider_name ~ '[[:cntrl:]]'
       or v_evidence_status not in ('missing', 'not_applicable')
       or v_attachment_reference is not null or v_attachment_sha256 is not null then
      raise exception using errcode = '22023',
        message = 'staff vaccination content or attachment evidence is invalid';
    end if;
  elsif v_vaccine_name is not null or v_dose_number is not null
     or p_vaccinated_on is not null or v_lot_number is not null
     or v_provider_name is not null or v_evidence_status <> ''
     or v_attachment_reference is not null or v_attachment_sha256 is not null then
    raise exception using errcode = '22023',
      message = 'void operation must copy immutable prior vaccination content';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', v_action,
    'vaccination_key', p_vaccination_key,
    'previous_version_id', p_previous_version_id,
    'expected_base_version', p_expected_base_version,
    'staff_membership_id', p_staff_membership_id,
    'vaccine_name', v_vaccine_name,
    'dose_number', v_dose_number,
    'vaccinated_on', p_vaccinated_on,
    'lot_number', v_lot_number,
    'provider_name', v_provider_name,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');

  select operation.* into v_operation
  from private.staff_vaccination_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'staff vaccination idempotency key reused with different content';
    end if;
    select record.* into v_result
    from public.staff_vaccination_versions record
    where record.id = v_operation.result_record_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.vaccination_key = p_vaccination_key
      and record.staff_membership_id = p_staff_membership_id;
    if not found or not private.staff_health_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'staff_health.manage'
       ) then
      raise exception using errcode = '42501',
        message = 'staff vaccination replay is no longer permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.vaccination_key, v_result.id, v_result.version,
      v_result.previous_version_id, v_result.record_status,
      v_result.staff_membership_id, v_result.content_hash,
      v_operation.result_duplicate_count > 0,
      v_operation.result_duplicate_count,
      v_operation.result_duplicate_basis,
      v_result.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staff-vaccination:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_vaccination_key::text, 0
  ));
  if v_action = 'create' then
    if exists (
      select 1 from public.staff_vaccination_versions record
      where record.organization_id = p_expected_organization_id
        and record.branch_id = p_expected_branch_id
        and record.vaccination_key = p_vaccination_key
    ) then
      raise exception using errcode = '23505',
        message = 'staff vaccination key already exists';
    end if;
    v_version := 1;
    v_record_status := 'active';
  else
    select record.* into v_previous
    from public.staff_vaccination_versions record
    where record.id = p_previous_version_id
      and record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and record.vaccination_key = p_vaccination_key
      and record.staff_membership_id = p_staff_membership_id
    for share;
    if not found or v_previous.version <> p_expected_base_version
       or v_previous.record_status <> 'active'
       or exists (
         select 1 from public.staff_vaccination_versions later
         where later.vaccination_key = p_vaccination_key
           and later.version > v_previous.version
       ) then
      raise exception using errcode = '40001',
        message = 'staff vaccination base version is stale';
    end if;
    v_version := v_previous.version + 1;
    v_record_status := case when v_action = 'void' then 'voided' else 'active' end;
    if v_action = 'void' then
      v_vaccine_name := v_previous.vaccine_name;
      v_dose_number := v_previous.dose_number;
      p_vaccinated_on := v_previous.vaccinated_on;
      v_lot_number := v_previous.lot_number;
      v_provider_name := v_previous.provider_name;
      v_evidence_status := v_previous.evidence_status;
      v_attachment_reference := v_previous.attachment_reference;
      v_attachment_sha256 := v_previous.attachment_sha256;
    end if;
  end if;

  v_now := clock_timestamp();
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'vaccination_key', p_vaccination_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_status', v_record_status,
    'correction_reason', v_correction_reason,
    'staff_membership_id', p_staff_membership_id,
    'staff_user_id', v_staff_user_id,
    'staff_display_name', v_staff_display_name,
    'staff_employee_code', v_staff_employee_code,
    'vaccine_name', v_vaccine_name,
    'dose_number', v_dose_number,
    'vaccinated_on', p_vaccinated_on,
    'lot_number', v_lot_number,
    'provider_name', v_provider_name,
    'evidence_status', v_evidence_status,
    'attachment_reference', v_attachment_reference,
    'attachment_sha256', v_attachment_sha256,
    'recorded_by', v_actor,
    'recorded_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.staff_vaccination_versions (
    organization_id, branch_id, vaccination_key, version, previous_version_id,
    record_status, correction_reason, staff_membership_id, staff_user_id,
    staff_display_name, staff_employee_code, vaccine_name, dose_number,
    vaccinated_on, lot_number, provider_name, evidence_status,
    attachment_reference, attachment_sha256, recorded_by, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_vaccination_key,
    v_version, p_previous_version_id, v_record_status, v_correction_reason,
    p_staff_membership_id, v_staff_user_id, v_staff_display_name,
    v_staff_employee_code, v_vaccine_name, v_dose_number,
    p_vaccinated_on, v_lot_number, v_provider_name, v_evidence_status,
    v_attachment_reference, v_attachment_sha256, v_actor, v_now, v_content_hash
  ) returning * into v_result;

  if not private.staff_health_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_health.manage'
     ) or not private.staff_health_target_in_scope(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id, true
     ) then
    raise exception using errcode = '40001',
      message = 'staff vaccination final verification failed';
  end if;

  with latest as (
    select distinct on (record.vaccination_key) record.*
    from public.staff_vaccination_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
    order by record.vaccination_key, record.version desc
  )
  select count(*)::integer into v_duplicate_count
  from latest match
  where match.vaccination_key <> p_vaccination_key
    and match.record_status = 'active'
    and v_result.record_status = 'active'
    and match.staff_membership_id = p_staff_membership_id
    and lower(btrim(match.vaccine_name)) = lower(btrim(v_result.vaccine_name))
    and lower(btrim(match.dose_number)) = lower(btrim(v_result.dose_number));

  insert into private.staff_vaccination_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_record_version_id, result_duplicate_count,
    result_duplicate_basis, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_duplicate_count,
    'same_staff_normalized_vaccine_and_dose', v_now
  );

  return query select v_result.organization_id, v_result.branch_id,
    v_result.vaccination_key, v_result.id, v_result.version,
    v_result.previous_version_id, v_result.record_status,
    v_result.staff_membership_id, v_result.content_hash,
    v_duplicate_count > 0, v_duplicate_count,
    'same_staff_normalized_vaccine_and_dose'::text, v_result.recorded_at, false;
end;
$$;

create or replace function private.staff_vaccination_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz,
  p_staff_membership_id uuid,
  p_vaccine_name text,
  p_dose_number text,
  p_date_from date,
  p_date_to date,
  p_status text,
  p_search text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Taipei')::date;
  v_vaccine_name text := nullif(btrim(p_vaccine_name), '');
  v_dose_number text := nullif(btrim(p_dose_number), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_search text := lower(nullif(btrim(p_search), ''));
  v_records jsonb := '[]'::jsonb;
  v_record_total bigint := 0;
  v_history jsonb := '[]'::jsonb;
  v_history_total bigint := 0;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_vaccine_options jsonb := '[]'::jsonb;
  v_vaccine_total bigint := 0;
  v_dose_options jsonb := '[]'::jsonb;
  v_dose_total bigint := 0;
  v_missing_evidence_total bigint := 0;
  v_duplicate_warning_total bigint := 0;
  v_current_month_total bigint := 0;
begin
  with latest as (
    select distinct on (record.vaccination_key) record.*
    from public.staff_vaccination_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_health_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vaccination_key, record.version desc
  ), derived as (
    select latest.*,
      coalesce((select count(*)::integer from latest match
        where match.vaccination_key <> latest.vaccination_key
          and match.record_status = 'active'
          and latest.record_status = 'active'
          and match.staff_membership_id = latest.staff_membership_id
          and lower(btrim(match.vaccine_name)) = lower(btrim(latest.vaccine_name))
          and lower(btrim(match.dose_number)) = lower(btrim(latest.dose_number))), 0)
        as duplicate_count,
      coalesce((select jsonb_agg(jsonb_build_object(
          'vaccination_key', match.vaccination_key,
          'record_version_id', match.id,
          'vaccinated_on', match.vaccinated_on
        ) order by match.vaccinated_on desc, match.vaccination_key)
        from (
          select candidate.vaccination_key, candidate.id, candidate.vaccinated_on
          from latest candidate
          where candidate.vaccination_key <> latest.vaccination_key
            and candidate.record_status = 'active'
            and latest.record_status = 'active'
            and candidate.staff_membership_id = latest.staff_membership_id
            and lower(btrim(candidate.vaccine_name)) = lower(btrim(latest.vaccine_name))
            and lower(btrim(candidate.dose_number)) = lower(btrim(latest.dose_number))
          order by candidate.vaccinated_on desc, candidate.vaccination_key
          limit 200
        ) match),
        '[]'::jsonb) as duplicate_matches
    from latest
  ), filtered as (
    select derived.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from derived
    left join public.profiles recorder on recorder.id = derived.recorded_by
    where (p_staff_membership_id is null
        or derived.staff_membership_id = p_staff_membership_id)
      and (v_vaccine_name is null or derived.vaccine_name = v_vaccine_name)
      and (v_dose_number is null or derived.dose_number = v_dose_number)
      and (p_date_from is null or derived.vaccinated_on >= p_date_from)
      and (p_date_to is null or derived.vaccinated_on <= p_date_to)
      and (v_status = 'all'
        or (v_status = 'active' and derived.record_status = 'active')
        or (v_status = 'voided' and derived.record_status = 'voided')
        or (v_status = 'missing_evidence' and derived.evidence_status = 'missing')
        or (v_status = 'duplicate_warning' and derived.duplicate_count > 0))
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        derived.staff_display_name, derived.staff_employee_code,
        derived.vaccine_name, derived.dose_number,
        derived.lot_number, derived.provider_name
      ))) > 0)
  ), ranked as (
    select filtered.*, row_number() over (
      order by vaccinated_on desc, staff_display_name collate "C", vaccination_key
    ) as row_number
    from filtered
  )
  select count(*)::bigint,
    count(*) filter (where evidence_status = 'missing')::bigint,
    count(*) filter (where duplicate_count > 0)::bigint,
    count(*) filter (where date_trunc('month', vaccinated_on::timestamp)
      = date_trunc('month', v_today::timestamp))::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'vaccination_key', vaccination_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'staff_membership_id', staff_membership_id,
      'staff_user_id', staff_user_id,
      'staff_display_name', staff_display_name,
      'staff_employee_code', staff_employee_code,
      'vaccine_name', vaccine_name,
      'dose_number', dose_number,
      'vaccinated_on', vaccinated_on,
      'lot_number', lot_number,
      'provider_name', provider_name,
      'evidence_status', evidence_status,
      'duplicate_warning', duplicate_count > 0,
      'duplicate_count', duplicate_count,
      'duplicate_basis', 'same_staff_normalized_vaccine_and_dose',
      'duplicate_matches', duplicate_matches,
      'duplicate_matches_truncated', duplicate_count > 200,
      'medical_interpretation_status', 'not_evaluated',
      'recorded_by', recorded_by,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by vaccinated_on desc, staff_display_name collate "C", vaccination_key)
      filter (where row_number <= 200), '[]'::jsonb)
  into v_record_total, v_missing_evidence_total,
    v_duplicate_warning_total, v_current_month_total, v_records
  from ranked;

  with visible as (
    select record.*,
      coalesce(recorder.display_name, '已停用帳號') as recorded_by_display_name
    from public.staff_vaccination_versions record
    left join public.profiles recorder on recorder.id = record.recorded_by
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_health_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
      and (p_staff_membership_id is null
        or record.staff_membership_id = p_staff_membership_id)
      and (v_vaccine_name is null or record.vaccine_name = v_vaccine_name)
      and (v_dose_number is null or record.dose_number = v_dose_number)
      and (p_date_from is null or record.vaccinated_on >= p_date_from)
      and (p_date_to is null or record.vaccinated_on <= p_date_to)
  ), ranked as (
    select visible.*, row_number() over (
      order by vaccination_key, version desc
    ) as row_number from visible
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'record_version_id', id,
      'vaccination_key', vaccination_key,
      'version', version,
      'previous_version_id', previous_version_id,
      'record_status', record_status,
      'correction_reason', correction_reason,
      'vaccine_name', vaccine_name,
      'dose_number', dose_number,
      'vaccinated_on', vaccinated_on,
      'lot_number', lot_number,
      'provider_name', provider_name,
      'evidence_status', evidence_status,
      'recorded_by_display_name', recorded_by_display_name,
      'recorded_at', recorded_at,
      'content_hash', content_hash
    ) order by vaccination_key, version desc)
      filter (where row_number <= 500), '[]'::jsonb)
  into v_history_total, v_history from ranked;

  with latest as (
    select distinct on (record.vaccination_key) record.*
    from public.staff_vaccination_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_health_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vaccination_key, record.version desc
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
      and private.staff_health_can_access_target(
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
    select distinct on (record.vaccination_key) record.*
    from public.staff_vaccination_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_health_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vaccination_key, record.version desc
  ), grouped as (
    select vaccine_name, count(*)::bigint as record_count
    from latest group by vaccine_name
  ), ranked as (
    select grouped.*, row_number() over (
      order by vaccine_name collate "C"
    ) as row_number from grouped
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'vaccine_name', vaccine_name,
      'record_count', record_count
    ) order by vaccine_name collate "C")
      filter (where row_number <= 200), '[]'::jsonb)
  into v_vaccine_total, v_vaccine_options from ranked;

  with latest as (
    select distinct on (record.vaccination_key) record.*
    from public.staff_vaccination_versions record
    where record.organization_id = p_expected_organization_id
      and record.branch_id = p_expected_branch_id
      and private.staff_health_can_access_target(
        p_expected_organization_id, p_expected_branch_id,
        record.staff_membership_id
      )
    order by record.vaccination_key, record.version desc
  ), grouped as (
    select dose_number, count(*)::bigint as record_count
    from latest group by dose_number
  ), ranked as (
    select grouped.*, row_number() over (
      order by dose_number collate "C"
    ) as row_number from grouped
  )
  select count(*)::bigint,
    coalesce(jsonb_agg(jsonb_build_object(
      'dose_number', dose_number,
      'record_count', record_count
    ) order by dose_number collate "C")
      filter (where row_number <= 200), '[]'::jsonb)
  into v_dose_total, v_dose_options from ranked;

  return jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_now,
    'snapshot_date', v_today,
    'records', v_records,
    'record_total', v_record_total,
    'records_truncated', v_record_total > 200,
    'missing_evidence_total', v_missing_evidence_total,
    'duplicate_warning_total', v_duplicate_warning_total,
    'current_month_total', v_current_month_total,
    'history', v_history,
    'history_total', v_history_total,
    'history_truncated', v_history_total > 500,
    'staff_options', v_staff_options,
    'staff_total', v_staff_total,
    'staff_truncated', v_staff_total > 200,
    'vaccine_options', v_vaccine_options,
    'vaccine_total', v_vaccine_total,
    'vaccines_truncated', v_vaccine_total > 200,
    'dose_options', v_dose_options,
    'dose_total', v_dose_total,
    'doses_truncated', v_dose_total > 200,
    'duplicate_rule_status', 'configured',
    'duplicate_basis', 'same_staff_normalized_vaccine_and_dose',
    'duplicate_resolution', 'warning_only_no_auto_merge',
    'medical_interpretation_status', 'not_evaluated',
    'reminder_schedule_status', 'not_configured',
    'reminder_days', null,
    'reminder_total', null,
    'attachment_pipeline_status', 'not_configured',
    'attachment_scan_status', 'not_configured'
  );
end;
$$;

create or replace function private.staff_vaccination_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_vaccine_name text,
  p_dose_number text,
  p_date_from date,
  p_date_to date,
  p_status text,
  p_search text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, missing_evidence_total bigint,
  duplicate_warning_total bigint, current_month_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  vaccine_options jsonb, vaccine_total bigint, vaccines_truncated boolean,
  dose_options jsonb, dose_total bigint, doses_truncated boolean,
  duplicate_rule_status text, duplicate_basis text,
  duplicate_resolution text, medical_interpretation_status text,
  reminder_schedule_status text, reminder_days integer,
  reminder_total bigint, attachment_pipeline_status text,
  attachment_scan_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_vaccine_name text := nullif(btrim(p_vaccine_name), '');
  v_dose_number text := nullif(btrim(p_dose_number), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_search text := nullif(btrim(p_search), '');
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_status not in (
       'all', 'active', 'voided', 'missing_evidence', 'duplicate_warning'
     )
     or (v_vaccine_name is not null and (
       char_length(v_vaccine_name) > 160 or v_vaccine_name ~ '[[:cntrl:]]'
     ))
     or (v_dose_number is not null and (
       char_length(v_dose_number) > 80 or v_dose_number ~ '[[:cntrl:]]'
     ))
     or (p_date_from is not null and extract(year from p_date_from) not between 1900 and 2200)
     or (p_date_to is not null and extract(year from p_date_to) not between 1900 and 2200)
     or (p_date_from is not null and p_date_to is not null and p_date_to < p_date_from)
     or (v_search is not null and (
       char_length(v_search) > 120 or v_search ~ '[[:cntrl:]]'
     ))
     or not private.staff_health_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_health.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff vaccination snapshot is not permitted';
  end if;
  if p_staff_membership_id is not null
     and not private.staff_health_can_access_target(
       p_expected_organization_id, p_expected_branch_id,
       p_staff_membership_id
     ) then
    raise exception using errcode = '42501',
      message = 'staff vaccination target is outside current scope';
  end if;

  v_now := clock_timestamp();
  v_bundle := private.staff_vaccination_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_vaccine_name, v_dose_number,
    p_date_from, p_date_to, v_status, v_search
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'staff_vaccination_snapshot', p_expected_branch_id::text,
    array['bounded_snapshot'], jsonb_build_object(
      'workflow', 'page73_staff_vaccinations_v1',
      'generated_at', v_now,
      'staff_filter_present', p_staff_membership_id is not null,
      'vaccine_filter_present', v_vaccine_name is not null,
      'dose_filter_present', v_dose_number is not null,
      'date_from_present', p_date_from is not null,
      'date_to_present', p_date_to is not null,
      'status', v_status,
      'search_present', v_search is not null,
      'record_total', v_bundle -> 'record_total',
      'duplicate_warning_total', v_bundle -> 'duplicate_warning_total'
    )
  );

  if not private.staff_health_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'staff_health.read'
     ) then
    raise exception using errcode = '42501',
      message = 'staff vaccination snapshot final verification failed';
  end if;
  v_after := private.staff_vaccination_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_staff_membership_id, v_vaccine_name, v_dose_number,
    p_date_from, p_date_to, v_status, v_search
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001',
      message = 'staff vaccination snapshot changed during audit';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    (v_bundle ->> 'missing_evidence_total')::bigint,
    (v_bundle ->> 'duplicate_warning_total')::bigint,
    (v_bundle ->> 'current_month_total')::bigint,
    v_bundle -> 'history',
    (v_bundle ->> 'history_total')::bigint,
    (v_bundle ->> 'history_truncated')::boolean,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'vaccine_options',
    (v_bundle ->> 'vaccine_total')::bigint,
    (v_bundle ->> 'vaccines_truncated')::boolean,
    v_bundle -> 'dose_options',
    (v_bundle ->> 'dose_total')::bigint,
    (v_bundle ->> 'doses_truncated')::boolean,
    v_bundle ->> 'duplicate_rule_status',
    v_bundle ->> 'duplicate_basis',
    v_bundle ->> 'duplicate_resolution',
    v_bundle ->> 'medical_interpretation_status',
    v_bundle ->> 'reminder_schedule_status',
    (v_bundle ->> 'reminder_days')::integer,
    (v_bundle ->> 'reminder_total')::bigint,
    v_bundle ->> 'attachment_pipeline_status',
    v_bundle ->> 'attachment_scan_status';
end;
$$;

create or replace function public.append_staff_vaccination(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_vaccination_key uuid,
  p_previous_version_id uuid,
  p_expected_base_version integer,
  p_staff_membership_id uuid,
  p_vaccine_name text,
  p_dose_number text,
  p_vaccinated_on date,
  p_lot_number text,
  p_provider_name text,
  p_evidence_status text,
  p_attachment_reference text,
  p_attachment_sha256 text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, vaccination_key uuid,
  record_version_id uuid, version integer, previous_version_id uuid,
  record_status text, staff_membership_id uuid, content_hash text,
  duplicate_warning boolean, duplicate_count integer,
  duplicate_basis text, recorded_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.append_staff_vaccination_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_vaccination_key, p_previous_version_id, p_expected_base_version,
    p_staff_membership_id, p_vaccine_name, p_dose_number,
    p_vaccinated_on, p_lot_number, p_provider_name, p_evidence_status,
    p_attachment_reference, p_attachment_sha256, p_correction_reason,
    p_idempotency_key
  );
$$;

create or replace function public.staff_vaccination_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid default null,
  p_vaccine_name text default null,
  p_dose_number text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default 'all',
  p_search text default null
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, records jsonb, record_total bigint,
  records_truncated boolean, missing_evidence_total bigint,
  duplicate_warning_total bigint, current_month_total bigint,
  history jsonb, history_total bigint, history_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  vaccine_options jsonb, vaccine_total bigint, vaccines_truncated boolean,
  dose_options jsonb, dose_total bigint, doses_truncated boolean,
  duplicate_rule_status text, duplicate_basis text,
  duplicate_resolution text, medical_interpretation_status text,
  reminder_schedule_status text, reminder_days integer,
  reminder_total bigint, attachment_pipeline_status text,
  attachment_scan_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.staff_vaccination_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_staff_membership_id, p_vaccine_name, p_dose_number,
    p_date_from, p_date_to, p_status, p_search
  );
$$;

alter table public.staff_vaccination_versions enable row level security;
alter table public.staff_vaccination_versions force row level security;
create policy staff_vaccination_versions_select
on public.staff_vaccination_versions for select to authenticated
using (private.staff_health_can_access_target(
  organization_id, branch_id, staff_membership_id
));

revoke all on table public.staff_vaccination_versions
  from public, anon, authenticated, service_role;
revoke all on table private.staff_vaccination_operations
  from public, anon, authenticated, service_role;

revoke all on function private.staff_vaccination_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.staff_health_current_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_health_target_in_scope(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.staff_health_can_access_target(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.append_staff_vaccination_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date,
  text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.staff_vaccination_snapshot_bundle(
  uuid, uuid, timestamptz, uuid, text, text, date, date, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.staff_vaccination_snapshot_response(
  uuid, uuid, uuid, text, text, date, date, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.append_staff_vaccination(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date,
  text, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.staff_vaccination_snapshot(
  uuid, uuid, uuid, text, text, date, date, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.append_staff_vaccination(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date,
  text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function public.staff_vaccination_snapshot(
  uuid, uuid, uuid, text, text, date, date, text, text
) to authenticated;
grant execute on function private.append_staff_vaccination_guarded(
  uuid, uuid, text, uuid, uuid, integer, uuid, text, text, date,
  text, text, text, text, text, text, uuid
) to authenticated;
grant execute on function private.staff_vaccination_snapshot_response(
  uuid, uuid, uuid, text, text, date, date, text, text
) to authenticated;

comment on table public.staff_vaccination_versions is
  'Immutable employee vaccination facts and correction chain; no medical interpretation or schedule is inferred.';
comment on function public.staff_vaccination_snapshot(
  uuid, uuid, uuid, text, text, date, date, text, text
) is
  'Returns one audited Page 73 snapshot with warning-only duplicate projection and explicitly unconfigured reminder and attachment services.';
