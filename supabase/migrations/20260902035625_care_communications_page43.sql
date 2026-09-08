-- Page 43: client-scoped care communication history.
--
-- This is intentionally separate from Page 76 consultant messages. Every row
-- is classified as `care_communication`, is addressed only to family profiles
-- holding a current `messages.read` consent for the exact client, and is
-- append-only. The family consumer, provider worker, offline consumer and
-- trusted attachment scanner are not configured in this release. Writes only
-- create honest queued evidence; no delivered/read/confirmed state is forged.

insert into public.permissions (permission_key, description, risk_level) values
  ('care_communications.read', 'Read assigned-client care communication history', 2),
  ('care_communications.manage', 'Create queued family care communication records', 2),
  ('care_communications.correct', 'Append narrow corrections to care communications', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional'
  )
  and permission.permission_key = 'care_communications.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor',
    'case_manager_social_worker', 'nurse'
  )
  and permission.permission_key in (
    'care_communications.manage', 'care_communications.correct'
  )
on conflict (role_id, permission_id) do nothing;

create table public.care_communication_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  communication_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_kind text not null,
  category text not null default 'care_communication',
  direction text not null default 'staff_to_family',
  client_display_name text not null,
  client_code text not null,
  subject text not null,
  body text not null,
  occurred_at timestamptz not null,
  submitted_at timestamptz not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  author_profile_kind text not null,
  correction_reason text,
  attachment_state text not null,
  recipient_count integer not null,
  delivery_status text not null,
  read_status text not null,
  family_confirmation_status text not null,
  content_hash text not null,
  created_at timestamptz not null,
  constraint care_communication_versions_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint care_communication_versions_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint care_communication_versions_id_lineage_key
    unique (id, organization_id, branch_id, client_id, communication_key),
  constraint care_communication_versions_key_version_key
    unique (communication_key, version),
  constraint care_communication_versions_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id,
      communication_key
    ) references public.care_communication_versions (
      id, organization_id, branch_id, client_id, communication_key
    ) on delete restrict,
  constraint care_communication_versions_classification_check check (
    category = 'care_communication'
    and direction = 'staff_to_family'
    and category <> 'consultant'
  ),
  constraint care_communication_versions_lineage_check check (
    version > 0
    and (
      (version = 1 and previous_version_id is null
        and record_kind = 'original' and correction_reason is null)
      or
      (version > 1 and previous_version_id is not null
        and record_kind = 'correction'
        and correction_reason = btrim(correction_reason)
        and char_length(correction_reason) between 2 and 500
        and correction_reason !~ '[[:cntrl:]]')
    )
  ),
  constraint care_communication_versions_client_snapshot_check check (
    client_display_name = btrim(client_display_name)
    and char_length(client_display_name) between 1 and 120
    and client_display_name !~ '[[:cntrl:]]'
    and client_code = btrim(client_code)
    and char_length(client_code) between 1 and 120
    and client_code !~ '[[:cntrl:]]'
  ),
  constraint care_communication_versions_content_check check (
    subject = btrim(subject)
    and char_length(subject) between 1 and 200
    and subject !~ '[[:cntrl:]]'
    and body = btrim(body)
    and char_length(body) between 1 and 10000
    and body !~ '[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]'
  ),
  constraint care_communication_versions_author_check check (
    author_profile_kind = 'staff'
    and author_display_name = btrim(author_display_name)
    and char_length(author_display_name) between 1 and 120
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint care_communication_versions_time_check check (
    isfinite(occurred_at) and isfinite(submitted_at) and isfinite(created_at)
    and submitted_at = created_at
  ),
  constraint care_communication_versions_current_boundary_check check (
    attachment_state = 'none'
    and delivery_status = 'queued'
    and read_status = 'not_configured'
    and family_confirmation_status = 'not_configured'
    and recipient_count between 1 and 20
  ),
  constraint care_communication_versions_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.care_communication_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  communication_version_id uuid not null,
  communication_key uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  consent_id uuid not null,
  recipient_display_name text not null,
  recipient_profile_kind text not null,
  relationship text not null,
  consent_document_version text not null,
  consent_scopes text[] not null,
  consented_at timestamptz not null,
  consent_expires_at timestamptz,
  frozen_at timestamptz not null,
  constraint care_communication_recipients_version_scope_fkey
    foreign key (
      communication_version_id, organization_id, branch_id, client_id,
      communication_key
    ) references public.care_communication_versions (
      id, organization_id, branch_id, client_id, communication_key
    ) on delete restrict,
  constraint care_communication_recipients_consent_scope_fkey
    foreign key (
      consent_id, organization_id, branch_id, client_id, recipient_user_id
    ) references public.consents (
      id, organization_id, branch_id, client_id, recipient_user_id
    ) on delete restrict,
  constraint care_communication_recipients_version_user_key
    unique (communication_version_id, recipient_user_id),
  constraint care_communication_recipients_snapshot_check check (
    recipient_profile_kind = 'family'
    and recipient_display_name = btrim(recipient_display_name)
    and char_length(recipient_display_name) between 1 and 120
    and recipient_display_name !~ '[[:cntrl:]]'
    and relationship = btrim(relationship)
    and char_length(relationship) between 1 and 80
    and consent_document_version = btrim(consent_document_version)
    and char_length(consent_document_version) between 1 and 120
    and cardinality(consent_scopes) between 1 and 7
    and 'messages.read' = any(consent_scopes)
    and isfinite(consented_at)
    and isfinite(frozen_at)
    and (consent_expires_at is null or isfinite(consent_expires_at))
  )
);

