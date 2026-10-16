begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- This is a candidate evidence-registration surface, not an automatic
-- interpretation of a medication bag or a claim that a scanned file is an
-- order. A second currently authorized staff member must explicitly attest the
-- exact approved plan version and an individually reviewed source document.
create table private.insulin_order_source_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  medication_plan_id uuid not null,
  medication_plan_version integer not null check (medication_plan_version > 0),
  medication_plan_content_hash text not null check (medication_plan_content_hash ~ '^[a-f0-9]{64}$'),
  document_id uuid not null references private.client_document_versions(id) on delete restrict,
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  document_version integer not null check (document_version > 0),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  proposed_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  foreign key (medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id) on delete restrict,
  unique (medication_plan_id),
  unique (organization_id, proposed_by, idempotency_key)
);
create index insulin_order_source_scope_idx on private.insulin_order_source_evidence
  (organization_id, branch_id, client_id, medication_plan_id);
create index insulin_order_source_document_idx on private.insulin_order_source_evidence (document_id);
create index insulin_order_source_proposer_idx on private.insulin_order_source_evidence (proposed_by);
create index insulin_order_source_reauth_idx on private.insulin_order_source_evidence (proposed_reauth_challenge_id);

create table private.insulin_order_source_approvals (
  id uuid primary key default gen_random_uuid(),
  source_evidence_id uuid not null unique
    references private.insulin_order_source_evidence(id) on delete restrict,
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  attestation text not null check (attestation = 'I independently verified the physician order against this exact plan and document version'),
  approved_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  unique (organization_id, approved_by, idempotency_key)
);
create index insulin_order_source_approval_scope_idx on private.insulin_order_source_approvals
  (organization_id, branch_id, client_id, source_evidence_id);
create index insulin_order_source_approval_actor_idx on private.insulin_order_source_approvals (approved_by);
create index insulin_order_source_approval_reauth_idx on private.insulin_order_source_approvals (approval_reauth_challenge_id);

alter table private.insulin_order_source_evidence enable row level security;
alter table private.insulin_order_source_evidence force row level security;
alter table private.insulin_order_source_approvals enable row level security;
alter table private.insulin_order_source_approvals force row level security;
revoke all on private.insulin_order_source_evidence, private.insulin_order_source_approvals
  from public, anon, authenticated, service_role;
create trigger insulin_order_source_evidence_immutable before update or delete
  on private.insulin_order_source_evidence for each row
  execute function private.client_documents_immutable();
create trigger insulin_order_source_approvals_immutable before update or delete
  on private.insulin_order_source_approvals for each row
  execute function private.client_documents_immutable();
create trigger insulin_order_source_evidence_audit after insert
  on private.insulin_order_source_evidence for each row
  execute function private.audit_row_change();
create trigger insulin_order_source_approvals_audit after insert
  on private.insulin_order_source_approvals for each row
  execute function private.audit_row_change();

create function private.insulin_order_document_is_current(
  p_document_id uuid, p_organization_id uuid, p_branch_id uuid,
  p_client_id uuid, p_reference_time timestamptz
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.client_document_versions document
    join private.client_document_scan_results scan on scan.document_id = document.id
    join private.client_document_disposition_events disposition
      on disposition.document_id = document.id
    where document.id = p_document_id
      and document.organization_id = p_organization_id
      and document.branch_id = p_branch_id
      and document.client_id = p_client_id
      and document.category = 'medication_plan'
      and scan.verdict = 'clean'
      and document.created_at <= p_reference_time
      and scan.scanned_at <= p_reference_time
      and disposition.created_at <= p_reference_time
      and disposition.revision = (
        select max(latest.revision)
        from private.client_document_disposition_events latest
        where latest.document_id = document.id
      )
      and disposition.disposition = 'reviewed'
      and private.client_document_current_disposition(document.id) = 'reviewed'
      and nullif(btrim(document.document_label), '') is not null
      and nullif(btrim(document.provider), '') is not null
      and document.document_date is not null
      and document.valid_until is not null
      and document.period_from is not null
      and document.period_to is not null
      and document.document_date <= (p_reference_time at time zone 'Asia/Taipei')::date
      and document.period_from <= (p_reference_time at time zone 'Asia/Taipei')::date
      and document.period_to >= (p_reference_time at time zone 'Asia/Taipei')::date
      and document.valid_until >= (p_reference_time at time zone 'Asia/Taipei')::date
  );
