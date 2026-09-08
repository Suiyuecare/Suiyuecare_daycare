-- Page 66: immutable device-event deduplication, append-only staff matching
-- corrections, and a transparent fail-closed attainment formula boundary.

insert into public.permissions (permission_key, description, risk_level) values
  ('hand_hygiene.read', 'Read branch hand-hygiene event projections', 2),
  ('hand_hygiene.manage', 'Append hand-hygiene event matching corrections', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('hand_hygiene.read', 'hand_hygiene.manage')
on conflict (role_id, permission_id) do nothing;

create table public.hand_hygiene_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  source_provider text not null,
  source_event_id text not null,
  device_code text not null,
  event_kind text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  source_staff_membership_id uuid references public.memberships(id) on delete restrict,
  source_staff_user_id uuid references public.profiles(id) on delete restrict,
  source_staff_display_name text,
  source_staff_employee_code text,
  payload_sha256 text not null,
  request_hash text not null,
  ingested_at timestamptz not null,
  constraint hand_hygiene_event_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint hand_hygiene_event_id_scope_key unique (id, organization_id, branch_id),
  constraint hand_hygiene_event_source_key unique (
    organization_id, branch_id, source_provider, source_event_id
  ),
  constraint hand_hygiene_event_source_text_check check (
    char_length(source_provider) between 1 and 120
    and source_provider = btrim(source_provider)
    and source_provider !~ '[[:cntrl:]]'
    and char_length(source_event_id) between 1 and 240
    and source_event_id = btrim(source_event_id)
    and source_event_id !~ '[[:cntrl:]]'
    and char_length(device_code) between 1 and 120
    and device_code = btrim(device_code)
    and device_code !~ '[[:cntrl:]]'
  ),
  constraint hand_hygiene_event_kind_check check (
    event_kind in ('hygiene_performed', 'opportunity')
  ),
  constraint hand_hygiene_event_time_check check (
    isfinite(occurred_at) and isfinite(received_at) and isfinite(ingested_at)
    and extract(year from occurred_at at time zone 'Asia/Taipei') between 1900 and 2200
    and extract(year from received_at at time zone 'Asia/Taipei') between 1900 and 2200
  ),
  constraint hand_hygiene_event_source_staff_check check (
    (source_staff_membership_id is null
      and source_staff_user_id is null
      and source_staff_display_name is null
      and source_staff_employee_code is null)
    or
    (source_staff_membership_id is not null
      and source_staff_user_id is not null
      and char_length(source_staff_display_name) between 1 and 120
      and source_staff_display_name = btrim(source_staff_display_name)
      and source_staff_display_name !~ '[[:cntrl:]]'
      and (source_staff_employee_code is null or (
        char_length(source_staff_employee_code) between 1 and 120
        and source_staff_employee_code = btrim(source_staff_employee_code)
        and source_staff_employee_code !~ '[[:cntrl:]]'
      )))
  ),
  constraint hand_hygiene_event_hash_check check (
    payload_sha256 ~ '^[a-f0-9]{64}$' and request_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.hand_hygiene_match_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  event_id uuid not null,
  correction_sequence integer not null,
  previous_correction_id uuid,
  match_status text not null,
  staff_membership_id uuid references public.memberships(id) on delete restrict,
  staff_user_id uuid references public.profiles(id) on delete restrict,
  staff_display_name text,
  staff_employee_code text,
  correction_reason text not null,
  corrected_by uuid not null references public.profiles(id) on delete restrict,
  corrected_by_display_name text not null,
  corrected_at timestamptz not null,
  content_hash text not null,
  constraint hand_hygiene_correction_event_scope_fkey
    foreign key (event_id, organization_id, branch_id)
    references public.hand_hygiene_events(id, organization_id, branch_id)
    on delete restrict,
  constraint hand_hygiene_correction_id_scope_key unique (
    id, organization_id, branch_id, event_id
  ),
  constraint hand_hygiene_correction_id_branch_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint hand_hygiene_correction_event_sequence_key unique (
    event_id, correction_sequence
  ),
  constraint hand_hygiene_correction_previous_unique unique (previous_correction_id),
  constraint hand_hygiene_correction_previous_scope_fkey foreign key (
    previous_correction_id, organization_id, branch_id, event_id
  ) references public.hand_hygiene_match_corrections(
    id, organization_id, branch_id, event_id
  ) on delete restrict,
  constraint hand_hygiene_correction_sequence_check check (
    correction_sequence > 0
    and ((correction_sequence = 1 and previous_correction_id is null)
      or (correction_sequence > 1 and previous_correction_id is not null))
  ),
  constraint hand_hygiene_correction_match_check check (
    match_status in ('matched', 'unmatched', 'excluded')
    and ((match_status = 'matched'
      and staff_membership_id is not null
      and staff_user_id is not null
      and char_length(staff_display_name) between 1 and 120
      and staff_display_name = btrim(staff_display_name)
      and staff_display_name !~ '[[:cntrl:]]'
      and (staff_employee_code is null or (
        char_length(staff_employee_code) between 1 and 120
        and staff_employee_code = btrim(staff_employee_code)
        and staff_employee_code !~ '[[:cntrl:]]'
      ))) or (match_status in ('unmatched', 'excluded')
        and staff_membership_id is null and staff_user_id is null
        and staff_display_name is null and staff_employee_code is null))
  ),
  constraint hand_hygiene_correction_reason_check check (
    char_length(correction_reason) between 1 and 1000
    and correction_reason = btrim(correction_reason)
    and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint hand_hygiene_correction_actor_check check (
    char_length(corrected_by_display_name) between 1 and 120
    and corrected_by_display_name = btrim(corrected_by_display_name)
    and corrected_by_display_name !~ '[[:cntrl:]]'
    and isfinite(corrected_at)
  ),
  constraint hand_hygiene_correction_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.hand_hygiene_correction_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_correction_id uuid not null,
  created_at timestamptz not null,
  constraint hand_hygiene_operation_actor_key unique (actor_user_id, idempotency_key),
  constraint hand_hygiene_operation_result_scope_fkey foreign key (
    result_correction_id, organization_id, branch_id
  ) references public.hand_hygiene_match_corrections(id, organization_id, branch_id)
    on delete restrict,
  constraint hand_hygiene_operation_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$' and isfinite(created_at)
  )
);

create index hand_hygiene_events_branch_time_idx
  on public.hand_hygiene_events(branch_id, organization_id, occurred_at desc, id desc);
create index hand_hygiene_events_source_membership_idx
  on public.hand_hygiene_events(source_staff_membership_id)
  where source_staff_membership_id is not null;
create index hand_hygiene_events_source_user_idx
  on public.hand_hygiene_events(source_staff_user_id)
  where source_staff_user_id is not null;
create index hand_hygiene_corrections_event_idx
  on public.hand_hygiene_match_corrections(event_id, correction_sequence desc);
create index hand_hygiene_corrections_previous_idx
  on public.hand_hygiene_match_corrections(previous_correction_id)
  where previous_correction_id is not null;
create index hand_hygiene_corrections_staff_membership_idx
  on public.hand_hygiene_match_corrections(staff_membership_id)
  where staff_membership_id is not null;
create index hand_hygiene_corrections_staff_user_idx
  on public.hand_hygiene_match_corrections(staff_user_id)
  where staff_user_id is not null;
create index hand_hygiene_corrections_actor_idx
  on public.hand_hygiene_match_corrections(corrected_by);
create index hand_hygiene_operations_result_idx
  on private.hand_hygiene_correction_operations(
    result_correction_id, organization_id, branch_id
  );

create or replace function private.hand_hygiene_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger hand_hygiene_events_append_only before update or delete
on public.hand_hygiene_events for each row
execute function private.hand_hygiene_append_only();
create trigger hand_hygiene_corrections_append_only before update or delete
on public.hand_hygiene_match_corrections for each row
execute function private.hand_hygiene_append_only();
create trigger hand_hygiene_operations_append_only before update or delete
on private.hand_hygiene_correction_operations for each row
execute function private.hand_hygiene_append_only();

create trigger hand_hygiene_events_audit_row_change after insert
on public.hand_hygiene_events for each row execute function private.audit_row_change();
create trigger hand_hygiene_match_corrections_audit_row_change after insert
on public.hand_hygiene_match_corrections for each row execute function private.audit_row_change();

create or replace function private.hand_hygiene_authority(
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
        and profile.is_active
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
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

create or replace function private.resolve_hand_hygiene_staff(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_staff_membership_id uuid,
  p_event_at timestamptz
)
returns table(
  staff_user_id uuid,
  display_name text,
  employee_code text,
  is_current boolean
)
language sql stable security definer set search_path = '' as $$
  select profile.id,
    btrim(profile.display_name),
    nullif(btrim(profile.employee_code), ''),
    membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and profile.is_active
  from public.memberships membership
  join public.profiles profile on profile.id = membership.profile_id
  where membership.id = p_staff_membership_id
    and membership.organization_id = p_expected_organization_id
    and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    and membership.status in ('active', 'ended')
    and membership.starts_at <= p_event_at
    and (membership.ends_at is null or membership.ends_at > p_event_at)
    and profile.kind in ('staff', 'professional', 'driver', 'finance');
$$;

create or replace function private.ingest_hand_hygiene_event_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_source_provider text,
  p_source_event_id text,
  p_device_code text,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_received_at timestamptz,
  p_source_staff_membership_id uuid,
  p_payload_sha256 text
)
returns table(
  event_id uuid,
  source_event_id text,
  replayed boolean,
  deduplicated boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_provider text := btrim(p_source_provider);
  v_source_event text := btrim(p_source_event_id);
  v_device text := btrim(p_device_code);
  v_now timestamptz := clock_timestamp();
  v_request_hash text;
  v_existing public.hand_hygiene_events%rowtype;
  v_staff record;
  v_event_id uuid;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_provider is null or char_length(v_provider) not between 1 and 120
     or v_provider ~ '[[:cntrl:]]'
     or v_source_event is null or char_length(v_source_event) not between 1 and 240
     or v_source_event ~ '[[:cntrl:]]'
     or v_device is null or char_length(v_device) not between 1 and 120
     or v_device ~ '[[:cntrl:]]'
     or p_event_kind not in ('hygiene_performed', 'opportunity')
     or p_occurred_at is null or not isfinite(p_occurred_at)
     or p_received_at is null or not isfinite(p_received_at)
     or extract(year from p_occurred_at at time zone 'Asia/Taipei') not between 1900 and 2200
     or extract(year from p_received_at at time zone 'Asia/Taipei') not between 1900 and 2200
     or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023',
      message = 'hand hygiene source event is invalid';
  end if;
  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  ) then
    raise exception using errcode = '42501',
      message = 'hand hygiene source branch is not active';
  end if;

  if p_source_staff_membership_id is not null then
    select * into v_staff from private.resolve_hand_hygiene_staff(
      p_expected_organization_id, p_expected_branch_id,
      p_source_staff_membership_id, p_occurred_at
    );
    if not found then
      raise exception using errcode = '42501',
        message = 'hand hygiene source staff is outside event-time scope';
    end if;
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'source_provider', v_provider,
    'source_event_id', v_source_event,
    'device_code', v_device,
    'event_kind', p_event_kind,
    'occurred_at', p_occurred_at,
    'received_at', p_received_at,
    'source_staff_membership_id', p_source_staff_membership_id,
    'payload_sha256', p_payload_sha256
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    p_expected_organization_id::text || ':' || p_expected_branch_id::text || ':' ||
    v_provider || ':' || v_source_event, 66
  ));
  select * into v_existing
  from public.hand_hygiene_events event
  where event.organization_id = p_expected_organization_id
    and event.branch_id = p_expected_branch_id
    and event.source_provider = v_provider
    and event.source_event_id = v_source_event;
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'hand hygiene source identity conflicts with different content';
    end if;
    return query select v_existing.id, v_existing.source_event_id, true, true;
    return;
  end if;

  v_event_id := gen_random_uuid();
  insert into public.hand_hygiene_events (
    id, organization_id, branch_id, source_provider, source_event_id,
    device_code, event_kind, occurred_at, received_at,
    source_staff_membership_id, source_staff_user_id,
    source_staff_display_name, source_staff_employee_code,
    payload_sha256, request_hash, ingested_at
  ) values (
    v_event_id, p_expected_organization_id, p_expected_branch_id,
    v_provider, v_source_event, v_device, p_event_kind,
    p_occurred_at, p_received_at, p_source_staff_membership_id,
    case when p_source_staff_membership_id is null then null else v_staff.staff_user_id end,
    case when p_source_staff_membership_id is null then null else v_staff.display_name end,
    case when p_source_staff_membership_id is null then null else v_staff.employee_code end,
    p_payload_sha256, v_request_hash, v_now
  );
  return query select v_event_id, v_source_event, false, false;
