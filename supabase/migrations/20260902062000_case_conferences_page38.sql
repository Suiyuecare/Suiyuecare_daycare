-- Page 38: immutable, client-scoped case conference versions.
-- This domain is intentionally separate from Page 75 general meetings.

insert into public.permissions (permission_key, description, risk_level) values
  ('case_conferences.read', 'Read assigned-client case conference snapshots', 1),
  ('case_conferences.manage', 'Create and revise case conference drafts', 2),
  ('case_conferences.sign', 'Sign and correct case conference versions', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'professional'
  )
  and permission.permission_key in (
    'case_conferences.read', 'case_conferences.manage'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'professional'
  )
  and permission.permission_key = 'case_conferences.sign'
on conflict (role_id, permission_id) do nothing;

create table public.case_conference_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  meeting_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  corrects_version_id uuid,
  version_kind text not null,
  status text not null,
  client_id uuid not null,
  client_display_name text not null,
  client_code text not null,
  meeting_starts_at timestamptz not null,
  meeting_ends_at timestamptz not null,
  problem_statement text not null,
  decision_summary text not null,
  attendees jsonb not null,
  action_items jsonb not null,
  correction_reason text,
  occurred_at timestamptz not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_membership_id uuid not null references public.memberships(id) on delete restrict,
  author_display_name text not null,
  signed_at timestamptz,
  signer_user_id uuid references auth.users(id) on delete restrict,
  signer_membership_id uuid references public.memberships(id) on delete restrict,
  signer_display_name text,
  signer_role_keys text[] not null default '{}'::text[],
  signature_purpose text,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint case_conference_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint case_conference_versions_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint case_conference_versions_id_scope_key
    unique (id, organization_id, branch_id, meeting_key),
  constraint case_conference_versions_stream_key
    unique (organization_id, branch_id, meeting_key, version),
  constraint case_conference_versions_previous_key unique (previous_version_id),
  constraint case_conference_versions_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, meeting_key)
    references public.case_conference_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint case_conference_versions_corrects_scope_fkey
    foreign key (corrects_version_id, organization_id, branch_id, meeting_key)
    references public.case_conference_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint case_conference_versions_lineage_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null and version_kind = 'created')
      or (version > 1 and previous_version_id is not null
        and version_kind in ('revised', 'signed', 'corrected'))
    )
  ),
  constraint case_conference_versions_correction_check check (
    (version_kind = 'corrected') = (corrects_version_id is not null)
    and (version_kind = 'corrected') = (correction_reason is not null)
  ),
  constraint case_conference_versions_status_check check (
    status in ('draft', 'signed')
    and (status = 'draft') = (version_kind in ('created', 'revised'))
    and (status = 'signed') = (version_kind in ('signed', 'corrected'))
  ),
  constraint case_conference_versions_signature_check check (
    (status = 'signed') = (signed_at is not null)
    and (status = 'signed') = (signer_user_id is not null)
    and (status = 'signed') = (signer_membership_id is not null)
    and (status = 'signed') = (signer_display_name is not null)
    and (status = 'signed') = (cardinality(signer_role_keys) > 0)
    and (status = 'signed') = (signature_purpose is not null)
    and (status = 'signed') = (reauth_challenge_id is not null)
    and (signature_purpose is null or signature_purpose = '個案研討會議紀錄簽署')
  ),
  constraint case_conference_versions_json_check check (
    jsonb_typeof(attendees) = 'array'
    and jsonb_array_length(attendees) between 1 and 50
    and jsonb_typeof(action_items) = 'array'
    and jsonb_array_length(action_items) between 1 and 50
  ),
  constraint case_conference_versions_text_check check (
    char_length(client_display_name) between 1 and 120
    and client_display_name !~ '[[:cntrl:]]'
    and char_length(client_code) between 1 and 80
    and client_code !~ '[[:cntrl:]]'
    and char_length(problem_statement) between 2 and 4000
    and translate(problem_statement, E'\n\r\t', '') !~ '[[:cntrl:]]'
    and char_length(decision_summary) between 2 and 4000
    and translate(decision_summary, E'\n\r\t', '') !~ '[[:cntrl:]]'
    and char_length(author_display_name) between 1 and 120
    and author_display_name !~ '[[:cntrl:]]'
    and (signer_display_name is null or (
      char_length(signer_display_name) between 1 and 120
      and signer_display_name !~ '[[:cntrl:]]'
    ))
    and (correction_reason is null or (
      char_length(correction_reason) between 2 and 1000
      and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
  ),
  constraint case_conference_versions_time_check check (
    meeting_ends_at > meeting_starts_at
    and extract(year from meeting_starts_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from meeting_ends_at at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from occurred_at at time zone 'Asia/Taipei') between 2000 and 2200
    and (signed_at is null or signed_at >= meeting_ends_at)
  ),
  constraint case_conference_versions_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.case_conference_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_meeting_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  previous_version_id uuid,
  corrects_version_id uuid,
  result_status text not null,
  result_content_hash text not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  committed_at timestamptz not null,
  constraint case_conference_operations_actor_key
    unique (actor_user_id, idempotency_key),
  constraint case_conference_operations_result_scope_fkey
    foreign key (result_version_id, organization_id, branch_id, result_meeting_key)
    references public.case_conference_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint case_conference_operations_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, result_meeting_key)
    references public.case_conference_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint case_conference_operations_corrects_scope_fkey
    foreign key (corrects_version_id, organization_id, branch_id, result_meeting_key)
    references public.case_conference_versions (
      id, organization_id, branch_id, meeting_key
    ) on delete restrict,
  constraint case_conference_operations_check check (
    operation_kind in ('create', 'revise', 'sign', 'correct')
    and request_hash ~ '^[a-f0-9]{64}$'
    and result_version > 0
    and result_status in ('draft', 'signed')
    and result_content_hash ~ '^[a-f0-9]{64}$'
    and (operation_kind in ('sign', 'correct')) = (reauth_challenge_id is not null)
    and (operation_kind = 'correct') = (corrects_version_id is not null)
  )
);

