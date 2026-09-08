-- Page 36: MNA assessment license gate and future immutable result ledger.
--
-- MNA-SF, Long MNA, their translations, item content, answer options and
-- electronic implementation are licensed materials. This migration does not
-- reproduce them and deliberately blocks every formal mutation until a later,
-- reviewed migration installs an authorized locale-specific form and scorer.

insert into public.permissions (permission_key, description, risk_level) values
  ('mna_assessments.read', 'Read assigned-client MNA license state and authorized results', 2),
  ('mna_assessments.manage', 'Create or revise authorized assigned-client MNA assessments', 3),
  ('mna_assessments.sign', 'Sign or correct authorized assigned-client MNA assessments', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and (
    permission.permission_key = 'mna_assessments.read'
      and role.role_key in ('organization_manager', 'branch_supervisor', 'professional')
    or permission.permission_key in ('mna_assessments.manage', 'mna_assessments.sign')
      and role.role_key = 'professional'
  )
on conflict (role_id, permission_id) do nothing;

create table public.mna_assessment_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assessment_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  record_state text not null,
  assessed_on date not null,
  full_assessment_on date,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  service_status_at_assessment text not null,
  short_form_score numeric(4,1) not null,
  short_form_risk text not null,
  full_score numeric(4,1),
  full_risk text,
  reassessment_due_on date,
  reassessment_basis text,
  follow_up_status text not null,
  follow_up_plan text,
  follow_up_owner_display_name text,
  governance_version_id text not null,
  governance_snapshot jsonb not null,
  governance_snapshot_hash text not null,
  source_form_version_reference text not null,
  license_agreement_reference text not null,
  electronic_implementation_approval_reference text not null,
  signed_at timestamptz,
  signed_by_user_id uuid references auth.users(id) on delete restrict,
  signing_reauth_challenge_id uuid
    references private.reauth_challenges(id) on delete restrict,
  correction_of_version_id uuid,
  correction_reason text,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint mna_assessment_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint mna_assessment_id_scope_key unique (
    id, organization_id, branch_id, client_id, assessment_key
  ),
  constraint mna_assessment_chain_key unique (
    organization_id, branch_id, assessment_key, version
  ),
  constraint mna_assessment_previous_key unique (previous_version_id),
  constraint mna_assessment_previous_scope_fkey
    foreign key (
      previous_version_id, organization_id, branch_id, client_id,
      assessment_key
    ) references public.mna_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint mna_assessment_correction_source_scope_fkey
    foreign key (
      correction_of_version_id, organization_id, branch_id, client_id,
      assessment_key
    ) references public.mna_assessment_versions (
      id, organization_id, branch_id, client_id, assessment_key
    ) on delete restrict,
  constraint mna_assessment_version_check check (
    version > 0 and (
      (version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null)
    )
  ),
  constraint mna_assessment_state_check check (
    record_state in ('draft', 'signed', 'corrected')
  ),
  constraint mna_assessment_date_check check (
    extract(year from assessed_on) between 2000 and 2200
    and (full_assessment_on is null or full_assessment_on >= assessed_on)
  ),
  constraint mna_assessment_author_check check (
    char_length(author_display_name) between 1 and 120
    and author_display_name = btrim(author_display_name)
    and author_display_name !~ '[[:cntrl:]]'
  ),
  constraint mna_assessment_service_status_check check (
    service_status_at_assessment in (
      'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  ),
  constraint mna_assessment_score_shape_check check (
    short_form_score between 0 and 14
    and (full_score is null) = (full_risk is null)
    and (full_score is null) = (full_assessment_on is null)
    and (full_score is null or full_score between 0 and 30)
    and short_form_risk in ('normal', 'at_risk', 'malnourished')
    and (full_risk is null or full_risk in ('normal', 'at_risk', 'malnourished'))
  ),
  constraint mna_assessment_follow_up_check check (
    follow_up_status in (
      'not_started', 'planned', 'in_progress', 'completed', 'not_required'
    )
    and (reassessment_due_on is null) = (reassessment_basis is null)
    and (reassessment_basis is null or (
      char_length(btrim(reassessment_basis)) between 1 and 500
      and reassessment_basis = btrim(reassessment_basis)
      and reassessment_basis !~ '[[:cntrl:]]'
    ))
    and (follow_up_plan is null or (
      char_length(btrim(follow_up_plan)) between 1 and 2000
      and follow_up_plan = btrim(follow_up_plan)
      and follow_up_plan !~ '[[:cntrl:]]'
    ))
    and (follow_up_owner_display_name is null or (
      char_length(btrim(follow_up_owner_display_name)) between 1 and 120
      and follow_up_owner_display_name = btrim(follow_up_owner_display_name)
      and follow_up_owner_display_name !~ '[[:cntrl:]]'
    ))
  ),
  constraint mna_assessment_governance_check check (
    governance_version_id <> 'mna-electronic-license-gate-v1'
    and char_length(governance_version_id) between 1 and 200
    and governance_snapshot ->> 'activation_status' = 'activated'
    and governance_snapshot ->> 'formal_use_permitted' = 'true'
    and governance_snapshot ->> 'target_locale' = 'zh-TW'
    and governance_snapshot ->> 'license_agreement_reference'
      = license_agreement_reference
    and governance_snapshot ->> 'electronic_implementation_approval_reference'
      = electronic_implementation_approval_reference
    and governance_snapshot_hash = encode(
      sha256(convert_to(governance_snapshot::text, 'UTF8')), 'hex'
    )
    and char_length(btrim(source_form_version_reference)) between 1 and 240
    and source_form_version_reference = btrim(source_form_version_reference)
    and char_length(btrim(license_agreement_reference)) between 1 and 240
    and license_agreement_reference = btrim(license_agreement_reference)
    and char_length(btrim(electronic_implementation_approval_reference))
      between 1 and 240
    and electronic_implementation_approval_reference
      = btrim(electronic_implementation_approval_reference)
  ),
  constraint mna_assessment_signature_check check (
    (record_state = 'draft' and signed_at is null
      and signed_by_user_id is null and signing_reauth_challenge_id is null)
    or (record_state in ('signed', 'corrected') and signed_at is not null
      and signed_by_user_id is not null
      and signing_reauth_challenge_id is not null)
  ),
  constraint mna_assessment_correction_check check (
    (record_state <> 'corrected' and correction_of_version_id is null
      and correction_reason is null)
    or (record_state = 'corrected' and correction_of_version_id is not null
      and correction_of_version_id = previous_version_id
      and char_length(btrim(correction_reason)) between 1 and 1000
      and correction_reason = btrim(correction_reason)
      and correction_reason !~ '[[:cntrl:]]')
  ),
  constraint mna_assessment_content_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

comment on table public.mna_assessment_versions is
  'Future immutable Page 36 MNA result ledger. No row can be created by the current unlicensed implementation; a reviewed license-specific migration is required.';
comment on column public.mna_assessment_versions.governance_snapshot is
  'Authorized locale/formula/license snapshot only; official questionnaire content is not installed by this migration.';

create table private.mna_assessment_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  action text not null,
  request_hash text not null,
  assessment_key uuid,
  previous_version_id uuid,
  expected_version integer,
  status text not null default 'blocked_license_not_configured',
  created_at timestamptz not null default clock_timestamp(),
  constraint mna_operation_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint mna_operation_actor_idempotency_key unique (
    organization_id, branch_id, actor_user_id, idempotency_key
  ),
  constraint mna_operation_action_check check (
    action in ('create_draft', 'revise_draft', 'sign', 'correct')
  ),
  constraint mna_operation_request_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint mna_operation_version_check check (
    (action = 'create_draft' and assessment_key is null
      and previous_version_id is null and expected_version is null)
    or (action <> 'create_draft' and assessment_key is not null
      and previous_version_id is not null and expected_version > 0)
  ),
  constraint mna_operation_status_check check (
    status = 'blocked_license_not_configured'
  )
);

create index mna_assessment_scope_latest_idx
on public.mna_assessment_versions (
  organization_id, branch_id, client_id, assessed_on desc, created_at desc
);
create index mna_assessment_chain_idx
on public.mna_assessment_versions (assessment_key, version desc);
create index mna_assessment_previous_idx
on public.mna_assessment_versions (previous_version_id);
create index mna_assessment_correction_source_idx
on public.mna_assessment_versions (correction_of_version_id);
create index mna_assessment_author_idx
on public.mna_assessment_versions (author_user_id);
create index mna_assessment_signer_idx
on public.mna_assessment_versions (signed_by_user_id);
create index mna_assessment_signing_reauth_idx
on public.mna_assessment_versions (signing_reauth_challenge_id);
create index mna_operations_client_idx
on private.mna_assessment_operations (client_id);
create index mna_operations_actor_idx
on private.mna_assessment_operations (actor_user_id);

alter table public.mna_assessment_versions enable row level security;
alter table public.mna_assessment_versions force row level security;
alter table private.mna_assessment_operations enable row level security;
alter table private.mna_assessment_operations force row level security;

revoke all on table public.mna_assessment_versions
  from public, anon, authenticated, service_role;
revoke all on table private.mna_assessment_operations
  from public, anon, authenticated, service_role;

create or replace function private.mna_history_is_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'MNA assessment history is append-only';
end;
$$;

create trigger mna_assessment_versions_append_only
before update or delete on public.mna_assessment_versions
for each row execute function private.mna_history_is_append_only();
create trigger mna_assessment_operations_append_only
before update or delete on private.mna_assessment_operations
for each row execute function private.mna_history_is_append_only();

create trigger mna_assessment_versions_audit_row_change
after insert on public.mna_assessment_versions
for each row execute function private.audit_row_change();
create trigger mna_assessment_operations_audit_row_change
after insert on private.mna_assessment_operations
for each row execute function private.audit_row_change();

create or replace function private.mna_current_authority(
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
    and p_permission in (
      'mna_assessments.read', 'mna_assessments.manage',
      'mna_assessments.sign'
    )
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional')
        and profile.is_active
    )
    and (
      p_permission = 'mna_assessments.read'
      or exists (
        select 1 from public.profiles professional_profile
        where professional_profile.id = auth.uid()
          and professional_profile.kind = 'professional'
          and professional_profile.is_active
      )
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

create or replace function private.mna_client_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.mna_current_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission
    )
    and exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
    )
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(p_client_id, p_permission);
$$;

create or replace function private.register_blocked_mna_operation(
  p_action text,
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_form_variant text,
  p_governance_version_id text,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  action text,
  client_id uuid,
  actor_user_id uuid,
  idempotency_key uuid,
  status text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_permission text := case when p_action in ('sign', 'correct')
    then 'mna_assessments.sign' else 'mna_assessments.manage' end;
  v_request_hash text;
  v_row private.mna_assessment_operations%rowtype;
  v_replayed boolean := false;
begin
  if p_action not in ('create_draft', 'revise_draft', 'sign', 'correct')
     or p_expected_organization_id is null or p_expected_branch_id is null
     or p_client_id is null or p_idempotency_key is null
     or not private.mna_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       v_permission
     )
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'MNA operation is not permitted';
  end if;
  if (p_action = 'create_draft' and (
      p_assessment_key is not null or p_previous_version_id is not null
      or p_expected_version is not null or p_assessed_on is null
      or p_form_variant not in ('mna_sf', 'full_mna')
      or p_governance_version_id <> 'mna-electronic-license-gate-v1'
      or p_correction_reason is not null
    )) or (p_action = 'revise_draft' and (
      p_assessment_key is null or p_previous_version_id is null
      or coalesce(p_expected_version, 0) < 1 or p_assessed_on is null
      or p_form_variant not in ('mna_sf', 'full_mna')
      or p_governance_version_id <> 'mna-electronic-license-gate-v1'
      or p_correction_reason is not null
    )) or (p_action = 'sign' and (
      p_assessment_key is null or p_previous_version_id is null
      or coalesce(p_expected_version, 0) < 1 or p_assessed_on is not null
      or p_form_variant is not null or p_governance_version_id is not null
      or p_correction_reason is not null
    )) or (p_action = 'correct' and (
      p_assessment_key is null or p_previous_version_id is null
      or coalesce(p_expected_version, 0) < 1 or p_assessed_on is not null
      or p_form_variant is not null or p_governance_version_id is not null
      or char_length(btrim(coalesce(p_correction_reason, ''))) not between 1 and 1000
      or p_correction_reason <> btrim(p_correction_reason)
      or p_correction_reason ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023',
      message = 'invalid MNA blocked operation contract';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'action', p_action,
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'client_id', p_client_id,
    'assessment_key', p_assessment_key,
    'previous_version_id', p_previous_version_id,
    'expected_version', p_expected_version,
    'assessed_on', p_assessed_on,
    'form_variant', p_form_variant,
    'governance_version_id', p_governance_version_id,
    'correction_reason_hash', case when p_correction_reason is null then null
      else encode(sha256(convert_to(p_correction_reason, 'UTF8')), 'hex') end
  )::text, 'UTF8')), 'hex');

  insert into private.mna_assessment_operations (
    organization_id, branch_id, client_id, actor_user_id,
    idempotency_key, action, request_hash, assessment_key,
    previous_version_id, expected_version
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_idempotency_key, p_action, v_request_hash, p_assessment_key,
    p_previous_version_id, p_expected_version
  )
  on conflict on constraint mna_operation_actor_idempotency_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from private.mna_assessment_operations operation
    where operation.organization_id = p_expected_organization_id
      and operation.branch_id = p_expected_branch_id
      and operation.actor_user_id = v_actor
      and operation.idempotency_key = p_idempotency_key;
    if v_row.request_hash is distinct from v_request_hash then
      raise exception using errcode = '23505',
        message = 'MNA idempotency key was used for different content';
    end if;
    v_replayed := true;
  end if;

  return query select v_row.id, v_row.action, v_row.client_id,
    v_row.actor_user_id, v_row.idempotency_key, v_row.status, v_replayed;
