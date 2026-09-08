-- Page 76: branch-scoped consultant messages.
--
-- This is a separate in-app message stream.  It never reads from or writes to
-- the general notification/announcement streams, and the immutable category
-- discriminator is always `consultant`.  A recipient is frozen only when the
-- selected professional currently holds both consultant message read and
-- receive permissions in the selected branch.  No external delivery is
-- claimed.  The trusted upload/scan pipeline is not configured in R0, so all
-- attachment-bearing creates fail closed before any message is persisted.

insert into public.permissions (permission_key, description, risk_level) values
  ('consultant_messages.read', 'Read the dedicated consultant message entry point', 1),
  ('consultant_messages.manage', 'Create branch consultant messages and inspect recipient receipts', 2),
  ('consultant_messages.receive', 'Receive and acknowledge consultant messages as a professional', 2)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor',
    'case_manager_social_worker', 'professional'
  )
  and permission.permission_key = 'consultant_messages.read'
on conflict (role_id, permission_id) do nothing;

create or replace function private.text_array_is_sorted_unique_page76(
  p_values text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_values is not null
    and cardinality(p_values) between 1 and 20
    and p_values = array(
      select distinct value
      from unnest(p_values) value
      where value = btrim(value)
        and char_length(value) between 1 and 120
        and value !~ '[[:cntrl:]]'
      order by value
    );
$$;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker'
  )
  and permission.permission_key = 'consultant_messages.manage'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key = 'professional'
  and permission.permission_key = 'consultant_messages.receive'
on conflict (role_id, permission_id) do nothing;

create table public.consultant_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  category text not null default 'consultant',
  subject text not null,
  body text not null,
  occurred_at timestamptz not null,
  published_at timestamptz not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  author_profile_kind text not null,
  recipient_count integer not null,
  content_hash text not null,
  created_at timestamptz not null,
  constraint consultant_messages_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint consultant_messages_id_scope_key
    unique (id, organization_id, branch_id),
  constraint consultant_messages_category_check check (category = 'consultant'),
  constraint consultant_messages_subject_check check (
    subject = btrim(subject)
    and char_length(subject) between 1 and 200
    and subject !~ '[[:cntrl:]]'
  ),
  constraint consultant_messages_body_check check (
    body = btrim(body)
    and char_length(body) between 1 and 10000
    and body !~ '[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]'
  ),
  constraint consultant_messages_times_check check (
    isfinite(occurred_at)
    and isfinite(published_at)
    and isfinite(created_at)
    and published_at = created_at
  ),
  constraint consultant_messages_author_check check (
    author_profile_kind = 'staff'
    and author_display_name = btrim(author_display_name)
    and char_length(author_display_name) between 1 and 120
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint consultant_messages_recipient_count_check
    check (recipient_count between 1 and 100),
  constraint consultant_messages_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.consultant_message_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  message_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_membership_id uuid not null references public.memberships(id) on delete restrict,
  recipient_display_name text not null,
  recipient_employee_code text,
  recipient_profile_kind text not null,
  role_names text[] not null,
  frozen_at timestamptz not null,
  constraint consultant_message_recipients_message_scope_fkey
    foreign key (message_id, organization_id, branch_id)
    references public.consultant_messages(id, organization_id, branch_id)
    on delete restrict,
  constraint consultant_message_recipients_id_scope_key
    unique (id, organization_id, branch_id),
  constraint consultant_message_recipients_message_user_key
    unique (message_id, recipient_user_id),
  constraint consultant_message_recipients_profile_check check (
    recipient_profile_kind = 'professional'
    and recipient_display_name = btrim(recipient_display_name)
    and char_length(recipient_display_name) between 1 and 120
    and recipient_display_name !~ '[[:cntrl:]]'
    and (recipient_employee_code is null or (
      recipient_employee_code = btrim(recipient_employee_code)
      and char_length(recipient_employee_code) between 1 and 120
      and recipient_employee_code !~ '[[:cntrl:]]'
    ))
  ),
  constraint consultant_message_recipients_role_names_check check (
    private.text_array_is_sorted_unique_page76(role_names)
  ),
  constraint consultant_message_recipients_frozen_at_check
    check (isfinite(frozen_at))
);

