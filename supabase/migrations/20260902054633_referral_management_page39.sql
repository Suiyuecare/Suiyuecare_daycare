-- Page 39: immutable, branch/client-scoped referral management.
-- Submission and manual receipt registration are internal workflow evidence.
-- External delivery, receiving-unit directory, attachments, export and providers
-- remain fail-closed and are never represented as configured or delivered.

insert into public.permissions (permission_key, description, risk_level) values
  ('referral_management.read', 'Read assigned referral management snapshots', 1),
  ('referral_management.create', 'Create referral drafts', 3),
  ('referral_management.submit', 'Freeze and submit referral workflow versions', 3),
  ('referral_management.receive', 'Register manual referral receipt evidence', 3),
  ('referral_management.respond', 'Record referral responses', 3),
  ('referral_management.close', 'Close responded referrals', 3),
  ('referral_management.correct', 'Append narrow referral corrections', 3)
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
    'referral_management.read', 'referral_management.create',
    'referral_management.respond'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker'
  )
  and permission.permission_key in (
    'referral_management.submit', 'referral_management.receive',
    'referral_management.close', 'referral_management.correct'
  )
on conflict (role_id, permission_id) do nothing;

create table public.referral_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  referral_key uuid not null,
  sequence integer not null,
  previous_event_id uuid,
  corrects_event_id uuid,
  event_kind text not null,
  client_id uuid not null,
  client_display_name text not null,
  client_code text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  owner_membership_id uuid not null references public.memberships(id) on delete restrict,
  owner_display_name text not null,
  receiving_unit_state text not null,
  receiving_unit_code text,
  receiving_unit_name text,
  receiving_unit_directory_status text not null,
  referral_date timestamptz not null,
  referral_reason text not null,
  entry_content text,
  correction_reason text,
  status text not null,
  occurred_at timestamptz not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_display_name text not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint referral_events_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint referral_events_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint referral_events_id_scope_key
    unique (id, organization_id, branch_id, referral_key),
  constraint referral_events_stream_key
    unique (organization_id, branch_id, referral_key, sequence),
  constraint referral_events_previous_key unique (previous_event_id),
  constraint referral_events_previous_scope_fkey
    foreign key (previous_event_id, organization_id, branch_id, referral_key)
    references public.referral_events (
      id, organization_id, branch_id, referral_key
    ) on delete restrict,
  constraint referral_events_correction_scope_fkey
    foreign key (corrects_event_id, organization_id, branch_id, referral_key)
    references public.referral_events (
      id, organization_id, branch_id, referral_key
    ) on delete restrict,
  constraint referral_events_lineage_check check (
    sequence > 0 and (
      (sequence = 1 and previous_event_id is null and event_kind = 'created')
      or (sequence > 1 and previous_event_id is not null and event_kind in (
        'submitted', 'receipt_registered', 'response_recorded', 'closed', 'corrected'
      ))
    )
  ),
  constraint referral_events_correction_check check (
    (event_kind = 'corrected') = (corrects_event_id is not null)
    and (event_kind = 'corrected') = (correction_reason is not null)
  ),
  constraint referral_events_receiving_unit_check check (
    receiving_unit_state in ('manual_unstandardized', 'missing', 'not_applicable')
    and receiving_unit_directory_status = 'not_configured'
    and (receiving_unit_code is null) = (receiving_unit_name is null)
    and (receiving_unit_state = 'manual_unstandardized') = (receiving_unit_code is not null)
    and (receiving_unit_code is null or (
      char_length(receiving_unit_code) between 1 and 40
      and receiving_unit_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
    ))
    and (receiving_unit_name is null or (
      char_length(receiving_unit_name) between 1 and 160
      and receiving_unit_name !~ '[[:cntrl:]]'
    ))
  ),
  constraint referral_events_status_check check (
    status in ('draft', 'submitted', 'received', 'responded', 'closed')
    and (event_kind <> 'created' or status = 'draft')
    and (event_kind <> 'submitted' or status = 'submitted')
    and (event_kind <> 'receipt_registered' or status = 'received')
    and (event_kind <> 'response_recorded' or status = 'responded')
    and (event_kind <> 'closed' or status = 'closed')
  ),
  constraint referral_events_entry_check check (
    (event_kind <> 'created' or entry_content is null)
    and (event_kind not in ('receipt_registered', 'response_recorded', 'closed', 'corrected')
      or entry_content is not null)
  ),
  constraint referral_events_text_check check (
    char_length(client_display_name) between 1 and 120
    and client_display_name !~ '[[:cntrl:]]'
    and char_length(client_code) between 1 and 80
    and client_code !~ '[[:cntrl:]]'
    and char_length(owner_display_name) between 1 and 120
    and owner_display_name !~ '[[:cntrl:]]'
    and char_length(referral_reason) between 2 and 2000
    and translate(referral_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    and (entry_content is null or (
      char_length(entry_content) between 2 and 4000
      and translate(entry_content, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
    and (correction_reason is null or (
      char_length(correction_reason) between 2 and 500
      and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    ))
    and char_length(actor_display_name) between 1 and 120
    and actor_display_name !~ '[[:cntrl:]]'
  ),
  constraint referral_events_time_check check (
    extract(year from referral_date at time zone 'Asia/Taipei') between 2000 and 2200
    and extract(year from occurred_at at time zone 'Asia/Taipei') between 2000 and 2200
    and occurred_at >= referral_date - interval '1 minute'
  ),
  constraint referral_events_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.referral_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  referral_key uuid not null,
  source_event_id uuid not null,
  source_sequence integer not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_membership_id uuid not null references public.memberships(id) on delete restrict,
  recipient_display_name text not null,
  recipient_reasons text[] not null,
  channel text not null,
  queue_status text not null,
  delivery_claim text not null,
  provider_status text not null,
  external_delivery_status text not null,
  queued_at timestamptz not null,
  correlation_id uuid not null,
  content_hash text not null,
  constraint referral_outbox_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint referral_outbox_event_scope_fkey
    foreign key (source_event_id, organization_id, branch_id, referral_key)
    references public.referral_events (
      id, organization_id, branch_id, referral_key
    ) on delete restrict,
  constraint referral_outbox_recipient_key unique (source_event_id, recipient_user_id),
  constraint referral_outbox_correlation_key unique (organization_id, correlation_id),
  constraint referral_outbox_boundary_check check (
    source_sequence > 0 and channel = 'in_app' and queue_status = 'queued'
    and delivery_claim = 'no_external_delivery_claim'
    and provider_status = 'not_configured'
    and external_delivery_status = 'not_configured'
    and cardinality(recipient_reasons) between 1 and 2
    and recipient_reasons <@ array['actor', 'owner']::text[]
  ),
  constraint referral_outbox_text_check check (
    char_length(recipient_display_name) between 1 and 120
    and recipient_display_name !~ '[[:cntrl:]]'
    and content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table private.referral_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_referral_key uuid not null,
  result_event_id uuid not null,
  result_sequence integer not null,
  previous_event_id uuid,
  result_status text not null,
  result_receiving_unit_state text not null,
  notification_count integer not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  committed_at timestamptz not null,
  constraint referral_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint referral_operations_result_scope_fkey
    foreign key (result_event_id, organization_id, branch_id, result_referral_key)
    references public.referral_events (
      id, organization_id, branch_id, referral_key
    ) on delete restrict,
  constraint referral_operations_previous_scope_fkey
    foreign key (previous_event_id, organization_id, branch_id, result_referral_key)
    references public.referral_events (
      id, organization_id, branch_id, referral_key
    ) on delete restrict,
  constraint referral_operations_check check (
    operation_kind in ('create', 'submit', 'register_received', 'respond', 'close', 'correct')
    and request_hash ~ '^[a-f0-9]{64}$'
    and result_sequence > 0
    and result_status in ('draft', 'submitted', 'received', 'responded', 'closed')
    and result_receiving_unit_state in ('manual_unstandardized', 'missing', 'not_applicable')
    and notification_count between 1 and 2
  )
);

create index referral_events_scope_idx
  on public.referral_events (organization_id, branch_id, referral_key, sequence desc);
create index referral_events_branch_idx
  on public.referral_events (branch_id, organization_id);
create index referral_events_client_idx
  on public.referral_events (client_id, organization_id, branch_id);
create index referral_events_previous_idx
  on public.referral_events (previous_event_id) where previous_event_id is not null;
create index referral_events_corrects_idx
  on public.referral_events (corrects_event_id) where corrects_event_id is not null;
create index referral_events_owner_idx
  on public.referral_events (owner_user_id, occurred_at desc);
create index referral_events_owner_membership_idx
  on public.referral_events (owner_membership_id);
create index referral_events_actor_idx
  on public.referral_events (actor_user_id, occurred_at desc);
create index referral_events_reauth_idx
  on public.referral_events (reauth_challenge_id);
create index referral_events_filter_idx
  on public.referral_events (organization_id, branch_id, status, occurred_at desc);
create index referral_outbox_scope_idx
  on public.referral_notification_outbox (
    organization_id, branch_id, referral_key, source_sequence desc
  );
create index referral_outbox_branch_idx
  on public.referral_notification_outbox (branch_id, organization_id);
create index referral_outbox_source_idx
  on public.referral_notification_outbox (source_event_id);
create index referral_outbox_recipient_idx
  on public.referral_notification_outbox (recipient_user_id, queued_at desc);
create index referral_outbox_membership_idx
  on public.referral_notification_outbox (recipient_membership_id);
create index referral_operations_scope_idx
  on private.referral_operations (
    organization_id, branch_id, result_referral_key, committed_at desc
  );
create index referral_operations_actor_idx
  on private.referral_operations (actor_user_id);
create index referral_operations_result_idx
  on private.referral_operations (result_event_id);
create index referral_operations_previous_idx
  on private.referral_operations (previous_event_id) where previous_event_id is not null;
create index referral_operations_reauth_idx
  on private.referral_operations (reauth_challenge_id);

alter table public.referral_events enable row level security;
alter table public.referral_events force row level security;
alter table public.referral_notification_outbox enable row level security;
alter table public.referral_notification_outbox force row level security;
alter table private.referral_operations enable row level security;
alter table private.referral_operations force row level security;

revoke all on table public.referral_events from public, anon, authenticated, service_role;
revoke all on table public.referral_notification_outbox from public, anon, authenticated, service_role;
revoke all on table private.referral_operations from public, anon, authenticated, service_role;

create or replace function private.prevent_referral_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger referral_events_prevent_mutation
before update or delete on public.referral_events
for each row execute function private.prevent_referral_mutation();
create trigger referral_notification_outbox_prevent_mutation
before update or delete on public.referral_notification_outbox
for each row execute function private.prevent_referral_mutation();
create trigger referral_operations_prevent_mutation
before update or delete on private.referral_operations
for each row execute function private.prevent_referral_mutation();
create trigger referral_events_audit_row_change
after insert on public.referral_events
for each row execute function private.audit_row_change();
create trigger referral_notification_outbox_audit_row_change
after insert on public.referral_notification_outbox
for each row execute function private.audit_row_change();

create or replace function private.referral_management_authority(
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

create or replace function private.referral_management_user_has_permission(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_permission text,
  p_reference_time timestamptz
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    join public.membership_roles membership_role on membership_role.membership_id = membership.id
    join public.roles role on role.id = membership_role.role_id and role.is_active
    join public.role_permissions role_permission on role_permission.role_id = role.id
    join public.permissions permission on permission.id = role_permission.permission_id
    where profile.id = p_user_id and profile.is_active
      and profile.kind in ('staff', 'professional')
      and membership.organization_id = p_organization_id
      and membership.status = 'active'
      and membership.starts_at <= p_reference_time
      and (membership.ends_at is null or membership.ends_at > p_reference_time)
      and (membership.branch_id is null or membership.branch_id = p_branch_id)
      and (role.organization_id is null or role.organization_id = p_organization_id)
      and permission.permission_key = p_permission
  );
$$;

create or replace function private.referral_management_staff_snapshot(
  p_organization_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_permission text,
  p_client_id uuid,
  p_reference_time timestamptz
)
returns table(membership_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select membership.id, btrim(profile.display_name)
  from public.profiles profile
  join public.memberships membership on membership.profile_id = profile.id
  where profile.id = p_user_id and profile.is_active
    and profile.kind in ('staff', 'professional')
    and membership.organization_id = p_organization_id
    and membership.status = 'active'
    and membership.starts_at <= p_reference_time
    and (membership.ends_at is null or membership.ends_at > p_reference_time)
    and (membership.branch_id is null or membership.branch_id = p_branch_id)
    and private.referral_management_user_has_permission(
      p_organization_id, p_branch_id, p_user_id, p_permission, p_reference_time
    )
    and private.referral_management_user_has_permission(
      p_organization_id, p_branch_id, p_user_id, 'clients.read', p_reference_time
    )
    and (
      p_client_id is null
      or p_user_id = auth.uid() and private.can_staff_access_client(p_client_id, 'clients.read')
    )
  order by (membership.branch_id = p_branch_id) desc, membership.id
  limit 1;
$$;

create or replace function private.require_referral_management_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'current same-session referral AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'current same-session referral AAL2 evidence is required';
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
  order by challenge.factor_verified_at desc, challenge.id desc limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501',
      message = 'current same-session referral AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.mutate_referral_management_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_referral_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_client_id uuid,
  p_receiving_unit_state text,
  p_receiving_unit_code text,
  p_receiving_unit_name text,
  p_referral_date timestamptz,
  p_referral_reason text,
  p_entry_content text,
  p_correction_reason text,
  p_corrects_event_id uuid,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid,
  operation_id uuid, operation_kind text, referral_key uuid,
  event_id uuid, event_sequence integer, previous_event_id uuid,
  event_kind text, referral_status text, receiving_unit_state text,
  notification_count integer, notification_queue_status text,
  notification_provider_status text, external_delivery_status text,
  delivery_claim text, attachment_status text, export_status text,
  committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_action text := nullif(btrim(p_action), '');
  v_permission text;
  v_unit_state text := nullif(btrim(p_receiving_unit_state), '');
  v_unit_code text := nullif(btrim(p_receiving_unit_code), '');
  v_unit_name text := nullif(btrim(p_receiving_unit_name), '');
  v_referral_reason text := nullif(btrim(p_referral_reason), '');
  v_entry_content text := nullif(btrim(p_entry_content), '');
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_request_hash text; v_content_hash text; v_reauth uuid;
  v_operation_id uuid := gen_random_uuid();
  v_key uuid := coalesce(p_referral_key, gen_random_uuid());
  v_event_id uuid := gen_random_uuid();
  v_sequence integer; v_event_kind text; v_status text;
  v_client_id uuid; v_client_name text; v_client_code text;
  v_owner_user_id uuid; v_owner_membership_id uuid; v_owner_name text;
  v_actor_membership_id uuid; v_actor_name text;
  v_referral_date timestamptz;
  v_notification_count integer := 0;
  v_previous public.referral_events%rowtype;
  v_target public.referral_events%rowtype;
  v_operation private.referral_operations%rowtype;
begin
  if v_action not in ('create', 'submit', 'register_received', 'respond', 'close', 'correct')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'referral operation fields are invalid';
  end if;
  v_permission := case v_action
    when 'create' then 'referral_management.create'
    when 'submit' then 'referral_management.submit'
    when 'register_received' then 'referral_management.receive'
    when 'respond' then 'referral_management.respond'
    when 'close' then 'referral_management.close'
    else 'referral_management.correct' end;
  if not private.referral_management_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, true
  ) or not private.has_permission(
    p_expected_organization_id, p_expected_branch_id, 'clients.read'
  ) then
    raise exception using errcode = '42501', message = 'referral operation is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor', v_actor, 'action', v_action,
    'referral_key', p_referral_key, 'previous_event_id', p_previous_event_id,
    'expected_sequence', p_expected_sequence, 'client_id', p_client_id,
    'receiving_unit_state', v_unit_state, 'receiving_unit_code', v_unit_code,
    'receiving_unit_name', v_unit_name, 'referral_date', p_referral_date,
    'referral_reason', v_referral_reason, 'entry_content', v_entry_content,
    'correction_reason', v_correction_reason, 'corrects_event_id', p_corrects_event_id
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'referral-management-operation:' || v_actor::text || ':' || p_idempotency_key::text, 39
  ));
  select operation.* into v_operation
  from private.referral_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.operation_kind <> v_action
       or v_operation.request_hash <> v_request_hash
       or (p_referral_key is not null and v_operation.result_referral_key <> p_referral_key) then
      raise exception using errcode = '23505', message = 'referral idempotency conflict';
    end if;
    if not private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id, v_permission, true
    ) or private.require_referral_management_reauth(v_actor, clock_timestamp()) is null then
      raise exception using errcode = '42501', message = 'referral replay authority expired';
    end if;
    return query select p_expected_organization_id, p_expected_branch_id,
      v_operation.id, v_operation.operation_kind,
      v_operation.result_referral_key, v_operation.result_event_id,
      v_operation.result_sequence, v_operation.previous_event_id,
      case v_operation.operation_kind
        when 'create' then 'created'
        when 'submit' then 'submitted'
        when 'register_received' then 'receipt_registered'
        when 'respond' then 'response_recorded'
        when 'close' then 'closed'
        else 'corrected' end,
      v_operation.result_status, v_operation.result_receiving_unit_state,
      v_operation.notification_count, 'queued'::text, 'not_configured'::text,
      'not_configured'::text, 'no_external_delivery_claim'::text,
      'not_configured'::text, 'not_configured'::text,
      v_operation.committed_at, true;
    return;
  end if;

  v_reauth := private.require_referral_management_reauth(v_actor, v_now);
  if v_action = 'create' then
    if p_referral_key is not null or p_previous_event_id is not null
       or p_expected_sequence is not null or p_client_id is null
       or v_unit_state not in ('manual_unstandardized', 'missing', 'not_applicable')
       or (v_unit_code is null) <> (v_unit_name is null)
       or (v_unit_state = 'manual_unstandardized') <> (v_unit_code is not null)
       or (v_unit_code is not null and (
         char_length(v_unit_code) > 40
         or v_unit_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
       ))
       or p_referral_date is null or v_referral_reason is null
       or v_entry_content is not null or v_correction_reason is not null
       or p_corrects_event_id is not null
       or not private.can_staff_access_client(p_client_id, 'clients.read') then
      raise exception using errcode = '22023', message = 'referral create fields are invalid';
    end if;
    select client.id, btrim(client.display_name), btrim(client.client_code)
      into v_client_id, v_client_name, v_client_code
    from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active'
      and client.admitted_on is not null
      and client.admitted_on <= (p_referral_date at time zone 'Asia/Taipei')::date
      and (client.ended_on is null
        or client.ended_on >= (p_referral_date at time zone 'Asia/Taipei')::date);
    if v_client_id is null then
      raise exception using errcode = '42501', message = 'referral client is outside current scope';
    end if;
    select staff.membership_id, staff.display_name
      into v_actor_membership_id, v_actor_name
    from private.referral_management_staff_snapshot(
      p_expected_organization_id, p_expected_branch_id, v_actor,
      v_permission, v_client_id, v_now
    ) staff;
    if v_actor_membership_id is null then
      raise exception using errcode = '42501', message = 'referral actor is not current for client';
    end if;
    v_owner_user_id := v_actor;
    v_owner_membership_id := v_actor_membership_id;
    v_owner_name := v_actor_name;
    v_referral_date := p_referral_date;
    v_sequence := 1; v_event_kind := 'created'; v_status := 'draft';
  else
    if p_referral_key is null or p_previous_event_id is null
       or p_expected_sequence is null or p_expected_sequence < 1
       or p_client_id is not null or p_receiving_unit_state is not null
       or p_receiving_unit_code is not null or p_receiving_unit_name is not null
       or p_referral_date is not null or p_referral_reason is not null then
      raise exception using errcode = '22023', message = 'referral continuation fields are invalid';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'referral-management-stream:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_referral_key::text, 39
    ));
    select event.* into v_previous
    from public.referral_events event
    where event.id = p_previous_event_id
      and event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.referral_key = p_referral_key
      and event.sequence = p_expected_sequence
      and not exists (
        select 1 from public.referral_events child
        where child.previous_event_id = event.id
      )
    for share;
    if not found or not private.can_staff_access_client(v_previous.client_id, 'clients.read') then
      raise exception using errcode = '40001', message = 'referral base event is stale or outside scope';
    end if;
    select staff.membership_id, staff.display_name
      into v_actor_membership_id, v_actor_name
    from private.referral_management_staff_snapshot(
      p_expected_organization_id, p_expected_branch_id, v_actor,
      v_permission, v_previous.client_id, v_now
    ) staff;
    if v_actor_membership_id is null then
      raise exception using errcode = '42501', message = 'referral actor is not current for client';
    end if;
    if (v_action in ('register_received', 'respond', 'close', 'correct')
          and v_entry_content is null)
       or (v_action not in ('submit', 'register_received', 'respond', 'close', 'correct')
          and v_entry_content is not null)
       or (v_action = 'correct') <> (v_correction_reason is not null)
       or (v_action = 'correct') <> (p_corrects_event_id is not null) then
      raise exception using errcode = '22023', message = 'referral action content is invalid';
    end if;
    if v_action = 'submit' and v_previous.status <> 'draft' then
      raise exception using errcode = '40001', message = 'only a draft referral can be submitted';
    end if;
    if v_action = 'submit' and v_previous.receiving_unit_state <> 'manual_unstandardized' then
      raise exception using errcode = '22023', message = 'submission requires an explicit manual receiving unit';
    end if;
    if v_action = 'register_received' and v_previous.status <> 'submitted' then
      raise exception using errcode = '40001', message = 'only a submitted referral can register receipt';
    end if;
    if v_action = 'respond' and v_previous.status <> 'received' then
      raise exception using errcode = '40001', message = 'only a received referral can record response';
    end if;
    if v_action = 'close' and v_previous.status <> 'responded' then
      raise exception using errcode = '40001', message = 'only a responded referral can close';
    end if;
    if v_action = 'correct' then
      select target.* into v_target
      from public.referral_events target
      where target.id = p_corrects_event_id
        and target.organization_id = p_expected_organization_id
        and target.branch_id = p_expected_branch_id
        and target.referral_key = p_referral_key
        and target.sequence <= p_expected_sequence
        and target.event_kind <> 'corrected';
      if not found then
        raise exception using errcode = '22023', message = 'referral correction target is invalid';
      end if;
    end if;
    v_client_id := v_previous.client_id;
    v_client_name := v_previous.client_display_name;
    v_client_code := v_previous.client_code;
    v_owner_user_id := v_previous.owner_user_id;
    v_owner_membership_id := v_previous.owner_membership_id;
    v_owner_name := v_previous.owner_display_name;
    v_unit_state := v_previous.receiving_unit_state;
    v_unit_code := v_previous.receiving_unit_code;
    v_unit_name := v_previous.receiving_unit_name;
    v_referral_date := v_previous.referral_date;
    v_referral_reason := v_previous.referral_reason;
    v_sequence := v_previous.sequence + 1;
    v_event_kind := case v_action
      when 'submit' then 'submitted'
      when 'register_received' then 'receipt_registered'
      when 'respond' then 'response_recorded'
      when 'close' then 'closed'
      else 'corrected' end;
    v_status := case v_action
      when 'submit' then 'submitted'
      when 'register_received' then 'received'
      when 'respond' then 'responded'
      when 'close' then 'closed'
      else v_previous.status end;
  end if;

  if v_sequence > 10000 then
    raise exception using errcode = '54000', message = 'referral event sequence is exhausted';
  end if;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'referral_key', v_key, 'sequence', v_sequence,
    'previous_event_id', p_previous_event_id, 'corrects_event_id', p_corrects_event_id,
    'event_kind', v_event_kind, 'client_id', v_client_id,
    'owner_user_id', v_owner_user_id, 'receiving_unit_state', v_unit_state,
    'receiving_unit_code', v_unit_code, 'receiving_unit_name', v_unit_name,
    'receiving_unit_directory_status', 'not_configured',
    'referral_date', v_referral_date, 'referral_reason', v_referral_reason,
    'entry_content', v_entry_content, 'correction_reason', v_correction_reason,
    'status', v_status, 'occurred_at', v_now, 'actor_user_id', v_actor
  )::text, 'UTF8')), 'hex');

  insert into public.referral_events (
    id, organization_id, branch_id, referral_key, sequence,
    previous_event_id, corrects_event_id, event_kind,
    client_id, client_display_name, client_code,
    owner_user_id, owner_membership_id, owner_display_name,
    receiving_unit_state, receiving_unit_code, receiving_unit_name,
    receiving_unit_directory_status, referral_date, referral_reason,
    entry_content, correction_reason, status, occurred_at,
    actor_user_id, actor_display_name, reauth_challenge_id, content_hash
  ) values (
    v_event_id, p_expected_organization_id, p_expected_branch_id, v_key, v_sequence,
    p_previous_event_id, p_corrects_event_id, v_event_kind,
    v_client_id, v_client_name, v_client_code,
    v_owner_user_id, v_owner_membership_id, v_owner_name,
    v_unit_state, v_unit_code, v_unit_name,
    'not_configured', v_referral_date, v_referral_reason,
    v_entry_content, v_correction_reason, v_status, v_now,
    v_actor, v_actor_name, v_reauth, v_content_hash
  );

  with inserted as (
    insert into public.referral_notification_outbox (
      organization_id, branch_id, referral_key, source_event_id, source_sequence,
      recipient_user_id, recipient_membership_id, recipient_display_name,
      recipient_reasons, channel, queue_status, delivery_claim,
      provider_status, external_delivery_status, queued_at, correlation_id, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, v_key, v_event_id, v_sequence,
      v_actor, v_actor_membership_id, v_actor_name, array['actor']::text[],
      'in_app', 'queued', 'no_external_delivery_claim', 'not_configured',
      'not_configured', v_now, gen_random_uuid(),
      encode(sha256(convert_to(jsonb_build_object(
        'schema_version', 1, 'source_event_id', v_event_id,
        'recipient_user_id', v_actor, 'recipient_reasons', array['actor']::text[],
        'channel', 'in_app', 'queue_status', 'queued',
        'delivery_claim', 'no_external_delivery_claim',
        'provider_status', 'not_configured', 'external_delivery_status', 'not_configured'
      )::text, 'UTF8')), 'hex')
    ) returning id
  ) select count(*)::integer into v_notification_count from inserted;
  if v_notification_count <> 1 then
    raise exception using errcode = '40001', message = 'referral recipient snapshot is invalid';
  end if;

  insert into private.referral_operations (
    id, organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_referral_key, result_event_id,
    result_sequence, previous_event_id, result_status,
    result_receiving_unit_state, notification_count, reauth_challenge_id, committed_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_action, v_request_hash, v_key, v_event_id,
    v_sequence, p_previous_event_id, v_status, v_unit_state,
    v_notification_count, v_reauth, v_now
  );
  if not private.referral_management_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, true
  ) or private.require_referral_management_reauth(v_actor, clock_timestamp()) is null then
    raise exception using errcode = '42501', message = 'referral authority expired';
  end if;
  return query select p_expected_organization_id, p_expected_branch_id,
    v_operation_id, v_action, v_key, v_event_id, v_sequence,
    p_previous_event_id, v_event_kind, v_status, v_unit_state,
    v_notification_count, 'queued'::text, 'not_configured'::text,
    'not_configured'::text, 'no_external_delivery_claim'::text,
    'not_configured'::text, 'not_configured'::text, v_now, false;
