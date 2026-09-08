-- Page 68: governed staff announcements.
--
-- Announcements are not notification deliveries. This workflow freezes the
-- exact active staff audience at release time and counts only explicit read
-- receipts. It does not claim PWA, LINE, SMS, family delivery, provider status,
-- or an implicit expiry rule.

insert into public.permissions (permission_key, description, risk_level) values
  ('announcements.read', 'Read staff announcements addressed to the actor', 1),
  ('announcements.manage', 'Create immutable staff announcement draft versions', 2),
  ('announcements.publish', 'Release or withdraw staff announcement versions', 3)
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
  and permission.permission_key = 'announcements.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key in ('announcements.manage', 'announcements.publish')
on conflict (role_id, permission_id) do nothing;

create or replace function private.announcement_uuid_array_normalized(p_value uuid[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_value is not null
    and cardinality(p_value) <= 500
    and coalesce(p_value, '{}'::uuid[]) = coalesce((
      select array_agg(distinct item order by item)
      from unnest(p_value) item
    ), '{}'::uuid[]);
$$;

create table public.staff_announcement_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  announcement_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  version_state text not null,
  title text not null,
  body text not null,
  publish_at timestamptz not null,
  expires_at timestamptz,
  audience_branch_id uuid not null,
  audience_user_ids uuid[] not null default '{}'::uuid[],
  audience_role_ids uuid[] not null default '{}'::uuid[],
  change_reason text,
  withdrawn_release_version_id uuid,
  withdrawal_reason text,
  recipient_count integer not null default 0,
  action_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  constraint staff_announcement_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_announcement_versions_audience_branch_scope_fkey
    foreign key (audience_branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint staff_announcement_versions_id_scope_key unique (
    id, organization_id, branch_id, announcement_key
  ),
  constraint staff_announcement_versions_chain_version_key unique (
    organization_id, branch_id, announcement_key, version
  ),
  constraint staff_announcement_versions_previous_key unique (previous_version_id),
  constraint staff_announcement_versions_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, announcement_key)
    references public.staff_announcement_versions (
      id, organization_id, branch_id, announcement_key
    ) on delete restrict,
  constraint staff_announcement_versions_withdrawn_scope_fkey
    foreign key (withdrawn_release_version_id, organization_id, branch_id, announcement_key)
    references public.staff_announcement_versions (
      id, organization_id, branch_id, announcement_key
    ) on delete restrict,
  constraint staff_announcement_versions_version_check check (
    version > 0
    and (
      (version = 1 and previous_version_id is null and change_reason is null)
      or (
        version > 1 and previous_version_id is not null
        and char_length(change_reason) between 1 and 1000
        and change_reason !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint staff_announcement_versions_state_check check (
    version_state in ('draft', 'release', 'withdrawal')
  ),
  constraint staff_announcement_versions_title_check check (
    char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'
  ),
  constraint staff_announcement_versions_body_check check (
    char_length(body) between 1 and 10000
    and translate(body, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint staff_announcement_versions_schedule_check check (
    expires_at is null or expires_at > publish_at
  ),
  constraint staff_announcement_versions_audience_branch_check check (
    audience_branch_id = branch_id
  ),
  constraint staff_announcement_versions_audience_check check (
    private.announcement_uuid_array_normalized(audience_user_ids)
    and private.announcement_uuid_array_normalized(audience_role_ids)
    and cardinality(audience_user_ids) + cardinality(audience_role_ids) > 0
  ),
  constraint staff_announcement_versions_state_evidence_check check (
    (
      version_state = 'draft'
      and withdrawn_release_version_id is null
      and withdrawal_reason is null
      and recipient_count = 0
      and action_reauth_challenge_id is null
    )
    or (
      version_state = 'release'
      and withdrawn_release_version_id is null
      and withdrawal_reason is null
      and recipient_count between 1 and 500
      and action_reauth_challenge_id is not null
    )
    or (
      version_state = 'withdrawal'
      and withdrawn_release_version_id is not null
      and char_length(withdrawal_reason) between 1 and 1000
      and withdrawal_reason !~ '[[:cntrl:]]'
      and recipient_count = 0
      and action_reauth_challenge_id is not null
    )
  ),
  constraint staff_announcement_versions_content_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.staff_announcement_versions is
  'Immutable announcement working, release, and withdrawal versions. Release lifecycle is derived from explicit publish_at/expires_at values.';

create table public.staff_announcement_recipients (
  release_version_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  announcement_key uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_display_name text not null,
  recipient_employee_code text,
  recipient_profile_kind text not null,
  resolution_kind text not null,
  resolved_role_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null,
  primary key (release_version_id, recipient_user_id),
  constraint staff_announcement_recipients_release_scope_fkey
    foreign key (release_version_id, organization_id, branch_id, announcement_key)
    references public.staff_announcement_versions (
      id, organization_id, branch_id, announcement_key
    ) on delete restrict,
  constraint staff_announcement_recipients_name_check check (
    char_length(recipient_display_name) between 1 and 120
    and recipient_display_name !~ '[[:cntrl:]]'
  ),
  constraint staff_announcement_recipients_kind_check check (
    recipient_profile_kind in ('staff', 'professional', 'driver', 'finance')
  ),
  constraint staff_announcement_recipients_resolution_check check (
    resolution_kind in ('direct', 'role', 'direct_and_role')
    and private.announcement_uuid_array_normalized(resolved_role_ids)
  )
);

create table public.staff_announcement_read_receipts (
  release_version_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  announcement_key uuid not null,
  recipient_user_id uuid not null,
  read_at timestamptz not null,
  primary key (release_version_id, recipient_user_id),
  constraint staff_announcement_read_receipts_recipient_scope_fkey
    foreign key (
      release_version_id, recipient_user_id
    ) references public.staff_announcement_recipients (
      release_version_id, recipient_user_id
    ) on delete restrict,
  constraint staff_announcement_read_receipts_release_scope_fkey
    foreign key (release_version_id, organization_id, branch_id, announcement_key)
    references public.staff_announcement_versions (
      id, organization_id, branch_id, announcement_key
    ) on delete restrict
);

create table private.staff_announcement_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  action text not null,
  request_hash text not null,
  result_version_id uuid not null,
  result_announcement_key uuid not null,
  result_version integer not null,
  result_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint staff_announcement_operations_result_scope_fkey
    foreign key (
      result_version_id, organization_id, branch_id, result_announcement_key
    ) references public.staff_announcement_versions (
      id, organization_id, branch_id, announcement_key
    ) on delete restrict,
  constraint staff_announcement_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint staff_announcement_operations_action_check check (
    action in ('draft', 'publish', 'withdraw', 'read')
  ),
  constraint staff_announcement_operations_request_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint staff_announcement_operations_version_check check (result_version > 0),
  constraint staff_announcement_operations_reauth_check check (
    (action in ('publish', 'withdraw') and reauth_challenge_id is not null)
    or (action in ('draft', 'read') and reauth_challenge_id is null)
  )
);

create index staff_announcement_versions_scope_created_idx
  on public.staff_announcement_versions (
    organization_id, branch_id, announcement_key, version desc
  );
create index staff_announcement_versions_created_by_idx
  on public.staff_announcement_versions (created_by, created_at desc);
create index staff_announcement_versions_audience_branch_idx
  on public.staff_announcement_versions (audience_branch_id);
create index staff_announcement_versions_reauth_idx
  on public.staff_announcement_versions (action_reauth_challenge_id)
  where action_reauth_challenge_id is not null;
create index staff_announcement_versions_withdrawn_idx
  on public.staff_announcement_versions (withdrawn_release_version_id)
  where withdrawn_release_version_id is not null;
create index staff_announcement_recipients_scope_idx
  on public.staff_announcement_recipients (
    organization_id, branch_id, announcement_key, release_version_id
  );
create index staff_announcement_recipients_user_idx
  on public.staff_announcement_recipients (
    recipient_user_id, organization_id, branch_id, release_version_id
  );
create index staff_announcement_read_receipts_scope_idx
  on public.staff_announcement_read_receipts (
    organization_id, branch_id, announcement_key, release_version_id
  );
create index staff_announcement_read_receipts_recipient_idx
  on public.staff_announcement_read_receipts (recipient_user_id, read_at desc);
create index staff_announcement_operations_scope_idx
  on private.staff_announcement_operations (
    organization_id, branch_id, result_announcement_key, result_version desc
  );
create index staff_announcement_operations_result_version_idx
  on private.staff_announcement_operations (result_version_id);
create index staff_announcement_operations_reauth_idx
  on private.staff_announcement_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.staff_announcement_versions enable row level security;
alter table public.staff_announcement_versions force row level security;
alter table public.staff_announcement_recipients enable row level security;
alter table public.staff_announcement_recipients force row level security;
alter table public.staff_announcement_read_receipts enable row level security;
alter table public.staff_announcement_read_receipts force row level security;
alter table private.staff_announcement_operations enable row level security;
alter table private.staff_announcement_operations force row level security;

create or replace function private.prevent_staff_announcement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'staff announcement history is immutable';
end;
$$;

create or replace function private.validate_staff_announcement_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare v_previous public.staff_announcement_versions%rowtype;
begin
  if new.version = 1 then
    if new.previous_version_id is not null then
      raise exception using errcode = '23514', message = 'invalid first announcement version';
    end if;
    return new;
  end if;
  select previous.* into v_previous
  from public.staff_announcement_versions previous
  where previous.id = new.previous_version_id
    and previous.organization_id = new.organization_id
    and previous.branch_id = new.branch_id
    and previous.announcement_key = new.announcement_key
  for key share;
  if not found
     or v_previous.version + 1 <> new.version
     or exists (
       select 1 from public.staff_announcement_versions later
       where later.organization_id = new.organization_id
         and later.branch_id = new.branch_id
         and later.announcement_key = new.announcement_key
         and later.version > v_previous.version
     ) then
    raise exception using errcode = '23514', message = 'announcement version must extend the terminal lineage';
  end if;
  return new;
end;
$$;

create trigger staff_announcement_versions_validate_chain
before insert on public.staff_announcement_versions
for each row execute function private.validate_staff_announcement_chain();
create trigger staff_announcement_versions_prevent_mutation
before update or delete on public.staff_announcement_versions
for each row execute function private.prevent_staff_announcement_mutation();
create trigger staff_announcement_recipients_prevent_mutation
before update or delete on public.staff_announcement_recipients
for each row execute function private.prevent_staff_announcement_mutation();
create trigger staff_announcement_read_receipts_prevent_mutation
before update or delete on public.staff_announcement_read_receipts
for each row execute function private.prevent_staff_announcement_mutation();
create trigger staff_announcement_operations_prevent_mutation
before update or delete on private.staff_announcement_operations
for each row execute function private.prevent_staff_announcement_mutation();
create trigger staff_announcement_versions_audit_row_change
after insert on public.staff_announcement_versions
for each row execute function private.audit_row_change();
create trigger staff_announcement_recipients_audit_row_change
after insert on public.staff_announcement_recipients
for each row execute function private.audit_row_change();
create trigger staff_announcement_read_receipts_audit_row_change
after insert on public.staff_announcement_read_receipts
for each row execute function private.audit_row_change();
create trigger staff_announcement_operations_audit_row_change
after insert on private.staff_announcement_operations
for each row execute function private.audit_row_change();

create or replace function private.staff_announcement_authority(
  p_organization_id uuid,
  p_branch_id uuid,
  p_permission text
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
        and profile.is_active
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_branch_id
        and branch.organization_id = p_organization_id
        and branch.is_active
    )
    and private.has_permission(p_organization_id, p_branch_id, p_permission);
$$;

create or replace function private.staff_announcement_recipient_current(
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
    join public.memberships membership on membership.profile_id = profile.id
    where profile.id = p_user_id
      and profile.is_active
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and membership.organization_id = p_organization_id
      and (membership.branch_id is null or membership.branch_id = p_branch_id)
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
  );
$$;

create or replace function private.require_staff_announcement_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501', message = 'recent announcement AAL2 evidence is required';
  end if;
  begin v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'recent announcement AAL2 evidence is required';
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
  limit 1 for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501', message = 'recent announcement AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.announcement_lifecycle(
  p_publish_at timestamptz,
  p_expires_at timestamptz,
  p_withdrawn boolean,
  p_now timestamptz
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_withdrawn then 'withdrawn'
    when p_publish_at is null then 'draft'
    when p_now < p_publish_at then 'scheduled'
    when p_expires_at is not null and p_now >= p_expires_at then 'expired'
    else 'published'
  end;
$$;

create or replace function private.create_staff_announcement_draft_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_previous_version_id uuid,
  p_title text,
  p_body text,
  p_publish_at timestamptz,
  p_expires_at timestamptz,
  p_audience_user_ids uuid[],
  p_audience_role_ids uuid[],
  p_change_reason text,
  p_idempotency_key uuid
)
returns table(
  version_id uuid, announcement_key uuid, version integer,previous_version_id uuid,
  version_state text, publish_at timestamptz, expires_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_title text := btrim(p_title); v_body text := btrim(p_body);
  v_reason text := nullif(btrim(p_change_reason), '');
  v_users uuid[]; v_roles uuid[]; v_hash text; v_content_hash text;
  v_previous public.staff_announcement_versions%rowtype;
  v_result public.staff_announcement_versions%rowtype;
  v_operation private.staff_announcement_operations%rowtype;
begin
  if not private.staff_announcement_authority(
    p_expected_organization_id, p_expected_branch_id, 'announcements.manage'
  ) then raise exception using errcode='42501', message='announcement draft is not permitted'; end if;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[]) into v_users
  from unnest(coalesce(p_audience_user_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[]) into v_roles
  from unnest(coalesce(p_audience_role_ids, '{}'::uuid[])) item;
  if p_idempotency_key is null or p_publish_at is null
     or p_expires_at is not null and p_expires_at <= p_publish_at
     or char_length(v_title) not between 1 and 200 or v_title ~ '[[:cntrl:]]'
     or char_length(v_body) not between 1 and 10000
     or translate(v_body, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or cardinality(v_users) + cardinality(v_roles) not between 1 and 500
     or cardinality(v_users) <> cardinality(coalesce(p_audience_user_ids, '{}'::uuid[]))
     or cardinality(v_roles) <> cardinality(coalesce(p_audience_role_ids, '{}'::uuid[]))
     or (p_previous_version_id is null) <> (v_reason is null)
     or v_reason is not null and (char_length(v_reason)>1000 or v_reason~'[[:cntrl:]]') then
    raise exception using errcode='22023', message='valid explicit announcement draft fields are required';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'actor_user_id',v_actor,
    'previous_version_id',p_previous_version_id,'title',v_title,'body',v_body,
    'publish_at',p_publish_at,'expires_at',p_expires_at,
    'audience_user_ids',v_users,'audience_role_ids',v_roles,'change_reason',v_reason
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'staff-announcement-operation:'||v_actor::text||':'||p_idempotency_key::text,0
  ));
  select operation.* into v_operation from private.staff_announcement_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_operation.action<>'draft' or v_operation.organization_id<>p_expected_organization_id
       or v_operation.branch_id<>p_expected_branch_id or v_operation.request_hash<>v_hash then
      raise exception using errcode='23505', message='announcement idempotency conflict';
    end if;
    if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
      raise exception using errcode='42501', message='announcement draft replay is not permitted';
    end if;
    select row.* into strict v_result from public.staff_announcement_versions row
    where row.id=v_operation.result_version_id and row.organization_id=v_operation.organization_id
      and row.branch_id=v_operation.branch_id;
    return query select v_result.id,v_result.announcement_key,v_result.version,v_result.previous_version_id,v_result.version_state,
      v_result.publish_at,v_result.expires_at,true; return;
  end if;
  if exists(select 1 from unnest(v_users) user_id where not private.staff_announcement_recipient_current(
    p_expected_organization_id,p_expected_branch_id,user_id
  )) or exists(
    select 1 from unnest(v_roles) role_id where not exists(
      select 1 from public.roles role where role.id=role_id and role.is_active
        and (role.organization_id is null or role.organization_id=p_expected_organization_id)
    )
  ) then raise exception using errcode='42501', message='announcement audience is outside governed staff scope'; end if;
  if p_previous_version_id is null then
    v_previous.id:=null;
  else
    select row.* into v_previous from public.staff_announcement_versions row
    where row.id=p_previous_version_id and row.organization_id=p_expected_organization_id
      and row.branch_id=p_expected_branch_id for update;
    if not found then raise exception using errcode='42501', message='announcement predecessor is outside scope'; end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'staff-announcement-chain:'||p_expected_organization_id::text||':'||p_expected_branch_id::text||':'||v_previous.announcement_key::text,0
    ));
    if exists(select 1 from public.staff_announcement_versions later
      where later.organization_id=p_expected_organization_id and later.branch_id=p_expected_branch_id
        and later.announcement_key=v_previous.announcement_key and later.version>v_previous.version) then
      raise exception using errcode='40001', message='announcement predecessor is no longer terminal';
    end if;
  end if;
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
    raise exception using errcode='42501', message='announcement draft authority expired'; end if;
  v_now:=clock_timestamp();
  -- The key used in the hash and row must be identical; derive it once for v1.
  if v_previous.id is null then v_previous.announcement_key:=gen_random_uuid(); end if;
  v_content_hash:=encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'announcement_key',v_previous.announcement_key,
    'version',coalesce(v_previous.version,0)+1,'previous_version_id',v_previous.id,
    'state','draft','title',v_title,'body',v_body,'publish_at',p_publish_at,
    'expires_at',p_expires_at,'audience_user_ids',v_users,'audience_role_ids',v_roles,
    'change_reason',v_reason,'created_by',v_actor,'created_at',v_now
  )::text,'UTF8')),'hex');
  insert into public.staff_announcement_versions(
    organization_id,branch_id,announcement_key,version,previous_version_id,version_state,
    title,body,publish_at,expires_at,audience_branch_id,audience_user_ids,
    audience_role_ids,change_reason,recipient_count,content_hash,created_by,created_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_previous.announcement_key,
    coalesce(v_previous.version,0)+1,v_previous.id,'draft',v_title,v_body,p_publish_at,
    p_expires_at,p_expected_branch_id,v_users,v_roles,v_reason,0,v_content_hash,v_actor,v_now
  ) returning * into v_result;
  insert into private.staff_announcement_operations(
    organization_id,branch_id,actor_user_id,idempotency_key,action,request_hash,
    result_version_id,result_announcement_key,result_version,result_at
  ) values (p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,
    'draft',v_hash,v_result.id,v_result.announcement_key,v_result.version,v_result.created_at);
  if not private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ) or exists (
    select 1 from unnest(v_users) user_id
    where not private.staff_announcement_recipient_current(
      p_expected_organization_id,p_expected_branch_id,user_id
    )
  ) or exists (
    select 1 from unnest(v_roles) role_id where not exists (
      select 1 from public.roles role where role.id=role_id and role.is_active
        and (role.organization_id is null or role.organization_id=p_expected_organization_id)
    )
  ) then
    raise exception using errcode='42501',message='announcement draft scope expired after audit';
  end if;
  return query select v_result.id,v_result.announcement_key,v_result.version,v_result.previous_version_id,v_result.version_state,
    v_result.publish_at,v_result.expires_at,false;
