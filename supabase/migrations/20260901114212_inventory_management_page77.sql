-- Page 77: branch inventory with immutable batches and append-only ledgers.
--
-- Supplier purchasing, medication orders, financial posting, safety levels,
-- near-expiry windows and stocktake cadence are intentionally not inferred.
-- Policy-derived flags remain not_configured until a governed policy version
-- is published by a future dual-approval workflow.

insert into public.permissions (permission_key, description, risk_level) values
  ('inventory.read', 'Read branch inventory snapshots and ledgers', 1),
  ('inventory.manage', 'Create inventory masters and record routine movements', 2),
  ('inventory.adjust', 'Record high-risk adjustments and stocktakes', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'case_manager_social_worker',
    'nurse', 'care_worker', 'professional', 'finance_claims'
  )
  and permission.permission_key = 'inventory.read'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor', 'nurse')
  and permission.permission_key = 'inventory.manage'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key = 'inventory.adjust'
on conflict (role_id, permission_id) do nothing;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  item_code text not null,
  item_name text not null,
  unit text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  content_hash text not null,
  constraint inventory_items_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint inventory_items_id_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint inventory_items_code_key unique (
    organization_id, branch_id, item_code
  ),
  constraint inventory_items_code_check check (
    char_length(item_code) between 1 and 80 and item_code !~ '[[:cntrl:]]'
  ),
  constraint inventory_items_name_check check (
    char_length(item_name) between 1 and 160 and item_name !~ '[[:cntrl:]]'
  ),
  constraint inventory_items_unit_check check (
    char_length(unit) between 1 and 40 and unit !~ '[[:cntrl:]]'
  ),
  constraint inventory_items_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.inventory_item_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  item_id uuid not null,
  ledger_version integer not null,
  status text not null,
  reason text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  constraint inventory_item_status_item_scope_fkey
    foreign key (item_id, organization_id, branch_id)
    references public.inventory_items(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_item_status_id_scope_key unique (
    id, organization_id, branch_id, item_id
  ),
  constraint inventory_item_status_version_key unique (item_id, ledger_version),
  constraint inventory_item_status_value_check check (status in ('active', 'inactive')),
  constraint inventory_item_status_version_check check (ledger_version > 0),
  constraint inventory_item_status_reason_check check (
    (ledger_version = 1 and status = 'active' and reason is null)
    or (
      ledger_version > 1 and char_length(reason) between 1 and 1000
      and translate(reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
    )
  )
);

create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  item_id uuid not null,
  batch_number text not null,
  expiry_date date not null,
  unit text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  content_hash text not null,
  constraint inventory_batches_item_scope_fkey
    foreign key (item_id, organization_id, branch_id)
    references public.inventory_items(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_batches_id_scope_key unique (
    id, organization_id, branch_id, item_id
  ),
  constraint inventory_batches_number_key unique (
    organization_id, branch_id, item_id, batch_number
  ),
  constraint inventory_batches_number_check check (
    char_length(batch_number) between 1 and 120
    and batch_number !~ '[[:cntrl:]]'
  ),
  constraint inventory_batches_unit_check check (
    char_length(unit) between 1 and 40 and unit !~ '[[:cntrl:]]'
  ),
  constraint inventory_batches_expiry_check check (
    extract(year from expiry_date) between 2000 and 2200
  ),
  constraint inventory_batches_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  item_id uuid not null,
  batch_id uuid not null,
  ledger_version integer not null,
  movement_type text not null,
  quantity numeric(18,4) not null,
  quantity_delta numeric(18,4) not null,
  balance_after numeric(18,4) not null,
  occurred_at timestamptz not null,
  original_movement_id uuid,
  client_id uuid,
  instruction_reference text,
  issued_to_user_id uuid references auth.users(id) on delete restrict,
  purpose text,
  destination_unit text,
  reason text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint inventory_movements_batch_scope_fkey
    foreign key (batch_id, organization_id, branch_id, item_id)
    references public.inventory_batches(id, organization_id, branch_id, item_id)
    on delete restrict,
  constraint inventory_movements_id_scope_key unique (
    id, organization_id, branch_id, item_id, batch_id
  ),
  constraint inventory_movements_id_branch_scope_key unique (
    id, organization_id, branch_id
  ),
  constraint inventory_movements_original_scope_fkey
    foreign key (
      original_movement_id, organization_id, branch_id, item_id, batch_id
    ) references public.inventory_movements (
      id, organization_id, branch_id, item_id, batch_id
    ) on delete restrict,
  constraint inventory_movements_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint inventory_movements_ledger_key unique (batch_id, ledger_version),
  constraint inventory_movements_version_check check (ledger_version > 0),
  constraint inventory_movements_type_check check (
    movement_type in (
      'receipt', 'issue', 'return', 'adjustment', 'client_issue', 'stocktake'
    )
  ),
  constraint inventory_movements_quantity_check check (
    quantity >= 0 and quantity <= 99999999999999.9999
    and quantity_delta between -99999999999999.9999 and 99999999999999.9999
    and balance_after between 0 and 99999999999999.9999
    and (movement_type = 'stocktake' or quantity > 0)
  ),
  constraint inventory_movements_relationship_check check (
    (
      movement_type = 'receipt'
      and quantity_delta = quantity and original_movement_id is null
      and client_id is null and instruction_reference is null
      and issued_to_user_id is null and purpose is null
      and destination_unit is null and reason is null
      and reauth_challenge_id is null
    ) or (
      movement_type = 'issue'
      and quantity_delta = -quantity and original_movement_id is null
      and client_id is null and instruction_reference is null
      and issued_to_user_id is null
      and char_length(purpose) between 1 and 500
      and char_length(destination_unit) between 1 and 160
      and reason is null and reauth_challenge_id is null
    ) or (
      movement_type = 'client_issue'
      and quantity_delta = -quantity and original_movement_id is null
      and client_id is not null
      and char_length(instruction_reference) between 1 and 500
      and issued_to_user_id is not null
      and purpose is null and destination_unit is null
      and reason is null and reauth_challenge_id is null
    ) or (
      movement_type = 'return'
      and quantity_delta = quantity and original_movement_id is not null
      and char_length(reason) between 1 and 1000
      and reauth_challenge_id is null
    ) or (
      movement_type = 'adjustment'
      and quantity = abs(quantity_delta) and quantity_delta <> 0
      and original_movement_id is null and client_id is null
      and instruction_reference is null and issued_to_user_id is null
      and purpose is null and destination_unit is null
      and char_length(reason) between 1 and 1000
      and reauth_challenge_id is not null
    ) or (
      movement_type = 'stocktake'
      and balance_after = quantity
      and original_movement_id is null and client_id is null
      and instruction_reference is null and issued_to_user_id is null
      and purpose is null and destination_unit is null
      and char_length(reason) between 1 and 1000
      and reauth_challenge_id is not null
    )
  ),
  constraint inventory_movements_text_check check (
    (instruction_reference is null or
      translate(instruction_reference, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (purpose is null or translate(purpose, E'\n\r\t', '') !~ '[[:cntrl:]]')
    and (destination_unit is null or destination_unit !~ '[[:cntrl:]]')
    and (reason is null or translate(reason, E'\n\r\t', '') !~ '[[:cntrl:]]')
  ),
  constraint inventory_movements_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.inventory_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  version integer not null,
  previous_version_id uuid unique,
  effective_from date not null,
  effective_to date,
  near_expiry_days integer not null,
  stocktake_cycle_days integer not null,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null,
  content_hash text not null,
  constraint inventory_policy_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint inventory_policy_id_scope_key unique (id, organization_id, branch_id),
  constraint inventory_policy_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id)
    references private.inventory_policy_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_policy_version_key unique (organization_id, branch_id, version),
  constraint inventory_policy_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null))
  ),
  constraint inventory_policy_period_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint inventory_policy_threshold_check check (
    near_expiry_days between 0 and 3650
    and stocktake_cycle_days between 1 and 3650
  ),
  constraint inventory_policy_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create table private.inventory_safety_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  policy_version_id uuid not null,
  item_id uuid not null,
  safety_quantity numeric(18,4) not null,
  constraint inventory_safety_policy_scope_fkey
    foreign key (policy_version_id, organization_id, branch_id)
    references private.inventory_policy_versions(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_safety_item_scope_fkey
    foreign key (item_id, organization_id, branch_id)
    references public.inventory_items(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_safety_policy_item_key unique (policy_version_id, item_id),
  constraint inventory_safety_quantity_check check (
    safety_quantity >= 0 and safety_quantity <= 99999999999999.9999
  )
);

create table private.inventory_item_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  result_item_id uuid not null,
  result_status_event_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_item_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint inventory_item_operations_item_scope_fkey
    foreign key (result_item_id, organization_id, branch_id)
    references public.inventory_items(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_item_operations_status_scope_fkey
    foreign key (result_status_event_id, organization_id, branch_id, result_item_id)
    references public.inventory_item_status_events(id, organization_id, branch_id, item_id)
    on delete restrict,
  constraint inventory_item_operations_kind_check check (
    operation_kind in ('create', 'set_status')
  ),
  constraint inventory_item_operations_hash_check check (request_hash ~ '^[a-f0-9]{64}$')
);

create table private.inventory_movement_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  result_movement_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_movement_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint inventory_movement_operations_result_scope_fkey
    foreign key (result_movement_id, organization_id, branch_id)
    references public.inventory_movements(id, organization_id, branch_id)
    on delete restrict,
  constraint inventory_movement_operations_hash_check check (request_hash ~ '^[a-f0-9]{64}$')
);