create table public.care_communication_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  communication_version_id uuid not null,
  trusted_reference text not null,
  sha256 text not null,
  attachment_state text not null,
  scanned_at timestamptz,
  attached_at timestamptz not null,
  constraint care_communication_attachments_version_scope_fkey
    foreign key (communication_version_id, organization_id, branch_id, client_id)
    references public.care_communication_versions (
      id, organization_id, branch_id, client_id
    ) on delete restrict,
  constraint care_communication_attachments_reference_key
    unique (communication_version_id, trusted_reference),
  constraint care_communication_attachments_reference_check check (
    trusted_reference ~ '^trusted-upload:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and trusted_reference !~* '^(https?|file|data|javascript):'
    and sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint care_communication_attachments_state_check check (
    attachment_state in ('pending_scan', 'verified_clean')
    and isfinite(attached_at)
    and (
      (attachment_state = 'pending_scan' and scanned_at is null)
      or
      (attachment_state = 'verified_clean' and scanned_at is not null
        and isfinite(scanned_at) and scanned_at <= attached_at)
    )
  )
);

create table public.care_communication_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  communication_version_id uuid not null,
  recipient_user_id uuid not null,
  event_kind text not null,
  channel text not null,
  provider_worker_status text not null,
  family_consumer_status text not null,
  offline_consumer_status text not null,
  correlation_id uuid not null,
  occurred_at timestamptz not null,
  constraint care_communication_delivery_version_scope_fkey
    foreign key (communication_version_id, organization_id, branch_id, client_id)
    references public.care_communication_versions (
      id, organization_id, branch_id, client_id
    ) on delete restrict,
  constraint care_communication_delivery_recipient_fkey
    foreign key (communication_version_id, recipient_user_id)
    references public.care_communication_recipients (
      communication_version_id, recipient_user_id
    ) on delete restrict,
  constraint care_communication_delivery_event_key
    unique (communication_version_id, recipient_user_id, event_kind),
  constraint care_communication_delivery_correlation_key unique (correlation_id),
  constraint care_communication_delivery_current_boundary_check check (
    event_kind = 'queued'
    and channel = 'family_pwa'
    and provider_worker_status = 'not_configured'
    and family_consumer_status = 'not_configured'
    and offline_consumer_status = 'not_configured'
    and isfinite(occurred_at)
  )
);

create table private.care_communication_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_communication_key uuid not null,
  result_version_id uuid not null,
  result_version integer not null,
  result_payload jsonb not null,
  created_at timestamptz not null,
  constraint care_communication_operations_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint care_communication_operations_version_scope_fkey
    foreign key (result_version_id, organization_id, branch_id, client_id)
    references public.care_communication_versions (
      id, organization_id, branch_id, client_id
    ) on delete restrict,
  constraint care_communication_operations_actor_key
    unique (actor_user_id, idempotency_key),
  constraint care_communication_operations_kind_check
    check (operation_kind in ('create', 'correct')),
  constraint care_communication_operations_result_check check (
    result_version > 0
    and request_hash ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(result_payload) = 'object'
    and isfinite(created_at)
  )
);

create index care_communication_versions_scope_history_idx
  on public.care_communication_versions (
    organization_id, branch_id, client_id, occurred_at desc,
    communication_key, version desc
  );
create index care_communication_versions_author_idx
  on public.care_communication_versions (author_user_id);
create index care_communication_versions_previous_idx
  on public.care_communication_versions (previous_version_id)
  where previous_version_id is not null;
create index care_communication_recipients_scope_idx
  on public.care_communication_recipients (
    organization_id, branch_id, client_id, communication_version_id,
    recipient_user_id, consent_id
  );
create index care_communication_recipients_consent_idx
  on public.care_communication_recipients (consent_id);
create index care_communication_recipients_key_idx
  on public.care_communication_recipients (communication_key);