end;
$$;

create or replace function private.publish_staff_announcement_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_draft_version_id uuid,
  p_idempotency_key uuid
)
returns table(
  version_id uuid, announcement_key uuid, version integer,draft_version_id uuid,lifecycle text,
  publish_at timestamptz, expires_at timestamptz, recipient_count integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_hash text;
  v_challenge uuid; v_operation private.staff_announcement_operations%rowtype;
  v_draft public.staff_announcement_versions%rowtype;
  v_result public.staff_announcement_versions%rowtype; v_count integer;
  v_content_hash text; v_recipients jsonb;
begin
  if p_draft_version_id is null or p_idempotency_key is null
     or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
     or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish') then
    raise exception using errcode='42501', message='announcement release is not permitted'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'actor_user_id',v_actor,'draft_version_id',p_draft_version_id
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('staff-announcement-operation:'||v_actor::text||':'||p_idempotency_key::text,0));
  select operation.* into v_operation from private.staff_announcement_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_operation.action<>'publish' or v_operation.organization_id<>p_expected_organization_id
       or v_operation.branch_id<>p_expected_branch_id or v_operation.request_hash<>v_hash then
      raise exception using errcode='23505', message='announcement idempotency conflict'; end if;
    if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
       or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish')
       or not exists(select 1 from private.reauth_challenges challenge where challenge.id=v_operation.reauth_challenge_id
         and challenge.user_id=v_actor and challenge.consumed_at is not null and challenge.invalidated_at is null) then
      raise exception using errcode='42501', message='announcement release replay is not permitted'; end if;
    perform private.require_staff_announcement_reauth(v_actor,clock_timestamp());
    select row.* into strict v_result from public.staff_announcement_versions row
    where row.id=v_operation.result_version_id and row.organization_id=v_operation.organization_id
      and row.branch_id=v_operation.branch_id;
    return query select v_result.id,v_result.announcement_key,v_result.version,v_result.previous_version_id,
      private.announcement_lifecycle(v_result.publish_at,v_result.expires_at,false,v_operation.result_at),
      v_result.publish_at,v_result.expires_at,v_result.recipient_count,true; return;
  end if;
  select row.* into v_draft from public.staff_announcement_versions row
  where row.id=p_draft_version_id and row.organization_id=p_expected_organization_id
    and row.branch_id=p_expected_branch_id for update;
  if not found or v_draft.version_state<>'draft' then
    raise exception using errcode='42501', message='announcement draft is outside releasable scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-announcement-chain:'||p_expected_organization_id::text||':'||p_expected_branch_id::text||':'||v_draft.announcement_key::text,0));
  if exists(select 1 from public.staff_announcement_versions later where later.organization_id=p_expected_organization_id
    and later.branch_id=p_expected_branch_id and later.announcement_key=v_draft.announcement_key
    and later.version>v_draft.version) then
    raise exception using errcode='40001', message='announcement draft is no longer terminal'; end if;
  if v_draft.expires_at is not null and v_draft.expires_at<=clock_timestamp() then
    raise exception using errcode='22023',message='announcement expiry must still be in the future at release';
  end if;
  if exists(select 1 from unnest(v_draft.audience_user_ids) user_id
    where not private.staff_announcement_recipient_current(p_expected_organization_id,p_expected_branch_id,user_id))
     or exists(select 1 from unnest(v_draft.audience_role_ids) role_id where not exists(
       select 1 from public.roles role where role.id=role_id and role.is_active
         and (role.organization_id is null or role.organization_id=p_expected_organization_id)
     )) then raise exception using errcode='42501', message='announcement audience changed before release'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',resolved.user_id,'display_name',resolved.display_name,
    'employee_code',resolved.employee_code,'profile_kind',resolved.profile_kind,
    'direct_match',resolved.direct_match,'role_ids',resolved.role_ids
  ) order by resolved.user_id),'[]'::jsonb) into v_recipients
  from (
    select profile.id user_id,profile.display_name,profile.employee_code,
      profile.kind::text profile_kind,profile.id=any(v_draft.audience_user_ids) direct_match,
      coalesce(array_agg(distinct role.id order by role.id)
        filter(where role.id=any(v_draft.audience_role_ids)),'{}'::uuid[]) role_ids
    from public.profiles profile
    join public.memberships membership on membership.profile_id=profile.id
    left join public.membership_roles membership_role on membership_role.membership_id=membership.id
    left join public.roles role on role.id=membership_role.role_id and role.is_active
      and (role.organization_id is null or role.organization_id=p_expected_organization_id)
    where profile.is_active and profile.kind in ('staff','professional','driver','finance')
      and membership.organization_id=p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
      and membership.status='active' and membership.starts_at<=clock_timestamp()
      and (membership.ends_at is null or membership.ends_at>clock_timestamp())
      and (profile.id=any(v_draft.audience_user_ids) or role.id=any(v_draft.audience_role_ids))
    group by profile.id
  ) resolved;
  v_count:=jsonb_array_length(v_recipients);
  if v_count not between 1 and 500 then
    raise exception using errcode='22023', message='resolved announcement audience must contain 1 to 500 active staff'; end if;
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
     or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish') then
    raise exception using errcode='42501', message='announcement release authority expired'; end if;
  v_now:=clock_timestamp();
  if v_draft.expires_at is not null and v_draft.expires_at<=v_now then
    raise exception using errcode='22023',message='announcement expired while release was being prepared';
  end if;
  v_challenge:=private.require_staff_announcement_reauth(v_actor,v_now);
  v_content_hash:=encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version',1,'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'announcement_key',v_draft.announcement_key,'version',v_draft.version+1,'previous_version_id',v_draft.id,
    'state','release','title',v_draft.title,'body',v_draft.body,'publish_at',v_draft.publish_at,
    'expires_at',v_draft.expires_at,'audience_user_ids',v_draft.audience_user_ids,
    'audience_role_ids',v_draft.audience_role_ids,'recipient_count',v_count,
    'created_by',v_actor,'created_at',v_now,'reauth_challenge_id',v_challenge
  )::text,'UTF8')),'hex');
  insert into public.staff_announcement_versions(
    organization_id,branch_id,announcement_key,version,previous_version_id,version_state,
    title,body,publish_at,expires_at,audience_branch_id,audience_user_ids,audience_role_ids,
    change_reason,recipient_count,action_reauth_challenge_id,content_hash,created_by,created_at
  ) values (p_expected_organization_id,p_expected_branch_id,v_draft.announcement_key,v_draft.version+1,
    v_draft.id,'release',v_draft.title,v_draft.body,v_draft.publish_at,v_draft.expires_at,
    p_expected_branch_id,v_draft.audience_user_ids,v_draft.audience_role_ids,'發布受眾快照',v_count,
    v_challenge,v_content_hash,v_actor,v_now) returning * into v_result;
  insert into public.staff_announcement_recipients(
    release_version_id,organization_id,branch_id,announcement_key,recipient_user_id,
    recipient_display_name,recipient_employee_code,recipient_profile_kind,resolution_kind,
    resolved_role_ids,created_at
  ) select v_result.id,p_expected_organization_id,p_expected_branch_id,v_result.announcement_key,
    recipient.user_id,recipient.display_name,recipient.employee_code,recipient.profile_kind,
    case when recipient.direct_match and cardinality(recipient.role_ids)>0 then 'direct_and_role'
      when recipient.direct_match then 'direct' else 'role' end,
    recipient.role_ids,v_now
  from jsonb_to_recordset(v_recipients) as recipient(
    user_id uuid,display_name text,employee_code text,profile_kind text,
    direct_match boolean,role_ids uuid[]
  );
  insert into private.staff_announcement_operations(
    organization_id,branch_id,actor_user_id,idempotency_key,action,request_hash,
    result_version_id,result_announcement_key,result_version,result_at,reauth_challenge_id
  ) values (p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,'publish',v_hash,
    v_result.id,v_result.announcement_key,v_result.version,v_now,v_challenge);
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
    or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish')
    or exists (
      select 1 from public.staff_announcement_recipients recipient
      where recipient.release_version_id=v_result.id
        and not private.staff_announcement_recipient_current(
          p_expected_organization_id,p_expected_branch_id,recipient.recipient_user_id
        )
    ) or exists (
      select 1 from unnest(v_draft.audience_role_ids) role_id where not exists (
        select 1 from public.roles role where role.id=role_id and role.is_active
          and (role.organization_id is null or role.organization_id=p_expected_organization_id)
      )
    ) or not exists (
      select 1 from private.reauth_challenges challenge
      where challenge.id=v_challenge and challenge.user_id=v_actor
        and challenge.consumed_at is not null and challenge.invalidated_at is null
    ) then
    raise exception using errcode='42501',message='announcement release scope expired after audit';
  end if;
  perform private.require_staff_announcement_reauth(v_actor,clock_timestamp());
  return query select v_result.id,v_result.announcement_key,v_result.version,v_result.previous_version_id,
    private.announcement_lifecycle(v_result.publish_at,v_result.expires_at,false,v_now),
    v_result.publish_at,v_result.expires_at,v_result.recipient_count,false;