create index inventory_items_branch_idx on public.inventory_items (branch_id, organization_id);
create unique index inventory_items_code_casefold_idx
  on public.inventory_items (organization_id, branch_id, lower(item_code));
create index inventory_items_created_by_idx on public.inventory_items (created_by);
create index inventory_item_status_recorded_by_idx on public.inventory_item_status_events (recorded_by);
create index inventory_item_status_scope_idx on public.inventory_item_status_events (organization_id, branch_id, item_id, ledger_version desc);
create index inventory_batches_item_idx on public.inventory_batches (item_id, organization_id, branch_id);
create index inventory_batches_created_by_idx on public.inventory_batches (created_by);
create index inventory_batches_expiry_idx on public.inventory_batches (organization_id, branch_id, expiry_date);
create unique index inventory_batches_number_casefold_idx
  on public.inventory_batches (organization_id, branch_id, item_id, lower(batch_number));
create index inventory_movements_scope_time_idx on public.inventory_movements (organization_id, branch_id, occurred_at desc, id);
create index inventory_movements_item_idx on public.inventory_movements (item_id);
create index inventory_movements_batch_idx on public.inventory_movements (batch_id, ledger_version desc);
create index inventory_movements_original_idx on public.inventory_movements (original_movement_id) where original_movement_id is not null;
create index inventory_movements_client_idx on public.inventory_movements (client_id) where client_id is not null;
create index inventory_movements_issued_to_idx on public.inventory_movements (issued_to_user_id) where issued_to_user_id is not null;
create index inventory_movements_recorded_by_idx on public.inventory_movements (recorded_by);
create index inventory_movements_reauth_idx on public.inventory_movements (reauth_challenge_id) where reauth_challenge_id is not null;
create index inventory_policy_branch_idx on private.inventory_policy_versions (branch_id, organization_id);
create index inventory_policy_published_by_idx on private.inventory_policy_versions (published_by);
create index inventory_safety_item_idx on private.inventory_safety_levels (item_id, organization_id, branch_id);
create index inventory_item_operations_scope_result_idx on private.inventory_item_operations (organization_id, branch_id, result_item_id, result_status_event_id);
create index inventory_movement_operations_scope_result_idx on private.inventory_movement_operations (organization_id, branch_id, result_movement_id);

create or replace function private.inventory_records_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '23514',
    message = format('%I is append-only', tg_table_name);
end;
$$;

create trigger inventory_items_append_only before update or delete on public.inventory_items
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_item_status_events_append_only before update or delete on public.inventory_item_status_events
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_batches_append_only before update or delete on public.inventory_batches
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_movements_append_only before update or delete on public.inventory_movements
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_policy_versions_append_only before update or delete on private.inventory_policy_versions
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_safety_levels_append_only before update or delete on private.inventory_safety_levels
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_item_operations_append_only before update or delete on private.inventory_item_operations
for each row execute function private.inventory_records_are_append_only();
create trigger inventory_movement_operations_append_only before update or delete on private.inventory_movement_operations
for each row execute function private.inventory_records_are_append_only();

create trigger inventory_items_audit_row_change after insert on public.inventory_items
for each row execute function private.audit_row_change();
create trigger inventory_item_status_events_audit_row_change after insert on public.inventory_item_status_events
for each row execute function private.audit_row_change();
create trigger inventory_batches_audit_row_change after insert on public.inventory_batches
for each row execute function private.audit_row_change();
create trigger inventory_movements_audit_row_change after insert on public.inventory_movements
for each row execute function private.audit_row_change();
create trigger inventory_policy_versions_audit_row_change after insert on private.inventory_policy_versions
for each row execute function private.audit_row_change();
create trigger inventory_safety_levels_audit_row_change after insert on private.inventory_safety_levels
for each row execute function private.audit_row_change();

comment on table public.inventory_items is 'Immutable branch item master; lifecycle changes append status events.';
comment on table public.inventory_batches is 'Immutable batch identity, expiry and unit created only through a governed receipt.';
comment on table public.inventory_movements is 'Append-only authoritative quantity ledger; balance_after is transactionally verified.';
comment on table private.inventory_policy_versions is 'Institution-owned versioned inventory policy; no version is published by page 77 itself.';

create or replace function private.inventory_current_authority(
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
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
        and profile.is_active
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.inventory_staff_is_current(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
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
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
  );
$$;

create or replace function private.require_inventory_reauth_evidence(
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
  if p_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception using errcode = '42501', message = 'current inventory AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'current inventory AAL2 evidence is required';
  end;
  if v_session_id is null then
    raise exception using errcode = '42501', message = 'current inventory AAL2 evidence is required';
  end if;

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
    raise exception using errcode = '42501', message = 'current inventory AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.validate_inventory_item_status_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.inventory_item_status_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory-item-status:' || new.item_id::text, 0));
  select event.* into v_latest
  from public.inventory_item_status_events event
  where event.item_id = new.item_id
  order by event.ledger_version desc
  limit 1
  for share;
  if not found then
    if new.ledger_version <> 1 or new.status <> 'active' then
      raise exception using errcode = '23514', message = 'inventory item must begin active at version one';
    end if;
  elsif new.ledger_version <> v_latest.ledger_version + 1
     or new.status = v_latest.status then
    raise exception using errcode = '40001', message = 'inventory item status must append one changed terminal version';
  end if;
  return new;
end;
$$;

create trigger inventory_item_status_events_validate_chain
before insert on public.inventory_item_status_events
for each row execute function private.validate_inventory_item_status_chain();

create or replace function private.validate_inventory_policy_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous private.inventory_policy_versions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-policy:' || new.organization_id::text || ':' || new.branch_id::text, 0
  ));
  if exists (
    select 1 from private.inventory_policy_versions policy
    where policy.organization_id = new.organization_id
      and policy.branch_id = new.branch_id
      and daterange(policy.effective_from, policy.effective_to, '[]') &&
          daterange(new.effective_from, new.effective_to, '[]')
  ) then
    raise exception using errcode = '23514', message = 'inventory policy effective periods cannot overlap';
  end if;
  if new.version = 1 then
    if new.previous_version_id is not null then
      raise exception using errcode = '23514', message = 'first inventory policy cannot have a predecessor';
    end if;
  else
    select policy.* into v_previous
    from private.inventory_policy_versions policy
    where policy.id = new.previous_version_id
      and policy.organization_id = new.organization_id
      and policy.branch_id = new.branch_id
    for share;
    if not found or v_previous.version + 1 <> new.version
       or exists (
         select 1 from private.inventory_policy_versions child
         where child.previous_version_id = v_previous.id
       ) then
      raise exception using errcode = '40001', message = 'inventory policy must append the terminal version';
    end if;
  end if;
  return new;
end;
$$;

create trigger inventory_policy_versions_validate_chain
before insert on private.inventory_policy_versions
for each row execute function private.validate_inventory_policy_chain();

