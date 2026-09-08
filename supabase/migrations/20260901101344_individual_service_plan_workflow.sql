-- Page 10: immutable monthly individual service plans.
--
-- This is intentionally separate from the broader authorized/client service
-- plan model. A Taiwan calendar month is a business partition, not a formula:
-- staff select the month, and the application defaults that selection using
-- Asia/Taipei. Goals, activities, frequency text and progress are human-entered
-- facts. This migration does not invent scoring, completion percentages, or
-- clinical recommendations.

create or replace function private.individual_service_plan_items_valid(
  p_items jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_index integer := 0;
  v_note text;
begin
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 20 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'item_order', 'goal', 'activity', 'frequency',
         'responsible_user_id', 'responsible_display_name',
         'progress_status', 'progress_note'
       ])
       or (v_item - array[
         'item_order', 'goal', 'activity', 'frequency',
         'responsible_user_id', 'responsible_display_name',
         'progress_status', 'progress_note'
       ]) <> '{}'::jsonb
       or jsonb_typeof(v_item -> 'item_order') <> 'number'
       or (v_item ->> 'item_order') !~ '^[1-9][0-9]?$'
       or (v_item ->> 'item_order')::integer <> v_index
       or jsonb_typeof(v_item -> 'goal') <> 'string'
       or char_length(v_item ->> 'goal') not between 1 and 500
       or (v_item ->> 'goal') ~ '[[:cntrl:]]'
       or jsonb_typeof(v_item -> 'activity') <> 'string'
       or char_length(v_item ->> 'activity') not between 1 and 1000
       or (v_item ->> 'activity') ~ '[[:cntrl:]]'
       or jsonb_typeof(v_item -> 'frequency') <> 'string'
       or char_length(v_item ->> 'frequency') not between 1 and 240
       or (v_item ->> 'frequency') ~ '[[:cntrl:]]'
       or jsonb_typeof(v_item -> 'responsible_user_id') <> 'string'
       or (v_item ->> 'responsible_user_id') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'responsible_display_name') <> 'string'
       or char_length(v_item ->> 'responsible_display_name') not between 1 and 120
       or (v_item ->> 'responsible_display_name') ~ '[[:cntrl:]]'
       or jsonb_typeof(v_item -> 'progress_status') <> 'string'
       or (v_item ->> 'progress_status') not in (
         'not_started', 'in_progress', 'completed'
       ) then
      return false;
    end if;

    if jsonb_typeof(v_item -> 'progress_note') = 'null' then
      v_note := null;
    elsif jsonb_typeof(v_item -> 'progress_note') = 'string' then
      v_note := v_item ->> 'progress_note';
      if char_length(v_note) not between 1 and 1000
         or v_note ~ '[[:cntrl:]]' then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create table public.individual_service_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  plan_month date not null,
  plan_key uuid not null,
  plan_version integer not null,
  previous_plan_id uuid,
  correction_reason text,
  plan_items jsonb not null,
  status text not null,
  signed_at timestamptz not null,
  signed_by uuid not null references auth.users(id) on delete restrict,
  signature_purpose text not null,
  signature_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  constraint individual_service_plans_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint individual_service_plans_id_scope_key unique (
    id, organization_id, branch_id, client_id, plan_month
  ),
  constraint individual_service_plans_month_version_key unique (
    organization_id, branch_id, client_id, plan_month, plan_version
  ),
  constraint individual_service_plans_previous_key unique (previous_plan_id),
  constraint individual_service_plans_previous_scope_fkey
    foreign key (
      previous_plan_id, organization_id, branch_id, client_id, plan_month
    ) references public.individual_service_plans (
      id, organization_id, branch_id, client_id, plan_month
    ) on delete restrict,
  constraint individual_service_plans_month_check check (
    plan_month = date_trunc('month', plan_month::timestamp)::date
  ),
  constraint individual_service_plans_version_check check (
    plan_version > 0
    and (
      (plan_version = 1 and previous_plan_id is null and correction_reason is null)
      or (
        plan_version > 1
        and previous_plan_id is not null
        and char_length(correction_reason) between 1 and 1000
        and correction_reason !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint individual_service_plans_items_check check (
    private.individual_service_plan_items_valid(plan_items)
  ),
  constraint individual_service_plans_status_check check (status = 'signed'),
  constraint individual_service_plans_signature_purpose_check check (
    signature_purpose = '個別化服務計畫簽署'
  ),
  constraint individual_service_plans_actor_check check (
    created_by = signed_by
  ),
  constraint individual_service_plans_created_signed_check check (
    created_at = signed_at
  ),
  constraint individual_service_plans_content_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.individual_service_plans is
  'Immutable signed monthly plans. Each correction appends one terminal child in the same client-month chain.';
comment on column public.individual_service_plans.plan_month is
  'First day of a Taiwan business month. The UI defaults this with Asia/Taipei; no clinical formula is implied.';
comment on column public.individual_service_plans.plan_items is
  'Signed ordered goals, activities, human-entered frequency text, server-resolved responsible people and human-entered progress states.';

create index individual_service_plans_scope_month_idx
  on public.individual_service_plans (
    organization_id, branch_id, plan_month, client_id, plan_version desc
  );
create index individual_service_plans_plan_key_idx
  on public.individual_service_plans (plan_key, plan_version desc);
create index individual_service_plans_signed_by_idx
  on public.individual_service_plans (signed_by, signed_at desc);
create index individual_service_plans_created_by_idx
  on public.individual_service_plans (created_by, created_at desc);
create index individual_service_plans_reauth_idx
  on public.individual_service_plans (signature_reauth_challenge_id);

create table private.individual_service_plan_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  plan_month date not null,
  plan_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint individual_service_plan_operations_plan_scope_fkey
    foreign key (plan_id, organization_id, branch_id, client_id, plan_month)
    references public.individual_service_plans (
      id, organization_id, branch_id, client_id, plan_month
    ) on delete restrict,
  constraint individual_service_plan_operations_actor_idempotency_key
    unique (actor_user_id, idempotency_key),
  constraint individual_service_plan_operations_plan_key unique (plan_id),
  constraint individual_service_plan_operations_request_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

alter table public.individual_service_plans enable row level security;
alter table public.individual_service_plans force row level security;
alter table private.individual_service_plan_operations enable row level security;
alter table private.individual_service_plan_operations force row level security;

create index individual_service_plan_operations_scope_idx
  on private.individual_service_plan_operations (
    organization_id, branch_id, client_id, plan_month, created_at desc
  );
create index individual_service_plan_operations_reauth_idx
  on private.individual_service_plan_operations (reauth_challenge_id);

create or replace function private.prevent_individual_service_plan_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'signed individual service plans and replay receipts are immutable';
end;
$$;

create or replace function private.validate_individual_service_plan_chain()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous public.individual_service_plans%rowtype;
begin
  if new.plan_version = 1 then
    if new.previous_plan_id is not null or new.correction_reason is not null then
      raise exception using errcode = '23514', message = 'invalid first monthly plan version';
    end if;
    return new;
  end if;

  select previous.* into v_previous
  from public.individual_service_plans previous
  where previous.id = new.previous_plan_id
    and previous.organization_id = new.organization_id
    and previous.branch_id = new.branch_id
    and previous.client_id = new.client_id
    and previous.plan_month = new.plan_month
  for key share;

  if not found
     or v_previous.plan_key <> new.plan_key
     or v_previous.plan_version + 1 <> new.plan_version
     or exists (
       select 1 from public.individual_service_plans later
       where later.organization_id = new.organization_id
         and later.branch_id = new.branch_id
         and later.client_id = new.client_id
         and later.plan_month = new.plan_month
         and later.plan_version > v_previous.plan_version
     ) then
    raise exception using errcode = '23514', message = 'monthly plan correction must extend the terminal version';
  end if;
  return new;
end;
$$;

create trigger individual_service_plans_validate_chain
before insert on public.individual_service_plans
for each row execute function private.validate_individual_service_plan_chain();
create trigger individual_service_plans_prevent_mutation
before update or delete on public.individual_service_plans
for each row execute function private.prevent_individual_service_plan_mutation();
create trigger individual_service_plan_operations_prevent_mutation
before update or delete on private.individual_service_plan_operations
for each row execute function private.prevent_individual_service_plan_mutation();
create trigger individual_service_plans_audit_row_change
after insert on public.individual_service_plans
for each row execute function private.audit_row_change();
create trigger individual_service_plan_operations_audit_insert
after insert on private.individual_service_plan_operations
for each row execute function private.audit_row_change();

create or replace function private.require_individual_service_plan_reauth(
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
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501', message = 'recent AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'recent AAL2 evidence is required';
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
    raise exception using errcode = '42501', message = 'recent AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.record_individual_service_plan_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_plan_month date,
  p_previous_plan_id uuid,
  p_correction_reason text,
  p_items jsonb,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  plan_month date,
  plan_version integer,
  previous_plan_id uuid,
  signed_at timestamptz,
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
  v_client public.clients%rowtype;
  v_previous public.individual_service_plans%rowtype;
  v_plan public.individual_service_plans%rowtype;
  v_operation private.individual_service_plan_operations%rowtype;
  v_raw jsonb;
  v_items jsonb := '[]'::jsonb;
  v_index integer := 0;
  v_responsible_id uuid;
  v_responsible_name text;
  v_goal text;
  v_activity text;
  v_frequency text;
  v_progress text;
  v_note text;
  v_correction_reason text := nullif(btrim(p_correction_reason), '');
  v_request_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_content_hash text;
  v_plan_key uuid;
  v_plan_version integer;
  v_reauth_challenge_id uuid;
begin
  -- Authorization intentionally precedes parsing caller-controlled content.
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.write'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.sign'
     )) then
    raise exception using errcode = '42501', message = 'monthly plan write is not permitted';
  end if;

  if p_client_id is null
     or p_plan_month is null
     or p_plan_month <> date_trunc('month', p_plan_month::timestamp)::date
     or p_idempotency_key is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 20
     or (v_correction_reason is not null and (
       char_length(v_correction_reason) > 1000
       or v_correction_reason ~ '[[:cntrl:]]'
     )) then
    raise exception using errcode = '22023', message = 'valid monthly plan fields are required';
  end if;

  for v_raw in select value from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    if jsonb_typeof(v_raw) <> 'object'
       or not (v_raw ?& array[
         'goal', 'activity', 'frequency', 'responsible_user_id',
         'progress_status', 'progress_note'
       ])
       or (v_raw - array[
         'goal', 'activity', 'frequency', 'responsible_user_id',
         'progress_status', 'progress_note'
       ]) <> '{}'::jsonb
       or jsonb_typeof(v_raw -> 'goal') <> 'string'
       or jsonb_typeof(v_raw -> 'activity') <> 'string'
       or jsonb_typeof(v_raw -> 'frequency') <> 'string'
       or jsonb_typeof(v_raw -> 'responsible_user_id') <> 'string'
       or jsonb_typeof(v_raw -> 'progress_status') <> 'string'
       or jsonb_typeof(v_raw -> 'progress_note') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'invalid monthly plan item shape';
    end if;

    begin
      v_responsible_id := (v_raw ->> 'responsible_user_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid responsible user';
    end;
    v_goal := btrim(v_raw ->> 'goal');
    v_activity := btrim(v_raw ->> 'activity');
    v_frequency := btrim(v_raw ->> 'frequency');
    v_progress := lower(btrim(v_raw ->> 'progress_status'));
    v_note := nullif(btrim(v_raw ->> 'progress_note'), '');

    if char_length(v_goal) not between 1 and 500 or v_goal ~ '[[:cntrl:]]'
       or char_length(v_activity) not between 1 and 1000 or v_activity ~ '[[:cntrl:]]'
       or char_length(v_frequency) not between 1 and 240 or v_frequency ~ '[[:cntrl:]]'
       or v_progress not in ('not_started', 'in_progress', 'completed')
       or (v_note is not null and (
         char_length(v_note) > 1000 or v_note ~ '[[:cntrl:]]'
       )) then
      raise exception using errcode = '22023', message = 'invalid monthly plan item value';
    end if;

    v_request_items := v_request_items || jsonb_build_array(jsonb_build_object(
      'item_order', v_index,
      'goal', v_goal,
      'activity', v_activity,
      'frequency', v_frequency,
      'responsible_user_id', v_responsible_id,
      'progress_status', v_progress,
      'progress_note', v_note
    ));
  end loop;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'actor_user_id', v_actor,
    'plan_month', p_plan_month,
    'previous_plan_id', p_previous_plan_id,
    'correction_reason', v_correction_reason,
    'items', v_request_items
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'individual-service-plan-operation:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select operation.* into v_operation
  from private.individual_service_plan_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.plan_month <> p_plan_month
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'monthly plan idempotency conflict';
    end if;
    if not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, 'care_plans.write'))
       or not (select private.can_staff_access_client(p_client_id, 'care_plans.sign'))
       or not exists (
         select 1 from private.reauth_challenges challenge
         where challenge.id = v_operation.reauth_challenge_id
           and challenge.user_id = v_actor
           and challenge.consumed_at is not null
           and challenge.invalidated_at is null
       ) then
      raise exception using errcode = '42501', message = 'monthly plan replay is not permitted';
    end if;
    -- An exact replay still needs current, same-session, recent step-up.
    perform private.require_individual_service_plan_reauth(v_actor, clock_timestamp());
    select plan.* into strict v_plan
    from public.individual_service_plans plan
    where plan.id = v_operation.plan_id
      and plan.organization_id = v_operation.organization_id
      and plan.branch_id = v_operation.branch_id
      and plan.client_id = v_operation.client_id
      and plan.plan_month = v_operation.plan_month;
    return query select v_plan.id, v_plan.client_id, v_plan.plan_month,
      v_plan.plan_version, v_plan.previous_plan_id, v_plan.signed_at, true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or v_client.admitted_on is null
     or v_client.admitted_on > (p_plan_month + interval '1 month - 1 day')::date
     or (v_client.ended_on is not null and v_client.ended_on < p_plan_month)
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'care_plans.write'))
     or not (select private.can_staff_access_client(p_client_id, 'care_plans.sign')) then
    raise exception using errcode = '42501', message = 'client is outside monthly plan scope';
  end if;

  -- Mutable responsible-person eligibility is intentionally checked only for
  -- a new write. Exact replay above is correlated from immutable request facts,
  -- actor scope and fresh AAL2, so a later staff departure cannot rewrite the
  -- historical meaning of an already committed receipt.
  v_items := '[]'::jsonb;
  for v_raw in select value from jsonb_array_elements(v_request_items)
  loop
    v_responsible_id := (v_raw ->> 'responsible_user_id')::uuid;
    v_responsible_name := null;
    select profile.display_name into v_responsible_name
    from public.profiles profile
    where profile.id = v_responsible_id
      and profile.is_active
      and profile.kind <> 'family'
      and exists (
        select 1 from public.memberships membership
        where membership.profile_id = profile.id
          and membership.organization_id = p_expected_organization_id
          and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
          and membership.status = 'active'
          and membership.starts_at <= clock_timestamp()
          and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      );
    if v_responsible_name is null then
      raise exception using errcode = '42501', message = 'responsible user is outside active branch scope';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item_order', (v_raw ->> 'item_order')::integer,
      'goal', v_raw ->> 'goal',
      'activity', v_raw ->> 'activity',
      'frequency', v_raw ->> 'frequency',
      'responsible_user_id', v_responsible_id,
      'responsible_display_name', btrim(v_responsible_name),
      'progress_status', v_raw ->> 'progress_status',
      'progress_note', v_raw -> 'progress_note'
    ));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(
    'individual-service-plan-chain:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_client_id::text || ':' || p_plan_month::text,
    0
  ));

  select plan.* into v_previous
  from public.individual_service_plans plan
  where plan.organization_id = p_expected_organization_id
    and plan.branch_id = p_expected_branch_id
    and plan.client_id = p_client_id
    and plan.plan_month = p_plan_month
  order by plan.plan_version desc
  limit 1
  for update;

  if v_previous.id is null then
    if p_previous_plan_id is not null or v_correction_reason is not null then
      raise exception using errcode = '23514', message = 'first monthly plan cannot claim a predecessor';
    end if;
    v_plan_key := gen_random_uuid();
    v_plan_version := 1;
  else
    if p_previous_plan_id is null
       or p_previous_plan_id <> v_previous.id
       or v_correction_reason is null then
      raise exception using errcode = '23514', message = 'correction must extend the latest monthly plan';
    end if;
    v_plan_key := v_previous.plan_key;
    v_plan_version := v_previous.plan_version + 1;
  end if;

  -- Recheck current authority and freeze evidence only after all lock waits.
  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'care_plans.write'))
     or not (select private.can_staff_access_client(p_client_id, 'care_plans.sign')) then
    raise exception using errcode = '42501', message = 'monthly plan authority expired';
  end if;
  v_now := clock_timestamp();
  v_reauth_challenge_id := private.require_individual_service_plan_reauth(v_actor, v_now);

  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'content_hash_version', 1,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'plan_month', p_plan_month,
    'plan_key', v_plan_key,
    'plan_version', v_plan_version,
    'previous_plan_id', v_previous.id,
    'correction_reason', v_correction_reason,
    'items', v_items,
    'status', 'signed',
    'signed_at', v_now,
    'signed_by', v_actor,
    'signature_purpose', '個別化服務計畫簽署',
    'signature_reauth_challenge_id', v_reauth_challenge_id
  )::text, 'UTF8')), 'hex');

  insert into public.individual_service_plans (
    organization_id, branch_id, client_id, plan_month, plan_key,
    plan_version, previous_plan_id, correction_reason, plan_items, status,
    signed_at, signed_by, signature_purpose, signature_reauth_challenge_id,
    content_hash, created_by, created_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, p_plan_month,
    v_plan_key, v_plan_version, v_previous.id, v_correction_reason, v_items,
    'signed', v_now, v_actor, '個別化服務計畫簽署',
    v_reauth_challenge_id, v_content_hash, v_actor, v_now
  ) returning * into v_plan;

  insert into private.individual_service_plan_operations (
    organization_id, branch_id, client_id, plan_month, plan_id,
    actor_user_id, idempotency_key, request_hash, reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, p_plan_month,
    v_plan.id, v_actor, p_idempotency_key, v_request_hash, v_reauth_challenge_id
  );

  return query select v_plan.id, v_plan.client_id, v_plan.plan_month,
    v_plan.plan_version, v_plan.previous_plan_id, v_plan.signed_at, false;