end;
$$;

create or replace function private.withdraw_staff_announcement_atomic(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_expected_latest_version_id uuid,p_release_version_id uuid,
  p_reason text,p_idempotency_key uuid
)
returns table(version_id uuid,announcement_key uuid,version integer,previous_version_id uuid,lifecycle text,
  withdrawn_release_version_id uuid,withdrawal_reason text,withdrawn_at timestamptz,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_reason text:=nullif(btrim(p_reason),'');
  v_hash text; v_challenge uuid; v_operation private.staff_announcement_operations%rowtype;
  v_latest public.staff_announcement_versions%rowtype; v_release public.staff_announcement_versions%rowtype;
  v_result public.staff_announcement_versions%rowtype; v_content_hash text;
begin
  if p_expected_latest_version_id is null or p_release_version_id is null or p_idempotency_key is null
     or v_reason is null or char_length(v_reason)>1000 or v_reason~'[[:cntrl:]]'
     or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
     or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish') then
    raise exception using errcode='42501', message='announcement withdrawal is not permitted'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'actor_user_id',v_actor,'latest_version_id',p_expected_latest_version_id,
    'release_version_id',p_release_version_id,'reason',v_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('staff-announcement-operation:'||v_actor::text||':'||p_idempotency_key::text,0));
  select operation.* into v_operation from private.staff_announcement_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_operation.action<>'withdraw' or v_operation.organization_id<>p_expected_organization_id
      or v_operation.branch_id<>p_expected_branch_id or v_operation.request_hash<>v_hash then
      raise exception using errcode='23505',message='announcement idempotency conflict'; end if;
    if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
      or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish')
      or not exists(select 1 from private.reauth_challenges challenge where challenge.id=v_operation.reauth_challenge_id
        and challenge.user_id=v_actor and challenge.consumed_at is not null and challenge.invalidated_at is null) then
      raise exception using errcode='42501',message='announcement withdrawal replay is not permitted'; end if;
    perform private.require_staff_announcement_reauth(v_actor,clock_timestamp());
    select row.* into strict v_result from public.staff_announcement_versions row where row.id=v_operation.result_version_id;
    return query select v_result.id,v_result.announcement_key,v_result.version,v_result.previous_version_id,'withdrawn'::text,
      v_result.withdrawn_release_version_id,v_result.withdrawal_reason,v_result.created_at,true; return;
  end if;
  select row.* into v_latest from public.staff_announcement_versions row
  where row.id=p_expected_latest_version_id and row.organization_id=p_expected_organization_id
    and row.branch_id=p_expected_branch_id for update;
  if not found then raise exception using errcode='42501',message='announcement latest version is outside scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-announcement-chain:'||p_expected_organization_id::text||':'||p_expected_branch_id::text||':'||v_latest.announcement_key::text,0));
  if exists(select 1 from public.staff_announcement_versions later where later.organization_id=p_expected_organization_id
    and later.branch_id=p_expected_branch_id and later.announcement_key=v_latest.announcement_key
    and later.version>v_latest.version) then raise exception using errcode='40001',message='announcement latest version changed'; end if;
  select row.* into v_release from public.staff_announcement_versions row
  where row.id=p_release_version_id and row.organization_id=p_expected_organization_id
    and row.branch_id=p_expected_branch_id and row.announcement_key=v_latest.announcement_key
    and row.version_state='release';
  if not found or exists(select 1 from public.staff_announcement_versions later_release
    where later_release.organization_id=p_expected_organization_id and later_release.branch_id=p_expected_branch_id
      and later_release.announcement_key=v_latest.announcement_key and later_release.version_state='release'
      and later_release.version>v_release.version)
    or exists(select 1 from public.staff_announcement_versions withdrawal where withdrawal.organization_id=p_expected_organization_id
      and withdrawal.branch_id=p_expected_branch_id and withdrawal.announcement_key=v_latest.announcement_key
      and withdrawal.version_state='withdrawal' and withdrawal.version>v_release.version) then
    raise exception using errcode='23514',message='announcement release is not the active publication'; end if;
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
    or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish') then
    raise exception using errcode='42501',message='announcement withdrawal authority expired'; end if;
  v_now:=clock_timestamp(); v_challenge:=private.require_staff_announcement_reauth(v_actor,v_now);
  v_content_hash:=encode(sha256(convert_to(jsonb_build_object('content_hash_version',1,
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'announcement_key',v_latest.announcement_key,'version',v_latest.version+1,'previous_version_id',v_latest.id,
    'state','withdrawal','withdrawn_release_version_id',v_release.id,'withdrawal_reason',v_reason,
    'created_by',v_actor,'created_at',v_now,'reauth_challenge_id',v_challenge)::text,'UTF8')),'hex');
  insert into public.staff_announcement_versions(organization_id,branch_id,announcement_key,version,
    previous_version_id,version_state,title,body,publish_at,expires_at,audience_branch_id,
    audience_user_ids,audience_role_ids,change_reason,withdrawn_release_version_id,withdrawal_reason,
    recipient_count,action_reauth_challenge_id,content_hash,created_by,created_at)
  values(p_expected_organization_id,p_expected_branch_id,v_latest.announcement_key,v_latest.version+1,
    v_latest.id,'withdrawal',v_latest.title,v_latest.body,v_latest.publish_at,v_latest.expires_at,
    p_expected_branch_id,v_latest.audience_user_ids,v_latest.audience_role_ids,'撤回公告',v_release.id,
    v_reason,0,v_challenge,v_content_hash,v_actor,v_now) returning * into v_result;
  insert into private.staff_announcement_operations(organization_id,branch_id,actor_user_id,idempotency_key,
    action,request_hash,result_version_id,result_announcement_key,result_version,result_at,reauth_challenge_id)
  values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,'withdraw',v_hash,
    v_result.id,v_result.announcement_key,v_result.version,v_now,v_challenge);
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
    or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.publish')
    or not exists (
      select 1 from private.reauth_challenges challenge
      where challenge.id=v_challenge and challenge.user_id=v_actor
        and challenge.consumed_at is not null and challenge.invalidated_at is null
    ) then
    raise exception using errcode='42501',message='announcement withdrawal scope expired after audit';
  end if;
  perform private.require_staff_announcement_reauth(v_actor,clock_timestamp());
  return query select v_result.id,v_result.announcement_key,v_result.version,v_result.previous_version_id,'withdrawn'::text,
    v_release.id,v_reason,v_now,false;
