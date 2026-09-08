-- Core care flow: immutable authorized-care-plan and client-service-plan
-- versions, effective-version guards, service traceability, and a safe daily
-- summary RPC. No statutory service code, rate, or formula is encoded here.

create type public.care_plan_version_status as enum (
  'draft',
  'approved',
  'signed',
  'voided'
);

insert into public.permissions (permission_key, description, risk_level) values
  ('care_plans.read', 'Read authorized and client service plan versions', 2),
  ('care_plans.write', 'Create immutable care plan draft and correction versions', 2),
  ('care_plans.approve', 'Approve care plan versions', 3),
  ('care_plans.sign', 'Sign or void care plan versions', 3)
on conflict (permission_key) do nothing;

-- New permissions are added after the system roles, so grants are explicit
-- rather than relying on a broad role template query from an earlier migration.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.role_key in ('organization_manager', 'branch_supervisor')
  and r.is_system
  and p.permission_key in (
    'care_plans.read', 'care_plans.write', 'care_plans.approve', 'care_plans.sign'
  )
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.role_key in ('case_manager_social_worker', 'nurse', 'professional')
  and r.is_system
  and p.permission_key in ('care_plans.read', 'care_plans.write', 'care_plans.sign')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.role_key = 'care_worker'
  and r.is_system
  and p.permission_key = 'care_plans.read'
on conflict (role_id, permission_id) do nothing;