create table public.consultant_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  message_id uuid not null,
  trusted_reference text not null,
  sha256 text not null,
  scan_status text not null,
  scanned_at timestamptz not null,
  attached_at timestamptz not null,
  constraint consultant_message_attachments_message_scope_fkey
    foreign key (message_id, organization_id, branch_id)
    references public.consultant_messages(id, organization_id, branch_id)
    on delete restrict,
  constraint consultant_message_attachments_reference_key
    unique (message_id, trusted_reference),
  constraint consultant_message_attachments_reference_check check (
    trusted_reference ~ '^trusted-upload:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and trusted_reference !~ '(^|/)(\.\.?)(/|$)'
    and trusted_reference !~* '^(https?|file|data|javascript):'
  ),
  constraint consultant_message_attachments_hash_check
    check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint consultant_message_attachments_scan_check check (
    scan_status = 'clean'
    and isfinite(scanned_at)
    and isfinite(attached_at)
    and scanned_at <= attached_at
  )
);

create table public.consultant_message_receipt_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  message_id uuid not null,
  recipient_user_id uuid not null,
  receipt_kind text not null,
  occurred_at timestamptz not null,
  constraint consultant_message_receipt_message_scope_fkey
    foreign key (message_id, organization_id, branch_id)
    references public.consultant_messages(id, organization_id, branch_id)
    on delete restrict,
  constraint consultant_message_receipt_recipient_fkey
    foreign key (message_id, recipient_user_id)
    references public.consultant_message_recipients(message_id, recipient_user_id)
    on delete restrict,
  constraint consultant_message_receipt_unique
    unique (message_id, recipient_user_id, receipt_kind),
  constraint consultant_message_receipt_kind_check
    check (receipt_kind in ('read', 'confirmed')),
  constraint consultant_message_receipt_time_check check (isfinite(occurred_at))
);

create table private.consultant_message_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  message_id uuid not null,
  result_payload jsonb not null,
  created_at timestamptz not null,
  constraint consultant_message_operations_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint consultant_message_operations_actor_key
    unique (organization_id, branch_id, actor_user_id, idempotency_key),
  constraint consultant_message_operations_action_check
    check (action in ('create', 'read', 'confirm')),
  constraint consultant_message_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint consultant_message_operations_result_check
    check (jsonb_typeof(result_payload) = 'object' and isfinite(created_at))
);

create index consultant_messages_scope_history_idx
  on public.consultant_messages (
    organization_id, branch_id, occurred_at desc, published_at desc, id desc
  );
create index consultant_messages_author_user_idx
  on public.consultant_messages (author_user_id);
create index consultant_message_recipients_user_scope_idx
  on public.consultant_message_recipients (
    recipient_user_id, organization_id, branch_id, message_id
  );
create index consultant_message_recipients_membership_idx
  on public.consultant_message_recipients (recipient_membership_id);
create index consultant_message_attachments_scope_idx
  on public.consultant_message_attachments (
    organization_id, branch_id, message_id
  );
create index consultant_message_receipts_scope_idx
  on public.consultant_message_receipt_events (
    organization_id, branch_id, message_id, recipient_user_id, receipt_kind
  );
create index consultant_message_operations_message_idx
  on private.consultant_message_operations (message_id, created_at desc);

alter table public.consultant_messages enable row level security;
alter table public.consultant_messages force row level security;
alter table public.consultant_message_recipients enable row level security;
alter table public.consultant_message_recipients force row level security;
alter table public.consultant_message_attachments enable row level security;
alter table public.consultant_message_attachments force row level security;
alter table public.consultant_message_receipt_events enable row level security;
alter table public.consultant_message_receipt_events force row level security;
alter table private.consultant_message_operations enable row level security;
alter table private.consultant_message_operations force row level security;

create or replace function private.prevent_consultant_message_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger consultant_messages_prevent_mutation
before update or delete on public.consultant_messages
for each row execute function private.prevent_consultant_message_mutation();
create trigger consultant_message_recipients_prevent_mutation
before update or delete on public.consultant_message_recipients
for each row execute function private.prevent_consultant_message_mutation();
create trigger consultant_message_attachments_prevent_mutation
before update or delete on public.consultant_message_attachments
for each row execute function private.prevent_consultant_message_mutation();
create trigger consultant_message_receipts_prevent_mutation
before update or delete on public.consultant_message_receipt_events
for each row execute function private.prevent_consultant_message_mutation();
create trigger consultant_message_operations_prevent_mutation
before update or delete on private.consultant_message_operations
for each row execute function private.prevent_consultant_message_mutation();