end;
$$;

create or replace function private.individual_service_plan_snapshot_core(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_plan_month date
)
returns table(
  plan_id uuid,
  client_id uuid,
  plan_month date,
  plan_version integer,
  previous_plan_id uuid,
  correction_reason text,
  plan_items jsonb,
  signed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
  v_plan_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_plan_month is null
     or p_plan_month <> date_trunc('month', p_plan_month::timestamp)::date
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.read'
     )) then
    raise exception using errcode = '42501', message = 'monthly plan snapshot is not permitted';
  end if;

  select coalesce(array_agg(selected.plan_id order by selected.client_id), '{}'::uuid[])
    into v_plan_ids
  from (
    select distinct on (plan.client_id) plan.id as plan_id, plan.client_id
    from public.individual_service_plans plan
    where plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id
      and plan.plan_month = p_plan_month
      and (select private.can_staff_access_client(plan.client_id, 'clients.read'))
      and (select private.can_staff_access_client(plan.client_id, 'care_plans.read'))
    order by plan.client_id, plan.plan_version desc, plan.id
  ) selected;

  return query
  select
    plan.id, plan.client_id, plan.plan_month, plan.plan_version,
    plan.previous_plan_id, plan.correction_reason, plan.plan_items, plan.signed_at
  from public.individual_service_plans plan
  where plan.id = any(v_plan_ids)
  order by plan.client_id, plan.plan_version desc, plan.id;
  get diagnostics v_count = row_count;

  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.read'
     ))
     or v_plan_ids is distinct from (
       select coalesce(array_agg(selected.plan_id order by selected.client_id), '{}'::uuid[])
       from (
         select distinct on (plan.client_id) plan.id as plan_id, plan.client_id
         from public.individual_service_plans plan
         where plan.organization_id = p_expected_organization_id
           and plan.branch_id = p_expected_branch_id
           and plan.plan_month = p_plan_month
           and (select private.can_staff_access_client(plan.client_id, 'clients.read'))
           and (select private.can_staff_access_client(plan.client_id, 'care_plans.read'))
         order by plan.client_id, plan.plan_version desc, plan.id
       ) selected
     ) then
    raise exception using errcode = '42501', message = 'monthly plan snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'individual_service_plans', p_plan_month::text, '{}'::text[],
    jsonb_build_object('projection', 'page10_latest_month', 'result_count', v_count)
  );

  -- Audit insertion may itself wait. Do not return a buffered sensitive result
  -- after a branch, role or assignment was revoked during that wait.
  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.read'
     ))
     or v_plan_ids is distinct from (
       select coalesce(array_agg(selected.plan_id order by selected.client_id), '{}'::uuid[])
       from (
         select distinct on (plan.client_id) plan.id as plan_id, plan.client_id
         from public.individual_service_plans plan
         where plan.organization_id = p_expected_organization_id
           and plan.branch_id = p_expected_branch_id
           and plan.plan_month = p_plan_month
           and (select private.can_staff_access_client(plan.client_id, 'clients.read'))
           and (select private.can_staff_access_client(plan.client_id, 'care_plans.read'))
         order by plan.client_id, plan.plan_version desc, plan.id
       ) selected
     ) then
    raise exception using errcode = '42501', message = 'monthly plan snapshot authority expired after audit';
  end if;
