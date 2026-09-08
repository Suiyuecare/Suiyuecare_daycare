-- Page 61: immutable client admission/change/closure lifecycle.
--
-- The public RPC is SECURITY INVOKER. It derives tenant scope from the locked
-- client row, requires a recent challenge-backed AAL2 event, and writes the
-- transition plus the client status change in the caller's transaction.

create type public.client_transition_kind as enum (
  'admit',
  'suspend',
  'resume',
  'transfer',
  'close',
  'death'
);

create table public.client_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  event_kind public.client_transition_kind not null,
  effective_on date not null,
  reason text not null,
  handoff_note text,
  from_status public.client_status not null,
  to_status public.client_status not null,
  base_row_version bigint not null,
  resulting_row_version bigint not null,
  idempotency_key uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_transitions_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_transitions_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint client_transitions_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint client_transitions_client_result_version_key
    unique (client_id, resulting_row_version),
  constraint client_transitions_reason_check
    check (char_length(btrim(reason)) between 1 and 1000),
  constraint client_transitions_handoff_check check (
    (
      event_kind in ('transfer', 'close', 'death')
      and handoff_note is not null
      and char_length(btrim(handoff_note)) between 1 and 2000
    )
    or (
      event_kind in ('admit', 'suspend', 'resume')
      and (
        handoff_note is null
        or char_length(btrim(handoff_note)) between 1 and 2000
      )
    )
  ),
  constraint client_transitions_version_check check (
    base_row_version > 0
    and resulting_row_version = base_row_version + 1
  ),
  constraint client_transitions_state_mapping_check check (
    (event_kind = 'admit' and from_status = 'active' and to_status = 'active')
    or (event_kind = 'suspend' and from_status = 'active' and to_status = 'suspended')
    or (event_kind = 'resume' and from_status = 'suspended' and to_status = 'active')
    or (
      event_kind = 'transfer'
      and from_status in ('active', 'suspended')
      and to_status = 'transferred'
    )
    or (
      event_kind = 'close'
      and from_status in ('active', 'suspended')
      and to_status = 'closed'
    )
    or (
      event_kind = 'death'
      and from_status in ('active', 'suspended')
      and to_status = 'deceased'
    )
  )
);

comment on table public.client_transitions is
  'Append-only admission, suspension, resumption, transfer, closure, and death history for a client.';
comment on column public.client_transitions.reason is
  'Required business reason for every transition; kept separate from optional/required handoff detail.';
comment on column public.client_transitions.handoff_note is
  'Required for transfer, closure, and death; optional for admission, suspension, and resumption.';

create index client_transitions_scope_history_idx
  on public.client_transitions (
    organization_id,
    branch_id,
    client_id,
    effective_on desc,
    created_at desc
  );

-- The actor foreign key is covered by the actor/idempotency unique index. The
-- composite client foreign key is covered by the scope-history index.

