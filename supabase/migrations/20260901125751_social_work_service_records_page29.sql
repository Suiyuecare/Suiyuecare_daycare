-- Page 29: assigned-client social-work service records.
--
-- Every service record version and follow-up event is append-only.  Draft
-- revisions, signatures, corrections, and follow-up transitions are distinct
-- rows; no committed narrative is updated or deleted.  Service categories and
-- offline synchronization policy remain institution-owned and unconfigured.

insert into public.permissions (permission_key, description, risk_level) values
  ('social_work_records.read', 'Read assigned-client social-work service records', 2),
  ('social_work_records.manage', 'Create draft revisions and follow-up events for assigned clients', 2),
  ('social_work_records.sign', 'Sign and correct assigned-client social-work service records', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker'
  )
  and permission.permission_key in (
    'social_work_records.read', 'social_work_records.manage',
    'social_work_records.sign'
  )
on conflict (role_id, permission_id) do nothing;

create table public.social_work_service_record_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  record_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_state text not null,
  occurred_at timestamptz not null,
  service_type text not null,
  service_content text not null,
  service_result text not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  correction_reason text,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  signer_display_name text,
  signer_role_keys text[],
  signature_purpose text,
  signature_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint social_work_record_versions_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint social_work_record_versions_id_scope_key unique (
    id, organization_id, branch_id, client_id, record_key
  ),
  constraint social_work_record_versions_chain_key unique (
    organization_id, branch_id, record_key, version
  ),
  constraint social_work_record_versions_previous_key unique (previous_version_id),
  constraint social_work_record_versions_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id, record_key
    ) references public.social_work_service_record_versions (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint social_work_record_versions_version_check check (
    version > 0
    and (
      (version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null)
    )
  ),
  constraint social_work_record_versions_state_check check (
    record_state in ('draft', 'signed', 'corrected')
  ),
  constraint social_work_record_versions_time_check check (
    extract(year from occurred_at at time zone 'Asia/Taipei') between 2000 and 2200
    and occurred_at <= created_at + interval '5 minutes'
  ),
  constraint social_work_record_versions_type_check check (
    char_length(service_type) between 1 and 120
    and service_type = btrim(service_type)
    and service_type !~ '[[:cntrl:]]'
  ),
  constraint social_work_record_versions_content_check check (
    char_length(service_content) between 1 and 5000
    and service_content = btrim(service_content)
    and translate(service_content, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint social_work_record_versions_result_check check (
    char_length(service_result) between 1 and 3000
    and service_result = btrim(service_result)
    and translate(service_result, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint social_work_record_versions_author_check check (
    char_length(author_display_name) between 1 and 120
    and author_display_name = btrim(author_display_name)
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint social_work_record_versions_signature_alignment_check check (
    (
      record_state = 'draft'
      and correction_reason is null
      and signed_at is null
      and signed_by is null
      and signer_display_name is null
      and signer_role_keys is null
      and signature_purpose is null
      and signature_reauth_challenge_id is null
    )
    or (
      record_state in ('signed', 'corrected')
      and signed_at is not null
      and signed_by is not null
      and signer_display_name is not null
      and char_length(signer_display_name) between 1 and 120
      and signer_display_name = btrim(signer_display_name)
      and signer_display_name !~ '[[:cntrl:]]'
      and signer_role_keys is not null
      and cardinality(signer_role_keys) between 1 and 50
      and signature_purpose = case
        when record_state = 'signed' then '社工服務紀錄簽署'
        else '社工服務紀錄更正簽署'
      end
      and signature_reauth_challenge_id is not null
      and (
        (record_state = 'signed' and correction_reason is null)
        or (
          record_state = 'corrected'
          and correction_reason is not null
          and char_length(correction_reason) between 1 and 1000
          and correction_reason = btrim(correction_reason)
          and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
        )
      )
    )
  ),
  constraint social_work_record_versions_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.social_work_service_record_versions is
  'Immutable page-29 service-record versions. Signed content can only be superseded by a reasoned, independently signed correction.';
comment on column public.social_work_service_record_versions.occurred_at is
  'Actual service occurrence time; all page timelines sort by this value, never by created_at.';

create table public.social_work_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  record_key uuid not null,
  service_version_id uuid not null,
  sequence integer not null,
  previous_event_id uuid,
  follow_up_status text not null,
  due_on date,
  follow_up_plan text,
  follow_up_outcome text,
  transition_reason text,
  committed_by uuid not null references auth.users(id) on delete restrict,
  committer_display_name text not null,
  committed_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint social_work_follow_up_service_scope_fkey
    foreign key (
      service_version_id, organization_id, branch_id, client_id, record_key
    ) references public.social_work_service_record_versions (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint social_work_follow_up_id_scope_key unique (
    id, organization_id, branch_id, client_id, record_key
  ),
  constraint social_work_follow_up_previous_key unique (previous_event_id),
  constraint social_work_follow_up_previous_scope_fkey
    foreign key (
      previous_event_id, organization_id, branch_id, client_id, record_key
    ) references public.social_work_follow_up_events (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint social_work_follow_up_stream_key unique (
    organization_id, branch_id, record_key, sequence
  ),
  constraint social_work_follow_up_sequence_check check (
    sequence > 0
    and (
      (sequence = 1 and previous_event_id is null)
      or (sequence > 1 and previous_event_id is not null)
    )
  ),
  constraint social_work_follow_up_status_check check (
    follow_up_status in ('pending', 'completed', 'cancelled')
  ),
  constraint social_work_follow_up_alignment_check check (
    (
      follow_up_status = 'pending'
      and due_on is not null
      and extract(year from due_on) between 2000 and 2200
      and follow_up_plan is not null
      and char_length(follow_up_plan) between 1 and 2000
      and follow_up_plan = btrim(follow_up_plan)
      and translate(follow_up_plan, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and follow_up_outcome is null
      and transition_reason is null
    )
    or (
      follow_up_status = 'completed'
      and due_on is null
      and follow_up_plan is null
      and follow_up_outcome is not null
      and char_length(follow_up_outcome) between 1 and 2000
      and follow_up_outcome = btrim(follow_up_outcome)
      and translate(follow_up_outcome, E'\n\r\t', '') !~ '[[:cntrl:]]'
      and transition_reason is null
    )
    or (
      follow_up_status = 'cancelled'
      and due_on is null
      and follow_up_plan is null
      and follow_up_outcome is null
      and transition_reason is not null
      and char_length(transition_reason) between 1 and 1000
      and transition_reason = btrim(transition_reason)
      and translate(transition_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    )
  ),
  constraint social_work_follow_up_committer_check check (
    char_length(committer_display_name) between 1 and 120
    and committer_display_name = btrim(committer_display_name)
    and committer_display_name !~ '[[:cntrl:]]'
  ),
  constraint social_work_follow_up_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

comment on table public.social_work_follow_up_events is
  'Append-only follow-up status stream linked to an immutable signed service-record chain.';

create table private.social_work_record_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_state text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint social_work_record_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint social_work_record_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, client_id,
      result_record_key
    ) references public.social_work_service_record_versions (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint social_work_record_operations_kind_check check (
    operation_kind in ('create_draft', 'revise_draft', 'sign', 'correct')
  ),
  constraint social_work_record_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint social_work_record_operations_version_check
    check (result_version > 0),
  constraint social_work_record_operations_state_check
    check (result_state in ('draft', 'signed', 'corrected')),
  constraint social_work_record_operations_reauth_check check (
    (operation_kind in ('create_draft', 'revise_draft') and reauth_challenge_id is null)
    or (operation_kind in ('sign', 'correct') and reauth_challenge_id is not null)
  )
);

create table private.social_work_follow_up_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_record_key uuid not null,
  result_event_id uuid not null,
  result_sequence integer not null,
  result_status text not null,
  result_committed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint social_work_follow_up_operations_actor_key unique (
    actor_user_id, idempotency_key
  ),
  constraint social_work_follow_up_operations_result_scope_fkey
    foreign key (
      result_event_id, organization_id, branch_id, client_id,
      result_record_key
    ) references public.social_work_follow_up_events (
      id, organization_id, branch_id, client_id, record_key
    ) on delete restrict,
  constraint social_work_follow_up_operations_kind_check check (
    operation_kind in ('track', 'complete_follow_up', 'cancel_follow_up')
  ),
  constraint social_work_follow_up_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint social_work_follow_up_operations_sequence_check
    check (result_sequence > 0),
  constraint social_work_follow_up_operations_status_check
    check (result_status in ('pending', 'completed', 'cancelled'))
);

create index social_work_records_scope_occurred_idx
  on public.social_work_service_record_versions (
    organization_id, branch_id, occurred_at desc, record_key, version desc
  );
create index social_work_records_client_occurred_idx
  on public.social_work_service_record_versions (
    client_id, occurred_at desc, record_key, version desc
  );
create index social_work_records_author_idx
  on public.social_work_service_record_versions (
    organization_id, branch_id, author_user_id, occurred_at desc
  );
create index social_work_records_previous_idx
  on public.social_work_service_record_versions (previous_version_id)
  where previous_version_id is not null;
create index social_work_records_signature_idx
  on public.social_work_service_record_versions (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index social_work_records_signed_by_idx
  on public.social_work_service_record_versions (signed_by)
  where signed_by is not null;
create index social_work_follow_up_stream_idx
  on public.social_work_follow_up_events (
    organization_id, branch_id, record_key, sequence desc
  );
create index social_work_follow_up_due_idx
  on public.social_work_follow_up_events (
    organization_id, branch_id, due_on, record_key
  ) where follow_up_status = 'pending';
create index social_work_follow_up_service_version_idx
  on public.social_work_follow_up_events (service_version_id);
create index social_work_follow_up_committed_by_idx
  on public.social_work_follow_up_events (committed_by);
create index social_work_record_operations_result_idx
  on private.social_work_record_operations (
    organization_id, branch_id, client_id, result_record_key,
    result_version_id, result_version desc
  );
create index social_work_record_operations_reauth_idx
  on private.social_work_record_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;
create index social_work_follow_up_operations_result_idx
  on private.social_work_follow_up_operations (
    organization_id, branch_id, client_id, result_record_key,
    result_event_id, result_sequence desc
  );

alter table public.social_work_service_record_versions enable row level security;
alter table public.social_work_service_record_versions force row level security;
alter table public.social_work_follow_up_events enable row level security;
alter table public.social_work_follow_up_events force row level security;
alter table private.social_work_record_operations enable row level security;
alter table private.social_work_record_operations force row level security;
alter table private.social_work_follow_up_operations enable row level security;
alter table private.social_work_follow_up_operations force row level security;

revoke all on table public.social_work_service_record_versions
  from public, anon, authenticated, service_role;
revoke all on table public.social_work_follow_up_events
  from public, anon, authenticated, service_role;
revoke all on table private.social_work_record_operations
  from public, anon, authenticated, service_role;
revoke all on table private.social_work_follow_up_operations
  from public, anon, authenticated, service_role;

create or replace function private.social_work_history_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'social-work service history is append-only';
end;
$$;

create trigger social_work_service_versions_append_only
before update or delete on public.social_work_service_record_versions
for each row execute function private.social_work_history_is_append_only();
create trigger social_work_follow_up_events_append_only
before update or delete on public.social_work_follow_up_events
for each row execute function private.social_work_history_is_append_only();
create trigger social_work_record_operations_append_only
before update or delete on private.social_work_record_operations
for each row execute function private.social_work_history_is_append_only();
create trigger social_work_follow_up_operations_append_only
before update or delete on private.social_work_follow_up_operations
for each row execute function private.social_work_history_is_append_only();

create trigger social_work_service_record_versions_audit_row_change
after insert on public.social_work_service_record_versions
for each row execute function private.audit_row_change();
create trigger social_work_follow_up_events_audit_row_change
after insert on public.social_work_follow_up_events
for each row execute function private.audit_row_change();
create trigger social_work_record_operations_audit_row_change
after insert on private.social_work_record_operations
for each row execute function private.audit_row_change();
create trigger social_work_follow_up_operations_audit_row_change
after insert on private.social_work_follow_up_operations
for each row execute function private.audit_row_change();

create or replace function private.social_work_current_authority(
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
  select
    auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional')
        and profile.is_active
    )
    and exists (
      select 1
      from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.social_work_client_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.social_work_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission
    )
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
    )
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.require_social_work_reauth_evidence(
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
     or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for social-work signing';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for social-work signing';
  end;

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
    raise exception using
      errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for social-work signing';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_social_work_service_record_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_occurred_at timestamptz,
  p_service_type text,
  p_service_content text,
  p_service_result text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  record_key uuid,
  version_id uuid,
  record_version integer,
  record_state text,
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
  v_request_hash text;
  v_operation private.social_work_record_operations%rowtype;
  v_previous public.social_work_service_record_versions%rowtype;
  v_result public.social_work_service_record_versions%rowtype;
  v_record_key uuid;
  v_version integer;
  v_state text;
  v_author_user_id uuid;
  v_author_display_name text;
  v_signer_display_name text;
  v_signer_role_keys text[];
  v_challenge_id uuid;
  v_occurred_at timestamptz;
  v_service_type text;
  v_service_content text;
  v_service_result text;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_content_hash text;
begin
  if p_action not in ('create_draft', 'revise_draft', 'sign', 'correct')
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_idempotency_key is null
     or not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'social_work_records.sign' else 'social_work_records.manage' end
     )
     or not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.read'
     ) then
    raise exception using
      errcode = '42501', message = 'social-work service operation is not permitted';
  end if;

  if p_action = 'create_draft' then
    if p_record_key is not null or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0 then
      raise exception using errcode = '22023', message = 'new draft chain input is invalid';
    end if;
  elsif p_record_key is null or p_previous_version_id is null
        or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'record chain input is invalid';
  end if;

  if p_action in ('create_draft', 'revise_draft', 'correct') then
    if p_occurred_at is null
       or extract(year from p_occurred_at at time zone 'Asia/Taipei') not between 2000 and 2200
       or p_service_type is null
       or char_length(btrim(p_service_type)) not between 1 and 120
       or btrim(p_service_type) ~ '[[:cntrl:]]'
       or p_service_content is null
       or char_length(btrim(p_service_content)) not between 1 and 5000
       or translate(btrim(p_service_content), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or p_service_result is null
       or char_length(btrim(p_service_result)) not between 1 and 3000
       or translate(btrim(p_service_result), E'\n\r\t', '') ~ '[[:cntrl:]]'
       or (p_action = 'correct' and (
         v_reason is null or char_length(v_reason) > 1000
         or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
       ))
       or (p_action <> 'correct' and v_reason is not null) then
      raise exception using errcode = '22023', message = 'social-work service content is invalid';
    end if;
  elsif p_occurred_at is not null or p_service_type is not null
        or p_service_content is not null or p_service_result is not null
        or v_reason is not null then
    raise exception using errcode = '22023', message = 'signing must use the exact current draft';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'record_key', p_record_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version,
    'occurred_at', p_occurred_at,
    'service_type', case when p_service_type is null then null else btrim(p_service_type) end,
    'service_content', case when p_service_content is null then null else btrim(p_service_content) end,
    'service_result', case when p_service_result is null then null else btrim(p_service_result) end,
    'correction_reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'social-work-record-operation:' || v_actor::text || ':' ||
    p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.social_work_record_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'social-work record idempotency conflict';
    end if;
    if not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id,
       v_operation.client_id,
       case when p_action in ('sign', 'correct')
         then 'social_work_records.sign' else 'social_work_records.manage' end
     ) then
      raise exception using errcode = '42501', message = 'social-work replay is not permitted';
    end if;
    select version_row.* into strict v_result
    from public.social_work_service_record_versions version_row
    where version_row.id = v_operation.result_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.record_key = v_operation.result_record_key;
    return query select v_operation.id, v_result.record_key, v_result.id,
      v_result.version, v_result.record_state,
      v_operation.result_committed_at, true;
    return;
  end if;

  v_record_key := coalesce(p_record_key, gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(
    'social-work-record-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || v_record_key::text, 0
  ));

  if p_action <> 'create_draft' then
    select version_row.* into v_previous
    from public.social_work_service_record_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.record_key = v_record_key
      and not exists (
        select 1 from public.social_work_service_record_versions child
        where child.previous_version_id = version_row.id
      )
    order by version_row.version desc
    limit 1
    for share;
    if v_previous.id is null
       or v_previous.id <> p_previous_version_id
       or v_previous.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'social-work record version is stale';
    end if;
  end if;

  if p_action = 'create_draft' then
    v_version := 1;
    v_state := 'draft';
    v_author_user_id := v_actor;
    select profile.display_name into v_author_display_name
    from public.profiles profile where profile.id = v_actor and profile.is_active;
    v_occurred_at := p_occurred_at;
    v_service_type := btrim(p_service_type);
    v_service_content := btrim(p_service_content);
    v_service_result := btrim(p_service_result);
  elsif p_action = 'revise_draft' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514', message = 'signed social-work content requires a correction';
    end if;
    v_version := v_previous.version + 1;
    v_state := 'draft';
    v_author_user_id := v_previous.author_user_id;
    v_author_display_name := v_previous.author_display_name;
    v_occurred_at := p_occurred_at;
    v_service_type := btrim(p_service_type);
    v_service_content := btrim(p_service_content);
    v_service_result := btrim(p_service_result);
  elsif p_action = 'sign' then
    if v_previous.record_state <> 'draft' then
      raise exception using errcode = '23514', message = 'only the current draft can be signed';
    end if;
    v_version := v_previous.version + 1;
    v_state := 'signed';
    v_author_user_id := v_previous.author_user_id;
    v_author_display_name := v_previous.author_display_name;
    v_occurred_at := v_previous.occurred_at;
    v_service_type := v_previous.service_type;
    v_service_content := v_previous.service_content;
    v_service_result := v_previous.service_result;
  else
    if v_previous.record_state not in ('signed', 'corrected') then
      raise exception using errcode = '23514', message = 'only signed content can be corrected';
    end if;
    v_version := v_previous.version + 1;
    v_state := 'corrected';
    v_author_user_id := v_previous.author_user_id;
    v_author_display_name := v_previous.author_display_name;
    v_occurred_at := p_occurred_at;
    v_service_type := btrim(p_service_type);
    v_service_content := btrim(p_service_content);
    v_service_result := btrim(p_service_result);
  end if;

  v_now := clock_timestamp();
  if v_occurred_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'future service occurrence is invalid';
  end if;

  if p_action in ('sign', 'correct') then
    v_challenge_id := private.require_social_work_reauth_evidence(v_actor, v_now);
    select profile.display_name into v_signer_display_name
    from public.profiles profile where profile.id = v_actor and profile.is_active;
    select coalesce(array_agg(distinct role.role_key order by role.role_key), '{}'::text[])
      into v_signer_role_keys
    from public.memberships membership
    join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    where membership.profile_id = v_actor
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and (role.organization_id is null or role.organization_id = p_expected_organization_id);
    if v_signer_display_name is null or cardinality(v_signer_role_keys) = 0 then
      raise exception using errcode = '42501', message = 'signer identity could not be verified';
    end if;
  end if;

  if not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'social_work_records.sign' else 'social_work_records.manage' end
     ) then
    raise exception using errcode = '42501', message = 'social-work authority expired';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'record_key', v_record_key, 'version', v_version,
    'previous_version_id', p_previous_version_id, 'record_state', v_state,
    'occurred_at', v_occurred_at, 'service_type', v_service_type,
    'service_content', v_service_content, 'service_result', v_service_result,
    'author_user_id', v_author_user_id, 'correction_reason', v_reason,
    'signed_by', case when v_state = 'draft' then null else v_actor end,
    'signed_at', case when v_state = 'draft' then null else v_now end,
    'signature_purpose', case when v_state = 'signed'
      then '社工服務紀錄簽署' when v_state = 'corrected'
      then '社工服務紀錄更正簽署' else null end
  )::text, 'UTF8')), 'hex');

  insert into public.social_work_service_record_versions (
    organization_id, branch_id, client_id, record_key, version,
    previous_version_id, record_state, occurred_at, service_type,
    service_content, service_result, author_user_id, author_display_name,
    correction_reason, signed_at, signed_by, signer_display_name,
    signer_role_keys, signature_purpose, signature_reauth_challenge_id,
    content_hash, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_record_key, v_version, p_previous_version_id, v_state, v_occurred_at,
    v_service_type, v_service_content, v_service_result, v_author_user_id,
    v_author_display_name, case when v_state = 'corrected' then v_reason else null end,
    case when v_state = 'draft' then null else v_now end,
    case when v_state = 'draft' then null else v_actor end,
    case when v_state = 'draft' then null else v_signer_display_name end,
    case when v_state = 'draft' then null else v_signer_role_keys end,
    case when v_state = 'signed' then '社工服務紀錄簽署'
      when v_state = 'corrected' then '社工服務紀錄更正簽署' else null end,
    v_challenge_id, v_content_hash, v_now
  ) returning * into v_result;

  insert into private.social_work_record_operations (
    organization_id, branch_id, client_id, actor_user_id, operation_kind,
    idempotency_key, request_hash, result_record_key, result_version_id,
    result_version, result_state, result_committed_at, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_action, p_idempotency_key, v_request_hash, v_result.record_key,
    v_result.id, v_result.version, v_result.record_state, v_result.created_at,
    v_challenge_id
  ) returning id into v_operation.id;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when p_action = 'sign' then 'sign'
      when p_action = 'correct' then 'correct' else 'insert' end,
    'social_work_service_record_versions', v_result.id::text,
    p_idempotency_key,
    array['record_state', 'version', 'occurred_at', 'service_type',
      'service_content', 'service_result'],
    jsonb_build_object(
      'workflow', 'page29_social_work_service_v1',
      'record_key', v_result.record_key, 'version', v_result.version,
      'state', v_result.record_state, 'client_id', p_client_id,
      'contains_narrative', true, 'narrative_logged', false
    )
  );

  if not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       case when p_action in ('sign', 'correct')
         then 'social_work_records.sign' else 'social_work_records.manage' end
     )
     or not exists (
       select 1 from public.social_work_service_record_versions version_row
       where version_row.id = v_result.id
         and version_row.organization_id = p_expected_organization_id
         and version_row.branch_id = p_expected_branch_id
         and version_row.client_id = p_client_id
         and version_row.record_key = v_record_key
         and version_row.version = v_version
         and not exists (
           select 1 from public.social_work_service_record_versions child
           where child.previous_version_id = version_row.id
         )
     ) then
    raise exception using errcode = '42501', message = 'social-work final verification failed';
  end if;

  return query select v_operation.id, v_result.record_key, v_result.id,
    v_result.version, v_result.record_state, v_result.created_at, false;