create index case_conference_versions_scope_idx
  on public.case_conference_versions (organization_id, branch_id, meeting_key, version desc);
create index case_conference_versions_branch_idx
  on public.case_conference_versions (branch_id, organization_id);
create index case_conference_versions_client_idx
  on public.case_conference_versions (client_id, organization_id, branch_id);
create index case_conference_versions_previous_idx
  on public.case_conference_versions (previous_version_id) where previous_version_id is not null;
create index case_conference_versions_corrects_idx
  on public.case_conference_versions (corrects_version_id) where corrects_version_id is not null;
create index case_conference_versions_author_idx
  on public.case_conference_versions (author_user_id, occurred_at desc);
create index case_conference_versions_author_membership_idx
  on public.case_conference_versions (author_membership_id);
create index case_conference_versions_signer_idx
  on public.case_conference_versions (signer_user_id) where signer_user_id is not null;
create index case_conference_versions_signer_membership_idx
  on public.case_conference_versions (signer_membership_id) where signer_membership_id is not null;
create index case_conference_versions_reauth_idx
  on public.case_conference_versions (reauth_challenge_id) where reauth_challenge_id is not null;
create index case_conference_versions_filter_idx
  on public.case_conference_versions (organization_id, branch_id, status, meeting_starts_at desc);
create index case_conference_operations_actor_idx
  on private.case_conference_operations (actor_user_id);
create index case_conference_operations_scope_idx
  on private.case_conference_operations (
    organization_id, branch_id, result_meeting_key, committed_at desc
  );
create index case_conference_operations_result_idx
  on private.case_conference_operations (result_version_id);
create index case_conference_operations_previous_idx
  on private.case_conference_operations (previous_version_id) where previous_version_id is not null;
create index case_conference_operations_corrects_idx
  on private.case_conference_operations (corrects_version_id) where corrects_version_id is not null;
create index case_conference_operations_reauth_idx
  on private.case_conference_operations (reauth_challenge_id) where reauth_challenge_id is not null;

alter table public.case_conference_versions enable row level security;
alter table public.case_conference_versions force row level security;
alter table private.case_conference_operations enable row level security;
alter table private.case_conference_operations force row level security;
revoke all on table public.case_conference_versions from public, anon, authenticated, service_role;
revoke all on table private.case_conference_operations from public, anon, authenticated, service_role;

create or replace function private.prevent_case_conference_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger case_conference_versions_prevent_mutation
before update or delete on public.case_conference_versions
for each row execute function private.prevent_case_conference_mutation();
create trigger case_conference_operations_prevent_mutation
before update or delete on private.case_conference_operations
for each row execute function private.prevent_case_conference_mutation();
create trigger case_conference_versions_audit_row_change
after insert on public.case_conference_versions
for each row execute function private.audit_row_change();

create or replace function private.case_conference_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, p_permission)
    and (not p_require_recent_aal2 or (
      coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      and private.has_recent_aal2(15)
    ));
$$;