create or replace function private.validate_client_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_last_effective_on date;
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_expected_to_status public.client_status;
begin
  if v_actor is null or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'recent AAL2 reauthentication is required for a client transition';
  end if;

  if new.idempotency_key is null
     or new.client_id is null
     or new.event_kind is null
     or new.effective_on is null
     or new.base_row_version is null
     or new.base_row_version < 1 then
    raise exception using
      errcode = '22023',
      message = 'client, transition kind, effective date, row version, and idempotency key are required';
  end if;

  select client.*
    into v_client
  from public.clients client
  where client.id = new.client_id
  for update;

  if not found
     or not (select private.can_staff_access_client(new.client_id, 'clients.manage')) then
    raise exception using
      errcode = '42501',
      message = 'client transition is not permitted';
  end if;

  if (new.organization_id is not null and new.organization_id <> v_client.organization_id)
     or (new.branch_id is not null and new.branch_id <> v_client.branch_id)
     or (new.actor_user_id is not null and new.actor_user_id <> v_actor) then
    raise exception using
      errcode = '42501',
      message = 'client transition scope or actor does not match the authenticated context';
  end if;

  if new.effective_on > v_today then
    raise exception using
      errcode = '22023',
      message = 'client transition effective date cannot be in the future';
  end if;

  select max(transition.effective_on)
    into v_last_effective_on
  from public.client_transitions transition
  where transition.client_id = v_client.id;

  if v_last_effective_on is not null and new.effective_on < v_last_effective_on then
    raise exception using
      errcode = '23514',
      message = 'client transition effective date cannot precede existing history';
  end if;

  new.reason := btrim(new.reason);
  new.handoff_note := nullif(btrim(new.handoff_note), '');

  if new.reason is null or char_length(new.reason) not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'a transition reason between 1 and 1000 characters is required';
  end if;

  if new.event_kind in ('transfer', 'close', 'death')
     and (
       new.handoff_note is null
       or char_length(new.handoff_note) not between 1 and 2000
     ) then
    raise exception using
      errcode = '22023',
      message = 'handoff detail is required for transfer, closure, and death';
  end if;

  if new.handoff_note is not null
     and char_length(new.handoff_note) not between 1 and 2000 then
    raise exception using
      errcode = '22023',
      message = 'handoff detail must not exceed 2000 characters';
  end if;

  case new.event_kind
    when 'admit' then
      if v_client.status <> 'active'
         or v_client.admitted_on is not null
         or v_client.ended_on is not null then
        raise exception using
          errcode = '23514',
          message = 'admission requires an active client without an existing admission date';
      end if;
      v_expected_to_status := 'active';
    when 'suspend' then
      if v_client.status <> 'active'
         or v_client.admitted_on is null
         or v_client.ended_on is not null then
        raise exception using
          errcode = '23514',
          message = 'suspension requires an admitted active client';
      end if;
      v_expected_to_status := 'suspended';
    when 'resume' then
      if v_client.status <> 'suspended'
         or v_client.admitted_on is null
         or v_client.ended_on is not null then
        raise exception using
          errcode = '23514',
          message = 'resumption requires an admitted suspended client';
      end if;
      v_expected_to_status := 'active';
    when 'transfer' then
      if v_client.status not in ('active', 'suspended')
         or v_client.admitted_on is null
         or v_client.ended_on is not null then
        raise exception using
          errcode = '23514',
          message = 'transfer requires an admitted non-terminal client';
      end if;
      v_expected_to_status := 'transferred';
    when 'close' then
      if v_client.status not in ('active', 'suspended')
         or v_client.admitted_on is null
         or v_client.ended_on is not null then
        raise exception using
          errcode = '23514',
          message = 'closure requires an admitted non-terminal client';
      end if;
      v_expected_to_status := 'closed';
    when 'death' then
      if v_client.status not in ('active', 'suspended')
         or v_client.admitted_on is null
         or v_client.ended_on is not null then
        raise exception using
          errcode = '23514',
          message = 'death requires an admitted non-terminal client';
      end if;
      v_expected_to_status := 'deceased';
  end case;

  if v_client.admitted_on is not null and new.effective_on < v_client.admitted_on then
    raise exception using
      errcode = '23514',
      message = 'client transition cannot precede the admission date';
  end if;

  if new.base_row_version <> v_client.row_version then
    raise exception using
      errcode = '40001',
      message = 'client row version conflict';
  end if;

  if new.from_status is not null and new.from_status <> v_client.status then
    raise exception using
      errcode = '40001',
      message = 'client status changed before the transition was applied';
  end if;

  if new.to_status is not null and new.to_status <> v_expected_to_status then
    raise exception using
      errcode = '23514',
      message = 'client transition target status does not match its event kind';
  end if;

  new.organization_id := v_client.organization_id;
  new.branch_id := v_client.branch_id;
  new.actor_user_id := v_actor;
  new.from_status := v_client.status;
  new.to_status := v_expected_to_status;
  new.base_row_version := v_client.row_version;
  new.resulting_row_version := v_client.row_version + 1;
  new.created_at := clock_timestamp();

  return new;
end;
$$;

