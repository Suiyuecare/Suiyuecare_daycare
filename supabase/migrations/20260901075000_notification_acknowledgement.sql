-- Pages 45/67/89: a recipient-owned acknowledgement boundary.
--
-- Provider delivery updates remain a server-side concern. Authenticated
-- recipients can only move one delivery that is addressed to auth.uid() to
-- read or confirmed through the idempotent public wrapper below.

alter table public.notification_deliveries
  add constraint notification_deliveries_ack_scope_key
    unique (id, organization_id, branch_id, notification_id, recipient_user_id);

create table private.notification_acknowledgement_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  notification_id uuid not null,
  notification_delivery_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  target_status public.delivery_status not null,
  idempotency_key uuid not null,
  request_hash text not null,
  result_status public.delivery_status not null,
  result_read_at timestamptz not null,
  result_confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint notification_acknowledgement_operations_delivery_scope_fkey
    foreign key (
      notification_delivery_id,
      organization_id,
      branch_id,
      notification_id,
      recipient_user_id
    ) references public.notification_deliveries (
      id,
      organization_id,
      branch_id,
      notification_id,
      recipient_user_id
    ) on delete restrict,
  constraint notification_acknowledgement_operations_actor_key
    unique (recipient_user_id, idempotency_key),
  constraint notification_acknowledgement_operations_target_check
    check (target_status in ('read', 'confirmed')),
  constraint notification_acknowledgement_operations_result_check
    check (
      (
        result_status = 'read'
        and result_confirmed_at is null
      )
      or (
        result_status = 'confirmed'
        and result_confirmed_at is not null
        and result_confirmed_at >= result_read_at
      )
    ),
  constraint notification_acknowledgement_operations_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$')
);

comment on table private.notification_acknowledgement_operations is
  'Immutable recipient acknowledgement ledger for exact replay without reopening notification delivery DML.';

create index notification_acknowledgement_operations_delivery_idx
  on private.notification_acknowledgement_operations (
    notification_delivery_id,
    created_at desc
  );

create index notification_acknowledgement_operations_notification_idx
  on private.notification_acknowledgement_operations (notification_id);

create index notification_acknowledgement_operations_scope_idx
  on private.notification_acknowledgement_operations (
    organization_id,
    branch_id,
    recipient_user_id,
    created_at desc
  );

alter table private.notification_acknowledgement_operations enable row level security;
alter table private.notification_acknowledgement_operations force row level security;

create or replace function private.prevent_notification_acknowledgement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'notification acknowledgement history is immutable';
end;
$$;

create trigger notification_acknowledgement_operations_prevent_mutation
before update or delete on private.notification_acknowledgement_operations
for each row execute function private.prevent_notification_acknowledgement_mutation();

create trigger notification_acknowledgement_operations_audit_insert
after insert on private.notification_acknowledgement_operations
for each row execute function private.audit_row_change();