create table public.authorized_care_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  plan_key uuid not null default gen_random_uuid(),
  version integer not null default 1,
  previous_version_id uuid,
  status public.care_plan_version_status not null default 'draft',
  effective_from date not null,
  effective_to date not null,
  source_system text not null,
  source_record_id text,
  source_provenance jsonb not null default '{}'::jsonb,
  authorized_on date,
  authorization_reference text,
  service_limits jsonb not null default '{}'::jsonb,
  plan_data jsonb not null default '{}'::jsonb,
  correction_reason text,
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approval_evidence_hash text,
  approval_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  signed_by uuid references auth.users(id) on delete restrict,
  signed_at timestamptz,
  signature_purpose text,
  signature_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint authorized_care_plans_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint authorized_care_plans_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint authorized_care_plans_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, client_id)
    references public.authorized_care_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint authorized_care_plans_version_check check (version > 0),
  constraint authorized_care_plans_period_check check (effective_to >= effective_from),
  constraint authorized_care_plans_source_check check (
    char_length(btrim(source_system)) between 1 and 80
    and (source_record_id is null or char_length(btrim(source_record_id)) between 1 and 240)
  ),
  constraint authorized_care_plans_authorization_metadata_check check (
    status = 'draft'
    or (
      authorized_on is not null
      and authorized_on <= effective_to
      and char_length(btrim(authorization_reference)) between 1 and 240
    )
  ),
  constraint authorized_care_plans_json_check check (
    jsonb_typeof(source_provenance) = 'object'
    and jsonb_typeof(service_limits) = 'object'
    and jsonb_typeof(plan_data) = 'object'
  ),
  constraint authorized_care_plans_correction_check check (
    (previous_version_id is null and version = 1 and correction_reason is null)
    or (
      previous_version_id is not null
      and version > 1
      and char_length(btrim(correction_reason)) between 1 and 1000
    )
  ),
  constraint authorized_care_plans_evidence_hash_check check (
    (approval_evidence_hash is null or approval_evidence_hash ~ '^[a-f0-9]{64}$')
    and (content_hash is null or content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint authorized_care_plans_evidence_state_check check (
    (
      status = 'draft'
      and approved_by is null
      and approved_at is null
      and approval_evidence_hash is null
      and approval_reauth_challenge_id is null
      and signed_by is null
      and signed_at is null
      and signature_purpose is null
      and signature_reauth_challenge_id is null
      and content_hash is null
    )
    or (
      status = 'approved'
      and approved_by is not null
      and approved_at is not null
      and approval_evidence_hash is not null
      and approval_reauth_challenge_id is not null
      and signed_by is null
      and signed_at is null
      and signature_purpose is null
      and signature_reauth_challenge_id is null
      and content_hash is null
    )
    or (
      status in ('signed', 'voided')
      and approved_by is not null
      and approved_at is not null
      and approval_evidence_hash is not null
      and approval_reauth_challenge_id is not null
      and signed_by is not null
      and signed_at is not null
      and char_length(btrim(signature_purpose)) between 1 and 240
      and signature_reauth_challenge_id is not null
      and content_hash is not null
      and signed_at >= approved_at
      and (status <> 'voided' or previous_version_id is not null)
    )
  ),
  constraint authorized_care_plans_plan_version_key
    unique (organization_id, plan_key, version),
  constraint authorized_care_plans_previous_version_key unique (previous_version_id),
  constraint authorized_care_plans_idempotency_key
    unique (organization_id, branch_id, created_by, idempotency_key)
);

create table public.client_service_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  authorized_care_plan_id uuid not null,
  plan_key uuid not null default gen_random_uuid(),
  version integer not null default 1,
  previous_version_id uuid,
  status public.care_plan_version_status not null default 'draft',
  effective_from date not null,
  effective_to date not null,
  source_system text not null default 'local',
  source_record_id text,
  source_provenance jsonb not null default '{}'::jsonb,
  authorized_limits_snapshot jsonb not null default '{}'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  planned_services jsonb not null default '[]'::jsonb,
  responsible_user_id uuid references auth.users(id) on delete restrict,
  review_due_on date,
  correction_reason text,
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approval_evidence_hash text,
  approval_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  signed_by uuid references auth.users(id) on delete restrict,
  signed_at timestamptz,
  signature_purpose text,
  signature_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  content_hash text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint client_service_plans_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint client_service_plans_authorized_scope_fkey
    foreign key (authorized_care_plan_id, organization_id, branch_id, client_id)
    references public.authorized_care_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint client_service_plans_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint client_service_plans_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, client_id)
    references public.client_service_plans(id, organization_id, branch_id, client_id)
    on delete restrict,
  constraint client_service_plans_version_check check (version > 0),
  constraint client_service_plans_period_check check (effective_to >= effective_from),
  constraint client_service_plans_review_check check (
    review_due_on is null or review_due_on between effective_from and effective_to
  ),
  constraint client_service_plans_source_check check (
    char_length(btrim(source_system)) between 1 and 80
    and (source_record_id is null or char_length(btrim(source_record_id)) between 1 and 240)
  ),
  constraint client_service_plans_json_check check (
    jsonb_typeof(source_provenance) = 'object'
    and jsonb_typeof(authorized_limits_snapshot) = 'object'
    and jsonb_typeof(goals) = 'array'
    and jsonb_typeof(planned_services) = 'array'
  ),
  constraint client_service_plans_correction_check check (
    (previous_version_id is null and version = 1 and correction_reason is null)
    or (
      previous_version_id is not null
      and version > 1
      and char_length(btrim(correction_reason)) between 1 and 1000
    )
  ),
  constraint client_service_plans_evidence_hash_check check (
    (approval_evidence_hash is null or approval_evidence_hash ~ '^[a-f0-9]{64}$')
    and (content_hash is null or content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint client_service_plans_evidence_state_check check (
    (
      status = 'draft'
      and approved_by is null
      and approved_at is null
      and approval_evidence_hash is null
      and approval_reauth_challenge_id is null
      and signed_by is null
      and signed_at is null
      and signature_purpose is null
      and signature_reauth_challenge_id is null
      and content_hash is null
    )
    or (
      status = 'approved'
      and approved_by is not null
      and approved_at is not null
      and approval_evidence_hash is not null
      and approval_reauth_challenge_id is not null
      and signed_by is null
      and signed_at is null
      and signature_purpose is null
      and signature_reauth_challenge_id is null
      and content_hash is null
    )
    or (
      status in ('signed', 'voided')
      and approved_by is not null
      and approved_at is not null
      and approval_evidence_hash is not null
      and approval_reauth_challenge_id is not null
      and signed_by is not null
      and signed_at is not null
      and char_length(btrim(signature_purpose)) between 1 and 240
      and signature_reauth_challenge_id is not null
      and content_hash is not null
      and signed_at >= approved_at
      and (status <> 'voided' or previous_version_id is not null)
    )
  ),
  constraint client_service_plans_plan_version_key
    unique (organization_id, plan_key, version),
  constraint client_service_plans_previous_version_key unique (previous_version_id),
  constraint client_service_plans_idempotency_key
    unique (organization_id, branch_id, created_by, idempotency_key)
);

alter table public.service_events
  add column client_service_plan_id uuid;

alter table public.service_events
  add constraint service_events_client_service_plan_scope_fkey
  foreign key (client_service_plan_id, organization_id, branch_id, client_id)
  references public.client_service_plans(id, organization_id, branch_id, client_id)
  on delete restrict;

create index authorized_care_plans_client_effective_idx
  on public.authorized_care_plans (
    organization_id, branch_id, client_id, effective_from, effective_to, version desc
  )
  where status in ('signed', 'voided');
create index authorized_care_plans_created_by_idx on public.authorized_care_plans (created_by);
create index authorized_care_plans_approved_by_idx
  on public.authorized_care_plans (approved_by) where approved_by is not null;
create index authorized_care_plans_signed_by_idx
  on public.authorized_care_plans (signed_by) where signed_by is not null;
create index authorized_care_plans_approval_challenge_idx
  on public.authorized_care_plans (approval_reauth_challenge_id)
  where approval_reauth_challenge_id is not null;
create index authorized_care_plans_signature_challenge_idx
  on public.authorized_care_plans (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;

create index client_service_plans_client_effective_idx
  on public.client_service_plans (
    organization_id, branch_id, client_id, effective_from, effective_to, version desc
  )
  where status in ('signed', 'voided');
create index client_service_plans_authorized_id_idx
  on public.client_service_plans (authorized_care_plan_id);
create index client_service_plans_created_by_idx on public.client_service_plans (created_by);
create index client_service_plans_responsible_user_id_idx
  on public.client_service_plans (responsible_user_id) where responsible_user_id is not null;
create index client_service_plans_approved_by_idx
  on public.client_service_plans (approved_by) where approved_by is not null;
create index client_service_plans_signed_by_idx
  on public.client_service_plans (signed_by) where signed_by is not null;
create index client_service_plans_approval_challenge_idx
  on public.client_service_plans (approval_reauth_challenge_id)
  where approval_reauth_challenge_id is not null;
create index client_service_plans_signature_challenge_idx
  on public.client_service_plans (signature_reauth_challenge_id)
  where signature_reauth_challenge_id is not null;
create index service_events_client_service_plan_id_idx
  on public.service_events (client_service_plan_id)
  where client_service_plan_id is not null;
create index attendance_records_daily_summary_idx
  on public.attendance_records (client_id, service_date, created_at, id)
  where status <> 'cancelled';
create index measurements_daily_summary_idx
  on public.measurements (client_id, measured_at, id);
create index care_records_daily_summary_idx
  on public.care_records (client_id, occurred_at, id)
  where status <> 'voided';
create index service_events_daily_summary_idx
  on public.service_events (client_id, started_at, id)
  where status <> 'voided';

create or replace function private.reauth_challenge_supports_plan_evidence(
  p_challenge_id uuid,
  p_user_id uuid,
  p_evidence_at timestamptz
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_challenge_id is not null
    and p_user_id is not null
    and p_evidence_at is not null
    and exists (
      select 1
      from private.reauth_challenges challenge
      where challenge.id = p_challenge_id
        and challenge.user_id = p_user_id
        and challenge.consumed_at is not null
        and challenge.invalidated_at is null
        and challenge.factor_method in ('totp', 'webauthn', 'phone')
        and challenge.factor_verified_at is not null
        and challenge.factor_verified_at <= p_evidence_at + interval '1 minute'
        and challenge.factor_verified_at >= p_evidence_at - interval '15 minutes'
    );
$$;

create or replace function private.validate_authorized_care_plan_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_previous public.authorized_care_plans%rowtype;
begin
  -- Creation and local signature timestamps are server-controlled. Original
  -- source timestamps belong in source_provenance rather than these columns.
  new.created_at := v_now;
  new.updated_at := v_now;

  if v_actor_user_id is not null and new.created_by <> v_actor_user_id then
    raise exception using errcode = '42501', message = 'care plan creator must be the authenticated user';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'authorized-care-plan:' || new.organization_id::text || ':' ||
      new.branch_id::text || ':' || new.client_id::text,
      0
    )
  );

  if new.previous_version_id is null then
    if new.version <> 1 or exists (
      select 1
      from public.authorized_care_plans existing
      where existing.organization_id = new.organization_id
        and existing.plan_key = new.plan_key
    ) then
      raise exception using errcode = '23514', message = 'first care plan version must start a new version-one chain';
    end if;
  else
    select previous.* into strict v_previous
    from public.authorized_care_plans previous
    where previous.id = new.previous_version_id
      and previous.organization_id = new.organization_id
      and previous.branch_id = new.branch_id
      and previous.client_id = new.client_id
    for share;

    if v_previous.plan_key <> new.plan_key
       or new.version <> v_previous.version + 1
       or v_previous.status = 'voided' then
      raise exception using errcode = '23514', message = 'care plan correction must extend the same non-voided version chain';
    end if;
  end if;

  if new.status in ('approved', 'signed', 'voided')
     and not private.reauth_challenge_supports_plan_evidence(
       new.approval_reauth_challenge_id,
       new.approved_by,
       new.approved_at
     ) then
    raise exception using errcode = '23514', message = 'care plan approval lacks matching fresh AAL2 evidence';
  end if;

  if new.status in ('signed', 'voided')
     and not private.reauth_challenge_supports_plan_evidence(
       new.signature_reauth_challenge_id,
       new.signed_by,
       new.signed_at
     ) then
    raise exception using errcode = '23514', message = 'care plan signature lacks matching fresh AAL2 evidence';
  end if;

  if v_actor_user_id is not null and (
    (
      new.status in ('approved', 'voided')
      and (
        new.approved_at < v_now - interval '1 minute'
        or new.approved_at > v_now + interval '1 minute'
      )
    )
    or (
      new.status = 'signed'
      and new.approved_by = v_actor_user_id
      and (
        new.approved_at < v_now - interval '1 minute'
        or new.approved_at > v_now + interval '1 minute'
      )
    )
    or (
      new.status in ('signed', 'voided')
      and (
        new.signed_at < v_now - interval '1 minute'
        or new.signed_at > v_now + interval '1 minute'
      )
    )
  ) then
    raise exception using errcode = '23514', message = 'care plan approval and signature timestamps must use current server time';
  end if;

  if v_actor_user_id is not null
     and new.status = 'signed'
     and new.approved_by <> v_actor_user_id
     and (
       new.previous_version_id is null
       or v_previous.status not in ('approved', 'signed')
       or v_previous.approved_by is distinct from new.approved_by
       or v_previous.approved_at is distinct from new.approved_at
       or v_previous.approval_evidence_hash is distinct from new.approval_evidence_hash
       or v_previous.approval_reauth_challenge_id is distinct from new.approval_reauth_challenge_id
       or v_previous.effective_from is distinct from new.effective_from
       or v_previous.effective_to is distinct from new.effective_to
       or v_previous.source_system is distinct from new.source_system
       or v_previous.source_record_id is distinct from new.source_record_id
       or v_previous.source_provenance is distinct from new.source_provenance
       or v_previous.authorized_on is distinct from new.authorized_on
       or v_previous.authorization_reference is distinct from new.authorization_reference
       or v_previous.service_limits is distinct from new.service_limits
       or v_previous.plan_data is distinct from new.plan_data
     ) then
    raise exception using errcode = '42501', message = 'signature may only carry unchanged approved content and evidence from the previous version';
  end if;

  -- Different stable plan streams may not both be effective for the same
  -- client and date range. A signed correction in the same linear stream is
  -- allowed; the highest terminal version is the unique effective version.
  if new.status = 'signed' and exists (
    select 1
    from public.authorized_care_plans existing
    where existing.organization_id = new.organization_id
      and existing.branch_id = new.branch_id
      and existing.client_id = new.client_id
      and existing.plan_key <> new.plan_key
      and existing.status = 'signed'
      and daterange(existing.effective_from, existing.effective_to, '[]')
          && daterange(new.effective_from, new.effective_to, '[]')
      and not exists (
        select 1
        from public.authorized_care_plans terminal
        where terminal.organization_id = existing.organization_id
          and terminal.plan_key = existing.plan_key
          and terminal.version > existing.version
          and terminal.status in ('signed', 'voided')
          and daterange(terminal.effective_from, terminal.effective_to, '[]')
              @> daterange(new.effective_from, new.effective_to, '[]')
      )
  ) then
    raise exception using errcode = '23P01', message = 'authorized care plan effective period overlaps another active plan stream';
  end if;

  return new;
exception
  when no_data_found then
    raise exception using errcode = '23503', message = 'previous authorized care plan version does not exist in scope';
end;
$$;

create or replace function private.validate_client_service_plan_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  perform pg_advisory_xact_lock(
    hashtextextended(
      'client-service-plan:' || new.organization_id::text || ':' ||
      new.branch_id::text || ':' || new.client_id::text,
      0
    )
  );

  -- Keep the same service-plan -> authorized-plan lock order used by service
  -- event validation. This prevents an authorized replacement/void from
  -- committing between this function's current-version read and insert.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'authorized-care-plan:' || new.organization_id::text || ':' ||
      new.branch_id::text || ':' || new.client_id::text,
      0
    )
  );

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
      select 1
      from public.authorized_care_plans later
      where later.organization_id = authorized.organization_id
        and later.plan_key = authorized.plan_key
        and later.version > authorized.version
        and later.status in ('signed', 'voided')
        and daterange(later.effective_from, later.effective_to, '[]')
            && daterange(new.effective_from, new.effective_to, '[]')
    )
  for share;

  if new.authorized_limits_snapshot <> v_authorized.service_limits then
    raise exception using
      errcode = '23514',
      message = 'client service plan authorization limit snapshot must match the signed authorized plan';
  end if;

  if new.previous_version_id is null then
    if new.version <> 1 or exists (
      select 1
      from public.client_service_plans existing
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

  if new.status in ('approved', 'signed', 'voided')
     and not private.reauth_challenge_supports_plan_evidence(
       new.approval_reauth_challenge_id,
       new.approved_by,
       new.approved_at
     ) then
    raise exception using errcode = '23514', message = 'service plan approval lacks matching fresh AAL2 evidence';
  end if;

  if new.status in ('signed', 'voided')
     and not private.reauth_challenge_supports_plan_evidence(
       new.signature_reauth_challenge_id,
       new.signed_by,
       new.signed_at
     ) then
    raise exception using errcode = '23514', message = 'service plan signature lacks matching fresh AAL2 evidence';
  end if;

  if v_actor_user_id is not null and (
    (
      new.status in ('approved', 'voided')
      and (
        new.approved_at < v_now - interval '1 minute'
        or new.approved_at > v_now + interval '1 minute'
      )
    )
    or (
      new.status = 'signed'
      and new.approved_by = v_actor_user_id
      and (
        new.approved_at < v_now - interval '1 minute'
        or new.approved_at > v_now + interval '1 minute'
      )
    )
    or (
      new.status in ('signed', 'voided')
      and (
        new.signed_at < v_now - interval '1 minute'
        or new.signed_at > v_now + interval '1 minute'
      )
    )
  ) then
    raise exception using errcode = '23514', message = 'service plan approval and signature timestamps must use current server time';
  end if;

  if v_actor_user_id is not null
     and new.status = 'signed'
     and new.approved_by <> v_actor_user_id
     and (
       new.previous_version_id is null
       or v_previous.status not in ('approved', 'signed')
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
    select 1
    from public.client_service_plans existing
    where existing.organization_id = new.organization_id
      and existing.branch_id = new.branch_id
      and existing.client_id = new.client_id
      and existing.plan_key <> new.plan_key
      and existing.status = 'signed'
      and daterange(existing.effective_from, existing.effective_to, '[]')
          && daterange(new.effective_from, new.effective_to, '[]')
      and not exists (
        select 1
        from public.client_service_plans terminal
        where terminal.organization_id = existing.organization_id
          and terminal.plan_key = existing.plan_key
          and terminal.version > existing.version
          and terminal.status in ('signed', 'voided')
          and daterange(terminal.effective_from, terminal.effective_to, '[]')
              @> daterange(new.effective_from, new.effective_to, '[]')
      )
  ) then
    raise exception using errcode = '23P01', message = 'client service plan effective period overlaps another active plan stream';
  end if;

  return new;
exception
  when no_data_found then
    raise exception using errcode = '23503', message = 'referenced care plan version does not exist or is not effective in scope';
end;
$$;

create or replace function private.prevent_care_plan_version_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format(
      'care plan versions in %I.%I are append-only; create a linked correction version',
      tg_table_schema,
      tg_table_name
    );
end;
$$;

create or replace function private.validate_service_event_client_service_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_service_date date := (new.started_at at time zone 'Asia/Taipei')::date;
  v_current_authorized_plan_id uuid;
begin
  if v_actor_user_id is not null
     and new.staff_user_id is not null
     and new.staff_user_id <> v_actor_user_id then
    raise exception using errcode = '42501', message = 'service event staff must be the authenticated user';
  end if;

  if new.status in ('in_progress', 'completed') and new.client_service_plan_id is null then
    raise exception using errcode = '23514', message = 'executed service events require an effective client service plan';
  end if;

  if new.client_service_plan_id is not null then
    -- Serialize against both plan-version insert guards before resolving the
    -- current versions. Without the matching transaction locks, an event could
    -- validate an old plan concurrently with a replacement/void and commit
    -- after that replacement became current.
    perform pg_advisory_xact_lock(
      hashtextextended(
        'client-service-plan:' || new.organization_id::text || ':' ||
        new.branch_id::text || ':' || new.client_id::text,
        0
      )
    );
    perform pg_advisory_xact_lock(
      hashtextextended(
        'authorized-care-plan:' || new.organization_id::text || ':' ||
        new.branch_id::text || ':' || new.client_id::text,
        0
      )
    );

    -- Resolve the one current signed authorization across all plan streams. A
    -- superseded/voided stream must not remain usable through an otherwise-current
    -- service plan, and corrupted overlapping signed streams fail closed.
    select
      case
        when count(*) = 1 then min(terminal.id::text)::uuid
        else null
      end
    into v_current_authorized_plan_id
    from (
      select distinct on (plan.plan_key)
        plan.id,
        plan.status
      from public.authorized_care_plans plan
      where plan.organization_id = new.organization_id
        and plan.branch_id = new.branch_id
        and plan.client_id = new.client_id
        and plan.status in ('signed', 'voided')
        and v_service_date between plan.effective_from and plan.effective_to
      order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
    ) terminal
    where terminal.status = 'signed';

    if not exists (
      select 1
      from public.client_service_plans plan
      where plan.id = new.client_service_plan_id
        and plan.organization_id = new.organization_id
        and plan.branch_id = new.branch_id
        and plan.client_id = new.client_id
        and plan.status = 'signed'
        and plan.authorized_care_plan_id = v_current_authorized_plan_id
        and v_service_date between plan.effective_from and plan.effective_to
        and not exists (
          select 1
          from public.client_service_plans later
          where later.organization_id = plan.organization_id
            and later.plan_key = plan.plan_key
            and later.version > plan.version
            and later.status in ('signed', 'voided')
            and v_service_date between later.effective_from and later.effective_to
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'service event plan or authorization is outside scope, period, or current signed version';
    end if;
  end if;

  return new;
end;
$$;

-- Preserve the existing key guard while adding the new immutable service-plan
-- foreign key. The table triggers created by the prior migration continue to
-- reference this replaced function.
create or replace function private.prevent_key_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
  v_keys constant text[] := array[
    'id', 'organization_id', 'branch_id', 'profile_id', 'client_id',
    'role_id', 'permission_id', 'membership_id', 'user_id',
    'recipient_user_id', 'actor_user_id', 'created_by', 'recorded_by',
    'uploaded_by', 'idempotency_key', 'upload_idempotency_key',
    'operation_kind', 'request_hash', 'expected_version',
    'form_definition_id', 'record_key', 'plan_key', 'version',
    'previous_version_id', 'correction_of_id', 'medication_plan_id',
    'care_plan_record_id', 'client_service_plan_id', 'claim_batch_id',
    'service_event_id', 'import_batch_id', 'notification_id'
  ];
begin
  foreach v_key in array v_keys loop
    if not (tg_table_name = 'import_batches' and v_key = 'version')
       and not (
         tg_table_name = 'service_events'
         and v_key = 'client_service_plan_id'
         and v_old ->> v_key is null
         and v_new ->> v_key is not null
       )
       and v_old ? v_key
       and v_old -> v_key is distinct from v_new -> v_key then
      raise exception using
        errcode = '23514',
        message = format('immutable key %s cannot be changed on %I.%I', v_key, tg_table_schema, tg_table_name);
    end if;
  end loop;
  return new;
end;
$$;

create trigger authorized_care_plans_validate_version
before insert on public.authorized_care_plans
for each row execute function private.validate_authorized_care_plan_version();

create trigger client_service_plans_validate_version
before insert on public.client_service_plans
for each row execute function private.validate_client_service_plan_version();

create trigger authorized_care_plans_prevent_mutation
before update or delete on public.authorized_care_plans
for each row execute function private.prevent_care_plan_version_mutation();

create trigger client_service_plans_prevent_mutation
before update or delete on public.client_service_plans
for each row execute function private.prevent_care_plan_version_mutation();

create trigger authorized_care_plans_set_updated_at
before update on public.authorized_care_plans
for each row execute function private.set_updated_at();

create trigger client_service_plans_set_updated_at
before update on public.client_service_plans
for each row execute function private.set_updated_at();

create trigger authorized_care_plans_prevent_key_change
before update on public.authorized_care_plans
for each row execute function private.prevent_key_change();

create trigger client_service_plans_prevent_key_change
before update on public.client_service_plans
for each row execute function private.prevent_key_change();

create trigger authorized_care_plans_audit_row_change
after insert or update or delete on public.authorized_care_plans
for each row execute function private.audit_row_change();

create trigger client_service_plans_audit_row_change
after insert or update or delete on public.client_service_plans
for each row execute function private.audit_row_change();

create trigger service_events_validate_client_service_plan
before insert or update on public.service_events
for each row execute function private.validate_service_event_client_service_plan();

alter table public.authorized_care_plans enable row level security;
alter table public.authorized_care_plans force row level security;
alter table public.client_service_plans enable row level security;
alter table public.client_service_plans force row level security;

create policy authorized_care_plans_select
on public.authorized_care_plans for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'care_plans.read')));