create or replace function private.create_inventory_item_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_code text,
  p_item_name text,
  p_unit text,
  p_idempotency_key uuid
)
returns table(
  item_id uuid,
  organization_id uuid,
  branch_id uuid,
  item_code text,
  unit text,
  status text,
  status_ledger_version integer,
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
  v_code text := nullif(btrim(p_item_code), '');
  v_name text := nullif(btrim(p_item_name), '');
  v_unit text := nullif(btrim(p_unit), '');
  v_hash text;
  v_operation private.inventory_item_operations%rowtype;
  v_item public.inventory_items%rowtype;
  v_status public.inventory_item_status_events%rowtype;
  v_now timestamptz;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_idempotency_key is null or v_actor is null
     or not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.read'
     )
     or not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
     ) then
    raise exception using errcode = '42501', message = 'inventory item creation is not permitted';
  end if;
  if v_code is null or char_length(v_code) > 80 or v_code ~ '[[:cntrl:]]'
     or v_name is null or char_length(v_name) > 160 or v_name ~ '[[:cntrl:]]'
     or v_unit is null or char_length(v_unit) > 40 or v_unit ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid inventory item';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'operation', 'create',
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor_user_id', v_actor,
    'item_code', v_code, 'item_name', v_name, 'unit', v_unit
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-item-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.inventory_item_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.operation_kind <> 'create'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'inventory item idempotency conflict';
    end if;
    select item.* into v_item
    from public.inventory_items item
    where item.id = v_operation.result_item_id
      and item.organization_id = p_expected_organization_id
      and item.branch_id = p_expected_branch_id;
    select event.* into v_status
    from public.inventory_item_status_events event
    where event.id = v_operation.result_status_event_id
      and event.item_id = v_item.id;
    if not found
       or not private.inventory_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
       ) then
      raise exception using errcode = '42501', message = 'inventory item replay is not permitted';
    end if;
    return query select v_item.id, v_item.organization_id, v_item.branch_id,
      v_item.item_code, v_item.unit, v_status.status, v_status.ledger_version,
      v_status.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-item-code:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || lower(v_code), 0
  ));
  if exists (
    select 1 from public.inventory_items item
    where item.organization_id = p_expected_organization_id
      and item.branch_id = p_expected_branch_id
      and lower(item.item_code) = lower(v_code)
  ) then
    raise exception using errcode = '23505', message = 'inventory item code already exists';
  end if;
  v_now := clock_timestamp();
  insert into public.inventory_items (
    organization_id, branch_id, item_code, item_name, unit,
    created_by, created_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_code, v_name, v_unit,
    v_actor, v_now, encode(sha256(convert_to(jsonb_build_object(
      'content_hash_version', 1, 'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id, 'item_code', v_code,
      'item_name', v_name, 'unit', v_unit, 'created_by', v_actor,
      'created_at', v_now
    )::text, 'UTF8')), 'hex')
  ) returning * into v_item;
  insert into public.inventory_item_status_events (
    organization_id, branch_id, item_id, ledger_version, status, reason,
    recorded_by, recorded_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_item.id,
    1, 'active', null, v_actor, v_now
  ) returning * into v_status;
  insert into private.inventory_item_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_item_id, result_status_event_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'create', v_hash, v_item.id, v_status.id
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'insert', 'inventory_items', v_item.id::text, p_idempotency_key,
    array['item_master', 'initial_status'],
    jsonb_build_object('workflow', 'page77_inventory_v1',
      'operation', 'create_item', 'status', 'active')
  );
  if not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
     ) or not exists (
       select 1 from public.inventory_item_status_events event
       where event.id = v_status.id and event.item_id = v_item.id
         and event.status = 'active' and event.ledger_version = 1
     ) then
    raise exception using errcode = '42501', message = 'inventory item final verification failed';
  end if;
  return query select v_item.id, v_item.organization_id, v_item.branch_id,
    v_item.item_code, v_item.unit, v_status.status, v_status.ledger_version,
    v_status.recorded_at, false;
end;
$$;

create or replace function private.set_inventory_item_status_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_id uuid,
  p_status text,
  p_reason text,
  p_expected_status_ledger_version integer,
  p_idempotency_key uuid
)
returns table(
  item_id uuid,
  organization_id uuid,
  branch_id uuid,
  item_code text,
  unit text,
  status text,
  status_ledger_version integer,
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
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_operation private.inventory_item_operations%rowtype;
  v_item public.inventory_items%rowtype;
  v_current public.inventory_item_status_events%rowtype;
  v_result public.inventory_item_status_events%rowtype;
  v_now timestamptz;
begin
  if p_item_id is null or p_idempotency_key is null or v_actor is null
     or not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.read'
     ) or not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
     ) then
    raise exception using errcode = '42501', message = 'inventory item status is not permitted';
  end if;
  if p_status not in ('active', 'inactive')
     or v_reason is null or char_length(v_reason) > 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or p_expected_status_ledger_version is null
     or p_expected_status_ledger_version < 1 then
    raise exception using errcode = '22023', message = 'invalid inventory item status';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'operation', 'set_status',
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor_user_id', v_actor,
    'item_id', p_item_id, 'status', p_status, 'reason', v_reason,
    'expected_status_ledger_version', p_expected_status_ledger_version
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-item-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.inventory_item_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.operation_kind <> 'set_status'
       or v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.result_item_id <> p_item_id
       or v_operation.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'inventory item status idempotency conflict';
    end if;
    select item.* into v_item
    from public.inventory_items item
    where item.id = p_item_id
      and item.organization_id = p_expected_organization_id
      and item.branch_id = p_expected_branch_id;
    select event.* into v_result
    from public.inventory_item_status_events event
    where event.id = v_operation.result_status_event_id
      and event.item_id = v_item.id;
    if not found or not private.inventory_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
    ) then
      raise exception using errcode = '42501', message = 'inventory item status replay is not permitted';
    end if;
    return query select v_item.id, v_item.organization_id, v_item.branch_id,
      v_item.item_code, v_item.unit, v_result.status, v_result.ledger_version,
      v_result.recorded_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory-item-status:' || p_item_id::text, 0));
  select item.* into v_item from public.inventory_items item
  where item.id = p_item_id
    and item.organization_id = p_expected_organization_id
    and item.branch_id = p_expected_branch_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'inventory item is outside current scope';
  end if;
  select event.* into v_current
  from public.inventory_item_status_events event
  where event.item_id = p_item_id
  order by event.ledger_version desc limit 1 for update;
  if not found or v_current.ledger_version <> p_expected_status_ledger_version
     or v_current.status = p_status then
    raise exception using errcode = '40001', message = 'inventory item status version conflict';
  end if;
  v_now := clock_timestamp();
  insert into public.inventory_item_status_events (
    organization_id, branch_id, item_id, ledger_version, status, reason,
    recorded_by, recorded_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_item_id,
    v_current.ledger_version + 1, p_status, v_reason, v_actor, v_now
  ) returning * into v_result;
  insert into private.inventory_item_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, result_item_id, result_status_event_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, 'set_status', v_hash, p_item_id, v_result.id
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'insert', 'inventory_item_status_events', v_result.id::text,
    p_idempotency_key, array['status', 'reason'],
    jsonb_build_object('workflow', 'page77_inventory_v1',
      'operation', 'set_item_status', 'item_id', p_item_id,
      'status', p_status, 'ledger_version', v_result.ledger_version)
  );
  if not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
     ) or not exists (
       select 1 from public.inventory_item_status_events event
       where event.id = v_result.id and event.item_id = p_item_id
         and event.status = p_status
     ) then
    raise exception using errcode = '42501', message = 'inventory item status final verification failed';
  end if;
  return query select v_item.id, v_item.organization_id, v_item.branch_id,
    v_item.item_code, v_item.unit, v_result.status, v_result.ledger_version,
    v_result.recorded_at, false;
end;
$$;

