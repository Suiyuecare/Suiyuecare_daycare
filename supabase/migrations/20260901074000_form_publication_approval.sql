-- Page 82: tenant form/rule publication is a two-person, immutable workflow.
-- Existing draft authoring stays read-only until its own strict RPC lands;
-- this migration closes direct publication and historical-rule rewrite paths.

alter table public.form_versions
  add column content_hash text;

alter table public.form_versions
  add constraint form_versions_content_hash_check check (
    content_hash is null or content_hash ~ '^[a-f0-9]{64}$'
  );

create table public.form_publication_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  form_definition_id uuid not null references public.form_definitions(id) on delete restrict,
  form_version_id uuid not null references public.form_versions(id) on delete restrict,
  form_content_hash text not null,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  requested_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  request_idempotency_key uuid not null,
  request_hash text not null,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approved_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  approval_idempotency_key uuid,
  approval_hash text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint form_publication_requests_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint form_publication_requests_hash_check check (
    form_content_hash ~ '^[a-f0-9]{64}$'
    and request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint form_publication_requests_status_check
    check (status in ('pending', 'approved')),
  constraint form_publication_requests_approval_check check (
    (
      status = 'pending'
      and approved_by is null
      and approved_at is null
      and approved_reauth_challenge_id is null
      and approval_idempotency_key is null
      and approval_hash is null
    )
    or (
      status = 'approved'
      and approved_by is not null
      and approved_by <> requested_by
      and approved_at is not null
      and approved_reauth_challenge_id is not null
      and approved_reauth_challenge_id <> requested_reauth_challenge_id
      and approval_idempotency_key is not null
      and approval_hash ~ '^[a-f0-9]{64}$'
    )
  ),
  constraint form_publication_requests_request_idempotency_key
    unique (organization_id, requested_by, request_idempotency_key),
  constraint form_publication_requests_version_definition_key
    unique (id, form_version_id, form_definition_id)
);

comment on table public.form_publication_requests is
  'Immutable requester and independent approver evidence for publishing one tenant form/rule version.';
comment on column public.form_versions.content_hash is
  'Canonical identity of the exact definition, dates, schema, and scoring rules published by the governed workflow; legacy versions may be null.';

create unique index form_publication_requests_one_pending_version_idx
  on public.form_publication_requests (form_version_id)
  where status = 'pending';
create unique index form_publication_requests_approval_idempotency_idx
  on public.form_publication_requests (
    organization_id,
    approved_by,
    approval_idempotency_key
  )
  where approved_by is not null and approval_idempotency_key is not null;
create index form_publication_requests_queue_idx
  on public.form_publication_requests (
    organization_id,
    branch_id,
    status,
    requested_at desc
  );
create index form_publication_requests_requested_challenge_idx
  on public.form_publication_requests (requested_reauth_challenge_id);
create index form_publication_requests_approved_challenge_idx
  on public.form_publication_requests (approved_reauth_challenge_id)
  where approved_reauth_challenge_id is not null;

create or replace function private.protect_form_publication_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'form publication requests are immutable';
  end if;

  if old.status <> 'pending'
     or new.status <> 'approved'
     or new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.branch_id is distinct from old.branch_id
     or new.form_definition_id is distinct from old.form_definition_id
     or new.form_version_id is distinct from old.form_version_id
     or new.form_content_hash is distinct from old.form_content_hash
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at
     or new.requested_reauth_challenge_id is distinct from old.requested_reauth_challenge_id
     or new.request_idempotency_key is distinct from old.request_idempotency_key
     or new.request_hash is distinct from old.request_hash
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'form publication request identity and evidence are immutable';
  end if;

  return new;
end;
$$;

create trigger form_publication_requests_protect
before update or delete on public.form_publication_requests
for each row execute function private.protect_form_publication_request();

create trigger form_publication_requests_set_updated_at
before update on public.form_publication_requests
for each row execute function private.set_updated_at();

create trigger form_publication_requests_audit_row_change
after insert or update or delete on public.form_publication_requests
for each row execute function private.audit_row_change();

alter table public.form_publication_requests enable row level security;
alter table public.form_publication_requests force row level security;

create policy form_publication_requests_select
on public.form_publication_requests for select
to authenticated
using (
  (select private.is_active_member(organization_id, branch_id))
  and (
    requested_by = (select auth.uid())
    or (select private.has_permission(organization_id, null, 'forms.manage'))
  )
);

