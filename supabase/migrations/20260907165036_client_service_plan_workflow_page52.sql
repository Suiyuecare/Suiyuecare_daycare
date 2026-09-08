-- Page 52: guarded, immutable workflow over the existing client_service_plans
-- and authorized_care_plans sources. This migration intentionally defines no
-- statutory code, rate, qualification mapping, or claim-eligibility rule.

-- Bind the operation ledger to the stable stream, not just a scoped row ID.
alter table public.client_service_plans
  add constraint client_service_plans_workflow_scope_key
  unique (id, organization_id, branch_id, client_id, plan_key);

create table private.client_service_plan_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  action text not null,
  result_plan_id uuid not null,
  result_plan_key uuid not null,
  result_version integer not null,
  result_status public.care_plan_version_status not null,
  result_previous_version_id uuid,
  result_authorized_care_plan_id uuid not null,
  result_authorized_content_hash text not null,
  result_previous_payload_hash text,
  result_payload_hash text not null,
  result_payload jsonb not null,
  result_reason text not null,
  result_committed_at timestamptz not null,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_service_plan_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint client_service_plan_operations_result_scope_fkey foreign key (
    result_plan_id, organization_id, branch_id, client_id, result_plan_key
  ) references public.client_service_plans (
    id, organization_id, branch_id, client_id, plan_key
  ) on delete restrict,
  constraint client_service_plan_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
    and result_authorized_content_hash ~ '^[a-f0-9]{64}$'
    and (result_previous_payload_hash is null or result_previous_payload_hash ~ '^[a-f0-9]{64}$')
    and result_payload_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint client_service_plan_operations_action_check check (
    action in ('create_draft','revise_draft','approve','sign','void')
  ),
  constraint client_service_plan_operations_result_check check (
    result_version > 0 and jsonb_typeof(result_payload) = 'object'
    and char_length(btrim(result_reason)) between 8 and 1000
    and translate(btrim(result_reason), E'\n\r\t', '') !~ '[[:cntrl:]]'
    and ((action = 'create_draft' and result_status = 'draft'
      and result_version = 1 and result_previous_version_id is null
      and result_previous_payload_hash is null and reauth_challenge_id is null)
    or (action = 'revise_draft' and result_status = 'draft'
      and result_version > 1 and result_previous_version_id is not null
      and result_previous_payload_hash is not null and reauth_challenge_id is null)
    or (action = 'approve' and result_status = 'approved'
      and result_previous_version_id is not null and result_previous_payload_hash is not null
      and reauth_challenge_id is not null)
    or (action = 'sign' and result_status = 'signed'
      and result_previous_version_id is not null and result_previous_payload_hash is not null
      and reauth_challenge_id is not null)
    or (action = 'void' and result_status = 'voided'
      and result_previous_version_id is not null and result_previous_payload_hash is not null
      and reauth_challenge_id is not null))
  )
);

create index client_service_plan_operations_result_idx
  on private.client_service_plan_operations (
    organization_id, branch_id, client_id, result_plan_key, result_version
  );
create index client_service_plan_operations_result_plan_idx
  on private.client_service_plan_operations (result_plan_id);
create index client_service_plan_operations_authorized_idx
  on private.client_service_plan_operations (result_authorized_care_plan_id);
create index client_service_plan_operations_reauth_idx
  on private.client_service_plan_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table private.client_service_plan_operations enable row level security;
alter table private.client_service_plan_operations force row level security;
revoke all on table private.client_service_plan_operations
  from public, anon, authenticated, service_role;

create or replace function private.client_service_plan_operation_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'client service plan operation history is append-only';
end;
$$;

create trigger client_service_plan_operations_append_only
before update or delete on private.client_service_plan_operations
for each row execute function private.client_service_plan_operation_append_only();

create trigger client_service_plan_operations_audit_row_change
after insert on private.client_service_plan_operations
for each row execute function private.audit_row_change();

create or replace function private.client_service_plan_workflow_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.is_active
        and profile.kind in ('staff','professional')
    )
    and exists (
      select 1 from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and exists (
      select 1 from public.memberships membership
      where membership.profile_id = auth.uid()
        and membership.organization_id = p_expected_organization_id
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and membership.status = 'active'
        and membership.starts_at <= clock_timestamp()
        and (membership.ends_at is null or membership.ends_at > clock_timestamp())
    )
    and private.has_permission(p_expected_organization_id, p_expected_branch_id, p_permission);
$$;

create or replace function private.client_service_plan_workflow_client_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_permission text,
  p_require_serviceable boolean default true
) returns boolean language sql stable security definer set search_path = '' as $$
  select private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission)
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
        and (not p_require_serviceable or client.status in ('active','suspended'))
    )
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.client_service_plan_active_responsible(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_user_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and exists (
      select 1 from public.profiles profile
      where profile.id = p_user_id and profile.is_active
        and profile.kind in ('staff','professional')
    )
    and exists (
      select 1 from public.memberships membership
      where membership.profile_id = p_user_id
        and membership.organization_id = p_expected_organization_id
        and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
        and membership.status = 'active'
        and membership.starts_at <= clock_timestamp()
        and (membership.ends_at is null or membership.ends_at > clock_timestamp())
    );
$$;

create or replace function private.require_client_service_plan_workflow_reauth(
  p_actor uuid,
  p_reference_time timestamptz
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session_id uuid;
  v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id
    and challenge.user_id = event.user_id
    and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_reference_time - interval '15 minutes'
    and challenge.factor_verified_at <= p_reference_time + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc
  limit 1 for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501', message = 'current same-session recent AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.client_service_plan_goals_valid(p_goals jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_goals) = 'array'
    and jsonb_array_length(p_goals) between 1 and 50
    and not exists (
      select 1 from jsonb_array_elements(p_goals) item
      where jsonb_typeof(item) <> 'object'
        or not (item ?& array['goal_id','item_order','goal','target_outcome'])
        or item - array['goal_id','item_order','goal','target_outcome'] <> '{}'::jsonb
        or coalesce(item ->> 'goal_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'item_order','') !~ '^[1-9][0-9]*$'
        or (item ->> 'item_order')::integer not between 1 and 50
        or jsonb_typeof(item -> 'goal') <> 'string'
        or char_length(btrim(item ->> 'goal')) not between 1 and 1000
        or btrim(item ->> 'goal') <> item ->> 'goal'
        or translate(item ->> 'goal', E'\n\r\t', '') ~ '[[:cntrl:]]'
        or jsonb_typeof(item -> 'target_outcome') <> 'string'
        or char_length(btrim(item ->> 'target_outcome')) not between 1 and 1000
        or btrim(item ->> 'target_outcome') <> item ->> 'target_outcome'
        or translate(item ->> 'target_outcome', E'\n\r\t', '') ~ '[[:cntrl:]]'
    )
    and (select count(distinct item ->> 'goal_id') from jsonb_array_elements(p_goals) item)
      = jsonb_array_length(p_goals)
    and (select count(distinct (item ->> 'item_order')::integer) from jsonb_array_elements(p_goals) item)
      = jsonb_array_length(p_goals)
    and (select min((item ->> 'item_order')::integer) from jsonb_array_elements(p_goals) item) = 1
    and (select max((item ->> 'item_order')::integer) from jsonb_array_elements(p_goals) item)
      = jsonb_array_length(p_goals);
$$;

create or replace function private.client_service_plan_measures_valid(
  p_planned_services jsonb,
  p_goals jsonb,
  p_persisted boolean default false
) returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_planned_services) = 'array'
    and jsonb_array_length(p_planned_services) between 1 and 100
    and not exists (
      select 1 from jsonb_array_elements(p_planned_services) item
      where jsonb_typeof(item) <> 'object'
        or not (item ?& array['measure_id','item_order','goal_id','measure','frequency','responsible_user_id'])
        or item - (case when p_persisted then
            array['measure_id','item_order','goal_id','measure','frequency','responsible_user_id',
              'responsible_display_name','qualification_status']
          else array['measure_id','item_order','goal_id','measure','frequency','responsible_user_id'] end) <> '{}'::jsonb
        or (p_persisted and not (item ?& array['responsible_display_name','qualification_status']))
        or coalesce(item ->> 'measure_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'goal_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'responsible_user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(item ->> 'item_order','') !~ '^[1-9][0-9]*$'
        or (item ->> 'item_order')::integer not between 1 and 100
        or jsonb_typeof(item -> 'measure') <> 'string'
        or char_length(btrim(item ->> 'measure')) not between 1 and 2000
        or btrim(item ->> 'measure') <> item ->> 'measure'
        or translate(item ->> 'measure', E'\n\r\t', '') ~ '[[:cntrl:]]'
        or jsonb_typeof(item -> 'frequency') <> 'string'
        or char_length(btrim(item ->> 'frequency')) not between 1 and 500
        or btrim(item ->> 'frequency') <> item ->> 'frequency'
        or translate(item ->> 'frequency', E'\n\r\t', '') ~ '[[:cntrl:]]'
        or not exists (
          select 1 from jsonb_array_elements(p_goals) goal
          where goal ->> 'goal_id' = item ->> 'goal_id'
        )
        or (p_persisted and (
          jsonb_typeof(item -> 'responsible_display_name') <> 'string'
          or char_length(btrim(item ->> 'responsible_display_name')) not between 1 and 120
          or btrim(item ->> 'responsible_display_name') <> item ->> 'responsible_display_name'
          or (item ->> 'responsible_display_name') ~ '[[:cntrl:]]'
          or item ->> 'qualification_status' <> 'active_membership_only'
        ))
    )
    and (select count(distinct item ->> 'measure_id') from jsonb_array_elements(p_planned_services) item)
      = jsonb_array_length(p_planned_services)
    and (select count(distinct (item ->> 'item_order')::integer)
      from jsonb_array_elements(p_planned_services) item) = jsonb_array_length(p_planned_services)
    and (select min((item ->> 'item_order')::integer)
      from jsonb_array_elements(p_planned_services) item) = 1
    and (select max((item ->> 'item_order')::integer)
      from jsonb_array_elements(p_planned_services) item) = jsonb_array_length(p_planned_services);
$$;

create or replace function private.client_service_plan_content_is_mapped(
  p_goals jsonb,
  p_planned_services jsonb
) returns boolean language sql immutable security invoker set search_path = '' as $$
  select private.client_service_plan_goals_valid(p_goals)
    and private.client_service_plan_measures_valid(p_planned_services, p_goals, true);
$$;

create or replace function private.client_service_plan_payload_json(
  p_plan public.client_service_plans,
  p_authorized_content_hash text,
  p_reason text
) returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'schema_version', 1,
    'organization_id', p_plan.organization_id,
    'branch_id', p_plan.branch_id,
    'client_id', p_plan.client_id,
    'plan_key', p_plan.plan_key,
    'version', p_plan.version,
    'previous_version_id', p_plan.previous_version_id,
    'status', p_plan.status,
    'authorized_care_plan_id', p_plan.authorized_care_plan_id,
    'authorized_content_hash', p_authorized_content_hash,
    'effective_from', p_plan.effective_from,
    'effective_to', p_plan.effective_to,
    'review_due_on', p_plan.review_due_on,
    'responsible_user_id', p_plan.responsible_user_id,
    'source_system', p_plan.source_system,
    'source_record_id', p_plan.source_record_id,
    'source_provenance', p_plan.source_provenance,
    'goals', p_plan.goals,
    'planned_services', p_plan.planned_services,
    'reason', p_reason
  );
$$;

create or replace function private.client_service_plan_payload_hash(
  p_plan public.client_service_plans,
  p_authorized_content_hash text,
  p_reason text
) returns text language sql immutable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(private.client_service_plan_payload_json(
    p_plan, p_authorized_content_hash, p_reason
  )::text, 'UTF8')), 'hex');