end; $$;

create or replace function private.mark_staff_announcement_read_atomic(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_release_version_id uuid,p_idempotency_key uuid
)
returns table(release_version_id uuid,announcement_key uuid,read_at timestamptz,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_hash text;
  v_release public.staff_announcement_versions%rowtype; v_operation private.staff_announcement_operations%rowtype;
  v_read_at timestamptz;
begin
  if p_release_version_id is null or p_idempotency_key is null
    or not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.read') then
    raise exception using errcode='42501',message='announcement read receipt is not permitted'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'actor_user_id',v_actor,'release_version_id',p_release_version_id)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('staff-announcement-operation:'||v_actor::text||':'||p_idempotency_key::text,0));
  select operation.* into v_operation from private.staff_announcement_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_operation.action<>'read' or v_operation.organization_id<>p_expected_organization_id
      or v_operation.branch_id<>p_expected_branch_id or v_operation.request_hash<>v_hash then
      raise exception using errcode='23505',message='announcement idempotency conflict'; end if;
    if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.read') then
      raise exception using errcode='42501',message='announcement read replay is not permitted'; end if;
    select receipt.read_at into strict v_read_at from public.staff_announcement_read_receipts receipt
    where receipt.release_version_id=v_operation.result_version_id and receipt.recipient_user_id=v_actor;
    return query select v_operation.result_version_id,v_operation.result_announcement_key,v_read_at,true; return;
  end if;
  select row.* into v_release from public.staff_announcement_versions row
  where row.id=p_release_version_id and row.organization_id=p_expected_organization_id
    and row.branch_id=p_expected_branch_id and row.version_state='release';
  if not found or v_now<v_release.publish_at
    or not exists(select 1 from public.staff_announcement_recipients recipient
      where recipient.release_version_id=v_release.id and recipient.recipient_user_id=v_actor)
    or exists(select 1 from public.staff_announcement_versions later where later.organization_id=p_expected_organization_id
      and later.branch_id=p_expected_branch_id and later.announcement_key=v_release.announcement_key
      and later.version>v_release.version and later.version_state in ('release','withdrawal')) then
    raise exception using errcode='42501',message='announcement release is not readable by the actor'; end if;
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.read') then
    raise exception using errcode='42501',message='announcement read authority expired'; end if;
  v_now:=clock_timestamp();
  insert into public.staff_announcement_read_receipts(release_version_id,organization_id,branch_id,
    announcement_key,recipient_user_id,read_at)
  values(v_release.id,p_expected_organization_id,p_expected_branch_id,v_release.announcement_key,v_actor,v_now)
  on conflict on constraint staff_announcement_read_receipts_pkey do nothing;
  select receipt.read_at into strict v_read_at from public.staff_announcement_read_receipts receipt
  where receipt.release_version_id=v_release.id and receipt.recipient_user_id=v_actor;
  insert into private.staff_announcement_operations(organization_id,branch_id,actor_user_id,idempotency_key,
    action,request_hash,result_version_id,result_announcement_key,result_version,result_at)
  values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,'read',v_hash,
    v_release.id,v_release.announcement_key,v_release.version,v_read_at);
  if not private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) then
    raise exception using errcode='42501',message='announcement read authority expired after audit';
  end if;
  return query select v_release.id,v_release.announcement_key,v_read_at,false;