create policy authorized_care_plans_insert
on public.authorized_care_plans for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'care_plans.write'))
  and created_by = (select auth.uid())
  and (
    status = 'draft'
    or (
      status = 'approved'
      and approved_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'care_plans.approve'))
      and (select private.has_recent_aal2(15))
    )
    or (
      status = 'signed'
      and signed_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'care_plans.sign'))
      and (
        approved_by <> (select auth.uid())
        or (select private.has_permission(organization_id, branch_id, 'care_plans.approve'))
      )
      and (select private.has_recent_aal2(15))
    )
    or (
      status = 'voided'
      and approved_by = (select auth.uid())
      and signed_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'care_plans.approve'))
      and (select private.has_permission(organization_id, branch_id, 'care_plans.sign'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create policy client_service_plans_select
on public.client_service_plans for select
to authenticated
using ((select private.can_staff_access_client(client_id, 'care_plans.read')));

create policy client_service_plans_insert
on public.client_service_plans for insert
to authenticated
with check (
  (select private.can_staff_access_client(client_id, 'care_plans.write'))
  and created_by = (select auth.uid())
  and (
    status = 'draft'
    or (
      status = 'approved'
      and approved_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'care_plans.approve'))
      and (select private.has_recent_aal2(15))
    )
    or (
      status = 'signed'
      and signed_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'care_plans.sign'))
      and (
        approved_by <> (select auth.uid())
        or (select private.has_permission(organization_id, branch_id, 'care_plans.approve'))
      )
      and (select private.has_recent_aal2(15))
    )
    or (
      status = 'voided'
      and approved_by = (select auth.uid())
      and signed_by = (select auth.uid())
      and (select private.has_permission(organization_id, branch_id, 'care_plans.approve'))
      and (select private.has_permission(organization_id, branch_id, 'care_plans.sign'))
      and (select private.has_recent_aal2(15))
    )
  )
);