end;
$$;

create or replace function public.mutate_referral_management(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_referral_key uuid,
  p_previous_event_id uuid,
  p_expected_sequence integer,
  p_client_id uuid,
  p_receiving_unit_state text,
  p_receiving_unit_code text,
  p_receiving_unit_name text,
  p_referral_date timestamptz,
  p_referral_reason text,
  p_entry_content text,
  p_correction_reason text,
  p_corrects_event_id uuid,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid,
  operation_id uuid, operation_kind text, referral_key uuid,
  event_id uuid, event_sequence integer, previous_event_id uuid,
  event_kind text, referral_status text, receiving_unit_state text,
  notification_count integer, notification_queue_status text,
  notification_provider_status text, external_delivery_status text,
  delivery_claim text, attachment_status text, export_status text,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_referral_management_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action,
    p_referral_key, p_previous_event_id, p_expected_sequence,
    p_client_id, p_receiving_unit_state, p_receiving_unit_code,
    p_receiving_unit_name, p_referral_date, p_referral_reason,
    p_entry_content, p_correction_reason, p_corrects_event_id, p_idempotency_key
  );
$$;

create or replace function private.referral_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_receiving_unit_mode text,
  p_receiving_unit_code text,
  p_status text,
  p_recent_from date,
  p_recent_to date,
  p_query text
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_token text, items jsonb,
  matching_total bigint, draft_total bigint, submitted_total bigint,
  received_total bigint, responded_total bigint, closed_total bigint,
  unit_missing_total bigint, unit_not_applicable_total bigint,
  items_truncated boolean, client_options jsonb, receiving_unit_options jsonb,
  can_create boolean, can_submit boolean, can_register_receipt boolean,
  can_respond boolean, can_close boolean, can_correct boolean,
  receiving_unit_directory_status text, attachment_status text, export_status text,
  notification_queue_status text, notification_provider_status text,
  external_delivery_status text, delivery_claim text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_query text := nullif(btrim(p_query), '');
  v_unit_code text := nullif(btrim(p_receiving_unit_code), '');
  v_organization_name text; v_branch_name text; v_items jsonb;
  v_matching bigint; v_draft bigint; v_submitted bigint; v_received bigint;
  v_responded bigint; v_closed bigint; v_missing bigint; v_not_applicable bigint;
  v_clients jsonb; v_units jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_receiving_unit_mode not in (
       'all', 'manual_unstandardized', 'missing', 'not_applicable', 'specific'
     )
     or (p_receiving_unit_mode = 'specific') <> (v_unit_code is not null)
     or (v_unit_code is not null and (
       char_length(v_unit_code) > 40
       or v_unit_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'
     ))
     or p_status not in ('all', 'draft', 'submitted', 'received', 'responded', 'closed')
     or (p_recent_from is not null and p_recent_to is not null
       and p_recent_from > p_recent_to)
     or (v_query is not null and (
       char_length(v_query) > 120 or v_query ~ '[[:cntrl:]]'
     ))
     or not private.referral_management_authority(
       p_expected_organization_id, p_expected_branch_id,
       'referral_management.read', false
     )
     or not private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ) then
    raise exception using errcode = '42501', message = 'referral snapshot is not permitted';
  end if;

  with current_events as materialized (
    select distinct on (event.referral_key) event.*
    from public.referral_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    order by event.referral_key, event.sequence desc, event.id desc
  ), filtered as materialized (
    select current.*
    from current_events current
    where private.can_staff_access_client(current.client_id, 'clients.read')
      and (p_client_id is null or current.client_id = p_client_id)
      and (p_receiving_unit_mode = 'all'
        or (p_receiving_unit_mode = 'specific'
          and current.receiving_unit_code = v_unit_code)
        or (p_receiving_unit_mode <> 'specific'
          and current.receiving_unit_state = p_receiving_unit_mode))
      and (p_status = 'all' or current.status = p_status)
      and (p_recent_from is null
        or (current.occurred_at at time zone 'Asia/Taipei')::date >= p_recent_from)
      and (p_recent_to is null
        or (current.occurred_at at time zone 'Asia/Taipei')::date <= p_recent_to)
      and (v_query is null
        or lower(current.referral_reason) like '%' || lower(v_query) || '%')
  ), selected as materialized (
    select * from filtered
    order by occurred_at desc, referral_key
    limit 200
  ), bundled as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', selected.id,
      'referral_key', selected.referral_key,
      'sequence', selected.sequence,
      'previous_event_id', selected.previous_event_id,
      'corrects_event_id', selected.corrects_event_id,
      'event_kind', selected.event_kind,
      'client_id', selected.client_id,
      'client_display_name', selected.client_display_name,
      'client_code', selected.client_code,
      'owner_user_id', selected.owner_user_id,
      'owner_display_name', selected.owner_display_name,
      'receiving_unit_state', selected.receiving_unit_state,
      'receiving_unit_code', selected.receiving_unit_code,
      'receiving_unit_name', selected.receiving_unit_name,
      'receiving_unit_directory_status', selected.receiving_unit_directory_status,
      'referral_date', selected.referral_date,
      'referral_reason', selected.referral_reason,
      'entry_content', selected.entry_content,
      'correction_reason', selected.correction_reason,
      'status', selected.status,
      'occurred_at', selected.occurred_at,
      'actor_display_name', selected.actor_display_name,
      'content_hash', selected.content_hash,
      'notification', jsonb_build_object(
        'queue_status', 'queued',
        'delivery_claim', 'no_external_delivery_claim',
        'provider_status', 'not_configured',
        'recipient_count', (
          select count(*) from public.referral_notification_outbox outbox
          where outbox.source_event_id = selected.id
        )
      ),
      'history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'event_id', history.id,
          'sequence', history.sequence,
          'event_kind', history.event_kind,
          'corrects_event_id', history.corrects_event_id,
          'entry_content', history.entry_content,
          'correction_reason', history.correction_reason,
          'status', history.status,
          'occurred_at', history.occurred_at,
          'actor_display_name', history.actor_display_name,
          'content_hash', history.content_hash,
          'notification_recipient_count', (
            select count(*) from public.referral_notification_outbox history_outbox
            where history_outbox.source_event_id = history.id
          )
        ) order by history.sequence desc), '[]'::jsonb)
        from public.referral_events history
        where history.organization_id = selected.organization_id
          and history.branch_id = selected.branch_id
          and history.referral_key = selected.referral_key
      )
    ) order by selected.occurred_at desc, selected.referral_key), '[]'::jsonb) value
    from selected
  ), metrics as (
    select count(*) matching_total,
      count(*) filter (where status = 'draft') draft_total,
      count(*) filter (where status = 'submitted') submitted_total,
      count(*) filter (where status = 'received') received_total,
      count(*) filter (where status = 'responded') responded_total,
      count(*) filter (where status = 'closed') closed_total,
      count(*) filter (where receiving_unit_state = 'missing') unit_missing_total,
      count(*) filter (where receiving_unit_state = 'not_applicable') unit_not_applicable_total
    from filtered
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
      order by client.display_name collate "C", client.id
      limit 200
    ) option
  ), units as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', option.receiving_unit_code,
      'name', option.receiving_unit_name,
      'directory_status', 'not_configured'
    ) order by option.receiving_unit_name collate "C", option.receiving_unit_code), '[]'::jsonb) value
    from (
      select current.receiving_unit_code,
        min(current.receiving_unit_name) receiving_unit_name
      from current_events current
      where current.receiving_unit_state = 'manual_unstandardized'
        and private.can_staff_access_client(current.client_id, 'clients.read')
      group by current.receiving_unit_code
      order by min(current.receiving_unit_name) collate "C", current.receiving_unit_code
      limit 100
    ) option
  )
  select organization.name, branch.name, bundled.value,
    metrics.matching_total, metrics.draft_total, metrics.submitted_total,
    metrics.received_total, metrics.responded_total, metrics.closed_total,
    metrics.unit_missing_total, metrics.unit_not_applicable_total,
    clients.value, units.value
  into v_organization_name, v_branch_name, v_items,
    v_matching, v_draft, v_submitted, v_received, v_responded, v_closed,
    v_missing, v_not_applicable, v_clients, v_units
  from public.organizations organization
  join public.branches branch
    on branch.id = p_expected_branch_id
   and branch.organization_id = organization.id
  cross join bundled cross join metrics cross join clients cross join units
  where organization.id = p_expected_organization_id;

  if v_organization_name is null or v_branch_name is null then
    raise exception using errcode = '42501', message = 'referral scope is unavailable';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'referral_management_snapshot', null, '{}'::text[], jsonb_build_object(
      'workflow', 'page39_referral_management_v1',
      'client_filter_present', p_client_id is not null,
      'receiving_unit_mode', p_receiving_unit_mode,
      'receiving_unit_code_present', v_unit_code is not null,
      'status_filter', p_status,
      'date_filter_present', p_recent_from is not null or p_recent_to is not null,
      'query_present', v_query is not null,
      'matching_total', v_matching
    )
  );
  if not private.referral_management_authority(
    p_expected_organization_id, p_expected_branch_id,
    'referral_management.read', false
  ) or not private.has_permission(
    p_expected_organization_id, p_expected_branch_id, 'clients.read'
  ) then
    raise exception using errcode = '42501', message = 'referral authority expired';
  end if;
  return query select p_expected_organization_id, v_organization_name,
    p_expected_branch_id, v_branch_name, v_now,
    encode(sha256(convert_to(jsonb_build_object(
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id,
      'items', v_items
    )::text, 'UTF8')), 'hex'),
    v_items, v_matching, v_draft, v_submitted, v_received, v_responded,
    v_closed, v_missing, v_not_applicable,
    v_matching > jsonb_array_length(v_items), v_clients, v_units,
    private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      'referral_management.create', true),
    private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      'referral_management.submit', true),
    private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      'referral_management.receive', true),
    private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      'referral_management.respond', true),
    private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      'referral_management.close', true),
    private.referral_management_authority(
      p_expected_organization_id, p_expected_branch_id,
      'referral_management.correct', true),
    'not_configured'::text, 'not_configured'::text, 'not_configured'::text,
    'queued'::text, 'not_configured'::text, 'not_configured'::text,
    'no_external_delivery_claim'::text;