end;
$$;

create or replace function private.individual_service_plan_responsibles_core(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(user_id uuid, display_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if v_actor is null
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.write'
     )) then
    raise exception using errcode = '42501', message = 'responsible staff snapshot is not permitted';
  end if;

  return query
  select distinct profile.id, profile.display_name
  from public.profiles profile
  join public.memberships membership on membership.profile_id = profile.id
  where membership.organization_id = p_expected_organization_id
    and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
    and membership.status = 'active'
    and membership.starts_at <= clock_timestamp()
    and (membership.ends_at is null or membership.ends_at > clock_timestamp())
    and profile.is_active
    and profile.kind <> 'family'
  order by profile.display_name, profile.id;
  get diagnostics v_count = row_count;

  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.write'
     )) then
    raise exception using errcode = '42501', message = 'responsible staff snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'profiles', 'page10-responsibles', '{}'::text[],
    jsonb_build_object('projection', 'page10_responsibles', 'result_count', v_count)
  );

  if not exists (
    select 1 from public.branches branch
    where branch.id = p_expected_branch_id
      and branch.organization_id = p_expected_organization_id
      and branch.is_active
  )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.write'
     )) then
    raise exception using errcode = '42501', message = 'responsible staff snapshot authority expired after audit';
  end if;
end;
$$;