end;
$$;

create or replace function public.create_social_work_service_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_service_type text,
  p_service_content text,
  p_service_result text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, record_key uuid, version_id uuid,
  record_version integer, record_state text, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_social_work_service_record_guarded(
    'create_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, null, null, 0, p_occurred_at, p_service_type,
    p_service_content, p_service_result, null, p_idempotency_key
  );
$$;

create or replace function public.revise_social_work_service_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_occurred_at timestamptz,
  p_service_type text,
  p_service_content text,
  p_service_result text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, record_key uuid, version_id uuid,
  record_version integer, record_state text, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_social_work_service_record_guarded(
    'revise_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_record_key, p_previous_version_id, p_expected_version,
    p_occurred_at, p_service_type, p_service_content, p_service_result,
    null, p_idempotency_key
  );
$$;

create or replace function public.sign_social_work_service_record(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, record_key uuid, version_id uuid,
  record_version integer, record_state text, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_social_work_service_record_guarded(
    'sign', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_record_key, p_previous_version_id, p_expected_version,
    null, null, null, null, null, p_idempotency_key
  );
$$;

create or replace function public.correct_social_work_service_record(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_occurred_at timestamptz,
  p_service_type text,
  p_service_content text,
  p_service_result text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, record_key uuid, version_id uuid,
  record_version integer, record_state text, committed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_social_work_service_record_guarded(
    'correct', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_record_key, p_previous_version_id, p_expected_version,
    p_occurred_at, p_service_type, p_service_content, p_service_result,
    p_correction_reason, p_idempotency_key
  );
$$;

create or replace function private.mutate_social_work_follow_up_guarded(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_service_version_id uuid,
  p_expected_sequence integer,
  p_due_on date,
  p_follow_up_plan text,
  p_follow_up_outcome text,
  p_transition_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  record_key uuid,
  follow_up_event_id uuid,
  follow_up_sequence integer,
  follow_up_status text,
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
  v_request_hash text;
  v_operation private.social_work_follow_up_operations%rowtype;
  v_service public.social_work_service_record_versions%rowtype;
  v_previous public.social_work_follow_up_events%rowtype;
  v_result public.social_work_follow_up_events%rowtype;
  v_status text;
  v_committer_display_name text;
  v_plan text := nullif(btrim(p_follow_up_plan), '');
  v_outcome text := nullif(btrim(p_follow_up_outcome), '');
  v_reason text := nullif(btrim(p_transition_reason), '');
  v_content_hash text;
begin
  if p_action not in ('track', 'complete_follow_up', 'cancel_follow_up')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_record_key is null
     or p_service_version_id is null or p_idempotency_key is null
     or p_expected_sequence is null or p_expected_sequence < 0
     or not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.manage'
     )
     or not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501', message = 'social-work follow-up operation is not permitted';
  end if;

  if (
      p_action = 'track'
      and (
        p_due_on is null or extract(year from p_due_on) not between 2000 and 2200
        or v_plan is null or char_length(v_plan) > 2000
        or translate(v_plan, E'\n\r\t', '') ~ '[[:cntrl:]]'
        or v_outcome is not null or v_reason is not null
      )
    ) or (
      p_action = 'complete_follow_up'
      and (
        p_due_on is not null or v_plan is not null or v_outcome is null
        or char_length(v_outcome) > 2000
        or translate(v_outcome, E'\n\r\t', '') ~ '[[:cntrl:]]'
        or v_reason is not null
      )
    ) or (
      p_action = 'cancel_follow_up'
      and (
        p_due_on is not null or v_plan is not null or v_outcome is not null
        or v_reason is null or char_length(v_reason) > 1000
        or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
      )
    ) then
    raise exception using errcode = '22023', message = 'social-work follow-up content is invalid';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'record_key', p_record_key, 'service_version_id', p_service_version_id,
    'expected_sequence', p_expected_sequence, 'due_on', p_due_on,
    'follow_up_plan', v_plan, 'follow_up_outcome', v_outcome,
    'transition_reason', v_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'social-work-follow-up-operation:' || v_actor::text || ':' ||
    p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.social_work_follow_up_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if v_operation.id is not null then
    if v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'social-work follow-up idempotency conflict';
    end if;
    if not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id,
       v_operation.client_id, 'social_work_records.manage'
     ) then
      raise exception using errcode = '42501', message = 'social-work follow-up replay is not permitted';
    end if;
    select event.* into strict v_result
    from public.social_work_follow_up_events event
    where event.id = v_operation.result_event_id
      and event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.client_id = p_client_id
      and event.record_key = p_record_key;
    return query select v_operation.id, v_result.record_key, v_result.id,
      v_result.sequence, v_result.follow_up_status,
      v_operation.result_committed_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'social-work-record-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_record_key::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'social-work-follow-up-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_record_key::text, 0
  ));

  select version_row.* into v_service
  from public.social_work_service_record_versions version_row
  where version_row.id = p_service_version_id
    and version_row.organization_id = p_expected_organization_id
    and version_row.branch_id = p_expected_branch_id
    and version_row.client_id = p_client_id
    and version_row.record_key = p_record_key
    and version_row.record_state in ('signed', 'corrected')
    and not exists (
      select 1 from public.social_work_service_record_versions child
      where child.previous_version_id = version_row.id
    )
  for share;
  if v_service.id is null then
    raise exception using errcode = '40001', message = 'signed service record version is stale';
  end if;

  select event.* into v_previous
  from public.social_work_follow_up_events event
  where event.organization_id = p_expected_organization_id
    and event.branch_id = p_expected_branch_id
    and event.client_id = p_client_id
    and event.record_key = p_record_key
  order by event.sequence desc
  limit 1
  for share;
  if coalesce(v_previous.sequence, 0) <> p_expected_sequence then
    raise exception using errcode = '40001', message = 'social-work follow-up version is stale';
  end if;
  if p_action = 'track' and v_previous.follow_up_status = 'pending' then
    raise exception using errcode = '23514', message = 'an open social-work follow-up already exists';
  end if;
  if p_action in ('complete_follow_up', 'cancel_follow_up')
     and coalesce(v_previous.follow_up_status, '') <> 'pending' then
    raise exception using errcode = '23514', message = 'no open social-work follow-up exists';
  end if;

  select profile.display_name into v_committer_display_name
  from public.profiles profile where profile.id = v_actor and profile.is_active;
  if v_committer_display_name is null then
    raise exception using errcode = '42501', message = 'social-work committer identity is invalid';
  end if;
  if not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.manage'
     ) then
    raise exception using errcode = '42501', message = 'social-work follow-up authority expired';
  end if;

  v_now := clock_timestamp();
  v_status := case p_action when 'track' then 'pending'
    when 'complete_follow_up' then 'completed' else 'cancelled' end;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'record_key', p_record_key, 'service_version_id', p_service_version_id,
    'sequence', p_expected_sequence + 1, 'previous_event_id', v_previous.id,
    'follow_up_status', v_status, 'due_on', p_due_on,
    'follow_up_plan', v_plan, 'follow_up_outcome', v_outcome,
    'transition_reason', v_reason, 'committed_by', v_actor,
    'committed_at', v_now
  )::text, 'UTF8')), 'hex');

  insert into public.social_work_follow_up_events (
    organization_id, branch_id, client_id, record_key, service_version_id,
    sequence, previous_event_id, follow_up_status, due_on, follow_up_plan,
    follow_up_outcome, transition_reason, committed_by,
    committer_display_name, committed_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_record_key, p_service_version_id, p_expected_sequence + 1,
    v_previous.id, v_status, case when v_status = 'pending' then p_due_on else null end,
    case when v_status = 'pending' then v_plan else null end,
    case when v_status = 'completed' then v_outcome else null end,
    case when v_status = 'cancelled' then v_reason else null end,
    v_actor, v_committer_display_name, v_now, v_content_hash
  ) returning * into v_result;

  insert into private.social_work_follow_up_operations (
    organization_id, branch_id, client_id, actor_user_id, operation_kind,
    idempotency_key, request_hash, result_record_key, result_event_id,
    result_sequence, result_status, result_committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_action, p_idempotency_key, v_request_hash, p_record_key, v_result.id,
    v_result.sequence, v_result.follow_up_status, v_result.committed_at
  ) returning id into v_operation.id;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'insert',
    'social_work_follow_up_events', v_result.id::text, p_idempotency_key,
    array['follow_up_status', 'due_on', 'follow_up_plan',
      'follow_up_outcome', 'transition_reason'],
    jsonb_build_object(
      'workflow', 'page29_social_work_follow_up_v1',
      'record_key', p_record_key, 'sequence', v_result.sequence,
      'status', v_result.follow_up_status, 'client_id', p_client_id,
      'contains_narrative', true, 'narrative_logged', false,
      'notification_sent', false
    )
  );

  if not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.manage'
     )
     or not exists (
       select 1 from public.social_work_follow_up_events event
       where event.id = v_result.id
         and event.organization_id = p_expected_organization_id
         and event.branch_id = p_expected_branch_id
         and event.client_id = p_client_id
         and event.record_key = p_record_key
         and event.sequence = v_result.sequence
         and not exists (
           select 1 from public.social_work_follow_up_events child
           where child.previous_event_id = event.id
         )
     ) then
    raise exception using errcode = '42501', message = 'social-work follow-up final verification failed';
  end if;

  return query select v_operation.id, v_result.record_key, v_result.id,
    v_result.sequence, v_result.follow_up_status, v_result.committed_at, false;