create index care_communication_attachments_scope_idx
  on public.care_communication_attachments (
    organization_id, branch_id, client_id, communication_version_id
  );
create index care_communication_delivery_scope_idx
  on public.care_communication_delivery_events (
    organization_id, branch_id, client_id, communication_version_id,
    recipient_user_id, occurred_at desc
  );
create index care_communication_operations_scope_idx
  on private.care_communication_operations (
    organization_id, branch_id, client_id, actor_user_id, created_at desc
  );
create index care_communication_operations_version_idx
  on private.care_communication_operations (result_version_id);
create index care_communication_operations_key_idx
  on private.care_communication_operations (result_communication_key);

alter table public.care_communication_versions enable row level security;
alter table public.care_communication_versions force row level security;
alter table public.care_communication_recipients enable row level security;
alter table public.care_communication_recipients force row level security;
alter table public.care_communication_attachments enable row level security;
alter table public.care_communication_attachments force row level security;
alter table public.care_communication_delivery_events enable row level security;
alter table public.care_communication_delivery_events force row level security;
alter table private.care_communication_operations enable row level security;
alter table private.care_communication_operations force row level security;

create or replace function private.prevent_care_communication_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger care_communication_versions_prevent_mutation
before update or delete on public.care_communication_versions
for each row execute function private.prevent_care_communication_mutation();
create trigger care_communication_recipients_prevent_mutation
before update or delete on public.care_communication_recipients
for each row execute function private.prevent_care_communication_mutation();
create trigger care_communication_attachments_prevent_mutation
before update or delete on public.care_communication_attachments
for each row execute function private.prevent_care_communication_mutation();
create trigger care_communication_delivery_events_prevent_mutation
before update or delete on public.care_communication_delivery_events
for each row execute function private.prevent_care_communication_mutation();
create trigger care_communication_operations_prevent_mutation
before update or delete on private.care_communication_operations
for each row execute function private.prevent_care_communication_mutation();

create trigger care_communication_versions_audit_row_change
after insert on public.care_communication_versions
for each row execute function private.audit_row_change();
create trigger care_communication_recipients_audit_row_change
after insert on public.care_communication_recipients
for each row execute function private.audit_row_change();
create trigger care_communication_attachments_audit_row_change
after insert on public.care_communication_attachments
for each row execute function private.audit_row_change();
create trigger care_communication_delivery_events_audit_row_change
after insert on public.care_communication_delivery_events
for each row execute function private.audit_row_change();

create or replace function private.care_communication_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission_key text,
  p_require_recent_aal2 boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind = 'staff'
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_organization_id, p_branch_id, p_permission_key
    )
    and (not p_require_recent_aal2 or private.has_recent_aal2(15));
$$;