create or replace function public.create_inventory_item(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_code text,
  p_item_name text,
  p_unit text,
  p_idempotency_key uuid
)
returns table(
  item_id uuid, organization_id uuid, branch_id uuid, item_code text,
  unit text, status text, status_ledger_version integer,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.create_inventory_item_guarded(
    p_expected_organization_id, p_expected_branch_id, p_item_code,
    p_item_name, p_unit, p_idempotency_key
  );
$$;

create or replace function public.set_inventory_item_status(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_id uuid,
  p_status text,
  p_reason text,
  p_expected_status_ledger_version integer,
  p_idempotency_key uuid
)
returns table(
  item_id uuid, organization_id uuid, branch_id uuid, item_code text,
  unit text, status text, status_ledger_version integer,
  committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.set_inventory_item_status_guarded(
    p_expected_organization_id, p_expected_branch_id, p_item_id, p_status,
    p_reason, p_expected_status_ledger_version, p_idempotency_key
  );
$$;

create or replace function private.record_inventory_movement_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_id uuid,
  p_batch_id uuid,
  p_new_batch_number text,
  p_new_expiry_date date,
  p_new_unit text,
  p_movement_type text,
  p_quantity numeric,
  p_adjustment_delta numeric,
  p_counted_quantity numeric,
  p_original_movement_id uuid,
  p_client_id uuid,
  p_instruction_reference text,
  p_issued_to_user_id uuid,
  p_purpose text,
  p_destination_unit text,
  p_reason text,
  p_occurred_at timestamptz,
  p_expected_ledger_version integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  item_id uuid,
  batch_id uuid,
  movement_id uuid,
  movement_type text,
  ledger_version integer,
  quantity text,
  quantity_delta text,
  balance_after text,
  occurred_at timestamptz,
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
  v_hash text;
  v_operation private.inventory_movement_operations%rowtype;
  v_item public.inventory_items%rowtype;
  v_item_status public.inventory_item_status_events%rowtype;
  v_batch public.inventory_batches%rowtype;
  v_original public.inventory_movements%rowtype;
  v_result public.inventory_movements%rowtype;
  v_batch_id uuid := p_batch_id;
  v_batch_number text := nullif(btrim(p_new_batch_number), '');
  v_new_unit text := nullif(btrim(p_new_unit), '');
  v_instruction text := nullif(btrim(p_instruction_reference), '');
  v_purpose text := nullif(btrim(p_purpose), '');
  v_destination text := nullif(btrim(p_destination_unit), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_quantity numeric(18,4);
  v_delta numeric(18,4);
  v_balance numeric(18,4);
  v_current_version integer;
  v_returned numeric(18,4);
  v_challenge_id uuid;
begin
  if v_actor is null or p_item_id is null or p_idempotency_key is null
     or not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.read'
     ) or not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
     ) then
    raise exception using errcode = '42501', message = 'inventory movement is not permitted';
  end if;
  if p_movement_type not in (
       'receipt', 'issue', 'return', 'adjustment', 'client_issue', 'stocktake'
     ) or p_expected_ledger_version is null or p_expected_ledger_version < 0
     or p_occurred_at is null
     or extract(year from p_occurred_at at time zone 'Asia/Taipei') not between 2000 and 2200
     or p_occurred_at > clock_timestamp() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'invalid inventory movement';
  end if;
  if p_movement_type in ('adjustment', 'stocktake') then
    if not private.inventory_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'inventory.adjust'
       ) then
      raise exception using errcode = '42501', message = 'inventory adjustment is not permitted';
    end if;
    v_challenge_id := private.require_inventory_reauth_evidence(v_actor, clock_timestamp());
  end if;

  if p_movement_type in ('receipt', 'issue', 'return', 'client_issue') then
    if p_quantity is null or p_quantity <= 0
       or p_quantity > 99999999999999.9999
       or scale(p_quantity) > 4
       or p_adjustment_delta is not null or p_counted_quantity is not null then
      raise exception using errcode = '22023', message = 'invalid inventory movement quantity';
    end if;
  elsif p_movement_type = 'adjustment' then
    if p_quantity is not null or p_counted_quantity is not null
       or p_adjustment_delta is null or p_adjustment_delta = 0
       or abs(p_adjustment_delta) > 99999999999999.9999
       or scale(p_adjustment_delta) > 4
       or v_reason is null or char_length(v_reason) > 1000
       or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'invalid inventory adjustment';
    end if;
  else
    if p_quantity is not null or p_adjustment_delta is not null
       or p_counted_quantity is null or p_counted_quantity < 0
       or p_counted_quantity > 99999999999999.9999
       or scale(p_counted_quantity) > 4
       or v_reason is null or char_length(v_reason) > 1000
       or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'invalid inventory stocktake';
    end if;
  end if;
  if p_movement_type = 'issue' and (
       v_purpose is null or char_length(v_purpose) > 500
       or translate(v_purpose, E'\n\r\t', '') ~ '[[:cntrl:]]'
       or v_destination is null or char_length(v_destination) > 160
       or v_destination ~ '[[:cntrl:]]'
     ) then
    raise exception using errcode = '22023', message = 'inventory issue purpose is required';
  end if;
  if p_movement_type = 'client_issue' and (
       p_client_id is null or p_issued_to_user_id is null
       or v_instruction is null or char_length(v_instruction) > 500
       or translate(v_instruction, E'\n\r\t', '') ~ '[[:cntrl:]]'
     ) then
    raise exception using errcode = '22023', message = 'client issue reference is required';
  end if;
  if p_movement_type = 'return' and (
       p_original_movement_id is null or v_reason is null
       or char_length(v_reason) > 1000
       or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     ) then
    raise exception using errcode = '22023', message = 'inventory return reference is required';
  end if;
  if (p_movement_type <> 'issue' and (v_purpose is not null or v_destination is not null))
     or (p_movement_type <> 'client_issue' and
       (p_client_id is not null or p_issued_to_user_id is not null or v_instruction is not null))
     or (p_movement_type <> 'return' and p_original_movement_id is not null)
     or (p_movement_type not in ('return', 'adjustment', 'stocktake') and v_reason is not null)
     or (p_batch_id is null and p_movement_type <> 'receipt')
     or (p_batch_id is null and (
       v_batch_number is null or char_length(v_batch_number) > 120
       or v_batch_number ~ '[[:cntrl:]]'
       or p_new_expiry_date is null or v_new_unit is null
       or char_length(v_new_unit) > 40 or v_new_unit ~ '[[:cntrl:]]'
     ))
     or (p_batch_id is not null and (
       v_batch_number is not null or p_new_expiry_date is not null or v_new_unit is not null
     )) then
    raise exception using errcode = '22023', message = 'inventory movement fields do not match type';
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'actor_user_id', v_actor,
    'item_id', p_item_id, 'batch_id', p_batch_id,
    'new_batch_number', v_batch_number, 'new_expiry_date', p_new_expiry_date,
    'new_unit', v_new_unit, 'movement_type', p_movement_type,
    'quantity', p_quantity, 'adjustment_delta', p_adjustment_delta,
    'counted_quantity', p_counted_quantity,
    'original_movement_id', p_original_movement_id, 'client_id', p_client_id,
    'instruction_reference', v_instruction,
    'issued_to_user_id', p_issued_to_user_id,
    'purpose', v_purpose, 'destination_unit', v_destination,
    'reason', v_reason, 'occurred_at', p_occurred_at,
    'expected_ledger_version', p_expected_ledger_version
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-movement-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_operation
  from private.inventory_movement_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'inventory movement idempotency conflict';
    end if;
    select movement.* into v_result
    from public.inventory_movements movement
    where movement.id = v_operation.result_movement_id
      and movement.organization_id = p_expected_organization_id
      and movement.branch_id = p_expected_branch_id
      and movement.item_id = p_item_id;
    if not found
       or not private.inventory_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
       )
       or (v_result.client_id is not null and not private.can_staff_access_client(
         v_result.client_id, 'clients.read'
       ))
       or (p_movement_type in ('adjustment', 'stocktake') and (
         not private.inventory_current_authority(
           p_expected_organization_id, p_expected_branch_id, 'inventory.adjust'
         ) or private.require_inventory_reauth_evidence(
           v_actor, clock_timestamp()
         ) is null
       )) then
      raise exception using errcode = '42501', message = 'inventory movement replay is not permitted';
    end if;
    return query select v_result.organization_id, v_result.branch_id,
      v_result.item_id, v_result.batch_id, v_result.id, v_result.movement_type,
      v_result.ledger_version, v_result.quantity::text,
      v_result.quantity_delta::text, v_result.balance_after::text,
      v_result.occurred_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory-item:' || p_item_id::text, 0));
  select item.* into v_item
  from public.inventory_items item
  where item.id = p_item_id
    and item.organization_id = p_expected_organization_id
    and item.branch_id = p_expected_branch_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'inventory item is outside current scope';
  end if;
  select event.* into v_item_status
  from public.inventory_item_status_events event
  where event.item_id = p_item_id
  order by event.ledger_version desc limit 1 for share;
  if not found or (
    v_item_status.status <> 'active'
    and p_movement_type in ('receipt', 'issue', 'client_issue')
  ) then
    raise exception using errcode = '23514', message = 'inactive inventory item rejects routine movement';
  end if;

  if p_batch_id is null then
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory-batch-number:' || p_expected_organization_id::text || ':' ||
      p_expected_branch_id::text || ':' || p_item_id::text || ':' || lower(v_batch_number), 0
    ));
    v_now := clock_timestamp();
    if p_expected_ledger_version <> 0 or v_new_unit <> v_item.unit
       or p_new_expiry_date < (v_now at time zone 'Asia/Taipei')::date
       or exists (
         select 1 from public.inventory_batches batch
         where batch.organization_id = p_expected_organization_id
           and batch.branch_id = p_expected_branch_id
           and batch.item_id = p_item_id
           and lower(batch.batch_number) = lower(v_batch_number)
       ) then
      raise exception using errcode = '23514', message = 'invalid new inventory batch';
    end if;
    v_now := clock_timestamp();
    insert into public.inventory_batches (
      organization_id, branch_id, item_id, batch_number, expiry_date, unit,
      created_by, created_at, content_hash
    ) values (
      p_expected_organization_id, p_expected_branch_id, p_item_id,
      v_batch_number, p_new_expiry_date, v_new_unit, v_actor, v_now,
      encode(sha256(convert_to(jsonb_build_object(
        'content_hash_version', 1, 'organization_id', p_expected_organization_id,
        'branch_id', p_expected_branch_id, 'item_id', p_item_id,
        'batch_number', v_batch_number, 'expiry_date', p_new_expiry_date,
        'unit', v_new_unit, 'created_by', v_actor, 'created_at', v_now
      )::text, 'UTF8')), 'hex')
    ) returning * into v_batch;
    v_batch_id := v_batch.id;
  else
    perform pg_advisory_xact_lock(hashtextextended('inventory-batch:' || p_batch_id::text, 0));
    select batch.* into v_batch
    from public.inventory_batches batch
    where batch.id = p_batch_id
      and batch.organization_id = p_expected_organization_id
      and batch.branch_id = p_expected_branch_id
      and batch.item_id = p_item_id
    for update;
    if not found or v_batch.unit <> v_item.unit then
      raise exception using errcode = '42501', message = 'inventory batch is outside current scope';
    end if;
  end if;

  select coalesce(sum(movement.quantity_delta), 0)::numeric(18,4),
    coalesce(max(movement.ledger_version), 0)
    into v_balance, v_current_version
  from public.inventory_movements movement
  where movement.batch_id = v_batch.id;
  if v_current_version <> p_expected_ledger_version then
    raise exception using errcode = '40001', message = 'inventory ledger version conflict';
  end if;
  if v_balance < 0 then
    raise exception using errcode = '23514', message = 'inventory ledger is already inconsistent';
  end if;
  v_now := clock_timestamp();
  if p_movement_type in ('receipt', 'issue', 'client_issue')
     and v_batch.expiry_date < (v_now at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '23514', message = 'expired inventory batch rejects receipt or issue';
  end if;

  if p_movement_type = 'return' then
    select movement.* into v_original
    from public.inventory_movements movement
    where movement.id = p_original_movement_id
      and movement.organization_id = p_expected_organization_id
      and movement.branch_id = p_expected_branch_id
      and movement.item_id = p_item_id
      and movement.batch_id = v_batch.id
      and movement.movement_type in ('issue', 'client_issue')
    for share;
    if not found then
      raise exception using errcode = '23514', message = 'inventory return origin is invalid';
    end if;
    select coalesce(sum(movement.quantity), 0)::numeric(18,4) into v_returned
    from public.inventory_movements movement
    where movement.original_movement_id = v_original.id
      and movement.movement_type = 'return';
    if v_returned + p_quantity > v_original.quantity then
      raise exception using errcode = '23514', message = 'inventory return exceeds outstanding issued quantity';
    end if;
    p_client_id := v_original.client_id;
    v_instruction := v_original.instruction_reference;
    p_issued_to_user_id := v_original.issued_to_user_id;
    v_purpose := v_original.purpose;
    v_destination := v_original.destination_unit;
    if p_client_id is not null and not private.can_staff_access_client(
      p_client_id, 'clients.read'
    ) then
      raise exception using errcode = '42501', message = 'inventory return client scope is not permitted';
    end if;
  end if;

  if p_movement_type = 'client_issue' then
    if not exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
        and client.status = 'active'
        and client.admitted_on is not null
        and (p_occurred_at at time zone 'Asia/Taipei')::date >= client.admitted_on
        and (client.ended_on is null or
          (p_occurred_at at time zone 'Asia/Taipei')::date <= client.ended_on)
    ) or not private.can_staff_access_client(p_client_id, 'clients.read')
       or not private.inventory_staff_is_current(
         p_expected_organization_id, p_expected_branch_id, p_issued_to_user_id
       ) then
      raise exception using errcode = '42501', message = 'client issue scope is not permitted';
    end if;
  end if;

  if p_movement_type = 'receipt' then
    v_quantity := p_quantity; v_delta := p_quantity;
  elsif p_movement_type in ('issue', 'client_issue') then
    v_quantity := p_quantity; v_delta := -p_quantity;
  elsif p_movement_type = 'return' then
    v_quantity := p_quantity; v_delta := p_quantity;
  elsif p_movement_type = 'adjustment' then
    v_quantity := abs(p_adjustment_delta); v_delta := p_adjustment_delta;
  else
    v_quantity := p_counted_quantity; v_delta := p_counted_quantity - v_balance;
  end if;
  v_balance := v_balance + v_delta;
  if v_balance < 0 or v_balance > 99999999999999.9999 then
    raise exception using errcode = '23514', message = 'inventory movement would create an invalid balance';
  end if;
  v_now := coalesce(v_now, clock_timestamp());
  insert into public.inventory_movements (
    organization_id, branch_id, item_id, batch_id, ledger_version,
    movement_type, quantity, quantity_delta, balance_after, occurred_at,
    original_movement_id, client_id, instruction_reference, issued_to_user_id,
    purpose, destination_unit, reason, recorded_by, recorded_at,
    reauth_challenge_id, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_item_id, v_batch.id,
    v_current_version + 1, p_movement_type, v_quantity, v_delta, v_balance,
    p_occurred_at, p_original_movement_id, p_client_id, v_instruction,
    p_issued_to_user_id, v_purpose, v_destination, v_reason, v_actor, v_now,
    v_challenge_id, encode(sha256(convert_to(jsonb_build_object(
      'content_hash_version', 1, 'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id, 'item_id', p_item_id,
      'batch_id', v_batch.id, 'ledger_version', v_current_version + 1,
      'movement_type', p_movement_type, 'quantity', v_quantity,
      'quantity_delta', v_delta, 'balance_after', v_balance,
      'occurred_at', p_occurred_at, 'original_movement_id', p_original_movement_id,
      'client_id', p_client_id, 'instruction_reference', v_instruction,
      'issued_to_user_id', p_issued_to_user_id, 'purpose', v_purpose,
      'destination_unit', v_destination, 'reason', v_reason,
      'recorded_by', v_actor, 'recorded_at', v_now,
      'reauth_challenge_id', v_challenge_id
    )::text, 'UTF8')), 'hex')
  ) returning * into v_result;
  insert into private.inventory_movement_operations (
    organization_id, branch_id, actor_user_id, idempotency_key,
    request_hash, result_movement_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    p_idempotency_key, v_hash, v_result.id
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'insert', 'inventory_movements', v_result.id::text,
    p_idempotency_key, array['movement_type', 'quantity_delta', 'balance_after'],
    jsonb_build_object('workflow', 'page77_inventory_v1',
      'operation', p_movement_type,
      'item_id', p_item_id, 'batch_id', v_batch.id,
      'ledger_version', v_result.ledger_version)
  );
  if not private.inventory_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'inventory.manage'
     ) or (p_movement_type in ('adjustment', 'stocktake') and (
       not private.inventory_current_authority(
         p_expected_organization_id, p_expected_branch_id, 'inventory.adjust'
       ) or private.require_inventory_reauth_evidence(
         v_actor, clock_timestamp()
       ) <> v_challenge_id
     )) or not exists (
       select 1 from public.inventory_movements movement
       where movement.id = v_result.id
         and movement.organization_id = p_expected_organization_id
         and movement.branch_id = p_expected_branch_id
         and movement.item_id = p_item_id
         and movement.batch_id = v_batch.id
         and movement.ledger_version = v_result.ledger_version
         and movement.balance_after = (
           select sum(all_movement.quantity_delta)::numeric(18,4)
           from public.inventory_movements all_movement
           where all_movement.batch_id = v_batch.id
         )
     ) or (v_result.client_id is not null and
       not private.can_staff_access_client(v_result.client_id, 'clients.read'))
     or (p_movement_type = 'client_issue' and (
       not private.can_staff_access_client(p_client_id, 'clients.read')
       or not private.inventory_staff_is_current(
         p_expected_organization_id, p_expected_branch_id, p_issued_to_user_id
       )
     )) then
    raise exception using errcode = '42501', message = 'inventory movement final verification failed';
  end if;
  return query select v_result.organization_id, v_result.branch_id,
    v_result.item_id, v_result.batch_id, v_result.id, v_result.movement_type,
    v_result.ledger_version, v_result.quantity::text,
    v_result.quantity_delta::text, v_result.balance_after::text,
    v_result.occurred_at, false;