create or replace function public.daily_service_summary(
  p_client_id uuid,
  p_service_date date default ((now() at time zone 'Asia/Taipei')::date)
)
returns table(
  client_id uuid,
  service_date date,
  authorized_care_plan_id uuid,
  client_service_plan_id uuid,
  attendance_count bigint,
  measurement_count bigint,
  care_record_count bigint,
  service_event_count bigint,
  attendance_source_ids uuid[],
  measurement_source_ids uuid[],
  care_record_source_ids uuid[],
  service_event_source_ids uuid[],
  snapshot_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select client.id
    from public.clients client
    where client.id = p_client_id
      and p_service_date is not null
      and (select private.can_staff_access_client(client.id, 'care_plans.read'))
      and (select private.can_staff_access_client(client.id, 'attendance.read'))
      and (select private.can_staff_access_client(client.id, 'health.read'))
      and (select private.can_staff_access_client(client.id, 'care_records.read'))
      and (select private.can_staff_access_client(client.id, 'services.read'))
  ),
  authorized_stream_terminal as (
    select distinct on (plan.plan_key)
      plan.id, plan.plan_key, plan.status, plan.version, plan.created_at
    from public.authorized_care_plans plan
    join target on target.id = plan.client_id
    where plan.status in ('signed', 'voided')
      and p_service_date between plan.effective_from and plan.effective_to
    order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
  ),
  authorized_terminal as (
    select terminal.id, terminal.status
    from authorized_stream_terminal terminal
    where terminal.status = 'signed'
      and (
        select count(*)
        from authorized_stream_terminal candidate
        where candidate.status = 'signed'
      ) = 1
  ),
  service_stream_terminal as (
    select distinct on (plan.plan_key)
      plan.id, plan.plan_key, plan.authorized_care_plan_id, plan.status,
      plan.version, plan.created_at
    from public.client_service_plans plan
    join target on target.id = plan.client_id
    where plan.status in ('signed', 'voided')
      and p_service_date between plan.effective_from and plan.effective_to
    order by plan.plan_key, plan.version desc, plan.created_at desc, plan.id desc
  ),
  service_terminal as (
    select terminal.id, terminal.status
    from service_stream_terminal terminal
    where terminal.status = 'signed'
      and terminal.authorized_care_plan_id = (
        select authorized.id
        from authorized_terminal authorized
        where authorized.status = 'signed'
      )
      and (
        select count(*)
        from service_stream_terminal candidate
        where candidate.status = 'signed'
      ) = 1
  ),
  attendance_source as (
    select coalesce(array_agg(record.id order by record.created_at, record.id), '{}'::uuid[]) as ids
    from public.attendance_records record
    join target on target.id = record.client_id
    where record.service_date = p_service_date
      and record.status <> 'cancelled'
  ),
  measurement_source as (
    select coalesce(array_agg(record.id order by record.measured_at, record.id), '{}'::uuid[]) as ids
    from public.measurements record
    join target on target.id = record.client_id
    where record.measured_at >= (p_service_date::timestamp at time zone 'Asia/Taipei')
      and record.measured_at < ((p_service_date + 1)::timestamp at time zone 'Asia/Taipei')
  ),
  care_source as (
    select coalesce(array_agg(record.id order by record.occurred_at, record.id), '{}'::uuid[]) as ids
    from public.care_records record
    join target on target.id = record.client_id
    where record.occurred_at >= (p_service_date::timestamp at time zone 'Asia/Taipei')
      and record.occurred_at < ((p_service_date + 1)::timestamp at time zone 'Asia/Taipei')
      and record.status <> 'voided'
  ),
  service_source as (
    select coalesce(array_agg(record.id order by record.started_at, record.id), '{}'::uuid[]) as ids
    from public.service_events record
    join target on target.id = record.client_id
    where record.started_at >= (p_service_date::timestamp at time zone 'Asia/Taipei')
      and record.started_at < ((p_service_date + 1)::timestamp at time zone 'Asia/Taipei')
      and record.status <> 'voided'
  )
  select
    target.id,
    p_service_date,
    (select id from authorized_terminal where status = 'signed'),
    (select id from service_terminal where status = 'signed'),
    cardinality(attendance_source.ids)::bigint,
    cardinality(measurement_source.ids)::bigint,
    cardinality(care_source.ids)::bigint,
    cardinality(service_source.ids)::bigint,
    attendance_source.ids,
    measurement_source.ids,
    care_source.ids,
    service_source.ids,
    statement_timestamp()
  from target
  cross join attendance_source
  cross join measurement_source
  cross join care_source
  cross join service_source;
$$;

comment on function public.daily_service_summary(uuid, date) is
  'Returns one RLS-filtered daily snapshot and exact source IDs for drill-down; tenant scope is derived from the authenticated client access path.';

revoke all on function private.reauth_challenge_supports_plan_evidence(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_authorized_care_plan_version()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_client_service_plan_version()
  from public, anon, authenticated, service_role;
revoke all on function private.prevent_care_plan_version_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_service_event_client_service_plan()
  from public, anon, authenticated, service_role;

revoke all on table public.authorized_care_plans
  from public, anon, authenticated, service_role;
revoke all on table public.client_service_plans
  from public, anon, authenticated, service_role;
grant select, insert on table public.authorized_care_plans to authenticated;
grant select, insert on table public.client_service_plans to authenticated;
grant select, insert on table public.authorized_care_plans to service_role;
grant select, insert on table public.client_service_plans to service_role;

revoke all on function public.daily_service_summary(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.daily_service_summary(uuid, date) to authenticated;