$$;

create function private.insulin_order_source_is_current(
  p_medication_plan_id uuid, p_reference_time timestamptz
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from private.insulin_order_source_evidence source
    join private.insulin_order_source_approvals approval
      on approval.source_evidence_id = source.id
     and approval.organization_id = source.organization_id
     and approval.branch_id = source.branch_id
     and approval.client_id = source.client_id
    join public.medication_plans plan on plan.id = source.medication_plan_id
    join private.client_document_versions document on document.id = source.document_id
    where source.medication_plan_id = p_medication_plan_id
      and plan.organization_id = source.organization_id
      and plan.branch_id = source.branch_id
      and plan.client_id = source.client_id
      and plan.version = source.medication_plan_version
      and plan.content_hash = source.medication_plan_content_hash
      and document.sha256 = source.document_sha256
      and document.version = source.document_version
      and approval.approved_by <> source.proposed_by
      and source.proposed_at <= p_reference_time
      and source.proposed_at <= approval.approved_at
      and approval.approved_at <= p_reference_time
      and private.insulin_order_document_is_current(
        source.document_id, source.organization_id, source.branch_id,
        source.client_id, source.proposed_at
      )
      and private.insulin_order_document_is_current(
        source.document_id, source.organization_id, source.branch_id,
        source.client_id, p_reference_time
      )
  );
$$;

create function private.propose_insulin_order_source_guarded(
  p_organization_id uuid, p_branch_id uuid, p_client_id uuid,
  p_medication_plan_id uuid, p_document_id uuid,
  p_expected_plan_row_version bigint, p_idempotency_key uuid
) returns table(evidence_id uuid, document_hash text, replayed boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_challenge uuid;
  v_plan public.medication_plans;
  v_document private.client_document_versions;
  v_prior private.insulin_order_source_evidence;
  v_hash text;
  v_id uuid;
begin
  if v_actor is null or p_organization_id is null or p_branch_id is null
    or p_client_id is null or p_medication_plan_id is null or p_document_id is null
    or p_expected_plan_row_version is null or p_idempotency_key is null
    or not private.medication_plan_authority(
      p_organization_id, p_branch_id, p_client_id, 'medications.manage'
    )
    or not private.insulin_base_authority(
      p_organization_id, p_branch_id, 'insulin_administrations.execute'
    )
  then
    raise exception using errcode = '42501', message = 'insulin order source proposal is not permitted';
  end if;
  v_challenge := private.require_insulin_reauth(v_actor, v_now);
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'branch_id', p_branch_id,
    'client_id', p_client_id, 'medication_plan_id', p_medication_plan_id,
    'document_id', p_document_id,
    'expected_plan_row_version', p_expected_plan_row_version
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'insulin-order-proposal-key:' || p_organization_id::text || v_actor::text || p_idempotency_key::text, 0
  ));
  select * into v_prior from private.insulin_order_source_evidence
    where organization_id = p_organization_id and proposed_by = v_actor
      and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'insulin order source operation key conflict';
    end if;
    return query select v_prior.id, v_prior.document_sha256, true;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('insulin-order-plan:' || p_medication_plan_id::text, 0));
  select * into v_plan from public.medication_plans
    where id = p_medication_plan_id and organization_id = p_organization_id
      and branch_id = p_branch_id and client_id = p_client_id;
  if not found or v_plan.row_version <> p_expected_plan_row_version
    or v_plan.workflow_version <> 2 or v_plan.workflow_state <> 'approved'
    or v_plan.status <> 'active' or v_plan.approved_by is null or v_plan.signed_at is null
    or v_plan.content_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception using errcode = '23514', message = 'exact approved medication plan is required';
  end if;
  select * into v_document from private.client_document_versions
    where id = p_document_id and organization_id = p_organization_id
      and branch_id = p_branch_id and client_id = p_client_id;
  if not found or not private.insulin_order_document_is_current(
    p_document_id, p_organization_id, p_branch_id, p_client_id,
    greatest(v_now, v_plan.effective_from)
  ) then
    raise exception using errcode = '23514', message = 'clean individually reviewed current order source is required';
  end if;
  if exists(select 1 from private.insulin_order_source_evidence
    where medication_plan_id = p_medication_plan_id) then
    raise exception using errcode = '23505', message = 'order source already proposed for plan';
  end if;
  insert into private.insulin_order_source_evidence(
    organization_id, branch_id, client_id, medication_plan_id,
    medication_plan_version, medication_plan_content_hash,
    document_id, document_sha256, document_version,
    proposed_by, proposed_reauth_challenge_id, proposed_at,
    idempotency_key, request_hash
  ) values (
    p_organization_id, p_branch_id, p_client_id, p_medication_plan_id,
    v_plan.version, v_plan.content_hash,
    p_document_id, v_document.sha256, v_document.version,
    v_actor, v_challenge, v_now, p_idempotency_key, v_hash
  ) returning id into v_id;
  return query select v_id, v_document.sha256, false;