end;
$$;

create or replace function private.correct_hand_hygiene_match_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_event_id uuid,
  p_expected_correction_sequence integer,
  p_match_status text,
  p_staff_membership_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  operation_id uuid,
  event_id uuid,
  correction_id uuid,
  correction_sequence integer,
  match_status text,
  staff_membership_id uuid,
  corrected_at timestamptz,
  replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_reason text := btrim(p_reason);
  v_now timestamptz := clock_timestamp();
  v_request_hash text;
  v_operation private.hand_hygiene_correction_operations%rowtype;
  v_event public.hand_hygiene_events%rowtype;
  v_previous public.hand_hygiene_match_corrections%rowtype;
  v_result public.hand_hygiene_match_corrections%rowtype;
  v_staff record;
begin
  if not private.hand_hygiene_authority(
    p_expected_organization_id, p_expected_branch_id, 'hand_hygiene.manage'
  ) then
    raise exception using errcode = '42501',
      message = 'hand hygiene correction is not permitted';
  end if;
  if p_event_id is null or p_expected_correction_sequence is null
     or p_expected_correction_sequence < 0
     or p_match_status not in ('matched', 'unmatched', 'excluded')
     or (p_match_status = 'matched') <> (p_staff_membership_id is not null)
     or v_reason is null or char_length(v_reason) not between 1 and 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'hand hygiene correction input is invalid';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', 'correct_match',
    'event_id', p_event_id,
    'expected_correction_sequence', p_expected_correction_sequence,
    'match_status', p_match_status,
    'staff_membership_id', p_staff_membership_id,
    'reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_idempotency_key::text, 66
  ));
  select * into v_operation
  from private.hand_hygiene_correction_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.request_hash <> v_request_hash
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id then
      raise exception using errcode = '23505',
        message = 'hand hygiene correction idempotency conflict';
    end if;
    if not private.hand_hygiene_authority(
      p_expected_organization_id, p_expected_branch_id, 'hand_hygiene.manage'
    ) then
      raise exception using errcode = '42501',
        message = 'hand hygiene correction replay is no longer permitted';
    end if;
    select * into v_result from public.hand_hygiene_match_corrections correction
    where correction.id = v_operation.result_correction_id
      and correction.organization_id = p_expected_organization_id
      and correction.branch_id = p_expected_branch_id;
    if not found then
      raise exception using errcode = '40001',
        message = 'hand hygiene correction replay receipt is unavailable';
    end if;
    return query select
      v_result.organization_id, v_result.branch_id, v_operation.id,
      v_result.event_id, v_result.id, v_result.correction_sequence,
      v_result.match_status, v_result.staff_membership_id,
      v_result.corrected_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 66));
  select * into v_event from public.hand_hygiene_events event
  where event.id = p_event_id
    and event.organization_id = p_expected_organization_id
    and event.branch_id = p_expected_branch_id
  for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'hand hygiene event is outside current scope';
  end if;
  select * into v_previous from public.hand_hygiene_match_corrections correction
  where correction.event_id = p_event_id
  order by correction.correction_sequence desc limit 1;
  if coalesce(v_previous.correction_sequence, 0) <> p_expected_correction_sequence then
    raise exception using errcode = '40001',
      message = 'hand hygiene correction sequence is stale';
  end if;

  if p_match_status = 'matched' then
    select * into v_staff from private.resolve_hand_hygiene_staff(
      p_expected_organization_id, p_expected_branch_id,
      p_staff_membership_id, v_event.occurred_at
    );
    if not found then
      raise exception using errcode = '42501',
        message = 'hand hygiene staff is outside event-time scope';
    end if;
  end if;
  select btrim(profile.display_name) into v_actor_name
  from public.profiles profile
  where profile.id = v_actor and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode = '42501',
      message = 'hand hygiene correction actor is unavailable';
  end if;

  insert into public.hand_hygiene_match_corrections (
    organization_id, branch_id, event_id, correction_sequence,
    previous_correction_id, match_status, staff_membership_id, staff_user_id,
    staff_display_name, staff_employee_code, correction_reason,
    corrected_by, corrected_by_display_name, corrected_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_event_id,
    p_expected_correction_sequence + 1,
    case when p_expected_correction_sequence = 0 then null else v_previous.id end,
    p_match_status, p_staff_membership_id,
    case when p_match_status = 'matched' then v_staff.staff_user_id else null end,
    case when p_match_status = 'matched' then v_staff.display_name else null end,
    case when p_match_status = 'matched' then v_staff.employee_code else null end,
    v_reason, v_actor, v_actor_name, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1,
      'event_id', p_event_id,
      'correction_sequence', p_expected_correction_sequence + 1,
      'previous_correction_id', case when p_expected_correction_sequence = 0
        then null else v_previous.id end,
      'match_status', p_match_status,
      'staff_membership_id', p_staff_membership_id,
      'reason', v_reason,
      'corrected_by', v_actor,
      'corrected_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_result;

  insert into private.hand_hygiene_correction_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_correction_id, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_now
  ) returning * into v_operation;

  if not private.hand_hygiene_authority(
    p_expected_organization_id, p_expected_branch_id, 'hand_hygiene.manage'
  ) then
    raise exception using errcode = '42501',
      message = 'hand hygiene correction final authorization failed';
  end if;
  return query select
    v_result.organization_id, v_result.branch_id, v_operation.id,
    v_result.event_id, v_result.id, v_result.correction_sequence,
    v_result.match_status, v_result.staff_membership_id,
    v_result.corrected_at, false;