create trigger consultant_messages_audit_row_change
after insert on public.consultant_messages
for each row execute function private.audit_row_change();
create trigger consultant_message_recipients_audit_row_change
after insert on public.consultant_message_recipients
for each row execute function private.audit_row_change();
create trigger consultant_message_attachments_audit_row_change
after insert on public.consultant_message_attachments
for each row execute function private.audit_row_change();
create trigger consultant_message_receipt_events_audit_row_change
after insert on public.consultant_message_receipt_events
for each row execute function private.audit_row_change();

create or replace function private.consultant_message_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission_key text,
  p_required_kind public.profile_kind default null
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
      from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.is_active
        and profile.kind in ('staff', 'professional')
        and (p_required_kind is null or profile.kind = p_required_kind)
    )
    and private.has_permission(
      p_organization_id, p_branch_id, p_permission_key
    );
$$;

create or replace function private.consultant_recipient_is_eligible(
  p_organization_id uuid,
  p_branch_id uuid,
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
    where profile.id = p_user_id
      and profile.kind = 'professional'
      and profile.is_active
      and exists (
        select 1
        from public.memberships membership
        join public.membership_roles assignment
          on assignment.membership_id = membership.id
        join public.roles role
          on role.id = assignment.role_id
         and role.is_active
         and (role.organization_id is null
           or role.organization_id = p_organization_id)
        join public.role_permissions grant_row
          on grant_row.role_id = role.id
        join public.permissions permission
          on permission.id = grant_row.permission_id
        where membership.profile_id = p_user_id
          and membership.organization_id = p_organization_id
          and (membership.branch_id is null or membership.branch_id = p_branch_id)
          and membership.status = 'active'
          and membership.starts_at <= clock_timestamp()
          and (membership.ends_at is null
            or membership.ends_at > clock_timestamp())
        group by membership.profile_id
        having bool_or(permission.permission_key = 'consultant_messages.read')
          and bool_or(permission.permission_key = 'consultant_messages.receive')
      )
  );
$$;