$$;

-- Preserve the core invariant for ordinary versions, while allowing a safe
-- terminal void after the linked authorization has been superseded or voided.
-- A void may only freeze the previous service-plan content/source and never
-- makes that plan executable again.
create or replace function private.validate_client_service_plan_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_previous public.client_service_plans%rowtype;
  v_authorized public.authorized_care_plans%rowtype;
begin
  new.created_at := v_now;
  new.updated_at := v_now;
  if v_actor_user_id is not null and new.created_by <> v_actor_user_id then
    raise exception using errcode = '42501', message = 'service plan creator must be the authenticated user';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'client-service-plan:' || new.organization_id::text || ':' ||
    new.branch_id::text || ':' || new.client_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'authorized-care-plan:' || new.organization_id::text || ':' ||
    new.branch_id::text || ':' || new.client_id::text, 0));

  if new.previous_version_id is null then
    if new.version <> 1 or exists (
      select 1 from public.client_service_plans existing
      where existing.organization_id = new.organization_id
        and existing.plan_key = new.plan_key
    ) then
      raise exception using errcode = '23514', message = 'first service plan version must start a new version-one chain';
    end if;
  else
    select previous.* into strict v_previous
    from public.client_service_plans previous
    where previous.id = new.previous_version_id
      and previous.organization_id = new.organization_id
      and previous.branch_id = new.branch_id
      and previous.client_id = new.client_id
    for share;
    if v_previous.plan_key <> new.plan_key
       or new.version <> v_previous.version + 1
       or v_previous.status = 'voided' then
      raise exception using errcode = '23514', message = 'service plan correction must extend the same non-voided version chain';
    end if;
  end if;

  if new.status = 'voided' then
    if new.previous_version_id is null then
      raise exception using errcode = '23514', message = 'service plan void must extend an existing version';
    end if;
    select authorized.* into strict v_authorized
    from public.authorized_care_plans authorized
    where authorized.id = new.authorized_care_plan_id
      and authorized.organization_id = new.organization_id
      and authorized.branch_id = new.branch_id
      and authorized.client_id = new.client_id
    for share;
    if new.authorized_care_plan_id is distinct from v_previous.authorized_care_plan_id
       or new.effective_from is distinct from v_previous.effective_from
       or new.effective_to is distinct from v_previous.effective_to
       or new.source_system is distinct from v_previous.source_system
       or new.source_record_id is distinct from v_previous.source_record_id
       or new.source_provenance is distinct from v_previous.source_provenance
       or new.authorized_limits_snapshot is distinct from v_previous.authorized_limits_snapshot
       or new.goals is distinct from v_previous.goals
       or new.planned_services is distinct from v_previous.planned_services
       or new.responsible_user_id is distinct from v_previous.responsible_user_id
       or new.review_due_on is distinct from v_previous.review_due_on then
      raise exception using errcode = '23514', message = 'service plan void must freeze the previous content and source';
    end if;
  else
    select authorized.* into strict v_authorized
    from public.authorized_care_plans authorized
    where authorized.id = new.authorized_care_plan_id
      and authorized.organization_id = new.organization_id
      and authorized.branch_id = new.branch_id
      and authorized.client_id = new.client_id
      and authorized.status = 'signed'
      and authorized.effective_from <= new.effective_from
      and authorized.effective_to >= new.effective_to
      and not exists (
        select 1 from public.authorized_care_plans later
        where later.organization_id = authorized.organization_id
          and later.plan_key = authorized.plan_key
          and later.version > authorized.version
          and later.status in ('signed','voided')
          and daterange(later.effective_from, later.effective_to, '[]')
              && daterange(new.effective_from, new.effective_to, '[]')
      )
    for share;
  end if;

  if new.authorized_limits_snapshot <> v_authorized.service_limits then
    raise exception using errcode = '23514',
      message = 'client service plan authorization limit snapshot must match the signed authorized plan';
  end if;
  if new.status in ('approved','signed','voided')
     and not private.reauth_challenge_supports_plan_evidence(
       new.approval_reauth_challenge_id, new.approved_by, new.approved_at) then
    raise exception using errcode = '23514', message = 'service plan approval lacks matching fresh AAL2 evidence';
  end if;
  if new.status in ('signed','voided')
     and not private.reauth_challenge_supports_plan_evidence(
       new.signature_reauth_challenge_id, new.signed_by, new.signed_at) then
    raise exception using errcode = '23514', message = 'service plan signature lacks matching fresh AAL2 evidence';
  end if;
  if v_actor_user_id is not null and (
    (new.status = 'approved' and (new.approved_at < v_now - interval '1 minute'
      or new.approved_at > v_now + interval '1 minute'))
    or (new.status = 'voided' and v_previous.approved_by is null
      and (new.approved_at < v_now - interval '1 minute' or new.approved_at > v_now + interval '1 minute'))
    or (new.status in ('signed','voided')
      and (new.signed_at < v_now - interval '1 minute' or new.signed_at > v_now + interval '1 minute'))
  ) then
    raise exception using errcode = '23514', message = 'service plan approval and signature timestamps must use current server time';
  end if;
  if new.status = 'voided' and v_previous.approved_by is not null and (
    new.approved_by is distinct from v_previous.approved_by
    or new.approved_at is distinct from v_previous.approved_at
    or new.approval_evidence_hash is distinct from v_previous.approval_evidence_hash
    or new.approval_reauth_challenge_id is distinct from v_previous.approval_reauth_challenge_id
  ) then
    raise exception using errcode = '23514', message = 'service plan void must preserve existing approval evidence';
  end if;
  -- Approval is a historical event carried into the signature version. Even
  -- when the approver and signer are the same actor, require the complete
  -- prior approval evidence and content to be frozen; only signed_at belongs
  -- to the current sign operation.
  if v_actor_user_id is not null and new.status = 'signed' and (
       new.previous_version_id is null or v_previous.status not in ('approved','signed')
       or v_previous.approved_by is distinct from new.approved_by
       or v_previous.approved_at is distinct from new.approved_at
       or v_previous.approval_evidence_hash is distinct from new.approval_evidence_hash
       or v_previous.approval_reauth_challenge_id is distinct from new.approval_reauth_challenge_id
       or v_previous.authorized_care_plan_id is distinct from new.authorized_care_plan_id
       or v_previous.effective_from is distinct from new.effective_from
       or v_previous.effective_to is distinct from new.effective_to
       or v_previous.source_system is distinct from new.source_system
       or v_previous.source_record_id is distinct from new.source_record_id
       or v_previous.source_provenance is distinct from new.source_provenance
       or v_previous.authorized_limits_snapshot is distinct from new.authorized_limits_snapshot
       or v_previous.goals is distinct from new.goals
       or v_previous.planned_services is distinct from new.planned_services
       or v_previous.responsible_user_id is distinct from new.responsible_user_id
       or v_previous.review_due_on is distinct from new.review_due_on
     ) then
    raise exception using errcode = '42501', message = 'signature may only carry unchanged approved content and evidence from the previous version';
  end if;
  if new.status = 'signed' and exists (
    select 1 from public.client_service_plans existing
    where existing.organization_id = new.organization_id
      and existing.branch_id = new.branch_id and existing.client_id = new.client_id
      and existing.plan_key <> new.plan_key and existing.status = 'signed'
      and daterange(existing.effective_from, existing.effective_to, '[]')
          && daterange(new.effective_from, new.effective_to, '[]')
      and not exists (
        select 1 from public.client_service_plans terminal
        where terminal.organization_id = existing.organization_id
          and terminal.plan_key = existing.plan_key and terminal.version > existing.version
          and terminal.status in ('signed','voided')
          and daterange(terminal.effective_from, terminal.effective_to, '[]')
              @> daterange(new.effective_from, new.effective_to, '[]')
      )
  ) then
    raise exception using errcode = '23P01', message = 'client service plan effective period overlaps another active plan stream';
  end if;
  return new;