create or replace function private.mutate_care_communication_atomic(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_communication_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_subject text,
  p_body text,
  p_occurred_at timestamptz,
  p_correction_reason text,
  p_attachments jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  operation_kind text,
  communication_key uuid,
  version_id uuid,
  communication_version integer,
  previous_version_id uuid,
  record_kind text,
  client_id uuid,
  recipient_count integer,
  delivery_status text,
  read_status text,
  family_confirmation_status text,
  attachment_state text,
  submitted_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_subject text := btrim(p_subject);
  v_body text := btrim(p_body);
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_permission text;
  v_client public.clients%rowtype;
  v_author public.profiles%rowtype;
  v_previous public.care_communication_versions%rowtype;
  v_version_id uuid := gen_random_uuid();
  v_key uuid;
  v_version integer;
  v_record_kind text;
  v_occurred_at timestamptz;
  v_request_hash text;
  v_content_hash text;
  v_operation private.care_communication_operations%rowtype;
  v_operation_id uuid := gen_random_uuid();
  v_recipient_ids uuid[];
  v_previous_recipient_ids uuid[];
  v_inserted integer;
begin
  if p_action not in ('create', 'correct')
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_idempotency_key is null
     or p_subject is null
     or p_body is null
     or p_attachments is null
     or jsonb_typeof(p_attachments) <> 'array' then
    raise exception using errcode = '22023',
      message = 'care communication operation input is invalid';
  end if;
  if jsonb_array_length(p_attachments) > 0 then
    raise exception using errcode = '55000',
      message = 'care communication attachment pipeline is not configured';
  end if;
  if char_length(v_subject) not between 1 and 200
     or v_subject ~ '[[:cntrl:]]'
     or char_length(v_body) not between 1 and 10000
     or v_body ~ '[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]' then
    raise exception using errcode = '22023',
      message = 'care communication content is invalid';
  end if;

  if p_action = 'create' then
    if p_communication_key is not null
       or p_previous_version_id is not null
       or coalesce(p_expected_version, 0) <> 0
       or p_occurred_at is null
       or not isfinite(p_occurred_at)
       or p_occurred_at > v_now + interval '5 minutes'
       or v_reason is not null then
      raise exception using errcode = '22023',
        message = 'care communication create lineage is invalid';
    end if;
    v_permission := 'care_communications.manage';
    v_key := gen_random_uuid();
    v_version := 1;
    v_record_kind := 'original';
    v_occurred_at := p_occurred_at;
  else
    if p_communication_key is null
       or p_previous_version_id is null
       or coalesce(p_expected_version, 0) < 1
       or p_occurred_at is not null
       or v_reason is null
       or char_length(v_reason) not between 2 and 500
       or v_reason ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023',
        message = 'care communication correction lineage is invalid';
    end if;
    v_permission := 'care_communications.correct';
    v_key := p_communication_key;
    v_version := p_expected_version + 1;
    v_record_kind := 'correction';
  end if;

  if not private.care_communication_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, true
  ) or not private.can_staff_access_client(p_client_id, v_permission) then
    raise exception using errcode = '42501',
      message = 'care communication mutation is not permitted';
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
    and client.status = 'active'
    and client.admitted_on is not null
    and client.admitted_on <= (v_now at time zone 'Asia/Taipei')::date
    and (client.ended_on is null
      or client.ended_on >= (v_now at time zone 'Asia/Taipei')::date);
  if not found then
    raise exception using errcode = '42501',
      message = 'care communication client is outside active scope';
  end if;
  select profile.* into v_author
  from public.profiles profile
  where profile.id = v_actor
    and profile.kind = 'staff'
    and profile.is_active;
  if not found then
    raise exception using errcode = '42501',
      message = 'care communication mutation is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'communication_key', p_communication_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version,
    'subject', v_subject,
    'body', v_body,
    'occurred_at', p_occurred_at,
    'correction_reason', v_reason,
    'attachments', p_attachments
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'care-communication-operation:' || v_actor::text || ':' ||
    p_idempotency_key::text, 43
  ));
  select * into v_operation
  from private.care_communication_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.operation_kind <> p_action
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'care communication idempotency conflict';
    end if;
    return query select
      v_operation.id,
      v_operation.operation_kind,
      v_operation.result_communication_key,
      v_operation.result_version_id,
      v_operation.result_version,
      nullif(v_operation.result_payload ->> 'previous_version_id', '')::uuid,
      v_operation.result_payload ->> 'record_kind',
      v_operation.client_id,
      (v_operation.result_payload ->> 'recipient_count')::integer,
      v_operation.result_payload ->> 'delivery_status',
      v_operation.result_payload ->> 'read_status',
      v_operation.result_payload ->> 'family_confirmation_status',
      v_operation.result_payload ->> 'attachment_state',
      (v_operation.result_payload ->> 'submitted_at')::timestamptz,
      true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'care-communication-lineage:' || v_key::text, 43
  ));
  if p_action = 'correct' then
    select version_row.* into v_previous
    from public.care_communication_versions version_row
    where version_row.id = p_previous_version_id
      and version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.client_id = p_client_id
      and version_row.communication_key = p_communication_key
      and version_row.version = p_expected_version
      and version_row.category = 'care_communication'
      and not exists (
        select 1 from public.care_communication_versions child
        where child.previous_version_id = version_row.id
      )
    for share;
    if not found then
      raise exception using errcode = '40001',
        message = 'care communication base version is stale';
    end if;
    v_occurred_at := v_previous.occurred_at;
  end if;

  select array_agg(candidate.recipient_user_id order by candidate.recipient_user_id)
  into v_recipient_ids
  from (
    select distinct on (consent.recipient_user_id)
      consent.recipient_user_id
    from public.consents consent
    join public.profiles profile
      on profile.id = consent.recipient_user_id
     and profile.kind = 'family'
     and profile.is_active
    where consent.organization_id = p_expected_organization_id
      and consent.branch_id = p_expected_branch_id
      and consent.client_id = p_client_id
      and consent.consented_at <= v_now
      and (consent.expires_at is null or consent.expires_at > v_now)
      and consent.revoked_at is null
      and 'messages.read' = any(consent.scopes)
    order by consent.recipient_user_id,
      consent.consented_at desc, consent.created_at desc, consent.id desc
  ) candidate;
  if coalesce(cardinality(v_recipient_ids), 0) not between 1 and 20 then
    raise exception using errcode = '42501',
      message = 'care communication has no authorized family recipient';
  end if;
  if p_action = 'correct' then
    select array_agg(recipient.recipient_user_id order by recipient.recipient_user_id)
    into v_previous_recipient_ids
    from public.care_communication_recipients recipient
    where recipient.communication_version_id = p_previous_version_id;
    if v_previous_recipient_ids is distinct from v_recipient_ids then
      raise exception using errcode = '42501',
        message = 'care communication correction recipient scope changed';
    end if;
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'communication_key', v_key,
    'version', v_version,
    'previous_version_id', p_previous_version_id,
    'record_kind', v_record_kind,
    'category', 'care_communication',
    'direction', 'staff_to_family',
    'subject', v_subject,
    'body', v_body,
    'occurred_at', v_occurred_at,
    'submitted_at', v_now,
    'author_user_id', v_actor,
    'correction_reason', v_reason,
    'recipient_user_ids', to_jsonb(v_recipient_ids),
    'attachment_state', 'none',
    'delivery_status', 'queued',
    'read_status', 'not_configured',
    'family_confirmation_status', 'not_configured'
  )::text, 'UTF8')), 'hex');

  insert into public.care_communication_versions (
    id, organization_id, branch_id, client_id, communication_key, version,
    previous_version_id, record_kind, category, direction,
    client_display_name, client_code, subject, body, occurred_at,
    submitted_at, author_user_id, author_display_name, author_profile_kind,
    correction_reason, attachment_state, recipient_count, delivery_status,
    read_status, family_confirmation_status, content_hash, created_at
  ) values (
    v_version_id, p_expected_organization_id, p_expected_branch_id,
    p_client_id, v_key, v_version, p_previous_version_id, v_record_kind,
    'care_communication', 'staff_to_family', v_client.display_name,
    v_client.client_code, v_subject, v_body, v_occurred_at, v_now,
    v_actor, v_author.display_name, v_author.kind::text, v_reason,
    'none', cardinality(v_recipient_ids), 'queued', 'not_configured',
    'not_configured', v_content_hash, v_now
  );

  insert into public.care_communication_recipients (
    organization_id, branch_id, client_id, communication_version_id,
    communication_key, recipient_user_id, consent_id,
    recipient_display_name, recipient_profile_kind, relationship,
    consent_document_version, consent_scopes, consented_at,
    consent_expires_at, frozen_at
  )
  select
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_version_id, v_key, chosen.recipient_user_id, chosen.consent_id,
    chosen.display_name, 'family', chosen.relationship,
    chosen.document_version, chosen.scopes, chosen.consented_at,
    chosen.expires_at, v_now
  from (
    select distinct on (consent.recipient_user_id)
      consent.recipient_user_id,
      consent.id as consent_id,
      profile.display_name,
      consent.relationship,
      consent.document_version,
      consent.scopes,
      consent.consented_at,
      consent.expires_at
    from public.consents consent
    join public.profiles profile
      on profile.id = consent.recipient_user_id
     and profile.kind = 'family'
     and profile.is_active
    where consent.organization_id = p_expected_organization_id
      and consent.branch_id = p_expected_branch_id
      and consent.client_id = p_client_id
      and consent.recipient_user_id = any(v_recipient_ids)
      and consent.consented_at <= v_now
      and (consent.expires_at is null or consent.expires_at > v_now)
      and consent.revoked_at is null
      and 'messages.read' = any(consent.scopes)
    order by consent.recipient_user_id,
      consent.consented_at desc, consent.created_at desc, consent.id desc
  ) chosen;
  get diagnostics v_inserted = row_count;
  if v_inserted <> cardinality(v_recipient_ids) then
    raise exception using errcode = '40001',
      message = 'care communication recipient snapshot changed';
  end if;

  insert into public.care_communication_delivery_events (
    organization_id, branch_id, client_id, communication_version_id,
    recipient_user_id, event_kind, channel, provider_worker_status,
    family_consumer_status, offline_consumer_status, correlation_id,
    occurred_at
  )
  select
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_version_id, recipient_id, 'queued', 'family_pwa',
    'not_configured', 'not_configured', 'not_configured', gen_random_uuid(),
    v_now
  from unnest(v_recipient_ids) recipient_id;
  get diagnostics v_inserted = row_count;
  if v_inserted <> cardinality(v_recipient_ids) then
    raise exception using errcode = '40001',
      message = 'care communication delivery history is incomplete';
  end if;

  insert into private.care_communication_operations (
    id, organization_id, branch_id, client_id, actor_user_id,
    operation_kind, idempotency_key, request_hash,
    result_communication_key, result_version_id, result_version,
    result_payload, created_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id,
    p_client_id, v_actor, p_action, p_idempotency_key, v_request_hash,
    v_key, v_version_id, v_version,
    jsonb_build_object(
      'previous_version_id', p_previous_version_id,
      'record_kind', v_record_kind,
      'recipient_count', cardinality(v_recipient_ids),
      'delivery_status', 'queued',
      'read_status', 'not_configured',
      'family_confirmation_status', 'not_configured',
      'attachment_state', 'none',
      'submitted_at', v_now
    ),
    v_now
  );

  if not private.care_communication_authority(
    p_expected_organization_id, p_expected_branch_id, v_permission, true
  ) or not private.can_staff_access_client(p_client_id, v_permission) then
    raise exception using errcode = '42501',
      message = 'care communication mutation authority expired';
  end if;

  return query select
    v_operation_id, p_action, v_key, v_version_id, v_version,
    p_previous_version_id, v_record_kind, p_client_id,
    cardinality(v_recipient_ids), 'queued'::text, 'not_configured'::text,
    'not_configured'::text, 'none'::text, v_now, false;