create or replace function private.case_conference_staff_snapshot(
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

create or replace function private.require_case_conference_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current same-session case conference AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session case conference AAL2 evidence is required';
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
      message = 'current same-session case conference AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.case_conference_materialize_attendees(
  p_organization_id uuid,
  p_branch_id uuid,
  p_attendees jsonb,
  p_reference_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb; v_user_id uuid; v_attendance text;
  v_membership_id uuid; v_display_name text; v_roles text[];
  v_seen uuid[] := '{}'::uuid[]; v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_attendees) <> 'array'
     or jsonb_array_length(p_attendees) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'case conference attendee list is invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_attendees) value loop
    if jsonb_typeof(v_item) <> 'object'
       or (select array_agg(key order by key)
           from jsonb_object_keys(v_item) as keys(key))
          <> array['attendance_status', 'user_id']::text[] then
      raise exception using errcode = '22023', message = 'case conference attendee entry is invalid';
    end if;
    begin
      v_user_id := nullif(v_item ->> 'user_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'case conference attendee user is invalid';
    end;
    v_attendance := v_item ->> 'attendance_status';
    if v_user_id is null or v_user_id = any(v_seen)
       or v_attendance not in ('attended', 'remote', 'absent', 'excused') then
      raise exception using errcode = '22023', message = 'case conference attendee is duplicated or invalid';
    end if;
    select staff.membership_id, staff.display_name, staff.role_keys
      into v_membership_id, v_display_name, v_roles
    from private.case_conference_staff_snapshot(
      p_organization_id, p_branch_id, v_user_id, p_reference_time
    ) staff;
    if v_membership_id is null or cardinality(v_roles) = 0 then
      raise exception using errcode = '42501', message = 'case conference attendee is not current staff';
    end if;
    v_seen := array_append(v_seen, v_user_id);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'user_id', v_user_id,
      'membership_id', v_membership_id,
      'display_name', v_display_name,
      'role_keys', to_jsonb(v_roles),
      'attendance_status', v_attendance
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function private.case_conference_materialize_actions(
  p_organization_id uuid,
  p_branch_id uuid,
  p_meeting_starts_at timestamptz,
  p_action_items jsonb,
  p_reference_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb; v_action_id uuid; v_order integer; v_action_text text;
  v_responsible uuid; v_deadline_state text; v_due_date date; v_action_status text;
  v_membership_id uuid; v_display_name text; v_roles text[];
  v_seen uuid[] := '{}'::uuid[]; v_expected_order integer := 0;
  v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_action_items) <> 'array'
     or jsonb_array_length(p_action_items) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'case conference action list is invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_action_items) value loop
    if jsonb_typeof(v_item) <> 'object'
       or (select array_agg(key order by key)
           from jsonb_object_keys(v_item) as keys(key))
          <> array[
            'action_id', 'action_status', 'action_text', 'deadline_state',
            'due_date', 'item_order', 'responsible_user_id'
          ]::text[] then
      raise exception using errcode = '22023', message = 'case conference action entry is invalid';
    end if;
    begin
      v_action_id := nullif(v_item ->> 'action_id', '')::uuid;
      v_order := nullif(v_item ->> 'item_order', '')::integer;
      v_responsible := nullif(v_item ->> 'responsible_user_id', '')::uuid;
      v_due_date := nullif(v_item ->> 'due_date', '')::date;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'case conference action identifiers are invalid';
    end;
    v_action_text := btrim(v_item ->> 'action_text');
    v_deadline_state := v_item ->> 'deadline_state';
    v_action_status := v_item ->> 'action_status';
    v_expected_order := v_expected_order + 1;
    if v_action_id is null or v_action_id = any(v_seen)
       or v_order <> v_expected_order
       or v_responsible is null
       or v_action_text is null or char_length(v_action_text) not between 2 and 2000
       or translate(v_action_text, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_deadline_state not in ('dated', 'missing', 'not_applicable')
       or (v_deadline_state = 'dated') <> (v_due_date is not null)
       or (v_due_date is not null
         and v_due_date < (p_meeting_starts_at at time zone 'Asia/Taipei')::date)
       or v_action_status not in ('open', 'completed', 'cancelled') then
      raise exception using errcode = '22023',
        message = 'case conference action, order or manual deadline is invalid';
    end if;
    select staff.membership_id, staff.display_name, staff.role_keys
      into v_membership_id, v_display_name, v_roles
    from private.case_conference_staff_snapshot(
      p_organization_id, p_branch_id, v_responsible, p_reference_time
    ) staff;
    if v_membership_id is null or cardinality(v_roles) = 0 then
      raise exception using errcode = '42501', message = 'case conference action owner is not current staff';
    end if;
    v_seen := array_append(v_seen, v_action_id);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'action_id', v_action_id,
      'item_order', v_order,
      'action_text', v_action_text,
      'responsible_user_id', v_responsible,
      'responsible_membership_id', v_membership_id,
      'responsible_display_name', v_display_name,
      'deadline_state', v_deadline_state,
      'due_date', v_due_date,
      'action_status', v_action_status
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function private.mutate_case_conference_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_meeting_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_corrects_version_id uuid,
  p_client_id uuid,
  p_meeting_starts_at timestamptz,
  p_meeting_ends_at timestamptz,
  p_problem_statement text,
  p_decision_summary text,
  p_attendees jsonb,
  p_action_items jsonb,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, operation_kind text,
  meeting_key uuid, version_id uuid, version integer,
  previous_version_id uuid, corrects_version_id uuid,
  version_kind text, conference_status text, signed_at timestamptz,
  content_hash text, attachment_status text, export_status text,
  notification_status text, external_delivery_status text, delivery_claim text,
  offline_status text, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_permission text; v_require_aal2 boolean;
  v_request_hash text; v_reauth uuid; v_existing record; v_previous record;
  v_actor_membership uuid; v_actor_name text; v_actor_roles text[];
  v_client_id uuid; v_client_name text; v_client_code text;
  v_key uuid; v_version_id uuid := gen_random_uuid(); v_version integer;
  v_previous_id uuid; v_corrects_id uuid; v_kind text; v_status text;
  v_starts_at timestamptz; v_ends_at timestamptz;
  v_problem text; v_decision text; v_attendees jsonb; v_actions jsonb;
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_signed_at timestamptz; v_signer_user uuid; v_signer_membership uuid;
  v_signer_name text; v_signer_roles text[] := '{}'::text[];
  v_signature_purpose text; v_content_hash text;
  v_operation_id uuid := gen_random_uuid();
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null
     or p_action not in ('create', 'revise', 'sign', 'correct') then
    raise exception using errcode = '22023', message = 'case conference request is invalid';
  end if;
  if not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       'case_conferences.read', false
     ) or not private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ) then
    raise exception using errcode = '42501', message = 'case conference base access is not permitted';
  end if;
  v_permission := case when p_action in ('sign', 'correct')
    then 'case_conferences.sign' else 'case_conferences.manage' end;
  v_require_aal2 := p_action in ('sign', 'correct');
  if not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       v_permission, v_require_aal2
     ) or (p_action = 'correct' and not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       'case_conferences.manage', false
     )) then
    raise exception using errcode = '42501', message = 'case conference operation is not permitted';
  end if;
  select staff.membership_id, staff.display_name, staff.role_keys
    into v_actor_membership, v_actor_name, v_actor_roles
  from private.case_conference_staff_snapshot(
    p_expected_organization_id, p_expected_branch_id, v_actor, v_now
  ) staff;
  if v_actor_membership is null or cardinality(v_actor_roles) = 0 then
    raise exception using errcode = '42501', message = 'case conference actor is not current staff';
  end if;
  if v_require_aal2 then
    v_reauth := private.require_case_conference_reauth(v_actor, v_now);
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'action', p_action,
    'meeting_key', p_meeting_key, 'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version, 'corrects_version_id', p_corrects_version_id,
    'client_id', p_client_id, 'meeting_starts_at', p_meeting_starts_at,
    'meeting_ends_at', p_meeting_ends_at,
    'problem_statement', nullif(btrim(p_problem_statement), ''),
    'decision_summary', nullif(btrim(p_decision_summary), ''),
    'attendees', p_attendees, 'action_items', p_action_items,
    'correction_reason', v_correction_reason
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'case-conference-actor:' || v_actor::text || ':' || p_idempotency_key::text, 38
  ));
  select operation.* into v_existing
  from private.case_conference_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request_hash
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id then
      raise exception using errcode = '23505', message = 'case conference idempotency conflict';
    end if;
    select conference.* into v_previous
    from public.case_conference_versions conference
    where conference.id = v_existing.result_version_id
      and conference.organization_id = p_expected_organization_id
      and conference.branch_id = p_expected_branch_id
      and conference.meeting_key = v_existing.result_meeting_key;
    if not found
       or not private.can_staff_access_client(v_previous.client_id, 'clients.read')
       or not private.can_staff_access_client(v_previous.client_id, 'case_conferences.read') then
      raise exception using errcode = '42501', message = 'case conference replay is outside client scope';
    end if;
    return query select p_expected_organization_id, p_expected_branch_id,
      v_existing.id, v_existing.operation_kind, v_existing.result_meeting_key,
      v_existing.result_version_id, v_existing.result_version,
      v_existing.previous_version_id, v_existing.corrects_version_id,
      v_previous.version_kind, v_existing.result_status, v_previous.signed_at,
      v_existing.result_content_hash, 'not_configured'::text,
      'not_configured'::text, 'not_configured'::text, 'not_configured'::text,
      'no_external_delivery_claim'::text, 'not_configured'::text,
      v_existing.committed_at, true;
    return;
  end if;

  if p_action = 'create' then
    if p_meeting_key is not null or p_previous_version_id is not null
       or p_expected_version is not null or p_corrects_version_id is not null
       or p_client_id is null or p_meeting_starts_at is null or p_meeting_ends_at is null
       or p_problem_statement is null or p_decision_summary is null
       or p_attendees is null or p_action_items is null
       or v_correction_reason is not null then
      raise exception using errcode = '22023', message = 'case conference create fields are invalid';
    end if;
    select client.id, btrim(client.display_name), btrim(client.client_code)
      into v_client_id, v_client_name, v_client_code
    from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active'
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'case_conferences.read');
    if v_client_id is null then
      raise exception using errcode = '42501', message = 'case conference client is outside current scope';
    end if;
    v_key := gen_random_uuid(); v_version := 1; v_previous_id := null;
    v_corrects_id := null; v_kind := 'created'; v_status := 'draft';
    v_starts_at := p_meeting_starts_at; v_ends_at := p_meeting_ends_at;
    v_problem := nullif(btrim(p_problem_statement), '');
    v_decision := nullif(btrim(p_decision_summary), '');
  else
    if p_meeting_key is null or p_previous_version_id is null
       or p_expected_version is null or p_expected_version <= 0
       or p_client_id is not null then
      raise exception using errcode = '22023', message = 'case conference continuation fields are invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'case-conference-stream:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_meeting_key::text, 38
    ));
    select conference.* into v_previous
    from public.case_conference_versions conference
    where conference.id = p_previous_version_id
      and conference.organization_id = p_expected_organization_id
      and conference.branch_id = p_expected_branch_id
      and conference.meeting_key = p_meeting_key
      and conference.version = p_expected_version
      and not exists (
        select 1 from public.case_conference_versions child
        where child.previous_version_id = conference.id
      )
    for share;
    if not found
       or not private.can_staff_access_client(v_previous.client_id, 'clients.read')
       or not private.can_staff_access_client(v_previous.client_id, 'case_conferences.read') then
      raise exception using errcode = '40001', message = 'case conference base version is stale or outside scope';
    end if;
    if p_action = 'revise' and (
       v_previous.status <> 'draft' or p_corrects_version_id is not null
       or v_correction_reason is not null
    ) then
      raise exception using errcode = '40001', message = 'only a draft case conference can be revised';
    end if;
    if p_action = 'sign' and (
       v_previous.status <> 'draft' or p_corrects_version_id is not null
       or p_meeting_starts_at is not null or p_meeting_ends_at is not null
       or p_problem_statement is not null or p_decision_summary is not null
       or p_attendees is not null or p_action_items is not null
       or v_correction_reason is not null
    ) then
      raise exception using errcode = '40001', message = 'only an unchanged draft can be signed';
    end if;
    if p_action = 'correct' and (
       v_previous.status <> 'signed' or p_corrects_version_id <> v_previous.id
       or v_correction_reason is null
    ) then
      raise exception using errcode = '40001', message = 'case conference correction target is invalid';
    end if;
    if p_action in ('revise', 'correct') and (
       p_meeting_starts_at is null or p_meeting_ends_at is null
       or p_problem_statement is null or p_decision_summary is null
       or p_attendees is null or p_action_items is null
    ) then
      raise exception using errcode = '22023', message = 'case conference version content is incomplete';
    end if;
    v_client_id := v_previous.client_id;
    v_client_name := v_previous.client_display_name;
    v_client_code := v_previous.client_code;
    v_key := p_meeting_key; v_version := v_previous.version + 1;
    v_previous_id := p_previous_version_id;
    v_corrects_id := case when p_action = 'correct' then p_corrects_version_id else null end;
    v_kind := case p_action when 'revise' then 'revised'
      when 'sign' then 'signed' else 'corrected' end;
    v_status := case when p_action = 'revise' then 'draft' else 'signed' end;
    if p_action = 'sign' then
      v_starts_at := v_previous.meeting_starts_at;
      v_ends_at := v_previous.meeting_ends_at;
      v_problem := v_previous.problem_statement;
      v_decision := v_previous.decision_summary;
      v_attendees := v_previous.attendees;
      v_actions := v_previous.action_items;
    else
      v_starts_at := p_meeting_starts_at;
      v_ends_at := p_meeting_ends_at;
      v_problem := nullif(btrim(p_problem_statement), '');
      v_decision := nullif(btrim(p_decision_summary), '');
    end if;
  end if;

  if v_version > 10000 or v_starts_at is null or v_ends_at is null
     or v_ends_at <= v_starts_at
     or extract(year from v_starts_at at time zone 'Asia/Taipei') not between 2000 and 2200
     or extract(year from v_ends_at at time zone 'Asia/Taipei') not between 2000 and 2200
     or v_problem is null or char_length(v_problem) not between 2 and 4000
     or translate(v_problem, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or v_decision is null or char_length(v_decision) not between 2 and 4000
     or translate(v_decision, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'case conference content or time is invalid';
  end if;
  if p_action <> 'sign' then
    v_attendees := private.case_conference_materialize_attendees(
      p_expected_organization_id, p_expected_branch_id, p_attendees, v_now
    );
    v_actions := private.case_conference_materialize_actions(
      p_expected_organization_id, p_expected_branch_id, v_starts_at,
      p_action_items, v_now
    );
  end if;
  if v_status = 'signed' then
    if v_now < v_ends_at then
      raise exception using errcode = '22023', message = 'case conference cannot be signed before meeting end';
    end if;
    v_signed_at := v_now; v_signer_user := v_actor;
    v_signer_membership := v_actor_membership; v_signer_name := v_actor_name;
    v_signer_roles := v_actor_roles;
    v_signature_purpose := '個案研討會議紀錄簽署';
  end if;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'meeting_key', v_key, 'version', v_version,
    'previous_version_id', v_previous_id, 'corrects_version_id', v_corrects_id,
    'version_kind', v_kind, 'status', v_status, 'client_id', v_client_id,
    'meeting_starts_at', v_starts_at, 'meeting_ends_at', v_ends_at,
    'problem_statement', v_problem, 'decision_summary', v_decision,
    'attendees', v_attendees, 'action_items', v_actions,
    'correction_reason', v_correction_reason, 'occurred_at', v_now,
    'author_user_id', v_actor, 'signed_at', v_signed_at,
    'signer_user_id', v_signer_user, 'signer_role_keys', v_signer_roles,
    'signature_purpose', v_signature_purpose,
    'reauth_challenge_id', v_reauth
  )::text, 'UTF8')), 'hex');

  insert into public.case_conference_versions (
    id, organization_id, branch_id, meeting_key, version,
    previous_version_id, corrects_version_id, version_kind, status,
    client_id, client_display_name, client_code,
    meeting_starts_at, meeting_ends_at, problem_statement, decision_summary,
    attendees, action_items, correction_reason, occurred_at,
    author_user_id, author_membership_id, author_display_name,
    signed_at, signer_user_id, signer_membership_id, signer_display_name,
    signer_role_keys, signature_purpose, reauth_challenge_id, content_hash
  ) values (
    v_version_id, p_expected_organization_id, p_expected_branch_id, v_key, v_version,
    v_previous_id, v_corrects_id, v_kind, v_status,
    v_client_id, v_client_name, v_client_code,
    v_starts_at, v_ends_at, v_problem, v_decision,
    v_attendees, v_actions, v_correction_reason, v_now,
    v_actor, v_actor_membership, v_actor_name,
    v_signed_at, v_signer_user, v_signer_membership, v_signer_name,
    v_signer_roles, v_signature_purpose, v_reauth, v_content_hash
  );
  insert into private.case_conference_operations (
    id, organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_meeting_key, result_version_id,
    result_version, previous_version_id, corrects_version_id,
    result_status, result_content_hash, reauth_challenge_id, committed_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id,
    v_actor, p_idempotency_key, p_action, v_request_hash, v_key, v_version_id,
    v_version, v_previous_id, v_corrects_id, v_status, v_content_hash, v_reauth, v_now
  );
  if not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       v_permission, v_require_aal2
     ) or (p_action = 'correct' and not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       'case_conferences.manage', false
     )) or not private.can_staff_access_client(v_client_id, 'clients.read')
     or not private.can_staff_access_client(v_client_id, 'case_conferences.read')
     or (v_require_aal2
       and private.require_case_conference_reauth(v_actor, clock_timestamp()) is null) then
    raise exception using errcode = '42501', message = 'case conference authority expired';
  end if;
  return query select p_expected_organization_id, p_expected_branch_id,
    v_operation_id, p_action, v_key, v_version_id, v_version,
    v_previous_id, v_corrects_id, v_kind, v_status, v_signed_at,
    v_content_hash, 'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 'not_configured'::text,
    'no_external_delivery_claim'::text, 'not_configured'::text, v_now, false;