exception when no_data_found then
  raise exception using errcode = '23503', message = 'referenced care plan version does not exist or is not effective in scope';
end;
$$;

create or replace function private.mutate_client_service_plan_workflow_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_client_id uuid,
  p_plan_key uuid,
  p_expected_terminal_id uuid,
  p_expected_terminal_version integer,
  p_expected_terminal_payload_hash text,
  p_expected_authorized_care_plan_id uuid,
  p_expected_authorized_content_hash text,
  p_effective_from date,
  p_effective_to date,
  p_review_due_on date,
  p_responsible_user_id uuid,
  p_goals jsonb,
  p_planned_services jsonb,
  p_reason text,
  p_idempotency_key uuid
) returns table(
  operation_id uuid,
  action text,
  plan_id uuid,
  plan_key uuid,
  version integer,
  previous_version_id uuid,
  status public.care_plan_version_status,
  client_id uuid,
  authorized_care_plan_id uuid,
  authorized_content_hash text,
  previous_payload_hash text,
  payload_hash text,
  persisted_payload jsonb,
  committed_at timestamptz,
  replayed boolean,
  legal_rule_status text,
  claim_eligibility_status text
) language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_request_hash text;
  v_challenge_id uuid;
  v_operation private.client_service_plan_operations%rowtype;
  v_previous public.client_service_plans%rowtype;
  v_result public.client_service_plans%rowtype;
  v_authorized public.authorized_care_plans%rowtype;
  v_previous_authorized public.authorized_care_plans%rowtype;
  v_previous_reason text;
  v_previous_hash text;
  v_version integer;
  v_status public.care_plan_version_status;
  v_goals jsonb;
  v_services jsonb;
  v_effective_from date;
  v_effective_to date;
  v_review_due_on date;
  v_responsible_user_id uuid;
  v_source_system text;
  v_source_record_id text;
  v_source_provenance jsonb;
  v_approved_by uuid;
  v_approved_at timestamptz;
  v_approval_evidence_hash text;
  v_approval_challenge_id uuid;
  v_signed_by uuid;
  v_signed_at timestamptz;
  v_signature_purpose text;
  v_signature_challenge_id uuid;
  v_payload jsonb;
  v_payload_hash text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_action not in ('create_draft','revise_draft','approve','sign','void')
     or p_client_id is null or p_plan_key is null or p_idempotency_key is null
     or p_expected_authorized_care_plan_id is null
     or coalesce(p_expected_authorized_content_hash,'') !~ '^[a-f0-9]{64}$'
     or p_expected_terminal_version is null or p_expected_terminal_version < 0
     or p_reason is null or p_reason <> btrim(p_reason)
     or char_length(p_reason) not between 8 and 1000
     or translate(p_reason, E'\n\r\t', '') ~ '[[:cntrl:]]'
     or (p_action = 'create_draft' and (p_expected_terminal_id is not null
       or p_expected_terminal_version <> 0 or p_expected_terminal_payload_hash is not null))
     or (p_action <> 'create_draft' and (p_expected_terminal_id is null
       or p_expected_terminal_version < 1
       or coalesce(p_expected_terminal_payload_hash,'') !~ '^[a-f0-9]{64}$'))
     or (p_action in ('create_draft','revise_draft') and (
       p_effective_from is null or p_effective_to is null or p_review_due_on is null
       or p_effective_to < p_effective_from
       or p_review_due_on not between p_effective_from and p_effective_to
       or p_responsible_user_id is null
       or not private.client_service_plan_goals_valid(p_goals)
       or not private.client_service_plan_measures_valid(p_planned_services, p_goals, false)))
     or (p_action in ('approve','sign','void') and (
       p_effective_from is not null or p_effective_to is not null or p_review_due_on is not null
       or p_responsible_user_id is not null or p_goals is not null or p_planned_services is not null)) then
    raise exception using errcode = '22023', message = 'client service plan operation parameters are invalid';
  end if;

  if not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.read')
     or not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.write')
     or (p_action = 'approve' and not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.approve'))
     or (p_action = 'sign' and not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.sign'))
     or (p_action = 'void' and (not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.approve')
      or not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.sign'))) then
    raise exception using errcode = '42501', message = 'client service plan operation is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'action', p_action, 'client_id', p_client_id,
    'plan_key', p_plan_key, 'expected_terminal_id', p_expected_terminal_id,
    'expected_terminal_version', p_expected_terminal_version,
    'expected_terminal_payload_hash', p_expected_terminal_payload_hash,
    'expected_authorized_care_plan_id', p_expected_authorized_care_plan_id,
    'expected_authorized_content_hash', p_expected_authorized_content_hash,
    'effective_from', p_effective_from, 'effective_to', p_effective_to,
    'review_due_on', p_review_due_on, 'responsible_user_id', p_responsible_user_id,
    'goals', p_goals, 'planned_services', p_planned_services, 'reason', p_reason
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'client-service-plan-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select operation.* into v_operation
  from private.client_service_plan_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key
  for share;
  if found then
    if v_operation.organization_id <> p_expected_organization_id
       or v_operation.branch_id <> p_expected_branch_id
       or v_operation.client_id <> p_client_id
       or v_operation.action <> p_action
       or v_operation.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'client service plan idempotency conflict';
    end if;
    if not private.client_service_plan_workflow_client_authority(
        p_expected_organization_id, p_expected_branch_id, p_client_id,
        case when p_action = 'approve' then 'care_plans.approve'
          when p_action in ('sign','void') then 'care_plans.sign' else 'care_plans.write' end,
        p_action <> 'void') then
      raise exception using errcode = '42501', message = 'client service plan authority expired';
    end if;
    if p_action in ('approve','sign','void') then
      v_challenge_id := private.require_client_service_plan_workflow_reauth(v_actor, v_now);
    end if;
    return query select v_operation.id, v_operation.action, v_operation.result_plan_id,
      v_operation.result_plan_key, v_operation.result_version,
      v_operation.result_previous_version_id, v_operation.result_status,
      v_operation.client_id, v_operation.result_authorized_care_plan_id,
      v_operation.result_authorized_content_hash, v_operation.result_previous_payload_hash,
      v_operation.result_payload_hash, v_operation.result_payload,
      v_operation.result_committed_at, true, 'not_configured'::text,
      'blocked_not_configured'::text;
    return;
  end if;

  if not private.client_service_plan_workflow_client_authority(
      p_expected_organization_id, p_expected_branch_id, p_client_id,
      case when p_action = 'approve' then 'care_plans.approve'
        when p_action in ('sign','void') then 'care_plans.sign' else 'care_plans.write' end,
      p_action <> 'void') then
    raise exception using errcode = '42501', message = 'client service plan client is outside assigned scope';
  end if;
  if p_action in ('approve','sign','void') then
    v_challenge_id := private.require_client_service_plan_workflow_reauth(v_actor, v_now);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'client-service-plan:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_client_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'authorized-care-plan:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text || ':' || p_client_id::text, 0));

  select plan.* into v_previous
  from public.client_service_plans plan
  where plan.organization_id = p_expected_organization_id
    and plan.branch_id = p_expected_branch_id and plan.client_id = p_client_id
    and plan.plan_key = p_plan_key
    and not exists (select 1 from public.client_service_plans child
      where child.previous_version_id = plan.id)
  for share;
  if p_action = 'create_draft' then
    if found then
      raise exception using errcode = '23505', message = 'client service plan stream already exists';
    end if;
  else
    if not found or v_previous.id <> p_expected_terminal_id
       or v_previous.version <> p_expected_terminal_version or v_previous.status = 'voided' then
      raise exception using errcode = '40001', message = 'client service plan terminal version changed';
    end if;
    select operation.result_reason into v_previous_reason
    from private.client_service_plan_operations operation
    where operation.result_plan_id = v_previous.id
    order by operation.created_at desc, operation.id desc limit 1;
    if v_previous_reason is null then v_previous_reason := v_previous.correction_reason; end if;
    select authorized.* into strict v_previous_authorized
    from public.authorized_care_plans authorized
    where authorized.id = v_previous.authorized_care_plan_id
      and authorized.organization_id = p_expected_organization_id
      and authorized.branch_id = p_expected_branch_id
      and authorized.client_id = p_client_id for share;
    v_previous_hash := private.client_service_plan_payload_hash(
      v_previous, v_previous_authorized.content_hash, v_previous_reason);
    if v_previous_hash <> p_expected_terminal_payload_hash then
      raise exception using errcode = '40001', message = 'client service plan payload changed';
    end if;
  end if;

  if p_action = 'void' then
    if p_expected_authorized_care_plan_id <> v_previous.authorized_care_plan_id
       or p_expected_authorized_content_hash <> v_previous_authorized.content_hash then
      raise exception using errcode = '40001', message = 'client service plan authorization source changed';
    end if;
    v_authorized := v_previous_authorized;
  else
    select authorized.* into strict v_authorized
    from public.authorized_care_plans authorized
    where authorized.id = p_expected_authorized_care_plan_id
      and authorized.organization_id = p_expected_organization_id
      and authorized.branch_id = p_expected_branch_id and authorized.client_id = p_client_id
      and authorized.status = 'signed'
      and authorized.content_hash = p_expected_authorized_content_hash
      and authorized.effective_from <= coalesce(p_effective_from, v_previous.effective_from)
      and authorized.effective_to >= coalesce(p_effective_to, v_previous.effective_to)
      and not exists (select 1 from public.authorized_care_plans later
        where later.organization_id = authorized.organization_id
          and later.plan_key = authorized.plan_key and later.version > authorized.version
          and later.status in ('signed','voided')
          and daterange(later.effective_from, later.effective_to, '[]') && daterange(
            coalesce(p_effective_from, v_previous.effective_from),
            coalesce(p_effective_to, v_previous.effective_to), '[]'))
    for share;
    if p_action in ('approve','sign')
       and v_previous.authorized_care_plan_id <> v_authorized.id then
      raise exception using errcode = '40001', message = 'approved content cannot switch authorization source';
    end if;
    if exists (
      select 1 from (
        select distinct on (candidate.plan_key) candidate.id, candidate.plan_key,
          candidate.status, candidate.effective_from, candidate.effective_to
        from public.authorized_care_plans candidate
        where candidate.organization_id = p_expected_organization_id
          and candidate.branch_id = p_expected_branch_id and candidate.client_id = p_client_id
          and candidate.status in ('signed','voided')
        order by candidate.plan_key, candidate.version desc, candidate.created_at desc, candidate.id desc
      ) terminal
      where terminal.status = 'signed' and terminal.id <> v_authorized.id
        and daterange(terminal.effective_from, terminal.effective_to, '[]') && daterange(
          coalesce(p_effective_from, v_previous.effective_from),
          coalesce(p_effective_to, v_previous.effective_to), '[]')
    ) then
      raise exception using errcode = '23514', message = 'multiple current signed authorization streams overlap the service plan';
    end if;
  end if;

  if p_action in ('create_draft','revise_draft') then
    v_goals := p_goals;
    select jsonb_agg(item || jsonb_build_object(
      'responsible_display_name', profile.display_name,
      'qualification_status', 'active_membership_only') order by (item ->> 'item_order')::integer)
    into v_services
    from jsonb_array_elements(p_planned_services) item
    join public.profiles profile on profile.id = (item ->> 'responsible_user_id')::uuid;
    if not private.client_service_plan_active_responsible(
        p_expected_organization_id, p_expected_branch_id, p_responsible_user_id)
       or exists (select 1 from jsonb_array_elements(p_planned_services) item
         where not private.client_service_plan_active_responsible(
           p_expected_organization_id, p_expected_branch_id,
           (item ->> 'responsible_user_id')::uuid))
       or not private.client_service_plan_content_is_mapped(v_goals, v_services) then
      raise exception using errcode = '42501', message = 'responsible person membership or qualification is inactive';
    end if;
    v_effective_from := p_effective_from; v_effective_to := p_effective_to;
    v_review_due_on := p_review_due_on; v_responsible_user_id := p_responsible_user_id;
    v_source_system := 'local'; v_source_record_id := null;
    v_source_provenance := jsonb_build_object(
      'schema_version', 1, 'source_system', 'local', 'capture_method', 'staff_entry',
      'authority', 'facility', 'workflow', 'page52_client_service_plan_v1',
      'legal_rule_status', 'not_configured',
      'claim_eligibility_status', 'blocked_not_configured');
  else
    if p_action <> 'void' and (
      not private.client_service_plan_active_responsible(
        p_expected_organization_id, p_expected_branch_id, v_previous.responsible_user_id)
      or exists (select 1 from jsonb_array_elements(v_previous.planned_services) item
        where coalesce(item ->> 'responsible_user_id','') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or not private.client_service_plan_active_responsible(
            p_expected_organization_id, p_expected_branch_id,
            (item ->> 'responsible_user_id')::uuid))
      or not private.client_service_plan_content_is_mapped(
        v_previous.goals, v_previous.planned_services)) then
      raise exception using errcode = '42501', message = 'responsible person membership or content mapping is inactive';
    end if;
    v_goals := v_previous.goals; v_services := v_previous.planned_services;
    v_effective_from := v_previous.effective_from; v_effective_to := v_previous.effective_to;
    v_review_due_on := v_previous.review_due_on;
    v_responsible_user_id := v_previous.responsible_user_id;
    v_source_system := v_previous.source_system; v_source_record_id := v_previous.source_record_id;
    v_source_provenance := v_previous.source_provenance;
  end if;

  v_version := case when p_action = 'create_draft' then 1 else v_previous.version + 1 end;
  v_status := case p_action when 'approve' then 'approved'::public.care_plan_version_status
    when 'sign' then 'signed'::public.care_plan_version_status
    when 'void' then 'voided'::public.care_plan_version_status
    else 'draft'::public.care_plan_version_status end;
  if p_action = 'approve' and v_previous.status <> 'draft' then
    raise exception using errcode = '23514', message = 'only the terminal draft can be approved';
  elsif p_action = 'sign' and v_previous.status <> 'approved' then
    raise exception using errcode = '23514', message = 'only the terminal approved version can be signed';
  end if;

  v_result.id := gen_random_uuid(); v_result.organization_id := p_expected_organization_id;
  v_result.branch_id := p_expected_branch_id; v_result.client_id := p_client_id;
  v_result.authorized_care_plan_id := v_authorized.id; v_result.plan_key := p_plan_key;
  v_result.version := v_version;
  v_result.previous_version_id := case when p_action = 'create_draft' then null else v_previous.id end;
  v_result.status := v_status; v_result.effective_from := v_effective_from;
  v_result.effective_to := v_effective_to; v_result.source_system := v_source_system;
  v_result.source_record_id := v_source_record_id; v_result.source_provenance := v_source_provenance;
  v_result.authorized_limits_snapshot := v_authorized.service_limits;
  v_result.goals := v_goals; v_result.planned_services := v_services;
  v_result.responsible_user_id := v_responsible_user_id; v_result.review_due_on := v_review_due_on;
  v_result.correction_reason := case when v_version = 1 then null else p_reason end;
  v_result.idempotency_key := p_idempotency_key; v_result.created_by := v_actor;
  v_payload := private.client_service_plan_payload_json(
    v_result, v_authorized.content_hash, p_reason);
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  if p_action = 'approve' then
    v_approved_by := v_actor; v_approved_at := v_now; v_approval_challenge_id := v_challenge_id;
    v_approval_evidence_hash := encode(sha256(convert_to(jsonb_build_object(
      'purpose','client_service_plan_approval','plan_key',p_plan_key,'version',v_version,
      'payload_hash',v_payload_hash,'actor',v_actor,'challenge_id',v_challenge_id,
      'approved_at',v_now)::text,'UTF8')),'hex');
  elsif p_action = 'sign' then
    v_approved_by := v_previous.approved_by; v_approved_at := v_previous.approved_at;
    v_approval_evidence_hash := v_previous.approval_evidence_hash;
    v_approval_challenge_id := v_previous.approval_reauth_challenge_id;
    v_signed_by := v_actor; v_signed_at := v_now;
    v_signature_purpose := '個案服務計畫簽署'; v_signature_challenge_id := v_challenge_id;
  elsif p_action = 'void' then
    if v_previous.approved_by is null then
      v_approved_by := v_actor; v_approved_at := v_now; v_approval_challenge_id := v_challenge_id;
      v_approval_evidence_hash := encode(sha256(convert_to(jsonb_build_object(
        'purpose','client_service_plan_void_approval','plan_key',p_plan_key,'version',v_version,
        'payload_hash',v_payload_hash,'actor',v_actor,'challenge_id',v_challenge_id,
        'approved_at',v_now)::text,'UTF8')),'hex');
    else
      v_approved_by := v_previous.approved_by; v_approved_at := v_previous.approved_at;
      v_approval_evidence_hash := v_previous.approval_evidence_hash;
      v_approval_challenge_id := v_previous.approval_reauth_challenge_id;
    end if;
    v_signed_by := v_actor; v_signed_at := v_now;
    v_signature_purpose := '個案服務計畫作廢'; v_signature_challenge_id := v_challenge_id;
  end if;

  insert into public.client_service_plans (
    id, organization_id, branch_id, client_id, authorized_care_plan_id, plan_key,
    version, previous_version_id, status, effective_from, effective_to, source_system,
    source_record_id, source_provenance, authorized_limits_snapshot, goals,
    planned_services, responsible_user_id, review_due_on, correction_reason,
    idempotency_key, created_by, approved_by, approved_at, approval_evidence_hash,
    approval_reauth_challenge_id, signed_by, signed_at, signature_purpose,
    signature_reauth_challenge_id, content_hash
  ) values (
    v_result.id, v_result.organization_id, v_result.branch_id, v_result.client_id,
    v_result.authorized_care_plan_id, v_result.plan_key, v_result.version,
    v_result.previous_version_id, v_result.status, v_result.effective_from,
    v_result.effective_to, v_result.source_system, v_result.source_record_id,
    v_result.source_provenance, v_result.authorized_limits_snapshot, v_result.goals,
    v_result.planned_services, v_result.responsible_user_id, v_result.review_due_on,
    v_result.correction_reason, v_result.idempotency_key, v_result.created_by,
    v_approved_by, v_approved_at, v_approval_evidence_hash, v_approval_challenge_id,
    v_signed_by, v_signed_at, v_signature_purpose, v_signature_challenge_id,
    case when v_status in ('signed','voided') then v_payload_hash else null end
  ) returning * into v_result;
  v_payload := private.client_service_plan_payload_json(
    v_result, v_authorized.content_hash, p_reason);
  v_payload_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  insert into private.client_service_plan_operations (
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    request_hash, action, result_plan_id, result_plan_key, result_version,
    result_status, result_previous_version_id, result_authorized_care_plan_id,
    result_authorized_content_hash, result_previous_payload_hash,
    result_payload_hash, result_payload, result_reason, result_committed_at,
    reauth_challenge_id
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_idempotency_key, v_request_hash, p_action, v_result.id, v_result.plan_key,
    v_result.version, v_result.status, v_result.previous_version_id,
    v_result.authorized_care_plan_id, v_authorized.content_hash, v_previous_hash,
    v_payload_hash, v_payload, p_reason, v_result.created_at, v_challenge_id
  ) returning * into v_operation;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    idempotency_key, changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor,
    case when p_action in ('approve','sign','void') then
      case when p_action = 'sign' then 'sign' when p_action = 'void' then 'correct' else 'update' end
      else 'insert' end,
    'client_service_plans', v_result.id::text, p_idempotency_key,
    array['version','status','authorized_care_plan_id','effective_from','effective_to',
      'review_due_on','responsible_user_id','goals','planned_services'],
    jsonb_build_object('workflow','page52_client_service_plan_v1',
      'client_id',p_client_id,'plan_key',p_plan_key,'version',v_result.version,
      'status',v_result.status,'authorized_care_plan_id',v_authorized.id,
      'legal_rule_status','not_configured','claim_eligibility_status','blocked_not_configured',
      'narrative_logged',false)
  );

  if not private.client_service_plan_workflow_client_authority(
      p_expected_organization_id, p_expected_branch_id, p_client_id,
      case when p_action = 'approve' then 'care_plans.approve'
        when p_action in ('sign','void') then 'care_plans.sign' else 'care_plans.write' end,
      p_action <> 'void')
     or not exists (select 1 from public.client_service_plans plan
       where plan.id = v_result.id and not exists (
         select 1 from public.client_service_plans child where child.previous_version_id = plan.id)) then
    raise exception using errcode = '42501', message = 'client service plan final verification failed';
  end if;
  return query select v_operation.id, v_operation.action, v_result.id,
    v_result.plan_key, v_result.version, v_result.previous_version_id,
    v_result.status, v_result.client_id, v_result.authorized_care_plan_id,
    v_authorized.content_hash, v_previous_hash, v_payload_hash, v_payload,
    v_result.created_at, false, 'not_configured'::text, 'blocked_not_configured'::text;
end;
$$;

create or replace function public.mutate_client_service_plan_workflow(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_client_id uuid,
  p_plan_key uuid,
  p_expected_terminal_id uuid,
  p_expected_terminal_version integer,
  p_expected_terminal_payload_hash text,
  p_expected_authorized_care_plan_id uuid,
  p_expected_authorized_content_hash text,
  p_effective_from date,
  p_effective_to date,
  p_review_due_on date,
  p_responsible_user_id uuid,
  p_goals jsonb,
  p_planned_services jsonb,
  p_reason text,
  p_idempotency_key uuid
) returns table(
  operation_id uuid, action text, plan_id uuid, plan_key uuid, version integer,
  previous_version_id uuid, status public.care_plan_version_status, client_id uuid,
  authorized_care_plan_id uuid, authorized_content_hash text,
  previous_payload_hash text, payload_hash text, persisted_payload jsonb,
  committed_at timestamptz, replayed boolean, legal_rule_status text,
  claim_eligibility_status text
) language sql volatile security invoker set search_path = '' as $$
  select * from private.mutate_client_service_plan_workflow_guarded(
    p_expected_organization_id, p_expected_branch_id, p_action, p_client_id,
    p_plan_key, p_expected_terminal_id, p_expected_terminal_version,
    p_expected_terminal_payload_hash, p_expected_authorized_care_plan_id,
    p_expected_authorized_content_hash, p_effective_from, p_effective_to,
    p_review_due_on, p_responsible_user_id, p_goals, p_planned_services,
    p_reason, p_idempotency_key
  );
$$;

create or replace function private.client_service_plan_workflow_version_json(
  p_plan public.client_service_plans,
  p_as_of date,
  p_reason text
) returns jsonb language sql stable security definer set search_path = '' as $$
  with linked as (
    select authorized.* from public.authorized_care_plans authorized
    where authorized.id = p_plan.authorized_care_plan_id
      and authorized.organization_id = p_plan.organization_id
      and authorized.branch_id = p_plan.branch_id
      and authorized.client_id = p_plan.client_id
  ), authorization_terminal as (
    select candidate.id, candidate.status
    from public.authorized_care_plans candidate
    join linked on linked.plan_key = candidate.plan_key
    where candidate.organization_id = p_plan.organization_id
      and candidate.branch_id = p_plan.branch_id and candidate.client_id = p_plan.client_id
      and candidate.status in ('signed','voided')
      and daterange(candidate.effective_from, candidate.effective_to, '[]')
          && daterange(p_plan.effective_from, p_plan.effective_to, '[]')
    order by candidate.version desc, candidate.created_at desc, candidate.id desc limit 1
  ), plan_published_at_date as (
    select candidate.id, candidate.status
    from public.client_service_plans candidate
    where candidate.organization_id = p_plan.organization_id
      and candidate.branch_id = p_plan.branch_id and candidate.client_id = p_plan.client_id
      and candidate.plan_key = p_plan.plan_key and candidate.status in ('signed','voided')
      and p_as_of between candidate.effective_from and candidate.effective_to
    order by candidate.version desc, candidate.created_at desc, candidate.id desc limit 1
  ), authorization_published_at_date as (
    select candidate.id, candidate.status
    from public.authorized_care_plans candidate
    join linked on linked.plan_key = candidate.plan_key
    where candidate.organization_id = p_plan.organization_id
      and candidate.branch_id = p_plan.branch_id and candidate.client_id = p_plan.client_id
      and candidate.status in ('signed','voided')
      and p_as_of between candidate.effective_from and candidate.effective_to
    order by candidate.version desc, candidate.created_at desc, candidate.id desc limit 1
  ), active_authorization_streams as (
    select count(*)::integer as count from (
      select distinct on (candidate.plan_key) candidate.status
      from public.authorized_care_plans candidate
      where candidate.organization_id = p_plan.organization_id
        and candidate.branch_id = p_plan.branch_id and candidate.client_id = p_plan.client_id
        and candidate.status in ('signed','voided')
        and p_as_of between candidate.effective_from and candidate.effective_to
      order by candidate.plan_key, candidate.version desc, candidate.created_at desc, candidate.id desc
    ) terminal where terminal.status = 'signed'
  ), values as (
    select linked.*,
      case when linked.effective_from > p_plan.effective_from
          or linked.effective_to < p_plan.effective_to then 'period_mismatch'
        when authorization_terminal.status = 'voided' then 'voided'
        when authorization_terminal.id <> linked.id then 'outdated'
        else 'current' end as authorization_status,
      case when p_plan.status = 'signed'
          and p_as_of between p_plan.effective_from and p_plan.effective_to
          and plan_published_at_date.id = p_plan.id and plan_published_at_date.status = 'signed'
          and authorization_published_at_date.id = linked.id
          and authorization_published_at_date.status = 'signed'
          and active_authorization_streams.count = 1
        then 'signed_current' else 'not_executable' end as operational_status
    from linked left join authorization_terminal on true
    left join plan_published_at_date on true
    left join authorization_published_at_date on true
    cross join active_authorization_streams
  )
  select jsonb_build_object(
    'schema_version', 1, 'plan_id', p_plan.id, 'plan_key', p_plan.plan_key,
    'version', p_plan.version, 'previous_version_id', p_plan.previous_version_id,
    'status', p_plan.status,
    'payload_hash', private.client_service_plan_payload_hash(p_plan, values.content_hash, p_reason),
    'client_id', p_plan.client_id, 'authorized_care_plan_id', p_plan.authorized_care_plan_id,
    'authorized_content_hash', values.content_hash, 'authorized_plan_key', values.plan_key,
    'authorized_version', values.version, 'authorized_source_system', values.source_system,
    'authorized_source_record_id', values.source_record_id,
    'authorization_status', values.authorization_status,
    'operational_status', values.operational_status,
    'effective_from', p_plan.effective_from, 'effective_to', p_plan.effective_to,
    'review_due_on', p_plan.review_due_on, 'responsible_user_id', p_plan.responsible_user_id,
    'responsible_display_name', responsible.display_name,
    'source_system', p_plan.source_system, 'source_record_id', p_plan.source_record_id,
    'source_provenance', p_plan.source_provenance, 'goals', p_plan.goals,
    'planned_services', p_plan.planned_services,
    'content_mapping_status', case when private.client_service_plan_content_is_mapped(
      p_plan.goals, p_plan.planned_services) then 'configured' else 'needs_mapping' end,
    'unmapped_content', case when private.client_service_plan_content_is_mapped(
      p_plan.goals, p_plan.planned_services) then null else jsonb_build_object(
        'goals', p_plan.goals, 'planned_services', p_plan.planned_services) end,
    'reason', p_reason, 'created_by', p_plan.created_by,
    'created_by_display_name', coalesce(creator.display_name, '已停用人員'),
    'created_at', p_plan.created_at, 'approved_by', p_plan.approved_by,
    'approved_by_display_name', approver.display_name, 'approved_at', p_plan.approved_at,
    'signed_by', p_plan.signed_by, 'signed_by_display_name', signer.display_name,
    'signed_at', p_plan.signed_at, 'signature_purpose', p_plan.signature_purpose,
    'reauth_challenge_id', coalesce(
      p_plan.signature_reauth_challenge_id, p_plan.approval_reauth_challenge_id)
  ) from values
  left join public.profiles responsible on responsible.id = p_plan.responsible_user_id
  left join public.profiles creator on creator.id = p_plan.created_by
  left join public.profiles approver on approver.id = p_plan.approved_by
  left join public.profiles signer on signer.id = p_plan.signed_by;
$$;

create or replace function private.client_service_plan_workflow_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_status text default null,
  p_as_of date default ((now() at time zone 'Asia/Taipei')::date),
  p_query text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz, as_of date,
  plans jsonb, matching_total bigint, plans_truncated boolean,
  history_returned_total bigint, history_maximum integer, history_truncated boolean,
  plan_total bigint, draft_total bigint, approved_total bigint, signed_total bigint,
  voided_total bigint, review_due_total bigint, needs_mapping_total bigint,
  outdated_authorization_total bigint, executable_total bigint,
  clients jsonb, client_total bigint, clients_truncated boolean,
  staff jsonb, staff_total bigint, staff_truncated boolean,
  authorizations jsonb, authorization_total bigint, authorizations_truncated boolean,
  official_qualification_rule_status text, legal_rule_status text,
  claim_eligibility_status text, claim_eligibility_reason text,
  offline_status text, export_status text
) language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if p_as_of is null
     or p_status is not null and p_status not in (
       'draft','approved','signed','voided','needs_mapping','authorization_outdated','review_due')
     or p_query is not null and (p_query <> btrim(p_query)
       or char_length(p_query) not between 1 and 120 or p_query ~ '[[:cntrl:]]')
     or not private.client_service_plan_workflow_current_authority(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.read')
     or p_client_id is not null and not private.client_service_plan_workflow_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id, 'care_plans.read', false) then
    raise exception using errcode = '42501', message = 'client service plan snapshot is not permitted';
  end if;

  return query
  with workflow_heads as materialized (
    select plan.*, client.display_name as client_display_name,
      client.client_code as client_code,
      coalesce(operation.result_reason, plan.correction_reason) as workflow_reason,
      private.client_service_plan_workflow_version_json(
        plan, p_as_of, coalesce(operation.result_reason, plan.correction_reason)) as plan_json,
      published.id as published_plan_id, published.version as published_version,
      published.status as published_status, published.plan_json as published_plan_json
    from public.client_service_plans plan
    join public.clients client on client.id = plan.client_id
      and client.organization_id = plan.organization_id and client.branch_id = plan.branch_id
    left join lateral (
      select item.result_reason from private.client_service_plan_operations item
      where item.result_plan_id = plan.id order by item.created_at desc, item.id desc limit 1
    ) operation on true
    left join lateral (
      select candidate.id, candidate.version, candidate.status,
        private.client_service_plan_workflow_version_json(candidate, p_as_of,
          coalesce(candidate_operation.result_reason, candidate.correction_reason)) as plan_json
      from public.client_service_plans candidate
      left join lateral (
        select item.result_reason from private.client_service_plan_operations item
        where item.result_plan_id = candidate.id
        order by item.created_at desc, item.id desc limit 1
      ) candidate_operation on true
      where candidate.organization_id = plan.organization_id
        and candidate.branch_id = plan.branch_id and candidate.client_id = plan.client_id
        and candidate.plan_key = plan.plan_key and candidate.status in ('signed','voided')
        and p_as_of between candidate.effective_from and candidate.effective_to
      order by candidate.version desc, candidate.created_at desc, candidate.id desc limit 1
    ) published on true
    where plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id
      and private.can_staff_access_client(plan.client_id, 'clients.read')
      and private.can_staff_access_client(plan.client_id, 'care_plans.read')
      and not exists (select 1 from public.client_service_plans child
        where child.previous_version_id = plan.id)
  ), enriched as materialized (
    select head.*, head.plan_json ->> 'content_mapping_status' as mapping_status,
      head.plan_json ->> 'authorization_status' as authorization_status,
      coalesce(head.published_plan_json ->> 'operational_status',
        'not_executable') as stream_operational_status
    from workflow_heads head
  ), matching as materialized (
    select head.* from enriched head
    where (p_client_id is null or head.client_id = p_client_id)
      and (p_status is null or head.status::text = p_status
        or (p_status = 'needs_mapping' and head.mapping_status = 'needs_mapping')
        or (p_status = 'authorization_outdated' and head.authorization_status <> 'current')
        or (p_status = 'review_due' and head.status <> 'voided'
          and head.review_due_on <= p_as_of))
      and (p_query is null or head.client_display_name ilike '%' || p_query || '%'
        or head.client_code ilike '%' || p_query || '%'
        or head.plan_key::text ilike '%' || p_query || '%')
  ), page as materialized (
    select head.* from matching head
    order by head.review_due_on, head.client_display_name, head.plan_key limit 100
  ), client_options as materialized (
    select client.id, client.display_name, client.client_code, client.status
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'care_plans.read')
    order by client.display_name, client.id limit 200
  ), staff_options as materialized (
    select distinct profile.id, profile.display_name
    from public.profiles profile join public.memberships membership
      on membership.profile_id = profile.id
    where profile.is_active and profile.kind in ('staff','professional')
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active' and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
    order by profile.display_name, profile.id limit 200
  ), authorization_candidates as materialized (
    select authorized.* from public.authorized_care_plans authorized
    where authorized.organization_id = p_expected_organization_id
      and authorized.branch_id = p_expected_branch_id and authorized.status = 'signed'
      and authorized.content_hash is not null
      and p_as_of between authorized.effective_from and authorized.effective_to
      and private.can_staff_access_client(authorized.client_id, 'clients.read')
      and private.can_staff_access_client(authorized.client_id, 'care_plans.read')
      and not exists (select 1 from public.authorized_care_plans later
        where later.organization_id = authorized.organization_id
          and later.plan_key = authorized.plan_key and later.version > authorized.version
          and later.status in ('signed','voided')
          and p_as_of between later.effective_from and later.effective_to)
  ), authorization_options as materialized (
    select candidate.* from authorization_candidates candidate
    order by candidate.effective_from desc, candidate.client_id, candidate.plan_key limit 200
  )
  select p_expected_organization_id, p_expected_branch_id, v_now, p_as_of,
    coalesce((select jsonb_agg(head.plan_json || jsonb_build_object(
      'client_display_name', head.client_display_name, 'client_code', head.client_code,
      'published_plan_id', head.published_plan_id,
      'published_version', head.published_version,
      'published_payload_hash', head.published_plan_json ->> 'payload_hash',
      'published_status', head.published_status,
      'stream_operational_status', head.stream_operational_status,
      'history', coalesce((select jsonb_agg(
        private.client_service_plan_workflow_version_json(
          history, p_as_of, coalesce(history_operation.result_reason, history.correction_reason))
        order by history.version)
        from (select item.* from public.client_service_plans item
          where item.organization_id = head.organization_id and item.branch_id = head.branch_id
            and item.client_id = head.client_id and item.plan_key = head.plan_key
          order by item.version desc limit 5) history
        left join lateral (select operation.result_reason
          from private.client_service_plan_operations operation
          where operation.result_plan_id = history.id
          order by operation.created_at desc, operation.id desc limit 1) history_operation on true
      ), '[]'::jsonb),
      'history_total', (select count(*) from public.client_service_plans history
        where history.organization_id = head.organization_id and history.branch_id = head.branch_id
          and history.client_id = head.client_id and history.plan_key = head.plan_key)
    ) order by head.review_due_on, head.client_display_name, head.plan_key) from page head), '[]'::jsonb),
    (select count(*) from matching), (select count(*) from matching) > 100,
    coalesce((select sum(least(history_count, 5)) from (select (select count(*)
      from public.client_service_plans history where history.organization_id = head.organization_id
        and history.branch_id = head.branch_id and history.client_id = head.client_id
        and history.plan_key = head.plan_key) as history_count from page head) counts), 0)::bigint,
    500, exists (select 1 from page head where (select count(*)
      from public.client_service_plans history where history.organization_id = head.organization_id
        and history.branch_id = head.branch_id and history.client_id = head.client_id
        and history.plan_key = head.plan_key) > 5),
    (select count(*) from matching),
    (select count(*) from matching head where head.status = 'draft'),
    (select count(*) from matching head where head.status = 'approved'),
    (select count(*) from matching head where head.status = 'signed'),
    (select count(*) from matching head where head.status = 'voided'),
    (select count(*) from matching head where head.status <> 'voided' and head.review_due_on <= p_as_of),
    (select count(*) from matching head where head.mapping_status = 'needs_mapping'),
    (select count(*) from matching head where head.authorization_status <> 'current'),
    (select count(*) from matching head where head.stream_operational_status = 'signed_current'),
    coalesce((select jsonb_agg(jsonb_build_object('client_id', option.id,
      'display_name', option.display_name, 'client_code', option.client_code,
      'service_status', option.status, 'can_manage', private.can_staff_access_client(
        option.id, 'care_plans.write')) order by option.display_name, option.id)
      from client_options option), '[]'::jsonb),
    (select count(*) from public.clients client where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'care_plans.read')),
    (select count(*) from public.clients client where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'care_plans.read')) > 200,
    coalesce((select jsonb_agg(jsonb_build_object('user_id', option.id,
      'display_name', option.display_name, 'qualification_status', 'active_membership_only')
      order by option.display_name, option.id) from staff_options option), '[]'::jsonb),
    (select count(distinct profile.id) from public.profiles profile join public.memberships membership
      on membership.profile_id = profile.id where profile.is_active
      and profile.kind in ('staff','professional')
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active' and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)),
    (select count(distinct profile.id) from public.profiles profile join public.memberships membership
      on membership.profile_id = profile.id where profile.is_active
      and profile.kind in ('staff','professional')
      and membership.organization_id = p_expected_organization_id
      and (membership.branch_id is null or membership.branch_id = p_expected_branch_id)
      and membership.status = 'active' and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)) > 200,
    coalesce((select jsonb_agg(jsonb_build_object(
      'authorized_care_plan_id', option.id, 'client_id', option.client_id,
      'plan_key', option.plan_key, 'version', option.version, 'content_hash', option.content_hash,
      'effective_from', option.effective_from, 'effective_to', option.effective_to,
      'source_system', option.source_system, 'source_record_id', option.source_record_id,
      'status', 'current') order by option.effective_from desc, option.client_id, option.plan_key)
      from authorization_options option), '[]'::jsonb),
    (select count(*) from authorization_candidates),
    (select count(*) from authorization_candidates) > 200,
    'not_configured', 'not_configured', 'blocked_not_configured',
    'official_service_codes_rates_and_qualification_rules_not_configured',
    'not_configured', 'not_configured';

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'client_service_plans', 'workflow_snapshot', array[]::text[],
    jsonb_build_object('workflow','page52_client_service_plan_snapshot_v1',
      'filters_logged',false,'query_logged',false,'results_logged',false,
      'legal_rule_status','not_configured')
  );
  if not private.client_service_plan_workflow_current_authority(
      p_expected_organization_id, p_expected_branch_id, 'care_plans.read') then
    raise exception using errcode = '42501', message = 'client service plan snapshot authority expired';
  end if;
