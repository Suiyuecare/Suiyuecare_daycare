-- Page 75: immutable signed meeting minutes and append-only action progress.
--
-- Meeting categories, retention, escalation cadence, and external messaging
-- remain institution-owned and unconfigured.  Overdue is a local projection
-- computed from the audited snapshot's Asia/Taipei date; no notification is
-- created or implied by this workflow.

insert into public.permissions (permission_key, description, risk_level) values
  ('meetings.read', 'Read branch meeting minutes and action progress', 1),
  ('meetings.manage', 'Manage meeting minutes and append action progress', 2),
  ('meetings.sign', 'Sign immutable meeting minute versions and corrections', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional', 'transport_driver', 'finance_claims'
  )
  and permission.permission_key = 'meetings.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('meetings.manage', 'meetings.sign')
on conflict (role_id, permission_id) do nothing;

create or replace function private.meeting_text_array_normalized(p_value text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_value is not null
    and p_value = coalesce((
      select array_agg(distinct item order by item)
      from unnest(p_value) item
      where item is not null and item <> ''
    ), '{}'::text[]);
$$;

create table public.meeting_minute_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  meeting_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  correction_reason text,
  meeting_type text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  staff_attendees jsonb not null,
  external_attendees jsonb not null,
  agenda_items jsonb not null,
  decisions jsonb not null,
  action_items jsonb not null,
  signed_at timestamptz not null,
  signed_by uuid not null references auth.users(id) on delete restrict,
  signer_display_name text not null,
  signer_role_keys text[] not null,
  signature_purpose text not null,
  signature_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null,
  constraint meeting_minute_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint meeting_minute_versions_id_scope_key unique (
    id, organization_id, branch_id, meeting_key
  ),
  constraint meeting_minute_versions_chain_version_key unique (
    organization_id, branch_id, meeting_key, version
  ),
  constraint meeting_minute_versions_previous_key unique (previous_version_id),
  constraint meeting_minute_versions_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, meeting_key)
    references public.meeting_minute_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint meeting_minute_versions_version_check check (
    version > 0
    and (
      (version = 1 and previous_version_id is null and correction_reason is null)
      or (
        version > 1 and previous_version_id is not null
        and char_length(correction_reason) between 1 and 1000
        and correction_reason !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint meeting_minute_versions_type_check check (
    char_length(meeting_type) between 1 and 120
    and meeting_type !~ '[[:cntrl:]]'
  ),
  constraint meeting_minute_versions_title_check check (
    char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'
  ),
  constraint meeting_minute_versions_time_check check (
    ends_at > starts_at
    and extract(year from starts_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from ends_at at time zone 'Asia/Taipei') between 2000 and 2200
  ),
  constraint meeting_minute_versions_arrays_check check (
    jsonb_typeof(staff_attendees) = 'array'
    and jsonb_array_length(staff_attendees) between 1 and 100
    and jsonb_typeof(external_attendees) = 'array'
    and jsonb_array_length(external_attendees) between 0 and 50
    and jsonb_typeof(agenda_items) = 'array'
    and jsonb_array_length(agenda_items) between 1 and 50
    and jsonb_typeof(decisions) = 'array'
    and jsonb_array_length(decisions) between 0 and 50
    and jsonb_typeof(action_items) = 'array'
    and jsonb_array_length(action_items) between 0 and 50
  ),
  constraint meeting_minute_versions_signature_check check (
    signature_purpose = '會議紀錄簽署'
    and signed_at = created_at
    and char_length(signer_display_name) between 1 and 120
    and signer_display_name !~ '[[:cntrl:]]'
    and cardinality(signer_role_keys) between 1 and 50
    and private.meeting_text_array_normalized(signer_role_keys)
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.meeting_minute_versions is
  'Append-only immutable signed meeting minute versions. A correction must be the single terminal child of the prior version.';

create table public.meeting_action_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  meeting_key uuid not null,
  minute_version_id uuid not null,
  action_id uuid not null,
  sequence integer not null,
  previous_update_id uuid,
  progress_status text not null,
  progress_note text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  constraint meeting_action_updates_id_scope_key unique (
    id, organization_id, branch_id, meeting_key
  ),
  constraint meeting_action_updates_minute_scope_fkey
    foreign key (minute_version_id, organization_id, branch_id, meeting_key)
    references public.meeting_minute_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint meeting_action_updates_previous_key unique (previous_update_id),
  constraint meeting_action_updates_previous_scope_fkey
    foreign key (previous_update_id, organization_id, branch_id, meeting_key)
    references public.meeting_action_updates (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint meeting_action_updates_stream_key unique (
    organization_id, branch_id, meeting_key, action_id, sequence
  ),
  constraint meeting_action_updates_sequence_check check (
    sequence > 0
    and (
      (sequence = 1 and previous_update_id is null)
      or (sequence > 1 and previous_update_id is not null)
    )
  ),
  constraint meeting_action_updates_status_check check (
    progress_status in ('not_started', 'in_progress', 'completed', 'cancelled')
  ),
  constraint meeting_action_updates_note_check check (
    progress_note is null
    or (
      char_length(progress_note) between 1 and 1000
      and translate(progress_note, E'\n\r\t', '') !~ '[[:cntrl:]]'
    )
  )
);

comment on table public.meeting_action_updates is
  'Append-only action progress ledger. It never rewrites signed meeting minutes and carries no external notification claim.';

create table private.meeting_minute_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_version_id uuid not null,
  result_meeting_key uuid not null,
  result_version integer not null,
  result_signed_at timestamptz not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint meeting_minute_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint meeting_minute_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, result_meeting_key
    ) references public.meeting_minute_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint meeting_minute_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.meeting_action_update_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_update_id uuid not null references public.meeting_action_updates(id) on delete restrict,
  result_sequence integer not null,
  result_recorded_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint meeting_action_update_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint meeting_action_update_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create index meeting_minute_versions_scope_time_idx
  on public.meeting_minute_versions (
    organization_id, branch_id, starts_at desc, meeting_key, version desc
  );
create index meeting_minute_versions_signed_by_idx
  on public.meeting_minute_versions (signed_by, signed_at desc);
create index meeting_minute_versions_reauth_idx
  on public.meeting_minute_versions (signature_reauth_challenge_id);
create index meeting_action_updates_stream_idx
  on public.meeting_action_updates (
    organization_id, branch_id, meeting_key, action_id, sequence desc
  );
create index meeting_action_updates_minute_scope_idx
  on public.meeting_action_updates (
    minute_version_id, organization_id, branch_id, meeting_key
  );
create index meeting_action_updates_recorded_by_idx
  on public.meeting_action_updates (recorded_by, recorded_at desc);
create index meeting_minute_operations_result_scope_idx
  on private.meeting_minute_operations (
    organization_id, branch_id, result_meeting_key, result_version_id
  );
create index meeting_minute_operations_reauth_idx
  on private.meeting_minute_operations (reauth_challenge_id);
create index meeting_action_update_operations_scope_result_idx
  on private.meeting_action_update_operations (
    organization_id, branch_id, result_update_id
  );

create or replace function private.meeting_records_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '23514',
    message = format('%I is append-only; create a correction or action update', tg_table_name);
end;
$$;

create trigger meeting_minute_versions_append_only
before update or delete on public.meeting_minute_versions
for each row execute function private.meeting_records_are_append_only();

create trigger meeting_action_updates_append_only
before update or delete on public.meeting_action_updates
for each row execute function private.meeting_records_are_append_only();

create trigger meeting_minute_versions_audit_row_change
after insert on public.meeting_minute_versions
for each row execute function private.audit_row_change();

create trigger meeting_action_updates_audit_row_change
after insert on public.meeting_action_updates
for each row execute function private.audit_row_change();

create trigger meeting_minute_operations_append_only
before update or delete on private.meeting_minute_operations
for each row execute function private.meeting_records_are_append_only();

create trigger meeting_action_update_operations_append_only
before update or delete on private.meeting_action_update_operations
for each row execute function private.meeting_records_are_append_only();

create or replace function private.meeting_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text,
  p_require_aal2 boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and (not p_require_aal2 or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
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
      p_expected_organization_id,
      p_expected_branch_id,
      p_permission
    );
$$;

create or replace function private.meeting_staff_is_current(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_user_id uuid
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
    where profile.id = p_user_id
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
  );
$$;

create or replace function private.require_meeting_reauth_evidence(
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
  if p_actor is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'current meeting AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'current meeting AAL2 evidence is required';
  end;
  if v_session_id is null then
    raise exception using errcode = '42501', message = 'current meeting AAL2 evidence is required';
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
    raise exception using errcode = '42501', message = 'current meeting AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.record_signed_meeting_minutes_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_meeting_key uuid,
  p_previous_version_id uuid,
  p_correction_reason text,
  p_meeting_type text,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_staff_attendee_user_ids uuid[],
  p_external_attendee_names jsonb,
  p_agenda_items jsonb,
  p_decisions jsonb,
  p_action_items jsonb,
  p_idempotency_key uuid
)
returns table(
  minute_version_id uuid,
  meeting_key uuid,
  minute_version integer,
  previous_version_id uuid,
  signed_at timestamptz,
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
  v_request_hash text;
  v_operation private.meeting_minute_operations%rowtype;
  v_previous public.meeting_minute_versions%rowtype;
  v_result public.meeting_minute_versions%rowtype;
  v_meeting_key uuid;
  v_version integer;
  v_challenge_id uuid;
  v_staff jsonb := '[]'::jsonb;
  v_external jsonb := '[]'::jsonb;
  v_agenda jsonb := '[]'::jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_raw jsonb;
  v_prior_snapshot jsonb;
  v_index integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}'::uuid[];
  v_user_id uuid;
  v_name text;
  v_profile_kind text;
  v_member_scope text;
  v_signer_display_name text;
  v_signer_role_keys text[];
  v_due_date date;
  v_new_staff_user_ids uuid[] := '{}'::uuid[];
  v_new_action_user_ids uuid[] := '{}'::uuid[];
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_content_hash text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null
     or not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.sign', true
     )
     or not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
     ) then
    raise exception using errcode = '42501', message = 'meeting minute signing is not permitted';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or extract(year from p_starts_at at time zone 'Asia/Taipei') not between 2000 and 2200
     or extract(year from p_ends_at at time zone 'Asia/Taipei') not between 2000 and 2200
     or p_meeting_type is null or char_length(btrim(p_meeting_type)) not between 1 and 120
     or btrim(p_meeting_type) ~ '[[:cntrl:]]'
     or p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or btrim(p_title) ~ '[[:cntrl:]]'
     or p_staff_attendee_user_ids is null
     or cardinality(p_staff_attendee_user_ids) not between 1 and 100
     or p_staff_attendee_user_ids is distinct from (
       select array_agg(distinct item order by item)
       from unnest(p_staff_attendee_user_ids) item
     )
     or p_external_attendee_names is null
     or jsonb_typeof(p_external_attendee_names) <> 'array'
     or jsonb_array_length(p_external_attendee_names) > 50
     or p_agenda_items is null
     or jsonb_typeof(p_agenda_items) <> 'array'
     or jsonb_array_length(p_agenda_items) not between 1 and 50
     or p_decisions is null
     or jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) > 50
     or p_action_items is null
     or jsonb_typeof(p_action_items) <> 'array'
     or jsonb_array_length(p_action_items) > 50
     or (v_correction_reason is not null and (
       char_length(v_correction_reason) > 1000
       or v_correction_reason ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023', message = 'meeting minute input is invalid';
  end if;

  -- Validate bounded institution-entered external names and explicitly label
  -- them as external in the immutable signed content.
  for v_raw in select value from jsonb_array_elements(p_external_attendee_names)
  loop
    if jsonb_typeof(v_raw) <> 'string'
       or char_length(btrim(v_raw #>> '{}')) not between 1 and 120
       or btrim(v_raw #>> '{}') ~ '[[:cntrl:]]'
       or exists (
         select 1 from jsonb_array_elements(v_external) item
         where lower(item ->> 'name') = lower(btrim(v_raw #>> '{}'))
       ) then
      raise exception using errcode = '22023', message = 'external attendee names are invalid or duplicated';
    end if;
    v_external := v_external || jsonb_build_array(jsonb_build_object(
      'attendee_kind', 'external', 'name', btrim(v_raw #>> '{}')
    ));
  end loop;

  v_index := 0; v_ids := '{}'::uuid[];
  for v_raw in select value from jsonb_array_elements(p_agenda_items)
  loop
    v_index := v_index + 1;
    begin v_id := (v_raw ->> 'item_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'agenda item id is invalid';
    end;
    if jsonb_typeof(v_raw) <> 'object'
       or (v_raw ->> 'item_order')::integer <> v_index
       or char_length(btrim(v_raw ->> 'topic')) not between 1 and 1000
       or translate(btrim(v_raw ->> 'topic'), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_id = any(v_ids) then
      raise exception using errcode = '22023', message = 'agenda items are invalid or duplicated';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_agenda := v_agenda || jsonb_build_array(jsonb_build_object(
      'item_id', v_id, 'item_order', v_index, 'topic', btrim(v_raw ->> 'topic')
    ));
  end loop;

  v_index := 0; v_ids := '{}'::uuid[];
  for v_raw in select value from jsonb_array_elements(p_decisions)
  loop
    v_index := v_index + 1;
    begin v_id := (v_raw ->> 'decision_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'decision id is invalid';
    end;
    if jsonb_typeof(v_raw) <> 'object'
       or (v_raw ->> 'item_order')::integer <> v_index
       or char_length(btrim(v_raw ->> 'decision')) not between 1 and 2000
       or translate(btrim(v_raw ->> 'decision'), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_id = any(v_ids) then
      raise exception using errcode = '22023', message = 'decisions are invalid or duplicated';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_decisions := v_decisions || jsonb_build_array(jsonb_build_object(
      'decision_id', v_id, 'item_order', v_index,
      'decision', btrim(v_raw ->> 'decision')
    ));
  end loop;

  v_index := 0; v_ids := '{}'::uuid[];
  for v_raw in select value from jsonb_array_elements(p_action_items)
  loop
    v_index := v_index + 1;
    begin
      v_id := (v_raw ->> 'action_id')::uuid;
      v_user_id := (v_raw ->> 'responsible_user_id')::uuid;
      v_due_date := (v_raw ->> 'due_date')::date;
    exception when others then
      raise exception using errcode = '22023', message = 'action identifiers or due date are invalid';
    end;
    if jsonb_typeof(v_raw) <> 'object'
       or (v_raw ->> 'item_order')::integer <> v_index
       or char_length(btrim(v_raw ->> 'action')) not between 1 and 2000
       or translate(btrim(v_raw ->> 'action'), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or extract(year from v_due_date) not between 2000 and 2200
       or v_id = any(v_ids) then
      raise exception using errcode = '22023', message = 'action items are invalid or duplicated';
    end if;
    v_ids := array_append(v_ids, v_id);
  end loop;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'meeting_key', p_meeting_key,
    'previous_version_id', p_previous_version_id,
    'correction_reason', v_correction_reason,
    'meeting_type', btrim(p_meeting_type),
    'title', btrim(p_title),
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'staff_attendee_user_ids', p_staff_attendee_user_ids,
    'external_attendee_names', p_external_attendee_names,
    'agenda_items', p_agenda_items,
    'decisions', p_decisions,
    'action_items', p_action_items
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'meeting-minute-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.meeting_minute_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'meeting minute idempotency conflict';
    end if;
    if not private.meeting_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'meetings.sign', true
       )
       or not private.meeting_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
       ) then
      raise exception using errcode = '42501', message = 'meeting minute replay is not permitted';
    end if;
    perform private.require_meeting_reauth_evidence(v_actor, clock_timestamp());
    select minute.* into strict v_result
    from public.meeting_minute_versions minute
    where minute.id = v_operation.result_version_id
      and minute.organization_id = p_expected_organization_id
      and minute.branch_id = p_expected_branch_id;
    return query select v_result.id, v_result.meeting_key, v_result.version,
      v_result.previous_version_id, v_result.signed_at, true;
    return;
  end if;

  -- A new signature can only attest minutes for a meeting that has ended.
  -- Exact replay intentionally returns above before this mutable clock check.
  v_now := clock_timestamp();
  if p_ends_at > v_now then
    raise exception using errcode = '22023', message = 'meeting minutes cannot be signed before the meeting ends';
  end if;

  -- Resolve and linearly lock the terminal version before consulting mutable
  -- staff eligibility.  A correction may faithfully preserve the signed
  -- identity snapshots of people who have since left, but it cannot add them
  -- again as a new attendee or responsible person.
  if p_meeting_key is null then
    if p_previous_version_id is not null or v_correction_reason is not null then
      raise exception using errcode = '23514', message = 'new meeting cannot claim correction fields';
    end if;
    v_meeting_key := gen_random_uuid();
    v_version := 1;
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'meeting-minute-chain:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_meeting_key::text, 0
    ));
    select minute.* into v_previous
    from public.meeting_minute_versions minute
    where minute.organization_id = p_expected_organization_id
      and minute.branch_id = p_expected_branch_id
      and minute.meeting_key = p_meeting_key
    order by minute.version desc
    limit 1
    for update;
    if v_previous.id is null
       or p_previous_version_id is null
       or p_previous_version_id <> v_previous.id
       or v_correction_reason is null then
      raise exception using errcode = '23514', message = 'meeting correction must extend the terminal version';
    end if;
    v_meeting_key := p_meeting_key;
    v_version := v_previous.version + 1;
  end if;

  -- Mutable staff eligibility is intentionally checked only for a new write;
  -- exact replay above remains available after later staff changes. Historical
  -- signed attendee snapshots are reused rather than re-derived.
  foreach v_user_id in array p_staff_attendee_user_ids
  loop
    v_prior_snapshot := null;
    if v_previous.id is not null then
      select attendee into v_prior_snapshot
      from jsonb_array_elements(v_previous.staff_attendees) attendee
      where (attendee ->> 'user_id')::uuid = v_user_id;
    end if;
    if v_prior_snapshot is not null then
      v_staff := v_staff || jsonb_build_array(v_prior_snapshot);
      continue;
    end if;
    select profile.display_name, profile.kind,
      case when membership.branch_id is null then 'organization' else 'branch' end
      into v_name, v_profile_kind, v_member_scope
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    where profile.id = v_user_id
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    order by membership.branch_id nulls last
    limit 1;
    if v_name is null then
      raise exception using errcode = '42501', message = 'meeting staff attendee is outside active branch scope';
    end if;
    v_staff := v_staff || jsonb_build_array(jsonb_build_object(
      'attendee_kind', 'staff', 'user_id', v_user_id,
      'display_name', btrim(v_name), 'profile_kind', v_profile_kind,
      'membership_scope', v_member_scope
    ));
    v_new_staff_user_ids := array_append(v_new_staff_user_ids, v_user_id);
    v_name := null;
  end loop;

  v_index := 0;
  for v_raw in select value from jsonb_array_elements(p_action_items)
  loop
    v_index := v_index + 1;
    v_id := (v_raw ->> 'action_id')::uuid;
    v_user_id := (v_raw ->> 'responsible_user_id')::uuid;
    v_due_date := (v_raw ->> 'due_date')::date;
    v_prior_snapshot := null;
    if v_previous.id is not null then
      select old_action into v_prior_snapshot
      from jsonb_array_elements(v_previous.action_items) old_action
      where (old_action ->> 'action_id')::uuid = v_id;
    end if;
    if v_prior_snapshot is not null then
      if v_prior_snapshot ->> 'action' <> btrim(v_raw ->> 'action')
         or (v_prior_snapshot ->> 'responsible_user_id')::uuid <> v_user_id
         or (v_prior_snapshot ->> 'due_date')::date <> v_due_date then
        raise exception using
          errcode = '23514',
          message = 'existing meeting actions must be retained with identical identity';
      end if;
      v_actions := v_actions || jsonb_build_array(
        v_prior_snapshot || jsonb_build_object('item_order', v_index)
      );
      continue;
    end if;
    select profile.display_name into v_name
    from public.profiles profile
    where profile.id = v_user_id
      and private.meeting_staff_is_current(
        p_expected_organization_id, p_expected_branch_id, profile.id
      );
    if v_name is null then
      raise exception using errcode = '42501', message = 'meeting action responsible is outside active branch scope';
    end if;
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'action_id', v_id, 'item_order', v_index,
      'action', btrim(v_raw ->> 'action'),
      'responsible_user_id', v_user_id,
      'responsible_display_name', btrim(v_name),
      'due_date', v_due_date
    ));
    v_new_action_user_ids := array_append(v_new_action_user_ids, v_user_id);
    v_name := null;
  end loop;

  if v_previous.id is not null then
    if exists (
      select 1
      from jsonb_array_elements(v_previous.action_items) old_action
      where not exists (
        select 1
        from jsonb_array_elements(v_actions) new_action
        where new_action ->> 'action_id' = old_action ->> 'action_id'
          and new_action ->> 'action' = old_action ->> 'action'
          and new_action ->> 'responsible_user_id' = old_action ->> 'responsible_user_id'
          and new_action ->> 'due_date' = old_action ->> 'due_date'
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'existing meeting actions must be retained with identical identity';
    end if;
  end if;

  if not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.sign', true
     )
     or not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
     ) then
    raise exception using errcode = '42501', message = 'meeting minute authority expired';
  end if;
  v_now := clock_timestamp();
  v_challenge_id := private.require_meeting_reauth_evidence(v_actor, v_now);
  select profile.display_name,
    array_agg(distinct role.role_key order by role.role_key)
    into v_signer_display_name, v_signer_role_keys
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
    and permission.permission_key = 'meetings.sign'
  group by profile.display_name;
  if v_signer_display_name is null
     or cardinality(v_signer_role_keys) < 1 then
    raise exception using errcode = '42501', message = 'meeting signer role snapshot is unavailable';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'meeting_key', v_meeting_key,
    'version', v_version,
    'previous_version_id', v_previous.id,
    'correction_reason', v_correction_reason,
    'meeting_type', btrim(p_meeting_type),
    'title', btrim(p_title),
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'staff_attendees', v_staff,
    'external_attendees', v_external,
    'agenda_items', v_agenda,
    'decisions', v_decisions,
    'action_items', v_actions,
    'signed_at', v_now,
    'signed_by', v_actor,
    'signer_display_name', btrim(v_signer_display_name),
    'signer_role_keys', v_signer_role_keys,
    'signature_purpose', '會議紀錄簽署',
    'signature_reauth_challenge_id', v_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into public.meeting_minute_versions (
    organization_id, branch_id, meeting_key, version, previous_version_id,
    correction_reason, meeting_type, title, starts_at, ends_at,
    staff_attendees, external_attendees, agenda_items, decisions, action_items,
    signed_at, signed_by, signer_display_name, signer_role_keys,
    signature_purpose, signature_reauth_challenge_id, content_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_meeting_key, v_version,
    v_previous.id, v_correction_reason, btrim(p_meeting_type), btrim(p_title),
    p_starts_at, p_ends_at, v_staff, v_external, v_agenda, v_decisions, v_actions,
    v_now, v_actor, btrim(v_signer_display_name), v_signer_role_keys,
    '會議紀錄簽署', v_challenge_id, v_content_hash, v_now
  ) returning * into v_result;

  insert into private.meeting_minute_operations (
    organization_id, branch_id, actor_user_id, idempotency_key, request_hash,
    result_version_id, result_meeting_key, result_version, result_signed_at,
    reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_result.meeting_key,
    v_result.version, v_result.signed_at, v_challenge_id
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when v_version = 1 then 'sign' else 'correct' end,
    'meeting_minute_versions', v_result.id::text, p_idempotency_key,
    array['signed_version'], jsonb_build_object(
      'workflow', 'page75_meeting_minutes_v1',
      'meeting_key', v_meeting_key,
      'version', v_version,
      'action_count', jsonb_array_length(v_actions),
      'external_attendee_count', jsonb_array_length(v_external)
    )
  );

  if not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.sign', true
     )
     or not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
     )
     or private.require_meeting_reauth_evidence(v_actor, clock_timestamp()) <> v_challenge_id
     or not exists (
       select 1 from public.meeting_minute_versions minute
       where minute.id = v_result.id
         and minute.organization_id = p_expected_organization_id
         and minute.branch_id = p_expected_branch_id
         and minute.meeting_key = v_result.meeting_key
         and minute.content_hash = v_content_hash
         and minute.signature_reauth_challenge_id = v_challenge_id
     )
     or exists (
       select 1 from unnest(v_new_staff_user_ids) attendee_user_id
       where not private.meeting_staff_is_current(
         p_expected_organization_id, p_expected_branch_id,
         attendee_user_id
       )
     )
     or exists (
       select 1 from unnest(v_new_action_user_ids) responsible_user_id
       where not private.meeting_staff_is_current(
         p_expected_organization_id, p_expected_branch_id,
         responsible_user_id
       )
     ) then
    raise exception using errcode = '42501', message = 'meeting minute final verification failed';
  end if;

  return query select v_result.id, v_result.meeting_key, v_result.version,
    v_result.previous_version_id, v_result.signed_at, false;
end;
$$;

create or replace function public.record_signed_meeting_minutes(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_meeting_key uuid,
  p_previous_version_id uuid,
  p_correction_reason text,
  p_meeting_type text,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_staff_attendee_user_ids uuid[],
  p_external_attendee_names jsonb,
  p_agenda_items jsonb,
  p_decisions jsonb,
  p_action_items jsonb,
  p_idempotency_key uuid
)
returns table(
  minute_version_id uuid,
  meeting_key uuid,
  minute_version integer,
  previous_version_id uuid,
  signed_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.record_signed_meeting_minutes_guarded(
    p_expected_organization_id, p_expected_branch_id, p_meeting_key,
    p_previous_version_id, p_correction_reason, p_meeting_type, p_title,
    p_starts_at, p_ends_at, p_staff_attendee_user_ids,
    p_external_attendee_names, p_agenda_items, p_decisions, p_action_items,
    p_idempotency_key
  );
$$;

create or replace function private.append_meeting_action_update_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_meeting_key uuid,
  p_minute_version_id uuid,
  p_action_id uuid,
  p_expected_previous_update_id uuid,
  p_progress_status text,
  p_progress_note text,
  p_idempotency_key uuid
)
returns table(
  action_update_id uuid,
  meeting_key uuid,
  minute_version_id uuid,
  action_id uuid,
  previous_update_id uuid,
  update_sequence integer,
  progress_status text,
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
  v_note text := nullif(btrim(p_progress_note), '');
  v_request_hash text;
  v_operation private.meeting_action_update_operations%rowtype;
  v_minute public.meeting_minute_versions%rowtype;
  v_previous public.meeting_action_updates%rowtype;
  v_result public.meeting_action_updates%rowtype;
  v_now timestamptz;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_meeting_key is null or p_minute_version_id is null
     or p_action_id is null or p_idempotency_key is null
     or p_progress_status not in ('not_started', 'in_progress', 'completed', 'cancelled')
     or (v_note is not null and (
       char_length(v_note) > 1000
       or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
     ))
     or not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
     ) then
    raise exception using errcode = '42501', message = 'meeting action update is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'meeting_key', p_meeting_key,
    'minute_version_id', p_minute_version_id, 'action_id', p_action_id,
    'expected_previous_update_id', p_expected_previous_update_id,
    'progress_status', p_progress_status, 'progress_note', v_note
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'meeting-action-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.meeting_action_update_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'meeting action update idempotency conflict';
    end if;
    if not private.meeting_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
    ) then
      raise exception using errcode = '42501', message = 'meeting action update replay is not permitted';
    end if;
    select update_row.* into strict v_result
    from public.meeting_action_updates update_row
    where update_row.id = v_operation.result_update_id
      and update_row.organization_id = p_expected_organization_id
      and update_row.branch_id = p_expected_branch_id
      and update_row.meeting_key = p_meeting_key
      and update_row.action_id = p_action_id;
    return query select v_result.id, v_result.meeting_key,
      v_result.minute_version_id, v_result.action_id, v_result.previous_update_id,
      v_result.sequence, v_result.progress_status, v_result.recorded_at, true;
    return;
  end if;

  -- Serialize against a minute correction before locking this action stream.
  perform pg_advisory_xact_lock(hashtextextended(
    'meeting-minute-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_meeting_key::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'meeting-action-stream:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_meeting_key::text || ':' ||
    p_action_id::text, 0
  ));

  select minute.* into v_minute
  from public.meeting_minute_versions minute
  where minute.organization_id = p_expected_organization_id
    and minute.branch_id = p_expected_branch_id
    and minute.meeting_key = p_meeting_key
  order by minute.version desc
  limit 1
  for share;
  if v_minute.id is null
     or v_minute.id <> p_minute_version_id
     or not exists (
       select 1 from jsonb_array_elements(v_minute.action_items) item
       where (item ->> 'action_id')::uuid = p_action_id
     ) then
    raise exception using errcode = '40001', message = 'meeting action version is stale';
  end if;

  select update_row.* into v_previous
  from public.meeting_action_updates update_row
  where update_row.organization_id = p_expected_organization_id
    and update_row.branch_id = p_expected_branch_id
    and update_row.meeting_key = p_meeting_key
    and update_row.action_id = p_action_id
  order by update_row.sequence desc
  limit 1
  for update;

  if (v_previous.id is null and p_expected_previous_update_id is not null)
     or (v_previous.id is not null and p_expected_previous_update_id is distinct from v_previous.id) then
    raise exception using errcode = '40001', message = 'meeting action update version conflict';
  end if;
  if not private.meeting_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
  ) then
    raise exception using errcode = '42501', message = 'meeting action update authority expired';
  end if;

  v_now := clock_timestamp();
  insert into public.meeting_action_updates (
    organization_id, branch_id, meeting_key, minute_version_id, action_id,
    sequence, previous_update_id, progress_status, progress_note,
    recorded_by, recorded_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_meeting_key,
    p_minute_version_id, p_action_id, coalesce(v_previous.sequence, 0) + 1,
    v_previous.id, p_progress_status, v_note, v_actor, v_now
  ) returning * into v_result;

  insert into private.meeting_action_update_operations (
    organization_id, branch_id, actor_user_id, idempotency_key, request_hash,
    result_update_id, result_sequence, result_recorded_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_request_hash, v_result.id, v_result.sequence,
    v_result.recorded_at
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'insert',
    'meeting_action_updates', v_result.id::text, p_idempotency_key,
    array['progress_status', 'progress_note'], jsonb_build_object(
      'workflow', 'page75_meeting_action_update_v1',
      'meeting_key', p_meeting_key, 'action_id', p_action_id,
      'sequence', v_result.sequence, 'external_notification_sent', false
    )
  );

  if not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.manage', true
     )
     or not exists (
       select 1 from public.meeting_action_updates update_row
       where update_row.id = v_result.id
         and update_row.organization_id = p_expected_organization_id
         and update_row.branch_id = p_expected_branch_id
         and update_row.meeting_key = p_meeting_key
         and update_row.minute_version_id = p_minute_version_id
         and update_row.action_id = p_action_id
         and update_row.sequence = v_result.sequence
     )
     or not exists (
       select 1 from public.meeting_minute_versions minute
       where minute.id = p_minute_version_id
         and minute.organization_id = p_expected_organization_id
         and minute.branch_id = p_expected_branch_id
         and minute.meeting_key = p_meeting_key
         and not exists (
           select 1 from public.meeting_minute_versions child
           where child.previous_version_id = minute.id
         )
         and exists (
           select 1 from jsonb_array_elements(minute.action_items) item
           where (item ->> 'action_id')::uuid = p_action_id
         )
     ) then
    raise exception using errcode = '42501', message = 'meeting action final verification failed';
  end if;

  return query select v_result.id, v_result.meeting_key,
    v_result.minute_version_id, v_result.action_id, v_result.previous_update_id,
    v_result.sequence, v_result.progress_status, v_result.recorded_at, false;
end;
$$;

create or replace function public.append_meeting_action_update(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_meeting_key uuid,
  p_minute_version_id uuid,
  p_action_id uuid,
  p_expected_previous_update_id uuid,
  p_progress_status text,
  p_progress_note text,
  p_idempotency_key uuid
)
returns table(
  action_update_id uuid,
  meeting_key uuid,
  minute_version_id uuid,
  action_id uuid,
  previous_update_id uuid,
  update_sequence integer,
  progress_status text,
  recorded_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.append_meeting_action_update_guarded(
    p_expected_organization_id, p_expected_branch_id, p_meeting_key,
    p_minute_version_id, p_action_id, p_expected_previous_update_id,
    p_progress_status, p_progress_note, p_idempotency_key
  );
$$;

create or replace function private.meeting_management_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reference_time timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with staff_candidates as materialized (
    select distinct on (profile.id)
      profile.id as user_id,
      profile.display_name,
      profile.employee_code,
      profile.kind as profile_kind,
      case when membership.branch_id is null then 'organization' else 'branch' end
        as membership_scope
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    where profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= p_reference_time
      and (membership.ends_at is null or membership.ends_at > p_reference_time)
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    order by profile.id, membership.branch_id nulls last
  ), staff_result as (
    select
      (select count(*) from staff_candidates)::bigint as staff_total,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', limited.user_id,
          'display_name', limited.display_name,
          'employee_code', limited.employee_code,
          'profile_kind', limited.profile_kind,
          'membership_scope', limited.membership_scope
        ) order by limited.display_name collate "C", limited.user_id)
        from (
          select candidate.*
          from staff_candidates candidate
          order by candidate.display_name collate "C", candidate.user_id
          limit 500
        ) limited
      ), '[]'::jsonb) as staff_options
  ), terminal_meetings as materialized (
    select minute.*
    from public.meeting_minute_versions minute
    where minute.organization_id = p_expected_organization_id
      and minute.branch_id = p_expected_branch_id
      and not exists (
        select 1 from public.meeting_minute_versions child
        where child.previous_version_id = minute.id
      )
  ), action_rows as materialized (
    select
      minute.id as minute_version_id,
      minute.meeting_key,
      action_item.value as signed_action,
      coalesce(latest.progress_status, 'not_started') as progress_status,
      latest.id as latest_update_id,
      coalesce(latest.sequence, 0) as update_sequence,
      latest.progress_note,
      latest.recorded_at as progress_recorded_at,
      (action_item.value ->> 'due_date')::date
        < (p_reference_time at time zone 'Asia/Taipei')::date
        and coalesce(latest.progress_status, 'not_started')
          not in ('completed', 'cancelled') as is_overdue
    from terminal_meetings minute
    cross join lateral jsonb_array_elements(minute.action_items) action_item
    left join lateral (
      select update_row.*
      from public.meeting_action_updates update_row
      where update_row.organization_id = p_expected_organization_id
        and update_row.branch_id = p_expected_branch_id
        and update_row.meeting_key = minute.meeting_key
        and update_row.action_id = (action_item.value ->> 'action_id')::uuid
      order by update_row.sequence desc
      limit 1
    ) latest on true
  ), full_stats as (
    select
      (select count(*) from terminal_meetings)::bigint as meeting_available_total,
      (select count(*) filter (where version > 1) from terminal_meetings)::integer
        as correction_total,
      (select count(*) from action_rows)::integer as action_total,
      (select count(*) filter (
        where progress_status not in ('completed', 'cancelled')
      ) from action_rows)::integer as open_action_total,
      (select count(*) filter (where is_overdue) from action_rows)::integer
        as overdue_action_total
  ), limited_meetings as materialized (
    select minute.*
    from terminal_meetings minute
    order by minute.starts_at desc, minute.meeting_key, minute.version desc
    limit 100
  ), meeting_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'minute_version_id', minute.id,
      'meeting_key', minute.meeting_key,
      'minute_version', minute.version,
      'previous_version_id', minute.previous_version_id,
      'correction_reason', minute.correction_reason,
      'meeting_type', minute.meeting_type,
      'title', minute.title,
      'starts_at', minute.starts_at,
      'ends_at', minute.ends_at,
      'staff_attendees', minute.staff_attendees,
      'external_attendees', minute.external_attendees,
      'agenda_items', minute.agenda_items,
      'decisions', minute.decisions,
      'action_items', coalesce((
        select jsonb_agg(
          action_row.signed_action || jsonb_build_object(
            'progress_status', action_row.progress_status,
            'latest_update_id', action_row.latest_update_id,
            'update_sequence', action_row.update_sequence,
            'progress_note', action_row.progress_note,
            'progress_recorded_at', action_row.progress_recorded_at,
            'is_overdue', action_row.is_overdue,
            'local_work_item', action_row.is_overdue,
            'external_notification_sent', false
          ) order by (action_row.signed_action ->> 'item_order')::integer
        )
        from action_rows action_row
        where action_row.minute_version_id = minute.id
      ), '[]'::jsonb),
      'signed_at', minute.signed_at,
      'signer_display_name', minute.signer_display_name,
      'signer_role_keys', to_jsonb(minute.signer_role_keys),
      'signature_purpose', minute.signature_purpose
    ) order by minute.starts_at desc, minute.meeting_key, minute.version desc), '[]'::jsonb)
      as meetings
    from limited_meetings minute
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'snapshot_date', (p_reference_time at time zone 'Asia/Taipei')::date,
    'staff_options', staff_result.staff_options,
    'staff_total', staff_result.staff_total,
    'staff_truncated', staff_result.staff_total > jsonb_array_length(staff_result.staff_options),
    'meetings', meeting_result.meetings,
    'meeting_total', jsonb_array_length(meeting_result.meetings),
    'meeting_available_total', full_stats.meeting_available_total,
    'meetings_truncated', full_stats.meeting_available_total > jsonb_array_length(meeting_result.meetings),
    'correction_total', full_stats.correction_total,
    'action_total', full_stats.action_total,
    'open_action_total', full_stats.open_action_total,
    'overdue_action_total', full_stats.overdue_action_total,
    'meeting_type_policy', 'institution_owned_unconfigured',
    'retention_policy', 'institution_owned_unconfigured',
    'escalation_policy', 'institution_owned_unconfigured',
    'notification_delivery', 'none_not_sent'
  )
  from staff_result
  cross join full_stats
  cross join meeting_result;