end;
$$;

create function private.approve_insulin_order_source_guarded(
  p_organization_id uuid, p_branch_id uuid, p_client_id uuid,
  p_evidence_id uuid, p_idempotency_key uuid
) returns table(approval_id uuid, evidence_id uuid, replayed boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_challenge uuid;
  v_source private.insulin_order_source_evidence;
  v_prior private.insulin_order_source_approvals;
  v_plan public.medication_plans;
  v_document private.client_document_versions;
  v_hash text;
  v_id uuid;
begin
  if v_actor is null or p_organization_id is null or p_branch_id is null
    or p_client_id is null or p_evidence_id is null or p_idempotency_key is null
    or not private.medication_plan_authority(
      p_organization_id, p_branch_id, p_client_id, 'medications.manage'
    )
    or not private.insulin_base_authority(
      p_organization_id, p_branch_id, 'insulin_administrations.verify'
    )
  then
    raise exception using errcode = '42501', message = 'insulin order source approval is not permitted';
  end if;
  v_challenge := private.require_insulin_reauth(v_actor, v_now);
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_organization_id, 'branch_id', p_branch_id,
    'client_id', p_client_id, 'evidence_id', p_evidence_id,
    'attestation', 'I independently verified the physician order against this exact plan and document version'
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'insulin-order-approval-key:' || p_organization_id::text || v_actor::text || p_idempotency_key::text, 0
  ));
  select * into v_prior from private.insulin_order_source_approvals
    where organization_id = p_organization_id and approved_by = v_actor
      and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'insulin order source approval key conflict';
    end if;
    return query select v_prior.id, v_prior.source_evidence_id, true;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('insulin-order-approval:' || p_evidence_id::text, 0));
  select * into v_source from private.insulin_order_source_evidence
    where id = p_evidence_id and organization_id = p_organization_id
      and branch_id = p_branch_id and client_id = p_client_id;
  if not found or v_source.proposed_by = v_actor then
    raise exception using errcode = '42501', message = 'independent order source reviewer is required';
  end if;
  select * into v_plan from public.medication_plans where id = v_source.medication_plan_id;
  select * into v_document from private.client_document_versions where id = v_source.document_id;
  if v_plan.id is null or v_plan.organization_id <> p_organization_id
    or v_plan.branch_id <> p_branch_id or v_plan.client_id <> p_client_id
    or v_plan.version <> v_source.medication_plan_version
    or v_plan.content_hash <> v_source.medication_plan_content_hash
    or v_plan.workflow_state <> 'approved' or v_plan.status <> 'active'
    or v_document.sha256 is distinct from v_source.document_sha256
    or v_document.version is distinct from v_source.document_version
    or not private.insulin_order_document_is_current(
      v_source.document_id, p_organization_id, p_branch_id, p_client_id,
      greatest(v_now, v_plan.effective_from)
    )
  then
    raise exception using errcode = '23514', message = 'order source or exact plan is no longer current';
  end if;
  if exists(select 1 from private.insulin_order_source_approvals
    where source_evidence_id = p_evidence_id) then
    raise exception using errcode = '23505', message = 'order source already approved';
  end if;
  insert into private.insulin_order_source_approvals(
    source_evidence_id, organization_id, branch_id, client_id,
    approved_by, approval_reauth_challenge_id, attestation,
    approved_at, idempotency_key, request_hash
  ) values (
    p_evidence_id, p_organization_id, p_branch_id, p_client_id,
    v_actor, v_challenge,
    'I independently verified the physician order against this exact plan and document version',
    v_now, p_idempotency_key, v_hash
  ) returning id into v_id;
  return query select v_id, p_evidence_id, false;