end;
$$;

create or replace function public.client_service_plan_workflow_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_status text default null,
  p_as_of date default ((now() at time zone 'Asia/Taipei')::date),
  p_query text default null
) returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz, as_of date,
  plans jsonb, matching_total bigint, plans_truncated boolean,
  history_returned_total bigint, history_maximum integer, history_truncated boolean,
  plan_total bigint, draft_total bigint, approved_total bigint, signed_total bigint,
  voided_total bigint, review_due_total bigint, needs_mapping_total bigint,
  outdated_authorization_total bigint, executable_total bigint,
  clients jsonb, client_total bigint, clients_truncated boolean,
  staff jsonb, staff_total bigint, staff_truncated boolean,
  authorizations jsonb, authorization_total bigint, authorizations_truncated boolean,
  official_qualification_rule_status text, legal_rule_status text,
  claim_eligibility_status text, claim_eligibility_reason text,
  offline_status text, export_status text
) language sql volatile security invoker set search_path = '' as $$
  select * from private.client_service_plan_workflow_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_status, p_as_of, p_query
  );
$$;

-- Page-52 records deliberately carry no official service-code, rate, or
-- qualification mapping. They may document delivered care, but must fail
-- claim validation/export until a separately governed legal rule is published.
create or replace function private.claim_batch_has_ineligible_items(
  p_claim_batch_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
    from public.claim_batches batch
    join public.claim_items item on item.claim_batch_id = batch.id
    left join public.service_events event on event.id = item.service_event_id
    left join public.client_service_plans service_plan
      on service_plan.id = event.client_service_plan_id
    left join lateral (
      select case when count(*) = 1 then min(terminal.id::text)::uuid else null end
        as authorized_care_plan_id
      from (
        select distinct on (authorized.plan_key) authorized.id, authorized.status
        from public.authorized_care_plans authorized
        where authorized.organization_id = event.organization_id
          and authorized.branch_id = event.branch_id and authorized.client_id = event.client_id
          and authorized.status in ('signed','voided')
          and (event.started_at at time zone 'Asia/Taipei')::date
              between authorized.effective_from and authorized.effective_to
        order by authorized.plan_key, authorized.version desc,
          authorized.created_at desc, authorized.id desc
      ) terminal where terminal.status = 'signed'
    ) current_authorization on true
    where batch.id = p_claim_batch_id and (
      item.organization_id <> batch.organization_id
      or item.branch_id <> batch.branch_id
      or item.service_date not between batch.claim_period_start and batch.claim_period_end
      or item.units <= 0 or item.units = 'NaN'::numeric or item.units = 'Infinity'::numeric
      or item.amount < 0 or item.amount = 'NaN'::numeric or item.amount = 'Infinity'::numeric
      or item.response_outcome is not null or item.response_code is not null
      or item.response_message is not null or event.id is null
      or event.organization_id <> item.organization_id or event.branch_id <> item.branch_id
      or event.client_id <> item.client_id or event.service_code <> item.service_code
      or (event.started_at at time zone 'Asia/Taipei')::date <> item.service_date
      or event.status <> 'completed' or event.client_service_plan_id is null
      or service_plan.id is null or service_plan.organization_id <> event.organization_id
      or service_plan.branch_id <> event.branch_id or service_plan.client_id <> event.client_id
      or service_plan.status <> 'signed'
      or (event.started_at at time zone 'Asia/Taipei')::date
          not between service_plan.effective_from and service_plan.effective_to
      or service_plan.authorized_care_plan_id
          is distinct from current_authorization.authorized_care_plan_id
      or exists (
        select 1 from public.client_service_plans later_service_plan
        where later_service_plan.organization_id = service_plan.organization_id
          and later_service_plan.plan_key = service_plan.plan_key
          and later_service_plan.version > service_plan.version
          and later_service_plan.status in ('signed','voided')
          and (event.started_at at time zone 'Asia/Taipei')::date
              between later_service_plan.effective_from and later_service_plan.effective_to
      )
      or service_plan.source_provenance ->> 'workflow' = 'page52_client_service_plan_v1'
      or event.signed_at is null or event.signed_by is null or event.content_hash is null
      or event.content_hash is distinct from item.evidence_hash
    )
  );