end;
$$;

create or replace function public.mutate_social_work_follow_up(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_record_key uuid,
  p_service_version_id uuid,
  p_expected_sequence integer,
  p_due_on date,
  p_follow_up_plan text,
  p_follow_up_outcome text,
  p_transition_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, record_key uuid, follow_up_event_id uuid,
  follow_up_sequence integer, follow_up_status text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mutate_social_work_follow_up_guarded(
    p_action, p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_record_key, p_service_version_id, p_expected_sequence, p_due_on,
    p_follow_up_plan, p_follow_up_outcome, p_transition_reason,
    p_idempotency_key
  );
$$;

create or replace function private.social_work_service_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_service_type text,
  p_author_user_id uuid,
  p_client_id uuid,
  p_reference_time timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with terminal_visible as materialized (
    select version_row.*
    from public.social_work_service_record_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and private.can_staff_access_client(version_row.client_id, 'clients.read')
      and private.can_staff_access_client(
        version_row.client_id, 'social_work_records.read'
      )
      and not exists (
        select 1 from public.social_work_service_record_versions child
        where child.previous_version_id = version_row.id
      )
  ), latest_follow_up as materialized (
    select distinct on (event.record_key) event.*
    from public.social_work_follow_up_events event
    join terminal_visible version_row
      on version_row.record_key = event.record_key
     and version_row.client_id = event.client_id
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    order by event.record_key, event.sequence desc
  ), matching as materialized (
    select version_row.*, client.display_name as client_display_name,
      follow_up.id as follow_up_event_id,
      coalesce(follow_up.sequence, 0) as follow_up_sequence,
      follow_up.follow_up_status,
      follow_up.due_on as follow_up_due_on,
      follow_up.follow_up_plan,
      follow_up.follow_up_outcome,
      follow_up.transition_reason as follow_up_transition_reason,
      follow_up.committer_display_name as follow_up_committer_display_name,
      follow_up.committed_at as follow_up_committed_at,
      coalesce(
        follow_up.follow_up_status = 'pending'
        and follow_up.due_on < (p_reference_time at time zone 'Asia/Taipei')::date,
        false
      ) as follow_up_overdue
    from terminal_visible version_row
    join public.clients client on client.id = version_row.client_id
    left join latest_follow_up follow_up
      on follow_up.record_key = version_row.record_key
    where (p_date_from is null or
      (version_row.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (version_row.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (p_service_type is null or version_row.service_type = p_service_type)
      and (p_author_user_id is null or
        version_row.author_user_id = p_author_user_id)
      and (p_client_id is null or version_row.client_id = p_client_id)
  ), limited as materialized (
    select * from matching
    order by occurred_at desc, record_key, version desc
    limit 200
  ), records_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'record_key', version_row.record_key,
      'version_id', version_row.id,
      'record_version', version_row.version,
      'record_state', version_row.record_state,
      'client_id', version_row.client_id,
      'client_display_name', version_row.client_display_name,
      'occurred_at', version_row.occurred_at,
      'service_type', version_row.service_type,
      'service_content', version_row.service_content,
      'service_result', version_row.service_result,
      'author_user_id', version_row.author_user_id,
      'author_display_name', version_row.author_display_name,
      'correction_reason', version_row.correction_reason,
      'signed_at', version_row.signed_at,
      'signer_display_name', version_row.signer_display_name,
      'created_at', version_row.created_at,
      'follow_up_event_id', version_row.follow_up_event_id,
      'follow_up_sequence', version_row.follow_up_sequence,
      'follow_up_status', version_row.follow_up_status,
      'follow_up_due_on', version_row.follow_up_due_on,
      'follow_up_plan', version_row.follow_up_plan,
      'follow_up_outcome', version_row.follow_up_outcome,
      'follow_up_transition_reason', version_row.follow_up_transition_reason,
      'follow_up_committer_display_name',
        version_row.follow_up_committer_display_name,
      'follow_up_committed_at', version_row.follow_up_committed_at,
      'follow_up_overdue', version_row.follow_up_overdue,
      'version_history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version_id', history.id,
          'record_version', history.version,
          'record_state', history.record_state,
          'occurred_at', history.occurred_at,
          'service_type', history.service_type,
          'service_content', history.service_content,
          'service_result', history.service_result,
          'correction_reason', history.correction_reason,
          'author_display_name', history.author_display_name,
          'signed_at', history.signed_at,
          'signer_display_name', history.signer_display_name,
          'created_at', history.created_at
        ) order by history.version)
        from (
          select history.*
          from public.social_work_service_record_versions history
          where history.organization_id = p_expected_organization_id
            and history.branch_id = p_expected_branch_id
            and history.client_id = version_row.client_id
            and history.record_key = version_row.record_key
          order by history.version
          limit 50
        ) history
      ), '[]'::jsonb),
      'version_history_total', (
        select count(*) from public.social_work_service_record_versions history
        where history.organization_id = p_expected_organization_id
          and history.branch_id = p_expected_branch_id
          and history.client_id = version_row.client_id
          and history.record_key = version_row.record_key
      ),
      'follow_up_history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'event_id', history.id,
          'sequence', history.sequence,
          'follow_up_status', history.follow_up_status,
          'due_on', history.due_on,
          'follow_up_plan', history.follow_up_plan,
          'follow_up_outcome', history.follow_up_outcome,
          'transition_reason', history.transition_reason,
          'committer_display_name', history.committer_display_name,
          'committed_at', history.committed_at
        ) order by history.sequence)
        from (
          select history.*
          from public.social_work_follow_up_events history
          where history.organization_id = p_expected_organization_id
            and history.branch_id = p_expected_branch_id
            and history.client_id = version_row.client_id
            and history.record_key = version_row.record_key
          order by history.sequence
          limit 50
        ) history
      ), '[]'::jsonb),
      'follow_up_history_total', (
        select count(*) from public.social_work_follow_up_events history
        where history.organization_id = p_expected_organization_id
          and history.branch_id = p_expected_branch_id
          and history.client_id = version_row.client_id
          and history.record_key = version_row.record_key
      )
    ) order by version_row.occurred_at desc, version_row.record_key,
      version_row.version desc), '[]'::jsonb) as records
    from limited version_row
  ), client_candidates as materialized (
    select client.id as client_id, client.display_name,
      client.status::text as client_status, client.admitted_on, client.ended_on
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'social_work_records.read')
  ), client_result as (
    select count(*)::bigint as client_total,
      coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', selected.client_id,
        'display_name', selected.display_name,
        'client_status', selected.client_status,
        'admitted_on', selected.admitted_on,
        'ended_on', selected.ended_on
      ) order by selected.display_name collate "C", selected.client_id)
      from (
        select * from client_candidates
        order by display_name collate "C", client_id limit 200
      ) selected), '[]'::jsonb) as client_options
    from client_candidates
  ), service_type_candidates as materialized (
    select distinct service_type from terminal_visible
  ), service_type_result as (
    select count(*)::bigint as service_type_total,
      coalesce((select jsonb_agg(selected.service_type
        order by selected.service_type collate "C")
      from (
        select service_type from service_type_candidates
        order by service_type collate "C" limit 200
      ) selected), '[]'::jsonb) as service_type_options
    from service_type_candidates
  ), author_candidates as materialized (
    select distinct author_user_id, author_display_name from terminal_visible
  ), author_result as (
    select count(*)::bigint as author_total,
      coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', selected.author_user_id,
        'display_name', selected.author_display_name
      ) order by selected.author_display_name collate "C", selected.author_user_id)
      from (
        select * from author_candidates
        order by author_display_name collate "C", author_user_id limit 200
      ) selected), '[]'::jsonb) as author_options
    from author_candidates
  ), stats as (
    select count(*)::bigint as matching_total,
      count(*) filter (
        where date_trunc('month', occurred_at at time zone 'Asia/Taipei') =
          date_trunc('month', p_reference_time at time zone 'Asia/Taipei')
      )::bigint as current_month_total,
      count(*) filter (where follow_up_status = 'pending')::bigint
        as pending_follow_up_total,
      count(*) filter (where follow_up_overdue)::bigint
        as overdue_follow_up_total,
      count(*) filter (where record_state = 'draft')::bigint as draft_total,
      count(*) filter (where record_state in ('signed', 'corrected'))::bigint
        as signed_total
    from matching
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'records', records_result.records,
    'record_total', jsonb_array_length(records_result.records),
    'matching_total', stats.matching_total,
    'records_truncated',
      stats.matching_total > jsonb_array_length(records_result.records),
    'current_month_total', stats.current_month_total,
    'pending_follow_up_total', stats.pending_follow_up_total,
    'overdue_follow_up_total', stats.overdue_follow_up_total,
    'draft_total', stats.draft_total,
    'signed_total', stats.signed_total,
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated',
      client_result.client_total > jsonb_array_length(client_result.client_options),
    'service_type_options', service_type_result.service_type_options,
    'service_type_total', service_type_result.service_type_total,
    'service_type_options_truncated', service_type_result.service_type_total >
      jsonb_array_length(service_type_result.service_type_options),
    'author_options', author_result.author_options,
    'author_total', author_result.author_total,
    'author_options_truncated', author_result.author_total >
      jsonb_array_length(author_result.author_options),
    'offline_sync_status', 'not_configured',
    'follow_up_notification_status', 'none_not_sent'
  )
  from records_result cross join stats cross join client_result
  cross join service_type_result cross join author_result;