create or replace function private.enforce_client_lifecycle_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
     and new.admitted_on is not distinct from old.admitted_on
     and new.ended_on is not distinct from old.ended_on then
    return new;
  end if;

  if new.row_version <> old.row_version + 1
     or not exists (
       select 1
       from public.client_transitions transition
       where transition.client_id = old.id
         and transition.organization_id = old.organization_id
         and transition.branch_id = old.branch_id
         and transition.actor_user_id = (select auth.uid())
         and transition.base_row_version = old.row_version
         and transition.resulting_row_version = new.row_version
         and transition.from_status = old.status
         and transition.to_status = new.status
         and (
           (
             transition.event_kind = 'admit'
             and new.admitted_on = transition.effective_on
             and new.ended_on is null
           )
           or (
             transition.event_kind in ('suspend', 'resume')
             and new.admitted_on is not distinct from old.admitted_on
             and new.ended_on is not distinct from old.ended_on
           )
           or (
             transition.event_kind in ('transfer', 'close', 'death')
             and new.admitted_on is not distinct from old.admitted_on
             and new.ended_on = transition.effective_on
           )
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'client lifecycle fields may change only through an immutable transition';
  end if;

  return new;
end;
$$;

create or replace function private.apply_client_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  update public.clients client
  set
    status = new.to_status,
    admitted_on = case
      when new.event_kind = 'admit' then new.effective_on
      else client.admitted_on
    end,
    ended_on = case
      when new.event_kind in ('transfer', 'close', 'death') then new.effective_on
      else client.ended_on
    end,
    row_version = new.resulting_row_version,
    updated_at = clock_timestamp()
  where client.id = new.client_id
    and client.organization_id = new.organization_id
    and client.branch_id = new.branch_id
    and client.row_version = new.base_row_version
  returning client.id into v_updated_id;

  if v_updated_id is null then
    raise exception using
      errcode = '40001',
      message = 'client row version conflict while applying transition';
  end if;

  return new;
end;
$$;

create or replace function private.prevent_client_transition_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'client transitions are append-only';
end;
$$;

create trigger client_transitions_validate
before insert on public.client_transitions
for each row execute function private.validate_client_transition();

create trigger client_transitions_apply_client_state
after insert on public.client_transitions
for each row execute function private.apply_client_transition();

create trigger client_transitions_prevent_mutation
before update or delete on public.client_transitions
for each row execute function private.prevent_client_transition_mutation();

create trigger client_transitions_audit_row_change
after insert or update or delete on public.client_transitions
for each row execute function private.audit_row_change();

create trigger clients_enforce_lifecycle_transition
before update of status, admitted_on, ended_on on public.clients
for each row execute function private.enforce_client_lifecycle_update();

alter table public.client_transitions enable row level security;
alter table public.client_transitions force row level security;

create policy client_transitions_select
on public.client_transitions for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'clients.read')));

create policy client_transitions_insert
on public.client_transitions for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and (select private.can_staff_access_client(client_id, 'clients.manage'))
  and (select private.has_recent_aal2(15))
);