end; $$;

create or replace function private.staff_announcement_snapshot_rows(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_actor uuid,
  p_manage boolean,p_now timestamptz
)
returns table(
  generated_at timestamptz,version_id uuid,announcement_key uuid,version integer,version_state text,title text,body text,
  publish_at timestamptz,expires_at timestamptz,lifecycle text,has_pending_draft boolean,
  audience_user_ids uuid[],audience_role_ids uuid[],
  active_release_version_id uuid,active_release_version integer,
  active_release_title text,active_release_body text,active_release_publish_at timestamptz,
  active_release_expires_at timestamptz,recipient_count integer,
  read_count integer,unread_count integer,actor_is_recipient boolean,
  actor_read_at timestamptz,withdrawal_reason text
)
language sql stable security invoker set search_path='' as $$
  with keys as (
    select distinct item.announcement_key
    from public.staff_announcement_versions item
    where item.organization_id=p_expected_organization_id
      and item.branch_id=p_expected_branch_id
  ), chain as (
    select key.announcement_key,
      latest.id latest_id,latest.version latest_version,latest.version_state latest_state,
      latest.title latest_title,latest.body latest_body,latest.publish_at latest_publish_at,
      latest.expires_at latest_expires_at,latest.audience_user_ids latest_audience_user_ids,
      latest.audience_role_ids latest_audience_role_ids,latest.created_at latest_created_at,
      release.id release_id,release.version release_version,release.title release_title,
      release.body release_body,release.publish_at release_publish_at,
      release.expires_at release_expires_at,release.recipient_count release_recipient_count,
      withdrawal.version withdrawal_version,withdrawal.withdrawal_reason latest_withdrawal_reason
    from keys key
    join lateral (
      select item.* from public.staff_announcement_versions item
      where item.organization_id=p_expected_organization_id
        and item.branch_id=p_expected_branch_id
        and item.announcement_key=key.announcement_key
      order by item.version desc limit 1
    ) latest on true
    left join lateral (
      select item.* from public.staff_announcement_versions item
      where item.organization_id=p_expected_organization_id
        and item.branch_id=p_expected_branch_id
        and item.announcement_key=key.announcement_key
        and item.version_state='release'
      order by item.version desc limit 1
    ) release on true
    left join lateral (
      select item.* from public.staff_announcement_versions item
      where item.organization_id=p_expected_organization_id
        and item.branch_id=p_expected_branch_id
        and item.announcement_key=key.announcement_key
        and item.version_state='withdrawal'
      order by item.version desc limit 1
    ) withdrawal on true
  ), visible as (
    select chain.*,
      coalesce(chain.withdrawal_version,0)>coalesce(chain.release_version,0) withdrawn
    from chain
    where p_manage or (
      chain.release_id is not null
      and coalesce(chain.withdrawal_version,0)<chain.release_version
      and p_now>=chain.release_publish_at
      and exists (
        select 1 from public.staff_announcement_recipients recipient
        where recipient.release_version_id=chain.release_id
          and recipient.recipient_user_id=p_actor
      )
    )
  )
  select
    p_now,
    case when p_manage then visible.latest_id else visible.release_id end,
    visible.announcement_key,
    case when p_manage then visible.latest_version else visible.release_version end,
    case when p_manage then visible.latest_state else 'release' end,
    case when p_manage then visible.latest_title else visible.release_title end,
    case when p_manage then visible.latest_body else visible.release_body end,
    case when p_manage then visible.latest_publish_at else visible.release_publish_at end,
    case when p_manage then visible.latest_expires_at else visible.release_expires_at end,
    case when visible.release_id is null then 'draft'
      else private.announcement_lifecycle(
        visible.release_publish_at,visible.release_expires_at,visible.withdrawn,p_now
      ) end,
    p_manage and visible.latest_state='draft' and visible.release_id is not null
      and not visible.withdrawn,
    case when p_manage then visible.latest_audience_user_ids else '{}'::uuid[] end,
    case when p_manage then visible.latest_audience_role_ids else '{}'::uuid[] end,
    visible.release_id,visible.release_version,visible.release_title,visible.release_body,
    visible.release_publish_at,visible.release_expires_at,
    coalesce(visible.release_recipient_count,0),
    case when visible.release_id is null then 0 else (
      select count(*)::integer from public.staff_announcement_read_receipts receipt
      where receipt.release_version_id=visible.release_id
    ) end,
    case when visible.release_id is null then 0 else
      coalesce(visible.release_recipient_count,0)-(
        select count(*)::integer from public.staff_announcement_read_receipts receipt
        where receipt.release_version_id=visible.release_id
      ) end,
    exists (
      select 1 from public.staff_announcement_recipients recipient
      where recipient.release_version_id=visible.release_id
        and recipient.recipient_user_id=p_actor
    ),
    (
      select receipt.read_at from public.staff_announcement_read_receipts receipt
      where receipt.release_version_id=visible.release_id
        and receipt.recipient_user_id=p_actor
    ),
    case when visible.withdrawn then visible.latest_withdrawal_reason else null end
  from visible
  order by visible.latest_created_at desc,visible.announcement_key;