end;
$$;

create or replace function private.hand_hygiene_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_staff_membership_id uuid default null,
  p_device_code text default null,
  p_match_status text default 'all',
  p_event_kind text default 'all',
  p_interaction text default 'view'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  events jsonb,
  event_total bigint,
  events_truncated boolean,
  performed_event_total bigint,
  matched_performed_total bigint,
  observed_opportunity_event_total bigint,
  unmatched_total bigint,
  excluded_total bigint,
  denominator_total bigint,
  attainment_rate numeric,
  staff_options jsonb,
  staff_total bigint,
  staff_truncated boolean,
  device_options jsonb,
  device_total bigint,
  devices_truncated boolean,
  numerator_definition text,
  denominator_policy_status text,
  denominator_definition text,
  source_integration_status text,
  export_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_device text := nullif(btrim(p_device_code), '');
  v_events jsonb := '[]'::jsonb;
  v_event_total bigint := 0;
  v_performed bigint := 0;
  v_matched_performed bigint := 0;
  v_opportunities bigint := 0;
  v_unmatched bigint := 0;
  v_excluded bigint := 0;
  v_staff_options jsonb := '[]'::jsonb;
  v_staff_total bigint := 0;
  v_device_options jsonb := '[]'::jsonb;
  v_device_total bigint := 0;