create or replace function public.record_individual_service_plan(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_plan_month date,
  p_previous_plan_id uuid,
  p_correction_reason text,
  p_items jsonb,
  p_idempotency_key uuid
)
returns table(
  plan_id uuid,
  client_id uuid,
  plan_month date,
  plan_version integer,
  previous_plan_id uuid,
  signed_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.record_individual_service_plan_atomic(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_plan_month, p_previous_plan_id, p_correction_reason, p_items,
    p_idempotency_key
  );
$$;

create or replace function public.individual_service_plan_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_plan_month date
)
returns table(
  plan_id uuid,
  client_id uuid,
  plan_month date,
  plan_version integer,
  previous_plan_id uuid,
  correction_reason text,
  plan_items jsonb,
  signed_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.individual_service_plan_snapshot_core(
    p_expected_organization_id, p_expected_branch_id, p_plan_month
  );
$$;

create or replace function public.individual_service_plan_responsibles(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(user_id uuid, display_name text)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.individual_service_plan_responsibles_core(
    p_expected_organization_id, p_expected_branch_id
  );
$$;

revoke all on table public.individual_service_plans
  from public, anon, authenticated, service_role;
revoke all on table private.individual_service_plan_operations
  from public, anon, authenticated, service_role;

revoke all on function private.individual_service_plan_items_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_individual_service_plan_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_individual_service_plan_chain()
  from public, anon, authenticated, service_role;
revoke all on function private.require_individual_service_plan_reauth(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.record_individual_service_plan_atomic(
  uuid, uuid, uuid, date, uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.individual_service_plan_snapshot_core(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.individual_service_plan_responsibles_core(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_individual_service_plan(
  uuid, uuid, uuid, date, uuid, text, jsonb, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.individual_service_plan_snapshot(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.individual_service_plan_responsibles(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.record_individual_service_plan_atomic(
  uuid, uuid, uuid, date, uuid, text, jsonb, uuid
) to authenticated;
grant execute on function private.individual_service_plan_snapshot_core(uuid, uuid, date)
  to authenticated;
grant execute on function private.individual_service_plan_responsibles_core(uuid, uuid)
  to authenticated;
grant execute on function public.record_individual_service_plan(
  uuid, uuid, uuid, date, uuid, text, jsonb, uuid
) to authenticated;
grant execute on function public.individual_service_plan_snapshot(uuid, uuid, date)
  to authenticated;
grant execute on function public.individual_service_plan_responsibles(uuid, uuid)
  to authenticated;