create or replace function private.uuid_array_is_sorted_unique_page76(
  p_values uuid[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_values is not null
    and cardinality(p_values) between 1 and 100
    and p_values = array(
      select distinct value
      from unnest(p_values) value
      order by value
    );
$$;

create or replace function private.create_consultant_message_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_subject text,
  p_body text,
  p_occurred_at timestamptz,
  p_recipient_user_ids uuid[],
  p_attachments jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  message_id uuid,
  category text,
  recipient_count integer,
  published_at timestamptz,
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
  v_request_hash text;
  v_message_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_operation private.consultant_message_operations%rowtype;
  v_author public.profiles%rowtype;
  v_content_hash text;
  v_inserted integer;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_idempotency_key is null
     or p_occurred_at is null
     or not isfinite(p_occurred_at)
     or not private.uuid_array_is_sorted_unique_page76(p_recipient_user_ids)
     or p_attachments is null
     or jsonb_typeof(p_attachments) <> 'array' then
    raise exception using errcode = '22023',
      message = 'consultant message scope, time, recipients, attachments, and idempotency key are required';
  end if;

  if jsonb_array_length(p_attachments) > 0 then
    raise exception using errcode = '55000',
      message = 'consultant message attachment pipeline is not configured';
  end if;

  if v_subject is null
     or char_length(v_subject) not between 1 and 200
     or v_subject ~ '[[:cntrl:]]'
     or v_body is null
     or char_length(v_body) not between 1 and 10000
     or v_body ~ '[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]'
     or p_occurred_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023',
      message = 'consultant message content or occurrence time is invalid';
  end if;

  if not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.manage',
    'staff'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message create is not permitted';
  end if;

  select * into v_author
  from public.profiles profile
  where profile.id = v_actor
    and profile.kind = 'staff'
    and profile.is_active;
  if not found then
    raise exception using errcode = '42501',
      message = 'consultant message create is not permitted';
  end if;

  select count(*)::integer into v_inserted
  from unnest(p_recipient_user_ids) recipient(user_id)
  where private.consultant_recipient_is_eligible(
    p_expected_organization_id,
    p_expected_branch_id,
    recipient.user_id
  );
  if v_inserted <> cardinality(p_recipient_user_ids) then
    raise exception using errcode = '42501',
      message = 'consultant message recipient is outside the active professional scope';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'action', 'create',
    'subject', v_subject,
    'body', v_body,
    'occurred_at', p_occurred_at,
    'recipient_user_ids', to_jsonb(p_recipient_user_ids),
    'attachments', p_attachments
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_idempotency_key::text, 76
  ));
  select * into v_operation
  from private.consultant_message_operations operation
  where operation.organization_id = p_expected_organization_id
    and operation.branch_id = p_expected_branch_id
    and operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.action <> 'create'
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'consultant message idempotency conflict';
    end if;
    return query select
      v_operation.id,
      (v_operation.result_payload ->> 'message_id')::uuid,
      v_operation.result_payload ->> 'category',
      (v_operation.result_payload ->> 'recipient_count')::integer,
      (v_operation.result_payload ->> 'published_at')::timestamptz,
      true;
    return;
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'category', 'consultant',
    'subject', v_subject,
    'body', v_body,
    'occurred_at', p_occurred_at,
    'published_at', v_now,
    'author_user_id', v_actor,
    'recipient_user_ids', to_jsonb(p_recipient_user_ids),
    'attachments', p_attachments
  )::text, 'UTF8')), 'hex');

  insert into public.consultant_messages (
    id, organization_id, branch_id, category, subject, body,
    occurred_at, published_at, author_user_id, author_display_name,
    author_profile_kind, recipient_count, content_hash, created_at
  ) values (
    v_message_id, p_expected_organization_id, p_expected_branch_id,
    'consultant', v_subject, v_body, p_occurred_at, v_now, v_actor,
    v_author.display_name, v_author.kind::text,
    cardinality(p_recipient_user_ids), v_content_hash, v_now
  );

  insert into public.consultant_message_recipients (
    organization_id, branch_id, message_id, recipient_user_id,
    recipient_membership_id, recipient_display_name,
    recipient_employee_code, recipient_profile_kind, role_names, frozen_at
  )
  select
    p_expected_organization_id,
    p_expected_branch_id,
    v_message_id,
    recipient.user_id,
    chosen_membership.id,
    profile.display_name,
    profile.employee_code,
    profile.kind::text,
    role_snapshot.role_names,
    v_now
  from unnest(p_recipient_user_ids) recipient(user_id)
  join public.profiles profile on profile.id = recipient.user_id
  cross join lateral (
    select membership.id
    from public.memberships membership
    where membership.profile_id = recipient.user_id
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null
        or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
    order by (membership.branch_id is null), membership.starts_at desc, membership.id
    limit 1
  ) chosen_membership
  cross join lateral (
    select array_agg(distinct role.name order by role.name) as role_names
    from public.memberships membership
    join public.membership_roles assignment
      on assignment.membership_id = membership.id
    join public.roles role
      on role.id = assignment.role_id
     and role.is_active
     and (role.organization_id is null
       or role.organization_id = p_expected_organization_id)
    join public.role_permissions grant_row on grant_row.role_id = role.id
    join public.permissions permission on permission.id = grant_row.permission_id
    where membership.profile_id = recipient.user_id
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null
        or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and permission.permission_key = 'consultant_messages.receive'
  ) role_snapshot;
  get diagnostics v_inserted = row_count;
  if v_inserted <> cardinality(p_recipient_user_ids) then
    raise exception using errcode = '42501',
      message = 'consultant message recipient snapshot could not be frozen';
  end if;

  insert into private.consultant_message_operations (
    id, organization_id, branch_id, actor_user_id, action,
    idempotency_key, request_hash, message_id, result_payload, created_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id,
    v_actor, 'create', p_idempotency_key, v_request_hash, v_message_id,
    jsonb_build_object(
      'message_id', v_message_id,
      'category', 'consultant',
      'recipient_count', cardinality(p_recipient_user_ids),
      'published_at', v_now
    ),
    v_now
  );

  if not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.manage',
    'staff'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message create authority expired';
  end if;

  return query select
    v_operation_id, v_message_id, 'consultant'::text,
    cardinality(p_recipient_user_ids), v_now, false;
end;
$$;