end;
$$;

create or replace function private.care_communication_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_author_user_id uuid default null,
  p_delivery_status text default 'all',
  p_confirmation_status text default 'all',
  p_query text default '',
  p_interaction text default 'view'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  matching_total bigint,
  thread_total bigint,
  correction_total bigint,
  queued_total bigint,
  today_total bigint,
  attachment_total bigint,
  items_truncated boolean,
  client_options jsonb,
  author_options jsonb,
  can_manage boolean,
  can_correct boolean,
  category_boundary text,
  family_recipient_boundary text,
  attachment_pipeline_status text,
  provider_worker_status text,
  family_consumer_status text,
  offline_consumer_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_items jsonb;
  v_matching_total bigint;
  v_thread_total bigint;
  v_correction_total bigint;
  v_queued_total bigint;
  v_today_total bigint;
  v_attachment_total bigint;
  v_client_options jsonb;
  v_author_options jsonb;
  v_can_manage boolean;
  v_can_correct boolean;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_delivery_status not in ('all', 'queued')
     or p_confirmation_status not in ('all', 'not_configured')
     or p_interaction not in ('view', 'search')
     or char_length(v_query) > 120
     or v_query ~ '[[:cntrl:]]'
     or (p_date_from is not null and p_date_to is not null
       and p_date_from > p_date_to) then
    raise exception using errcode = '22023',
      message = 'care communication snapshot filters are invalid';
  end if;
  if not private.care_communication_authority(
    p_expected_organization_id, p_expected_branch_id,
    'care_communications.read', false
  ) then
    raise exception using errcode = '42501',
      message = 'care communication snapshot is not permitted';
  end if;
  if p_client_id is not null
     and not private.can_staff_access_client(
       p_client_id, 'care_communications.read'
     ) then
    raise exception using errcode = '42501',
      message = 'care communication client filter is not permitted';
  end if;
  v_can_manage := private.care_communication_authority(
    p_expected_organization_id, p_expected_branch_id,
    'care_communications.manage', true
  );
  v_can_correct := private.care_communication_authority(
    p_expected_organization_id, p_expected_branch_id,
    'care_communications.correct', true
  );

  with visible as materialized (
    select version_row.*,
      not exists (
        select 1 from public.care_communication_versions child
        where child.previous_version_id = version_row.id
      ) as is_current
    from public.care_communication_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.category = 'care_communication'
      and version_row.category <> 'consultant'
      and private.can_staff_access_client(
        version_row.client_id, 'care_communications.read'
      )
      and (p_client_id is null or version_row.client_id = p_client_id)
      and (p_author_user_id is null
        or version_row.author_user_id = p_author_user_id)
      and (p_date_from is null or
        (version_row.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (version_row.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (p_delivery_status = 'all'
        or version_row.delivery_status = p_delivery_status)
      and (p_confirmation_status = 'all'
        or version_row.family_confirmation_status = p_confirmation_status)
      and (v_query = '' or lower(
        version_row.subject || ' ' || version_row.body || ' ' ||
        version_row.author_display_name
      ) like '%' || v_query || '%')
  ), stats as (
    select count(*)::bigint as matching_total,
      count(distinct row.communication_key)::bigint as thread_total,
      count(*) filter (where row.record_kind = 'correction')::bigint
        as correction_total,
      count(*) filter (where row.is_current
        and row.delivery_status = 'queued')::bigint as queued_total,
      count(*) filter (where
        (row.submitted_at at time zone 'Asia/Taipei')::date =
        (v_now at time zone 'Asia/Taipei')::date)::bigint as today_total,
      count(*) filter (where row.attachment_state <> 'none')::bigint
        as attachment_total
    from visible row
  ), limited as materialized (
    select row.* from visible row
    order by row.occurred_at desc, row.submitted_at desc,
      row.communication_key, row.version desc
    limit 100
  )
  select stats.matching_total, stats.thread_total, stats.correction_total,
    stats.queued_total, stats.today_total, stats.attachment_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'version_id', item.id,
        'communication_key', item.communication_key,
        'version', item.version,
        'previous_version_id', item.previous_version_id,
        'record_kind', item.record_kind,
        'category', item.category,
        'direction', item.direction,
        'client_id', item.client_id,
        'client_display_name', item.client_display_name,
        'client_code', item.client_code,
        'subject', item.subject,
        'body', item.body,
        'occurred_at', item.occurred_at,
        'submitted_at', item.submitted_at,
        'author_display_name', item.author_display_name,
        'author_profile_kind', item.author_profile_kind,
        'correction_reason', item.correction_reason,
        'attachment_state', item.attachment_state,
        'recipient_count', item.recipient_count,
        'delivery_status', item.delivery_status,
        'read_status', item.read_status,
        'family_confirmation_status', item.family_confirmation_status,
        'is_current', item.is_current,
        'recipients', coalesce((
          select jsonb_agg(jsonb_build_object(
            'display_name', recipient.recipient_display_name,
            'profile_kind', recipient.recipient_profile_kind,
            'relationship', recipient.relationship,
            'consent_document_version', recipient.consent_document_version,
            'consent_scopes', to_jsonb(recipient.consent_scopes),
            'consented_at', recipient.consented_at,
            'consent_expires_at', recipient.consent_expires_at
          ) order by recipient.recipient_display_name,
            recipient.recipient_user_id)
          from public.care_communication_recipients recipient
          where recipient.communication_version_id = item.id
        ), '[]'::jsonb),
        'delivery_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'event_kind', event.event_kind,
            'channel', event.channel,
            'provider_worker_status', event.provider_worker_status,
            'family_consumer_status', event.family_consumer_status,
            'offline_consumer_status', event.offline_consumer_status,
            'occurred_at', event.occurred_at
          ) order by event.occurred_at, event.id)
          from public.care_communication_delivery_events event
          where event.communication_version_id = item.id
        ), '[]'::jsonb)
      ) order by item.occurred_at desc, item.submitted_at desc,
        item.communication_key, item.version desc)
      from limited item
    ), '[]'::jsonb)
  into v_matching_total, v_thread_total, v_correction_total,
    v_queued_total, v_today_total, v_attachment_total, v_items
  from stats;

  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', option.id,
    'display_name', option.display_name,
    'client_code', option.client_code,
    'authorized_family_count', option.authorized_family_count
  ) order by option.display_name, option.id), '[]'::jsonb)
  into v_client_options
  from (
    select client.id, client.display_name, client.client_code,
      (
        select count(distinct consent.recipient_user_id)::integer
        from public.consents consent
        join public.profiles profile
          on profile.id = consent.recipient_user_id
         and profile.kind = 'family' and profile.is_active
        where consent.organization_id = client.organization_id
          and consent.branch_id = client.branch_id
          and consent.client_id = client.id
          and consent.consented_at <= v_now
          and (consent.expires_at is null or consent.expires_at > v_now)
          and consent.revoked_at is null
          and 'messages.read' = any(consent.scopes)
      ) as authorized_family_count
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active'
      and private.can_staff_access_client(
        client.id, 'care_communications.read'
      )
    order by client.display_name, client.id
    limit 500
  ) option;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', option.author_user_id,
    'display_name', option.author_display_name
  ) order by option.author_display_name, option.author_user_id), '[]'::jsonb)
  into v_author_options
  from (
    select distinct version_row.author_user_id,
      version_row.author_display_name
    from public.care_communication_versions version_row
    where version_row.organization_id = p_expected_organization_id
      and version_row.branch_id = p_expected_branch_id
      and version_row.category = 'care_communication'
      and private.can_staff_access_client(
        version_row.client_id, 'care_communications.read'
      )
  ) option;

  if not private.care_communication_authority(
    p_expected_organization_id, p_expected_branch_id,
    'care_communications.read', false
  ) then
    raise exception using errcode = '42501',
      message = 'care communication snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'care_communication_snapshot', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page43_care_communication_v1',
      'interaction', p_interaction,
      'category', 'care_communication',
      'returned_count', jsonb_array_length(v_items),
      'matching_total', v_matching_total,
      'items_truncated', v_matching_total > jsonb_array_length(v_items),
      'family_recipient_boundary', 'active_messages_read_consent',
      'provider_worker_status', 'not_configured',
      'family_consumer_status', 'not_configured',
      'offline_consumer_status', 'not_configured',
      'attachment_pipeline_status', 'not_configured'
    )
  );

  return query select
    p_expected_organization_id, p_expected_branch_id, v_now, v_items,
    v_matching_total, v_thread_total, v_correction_total, v_queued_total,
    v_today_total, v_attachment_total,
    v_matching_total > jsonb_array_length(v_items),
    v_client_options, v_author_options, v_can_manage, v_can_correct,
    'care_communication_only'::text,
    'active_messages_read_consent'::text,
    'not_configured'::text, 'not_configured'::text,
    'not_configured'::text, 'not_configured'::text;