$$;

create or replace function private.social_work_service_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date,
  p_date_to date,
  p_service_type text,
  p_author_user_id uuid,
  p_client_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  records jsonb,
  record_total integer,
  matching_total bigint,
  records_truncated boolean,
  current_month_total bigint,
  pending_follow_up_total bigint,
  overdue_follow_up_total bigint,
  draft_total bigint,
  signed_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  service_type_options jsonb,
  service_type_total bigint,
  service_type_options_truncated boolean,
  author_options jsonb,
  author_total bigint,
  author_options_truncated boolean,
  offline_sync_status text,
  follow_up_notification_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_type text := nullif(btrim(p_service_type), '');
  v_bundle jsonb;
  v_after jsonb;
  v_fingerprint text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or (v_type is not null and (
       char_length(v_type) > 120 or v_type ~ '[[:cntrl:]]'
     ))
     or not private.social_work_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501', message = 'social-work snapshot is not permitted';
  end if;

  if p_client_id is not null and not private.social_work_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'social_work_records.read'
     ) then
    raise exception using errcode = '42501', message = 'social-work client filter is not permitted';
  end if;

  v_bundle := private.social_work_service_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    v_type, p_author_user_id, p_client_id, v_now
  );
  v_fingerprint := encode(sha256(convert_to(v_bundle::text, 'UTF8')), 'hex');

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'social_work_service_record_versions', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page29_social_work_service_v1',
      'record_count', (v_bundle ->> 'record_total')::integer,
      'matching_total', (v_bundle ->> 'matching_total')::bigint,
      'records_truncated', (v_bundle ->> 'records_truncated')::boolean,
      'record_limit', 200,
      'snapshot_fingerprint', v_fingerprint,
      'filter_values_logged', false,
      'narrative_logged', false
    )
  );

  v_after := private.social_work_service_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    v_type, p_author_user_id, p_client_id, v_now
  );
  if not private.social_work_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'social_work_records.read'
     ) or v_after is distinct from v_bundle then
    raise exception using errcode = '42501', message = 'social-work snapshot final verification failed';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    v_bundle -> 'records',
    (v_bundle ->> 'record_total')::integer,
    (v_bundle ->> 'matching_total')::bigint,
    (v_bundle ->> 'records_truncated')::boolean,
    (v_bundle ->> 'current_month_total')::bigint,
    (v_bundle ->> 'pending_follow_up_total')::bigint,
    (v_bundle ->> 'overdue_follow_up_total')::bigint,
    (v_bundle ->> 'draft_total')::bigint,
    (v_bundle ->> 'signed_total')::bigint,
    v_bundle -> 'client_options',
    (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'client_options_truncated')::boolean,
    v_bundle -> 'service_type_options',
    (v_bundle ->> 'service_type_total')::bigint,
    (v_bundle ->> 'service_type_options_truncated')::boolean,
    v_bundle -> 'author_options',
    (v_bundle ->> 'author_total')::bigint,
    (v_bundle ->> 'author_options_truncated')::boolean,
    v_bundle ->> 'offline_sync_status',
    v_bundle ->> 'follow_up_notification_status';