end;
$$;

create or replace function public.create_mna_assessment_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessed_on date,
  p_form_variant text,
  p_governance_version_id text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, client_id uuid, actor_user_id uuid,
  idempotency_key uuid, status text, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.register_blocked_mna_operation(
    'create_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, null, null, null, p_assessed_on, p_form_variant,
    p_governance_version_id, null, p_idempotency_key
  );
$$;

create or replace function public.revise_mna_assessment_draft(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_assessed_on date,
  p_form_variant text,
  p_governance_version_id text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, client_id uuid, actor_user_id uuid,
  idempotency_key uuid, status text, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.register_blocked_mna_operation(
    'revise_draft', p_expected_organization_id, p_expected_branch_id,
    p_client_id, p_assessment_key, p_previous_version_id,
    p_expected_version, p_assessed_on, p_form_variant,
    p_governance_version_id, null, p_idempotency_key
  );
$$;

create or replace function public.sign_mna_assessment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, client_id uuid, actor_user_id uuid,
  idempotency_key uuid, status text, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.register_blocked_mna_operation(
    'sign', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_previous_version_id, p_expected_version,
    null, null, null, null, p_idempotency_key
  );
$$;

create or replace function public.correct_mna_assessment(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_assessment_key uuid,
  p_previous_version_id uuid,
  p_expected_version integer,
  p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, action text, client_id uuid, actor_user_id uuid,
  idempotency_key uuid, status text, replayed boolean
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.register_blocked_mna_operation(
    'correct', p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_assessment_key, p_previous_version_id, p_expected_version,
    null, null, null, p_correction_reason, p_idempotency_key
  );
$$;

create or replace function private.mna_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_risk_filter text,
  p_follow_up_filter text,
  p_reference_time timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with assigned_clients as materialized (
    select client.id, client.display_name, client.status::text as service_status,
      client.admitted_on, client.ended_on
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(client.id, 'mna_assessments.read')
  ), matching as materialized (
    select client.* from assigned_clients client
    where (p_client_id is null or client.id = p_client_id)
      and p_risk_filter in ('all', 'not_assessed')
      and p_follow_up_filter in ('all', 'not_assessed')
  ), stats as (
    select count(*)::bigint as matching_total from matching
  ), bounded as materialized (
    select * from matching
    order by display_name collate "C", id limit 200
  ), items_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', row.id,
      'client_display_name', row.display_name,
      'service_status', row.service_status,
      'admitted_on', row.admitted_on,
      'ended_on', row.ended_on,
      'version_id', null,
      'assessment_key', null,
      'assessment_version', null,
      'record_state', null,
      'assessed_on', null,
      'full_assessment_on', null,
      'author_user_id', null,
      'author_display_name', null,
      'service_status_at_assessment', null,
      'short_form_score', null,
      'short_form_risk', null,
      'full_score', null,
      'full_risk', null,
      'reassessment_due_on', null,
      'reassessment_basis', null,
      'follow_up_status', null,
      'follow_up_plan', null,
      'follow_up_owner_display_name', null,
      'governance_version_id', null,
      'governance_snapshot', null,
      'governance_snapshot_hash', null,
      'source_form_version_reference', null,
      'signed_at', null,
      'signed_by_user_id', null,
      'correction_of_version_id', null,
      'correction_reason', null,
      'content_hash', null,
      'created_at', null,
      'version_history', '[]'::jsonb,
      'version_history_total', 0
    ) order by row.display_name collate "C", row.id), '[]'::jsonb) as items
    from bounded row
  ), client_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option_row.id,
      'display_name', option_row.display_name,
      'service_status', option_row.service_status,
      'admitted_on', option_row.admitted_on,
      'ended_on', option_row.ended_on
    ) order by option_row.display_name collate "C", option_row.id), '[]'::jsonb)
      as client_options,
      (select count(*)::bigint from assigned_clients) as client_total
    from (
      select * from assigned_clients
      order by display_name collate "C", id limit 500
    ) option_row
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'items', items_result.items,
    'item_total', jsonb_array_length(items_result.items),
    'matching_total', stats.matching_total,
    'items_truncated', stats.matching_total > jsonb_array_length(items_result.items),
    'not_assessed_total', stats.matching_total,
    'normal_total', 0,
    'at_risk_total', 0,
    'malnourished_total', 0,
    'follow_up_pending_total', 0,
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated', client_result.client_total >
      jsonb_array_length(client_result.client_options),
    'governance_version_id', 'mna-electronic-license-gate-v1',
    'license_status', 'license_required_not_configured',
    'questionnaire_content_status', 'not_configured',
    'scoring_algorithm_status', 'not_configured',
    'risk_classification_status', 'not_configured',
    'formal_draft_status', 'blocked_license_not_configured',
    'formal_sign_status', 'blocked_license_not_configured',
    'formal_correction_status', 'blocked_license_not_configured',
    'automatic_reassessment_status', 'not_configured',
    'automatic_follow_up_status', 'not_configured',
    'attachment_status', 'not_configured',
    'export_status', 'not_configured',
    'offline_sync_status', 'not_configured',
    'notification_status', 'not_configured'
  )
  from items_result cross join stats cross join client_result;
