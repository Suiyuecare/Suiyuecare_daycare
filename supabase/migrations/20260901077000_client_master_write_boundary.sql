-- Page 60: close generic client master DML and expose two narrow local-source
-- workflows. Central-source identity remains fail-closed until governed import
-- promotion is implemented; neither RPC accepts source/provenance/ciphertext.

create table private.client_master_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  client_id uuid not null,
  expected_row_version bigint,
  result_row_version bigint not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_master_operations_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint client_master_operations_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_master_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint client_master_operations_kind_check
    check (operation_kind in ('create_local', 'update_local')),
  constraint client_master_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint client_master_operations_version_check check (
    (
      operation_kind = 'create_local'
      and expected_row_version is null
      and result_row_version = 1
    )
    or (
      operation_kind = 'update_local'
      and expected_row_version > 0
      and result_row_version = expected_row_version + 1
    )
  )
);

comment on table private.client_master_operations is
  'Immutable actor-scoped receipts for local client master creation and optimistic updates.';

create index client_master_operations_scope_client_idx
  on private.client_master_operations (
    organization_id,
    branch_id,
    client_id,
    created_at desc
  );
create index client_master_operations_reauth_idx
  on private.client_master_operations (reauth_challenge_id);

alter table private.client_master_operations enable row level security;
alter table private.client_master_operations force row level security;

create or replace function private.prevent_client_master_operation_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'client master operation receipts are immutable';
end;
$$;

create trigger client_master_operations_prevent_mutation
before update or delete on private.client_master_operations
for each row execute function private.prevent_client_master_operation_mutation();

create trigger client_master_operations_audit_insert
after insert on private.client_master_operations
for each row execute function private.audit_row_change();

create or replace function private.current_client_master_reauth_challenge()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := clock_timestamp();
  v_challenge_id uuid;
  v_verified_at timestamptz;
begin
  if v_actor is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for client master changes';
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for client master changes';
  end;

  select challenge.id, challenge.factor_verified_at
    into v_challenge_id, v_verified_at
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
  for share of reauth, challenge;

  if v_challenge_id is null
     or v_verified_at is null
     or v_verified_at < v_now - interval '15 minutes'
     or v_verified_at > v_now + interval '1 minute' then
    raise exception using
      errcode = '42501',
      message = 'current immutable AAL2 evidence is required for client master changes';
  end if;

  return v_challenge_id;
end;
$$;

create or replace function private.create_local_client_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client_code text := btrim(p_client_code);
  v_display_name text := btrim(p_display_name);
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_request_hash text;
  v_reauth_challenge_id uuid;
  v_client public.clients%rowtype;
  v_operation private.client_master_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_idempotency_key is null
     or v_client_code is null
     or char_length(v_client_code) not between 1 and 64
     or v_client_code ~ '[[:cntrl:]]'
     or v_display_name is null
     or char_length(v_display_name) not between 1 and 120
     or v_display_name ~ '[[:cntrl:]]'
     or p_date_of_birth > v_today
     or p_date_of_birth < date '1900-01-01' then
    raise exception using
      errcode = '22023',
      message = 'valid local client master fields are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'local client creation is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'operation_kind', 'create_local',
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'actor_user_id', v_actor,
    'client_code', v_client_code,
    'display_name', v_display_name,
    'date_of_birth', p_date_of_birth
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'client-master:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.client_master_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_kind <> 'create_local'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'client master idempotency conflict';
    end if;

    return query select
      v_operation.id,
      v_operation.client_id,
      v_operation.result_row_version,
      true;
    return;
  end if;

  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'local client creation authority expired';
  end if;

  v_reauth_challenge_id := private.current_client_master_reauth_challenge();

  insert into public.clients (
    organization_id,
    branch_id,
    client_code,
    display_name,
    date_of_birth,
    status,
    source_system,
    row_version
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_client_code,
    v_display_name,
    p_date_of_birth,
    'active',
    'local',
    1
  )
  returning * into v_client;

  insert into private.client_master_operations (
    organization_id,
    branch_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    client_id,
    expected_row_version,
    result_row_version,
    reauth_challenge_id
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'create_local',
    p_idempotency_key,
    v_request_hash,
    v_client.id,
    null,
    v_client.row_version,
    v_reauth_challenge_id
  )
  returning * into v_operation;

  return query select
    v_operation.id,
    v_operation.client_id,
    v_operation.result_row_version,
    false;
end;
$$;