end;
$$;

create or replace function public.mutate_case_conference(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_meeting_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_corrects_version_id uuid,
  p_client_id uuid,
  p_meeting_starts_at timestamptz,
  p_meeting_ends_at timestamptz,
  p_problem_statement text,
  p_decision_summary text,
  p_attendees jsonb,
  p_action_items jsonb,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, operation_id uuid, operation_kind text,
  meeting_key uuid, version_id uuid, version integer,
  previous_version_id uuid, corrects_version_id uuid,
  version_kind text, conference_status text, signed_at timestamptz,
  content_hash text, attachment_status text, export_status text,
  notification_status text, external_delivery_status text, delivery_claim text,
  offline_status text, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_case_conference_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_meeting_key, p_previous_version_id, p_expected_version,
    p_corrects_version_id, p_client_id, p_meeting_starts_at, p_meeting_ends_at,
    p_problem_statement, p_decision_summary, p_attendees, p_action_items,
    p_correction_reason, p_idempotency_key
  );
$$;

create or replace function private.case_conference_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_status text,
  p_responsible_user_id uuid,
  p_action_status text,
  p_meeting_from date,
  p_meeting_to date,
  p_query text
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_date date, snapshot_token text, items jsonb,
  matching_total bigint, draft_total bigint, signed_total bigint,
  corrected_total bigint, action_total bigint, open_action_total bigint,
  overdue_action_total bigint, deadline_missing_total bigint,
  deadline_not_applicable_total bigint, items_truncated boolean,
  client_options jsonb, staff_options jsonb,
  can_manage boolean, can_sign boolean, can_correct boolean,
  attachment_status text, export_status text, notification_status text,
  external_delivery_status text, delivery_claim text, offline_status text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Taipei')::date;
  v_query text := nullif(btrim(p_query), '');
  v_organization_name text; v_branch_name text; v_items jsonb;
  v_matching bigint; v_draft bigint; v_signed bigint; v_corrected bigint;
  v_action_total bigint; v_open bigint; v_overdue bigint;
  v_missing bigint; v_not_applicable bigint; v_clients jsonb; v_staff jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_status not in ('all', 'draft', 'signed')
     or p_action_status not in ('all', 'open', 'completed', 'cancelled', 'overdue')
     or (p_meeting_from is not null and p_meeting_to is not null
       and p_meeting_from > p_meeting_to)
     or (v_query is not null and (
       char_length(v_query) > 120 or v_query ~ '[[:cntrl:]]'
     ))
     or not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       'case_conferences.read', false
     )
     or not private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ) then
    raise exception using errcode = '42501', message = 'case conference snapshot is not permitted';
  end if;

  with current_versions as materialized (
    select distinct on (conference.meeting_key) conference.*
    from public.case_conference_versions conference
    where conference.organization_id = p_expected_organization_id
      and conference.branch_id = p_expected_branch_id
    order by conference.meeting_key, conference.version desc, conference.id desc
  ), filtered as materialized (
    select current.*
    from current_versions current
    where private.can_staff_access_client(current.client_id, 'clients.read')
      and private.can_staff_access_client(current.client_id, 'case_conferences.read')
      and (p_client_id is null or current.client_id = p_client_id)
      and (p_status = 'all' or current.status = p_status)
      and (p_meeting_from is null
        or (current.meeting_starts_at at time zone 'Asia/Taipei')::date >= p_meeting_from)
      and (p_meeting_to is null
        or (current.meeting_starts_at at time zone 'Asia/Taipei')::date <= p_meeting_to)
      and (p_responsible_user_id is null or exists (
        select 1 from jsonb_array_elements(current.action_items) action(value)
        where (action.value ->> 'responsible_user_id')::uuid = p_responsible_user_id
      ))
      and (p_action_status = 'all' or exists (
        select 1 from jsonb_array_elements(current.action_items) action(value)
        where (p_action_status <> 'overdue'
          and action.value ->> 'action_status' = p_action_status)
          or (p_action_status = 'overdue'
            and action.value ->> 'deadline_state' = 'dated'
            and (action.value ->> 'due_date')::date < v_today
            and action.value ->> 'action_status' = 'open')
      ))
      and (v_query is null
        or lower(current.problem_statement) like '%' || lower(v_query) || '%'
        or lower(current.decision_summary) like '%' || lower(v_query) || '%')
  ), selected as materialized (
    select * from filtered
    order by meeting_starts_at desc, meeting_key
    limit 200
  ), bundled as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'version_id', selected.id,
      'meeting_key', selected.meeting_key,
      'version', selected.version,
      'previous_version_id', selected.previous_version_id,
      'corrects_version_id', selected.corrects_version_id,
      'version_kind', selected.version_kind,
      'status', selected.status,
      'client_id', selected.client_id,
      'client_display_name', selected.client_display_name,
      'client_code', selected.client_code,
      'meeting_starts_at', selected.meeting_starts_at,
      'meeting_ends_at', selected.meeting_ends_at,
      'problem_statement', selected.problem_statement,
      'decision_summary', selected.decision_summary,
      'attendees', selected.attendees,
      'action_items', (
        select coalesce(jsonb_agg(action.value || jsonb_build_object(
          'is_overdue', action.value ->> 'deadline_state' = 'dated'
            and (action.value ->> 'due_date')::date < v_today
            and action.value ->> 'action_status' = 'open'
        ) order by (action.value ->> 'item_order')::integer), '[]'::jsonb)
        from jsonb_array_elements(selected.action_items) action(value)
      ),
      'correction_reason', selected.correction_reason,
      'occurred_at', selected.occurred_at,
      'author_display_name', selected.author_display_name,
      'signed_at', selected.signed_at,
      'signer_display_name', selected.signer_display_name,
      'signer_role_keys', to_jsonb(selected.signer_role_keys),
      'signature_purpose', selected.signature_purpose,
      'content_hash', selected.content_hash,
      'history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'version_id', history.id,
          'version', history.version,
          'previous_version_id', history.previous_version_id,
          'corrects_version_id', history.corrects_version_id,
          'version_kind', history.version_kind,
          'status', history.status,
          'meeting_starts_at', history.meeting_starts_at,
          'meeting_ends_at', history.meeting_ends_at,
          'problem_statement', history.problem_statement,
          'decision_summary', history.decision_summary,
          'attendees', history.attendees,
          'action_items', (
            select coalesce(jsonb_agg(history_action.value || jsonb_build_object(
              'is_overdue', history_action.value ->> 'deadline_state' = 'dated'
                and (history_action.value ->> 'due_date')::date < v_today
                and history_action.value ->> 'action_status' = 'open'
            ) order by (history_action.value ->> 'item_order')::integer), '[]'::jsonb)
            from jsonb_array_elements(history.action_items) history_action(value)
          ),
          'correction_reason', history.correction_reason,
          'occurred_at', history.occurred_at,
          'author_display_name', history.author_display_name,
          'signed_at', history.signed_at,
          'signer_display_name', history.signer_display_name,
          'signer_role_keys', to_jsonb(history.signer_role_keys),
          'signature_purpose', history.signature_purpose,
          'content_hash', history.content_hash
        ) order by history.version desc), '[]'::jsonb)
        from public.case_conference_versions history
        where history.organization_id = selected.organization_id
          and history.branch_id = selected.branch_id
          and history.meeting_key = selected.meeting_key
      )
    ) order by selected.meeting_starts_at desc, selected.meeting_key), '[]'::jsonb) value
    from selected
  ), filtered_actions as materialized (
    select filtered.meeting_key, action.value
    from filtered cross join lateral jsonb_array_elements(filtered.action_items) action(value)
  ), conference_metrics as (
    select count(*) matching_total,
      count(*) filter (where status = 'draft') draft_total,
      count(*) filter (where status = 'signed') signed_total,
      count(*) filter (where version_kind = 'corrected') corrected_total
    from filtered
  ), action_metrics as (
    select count(*) action_total,
      count(*) filter (where value ->> 'action_status' = 'open') open_total,
      count(*) filter (where value ->> 'deadline_state' = 'dated'
        and (value ->> 'due_date')::date < v_today
        and value ->> 'action_status' = 'open') overdue_total,
      count(*) filter (where value ->> 'deadline_state' = 'missing') missing_total,
      count(*) filter (where value ->> 'deadline_state' = 'not_applicable') not_applicable_total
    from filtered_actions
  ), clients as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option.id,
      'display_name', option.display_name,
      'client_code', option.client_code
    ) order by option.display_name collate "C", option.id), '[]'::jsonb) value
    from (
      select client.id, client.display_name, client.client_code
      from public.clients client
      where client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
        and client.status = 'active'
        and private.can_staff_access_client(client.id, 'clients.read')
        and private.can_staff_access_client(client.id, 'case_conferences.read')
      order by client.display_name collate "C", client.id limit 200
    ) option
  ), staff as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', option.id,
      'display_name', option.display_name,
      'role_keys', to_jsonb(option.role_keys)
    ) order by option.display_name collate "C", option.id), '[]'::jsonb) value
    from (
      select distinct on (profile.id) profile.id, btrim(profile.display_name) display_name,
        roles.role_keys
      from public.profiles profile
      join public.memberships membership on membership.profile_id = profile.id
      join lateral (
        select array_agg(distinct role.role_key order by role.role_key) role_keys
        from public.membership_roles membership_role
        join public.roles role on role.id = membership_role.role_id and role.is_active
        where membership_role.membership_id = membership.id
          and (role.organization_id is null or role.organization_id = p_expected_organization_id)
      ) roles on cardinality(roles.role_keys) > 0
      where profile.is_active and profile.kind in ('staff', 'professional')
        and membership.organization_id = p_expected_organization_id
        and membership.status = 'active'
        and membership.starts_at <= v_now
        and (membership.ends_at is null or membership.ends_at > v_now)
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      order by profile.id, (membership.branch_id = p_expected_branch_id) desc, membership.id
      limit 500
    ) option
  )
  select organization.name, branch.name, bundled.value,
    conference_metrics.matching_total, conference_metrics.draft_total,
    conference_metrics.signed_total, conference_metrics.corrected_total,
    action_metrics.action_total, action_metrics.open_total,
    action_metrics.overdue_total, action_metrics.missing_total,
    action_metrics.not_applicable_total, clients.value, staff.value
  into v_organization_name, v_branch_name, v_items,
    v_matching, v_draft, v_signed, v_corrected,
    v_action_total, v_open, v_overdue, v_missing, v_not_applicable,
    v_clients, v_staff
  from public.organizations organization
  join public.branches branch
    on branch.id = p_expected_branch_id
   and branch.organization_id = organization.id
  cross join bundled cross join conference_metrics cross join action_metrics
  cross join clients cross join staff
  where organization.id = p_expected_organization_id;

  if v_organization_name is null or v_branch_name is null then
    raise exception using errcode = '42501', message = 'case conference scope is unavailable';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'case_conference_snapshot', null, '{}'::text[], jsonb_build_object(
      'workflow', 'page38_case_conference_v1',
      'client_filter_present', p_client_id is not null,
      'status_filter', p_status,
      'responsible_filter_present', p_responsible_user_id is not null,
      'action_status_filter', p_action_status,
      'date_filter_present', p_meeting_from is not null or p_meeting_to is not null,
      'query_present', v_query is not null,
      'matching_total', v_matching
    )
  );
  if not private.case_conference_authority(
       p_expected_organization_id, p_expected_branch_id,
       'case_conferences.read', false
     ) or not private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ) then
    raise exception using errcode = '42501', message = 'case conference authority expired';
  end if;
  return query select p_expected_organization_id, v_organization_name,
    p_expected_branch_id, v_branch_name, v_now, v_today,
    encode(sha256(convert_to(jsonb_build_object(
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id,
      'snapshot_date', v_today,
      'items', v_items
    )::text, 'UTF8')), 'hex'),
    v_items, v_matching, v_draft, v_signed, v_corrected,
    v_action_total, v_open, v_overdue, v_missing, v_not_applicable,
    v_matching > jsonb_array_length(v_items), v_clients, v_staff,
    private.case_conference_authority(
      p_expected_organization_id, p_expected_branch_id,
      'case_conferences.manage', false),
    private.case_conference_authority(
      p_expected_organization_id, p_expected_branch_id,
      'case_conferences.sign', true),
    private.case_conference_authority(
      p_expected_organization_id, p_expected_branch_id,
      'case_conferences.manage', false)
      and private.case_conference_authority(
        p_expected_organization_id, p_expected_branch_id,
        'case_conferences.sign', true),
    'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 'not_configured'::text,
    'no_external_delivery_claim'::text, 'not_configured'::text;