$$;

create or replace function private.mna_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_risk_filter text,
  p_follow_up_filter text
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  items jsonb, item_total integer, matching_total bigint,
  items_truncated boolean, not_assessed_total bigint,
  normal_total bigint, at_risk_total bigint, malnourished_total bigint,
  follow_up_pending_total bigint, client_options jsonb, client_total bigint,
  client_options_truncated boolean, governance_version_id text,
  license_status text, questionnaire_content_status text,
  scoring_algorithm_status text, risk_classification_status text,
  formal_draft_status text, formal_sign_status text,
  formal_correction_status text, automatic_reassessment_status text,
  automatic_follow_up_status text, attachment_status text,
  export_status text, offline_sync_status text, notification_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_risk text := lower(coalesce(nullif(btrim(p_risk_filter), ''), 'all'));
  v_follow_up text := lower(coalesce(nullif(btrim(p_follow_up_filter), ''), 'all'));
  v_bundle jsonb;
  v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or v_risk not in ('all', 'normal', 'at_risk', 'malnourished', 'not_assessed')
     or v_follow_up not in ('all', 'pending', 'completed', 'not_assessed')
     or not private.mna_current_authority(
       p_expected_organization_id, p_expected_branch_id,
       'mna_assessments.read'
     ) then
    raise exception using errcode = '42501',
      message = 'MNA snapshot is not permitted';
  end if;
  if p_client_id is not null and not private.mna_client_authority(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    'mna_assessments.read'
  ) then
    raise exception using errcode = '42501',
      message = 'MNA client filter is not permitted';
  end if;

  v_bundle := private.mna_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_risk, v_follow_up, v_now
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'mna_assessment_versions', null, '{}'::text[],
    jsonb_build_object(
      'projection', 'page36_mna_license_gate_v1',
      'item_count', (v_bundle ->> 'item_total')::integer,
      'matching_total', (v_bundle ->> 'matching_total')::bigint,
      'item_limit', 200,
      'license_configured', false,
      'official_item_content_returned', false,
      'official_answer_options_returned', false,
      'official_formula_returned', false,
      'formal_result_returned', false,
      'filter_values_logged', false,
      'personal_data_logged', false
    )
  );
  v_after := private.mna_snapshot_bundle(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_risk, v_follow_up, v_now
  );
  if not private.mna_current_authority(
    p_expected_organization_id, p_expected_branch_id,
    'mna_assessments.read'
  ) or v_after is distinct from v_bundle then
    raise exception using errcode = '42501',
      message = 'MNA snapshot final verification failed';
  end if;

  return query select
    (v_bundle ->> 'organization_id')::uuid,
    (v_bundle ->> 'branch_id')::uuid,
    (v_bundle ->> 'generated_at')::timestamptz,
    v_bundle -> 'items',
    (v_bundle ->> 'item_total')::integer,
    (v_bundle ->> 'matching_total')::bigint,
    (v_bundle ->> 'items_truncated')::boolean,
    (v_bundle ->> 'not_assessed_total')::bigint,
    (v_bundle ->> 'normal_total')::bigint,
    (v_bundle ->> 'at_risk_total')::bigint,
    (v_bundle ->> 'malnourished_total')::bigint,
    (v_bundle ->> 'follow_up_pending_total')::bigint,
    v_bundle -> 'client_options',
    (v_bundle ->> 'client_total')::bigint,
    (v_bundle ->> 'client_options_truncated')::boolean,
    v_bundle ->> 'governance_version_id',
    v_bundle ->> 'license_status',
    v_bundle ->> 'questionnaire_content_status',
    v_bundle ->> 'scoring_algorithm_status',
    v_bundle ->> 'risk_classification_status',
    v_bundle ->> 'formal_draft_status',
    v_bundle ->> 'formal_sign_status',
    v_bundle ->> 'formal_correction_status',
    v_bundle ->> 'automatic_reassessment_status',
    v_bundle ->> 'automatic_follow_up_status',
    v_bundle ->> 'attachment_status',
    v_bundle ->> 'export_status',
    v_bundle ->> 'offline_sync_status',
    v_bundle ->> 'notification_status';