end;
$$;

create or replace function public.record_inventory_movement(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_id uuid,
  p_batch_id uuid,
  p_new_batch_number text,
  p_new_expiry_date date,
  p_new_unit text,
  p_movement_type text,
  p_quantity numeric,
  p_adjustment_delta numeric,
  p_counted_quantity numeric,
  p_original_movement_id uuid,
  p_client_id uuid,
  p_instruction_reference text,
  p_issued_to_user_id uuid,
  p_purpose text,
  p_destination_unit text,
  p_reason text,
  p_occurred_at timestamptz,
  p_expected_ledger_version integer,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, item_id uuid, batch_id uuid,
  movement_id uuid, movement_type text, ledger_version integer,
  quantity text, quantity_delta text, balance_after text,
  occurred_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.record_inventory_movement_guarded(
    p_expected_organization_id, p_expected_branch_id, p_item_id, p_batch_id,
    p_new_batch_number, p_new_expiry_date, p_new_unit, p_movement_type,
    p_quantity, p_adjustment_delta, p_counted_quantity,
    p_original_movement_id, p_client_id, p_instruction_reference,
    p_issued_to_user_id, p_purpose, p_destination_unit, p_reason,
    p_occurred_at, p_expected_ledger_version, p_idempotency_key
  );
$$;

create or replace function private.inventory_management_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_reference_time timestamptz,
  p_item_id uuid,
  p_search text,
  p_batch_query text,
  p_expiry_status text,
  p_movement_type text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with snapshot_context as materialized (
    select p_reference_time as generated_at,
      (p_reference_time at time zone 'Asia/Taipei')::date as snapshot_date
  ), current_policy as materialized (
    select policy.*
    from private.inventory_policy_versions policy, snapshot_context context
    where policy.organization_id = p_expected_organization_id
      and policy.branch_id = p_expected_branch_id
      and policy.effective_from <= context.snapshot_date
      and (policy.effective_to is null or policy.effective_to >= context.snapshot_date)
    order by policy.version desc limit 1
  ), item_statuses as materialized (
    select distinct on (event.item_id)
      event.item_id, event.status, event.ledger_version, event.recorded_at
    from public.inventory_item_status_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
    order by event.item_id, event.ledger_version desc
  ), movement_rollups as materialized (
    select movement.batch_id,
      sum(movement.quantity_delta)::numeric(18,4) as balance,
      max(movement.ledger_version)::integer as ledger_version,
      count(*)::bigint as movement_count,
      max(movement.occurred_at) as last_movement_at,
      max(movement.occurred_at) filter (
        where movement.movement_type = 'stocktake'
      ) as last_stocktake_at
    from public.inventory_movements movement
    where movement.organization_id = p_expected_organization_id
      and movement.branch_id = p_expected_branch_id
    group by movement.batch_id
  ), latest_movements as materialized (
    select distinct on (movement.batch_id)
      movement.batch_id, movement.id, movement.movement_type,
      movement.occurred_at, movement.recorded_by
    from public.inventory_movements movement
    where movement.organization_id = p_expected_organization_id
      and movement.branch_id = p_expected_branch_id
    order by movement.batch_id, movement.ledger_version desc
  ), batch_base as materialized (
    select batch.id as batch_id, batch.item_id, batch.batch_number,
      batch.expiry_date, batch.unit, batch.created_at,
      item.item_code, item.item_name,
      status.status as item_status,
      status.ledger_version as item_status_ledger_version,
      coalesce(rollup.balance, 0)::numeric(18,4) as balance,
      coalesce(rollup.ledger_version, 0) as ledger_version,
      coalesce(rollup.movement_count, 0) as movement_count,
      rollup.last_movement_at, rollup.last_stocktake_at,
      latest.id as latest_movement_id,
      latest.movement_type as latest_movement_type,
      latest.occurred_at as latest_movement_occurred_at
    from public.inventory_batches batch
    join public.inventory_items item on item.id = batch.item_id
    join item_statuses status on status.item_id = item.id
    left join movement_rollups rollup on rollup.batch_id = batch.id
    left join latest_movements latest on latest.batch_id = batch.id
    where batch.organization_id = p_expected_organization_id
      and batch.branch_id = p_expected_branch_id
  ), item_rollups as materialized (
    select item.id as item_id, item.item_code, item.item_name, item.unit,
      status.status, status.ledger_version as status_ledger_version,
      coalesce(sum(batch.balance), 0)::numeric(18,4) as total_balance,
      count(batch.batch_id)::integer as batch_count,
      max(batch.last_movement_at) as last_movement_at,
      safety.safety_quantity,
      case when policy.id is null or safety.id is null then null
        else coalesce(sum(batch.balance), 0) < safety.safety_quantity end as is_low_stock
    from public.inventory_items item
    join item_statuses status on status.item_id = item.id
    left join batch_base batch on batch.item_id = item.id
    left join current_policy policy on true
    left join private.inventory_safety_levels safety
      on safety.policy_version_id = policy.id and safety.item_id = item.id
    where item.organization_id = p_expected_organization_id
      and item.branch_id = p_expected_branch_id
    group by item.id, item.item_code, item.item_name, item.unit,
      status.status, status.ledger_version, safety.id, safety.safety_quantity,
      policy.id
  ), batch_projection as materialized (
    select batch.*,
      item.total_balance as item_total_balance,
      item.safety_quantity,
      item.is_low_stock,
      case when batch.expiry_date < context.snapshot_date then 'expired'
        when policy.id is not null and batch.expiry_date <=
          context.snapshot_date + policy.near_expiry_days then 'near_expiry'
        else 'valid' end as expiry_status,
      case when policy.id is null then null
        else batch.expiry_date >= context.snapshot_date
          and batch.expiry_date <= context.snapshot_date + policy.near_expiry_days
      end as is_near_expiry,
      case when policy.id is null then null
        else coalesce(
          (batch.last_stocktake_at at time zone 'Asia/Taipei')::date,
          (batch.created_at at time zone 'Asia/Taipei')::date
        ) + policy.stocktake_cycle_days <= context.snapshot_date
      end as is_stocktake_due
    from batch_base batch
    join item_rollups item on item.item_id = batch.item_id
    cross join snapshot_context context
    left join current_policy policy on true
  ), filtered_batches as materialized (
    select batch.*
    from batch_projection batch
    where (p_item_id is null or batch.item_id = p_item_id)
      and (p_search is null or
        position(lower(p_search) in lower(batch.item_code)) > 0 or
        position(lower(p_search) in lower(batch.item_name)) > 0)
      and (p_batch_query is null or
        position(lower(p_batch_query) in lower(batch.batch_number)) > 0)
      and (p_expiry_status = 'all' or batch.expiry_status = p_expiry_status)
      and (p_movement_type = 'all' or exists (
        select 1 from public.inventory_movements movement
        where movement.batch_id = batch.batch_id
          and movement.movement_type = p_movement_type
      ))
  ), item_options as materialized (
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', item.item_id, 'item_code', item.item_code,
      'item_name', item.item_name, 'unit', item.unit,
      'status', item.status,
      'status_ledger_version', item.status_ledger_version,
      'total_balance', item.total_balance::text,
      'batch_count', item.batch_count,
      'safety_quantity', case when item.safety_quantity is null then null
        else item.safety_quantity::text end,
      'is_low_stock', item.is_low_stock,
      'last_movement_at', item.last_movement_at
    ) order by item.item_code, item.item_id), '[]'::jsonb) as data
    from (select * from item_rollups order by item_code, item_id limit 200) item
  ), batch_details as materialized (
    select coalesce(jsonb_agg(jsonb_build_object(
      'batch_id', batch.batch_id, 'item_id', batch.item_id,
      'item_code', batch.item_code, 'item_name', batch.item_name,
      'item_status', batch.item_status,
      'item_status_ledger_version', batch.item_status_ledger_version,
      'batch_number', batch.batch_number, 'expiry_date', batch.expiry_date,
      'unit', batch.unit, 'balance', batch.balance::text,
      'item_total_balance', batch.item_total_balance::text,
      'ledger_version', batch.ledger_version,
      'movement_count', batch.movement_count,
      'latest_movement_id', batch.latest_movement_id,
      'latest_movement_type', batch.latest_movement_type,
      'latest_movement_occurred_at', batch.latest_movement_occurred_at,
      'last_stocktake_at', batch.last_stocktake_at,
      'expiry_status', batch.expiry_status,
      'safety_quantity', case when batch.safety_quantity is null then null
        else batch.safety_quantity::text end,
      'is_low_stock', batch.is_low_stock,
      'is_near_expiry', batch.is_near_expiry,
      'is_stocktake_due', batch.is_stocktake_due
    ) order by batch.expiry_date, batch.item_code, batch.batch_number, batch.batch_id), '[]'::jsonb) as data
    from (
      select * from filtered_batches
      order by expiry_date, item_code, batch_number, batch_id limit 200
    ) batch
  ), movement_candidates as materialized (
    select movement.id as movement_id, movement.item_id, movement.batch_id,
      movement.movement_type, movement.ledger_version,
      movement.quantity::text as quantity,
      movement.quantity_delta::text as quantity_delta,
      movement.balance_after::text as balance_after,
      movement.occurred_at, movement.original_movement_id,
      case when movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) then movement.client_id else null end as client_id,
      case when movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) then client.client_code else null end as client_code,
      case when movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) then client.display_name else null end as client_display_name,
      case when movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) then movement.instruction_reference else null end as instruction_reference,
      case when movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) then movement.issued_to_user_id else null end as issued_to_user_id,
      case when movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) then issued_to.display_name else null end as issued_to_display_name,
      movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ) as client_scope_visible,
      movement.purpose, movement.destination_unit, movement.reason,
      movement.recorded_by, actor.display_name as recorded_by_display_name,
      movement.recorded_at, batch.item_code, batch.item_name,
      batch.batch_number, batch.unit, batch.expiry_status
    from public.inventory_movements movement
    join filtered_batches batch on batch.batch_id = movement.batch_id
    join public.profiles actor on actor.id = movement.recorded_by
    left join public.profiles issued_to on issued_to.id = movement.issued_to_user_id
    left join public.clients client on client.id = movement.client_id
    where p_movement_type = 'all' or movement.movement_type = p_movement_type
    order by movement.occurred_at desc, movement.recorded_at desc, movement.id
  ), movement_history as materialized (
    select coalesce(jsonb_agg(jsonb_build_object(
      'movement_id', movement.movement_id,
      'item_id', movement.item_id, 'batch_id', movement.batch_id,
      'item_code', movement.item_code, 'item_name', movement.item_name,
      'batch_number', movement.batch_number, 'unit', movement.unit,
      'expiry_status', movement.expiry_status,
      'movement_type', movement.movement_type,
      'ledger_version', movement.ledger_version,
      'quantity', movement.quantity,
      'quantity_delta', movement.quantity_delta,
      'balance_after', movement.balance_after,
      'occurred_at', movement.occurred_at,
      'original_movement_id', movement.original_movement_id,
      'client_scope_visible', movement.client_scope_visible,
      'client_id', movement.client_id, 'client_code', movement.client_code,
      'client_display_name', movement.client_display_name,
      'instruction_reference', movement.instruction_reference,
      'issued_to_user_id', movement.issued_to_user_id,
      'issued_to_display_name', movement.issued_to_display_name,
      'purpose', movement.purpose,
      'destination_unit', movement.destination_unit,
      'reason', movement.reason,
      'recorded_by', movement.recorded_by,
      'recorded_by_display_name', movement.recorded_by_display_name,
      'recorded_at', movement.recorded_at
    ) order by movement.occurred_at desc, movement.recorded_at desc,
      movement.movement_id), '[]'::jsonb) as data
    from (select * from movement_candidates limit 200) movement
  ), client_candidates as materialized (
    select client.id as client_id, client.client_code, client.display_name
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.status = 'active'
      and private.can_staff_access_client(client.id, 'clients.read')
    order by client.client_code, client.id
  ), client_options as materialized (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', client.client_id, 'client_code', client.client_code,
      'display_name', client.display_name
    ) order by client.client_code, client.client_id), '[]'::jsonb) as data
    from (select * from client_candidates limit 200) client
  ), staff_candidates as materialized (
    select distinct on (profile.id)
      profile.id as user_id, profile.display_name, profile.employee_code
    from public.profiles profile
    join public.memberships membership on membership.profile_id = profile.id
    where profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= p_reference_time
      and (membership.ends_at is null or membership.ends_at > p_reference_time)
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    order by profile.id, membership.branch_id nulls last
  ), staff_options as materialized (
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', staff.user_id, 'display_name', staff.display_name,
      'employee_code', staff.employee_code
    ) order by staff.display_name, staff.user_id), '[]'::jsonb) as data
    from (select * from staff_candidates order by display_name, user_id limit 200) staff
  ), returned_quantities as materialized (
    select movement.original_movement_id,
      sum(movement.quantity)::numeric(18,4) as returned_quantity
    from public.inventory_movements movement
    where movement.organization_id = p_expected_organization_id
      and movement.branch_id = p_expected_branch_id
      and movement.movement_type = 'return'
    group by movement.original_movement_id
  ), returnable_candidates as materialized (
    select movement.id as original_movement_id, movement.item_id,
      movement.batch_id, movement.movement_type, movement.occurred_at,
      item.item_code, item.item_name, batch.batch_number, batch.unit,
      (movement.quantity - coalesce(returned.returned_quantity, 0))::numeric(18,4)
        as outstanding_quantity,
      movement.client_id, client.client_code, client.display_name as client_display_name,
      movement.instruction_reference, movement.purpose, movement.destination_unit
    from public.inventory_movements movement
    join public.inventory_items item on item.id = movement.item_id
    join public.inventory_batches batch on batch.id = movement.batch_id
    left join returned_quantities returned
      on returned.original_movement_id = movement.id
    left join public.clients client on client.id = movement.client_id
    where movement.organization_id = p_expected_organization_id
      and movement.branch_id = p_expected_branch_id
      and movement.movement_type in ('issue', 'client_issue')
      and movement.quantity > coalesce(returned.returned_quantity, 0)
      and (movement.client_id is null or private.can_staff_access_client(
        movement.client_id, 'clients.read'
      ))
    order by movement.occurred_at desc, movement.id
  ), returnable_options as materialized (
    select coalesce(jsonb_agg(jsonb_build_object(
      'original_movement_id', movement.original_movement_id,
      'item_id', movement.item_id, 'batch_id', movement.batch_id,
      'movement_type', movement.movement_type,
      'occurred_at', movement.occurred_at,
      'item_code', movement.item_code, 'item_name', movement.item_name,
      'batch_number', movement.batch_number, 'unit', movement.unit,
      'outstanding_quantity', movement.outstanding_quantity::text,
      'client_id', movement.client_id, 'client_code', movement.client_code,
      'client_display_name', movement.client_display_name,
      'instruction_reference', movement.instruction_reference,
      'purpose', movement.purpose,
      'destination_unit', movement.destination_unit
    ) order by movement.occurred_at desc, movement.original_movement_id), '[]'::jsonb) as data
    from (select * from returnable_candidates limit 200) movement
  )
  select jsonb_build_object(
    'generated_at', context.generated_at,
    'snapshot_date', context.snapshot_date,
    'policy_status', case when policy.id is null then 'not_configured' else 'published' end,
    'policy_version', policy.version,
    'near_expiry_days', policy.near_expiry_days,
    'stocktake_cycle_days', policy.stocktake_cycle_days,
    'item_options', item_options.data,
    'item_total', (select count(*) from item_rollups),
    'items_truncated', (select count(*) > 200 from item_rollups),
    'batches', batch_details.data,
    'batch_total', (select count(*) from batch_projection),
    'matching_batch_total', (select count(*) from filtered_batches),
    'matching_item_total', (select count(distinct item_id) from filtered_batches),
    'batches_truncated', (select count(*) > 200 from filtered_batches),
    'movement_history', movement_history.data,
    'matching_movement_total', (select count(*) from movement_candidates),
    'movements_truncated', (select count(*) > 200 from movement_candidates),
    'client_options', client_options.data,
    'client_total', (select count(*) from client_candidates),
    'clients_truncated', (select count(*) > 200 from client_candidates),
    'staff_options', staff_options.data,
    'staff_total', (select count(*) from staff_candidates),
    'staff_truncated', (select count(*) > 200 from staff_candidates),
    'returnable_issue_options', returnable_options.data,
    'returnable_issue_total', (select count(*) from returnable_candidates),
    'returnable_issues_truncated', (select count(*) > 200 from returnable_candidates),
    'low_stock_total', case when policy.id is null then null else (
      select count(distinct item_id) from filtered_batches batch
      where batch.is_low_stock
    ) end,
    'near_expiry_total', case when policy.id is null then null else (
      select count(*) from filtered_batches batch
      where batch.balance > 0 and batch.is_near_expiry
    ) end,
    'expired_batch_total', (
      select count(*) from filtered_batches batch
      where batch.balance > 0 and batch.expiry_status = 'expired'
    ),
    'stocktake_due_total', case when policy.id is null then null else (
      select count(*) from filtered_batches batch
      where batch.balance > 0 and batch.is_stocktake_due
    ) end,
    'supplier_procurement', 'not_implemented',
    'medication_order_integration', 'not_implemented',
    'financial_automation', 'not_implemented'
  )
  from snapshot_context context
  cross join item_options
  cross join batch_details
  cross join movement_history
  cross join client_options
  cross join staff_options
  cross join returnable_options
  left join current_policy policy on true;