create or replace function private.update_local_client_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client_code text := btrim(p_client_code);
  v_display_name text := btrim(p_display_name);
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_request_hash text;
  v_reauth_challenge_id uuid;
  v_client public.clients%rowtype;
  v_operation private.client_master_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_expected_row_version is null
     or p_expected_row_version < 1
     or p_idempotency_key is null
     or v_client_code is null
     or char_length(v_client_code) not between 1 and 64
     or v_client_code ~ '[[:cntrl:]]'
     or v_display_name is null
     or char_length(v_display_name) not between 1 and 120
     or v_display_name ~ '[[:cntrl:]]'
     or p_date_of_birth > v_today
     or p_date_of_birth < date '1900-01-01' then
    raise exception using
      errcode = '22023',
      message = 'valid local client master fields and row version are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'local client update is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'operation_kind', 'update_local',
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'actor_user_id', v_actor,
    'client_id', p_client_id,
    'client_code', v_client_code,
    'display_name', v_display_name,
    'date_of_birth', p_date_of_birth,
    'expected_row_version', p_expected_row_version
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'client-master:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.client_master_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_kind <> 'update_local'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.expected_row_version <> p_expected_row_version
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'client master idempotency conflict';
    end if;

    return query select
      v_operation.id,
      v_operation.client_id,
      v_operation.result_row_version,
      true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or v_client.source_system <> 'local'
     or v_client.status not in ('active', 'suspended')
     or not (select private.can_staff_access_client(p_client_id, 'clients.manage')) then
    raise exception using
      errcode = '42501',
      message = 'client is outside the editable local tenant scope';
  end if;

  if v_client.row_version <> p_expected_row_version then
    raise exception using
      errcode = '40001',
      message = 'client master row version conflict';
  end if;

  if v_client.client_code = v_client_code
     and v_client.display_name = v_display_name
     and v_client.date_of_birth is not distinct from p_date_of_birth then
    raise exception using
      errcode = '22023',
      message = 'client master update must change at least one local field';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'local client update authority expired';
  end if;

  v_reauth_challenge_id := private.current_client_master_reauth_challenge();

  update public.clients client
  set
    client_code = v_client_code,
    display_name = v_display_name,
    date_of_birth = p_date_of_birth,
    row_version = v_client.row_version + 1,
    updated_at = clock_timestamp()
  where client.id = v_client.id
    and client.organization_id = v_client.organization_id
    and client.branch_id = v_client.branch_id
    and client.row_version = v_client.row_version
  returning client.* into v_client;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'client master compare-and-swap failed';
  end if;

  insert into private.client_master_operations (
    organization_id,
    branch_id,
    actor_user_id,
    operation_kind,
    idempotency_key,
    request_hash,
    client_id,
    expected_row_version,
    result_row_version,
    reauth_challenge_id
  ) values (
    v_client.organization_id,
    v_client.branch_id,
    v_actor,
    'update_local',
    p_idempotency_key,
    v_request_hash,
    v_client.id,
    p_expected_row_version,
    v_client.row_version,
    v_reauth_challenge_id
  )
  returning * into v_operation;

  return query select
    v_operation.id,
    v_operation.client_id,
    v_operation.result_row_version,
    false;
end;
$$;

create or replace function public.create_local_client(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.create_local_client_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_code,
    p_display_name,
    p_date_of_birth,
    p_idempotency_key
  );
$$;

create or replace function public.update_local_client(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_client_code text,
  p_display_name text,
  p_date_of_birth date,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  client_id uuid,
  row_version bigint,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.update_local_client_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_client_code,
    p_display_name,
    p_date_of_birth,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

comment on function public.create_local_client(uuid, uuid, text, text, date, uuid) is
  'Creates one unadmitted local-source client in the exact selected tenant context with immutable AAL2 evidence and exact replay.';
comment on function public.update_local_client(uuid, uuid, uuid, text, text, date, bigint, uuid) is
  'Optimistically updates only local-source code, display name, and date of birth; central provenance and lifecycle fields are not accepted.';

revoke all on table private.client_master_operations
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_client_master_operation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.current_client_master_reauth_challenge()
  from public, anon, authenticated, service_role;
revoke all on function private.create_local_client_atomic(
  uuid, uuid, text, text, date, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.update_local_client_atomic(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.create_local_client(
  uuid, uuid, text, text, date, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.update_local_client(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.create_local_client_atomic(
  uuid, uuid, text, text, date, uuid
) to authenticated;
grant execute on function private.update_local_client_atomic(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) to authenticated;
grant execute on function public.create_local_client(
  uuid, uuid, text, text, date, uuid
) to authenticated;
grant execute on function public.update_local_client(
  uuid, uuid, uuid, text, text, date, bigint, uuid
) to authenticated;

-- Lifecycle changes continue through transition_client (its private definer
-- owns the update). No browser or service-role session can write identity,
-- source, ciphertext, branch, lifecycle, or row_version columns directly.
revoke insert, update, delete, truncate on table public.clients
  from public, anon, authenticated, service_role;