create or replace function private.acknowledge_consultant_message_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_message_id uuid,
  p_action text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  message_id uuid,
  category text,
  action text,
  read_at timestamptz,
  confirmed_at timestamptz,
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
  v_request_hash text;
  v_operation_id uuid := gen_random_uuid();
  v_operation private.consultant_message_operations%rowtype;
  v_read_at timestamptz;
  v_confirmed_at timestamptz;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_message_id is null
     or p_action not in ('read', 'confirm')
     or p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'consultant message receipt input is invalid';
  end if;

  if not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.read',
    'professional'
  ) or not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.receive',
    'professional'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message acknowledgement is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'message_id', p_message_id,
    'action', p_action
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_idempotency_key::text, 76
  ));
  select * into v_operation
  from private.consultant_message_operations operation
  where operation.organization_id = p_expected_organization_id
    and operation.branch_id = p_expected_branch_id
    and operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.action <> p_action
       or v_operation.request_hash <> v_request_hash
       or v_operation.message_id <> p_message_id then
      raise exception using errcode = '23505',
        message = 'consultant message idempotency conflict';
    end if;
    return query select
      v_operation.id,
      v_operation.message_id,
      v_operation.result_payload ->> 'category',
      v_operation.action,
      (v_operation.result_payload ->> 'read_at')::timestamptz,
      nullif(v_operation.result_payload ->> 'confirmed_at', '')::timestamptz,
      true;
    return;
  end if;

  perform 1
  from public.consultant_message_recipients recipient
  join public.consultant_messages message
    on message.id = recipient.message_id
   and message.organization_id = recipient.organization_id
   and message.branch_id = recipient.branch_id
   and message.category = 'consultant'
  where recipient.organization_id = p_expected_organization_id
    and recipient.branch_id = p_expected_branch_id
    and recipient.message_id = p_message_id
    and recipient.recipient_user_id = v_actor
  for update of recipient;
  if not found then
    raise exception using errcode = '42501',
      message = 'consultant message acknowledgement is not permitted';
  end if;

  insert into public.consultant_message_receipt_events (
    organization_id, branch_id, message_id, recipient_user_id,
    receipt_kind, occurred_at
  ) values (
    p_expected_organization_id, p_expected_branch_id,
    p_message_id, v_actor, 'read', v_now
  ) on conflict on constraint consultant_message_receipt_unique do nothing;

  if p_action = 'confirm' then
    insert into public.consultant_message_receipt_events (
      organization_id, branch_id, message_id, recipient_user_id,
      receipt_kind, occurred_at
    ) values (
      p_expected_organization_id, p_expected_branch_id,
      p_message_id, v_actor, 'confirmed', v_now
    ) on conflict on constraint consultant_message_receipt_unique do nothing;
  end if;

  select
    min(event.occurred_at) filter (where event.receipt_kind = 'read'),
    min(event.occurred_at) filter (where event.receipt_kind = 'confirmed')
  into v_read_at, v_confirmed_at
  from public.consultant_message_receipt_events event
  where event.message_id = p_message_id
    and event.recipient_user_id = v_actor;
  if v_read_at is null or (p_action = 'confirm' and v_confirmed_at is null) then
    raise exception using errcode = '40001',
      message = 'consultant message receipt could not be verified';
  end if;

  insert into private.consultant_message_operations (
    id, organization_id, branch_id, actor_user_id, action,
    idempotency_key, request_hash, message_id, result_payload, created_at
  ) values (
    v_operation_id, p_expected_organization_id, p_expected_branch_id,
    v_actor, p_action, p_idempotency_key, v_request_hash, p_message_id,
    jsonb_build_object(
      'message_id', p_message_id,
      'category', 'consultant',
      'action', p_action,
      'read_at', v_read_at,
      'confirmed_at', v_confirmed_at
    ),
    v_now
  );

  if not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.read',
    'professional'
  ) or not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.receive',
    'professional'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message acknowledgement authority expired';
  end if;

  return query select
    v_operation_id, p_message_id, 'consultant'::text,
    p_action, v_read_at, v_confirmed_at, false;
end;
$$;