$$;

create or replace function private.staff_announcement_snapshot_core(
  p_expected_organization_id uuid,p_expected_branch_id uuid
)
returns table(
  generated_at timestamptz,version_id uuid,announcement_key uuid,version integer,version_state text,title text,body text,
  publish_at timestamptz,expires_at timestamptz,lifecycle text,has_pending_draft boolean,
  audience_user_ids uuid[],audience_role_ids uuid[],
  active_release_version_id uuid,active_release_version integer,
  active_release_title text,active_release_body text,active_release_publish_at timestamptz,
  active_release_expires_at timestamptz,recipient_count integer,
  read_count integer,unread_count integer,actor_is_recipient boolean,
  actor_read_at timestamptz,withdrawal_reason text,can_manage boolean
)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();v_manage boolean;
  v_snapshot jsonb;v_count integer;
begin
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.read') then
    raise exception using errcode='42501',message='announcement snapshot is not permitted'; end if;
  v_manage:=private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage');
  select coalesce(jsonb_agg(to_jsonb(item) order by item.version_id),'[]'::jsonb)
    into v_snapshot
  from private.staff_announcement_snapshot_rows(
    p_expected_organization_id,p_expected_branch_id,v_actor,v_manage,v_now
  ) item;
  v_count:=jsonb_array_length(v_snapshot);
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.read')
    or v_manage<>private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
    raise exception using errcode='42501',message='announcement snapshot authority expired'; end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_expected_organization_id,p_expected_branch_id,v_actor,'select','staff_announcement_snapshot',null,'{}'::text[],
    jsonb_build_object('projection','page68_staff_announcements_v1','result_count',v_count,'management',v_manage));
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.read')
    or v_manage<>private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
    or v_snapshot is distinct from (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.version_id),'[]'::jsonb)
      from private.staff_announcement_snapshot_rows(
        p_expected_organization_id,p_expected_branch_id,v_actor,v_manage,v_now
      ) item
    ) then
    raise exception using errcode='42501',message='announcement snapshot authority expired after audit'; end if;
  return query select row.generated_at,row.version_id,row.announcement_key,row.version,row.version_state,row.title,row.body,
    row.publish_at,row.expires_at,row.lifecycle,row.has_pending_draft,
    row.audience_user_ids,row.audience_role_ids,row.active_release_version_id,
    row.active_release_version,row.active_release_title,row.active_release_body,
    row.active_release_publish_at,row.active_release_expires_at,
    row.recipient_count,row.read_count,row.unread_count,row.actor_is_recipient,row.actor_read_at,
    row.withdrawal_reason,v_manage
  from jsonb_to_recordset(v_snapshot) as row(
    generated_at timestamptz,version_id uuid,announcement_key uuid,version integer,version_state text,title text,body text,
    publish_at timestamptz,expires_at timestamptz,lifecycle text,has_pending_draft boolean,
    audience_user_ids uuid[],audience_role_ids uuid[],
    active_release_version_id uuid,active_release_version integer,
    active_release_title text,active_release_body text,active_release_publish_at timestamptz,
    active_release_expires_at timestamptz,recipient_count integer,
    read_count integer,unread_count integer,actor_is_recipient boolean,
    actor_read_at timestamptz,withdrawal_reason text
  ) order by row.publish_at desc,row.announcement_key;