create or replace function private.transition_client_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_event_kind public.client_transition_kind,
  p_effective_on date,
  p_reason text,
  p_handoff_note text,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  transition_id uuid,
  client_id uuid,
  from_status public.client_status,
  to_status public.client_status,
  resulting_row_version bigint,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client_row_version bigint;
  v_existing public.client_transitions%rowtype;
  v_created public.client_transitions%rowtype;
  v_reason text := btrim(p_reason);
  v_handoff_note text := nullif(btrim(p_handoff_note), '');
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.manage'
     ))
     or not (select private.has_recent_aal2(15)) then
    raise exception using
      errcode = '42501',
      message = 'recent AAL2 reauthentication is required for a client transition';
  end if;

  if p_client_id is null
     or p_event_kind is null
     or p_effective_on is null
     or p_expected_row_version is null
     or p_expected_row_version < 1
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'client, transition kind, effective date, row version, and idempotency key are required';
  end if;

  select transition.*
    into v_existing
  from public.client_transitions transition
  where transition.actor_user_id = v_actor
    and transition.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id then
      raise exception using
        errcode = '42501',
        message = 'client transition replay is outside the selected tenant context';
    end if;

    if v_existing.client_id <> p_client_id
       or v_existing.event_kind <> p_event_kind
       or v_existing.effective_on <> p_effective_on
       or v_existing.reason is distinct from v_reason
       or v_existing.handoff_note is distinct from v_handoff_note
       or v_existing.base_row_version <> p_expected_row_version then
      raise exception using
        errcode = '23505',
        message = 'client transition idempotency conflict';
    end if;

    if not (select private.can_staff_access_client(v_existing.client_id, 'clients.manage')) then
      raise exception using
        errcode = '42501',
        message = 'client transition replay is not permitted';
    end if;

    return query
    select
      v_existing.id,
      v_existing.client_id,
      v_existing.from_status,
      v_existing.to_status,
      v_existing.resulting_row_version,
      true;
    return;
  end if;

  select client.row_version
    into v_client_row_version
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select private.can_staff_access_client(p_client_id, 'clients.manage')) then
    raise exception using
      errcode = '42501',
      message = 'client transition is not permitted';
  end if;

  -- A concurrent replay can pass the first lookup and then wait on this
  -- client lock while the winning transaction commits. Recheck the durable
  -- idempotency record after the lock so the waiter returns the stored result
  -- instead of reporting a stale-version conflict.
  select transition.*
    into v_existing
  from public.client_transitions transition
  where transition.actor_user_id = v_actor
    and transition.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id then
      raise exception using
        errcode = '42501',
        message = 'client transition replay is outside the selected tenant context';
    end if;

    if v_existing.client_id <> p_client_id
       or v_existing.event_kind <> p_event_kind
       or v_existing.effective_on <> p_effective_on
       or v_existing.reason is distinct from v_reason
       or v_existing.handoff_note is distinct from v_handoff_note
       or v_existing.base_row_version <> p_expected_row_version then
      raise exception using
        errcode = '23505',
        message = 'client transition idempotency conflict';
    end if;

    return query
    select
      v_existing.id,
      v_existing.client_id,
      v_existing.from_status,
      v_existing.to_status,
      v_existing.resulting_row_version,
      true;
    return;
  end if;

  if v_client_row_version <> p_expected_row_version then
    raise exception using
      errcode = '40001',
      message = 'client row version conflict';
  end if;

  insert into public.client_transitions (
    client_id,
    event_kind,
    effective_on,
    reason,
    handoff_note,
    base_row_version,
    idempotency_key,
    actor_user_id
  ) values (
    p_client_id,
    p_event_kind,
    p_effective_on,
    v_reason,
    v_handoff_note,
    p_expected_row_version,
    p_idempotency_key,
    v_actor
  )
  returning * into v_created;

  return query
  select
    v_created.id,
    v_created.client_id,
    v_created.from_status,
    v_created.to_status,
    v_created.resulting_row_version,
    false;
end;
$$;

create or replace function public.transition_client(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_event_kind public.client_transition_kind,
  p_effective_on date,
  p_reason text,
  p_handoff_note text,
  p_expected_row_version bigint,
  p_idempotency_key uuid
)
returns table(
  transition_id uuid,
  client_id uuid,
  from_status public.client_status,
  to_status public.client_status,
  resulting_row_version bigint,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.transition_client_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_event_kind,
    p_effective_on,
    p_reason,
    p_handoff_note,
    p_expected_row_version,
    p_idempotency_key
  );
$$;

comment on function public.transition_client(
  uuid,
  uuid,
  uuid,
  public.client_transition_kind,
  date,
  text,
  text,
  bigint,
  uuid
) is
  'The sole mutation boundary for one authorized client lifecycle transition, with selected-context binding, optimistic concurrency, and actor-scoped idempotency.';

revoke all on function private.validate_client_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_client_lifecycle_update()
  from public, anon, authenticated, service_role;
revoke all on function private.apply_client_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_client_transition_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.transition_client_atomic(
  uuid,
  uuid,
  uuid,
  public.client_transition_kind,
  date,
  text,
  text,
  bigint,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function private.transition_client_atomic(
  uuid,
  uuid,
  uuid,
  public.client_transition_kind,
  date,
  text,
  text,
  bigint,
  uuid
) to authenticated;

revoke all on type public.client_transition_kind
  from public, anon, authenticated, service_role;
grant usage on type public.client_transition_kind to authenticated, service_role;

revoke all on table public.client_transitions
  from public, anon, authenticated, service_role;
grant select on table public.client_transitions to authenticated;
grant select on table public.client_transitions to service_role;

revoke all on function public.transition_client(
  uuid,
  uuid,
  uuid,
  public.client_transition_kind,
  date,
  text,
  text,
  bigint,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.transition_client(
  uuid,
  uuid,
  uuid,
  public.client_transition_kind,
  date,
  text,
  text,
  bigint,
  uuid
) to authenticated;