end;
$$;

create or replace function public.mna_assessment_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid default null,
  p_risk_filter text default 'all',
  p_follow_up_filter text default 'all'
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  items jsonb, item_total integer, matching_total bigint,
  items_truncated boolean, not_assessed_total bigint,
  normal_total bigint, at_risk_total bigint, malnourished_total bigint,
  follow_up_pending_total bigint, client_options jsonb, client_total bigint,
  client_options_truncated boolean, governance_version_id text,
  license_status text, questionnaire_content_status text,
  scoring_algorithm_status text, risk_classification_status text,
  formal_draft_status text, formal_sign_status text,
  formal_correction_status text, automatic_reassessment_status text,
  automatic_follow_up_status text, attachment_status text,
  export_status text, offline_sync_status text, notification_status text
)
language sql volatile security invoker set search_path = ''
as $$
  select * from private.mna_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_risk_filter, p_follow_up_filter
  );
$$;

create policy mna_assessment_versions_staff_select
on public.mna_assessment_versions for select to authenticated
using (
  private.can_staff_access_client(client_id, 'clients.read')
  and private.can_staff_access_client(client_id, 'mna_assessments.read')
);

revoke all on function private.mna_history_is_append_only()
  from public, anon, authenticated, service_role;
revoke all on function private.mna_current_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.mna_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.register_blocked_mna_operation(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.mna_snapshot_bundle(uuid,uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.mna_snapshot_response(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_mna_assessment_draft(uuid,uuid,uuid,date,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_mna_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sign_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.mna_assessment_snapshot(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_mna_assessment_draft(uuid,uuid,uuid,date,text,text,uuid)
  to authenticated;
grant execute on function public.revise_mna_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,uuid)
  to authenticated;
grant execute on function public.sign_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)
  to authenticated;
grant execute on function public.correct_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)
  to authenticated;
grant execute on function public.mna_assessment_snapshot(uuid,uuid,uuid,text,text)
  to authenticated;

grant execute on function private.register_blocked_mna_operation(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)
  to authenticated;
grant execute on function private.mna_snapshot_response(uuid,uuid,uuid,text,text)
  to authenticated;

comment on function public.create_mna_assessment_draft(uuid,uuid,uuid,date,text,text,uuid)
is 'Records an actor-scoped idempotent blocked attempt; no MNA draft, item content, score or result is created while the licensed electronic implementation is absent.';
comment on function public.mna_assessment_snapshot(uuid,uuid,uuid,text,text)
is 'Assigned-client Page 36 snapshot. Returns license state and no formal results until an authorized implementation is installed.';