end;
$$;

create or replace function public.create_care_communication(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_subject text,
  p_body text,
  p_occurred_at timestamptz,
  p_attachments jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, communication_key uuid,
  version_id uuid, communication_version integer,
  previous_version_id uuid, record_kind text, client_id uuid,
  recipient_count integer, delivery_status text, read_status text,
  family_confirmation_status text, attachment_state text,
  submitted_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.mutate_care_communication_atomic(
    'create', p_expected_organization_id, p_expected_branch_id, p_client_id,
    null, null, 0, p_subject, p_body, p_occurred_at, null,
    p_attachments, p_idempotency_key
  );
$$;

create or replace function public.correct_care_communication(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_communication_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_subject text,
  p_body text,
  p_correction_reason text,
  p_attachments jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, communication_key uuid,
  version_id uuid, communication_version integer,
  previous_version_id uuid, record_kind text, client_id uuid,
  recipient_count integer, delivery_status text, read_status text,
  family_confirmation_status text, attachment_state text,
  submitted_at timestamptz, replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.mutate_care_communication_atomic(
    'correct', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_communication_key, p_previous_version_id, p_expected_version,
    p_subject, p_body, null, p_correction_reason,
    p_attachments, p_idempotency_key
  );
$$;

create or replace function public.care_communication_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_author_user_id uuid default null,
  p_delivery_status text default 'all',
  p_confirmation_status text default 'all',
  p_query text default '',
  p_interaction text default 'view'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  items jsonb, matching_total bigint, thread_total bigint,
  correction_total bigint, queued_total bigint, today_total bigint,
  attachment_total bigint, items_truncated boolean, client_options jsonb,
  author_options jsonb, can_manage boolean, can_correct boolean,
  category_boundary text, family_recipient_boundary text,
  attachment_pipeline_status text, provider_worker_status text,
  family_consumer_status text, offline_consumer_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.care_communication_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_date_from, p_date_to, p_author_user_id, p_delivery_status,
    p_confirmation_status, p_query, p_interaction
  );
$$;

comment on function public.create_care_communication(
  uuid, uuid, uuid, text, text, timestamptz, jsonb, uuid
) is 'Appends one client-scoped care communication and authorized family consent snapshots; delivery remains queued while consumers are not configured.';
comment on function public.correct_care_communication(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, jsonb, uuid
) is 'Appends a narrow correction without rewriting the original communication or changing its client, occurrence time or recipient set.';
comment on function public.care_communication_snapshot(
  uuid, uuid, uuid, date, date, uuid, text, text, text, text
) is 'Returns an audited assigned-client Page-43 snapshot classified separately from consultant messages.';

revoke all on table public.care_communication_versions
  from public, anon, authenticated, service_role;
revoke all on table public.care_communication_recipients
  from public, anon, authenticated, service_role;
revoke all on table public.care_communication_attachments
  from public, anon, authenticated, service_role;
revoke all on table public.care_communication_delivery_events
  from public, anon, authenticated, service_role;
revoke all on table private.care_communication_operations
  from public, anon, authenticated, service_role;

revoke all on function private.prevent_care_communication_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.care_communication_authority(
  uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.mutate_care_communication_atomic(
  text, uuid, uuid, uuid, uuid, uuid, integer, text, text, timestamptz,
  text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.care_communication_snapshot_response(
  uuid, uuid, uuid, date, date, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_care_communication(
  uuid, uuid, uuid, text, text, timestamptz, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.correct_care_communication(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.care_communication_snapshot(
  uuid, uuid, uuid, date, date, uuid, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function private.mutate_care_communication_atomic(
  text, uuid, uuid, uuid, uuid, uuid, integer, text, text, timestamptz,
  text, jsonb, uuid
) to authenticated;
grant execute on function private.care_communication_snapshot_response(
  uuid, uuid, uuid, date, date, uuid, text, text, text, text
) to authenticated;
grant execute on function public.create_care_communication(
  uuid, uuid, uuid, text, text, timestamptz, jsonb, uuid
) to authenticated;
grant execute on function public.correct_care_communication(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, jsonb, uuid
) to authenticated;
grant execute on function public.care_communication_snapshot(
  uuid, uuid, uuid, date, date, uuid, text, text, text, text
) to authenticated;