end;
$$;

create or replace function public.case_conference_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_status text default 'all',
  p_responsible_user_id uuid default null,
  p_action_status text default 'all',
  p_meeting_from date default null,
  p_meeting_to date default null,
  p_query text default null
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_date date, snapshot_token text, items jsonb,
  matching_total bigint, draft_total bigint, signed_total bigint,
  corrected_total bigint, action_total bigint, open_action_total bigint,
  overdue_action_total bigint, deadline_missing_total bigint,
  deadline_not_applicable_total bigint, items_truncated boolean,
  client_options jsonb, staff_options jsonb,
  can_manage boolean, can_sign boolean, can_correct boolean,
  attachment_status text, export_status text, notification_status text,
  external_delivery_status text, delivery_claim text, offline_status text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.case_conference_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id, p_status,
    p_responsible_user_id, p_action_status, p_meeting_from, p_meeting_to, p_query
  );
$$;

revoke all on function private.prevent_case_conference_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.case_conference_authority(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.case_conference_staff_snapshot(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_case_conference_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.case_conference_materialize_attendees(uuid,uuid,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.case_conference_materialize_actions(uuid,uuid,timestamptz,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_case_conference_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)
  from public, anon, service_role;
revoke all on function private.case_conference_snapshot_response(uuid,uuid,uuid,text,uuid,text,date,date,text)
  from public, anon, service_role;
revoke all on function public.mutate_case_conference(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)
  from public, anon, service_role;
revoke all on function public.case_conference_snapshot(uuid,uuid,uuid,text,uuid,text,date,date,text)
  from public, anon, service_role;

grant execute on function private.mutate_case_conference_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)
  to authenticated;
grant execute on function private.case_conference_snapshot_response(uuid,uuid,uuid,text,uuid,text,date,date,text)
  to authenticated;
grant execute on function public.mutate_case_conference(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)
  to authenticated;
grant execute on function public.case_conference_snapshot(uuid,uuid,uuid,text,uuid,text,date,date,text)
  to authenticated;

comment on table public.case_conference_versions is
  'Page 38 immutable client-specific conference versions; separate from Page 75 general meetings.';
comment on function public.case_conference_snapshot(uuid,uuid,uuid,text,uuid,text,date,date,text) is
  'Page 38 audited assigned-client snapshot with metrics computed before the 200-row detail limit.';