end;
$$;

create function public.propose_insulin_order_source(
  p_organization_id uuid, p_branch_id uuid, p_client_id uuid,
  p_medication_plan_id uuid, p_document_id uuid,
  p_expected_plan_row_version bigint, p_idempotency_key uuid
) returns table(evidence_id uuid, document_hash text, replayed boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.propose_insulin_order_source_guarded(
    p_organization_id, p_branch_id, p_client_id, p_medication_plan_id,
    p_document_id, p_expected_plan_row_version, p_idempotency_key
  );
$$;
create function public.approve_insulin_order_source(
  p_organization_id uuid, p_branch_id uuid, p_client_id uuid,
  p_evidence_id uuid, p_idempotency_key uuid
) returns table(approval_id uuid, evidence_id uuid, replayed boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.approve_insulin_order_source_guarded(
    p_organization_id, p_branch_id, p_client_id, p_evidence_id, p_idempotency_key
  );
$$;

-- Source evidence must still be current at the scheduled time. An old linked
-- document cannot silently survive an inactive disposition or expiry.
create or replace function private.insulin_plan_slot_is_valid(
  p_organization_id uuid, p_branch_id uuid, p_client_id uuid,
  p_plan_id uuid, p_governance_version_id uuid, p_scheduled_for timestamptz
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_and(
    plan.workflow_version = 2
    and plan.workflow_state = 'approved'
    and plan.status = 'active'
    and plan.signed_at is not null
    and plan.signed_by is not null
    and plan.content_hash ~ '^[a-f0-9]{64}$'
    and plan.effective_from <= p_scheduled_for
    and (plan.effective_to is null or plan.effective_to > p_scheduled_for)
    and private.medication_plan_is_unique_at_occurrence(
      plan.organization_id, plan.branch_id, plan.client_id,
      plan.record_key, plan.id, p_scheduled_for
    )
    and private.insulin_order_source_is_current(plan.id, p_scheduled_for)
    and jsonb_typeof(plan.schedule -> 'times') = 'array'
    and exists (
      select 1 from jsonb_array_elements_text(plan.schedule -> 'times') schedule_time(value)
      where schedule_time.value ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        and schedule_time.value = to_char(
          p_scheduled_for at time zone 'Asia/Taipei', 'HH24:MI'
        )
    )
  ), false)
  from public.medication_plans plan
  join public.insulin_plan_designations designation
    on designation.medication_plan_id = plan.id
   and designation.organization_id = plan.organization_id
   and designation.branch_id = plan.branch_id
   and designation.client_id = plan.client_id
  join public.insulin_governance_versions designation_rule
    on designation_rule.id = designation.governance_version_id
   and designation_rule.id = p_governance_version_id
   and designation_rule.status = 'published'
   and designation_rule.published_at <= p_scheduled_for
   and designation_rule.effective_from <= p_scheduled_for
   and (designation_rule.effective_to is null
     or designation_rule.effective_to > p_scheduled_for)
  where plan.id = p_plan_id
    and plan.organization_id = p_organization_id
    and plan.branch_id = p_branch_id
    and plan.client_id = p_client_id
    and designation.governance_version_id = p_governance_version_id
    and designation.published_at <= p_scheduled_for
    and plan.dose_unit = designation_rule.dose_unit;
$$;

revoke all on function
  private.insulin_order_document_is_current(uuid,uuid,uuid,uuid,timestamptz),
  private.insulin_order_source_is_current(uuid,timestamptz),
  private.propose_insulin_order_source_guarded(uuid,uuid,uuid,uuid,uuid,bigint,uuid),
  private.approve_insulin_order_source_guarded(uuid,uuid,uuid,uuid,uuid),
  public.propose_insulin_order_source(uuid,uuid,uuid,uuid,uuid,bigint,uuid),
  public.approve_insulin_order_source(uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  private.propose_insulin_order_source_guarded(uuid,uuid,uuid,uuid,uuid,bigint,uuid),
  private.approve_insulin_order_source_guarded(uuid,uuid,uuid,uuid,uuid),
  public.propose_insulin_order_source(uuid,uuid,uuid,uuid,uuid,bigint,uuid),
  public.approve_insulin_order_source(uuid,uuid,uuid,uuid,uuid)
  to authenticated;

commit;