$$;

create or replace function private.inventory_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_id uuid,
  p_search text,
  p_batch_query text,
  p_expiry_status text,
  p_movement_type text
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  snapshot_date date,
  policy_status text,
  policy_version integer,
  near_expiry_days integer,
  stocktake_cycle_days integer,
  item_options jsonb,
  item_total bigint,
  items_truncated boolean,
  batches jsonb,
  batch_total bigint,
  matching_batch_total bigint,
  matching_item_total bigint,
  batches_truncated boolean,
  movement_history jsonb,
  matching_movement_total bigint,
  movements_truncated boolean,
  client_options jsonb,
  client_total bigint,
  clients_truncated boolean,
  staff_options jsonb,
  staff_total bigint,
  staff_truncated boolean,
  returnable_issue_options jsonb,
  returnable_issue_total bigint,
  returnable_issues_truncated boolean,
  low_stock_total bigint,
  near_expiry_total bigint,
  expired_batch_total bigint,
  stocktake_due_total bigint,
  supplier_procurement text,
  medication_order_integration text,
  financial_automation text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_bundle jsonb;
  v_after jsonb;
  v_search text := nullif(btrim(p_search), '');
  v_batch_query text := nullif(btrim(p_batch_query), '');
  v_expiry_status text := coalesce(nullif(btrim(p_expiry_status), ''), 'all');
  v_movement_type text := coalesce(nullif(btrim(p_movement_type), ''), 'all');