create or replace function private.request_form_publication_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_form_version_id uuid,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  status text,
  form_content_hash text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz;
  v_definition public.form_definitions%rowtype;
  v_version public.form_versions%rowtype;
  v_challenge private.reauth_challenges%rowtype;
  v_existing public.form_publication_requests%rowtype;
  v_created public.form_publication_requests%rowtype;
  v_content_hash text;
  v_request_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_form_version_id is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'valid form publication request fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(p_expected_organization_id, null, 'forms.manage'))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'forms.manage'
     ))
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
     ) then
    raise exception using errcode = '42501', message = 'form publication request is not permitted';
  end if;

  select version.* into v_version
  from public.form_versions version
  where version.id = p_form_version_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'form version is outside the governed tenant scope';
  end if;

  select definition.* into v_definition
  from public.form_definitions definition
  where definition.id = v_version.form_definition_id
    and definition.organization_id = p_expected_organization_id
    and not definition.is_official
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'official or cross-tenant forms cannot be published by a tenant';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'form_definition_id', v_definition.id,
    'form_key', v_definition.form_key,
    'name', v_definition.name,
    'category', v_definition.category,
    'is_official', v_definition.is_official,
    'form_version_id', v_version.id,
    'version', v_version.version,
    'effective_from', v_version.effective_from,
    'effective_to', v_version.effective_to,
    'schema_json', v_version.schema_json,
    'scoring_json', v_version.scoring_json
  )::text, 'UTF8')), 'hex');

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'form_version_id', v_version.id,
    'form_content_hash', v_content_hash,
    'requested_by', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'form-publish-request:' || p_expected_organization_id::text || ':' ||
    v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select request.* into v_existing
  from public.form_publication_requests request
  where request.organization_id = p_expected_organization_id
    and request.requested_by = v_actor
    and request.request_idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.branch_id <> p_expected_branch_id
       or v_existing.form_version_id <> p_form_version_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'form publication request idempotency conflict';
    end if;

    return query
    select v_existing.id, v_existing.status, v_existing.form_content_hash, true;
    return;
  end if;

  if v_version.status <> 'draft'
     or v_version.effective_from is null then
    raise exception using errcode = '23514', message = 'only a dated draft form version can be submitted for publication';
  end if;

  if exists (
    select 1 from public.form_publication_requests request
    where request.form_version_id = v_version.id
      and request.status = 'pending'
  ) then
    raise exception using errcode = '23505', message = 'form version already has a pending publication request';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(p_expected_organization_id, null, 'forms.manage'))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'forms.manage'
     )) then
    raise exception using errcode = '42501', message = 'form publication request authority expired';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for form publication';
  end;

  select challenge.* into v_challenge
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = v_actor
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  v_now := clock_timestamp();
  if v_challenge.id is null
     or v_challenge.factor_verified_at is null
     or v_challenge.factor_verified_at < v_now - interval '15 minutes'
     or v_challenge.factor_verified_at > v_now + interval '1 minute' then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for form publication';
  end if;

  insert into public.form_publication_requests (
    organization_id,
    branch_id,
    form_definition_id,
    form_version_id,
    form_content_hash,
    requested_by,
    requested_at,
    requested_reauth_challenge_id,
    request_idempotency_key,
    request_hash
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_definition.id,
    v_version.id,
    v_content_hash,
    v_actor,
    v_now,
    v_challenge.id,
    p_idempotency_key,
    v_request_hash
  )
  returning * into v_created;

  return query select v_created.id, v_created.status, v_created.form_content_hash, false;
end;
$$;

create or replace function public.request_form_publication(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_form_version_id uuid,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  status text,
  form_content_hash text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.request_form_publication_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_form_version_id,
    p_idempotency_key
  );
$$;