$$;

-- Cut over Page 52 to the only guarded write boundary. Existing read consumers
-- retain SELECT; neither browser users nor service_role can append versions.
drop policy if exists client_service_plans_insert on public.client_service_plans;
revoke insert on table public.client_service_plans from authenticated, service_role;

revoke all on function private.client_service_plan_operation_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_workflow_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_workflow_client_authority(uuid,uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_active_responsible(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_client_service_plan_workflow_reauth(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_goals_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_measures_valid(jsonb,jsonb,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_content_is_mapped(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_payload_json(public.client_service_plans,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_payload_hash(public.client_service_plans,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.client_service_plan_workflow_version_json(public.client_service_plans,date,text)
  from public, anon, authenticated, service_role;
revoke all on function private.mutate_client_service_plan_workflow_guarded(
  uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)
  from public, anon, service_role;
revoke all on function private.client_service_plan_workflow_snapshot_response(uuid,uuid,uuid,text,date,text)
  from public, anon, service_role;
revoke all on function public.mutate_client_service_plan_workflow(
  uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)
  from public, anon, service_role;
revoke all on function public.client_service_plan_workflow_snapshot(uuid,uuid,uuid,text,date,text)
  from public, anon, service_role;
grant execute on function private.mutate_client_service_plan_workflow_guarded(
  uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)
  to authenticated;
grant execute on function private.client_service_plan_workflow_snapshot_response(uuid,uuid,uuid,text,date,text)
  to authenticated;
grant execute on function public.mutate_client_service_plan_workflow(
  uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid)
  to authenticated;
grant execute on function public.client_service_plan_workflow_snapshot(uuid,uuid,uuid,text,date,text)
  to authenticated;

comment on function public.mutate_client_service_plan_workflow(
  uuid,uuid,text,uuid,uuid,uuid,integer,text,uuid,text,date,date,date,uuid,jsonb,jsonb,text,uuid) is
  'Page 52 guarded append-only draft/revise/approve/sign/void workflow. Signature evidence is server-derived; official claim rules remain unconfigured.';
comment on function public.client_service_plan_workflow_snapshot(uuid,uuid,uuid,text,date,text) is
  'Page 52 assigned-client snapshot: at most 100 heads and five history versions per head (500 total), with full goal/measure content.';