begin
  if v_search is not null and (
    char_length(v_search) > 100 or v_search ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'inventory search is invalid';
  end if;
  if v_batch_query is not null and (
    char_length(v_batch_query) > 100 or v_batch_query ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = '22023', message = 'inventory batch query is invalid';
  end if;
  if v_expiry_status not in ('all', 'valid', 'near_expiry', 'expired') then
    raise exception using errcode = '22023', message = 'inventory expiry filter is invalid';
  end if;
  if v_movement_type not in (
    'all', 'receipt', 'issue', 'return', 'adjustment', 'client_issue', 'stocktake'
  ) then
    raise exception using errcode = '22023', message = 'inventory movement filter is invalid';
  end if;
  if not private.inventory_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'inventory.read'
  ) then
    raise exception using errcode = '42501', message = 'inventory snapshot is not permitted';
  end if;
  v_now := clock_timestamp();
  v_bundle := private.inventory_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_item_id, v_search, v_batch_query, v_expiry_status, v_movement_type
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    'select', 'inventory_management_snapshot',
    p_expected_branch_id::text, array['bounded_snapshot'],
    jsonb_build_object('workflow', 'page77_inventory_v1',
      'generated_at', v_now,
      'item_filter', p_item_id,
      'expiry_status', v_expiry_status,
      'movement_type', v_movement_type,
      'matching_batch_total', v_bundle -> 'matching_batch_total',
      'matching_movement_total', v_bundle -> 'matching_movement_total')
  );
  if not private.inventory_current_authority(
    p_expected_organization_id, p_expected_branch_id, 'inventory.read'
  ) then
    raise exception using errcode = '42501', message = 'inventory snapshot final verification failed';
  end if;
  v_after := private.inventory_management_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, v_now,
    p_item_id, v_search, v_batch_query, v_expiry_status, v_movement_type
  );
  if v_after is distinct from v_bundle then
    raise exception using errcode = '40001', message = 'inventory snapshot changed during audit';
  end if;
  return query select p_expected_organization_id, p_expected_branch_id,
    (v_bundle ->> 'generated_at')::timestamptz,
    (v_bundle ->> 'snapshot_date')::date,
    v_bundle ->> 'policy_status',
    (v_bundle ->> 'policy_version')::integer,
    (v_bundle ->> 'near_expiry_days')::integer,
    (v_bundle ->> 'stocktake_cycle_days')::integer,
    v_bundle -> 'item_options', (v_bundle ->> 'item_total')::bigint,
    (v_bundle ->> 'items_truncated')::boolean,
    v_bundle -> 'batches', (v_bundle ->> 'batch_total')::bigint,
    (v_bundle ->> 'matching_batch_total')::bigint,
    (v_bundle ->> 'matching_item_total')::bigint,
    (v_bundle ->> 'batches_truncated')::boolean,
    v_bundle -> 'movement_history',
    (v_bundle ->> 'matching_movement_total')::bigint,
    (v_bundle ->> 'movements_truncated')::boolean,
    v_bundle -> 'client_options', (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'clients_truncated')::boolean,
    v_bundle -> 'staff_options', (v_bundle ->> 'staff_total')::bigint,
    (v_bundle ->> 'staff_truncated')::boolean,
    v_bundle -> 'returnable_issue_options',
    (v_bundle ->> 'returnable_issue_total')::bigint,
    (v_bundle ->> 'returnable_issues_truncated')::boolean,
    (v_bundle ->> 'low_stock_total')::bigint,
    (v_bundle ->> 'near_expiry_total')::bigint,
    (v_bundle ->> 'expired_batch_total')::bigint,
    (v_bundle ->> 'stocktake_due_total')::bigint,
    v_bundle ->> 'supplier_procurement',
    v_bundle ->> 'medication_order_integration',
    v_bundle ->> 'financial_automation';