create or replace function private.approve_form_publication_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  form_version_id uuid,
  status text,
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
  v_session_id uuid;
  v_now timestamptz;
  v_request public.form_publication_requests%rowtype;
  v_definition public.form_definitions%rowtype;
  v_version public.form_versions%rowtype;
  v_challenge private.reauth_challenges%rowtype;
  v_content_hash text;
  v_approval_hash text;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_request_id is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'valid form publication approval fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(p_expected_organization_id, null, 'forms.manage'))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'forms.manage'
     )) then
    raise exception using errcode = '42501', message = 'form publication approval is not permitted';
  end if;

  select request.* into v_request
  from public.form_publication_requests request
  where request.id = p_request_id
    and request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'form publication request is outside the selected tenant context';
  end if;

  v_approval_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'request_id', v_request.id,
    'request_hash', v_request.request_hash,
    'approved_by', v_actor,
    'approval_idempotency_key', p_idempotency_key
  )::text, 'UTF8')), 'hex');

  if v_request.status = 'approved' then
    select version.* into v_version
    from public.form_versions version
    where version.id = v_request.form_version_id;

    if v_request.approved_by = v_actor
       and v_request.approval_idempotency_key = p_idempotency_key
       and v_request.approval_hash = v_approval_hash
       and v_version.status = 'published'
       and v_version.content_hash = v_request.form_content_hash then
      return query
      select v_request.id, v_request.form_version_id, v_request.status,
             v_version.published_at, true;
      return;
    end if;
    raise exception using errcode = '23505', message = 'form publication request was already decided';
  end if;

  if v_request.requested_by = v_actor then
    raise exception using errcode = '42501', message = 'form publication requires an independent second approver';
  end if;

  -- Different draft rows of the same form definition must not pass their
  -- overlap checks concurrently. Serialize all publication decisions for the
  -- definition before locking and revalidating the selected version.
  perform pg_advisory_xact_lock(hashtextextended(
    'form-publish-definition:' || v_request.form_definition_id::text,
    0
  ));

  select version.* into v_version
  from public.form_versions version
  where version.id = v_request.form_version_id
    and version.form_definition_id = v_request.form_definition_id
  for update;

  if not found or v_version.status <> 'draft' or v_version.effective_from is null then
    raise exception using errcode = '23514', message = 'submitted form version is no longer a dated draft';
  end if;

  select definition.* into v_definition
  from public.form_definitions definition
  where definition.id = v_request.form_definition_id
    and definition.organization_id = v_request.organization_id
    and not definition.is_official
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'submitted form left the governed tenant scope';
  end if;

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', v_request.organization_id,
    'form_definition_id', v_definition.id,
    'form_key', v_definition.form_key,
    'name', v_definition.name,
    'category', v_definition.category,
    'is_official', v_definition.is_official,
    'form_version_id', v_version.id,
    'version', v_version.version,
    'effective_from', v_version.effective_from,
    'effective_to', v_version.effective_to,
    'schema_json', v_version.schema_json,
    'scoring_json', v_version.scoring_json
  )::text, 'UTF8')), 'hex');

  if v_content_hash <> v_request.form_content_hash then
    raise exception using errcode = '40001', message = 'form draft changed after publication was requested';
  end if;

  if exists (
    select 1
    from public.form_versions other
    where other.form_definition_id = v_version.form_definition_id
      and other.id <> v_version.id
      and other.status in ('published', 'retired')
      and daterange(
        coalesce(other.effective_from, '-infinity'::date),
        coalesce(other.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        v_version.effective_from,
        coalesce(v_version.effective_to, 'infinity'::date),
        '[]'
      )
    for update
  ) then
    raise exception using errcode = '23P01', message = 'published form effective periods cannot overlap';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(v_request.organization_id, null, 'forms.manage'))
     or not (select private.has_permission(
       v_request.organization_id,
       v_request.branch_id,
       'forms.manage'
     )) then
    raise exception using errcode = '42501', message = 'form publication approval authority expired';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'immutable AAL2 evidence is required for form publication';
  end;

  select challenge.* into v_challenge
  from private.reauth_events reauth
  join private.reauth_challenges challenge
    on challenge.id = reauth.challenge_id
   and challenge.user_id = reauth.user_id
   and challenge.session_id = reauth.session_id
  where reauth.user_id = v_actor
    and reauth.session_id = v_session_id
    and reauth.aal = 'aal2'
    and reauth.revoked_at is null
    and reauth.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null
    and challenge.invalidated_at is null
    and challenge.factor_method = reauth.verification_method
    and challenge.factor_verified_at = reauth.verified_at
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1
  for share of reauth, challenge;

  v_now := clock_timestamp();
  if v_challenge.id is null
     or v_challenge.id = v_request.requested_reauth_challenge_id
     or v_challenge.factor_verified_at is null
     or v_challenge.factor_verified_at < v_now - interval '15 minutes'
     or v_challenge.factor_verified_at > v_now + interval '1 minute' then
    raise exception using errcode = '42501', message = 'independent immutable AAL2 evidence is required for form approval';
  end if;

  update public.form_versions version
  set status = 'published',
      published_at = v_now,
      published_by = v_actor,
      content_hash = v_content_hash,
      updated_at = v_now
  where version.id = v_version.id;

  update public.form_publication_requests request
  set status = 'approved',
      approved_by = v_actor,
      approved_at = v_now,
      approved_reauth_challenge_id = v_challenge.id,
      approval_idempotency_key = p_idempotency_key,
      approval_hash = v_approval_hash,
      updated_at = v_now
  where request.id = v_request.id
  returning * into v_request;

  return query
  select v_request.id, v_request.form_version_id, v_request.status, v_now, false;
end;
$$;

create or replace function public.approve_form_publication(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid
)
returns table(
  request_id uuid,
  form_version_id uuid,
  status text,
  published_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.approve_form_publication_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_request_id,
    p_idempotency_key
  );
$$;

comment on function public.request_form_publication(uuid, uuid, uuid, uuid) is
  'Creates or exactly replays one tenant form publication request with immutable requester AAL2 evidence.';
comment on function public.approve_form_publication(uuid, uuid, uuid, uuid) is
  'Publishes one unchanged non-overlapping tenant form version after an independent AAL2 approval.';

revoke all on function private.protect_form_publication_request()
  from public, anon, authenticated, service_role;
revoke all on function private.request_form_publication_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.approve_form_publication_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_form_publication(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_form_publication(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.request_form_publication_atomic(uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function private.approve_form_publication_atomic(uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.request_form_publication(uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.approve_form_publication(uuid, uuid, uuid, uuid)
  to authenticated;

grant select on table public.form_publication_requests to authenticated;
revoke insert, update, delete on table public.form_publication_requests from authenticated, service_role;

-- Tenant form definitions and version rows are now mutation-RPC only. The
-- draft authoring RPC remains deliberately closed rather than leaving a route
-- that can publish by spoofing status, publisher, time, formula, or dates.
revoke insert, update, delete on table public.form_definitions from authenticated, service_role;
revoke insert, update, delete on table public.form_versions from authenticated, service_role;