end;
$$;

create or replace function public.referral_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_receiving_unit_mode text default 'all',
  p_receiving_unit_code text default null,
  p_status text default 'all',
  p_recent_from date default null,
  p_recent_to date default null,
  p_query text default null
)
returns table(
  organization_id uuid, organization_name text, branch_id uuid, branch_name text,
  generated_at timestamptz, snapshot_token text, items jsonb,
  matching_total bigint, draft_total bigint, submitted_total bigint,
  received_total bigint, responded_total bigint, closed_total bigint,
  unit_missing_total bigint, unit_not_applicable_total bigint,
  items_truncated boolean, client_options jsonb, receiving_unit_options jsonb,
  can_create boolean, can_submit boolean, can_register_receipt boolean,
  can_respond boolean, can_close boolean, can_correct boolean,
  receiving_unit_directory_status text, attachment_status text, export_status text,
  notification_queue_status text, notification_provider_status text,
  external_delivery_status text, delivery_claim text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.referral_management_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_receiving_unit_mode, p_receiving_unit_code, p_status,
    p_recent_from, p_recent_to, p_query
  );
$$;

revoke all on function private.prevent_referral_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.referral_management_authority(uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.referral_management_user_has_permission(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.referral_management_staff_snapshot(uuid,uuid,uuid,text,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_referral_management_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_referral_management_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)
  from public, anon, service_role;
revoke all on function private.referral_management_snapshot_response(uuid,uuid,uuid,text,text,text,date,date,text)
  from public, anon, service_role;
revoke all on function public.mutate_referral_management(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)
  from public, anon, service_role;
revoke all on function public.referral_management_snapshot(uuid,uuid,uuid,text,text,text,date,date,text)
  from public, anon, service_role;
grant execute on function private.mutate_referral_management_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)
  to authenticated;
grant execute on function private.referral_management_snapshot_response(uuid,uuid,uuid,text,text,text,date,date,text)
  to authenticated;
grant execute on function public.mutate_referral_management(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)
  to authenticated;
grant execute on function public.referral_management_snapshot(uuid,uuid,uuid,text,text,text,date,date,text)
  to authenticated;

comment on table public.referral_events is
  'Page 39 immutable referral event ledger. Missing and not_applicable receiving units remain distinct.';
comment on table public.referral_notification_outbox is
  'Page 39 immutable in-app queued evidence. No external provider or delivery is claimed.';
comment on function public.referral_management_snapshot(uuid,uuid,uuid,text,text,text,date,date,text) is
  'Page 39 audited assigned-client snapshot; full metrics are computed before the 200-row detail limit.';