$$;

create or replace function private.meeting_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  snapshot_date date,
  staff_options jsonb,
  staff_total bigint,
  staff_truncated boolean,
  meetings jsonb,
  meeting_total integer,
  meeting_available_total bigint,
  meetings_truncated boolean,
  correction_total integer,
  action_total integer,
  open_action_total integer,
  overdue_action_total integer,
  meeting_type_policy text,
  retention_policy text,
  escalation_policy text,
  notification_delivery text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_bundle jsonb;
  v_bundle_after_audit jsonb;
  v_snapshot_fingerprint text;
begin
  if not private.meeting_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'meetings.read', true
  ) then
    raise exception using errcode = '42501', message = 'meeting snapshot is not permitted';
  end if;

  -- The whole projection, bounded detail, and unbounded aggregates are read in
  -- one canonical SQL snapshot at a frozen reference time.
  v_bundle := private.meeting_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now
  );
  if v_bundle is null then
    raise exception using errcode = '42501', message = 'meeting snapshot could not be verified';
  end if;
  v_snapshot_fingerprint := encode(sha256(convert_to(v_bundle::text, 'UTF8')), 'hex');

  if not private.meeting_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'meetings.read', true
  ) then
    raise exception using errcode = '42501', message = 'meeting snapshot authority expired';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'meeting_management_snapshot', null, '{}'::text[], jsonb_build_object(
      'projection', 'page75_meeting_management_v1',
      'snapshot_date', v_bundle ->> 'snapshot_date',
      'meeting_count', (v_bundle ->> 'meeting_total')::integer,
      'meeting_available_total', (v_bundle ->> 'meeting_available_total')::bigint,
      'meetings_truncated', (v_bundle ->> 'meetings_truncated')::boolean,
      'meeting_limit', 100,
      'staff_count', jsonb_array_length(v_bundle -> 'staff_options'),
      'staff_total', (v_bundle ->> 'staff_total')::bigint,
      'staff_limit', 500,
      'action_count', (v_bundle ->> 'action_total')::integer,
      'overdue_action_count', (v_bundle ->> 'overdue_action_total')::integer,
      'snapshot_fingerprint', v_snapshot_fingerprint,
      'external_notification_sent', false
    )
  );

  -- A second database read after audit work must reproduce the exact canonical
  -- bundle at the same reference time. This detects a concurrent correction,
  -- action update, staff-scope change, or aggregate/detail drift.
  v_bundle_after_audit := private.meeting_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now
  );
  if not private.meeting_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'meetings.read', true
     )
     or v_bundle_after_audit is distinct from v_bundle then
    raise exception using errcode = '42501', message = 'meeting snapshot final verification failed';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle -> 'staff_options',
    (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'meetings',
    (v_bundle ->> 'meeting_total')::integer,
    (v_bundle ->> 'meeting_available_total')::bigint,
    (v_bundle ->> 'meetings_truncated')::boolean,
    (v_bundle ->> 'correction_total')::integer,
    (v_bundle ->> 'action_total')::integer,
    (v_bundle ->> 'open_action_total')::integer,
    (v_bundle ->> 'overdue_action_total')::integer,
    v_bundle ->> 'meeting_type_policy',
    v_bundle ->> 'retention_policy',
    v_bundle ->> 'escalation_policy',
    v_bundle ->> 'notification_delivery';
end;
$$;

create or replace function public.meeting_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  snapshot_date date,
  staff_options jsonb,
  staff_total bigint,
  staff_truncated boolean,
  meetings jsonb,
  meeting_total integer,
  meeting_available_total bigint,
  meetings_truncated boolean,
  correction_total integer,
  action_total integer,
  open_action_total integer,
  overdue_action_total integer,
  meeting_type_policy text,
  retention_policy text,
  escalation_policy text,
  notification_delivery text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.meeting_management_snapshot_response(
    p_expected_organization_id, p_expected_branch_id
  );
$$;

alter table public.meeting_minute_versions enable row level security;
alter table public.meeting_action_updates enable row level security;

create policy meeting_minute_versions_select on public.meeting_minute_versions
for select to authenticated
using (private.meeting_current_authority(
  organization_id, branch_id, 'meetings.read', true
));

create policy meeting_action_updates_select on public.meeting_action_updates
for select to authenticated
using (private.meeting_current_authority(
  organization_id, branch_id, 'meetings.read', true
));

revoke all on table public.meeting_minute_versions from public, anon, authenticated;
revoke all on table public.meeting_action_updates from public, anon, authenticated;
grant all on table public.meeting_minute_versions to service_role;
grant all on table public.meeting_action_updates to service_role;

revoke all on function private.meeting_records_are_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.meeting_text_array_normalized(text[])
  from public, anon, authenticated, service_role;
revoke all on function private.meeting_current_authority(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.meeting_staff_is_current(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_meeting_reauth_evidence(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.record_signed_meeting_minutes_guarded(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  uuid[], jsonb, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.append_meeting_action_update_guarded(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.meeting_management_snapshot_bundle(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.meeting_management_snapshot_response(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_signed_meeting_minutes(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  uuid[], jsonb, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.append_meeting_action_update(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.meeting_management_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.record_signed_meeting_minutes(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  uuid[], jsonb, jsonb, jsonb, jsonb, uuid
) to authenticated;
grant execute on function public.append_meeting_action_update(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid
) to authenticated;
grant execute on function public.meeting_management_snapshot(uuid, uuid)
  to authenticated;
grant execute on function private.record_signed_meeting_minutes_guarded(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  uuid[], jsonb, jsonb, jsonb, jsonb, uuid
) to authenticated;
grant execute on function private.append_meeting_action_update_guarded(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid
) to authenticated;
grant execute on function private.meeting_management_snapshot_response(uuid, uuid)
  to authenticated;

comment on function public.record_signed_meeting_minutes(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  uuid[], jsonb, jsonb, jsonb, jsonb, uuid
) is 'Atomically signs a new meeting minute or one terminal correction using actor-scoped exact replay and current immutable AAL2 evidence.';
comment on function public.append_meeting_action_update(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid
) is 'Appends one optimistic-concurrency-controlled action update without rewriting signed minutes or sending an external message.';
comment on function public.meeting_management_snapshot(uuid, uuid) is
  'Returns one bounded audited page-75 meeting snapshot with Asia/Taipei overdue derivation and aggregate/detail parity for loaded rows.';