create or replace function private.consultant_message_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_consultant_user_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default 'all',
  p_query text default '',
  p_interaction text default 'view'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  message_total bigint,
  unread_total bigint,
  today_total bigint,
  attachment_total bigint,
  confirmation_pending_total bigint,
  items_truncated boolean,
  can_manage boolean,
  recipient_options jsonb,
  category_boundary text,
  delivery_boundary text,
  attachment_pipeline_status text,
  attachment_scan_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_manage boolean;
  v_receive boolean;
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_items jsonb;
  v_message_total bigint;
  v_unread_total bigint;
  v_today_total bigint;
  v_attachment_total bigint;
  v_pending_total bigint;
  v_recipient_options jsonb := '[]'::jsonb;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_status not in ('all', 'unread', 'read', 'confirmed', 'unconfirmed')
     or p_interaction not in ('view', 'search')
     or char_length(v_query) > 120
     or v_query ~ '[[:cntrl:]]'
     or (p_date_from is not null and p_date_to is not null
       and p_date_from > p_date_to) then
    raise exception using errcode = '22023',
      message = 'consultant message snapshot filters are invalid';
  end if;

  if not private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.read'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message snapshot is not permitted';
  end if;
  v_manage := private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.manage',
    'staff'
  );
  v_receive := private.consultant_message_authority(
    p_expected_organization_id,
    p_expected_branch_id,
    'consultant_messages.receive',
    'professional'
  );
  if not v_manage and not v_receive then
    raise exception using errcode = '42501',
      message = 'consultant message snapshot is not permitted';
  end if;
  if not v_manage
     and p_consultant_user_id is not null
     and p_consultant_user_id <> v_actor then
    raise exception using errcode = '42501',
      message = 'consultant message snapshot consultant filter is not permitted';
  end if;

  with message_rows as materialized (
    select
      message.*,
      coalesce(receipt_stats.read_count, 0)::integer as read_count,
      coalesce(receipt_stats.confirmed_count, 0)::integer as confirmed_count,
      actor_receipt.read_at as actor_read_at,
      actor_receipt.confirmed_at as actor_confirmed_at,
      coalesce(attachment_stats.attachment_count, 0)::integer as attachment_count,
      case
        when v_manage then message.recipient_count - coalesce(receipt_stats.read_count, 0)
        when actor_receipt.read_at is null then 1 else 0
      end::integer as visible_unread,
      case
        when v_manage then message.recipient_count - coalesce(receipt_stats.confirmed_count, 0)
        when actor_receipt.confirmed_at is null then 1 else 0
      end::integer as visible_pending
    from public.consultant_messages message
    left join lateral (
      select
        count(*) filter (where receipt.receipt_kind = 'read') as read_count,
        count(*) filter (where receipt.receipt_kind = 'confirmed') as confirmed_count
      from public.consultant_message_receipt_events receipt
      where receipt.message_id = message.id
    ) receipt_stats on true
    left join lateral (
      select
        min(receipt.occurred_at) filter (where receipt.receipt_kind = 'read') as read_at,
        min(receipt.occurred_at) filter (where receipt.receipt_kind = 'confirmed') as confirmed_at
      from public.consultant_message_receipt_events receipt
      where receipt.message_id = message.id
        and receipt.recipient_user_id = v_actor
    ) actor_receipt on true
    left join lateral (
      select count(*) as attachment_count
      from public.consultant_message_attachments attachment
      where attachment.message_id = message.id
        and attachment.scan_status = 'clean'
    ) attachment_stats on true
    where message.organization_id = p_expected_organization_id
      and message.branch_id = p_expected_branch_id
      and message.category = 'consultant'
      and (
        v_manage or exists (
          select 1
          from public.consultant_message_recipients recipient
          where recipient.message_id = message.id
            and recipient.recipient_user_id = v_actor
        )
      )
      and (p_consultant_user_id is null or exists (
        select 1
        from public.consultant_message_recipients recipient
        where recipient.message_id = message.id
          and recipient.recipient_user_id = p_consultant_user_id
      ))
      and (p_date_from is null or
        (message.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (message.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (v_query = '' or lower(message.subject || ' ' || message.body || ' ' || message.author_display_name)
        like '%' || v_query || '%')
  ), filtered as materialized (
    select *
    from message_rows row
    where p_status = 'all'
      or (p_status = 'unread' and row.visible_unread > 0)
      or (p_status = 'read' and row.visible_unread = 0)
      or (p_status = 'confirmed' and row.visible_pending = 0)
      or (p_status = 'unconfirmed' and row.visible_pending > 0)
  ), stats as (
    select
      count(*)::bigint as message_total,
      coalesce(sum(row.visible_unread), 0)::bigint as unread_total,
      count(*) filter (
        where (row.occurred_at at time zone 'Asia/Taipei')::date =
          (v_now at time zone 'Asia/Taipei')::date
      )::bigint as today_total,
      coalesce(sum(row.attachment_count), 0)::bigint as attachment_total,
      coalesce(sum(row.visible_pending), 0)::bigint as pending_total
    from filtered row
  ), limited as materialized (
    select row.*
    from filtered row
    order by row.occurred_at desc, row.published_at desc, row.id desc
    limit 100
  )
  select
    stats.message_total,
    stats.unread_total,
    stats.today_total,
    stats.attachment_total,
    stats.pending_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'message_id', item.id,
        'category', item.category,
        'subject', item.subject,
        'body', item.body,
        'occurred_at', item.occurred_at,
        'published_at', item.published_at,
        'author_display_name', item.author_display_name,
        'author_profile_kind', item.author_profile_kind,
        'recipient_count', item.recipient_count,
        'read_count', item.read_count,
        'confirmed_count', item.confirmed_count,
        'actor_is_recipient', item.actor_read_at is not null
          or exists (
            select 1 from public.consultant_message_recipients own_recipient
            where own_recipient.message_id = item.id
              and own_recipient.recipient_user_id = v_actor
          ),
        'actor_read_at', item.actor_read_at,
        'actor_confirmed_at', item.actor_confirmed_at,
        'attachment_count', item.attachment_count,
        'recipients', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', recipient.recipient_user_id,
            'display_name', recipient.recipient_display_name,
            'employee_code', recipient.recipient_employee_code,
            'profile_kind', recipient.recipient_profile_kind,
            'role_names', to_jsonb(recipient.role_names),
            'read_at', receipt.read_at,
            'confirmed_at', receipt.confirmed_at
          ) order by recipient.recipient_display_name, recipient.recipient_user_id)
          from public.consultant_message_recipients recipient
          left join lateral (
            select
              min(event.occurred_at) filter (where event.receipt_kind = 'read') as read_at,
              min(event.occurred_at) filter (where event.receipt_kind = 'confirmed') as confirmed_at
            from public.consultant_message_receipt_events event
            where event.message_id = recipient.message_id
              and event.recipient_user_id = recipient.recipient_user_id
          ) receipt on true
          where recipient.message_id = item.id
            and (v_manage or recipient.recipient_user_id = v_actor)
        ), '[]'::jsonb)
      ) order by item.occurred_at desc, item.published_at desc, item.id desc)
      from limited item
    ), '[]'::jsonb)
  into
    v_message_total, v_unread_total, v_today_total,
    v_attachment_total, v_pending_total, v_items
  from stats;

  if v_manage then
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', option.user_id,
      'display_name', option.display_name,
      'employee_code', option.employee_code,
      'profile_kind', option.profile_kind,
      'role_names', to_jsonb(option.role_names)
    ) order by option.display_name, option.user_id), '[]'::jsonb)
    into v_recipient_options
    from (
      select distinct on (profile.id)
        profile.id as user_id,
        profile.display_name,
        profile.employee_code,
        profile.kind::text as profile_kind,
        (
          select array_agg(distinct role.name order by role.name)
          from public.memberships candidate_membership
          join public.membership_roles assignment
            on assignment.membership_id = candidate_membership.id
          join public.roles role
            on role.id = assignment.role_id
           and role.is_active
           and (role.organization_id is null
             or role.organization_id = p_expected_organization_id)
          join public.role_permissions grant_row
            on grant_row.role_id = role.id
          join public.permissions permission
            on permission.id = grant_row.permission_id
          where candidate_membership.profile_id = profile.id
            and candidate_membership.organization_id = p_expected_organization_id
            and (candidate_membership.branch_id is null
              or candidate_membership.branch_id = p_expected_branch_id)
            and candidate_membership.status = 'active'
            and candidate_membership.starts_at <= v_now
            and (candidate_membership.ends_at is null
              or candidate_membership.ends_at > v_now)
            and permission.permission_key = 'consultant_messages.receive'
        ) as role_names
      from public.profiles profile
      where profile.kind = 'professional'
        and profile.is_active
        and private.consultant_recipient_is_eligible(
          p_expected_organization_id, p_expected_branch_id, profile.id
        )
      order by profile.id
      limit 500
    ) option;
  end if;

  if not private.consultant_message_authority(
    p_expected_organization_id, p_expected_branch_id, 'consultant_messages.read'
  ) or v_manage <> private.consultant_message_authority(
    p_expected_organization_id, p_expected_branch_id,
    'consultant_messages.manage', 'staff'
  ) or v_receive <> private.consultant_message_authority(
    p_expected_organization_id, p_expected_branch_id,
    'consultant_messages.receive', 'professional'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'consultant_message_snapshot', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page76_consultant_only_v1',
      'interaction', p_interaction,
      'category', 'consultant',
      'returned_count', jsonb_array_length(v_items),
      'message_total', v_message_total,
      'items_truncated', v_message_total > jsonb_array_length(v_items),
      'can_manage', v_manage,
      'delivery_boundary', 'in_app_only',
      'attachment_pipeline_status', 'not_configured'
    )
  );

  if not private.consultant_message_authority(
    p_expected_organization_id, p_expected_branch_id, 'consultant_messages.read'
  ) or v_manage <> private.consultant_message_authority(
    p_expected_organization_id, p_expected_branch_id,
    'consultant_messages.manage', 'staff'
  ) or v_receive <> private.consultant_message_authority(
    p_expected_organization_id, p_expected_branch_id,
    'consultant_messages.receive', 'professional'
  ) then
    raise exception using errcode = '42501',
      message = 'consultant message snapshot authority expired after audit';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_items,
    v_message_total,
    v_unread_total,
    v_today_total,
    v_attachment_total,
    v_pending_total,
    v_message_total > jsonb_array_length(v_items),
    v_manage,
    v_recipient_options,
    'consultant_only'::text,
    'in_app_only'::text,
    'not_configured'::text,
    'not_configured'::text;