end; $$;

create or replace function private.staff_announcement_audience_options_rows(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_now timestamptz
)
returns table(staff_options jsonb,role_options jsonb)
language sql stable security invoker set search_path='' as $$
  select
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id',item.id,'display_name',item.display_name,
        'employee_code',item.employee_code,'profile_kind',item.kind
      ) order by item.display_name collate "C",item.id),'[]'::jsonb)
      from (
        select profile.id,profile.display_name,profile.employee_code,profile.kind
        from public.profiles profile
        join public.memberships membership on membership.profile_id=profile.id
        where profile.is_active
          and profile.kind in ('staff','professional','driver','finance')
          and membership.organization_id=p_expected_organization_id
          and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
          and membership.status='active' and membership.starts_at<=p_now
          and (membership.ends_at is null or membership.ends_at>p_now)
        group by profile.id,profile.display_name,profile.employee_code,profile.kind
        order by profile.display_name collate "C",profile.id limit 500
      ) item
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role_id',item.id,'role_name',item.name
      ) order by item.name collate "C",item.id),'[]'::jsonb)
      from (
        select role.id,role.name
        from public.roles role
        join public.membership_roles membership_role on membership_role.role_id=role.id
        join public.memberships membership on membership.id=membership_role.membership_id
        where role.is_active
          and (role.organization_id is null or role.organization_id=p_expected_organization_id)
          and membership.organization_id=p_expected_organization_id
          and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
          and membership.status='active' and membership.starts_at<=p_now
          and (membership.ends_at is null or membership.ends_at>p_now)
        group by role.id,role.name
        order by role.name collate "C",role.id limit 100
      ) item
    );
$$;

create or replace function private.staff_announcement_audience_options_core(
  p_expected_organization_id uuid,p_expected_branch_id uuid
)
returns table(generated_at timestamptz,staff_options jsonb,role_options jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();v_staff jsonb;v_roles jsonb;
begin
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
    raise exception using errcode='42501',message='announcement audience options are not permitted';end if;
  select options.staff_options,options.role_options into v_staff,v_roles
  from private.staff_announcement_audience_options_rows(
    p_expected_organization_id,p_expected_branch_id,v_now
  ) options;
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
    raise exception using errcode='42501',message='announcement audience options authority expired';end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_expected_organization_id,p_expected_branch_id,v_actor,'select','staff_announcement_audience_options',null,'{}'::text[],
    jsonb_build_object('projection','page68_audience_options_v1','staff_count',jsonb_array_length(v_staff),'role_count',jsonb_array_length(v_roles)));
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage')
    or (v_staff,v_roles) is distinct from (
      select options.staff_options,options.role_options
      from private.staff_announcement_audience_options_rows(
        p_expected_organization_id,p_expected_branch_id,v_now
      ) options
    ) then
    raise exception using errcode='42501',message='announcement audience options authority expired after audit';end if;
  return query select v_now,v_staff,v_roles;
end; $$;

create or replace function private.staff_announcement_recipient_detail_core(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_release_version_id uuid
)
returns table(recipient_user_id uuid,recipient_display_name text,recipient_employee_code text,
  recipient_profile_kind text,resolution_kind text,read_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_count integer;
begin
  if p_release_version_id is null or not private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ) or not exists(select 1 from public.staff_announcement_versions row where row.id=p_release_version_id
    and row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id and row.version_state='release') then
    raise exception using errcode='42501',message='announcement recipient detail is not permitted';end if;
  return query select recipient.recipient_user_id,recipient.recipient_display_name,
    recipient.recipient_employee_code,recipient.recipient_profile_kind,recipient.resolution_kind,receipt.read_at
  from public.staff_announcement_recipients recipient left join public.staff_announcement_read_receipts receipt
    on receipt.release_version_id=recipient.release_version_id and receipt.recipient_user_id=recipient.recipient_user_id
  where recipient.organization_id=p_expected_organization_id and recipient.branch_id=p_expected_branch_id
    and recipient.release_version_id=p_release_version_id
  order by recipient.recipient_display_name collate "C",recipient.recipient_user_id;
  get diagnostics v_count=row_count;
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
    raise exception using errcode='42501',message='announcement recipient detail authority expired';end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_expected_organization_id,p_expected_branch_id,v_actor,'select','staff_announcement_recipients',p_release_version_id::text,
    '{}'::text[],jsonb_build_object('projection','page68_recipient_detail_v1','result_count',v_count));
  if not private.staff_announcement_authority(p_expected_organization_id,p_expected_branch_id,'announcements.manage') then
    raise exception using errcode='42501',message='announcement recipient detail authority expired after audit';end if;
end; $$;

create or replace function private.staff_announcement_management_bundle(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_actor uuid,
  p_manage boolean,p_now timestamptz,p_selected_release_version_id uuid
)
returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'announcements',(
      select coalesce(jsonb_agg(to_jsonb(item) order by item.version_id),'[]'::jsonb)
      from (
        select * from private.staff_announcement_snapshot_rows(
          p_expected_organization_id,p_expected_branch_id,p_actor,p_manage,p_now
        ) limit 100
      ) item
    ),
    'summary',(
      select jsonb_build_object(
        'available_total',count(*)::integer,
        'items_truncated',count(*)>100,
        'draft_total',count(*) filter(where item.version_state='draft'),
        'unreleased_total',count(*) filter(where item.lifecycle='draft'),
        'scheduled_total',count(*) filter(where item.lifecycle='scheduled'),
        'published_total',count(*) filter(where item.lifecycle='published'),
        'expired_total',count(*) filter(where item.lifecycle='expired'),
        'withdrawn_total',count(*) filter(where item.lifecycle='withdrawn'),
        'unread_recipient_total',coalesce(sum(item.unread_count),0)::bigint
      )
      from private.staff_announcement_snapshot_rows(
        p_expected_organization_id,p_expected_branch_id,p_actor,p_manage,p_now
      ) item
    ),
    'staff_options',case when p_manage then coalesce((
      select options.staff_options
      from private.staff_announcement_audience_options_rows(
        p_expected_organization_id,p_expected_branch_id,p_now
      ) options
    ),'[]'::jsonb) else '[]'::jsonb end,
    'role_options',case when p_manage then coalesce((
      select options.role_options
      from private.staff_announcement_audience_options_rows(
        p_expected_organization_id,p_expected_branch_id,p_now
      ) options
    ),'[]'::jsonb) else '[]'::jsonb end,
    'selected_recipients',case when p_manage and p_selected_release_version_id is not null then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recipient_user_id',recipient.recipient_user_id,
        'recipient_display_name',recipient.recipient_display_name,
        'recipient_employee_code',recipient.recipient_employee_code,
        'recipient_profile_kind',recipient.recipient_profile_kind,
        'resolution_kind',recipient.resolution_kind,
        'read_at',receipt.read_at
      ) order by recipient.recipient_display_name collate "C",recipient.recipient_user_id),'[]'::jsonb)
      from public.staff_announcement_recipients recipient
      left join public.staff_announcement_read_receipts receipt
        on receipt.release_version_id=recipient.release_version_id
       and receipt.recipient_user_id=recipient.recipient_user_id
      where recipient.organization_id=p_expected_organization_id
        and recipient.branch_id=p_expected_branch_id
        and recipient.release_version_id=p_selected_release_version_id
    ) else '[]'::jsonb end
  );
$$;

create or replace function private.staff_announcement_management_snapshot_core(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_selected_release_version_id uuid
)
returns table(
  organization_id uuid,branch_id uuid,generated_at timestamptz,
  announcements jsonb,summary jsonb,staff_options jsonb,role_options jsonb,
  selected_release_version_id uuid,selected_recipients jsonb,can_manage boolean,
  delivery_boundary text,expiry_rule text
)
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();v_manage boolean;
  v_bundle jsonb;v_owner jsonb;v_count integer;v_read_count integer;