-- A confirmation is terminal even for privileged provider-side delivery
-- updates. Its evidence timestamps are immutable once written.
create or replace function private.prevent_confirmed_delivery_regression()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'confirmed'
     and (
       new.status <> 'confirmed'
       or new.read_at is distinct from old.read_at
       or new.confirmed_at is distinct from old.confirmed_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'confirmed notification delivery cannot regress or lose evidence';
  end if;

  if old.status = 'read' and new.status not in ('read', 'confirmed') then
    raise exception using
      errcode = '23514',
      message = 'read notification delivery can only advance to confirmed';
  end if;

  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception using
      errcode = '23514',
      message = 'notification read time is immutable once recorded';
  end if;

  if old.confirmed_at is not null
     and new.confirmed_at is distinct from old.confirmed_at then
    raise exception using
      errcode = '23514',
      message = 'notification confirmation time is immutable once recorded';
  end if;

  if new.status = 'read'
     and (new.read_at is null or new.confirmed_at is not null) then
    raise exception using
      errcode = '23514',
      message = 'read notification delivery requires read evidence only';
  end if;

  if new.status = 'confirmed'
     and (new.read_at is null or new.confirmed_at is null) then
    raise exception using
      errcode = '23514',
      message = 'confirmed notification delivery requires read and confirmation evidence';
  end if;

  return new;
end;
$$;

create trigger notification_deliveries_prevent_confirmed_regression
before update on public.notification_deliveries
for each row execute function private.prevent_confirmed_delivery_regression();

create or replace function private.acknowledge_notification_delivery_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_notification_delivery_id uuid,
  p_target_status public.delivery_status,
  p_idempotency_key uuid
)
returns table(
  acknowledgement_operation_id uuid,
  notification_delivery_id uuid,
  notification_id uuid,
  status public.delivery_status,
  read_at timestamptz,
  confirmed_at timestamptz,
  acknowledged_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request_hash text;
  v_now timestamptz;
  v_delivery public.notification_deliveries%rowtype;
  v_operation private.notification_acknowledgement_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_notification_delivery_id is null
     or p_target_status is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'organization, branch, delivery, target status, and idempotency key are required';
  end if;

  if p_target_status not in ('read', 'confirmed') then
    raise exception using
      errcode = '22023',
      message = 'notification acknowledgement target must be read or confirmed';
  end if;

  -- Profile activity is checked for every call, including replay. Membership
  -- and delivery state are mutable authorization facts and are evaluated only
  -- for a genuinely new operation below.
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and profile.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'notification acknowledgement requires an active recipient';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'notification_delivery_id', p_notification_delivery_id,
    'recipient_user_id', v_actor,
    'target_status', p_target_status::text
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'notification-ack:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.notification_acknowledgement_operations operation
  where operation.recipient_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.notification_delivery_id <> p_notification_delivery_id
       or v_operation.target_status <> p_target_status
       or v_operation.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'notification acknowledgement idempotency conflict';
    end if;

    return query select
      v_operation.id,
      v_operation.notification_delivery_id,
      v_operation.notification_id,
      v_operation.result_status,
      v_operation.result_read_at,
      v_operation.result_confirmed_at,
      v_operation.created_at,
      true;
    return;
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.profile_id = v_actor
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (
        membership.branch_id is null
        or membership.branch_id = p_expected_branch_id
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'notification acknowledgement is not permitted';
  end if;

  select delivery.* into v_delivery
  from public.notification_deliveries delivery
  where delivery.id = p_notification_delivery_id
    and delivery.organization_id = p_expected_organization_id
    and delivery.branch_id = p_expected_branch_id
    and delivery.recipient_user_id = v_actor
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'notification acknowledgement is not permitted';
  end if;

  if v_delivery.status not in ('queued', 'sent', 'delivered', 'read') then
    raise exception using
      errcode = '23514',
      message = 'notification delivery cannot transition to requested acknowledgement status';
  end if;

  v_now := clock_timestamp();

  if p_target_status = 'read' then
    -- A second independently keyed read is a semantic no-op. The first-read
    -- server timestamp remains authoritative and the new operation is still
    -- captured in the immutable ledger.
    if v_delivery.status <> 'read' or v_delivery.read_at is null then
      update public.notification_deliveries delivery
      set
        status = 'read',
        read_at = coalesce(delivery.read_at, v_now),
        confirmed_at = null
      where delivery.id = v_delivery.id
        and delivery.status = v_delivery.status
      returning delivery.* into v_delivery;

      if not found then
        raise exception using
          errcode = '40001',
          message = 'notification acknowledgement compare-and-swap failed';
      end if;
    end if;
  else
    update public.notification_deliveries delivery
    set
      status = 'confirmed',
      read_at = coalesce(delivery.read_at, v_now),
      confirmed_at = v_now
    where delivery.id = v_delivery.id
      and delivery.status = v_delivery.status
    returning delivery.* into v_delivery;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'notification acknowledgement compare-and-swap failed';
    end if;
  end if;

  insert into private.notification_acknowledgement_operations (
    organization_id,
    branch_id,
    notification_id,
    notification_delivery_id,
    recipient_user_id,
    target_status,
    idempotency_key,
    request_hash,
    result_status,
    result_read_at,
    result_confirmed_at,
    created_at
  ) values (
    v_delivery.organization_id,
    v_delivery.branch_id,
    v_delivery.notification_id,
    v_delivery.id,
    v_actor,
    p_target_status,
    p_idempotency_key,
    v_request_hash,
    v_delivery.status,
    v_delivery.read_at,
    v_delivery.confirmed_at,
    v_now
  )
  returning * into v_operation;

  return query select
    v_operation.id,
    v_operation.notification_delivery_id,
    v_operation.notification_id,
    v_operation.result_status,
    v_operation.result_read_at,
    v_operation.result_confirmed_at,
    v_operation.created_at,
    false;
end;
$$;

create or replace function public.acknowledge_notification_delivery(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_notification_delivery_id uuid,
  p_target_status public.delivery_status,
  p_idempotency_key uuid
)
returns table(
  acknowledgement_operation_id uuid,
  notification_delivery_id uuid,
  notification_id uuid,
  status public.delivery_status,
  read_at timestamptz,
  confirmed_at timestamptz,
  acknowledged_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.acknowledge_notification_delivery_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_notification_delivery_id,
    p_target_status,
    p_idempotency_key
  );
$$;

comment on function public.acknowledge_notification_delivery(
  uuid, uuid, uuid, public.delivery_status, uuid
) is
  'Moves one active recipient own delivery to read or confirmed using server time and an immutable exact-replay ledger.';

revoke all on table private.notification_acknowledgement_operations
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_notification_acknowledgement_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_confirmed_delivery_regression()
  from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_notification_delivery_atomic(
  uuid, uuid, uuid, public.delivery_status, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_notification_delivery(
  uuid, uuid, uuid, public.delivery_status, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.acknowledge_notification_delivery_atomic(
  uuid, uuid, uuid, public.delivery_status, uuid
) to authenticated;
grant execute on function public.acknowledge_notification_delivery(
  uuid, uuid, uuid, public.delivery_status, uuid
) to authenticated;

-- Keep all delivery writes closed to browser callers. In particular, an RPC
-- grant never restores the column-level acknowledgement grants removed by the
-- queue-boundary migration.
revoke insert, update, delete, truncate
  on table public.notification_deliveries from public, anon, authenticated;
revoke update (status, read_at, confirmed_at, updated_at)
  on table public.notification_deliveries from public, anon, authenticated;