end;
$$;

create or replace function public.inventory_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_item_id uuid default null,
  p_search text default null,
  p_batch_query text default null,
  p_expiry_status text default 'all',
  p_movement_type text default 'all'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, policy_status text, policy_version integer,
  near_expiry_days integer, stocktake_cycle_days integer,
  item_options jsonb, item_total bigint, items_truncated boolean,
  batches jsonb, batch_total bigint, matching_batch_total bigint,
  matching_item_total bigint, batches_truncated boolean,
  movement_history jsonb, matching_movement_total bigint,
  movements_truncated boolean,
  client_options jsonb, client_total bigint, clients_truncated boolean,
  staff_options jsonb, staff_total bigint, staff_truncated boolean,
  returnable_issue_options jsonb, returnable_issue_total bigint,
  returnable_issues_truncated boolean, low_stock_total bigint,
  near_expiry_total bigint, expired_batch_total bigint,
  stocktake_due_total bigint, supplier_procurement text,
  medication_order_integration text, financial_automation text
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.inventory_management_snapshot_response(
    p_expected_organization_id, p_expected_branch_id,
    p_item_id, p_search, p_batch_query, p_expiry_status, p_movement_type
  );
$$;

alter table public.inventory_items enable row level security;
alter table public.inventory_item_status_events enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_items force row level security;
alter table public.inventory_item_status_events force row level security;
alter table public.inventory_batches force row level security;
alter table public.inventory_movements force row level security;

create policy inventory_items_select on public.inventory_items
for select to authenticated using (
  private.inventory_current_authority(
    organization_id, branch_id, 'inventory.read'
  )
);
create policy inventory_item_status_events_select on public.inventory_item_status_events
for select to authenticated using (
  private.inventory_current_authority(
    organization_id, branch_id, 'inventory.read'
  )
);
create policy inventory_batches_select on public.inventory_batches
for select to authenticated using (
  private.inventory_current_authority(
    organization_id, branch_id, 'inventory.read'
  )
);
create policy inventory_movements_select on public.inventory_movements
for select to authenticated using (
  private.inventory_current_authority(
    organization_id, branch_id, 'inventory.read'
  )
);

revoke all on table public.inventory_items from public, anon, authenticated, service_role;
revoke all on table public.inventory_item_status_events from public, anon, authenticated, service_role;
revoke all on table public.inventory_batches from public, anon, authenticated, service_role;
revoke all on table public.inventory_movements from public, anon, authenticated, service_role;
revoke all on table private.inventory_policy_versions from public, anon, authenticated;
revoke all on table private.inventory_safety_levels from public, anon, authenticated;
revoke all on table private.inventory_item_operations from public, anon, authenticated;
revoke all on table private.inventory_movement_operations from public, anon, authenticated;

revoke all on function private.inventory_records_are_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.inventory_current_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.inventory_staff_is_current(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_inventory_reauth_evidence(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_inventory_item_status_chain()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_inventory_policy_chain()
  from public, anon, authenticated, service_role;
revoke all on function private.create_inventory_item_guarded(
  uuid, uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.set_inventory_item_status_guarded(
  uuid, uuid, uuid, text, text, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.record_inventory_movement_guarded(
  uuid, uuid, uuid, uuid, text, date, text, text, numeric, numeric,
  numeric, uuid, uuid, text, uuid, text, text, text, timestamptz,
  integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.inventory_management_snapshot_bundle(
  uuid, uuid, timestamptz, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.inventory_management_snapshot_response(
  uuid, uuid, uuid, text, text, text, text
)
  from public, anon, authenticated, service_role;
revoke all on function public.create_inventory_item(
  uuid, uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.set_inventory_item_status(
  uuid, uuid, uuid, text, text, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_inventory_movement(
  uuid, uuid, uuid, uuid, text, date, text, text, numeric, numeric,
  numeric, uuid, uuid, text, uuid, text, text, text, timestamptz,
  integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.inventory_management_snapshot(
  uuid, uuid, uuid, text, text, text, text
)
  from public, anon, authenticated, service_role;

grant execute on function public.create_inventory_item(
  uuid, uuid, text, text, text, uuid
) to authenticated;
grant execute on function public.set_inventory_item_status(
  uuid, uuid, uuid, text, text, integer, uuid
) to authenticated;
grant execute on function public.record_inventory_movement(
  uuid, uuid, uuid, uuid, text, date, text, text, numeric, numeric,
  numeric, uuid, uuid, text, uuid, text, text, text, timestamptz,
  integer, uuid
) to authenticated;
grant execute on function public.inventory_management_snapshot(
  uuid, uuid, uuid, text, text, text, text
)
  to authenticated;
grant execute on function private.create_inventory_item_guarded(
  uuid, uuid, text, text, text, uuid
) to authenticated;
grant execute on function private.set_inventory_item_status_guarded(
  uuid, uuid, uuid, text, text, integer, uuid
) to authenticated;
grant execute on function private.record_inventory_movement_guarded(
  uuid, uuid, uuid, uuid, text, date, text, text, numeric, numeric,
  numeric, uuid, uuid, text, uuid, text, text, text, timestamptz,
  integer, uuid
) to authenticated;
grant execute on function private.inventory_management_snapshot_response(
  uuid, uuid, uuid, text, text, text, text
)
  to authenticated;

comment on function public.record_inventory_movement(
  uuid, uuid, uuid, uuid, text, date, text, text, numeric, numeric,
  numeric, uuid, uuid, text, uuid, text, text, text, timestamptz,
  integer, uuid
) is 'Appends one exact-replay inventory movement after authoritative balance, expiry, return and client-scope checks.';
comment on function public.inventory_management_snapshot(
  uuid, uuid, uuid, text, text, text, text
) is
  'Returns one bounded audited inventory snapshot; policy-derived flags remain null until an institution policy exists.';