begin
  if not private.hand_hygiene_authority(
    p_expected_organization_id, p_expected_branch_id, 'hand_hygiene.read'
  ) then
    raise exception using errcode = '42501',
      message = 'hand hygiene snapshot is not permitted';
  end if;
  if (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or p_match_status not in ('all', 'matched', 'unmatched', 'excluded')
     or p_event_kind not in ('all', 'hygiene_performed', 'opportunity')
     or p_interaction not in ('view', 'search')
     or (v_device is not null and (
       char_length(v_device) > 120 or v_device ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023',
      message = 'hand hygiene snapshot filters are invalid';
  end if;

  with terminal as (
    select event.*,
      coalesce(correction.match_status,
        case when event.source_staff_membership_id is null
          then 'unmatched' else 'matched' end) as current_match_status,
      case
        when correction.id is not null then correction.staff_membership_id
        else event.source_staff_membership_id
      end
        as current_staff_membership_id,
      case
        when correction.id is not null then correction.staff_display_name
        else event.source_staff_display_name
      end
        as current_staff_display_name,
      case
        when correction.id is not null then correction.staff_employee_code
        else event.source_staff_employee_code
      end
        as current_staff_employee_code,
      coalesce(correction.correction_sequence, 0) as correction_sequence,
      correction.correction_reason,
      correction.corrected_by_display_name,
      correction.corrected_at
    from public.hand_hygiene_events event
    left join lateral (
      select candidate.*
      from public.hand_hygiene_match_corrections candidate
      where candidate.event_id = event.id
      order by candidate.correction_sequence desc
      limit 1
    ) correction on true
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
  ), filtered as (
    select * from terminal row
    where (p_date_from is null or
      (row.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (row.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (p_staff_membership_id is null or
        row.current_staff_membership_id = p_staff_membership_id)
      and (v_device is null or row.device_code = v_device)
      and (p_match_status = 'all' or row.current_match_status = p_match_status)
      and (p_event_kind = 'all' or row.event_kind = p_event_kind)
  ), stats as (
    select count(*)::bigint as event_total,
      count(*) filter (where event_kind = 'hygiene_performed'
        and current_match_status <> 'excluded')::bigint as performed_total,
      count(*) filter (where event_kind = 'hygiene_performed'
        and current_match_status = 'matched')::bigint as matched_performed_total,
      count(*) filter (where event_kind = 'opportunity'
        and current_match_status <> 'excluded')::bigint as opportunity_total,
      count(*) filter (where current_match_status = 'unmatched')::bigint as unmatched_total,
      count(*) filter (where current_match_status = 'excluded')::bigint as excluded_total
    from filtered
  ), limited as (
    select * from filtered
    order by occurred_at desc, received_at desc, id desc
    limit 200
  )
  select stats.event_total, stats.performed_total,
    stats.matched_performed_total, stats.opportunity_total,
    stats.unmatched_total, stats.excluded_total,
    coalesce((select jsonb_agg(jsonb_build_object(
      'event_id', item.id,
      'source_provider', item.source_provider,
      'source_event_id', item.source_event_id,
      'device_code', item.device_code,
      'event_kind', item.event_kind,
      'occurred_at', item.occurred_at,
      'received_at', item.received_at,
      'match_status', item.current_match_status,
      'staff_membership_id', item.current_staff_membership_id,
      'staff_display_name', item.current_staff_display_name,
      'staff_employee_code', item.current_staff_employee_code,
      'correction_sequence', item.correction_sequence,
      'correction_reason', item.correction_reason,
      'corrected_by_display_name', item.corrected_by_display_name,
      'corrected_at', item.corrected_at
    ) order by item.occurred_at desc, item.received_at desc, item.id desc)
      from limited item), '[]'::jsonb)
  into v_event_total, v_performed, v_matched_performed,
    v_opportunities, v_unmatched, v_excluded, v_events
  from stats;

  with candidates as (
    select membership.id as staff_membership_id,
      btrim(profile.display_name) as display_name,
      nullif(btrim(profile.employee_code), '') as employee_code,
      membership.status = 'active'
        and membership.starts_at <= v_now
        and (membership.ends_at is null or membership.ends_at > v_now)
        and profile.is_active as is_current
    from public.memberships membership
    join public.profiles profile on profile.id = membership.profile_id
    where membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status <> 'invited'
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
  ), ranked as (
    select *, count(*) over ()::bigint as total
    from candidates
    order by is_current desc, display_name collate "C", staff_membership_id
    limit 500
  )
  select coalesce(max(total), 0), coalesce(jsonb_agg(jsonb_build_object(
    'staff_membership_id', staff_membership_id,
    'display_name', display_name,
    'employee_code', employee_code,
    'is_current', is_current
  ) order by is_current desc, display_name collate "C", staff_membership_id), '[]'::jsonb)
  into v_staff_total, v_staff_options from ranked;

  with candidates as (
    select event.device_code, count(*)::bigint as event_count
    from public.hand_hygiene_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    group by event.device_code
  ), ranked as (
    select *, count(*) over ()::bigint as total
    from candidates
    order by device_code collate "C"
    limit 200
  )
  select coalesce(max(total), 0), coalesce(jsonb_agg(jsonb_build_object(
    'device_code', device_code, 'event_count', event_count
  ) order by device_code collate "C"), '[]'::jsonb)
  into v_device_total, v_device_options from ranked;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'hand_hygiene_snapshot', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page66_hand_hygiene_v1',
      'interaction', p_interaction,
      'returned_count', jsonb_array_length(v_events),
      'event_total', v_event_total,
      'events_truncated', v_event_total > jsonb_array_length(v_events),
      'denominator_policy_status', 'not_configured',
      'source_integration_status', 'database_contract_only'
    )
  );
  if not private.hand_hygiene_authority(
    p_expected_organization_id, p_expected_branch_id, 'hand_hygiene.read'
  ) then
    raise exception using errcode = '42501',
      message = 'hand hygiene snapshot authority expired after audit';
  end if;

  return query select
    p_expected_organization_id, p_expected_branch_id, v_now,
    v_events, v_event_total, v_event_total > jsonb_array_length(v_events),
    v_performed, v_matched_performed, v_opportunities, v_unmatched, v_excluded,
    null::bigint, null::numeric,
    v_staff_options, v_staff_total, v_staff_total > jsonb_array_length(v_staff_options),
    v_device_options, v_device_total, v_device_total > jsonb_array_length(v_device_options),
    'matched_distinct_hygiene_performed_events'::text,
    'not_configured'::text, null::text,
    'database_contract_only'::text, 'not_configured'::text;
end;
$$;

create or replace function public.ingest_hand_hygiene_event(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_source_provider text,
  p_source_event_id text,
  p_device_code text,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_received_at timestamptz,
  p_source_staff_membership_id uuid,
  p_payload_sha256 text
)
returns table(event_id uuid, source_event_id text, replayed boolean, deduplicated boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.ingest_hand_hygiene_event_guarded(
    p_expected_organization_id, p_expected_branch_id, p_source_provider,
    p_source_event_id, p_device_code, p_event_kind, p_occurred_at,
    p_received_at, p_source_staff_membership_id, p_payload_sha256
  );
$$;

create or replace function public.correct_hand_hygiene_match(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_event_id uuid,
  p_expected_correction_sequence integer,
  p_match_status text,
  p_staff_membership_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid,
  event_id uuid, correction_id uuid, correction_sequence integer,
  match_status text, staff_membership_id uuid, corrected_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.correct_hand_hygiene_match_guarded(
    p_expected_organization_id, p_expected_branch_id, p_event_id,
    p_expected_correction_sequence, p_match_status, p_staff_membership_id,
    p_reason, p_idempotency_key
  );
$$;

create or replace function public.hand_hygiene_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_staff_membership_id uuid default null,
  p_device_code text default null,
  p_match_status text default 'all',
  p_event_kind text default 'all',
  p_interaction text default 'view'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  events jsonb, event_total bigint, events_truncated boolean,
  performed_event_total bigint, matched_performed_total bigint,
  observed_opportunity_event_total bigint, unmatched_total bigint,
  excluded_total bigint, denominator_total bigint, attainment_rate numeric,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  device_options jsonb, device_total bigint, devices_truncated boolean,
  numerator_definition text, denominator_policy_status text,
  denominator_definition text, source_integration_status text, export_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.hand_hygiene_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_staff_membership_id, p_device_code, p_match_status, p_event_kind,
    p_interaction
  );
$$;

alter table public.hand_hygiene_events enable row level security;
alter table public.hand_hygiene_events force row level security;
alter table public.hand_hygiene_match_corrections enable row level security;
alter table public.hand_hygiene_match_corrections force row level security;
alter table private.hand_hygiene_correction_operations enable row level security;
alter table private.hand_hygiene_correction_operations force row level security;

create policy hand_hygiene_events_select on public.hand_hygiene_events
for select to authenticated using (private.hand_hygiene_authority(
  organization_id, branch_id, 'hand_hygiene.read'
));
create policy hand_hygiene_corrections_select on public.hand_hygiene_match_corrections
for select to authenticated using (private.hand_hygiene_authority(
  organization_id, branch_id, 'hand_hygiene.read'
));

revoke all on table public.hand_hygiene_events
  from public, anon, authenticated, service_role;
revoke all on table public.hand_hygiene_match_corrections
  from public, anon, authenticated, service_role;
revoke all on table private.hand_hygiene_correction_operations
  from public, anon, authenticated, service_role;

revoke all on function private.hand_hygiene_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.hand_hygiene_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_hand_hygiene_staff(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.ingest_hand_hygiene_event_guarded(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.correct_hand_hygiene_match_guarded(
  uuid, uuid, uuid, integer, text, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.hand_hygiene_snapshot_response(
  uuid, uuid, date, date, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.ingest_hand_hygiene_event(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.correct_hand_hygiene_match(
  uuid, uuid, uuid, integer, text, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.hand_hygiene_snapshot(
  uuid, uuid, date, date, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.ingest_hand_hygiene_event(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text
) to service_role;
grant execute on function private.ingest_hand_hygiene_event_guarded(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text
) to service_role;
grant execute on function public.correct_hand_hygiene_match(
  uuid, uuid, uuid, integer, text, uuid, text, uuid
) to authenticated;
grant execute on function private.correct_hand_hygiene_match_guarded(
  uuid, uuid, uuid, integer, text, uuid, text, uuid
) to authenticated;
grant execute on function public.hand_hygiene_snapshot(
  uuid, uuid, date, date, uuid, text, text, text, text
) to authenticated;
grant execute on function private.hand_hygiene_snapshot_response(
  uuid, uuid, date, date, uuid, text, text, text, text
) to authenticated;

comment on table public.hand_hygiene_events is
  'Immutable normalized device events; no raw provider payload is retained and the source identity is unique per tenant branch.';
comment on table public.hand_hygiene_match_corrections is
  'Append-only terminal matching corrections; source events and earlier corrections are never overwritten.';
comment on function public.ingest_hand_hygiene_event(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text
) is 'Service-role-only Page-66 source contract with exact source identity deduplication; no provider adapter is implied.';
comment on function public.hand_hygiene_snapshot(
  uuid, uuid, date, date, uuid, text, text, text, text
) is 'Returns an audited Page-66 snapshot. Denominator policy and attainment rate stay null until a governed institution rule is published.';