end;
$$;

create or replace function public.create_consultant_message(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_subject text,
  p_body text,
  p_occurred_at timestamptz,
  p_recipient_user_ids uuid[],
  p_attachments jsonb,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  message_id uuid,
  category text,
  recipient_count integer,
  published_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.create_consultant_message_atomic(
    p_expected_organization_id, p_expected_branch_id,
    p_subject, p_body, p_occurred_at, p_recipient_user_ids,
    p_attachments, p_idempotency_key
  );
$$;

create or replace function public.acknowledge_consultant_message(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_message_id uuid,
  p_action text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  message_id uuid,
  category text,
  action text,
  read_at timestamptz,
  confirmed_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.acknowledge_consultant_message_atomic(
    p_expected_organization_id, p_expected_branch_id,
    p_message_id, p_action, p_idempotency_key
  );
$$;

create or replace function public.consultant_message_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_consultant_user_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default 'all',
  p_query text default '',
  p_interaction text default 'view'
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  message_total bigint,
  unread_total bigint,
  today_total bigint,
  attachment_total bigint,
  confirmation_pending_total bigint,
  items_truncated boolean,
  can_manage boolean,
  recipient_options jsonb,
  category_boundary text,
  delivery_boundary text,
  attachment_pipeline_status text,
  attachment_scan_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.consultant_message_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_consultant_user_id, p_date_from, p_date_to,
    p_status, p_query, p_interaction
  );
$$;

comment on function public.create_consultant_message(
  uuid, uuid, text, text, timestamptz, uuid[], jsonb, uuid
) is 'Creates one immutable consultant-only in-app message with a frozen professional recipient snapshot; attachments fail closed while the trusted pipeline is not configured.';
comment on function public.acknowledge_consultant_message(
  uuid, uuid, uuid, text, uuid
) is 'Appends recipient-owned read or confirmation evidence for one consultant message.';
comment on function public.consultant_message_snapshot(
  uuid, uuid, uuid, date, date, text, text, text
) is 'Returns one bounded, audited consultant-only Page-76 snapshot; it never queries general messages or claims external delivery.';

revoke all on table public.consultant_messages
  from public, anon, authenticated, service_role;
revoke all on table public.consultant_message_recipients
  from public, anon, authenticated, service_role;
revoke all on table public.consultant_message_attachments
  from public, anon, authenticated, service_role;
revoke all on table public.consultant_message_receipt_events
  from public, anon, authenticated, service_role;
revoke all on table private.consultant_message_operations
  from public, anon, authenticated, service_role;

revoke all on function private.prevent_consultant_message_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.text_array_is_sorted_unique_page76(text[])
  from public, anon, authenticated, service_role;
revoke all on function private.consultant_message_authority(
  uuid, uuid, text, public.profile_kind
) from public, anon, authenticated, service_role;
revoke all on function private.consultant_recipient_is_eligible(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.uuid_array_is_sorted_unique_page76(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.create_consultant_message_atomic(
  uuid, uuid, text, text, timestamptz, uuid[], jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_consultant_message_atomic(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.consultant_message_snapshot_response(
  uuid, uuid, uuid, date, date, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.create_consultant_message(
  uuid, uuid, text, text, timestamptz, uuid[], jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_consultant_message(
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.consultant_message_snapshot(
  uuid, uuid, uuid, date, date, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function private.create_consultant_message_atomic(
  uuid, uuid, text, text, timestamptz, uuid[], jsonb, uuid
) to authenticated;
grant execute on function private.acknowledge_consultant_message_atomic(
  uuid, uuid, uuid, text, uuid
) to authenticated;
grant execute on function private.consultant_message_snapshot_response(
  uuid, uuid, uuid, date, date, text, text, text
) to authenticated;
grant execute on function public.create_consultant_message(
  uuid, uuid, text, text, timestamptz, uuid[], jsonb, uuid
) to authenticated;
grant execute on function public.acknowledge_consultant_message(
  uuid, uuid, uuid, text, uuid
) to authenticated;
grant execute on function public.consultant_message_snapshot(
  uuid, uuid, uuid, date, date, text, text, text
) to authenticated;