end;
$$;

create or replace function public.social_work_service_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_service_type text default null,
  p_author_user_id uuid default null,
  p_client_id uuid default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  records jsonb,
  record_total integer,
  matching_total bigint,
  records_truncated boolean,
  current_month_total bigint,
  pending_follow_up_total bigint,
  overdue_follow_up_total bigint,
  draft_total bigint,
  signed_total bigint,
  client_options jsonb,
  client_total bigint,
  client_options_truncated boolean,
  service_type_options jsonb,
  service_type_total bigint,
  service_type_options_truncated boolean,
  author_options jsonb,
  author_total bigint,
  author_options_truncated boolean,
  offline_sync_status text,
  follow_up_notification_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.social_work_service_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_date_from, p_date_to,
    p_service_type, p_author_user_id, p_client_id
  );
$$;

create policy social_work_service_versions_staff_select
on public.social_work_service_record_versions for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'social_work_records.read')
);

create policy social_work_follow_up_events_staff_select
on public.social_work_follow_up_events for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'social_work_records.read')
);

revoke all on function private.social_work_history_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.social_work_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.social_work_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_social_work_reauth_evidence(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_social_work_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.social_work_service_snapshot_bundle(uuid,uuid,date,date,text,uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.create_social_work_service_draft(uuid,uuid,uuid,timestamptz,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_social_work_service_draft(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sign_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mutate_social_work_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.social_work_service_snapshot(uuid,uuid,date,date,text,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_social_work_service_draft(uuid,uuid,uuid,timestamptz,text,text,text,uuid)
  to authenticated;
grant execute on function public.revise_social_work_service_draft(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,uuid)
  to authenticated;
grant execute on function public.sign_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function public.correct_social_work_service_record(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.mutate_social_work_follow_up(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  to authenticated;
grant execute on function public.social_work_service_snapshot(uuid,uuid,date,date,text,uuid,uuid)
  to authenticated;

-- SECURITY INVOKER wrappers require these exact private entrypoints, but the
-- private schema is not exposed by PostgREST and all entrypoints re-authorize.
grant execute on function private.mutate_social_work_service_record_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,text,text,text,uuid)
  to authenticated;
grant execute on function private.mutate_social_work_follow_up_guarded(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  to authenticated;
grant execute on function private.social_work_service_snapshot_response(uuid,uuid,date,date,text,uuid,uuid)
  to authenticated;