begin
  if not private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) then raise exception using errcode='42501',message='announcement management snapshot is not permitted';end if;
  v_manage:=private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  );
  if p_selected_release_version_id is not null and not v_manage then
    raise exception using errcode='42501',message='announcement recipient detail is not permitted';
  end if;
  v_bundle:=private.staff_announcement_management_bundle(
    p_expected_organization_id,p_expected_branch_id,v_actor,v_manage,v_now,
    p_selected_release_version_id
  );
  if p_selected_release_version_id is not null then
    select item.value into v_owner
    from jsonb_array_elements(v_bundle->'announcements') item
    where item.value->>'active_release_version_id'=p_selected_release_version_id::text
    limit 1;
    if v_owner is null then
      raise exception using errcode='42501',message='selected announcement release is outside current snapshot';
    end if;
    v_count:=jsonb_array_length(v_bundle->'selected_recipients');
    select count(*)::integer into v_read_count
    from jsonb_array_elements(v_bundle->'selected_recipients') recipient
    where recipient.value->'read_at'<>'null'::jsonb;
    if v_count<>(v_owner->>'recipient_count')::integer
      or v_read_count<>(v_owner->>'read_count')::integer then
      raise exception using errcode='40001',message='announcement aggregate and recipient detail changed';
    end if;
  end if;
  if not private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) or v_manage<>private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ) then raise exception using errcode='42501',message='announcement management snapshot authority expired';end if;
  insert into public.audit_events(
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'staff_announcement_management_snapshot',p_selected_release_version_id::text,'{}'::text[],
    jsonb_build_object(
      'projection','page68_staff_announcement_management_v1',
      'announcement_count',jsonb_array_length(v_bundle->'announcements'),
      'announcement_available_total',(v_bundle->'summary'->>'available_total')::integer,
      'recipient_count',jsonb_array_length(v_bundle->'selected_recipients'),
      'management',v_manage
    )
  );
  if not private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.read'
  ) or v_manage<>private.staff_announcement_authority(
    p_expected_organization_id,p_expected_branch_id,'announcements.manage'
  ) or v_bundle is distinct from private.staff_announcement_management_bundle(
    p_expected_organization_id,p_expected_branch_id,v_actor,v_manage,v_now,
    p_selected_release_version_id
  ) then raise exception using errcode='42501',message='announcement management snapshot expired after audit';end if;
  return query select p_expected_organization_id,p_expected_branch_id,v_now,
    v_bundle->'announcements',v_bundle->'summary',v_bundle->'staff_options',v_bundle->'role_options',
    p_selected_release_version_id,v_bundle->'selected_recipients',v_manage,
    'staff_portal_read_receipts_only'::text,
    'explicit_datetime_or_explicit_no_expiry'::text;
end; $$;

create or replace function public.create_staff_announcement_draft(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid)
returns table(version_id uuid,announcement_key uuid,version integer,previous_version_id uuid,version_state text,publish_at timestamptz,expires_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.create_staff_announcement_draft_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
$$;
create or replace function public.publish_staff_announcement(uuid,uuid,uuid,uuid)
returns table(version_id uuid,announcement_key uuid,version integer,draft_version_id uuid,lifecycle text,publish_at timestamptz,expires_at timestamptz,recipient_count integer,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.publish_staff_announcement_atomic($1,$2,$3,$4);
$$;
create or replace function public.withdraw_staff_announcement(uuid,uuid,uuid,uuid,text,uuid)
returns table(version_id uuid,announcement_key uuid,version integer,previous_version_id uuid,lifecycle text,withdrawn_release_version_id uuid,withdrawal_reason text,withdrawn_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.withdraw_staff_announcement_atomic($1,$2,$3,$4,$5,$6);
$$;
create or replace function public.mark_staff_announcement_read(uuid,uuid,uuid,uuid)
returns table(release_version_id uuid,announcement_key uuid,read_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.mark_staff_announcement_read_atomic($1,$2,$3,$4);
$$;
create or replace function public.staff_announcement_snapshot(uuid,uuid)
returns table(generated_at timestamptz,version_id uuid,announcement_key uuid,version integer,version_state text,title text,body text,
  publish_at timestamptz,expires_at timestamptz,lifecycle text,has_pending_draft boolean,
  audience_user_ids uuid[],audience_role_ids uuid[],
  active_release_version_id uuid,active_release_version integer,
  active_release_title text,active_release_body text,active_release_publish_at timestamptz,
  active_release_expires_at timestamptz,recipient_count integer,
  read_count integer,unread_count integer,actor_is_recipient boolean,
  actor_read_at timestamptz,withdrawal_reason text,can_manage boolean)
language sql volatile security invoker set search_path='' as $$ select * from private.staff_announcement_snapshot_core($1,$2); $$;
create or replace function public.staff_announcement_audience_options(uuid,uuid)
returns table(generated_at timestamptz,staff_options jsonb,role_options jsonb)
language sql volatile security invoker set search_path='' as $$ select * from private.staff_announcement_audience_options_core($1,$2); $$;
create or replace function public.staff_announcement_recipient_detail(uuid,uuid,uuid)
returns table(recipient_user_id uuid,recipient_display_name text,recipient_employee_code text,
  recipient_profile_kind text,resolution_kind text,read_at timestamptz)
language sql volatile security invoker set search_path='' as $$ select * from private.staff_announcement_recipient_detail_core($1,$2,$3); $$;
create or replace function public.staff_announcement_management_snapshot(uuid,uuid,uuid)
returns table(
  organization_id uuid,branch_id uuid,generated_at timestamptz,
  announcements jsonb,summary jsonb,staff_options jsonb,role_options jsonb,
  selected_release_version_id uuid,selected_recipients jsonb,can_manage boolean,
  delivery_boundary text,expiry_rule text
)
language sql volatile security invoker set search_path='' as $$
  select * from private.staff_announcement_management_snapshot_core($1,$2,$3);
$$;

revoke all on table public.staff_announcement_versions,public.staff_announcement_recipients,
  public.staff_announcement_read_receipts,private.staff_announcement_operations
  from public,anon,authenticated,service_role;

revoke all on function private.announcement_uuid_array_normalized(uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.prevent_staff_announcement_mutation() from public,anon,authenticated,service_role;
revoke all on function private.validate_staff_announcement_chain() from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_authority(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_recipient_current(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.require_staff_announcement_reauth(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.announcement_lifecycle(timestamptz,timestamptz,boolean,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_snapshot_rows(uuid,uuid,uuid,boolean,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_audience_options_rows(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.create_staff_announcement_draft_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.withdraw_staff_announcement_atomic(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.mark_staff_announcement_read_atomic(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_snapshot_core(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_audience_options_core(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_recipient_detail_core(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_management_bundle(uuid,uuid,uuid,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function private.staff_announcement_management_snapshot_core(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_staff_announcement_draft(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.publish_staff_announcement(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.withdraw_staff_announcement(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mark_staff_announcement_read(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.staff_announcement_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.staff_announcement_audience_options(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.staff_announcement_recipient_detail(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.staff_announcement_management_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;

grant execute on function private.create_staff_announcement_draft_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid) to authenticated;
grant execute on function private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function private.withdraw_staff_announcement_atomic(uuid,uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function private.mark_staff_announcement_read_atomic(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function private.staff_announcement_management_snapshot_core(uuid,uuid,uuid) to authenticated;
grant execute on function public.create_staff_announcement_draft(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid) to authenticated;
grant execute on function public.publish_staff_announcement(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.withdraw_staff_announcement(uuid,uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.mark_staff_announcement_read(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.staff_announcement_management_snapshot(uuid,uuid,uuid) to authenticated;
