-- Page 58: governed organization / branch profile versions.
--
-- This slice intentionally does not alter the generic organizations or branches
-- tables. Every business change is first frozen as a proposal, then either
-- rejected or materialized as a new immutable effective version by a different
-- recent-AAL2 actor. Official permit, organization-type, service and rate
-- taxonomies are not configured in this release.

insert into public.permissions (permission_key, description, risk_level) values
  ('organization_profile.read', 'Read governed organization profile versions', 2),
  ('organization_profile.manage', 'Submit immutable organization profile proposals', 3),
  ('organization_profile.approve', 'Independently decide organization profile proposals', 3),
  ('organization_profile.permit.manage', 'Manage organization permit fields', 3),
  ('organization_profile.services.manage', 'Manage organization service fields', 3),
  ('organization_profile.rates.manage', 'Manage organization rate fields', 3),
  ('organization_profile.capacity.manage', 'Manage organization capacity fields', 3),
  ('organization_profile.contact.manage', 'Manage organization contact fields', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor')
  and permission.permission_key like 'organization_profile.%'
on conflict (role_id, permission_id) do nothing;

create or replace function private.organization_profile_text_ok(
  p_value text, p_min integer, p_max integer, p_multiline boolean default false
)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_value is not null
    and char_length(btrim(p_value)) between p_min and p_max
    and case when p_multiline
      then translate(p_value, E'\n\r\t', '') !~ '[[:cntrl:]]'
      else p_value !~ '[[:cntrl:]]'
    end;
$$;

create or replace function private.organization_profile_payload_ok(
  p_services jsonb,
  p_rates jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_other jsonb;
  v_from date;
  v_to date;
  v_other_from date;
  v_other_to date;
begin
  if jsonb_typeof(p_services) <> 'array'
     or jsonb_array_length(p_services) > 50
     or jsonb_typeof(p_rates) <> 'array'
     or jsonb_array_length(p_rates) > 100 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_services) loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['service_key','name','description','taxonomy_status'])
       or v_item - array['service_key','name','description','taxonomy_status'] <> '{}'::jsonb
       or coalesce(v_item ->> 'service_key','') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not private.organization_profile_text_ok(v_item ->> 'name', 1, 160)
       or (jsonb_typeof(v_item -> 'description') <> 'null'
         and not private.organization_profile_text_ok(
           v_item ->> 'description', 1, 1000, true
         ))
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then
      return false;
    end if;
  end loop;
  if exists (
    select 1 from (
      select value ->> 'service_key' as service_key,
        lower(btrim(value ->> 'name')) as normalized_name,
        count(*) over (partition by value ->> 'service_key') as key_count,
        count(*) over (partition by lower(btrim(value ->> 'name'))) as name_count
      from jsonb_array_elements(p_services)
    ) duplicate where key_count > 1 or name_count > 1
  ) then return false; end if;

  for v_item in select value from jsonb_array_elements(p_rates) loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'rate_key','label','amount_decimal_text','currency_code',
         'effective_from','effective_to','taxonomy_status'
       ])
       or v_item - array[
         'rate_key','label','amount_decimal_text','currency_code',
         'effective_from','effective_to','taxonomy_status'
       ] <> '{}'::jsonb
       or coalesce(v_item ->> 'rate_key','') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or not private.organization_profile_text_ok(v_item ->> 'label', 1, 160)
       or coalesce(v_item ->> 'amount_decimal_text','') !~
          '^[0-9]{1,18}(\.[0-9]{1,6})?$'
       or coalesce(v_item ->> 'currency_code','') !~ '^[A-Z]{3}$'
       or coalesce(v_item ->> 'effective_from','') !~ '^\d{4}-\d{2}-\d{2}$'
       or (jsonb_typeof(v_item -> 'effective_to') <> 'null'
         and coalesce(v_item ->> 'effective_to','') !~ '^\d{4}-\d{2}-\d{2}$')
       or v_item ->> 'taxonomy_status' <> 'manual_unstandardized' then
      return false;
    end if;
    begin
      v_from := (v_item ->> 'effective_from')::date;
      v_to := case when jsonb_typeof(v_item -> 'effective_to') = 'null'
        then null else (v_item ->> 'effective_to')::date end;
    exception when others then return false;
    end;
    if extract(year from v_from) not between 1900 and 2200
       or (v_to is not null and (
         extract(year from v_to) not between 1900 and 2200 or v_to < v_from
       )) then return false; end if;
  end loop;
  if exists (
    select 1 from (
      select value ->> 'rate_key' as rate_key, count(*) as count
      from jsonb_array_elements(p_rates) group by value ->> 'rate_key'
    ) duplicate where count > 1
  ) then return false; end if;

  -- Rates with the same manually entered label and currency may have multiple
  -- periods, but their periods may never overlap within one frozen profile.
  for v_item in select value from jsonb_array_elements(p_rates) loop
    v_from := (v_item ->> 'effective_from')::date;
    v_to := case when jsonb_typeof(v_item -> 'effective_to') = 'null'
      then null else (v_item ->> 'effective_to')::date end;
    for v_other in select value from jsonb_array_elements(p_rates)
      where value ->> 'rate_key' > v_item ->> 'rate_key'
        and lower(btrim(value ->> 'label')) = lower(btrim(v_item ->> 'label'))
        and value ->> 'currency_code' = v_item ->> 'currency_code'
    loop
      v_other_from := (v_other ->> 'effective_from')::date;
      v_other_to := case when jsonb_typeof(v_other -> 'effective_to') = 'null'
        then null else (v_other ->> 'effective_to')::date end;
      if daterange(v_from, v_to, '[]') && daterange(v_other_from, v_other_to, '[]')
      then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create table public.organization_profile_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  proposal_key uuid not null,
  proposal_number integer not null,
  action text not null,
  profile_key uuid not null,
  base_version_id uuid,
  expected_base_version integer not null,
  effective_from date not null,
  effective_to date,
  permit_number text not null,
  permit_issuing_authority text not null,
  permit_issued_on date not null,
  permit_valid_through date,
  permit_status_text text not null,
  organization_type_text text not null,
  service_items jsonb not null,
  rate_items jsonb not null,
  approved_capacity integer not null,
  capacity_unit_text text not null,
  capacity_basis_text text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  contact_address text not null,
  change_reason text not null,
  taxonomy_status text not null default 'manual_unstandardized',
  attachment_pipeline_status text not null default 'not_configured',
  content_hash text not null,
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_by_display_name text not null,
  proposed_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  proposed_at timestamptz not null,
  constraint organization_profile_proposals_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint organization_profile_proposals_id_scope_key unique
    (id, organization_id, branch_id),
  constraint organization_profile_proposals_key_scope_key unique
    (organization_id, branch_id, proposal_key),
  constraint organization_profile_proposals_number_scope_key unique
    (organization_id, branch_id, proposal_number),
  constraint organization_profile_proposals_action_check check (
    (action = 'create' and base_version_id is null and expected_base_version = 0)
    or (action = 'correct' and base_version_id is not null and expected_base_version > 0)
  ),
  constraint organization_profile_proposals_period_check check (
    extract(year from effective_from) between 1900 and 2200
    and (effective_to is null or (
      effective_to >= effective_from
      and extract(year from effective_to) between 1900 and 2200
    ))
  ),
  constraint organization_profile_proposals_permit_dates_check check (
    extract(year from permit_issued_on) between 1900 and 2200
    and (permit_valid_through is null or (
      permit_valid_through >= permit_issued_on
      and extract(year from permit_valid_through) between 1900 and 2200
    ))
  ),
  constraint organization_profile_proposals_text_check check (
    private.organization_profile_text_ok(permit_number, 1, 160)
    and private.organization_profile_text_ok(permit_issuing_authority, 1, 200)
    and private.organization_profile_text_ok(permit_status_text, 1, 160)
    and private.organization_profile_text_ok(organization_type_text, 1, 160)
    and private.organization_profile_text_ok(capacity_unit_text, 1, 40)
    and private.organization_profile_text_ok(capacity_basis_text, 1, 500, true)
    and private.organization_profile_text_ok(contact_name, 1, 160)
    and private.organization_profile_text_ok(contact_phone, 1, 80)
    and (contact_email is null or (
      private.organization_profile_text_ok(contact_email, 3, 254)
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ))
    and private.organization_profile_text_ok(contact_address, 1, 500, true)
    and private.organization_profile_text_ok(change_reason, 1, 1000, true)
    and private.organization_profile_text_ok(proposed_by_display_name, 1, 120)
  ),
  constraint organization_profile_proposals_capacity_check check (
    approved_capacity between 1 and 1000000
  ),
  constraint organization_profile_proposals_payload_check check (
    private.organization_profile_payload_ok(service_items, rate_items)
  ),
  constraint organization_profile_proposals_taxonomy_check check (
    taxonomy_status = 'manual_unstandardized'
    and attachment_pipeline_status = 'not_configured'
  ),
  constraint organization_profile_proposals_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.organization_profile_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  profile_key uuid not null,
  version integer not null,
  previous_version_id uuid,
  source_proposal_id uuid not null,
  effective_from date not null,
  effective_to date,
  permit_number text not null,
  permit_issuing_authority text not null,
  permit_issued_on date not null,
  permit_valid_through date,
  permit_status_text text not null,
  organization_type_text text not null,
  service_items jsonb not null,
  rate_items jsonb not null,
  approved_capacity integer not null,
  capacity_unit_text text not null,
  capacity_basis_text text not null,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  contact_address text not null,
  change_reason text not null,
  taxonomy_status text not null,
  attachment_pipeline_status text not null,
  content_hash text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_by_display_name text not null,
  approval_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  approved_at timestamptz not null,
  constraint organization_profile_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint organization_profile_versions_id_scope_key unique
    (id, organization_id, branch_id, profile_key),
  constraint organization_profile_versions_id_branch_scope_key unique
    (id, organization_id, branch_id),
  constraint organization_profile_versions_chain_key unique
    (organization_id, branch_id, profile_key, version),
  constraint organization_profile_versions_previous_key unique (previous_version_id),
  constraint organization_profile_versions_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, profile_key)
    references public.organization_profile_versions
      (id, organization_id, branch_id, profile_key) on delete restrict,
  constraint organization_profile_versions_proposal_scope_fkey
    foreign key (source_proposal_id, organization_id, branch_id)
    references public.organization_profile_proposals
      (id, organization_id, branch_id) on delete restrict,
  constraint organization_profile_versions_source_proposal_key unique (source_proposal_id),
  constraint organization_profile_versions_version_check check (
    version > 0 and ((version = 1 and previous_version_id is null)
      or (version > 1 and previous_version_id is not null))
  ),
  constraint organization_profile_versions_period_check check (
    extract(year from effective_from) between 1900 and 2200
    and (effective_to is null or (
      effective_to >= effective_from
      and extract(year from effective_to) between 1900 and 2200
    ))
  ),
  constraint organization_profile_versions_permit_dates_check check (
    extract(year from permit_issued_on) between 1900 and 2200
    and (permit_valid_through is null or (
      permit_valid_through >= permit_issued_on
      and extract(year from permit_valid_through) between 1900 and 2200
    ))
  ),
  constraint organization_profile_versions_text_check check (
    private.organization_profile_text_ok(permit_number, 1, 160)
    and private.organization_profile_text_ok(permit_issuing_authority, 1, 200)
    and private.organization_profile_text_ok(permit_status_text, 1, 160)
    and private.organization_profile_text_ok(organization_type_text, 1, 160)
    and private.organization_profile_text_ok(capacity_unit_text, 1, 40)
    and private.organization_profile_text_ok(capacity_basis_text, 1, 500, true)
    and private.organization_profile_text_ok(contact_name, 1, 160)
    and private.organization_profile_text_ok(contact_phone, 1, 80)
    and (contact_email is null or (
      private.organization_profile_text_ok(contact_email, 3, 254)
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ))
    and private.organization_profile_text_ok(contact_address, 1, 500, true)
    and private.organization_profile_text_ok(change_reason, 1, 1000, true)
    and private.organization_profile_text_ok(approved_by_display_name, 1, 120)
  ),
  constraint organization_profile_versions_capacity_check check (
    approved_capacity between 1 and 1000000
  ),
  constraint organization_profile_versions_payload_check check (
    private.organization_profile_payload_ok(service_items, rate_items)
  ),
  constraint organization_profile_versions_taxonomy_check check (
    taxonomy_status = 'manual_unstandardized'
    and attachment_pipeline_status = 'not_configured'
  ),
  constraint organization_profile_versions_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.organization_profile_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  proposal_id uuid not null,
  decision text not null,
  decision_reason text not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_by_display_name text not null,
  decision_reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  result_version_id uuid,
  decided_at timestamptz not null,
  constraint organization_profile_decisions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint organization_profile_decisions_id_scope_key unique
    (id, organization_id, branch_id),
  constraint organization_profile_decisions_proposal_scope_fkey
    foreign key (proposal_id, organization_id, branch_id)
    references public.organization_profile_proposals
      (id, organization_id, branch_id) on delete restrict,
  constraint organization_profile_decisions_proposal_key unique (proposal_id),
  constraint organization_profile_decisions_decision_check check (
    (decision = 'approve' and result_version_id is not null)
    or (decision = 'reject' and result_version_id is null)
  ),
  constraint organization_profile_decisions_text_check check (
    private.organization_profile_text_ok(decision_reason, 1, 1000, true)
    and private.organization_profile_text_ok(decided_by_display_name, 1, 120)
  )
);

alter table public.organization_profile_decisions
  add constraint organization_profile_decisions_result_scope_fkey
  foreign key (result_version_id, organization_id, branch_id)
  references public.organization_profile_versions (id, organization_id, branch_id)
  on delete restrict;

create table private.organization_profile_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  action text not null,
  request_hash text not null,
  result_proposal_id uuid not null,
  result_decision_id uuid,
  result_version_id uuid,
  result_status text not null,
  reauth_challenge_id uuid not null
    references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null,
  constraint organization_profile_operations_actor_key unique
    (actor_user_id, idempotency_key),
  constraint organization_profile_operations_proposal_scope_fkey
    foreign key (result_proposal_id, organization_id, branch_id)
    references public.organization_profile_proposals
      (id, organization_id, branch_id) on delete restrict,
  constraint organization_profile_operations_decision_scope_fkey
    foreign key (result_decision_id, organization_id, branch_id)
    references public.organization_profile_decisions
      (id, organization_id, branch_id) on delete restrict,
  constraint organization_profile_operations_version_scope_fkey
    foreign key (result_version_id, organization_id, branch_id)
    references public.organization_profile_versions
      (id, organization_id, branch_id) on delete restrict,
  constraint organization_profile_operations_action_check check (
    action in ('propose','approve','reject')
    and result_status in ('pending','approved','rejected')
    and ((action = 'propose' and result_decision_id is null
      and result_version_id is null and result_status = 'pending')
      or (action = 'approve' and result_decision_id is not null
        and result_version_id is not null and result_status = 'approved')
      or (action = 'reject' and result_decision_id is not null
        and result_version_id is null and result_status = 'rejected'))
  ),
  constraint organization_profile_operations_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  )
);

create index organization_profile_proposals_scope_idx on
  public.organization_profile_proposals
  (organization_id, branch_id, proposal_number desc);
create index organization_profile_proposals_profile_idx on
  public.organization_profile_proposals
  (organization_id, branch_id, profile_key, proposed_at desc);
create index organization_profile_proposals_base_idx on
  public.organization_profile_proposals (base_version_id)
  where base_version_id is not null;
create index organization_profile_proposals_actor_idx on
  public.organization_profile_proposals (proposed_by, proposed_at desc);
create index organization_profile_proposals_reauth_idx on
  public.organization_profile_proposals (proposed_reauth_challenge_id);
create index organization_profile_versions_scope_idx on
  public.organization_profile_versions
  (organization_id, branch_id, effective_from desc, profile_key, version desc);
create index organization_profile_versions_previous_idx on
  public.organization_profile_versions (previous_version_id)
  where previous_version_id is not null;
create index organization_profile_versions_approver_idx on
  public.organization_profile_versions (approved_by, approved_at desc);
create index organization_profile_versions_reauth_idx on
  public.organization_profile_versions (approval_reauth_challenge_id);
create index organization_profile_decisions_scope_idx on
  public.organization_profile_decisions
  (organization_id, branch_id, decided_at desc);
create index organization_profile_decisions_actor_idx on
  public.organization_profile_decisions (decided_by, decided_at desc);
create index organization_profile_decisions_reauth_idx on
  public.organization_profile_decisions (decision_reauth_challenge_id);
create index organization_profile_decisions_result_idx on
  public.organization_profile_decisions (result_version_id)
  where result_version_id is not null;
create index organization_profile_operations_scope_idx on
  private.organization_profile_operations
  (organization_id, branch_id, created_at desc);
create index organization_profile_operations_proposal_idx on
  private.organization_profile_operations (result_proposal_id);
create index organization_profile_operations_decision_idx on
  private.organization_profile_operations (result_decision_id)
  where result_decision_id is not null;
create index organization_profile_operations_version_idx on
  private.organization_profile_operations (result_version_id)
  where result_version_id is not null;
create index organization_profile_operations_reauth_idx on
  private.organization_profile_operations (reauth_challenge_id);

alter table public.organization_profile_proposals enable row level security;
alter table public.organization_profile_proposals force row level security;
alter table public.organization_profile_versions enable row level security;
alter table public.organization_profile_versions force row level security;
alter table public.organization_profile_decisions enable row level security;
alter table public.organization_profile_decisions force row level security;
alter table private.organization_profile_operations enable row level security;
alter table private.organization_profile_operations force row level security;

create or replace function private.organization_profile_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'organization profile history is immutable';
end;
$$;

create trigger organization_profile_proposals_append_only
before update or delete on public.organization_profile_proposals
for each row execute function private.organization_profile_append_only();
create trigger organization_profile_versions_append_only
before update or delete on public.organization_profile_versions
for each row execute function private.organization_profile_append_only();
create trigger organization_profile_decisions_append_only
before update or delete on public.organization_profile_decisions
for each row execute function private.organization_profile_append_only();
create trigger organization_profile_operations_append_only
before update or delete on private.organization_profile_operations
for each row execute function private.organization_profile_append_only();
create trigger organization_profile_proposals_audit_row_change
after insert on public.organization_profile_proposals
for each row execute function private.audit_row_change();
create trigger organization_profile_versions_audit_row_change
after insert on public.organization_profile_versions
for each row execute function private.audit_row_change();
create trigger organization_profile_decisions_audit_row_change
after insert on public.organization_profile_decisions
for each row execute function private.audit_row_change();
create trigger organization_profile_operations_audit_row_change
after insert on private.organization_profile_operations
for each row execute function private.audit_row_change();

create or replace function private.organization_profile_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text,
  p_require_recent_aal2 boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal','') = 'aal2'
    and (not p_require_recent_aal2 or private.has_recent_aal2(15))
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.is_active
        and profile.kind in ('staff','professional','driver','finance')
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

create or replace function private.organization_profile_all_field_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select bool_and(private.has_permission(
    p_expected_organization_id, p_expected_branch_id, permission_key
  )) from unnest(array[
    'organization_profile.permit.manage',
    'organization_profile.services.manage',
    'organization_profile.rates.manage',
    'organization_profile.capacity.manage',
    'organization_profile.contact.manage'
  ]) permission_key;
$$;

create or replace function private.require_organization_profile_reauth(
  p_actor uuid,
  p_reference_time timestamptz
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or coalesce(auth.jwt() ->> 'aal','') <> 'aal2'
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'recent organization profile AAL2 evidence is required';
  end if;
  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501',
      message = 'recent organization profile AAL2 evidence is required';
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
    raise exception using errcode = '42501',
      message = 'recent organization profile AAL2 evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.submit_organization_profile_proposal_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_action text,
  p_proposal_key uuid,
  p_profile_key uuid,
  p_base_version_id uuid,
  p_expected_base_version integer,
  p_effective_from date,
  p_effective_to date,
  p_permit_number text,
  p_permit_issuing_authority text,
  p_permit_issued_on date,
  p_permit_valid_through date,
  p_permit_status_text text,
  p_organization_type_text text,
  p_service_items jsonb,
  p_rate_items jsonb,
  p_approved_capacity integer,
  p_capacity_unit_text text,
  p_capacity_basis_text text,
  p_contact_name text,
  p_contact_phone text,
  p_contact_email text,
  p_contact_address text,
  p_change_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, proposal_id uuid,
  proposal_key uuid, proposal_number integer, proposal_status text,
  action text, profile_key uuid, expected_base_version integer,
  content_hash text, proposed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz; v_reauth uuid;
  v_actor_name text; v_request_hash text; v_content_hash text;
  v_existing private.organization_profile_operations%rowtype;
  v_result public.organization_profile_proposals%rowtype;
  v_base public.organization_profile_versions%rowtype;
  v_number integer;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or not private.organization_profile_authority(
       p_expected_organization_id, p_expected_branch_id,
       'organization_profile.manage', true
     ) or not private.organization_profile_all_field_authority(
       p_expected_organization_id, p_expected_branch_id
     ) then
    raise exception using errcode = '42501',
      message = 'organization profile proposal is not permitted';
  end if;
  v_now := clock_timestamp();
  v_reauth := private.require_organization_profile_reauth(v_actor, v_now);
  if p_idempotency_key is null then
    raise exception using errcode = '22023',
      message = 'organization profile proposal key is required';
  end if;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'action',p_action,'proposal_key',p_proposal_key,'profile_key',p_profile_key,
    'base_version_id',p_base_version_id,'expected_base_version',p_expected_base_version,
    'effective_from',p_effective_from,'effective_to',p_effective_to,
    'permit_number',p_permit_number,'permit_issuing_authority',p_permit_issuing_authority,
    'permit_issued_on',p_permit_issued_on,'permit_valid_through',p_permit_valid_through,
    'permit_status_text',p_permit_status_text,
    'organization_type_text',p_organization_type_text,
    'service_items',p_service_items,'rate_items',p_rate_items,
    'approved_capacity',p_approved_capacity,'capacity_unit_text',p_capacity_unit_text,
    'capacity_basis_text',p_capacity_basis_text,'contact_name',p_contact_name,
    'contact_phone',p_contact_phone,'contact_email',p_contact_email,
    'contact_address',p_contact_address,'change_reason',p_change_reason
  )::text,'UTF8')),'hex');
  select operation.* into v_existing from private.organization_profile_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.action <> 'propose' or v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505',
        message = 'organization profile idempotency conflict';
    end if;
    select proposal.* into strict v_result
    from public.organization_profile_proposals proposal
    where proposal.id = v_existing.result_proposal_id
      and proposal.organization_id = p_expected_organization_id
      and proposal.branch_id = p_expected_branch_id;
    return query select v_result.organization_id,v_result.branch_id,v_result.id,
      v_result.proposal_key,v_result.proposal_number,'pending'::text,
      v_result.action,v_result.profile_key,v_result.expected_base_version,
      v_result.content_hash,v_result.proposed_at,true;
    return;
  end if;
  -- Body validation deliberately follows both permission and same-session AAL2.
  if p_action not in ('create','correct') or p_proposal_key is null
     or p_profile_key is null or p_expected_base_version is null
     or p_effective_from is null or p_permit_issued_on is null
     or p_approved_capacity is null
     or not private.organization_profile_text_ok(p_permit_number,1,160)
     or not private.organization_profile_text_ok(p_permit_issuing_authority,1,200)
     or not private.organization_profile_text_ok(p_permit_status_text,1,160)
     or not private.organization_profile_text_ok(p_organization_type_text,1,160)
     or not private.organization_profile_text_ok(p_capacity_unit_text,1,40)
     or not private.organization_profile_text_ok(p_capacity_basis_text,1,500,true)
     or not private.organization_profile_text_ok(p_contact_name,1,160)
     or not private.organization_profile_text_ok(p_contact_phone,1,80)
     or (p_contact_email is not null and (
       not private.organization_profile_text_ok(p_contact_email,3,254)
       or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     ))
     or not private.organization_profile_text_ok(p_contact_address,1,500,true)
     or not private.organization_profile_text_ok(p_change_reason,1,1000,true)
     or p_approved_capacity not between 1 and 1000000
     or extract(year from p_effective_from) not between 1900 and 2200
     or (p_effective_to is not null and (p_effective_to < p_effective_from
       or extract(year from p_effective_to) not between 1900 and 2200))
     or extract(year from p_permit_issued_on) not between 1900 and 2200
     or (p_permit_valid_through is not null and (
       p_permit_valid_through < p_permit_issued_on
       or extract(year from p_permit_valid_through) not between 1900 and 2200))
     or not private.organization_profile_payload_ok(p_service_items,p_rate_items)
  then raise exception using errcode = '22023',
    message = 'organization profile proposal content is invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_expected_organization_id::text || ':' || p_expected_branch_id::text, 58
  ));
  if p_action = 'create' then
    if p_base_version_id is not null or p_expected_base_version <> 0
       or exists (select 1 from public.organization_profile_versions version_row
         where version_row.organization_id=p_expected_organization_id
           and version_row.branch_id=p_expected_branch_id
           and version_row.profile_key=p_profile_key) then
      raise exception using errcode = '40001',
        message = 'organization profile base version changed';
    end if;
  else
    if p_base_version_id is null or p_expected_base_version < 1 then
      raise exception using errcode = '22023',
        message = 'organization profile correction base is invalid';
    end if;
    select version_row.* into v_base
    from public.organization_profile_versions version_row
    where version_row.id=p_base_version_id
      and version_row.organization_id=p_expected_organization_id
      and version_row.branch_id=p_expected_branch_id
      and version_row.profile_key=p_profile_key
    for key share;
    if not found or v_base.version <> p_expected_base_version
       or exists (select 1 from public.organization_profile_versions child
         where child.previous_version_id=v_base.id) then
      raise exception using errcode = '40001',
        message = 'organization profile base version changed';
    end if;
  end if;
  select coalesce(max(existing_proposal.proposal_number),0)+1 into v_number
  from public.organization_profile_proposals existing_proposal
  where existing_proposal.organization_id=p_expected_organization_id
    and existing_proposal.branch_id=p_expected_branch_id;
  select display_name into strict v_actor_name from public.profiles where id=v_actor;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'profile_key',p_profile_key,'effective_from',p_effective_from,
    'effective_to',p_effective_to,'permit_number',btrim(p_permit_number),
    'permit_issuing_authority',btrim(p_permit_issuing_authority),
    'permit_issued_on',p_permit_issued_on,'permit_valid_through',p_permit_valid_through,
    'permit_status_text',btrim(p_permit_status_text),
    'organization_type_text',btrim(p_organization_type_text),
    'service_items',p_service_items,'rate_items',p_rate_items,
    'approved_capacity',p_approved_capacity,'capacity_unit_text',btrim(p_capacity_unit_text),
    'capacity_basis_text',btrim(p_capacity_basis_text),
    'contact_name',btrim(p_contact_name),'contact_phone',btrim(p_contact_phone),
    'contact_email',case when p_contact_email is null then null else btrim(p_contact_email) end,
    'contact_address',btrim(p_contact_address),
    'change_reason',btrim(p_change_reason)
  )::text,'UTF8')),'hex');
  insert into public.organization_profile_proposals (
    organization_id,branch_id,proposal_key,proposal_number,action,profile_key,
    base_version_id,expected_base_version,effective_from,effective_to,
    permit_number,permit_issuing_authority,permit_issued_on,permit_valid_through,
    permit_status_text,organization_type_text,service_items,rate_items,
    approved_capacity,capacity_unit_text,capacity_basis_text,contact_name,
    contact_phone,contact_email,contact_address,change_reason,content_hash,
    proposed_by,proposed_by_display_name,proposed_reauth_challenge_id,proposed_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,p_proposal_key,v_number,p_action,
    p_profile_key,p_base_version_id,p_expected_base_version,p_effective_from,p_effective_to,
    btrim(p_permit_number),btrim(p_permit_issuing_authority),p_permit_issued_on,
    p_permit_valid_through,btrim(p_permit_status_text),btrim(p_organization_type_text),
    p_service_items,p_rate_items,p_approved_capacity,btrim(p_capacity_unit_text),
    btrim(p_capacity_basis_text),btrim(p_contact_name),btrim(p_contact_phone),
    case when p_contact_email is null then null else btrim(p_contact_email) end,
    btrim(p_contact_address),btrim(p_change_reason),v_content_hash,v_actor,
    v_actor_name,v_reauth,v_now
  ) returning * into v_result;
  insert into private.organization_profile_operations (
    organization_id,branch_id,actor_user_id,idempotency_key,action,request_hash,
    result_proposal_id,result_decision_id,result_version_id,result_status,
    reauth_challenge_id,created_at
  ) values (p_expected_organization_id,p_expected_branch_id,v_actor,
    p_idempotency_key,'propose',v_request_hash,v_result.id,null,null,'pending',
    v_reauth,v_now);
  return query select v_result.organization_id,v_result.branch_id,v_result.id,
    v_result.proposal_key,v_result.proposal_number,'pending'::text,v_result.action,
    v_result.profile_key,v_result.expected_base_version,v_result.content_hash,
    v_result.proposed_at,false;
end;
$$;

create or replace function private.decide_organization_profile_proposal_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_proposal_id uuid,
  p_expected_proposal_number integer,
  p_expected_base_version integer,
  p_decision text,
  p_decision_reason text,
  p_idempotency_key uuid
)
returns table(
  organization_id uuid, branch_id uuid, proposal_id uuid,
  decision_id uuid, decision text, proposal_status text,
  result_version_id uuid, profile_key uuid, result_version integer,
  effective_from date, effective_to date, content_hash text,
  decided_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_now timestamptz; v_reauth uuid; v_actor_name text;
  v_hash text; v_existing private.organization_profile_operations%rowtype;
  v_proposal public.organization_profile_proposals%rowtype;
  v_base public.organization_profile_versions%rowtype;
  v_version public.organization_profile_versions%rowtype;
  v_decision public.organization_profile_decisions%rowtype;
  v_new_version integer; v_previous uuid;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or not private.organization_profile_authority(
       p_expected_organization_id,p_expected_branch_id,
       'organization_profile.approve',true
     ) or not private.organization_profile_all_field_authority(
       p_expected_organization_id,p_expected_branch_id
     ) then raise exception using errcode='42501',
       message='organization profile decision is not permitted'; end if;
  v_now:=clock_timestamp();
  v_reauth:=private.require_organization_profile_reauth(v_actor,v_now);
  if p_idempotency_key is null then raise exception using errcode='22023',
    message='organization profile decision key is required'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
    'proposal_id',p_proposal_id,'expected_proposal_number',p_expected_proposal_number,
    'expected_base_version',p_expected_base_version,'decision',p_decision,
    'decision_reason',p_decision_reason
  )::text,'UTF8')),'hex');
  select operation.* into v_existing from private.organization_profile_operations operation
  where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.action<>p_decision or v_existing.request_hash<>v_hash then
      raise exception using errcode='23505',
        message='organization profile idempotency conflict'; end if;
    select decision_row.* into strict v_decision
    from public.organization_profile_decisions decision_row
    where decision_row.id=v_existing.result_decision_id;
    if v_existing.result_version_id is not null then
      select version_row.* into strict v_version
      from public.organization_profile_versions version_row
      where version_row.id=v_existing.result_version_id;
    end if;
    select proposal.* into strict v_proposal
    from public.organization_profile_proposals proposal
    where proposal.id=v_existing.result_proposal_id;
    return query select v_proposal.organization_id,v_proposal.branch_id,v_proposal.id,
      v_decision.id,v_decision.decision,v_existing.result_status,
      v_version.id,v_proposal.profile_key,v_version.version,
      v_version.effective_from,v_version.effective_to,v_proposal.content_hash,
      v_decision.decided_at,true;
    return;
  end if;
  -- Decision content is parsed only after both approval and field scopes pass.
  if p_proposal_id is null or p_expected_proposal_number is null
     or p_expected_proposal_number<1 or p_expected_base_version is null
     or p_expected_base_version<0 or p_decision not in ('approve','reject')
     or not private.organization_profile_text_ok(p_decision_reason,1,1000,true)
  then raise exception using errcode='22023',
    message='organization profile decision content is invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_expected_organization_id::text||':'||p_expected_branch_id::text,58
  ));
  select proposal.* into v_proposal from public.organization_profile_proposals proposal
  where proposal.id=p_proposal_id
    and proposal.organization_id=p_expected_organization_id
    and proposal.branch_id=p_expected_branch_id for key share;
  if not found or v_proposal.proposal_number<>p_expected_proposal_number
     or v_proposal.expected_base_version<>p_expected_base_version then
    raise exception using errcode='40001',
      message='organization profile proposal version changed'; end if;
  if v_proposal.proposed_by=v_actor then raise exception using errcode='42501',
    message='organization profile proposal requires an independent reviewer'; end if;
  if exists(select 1 from public.organization_profile_decisions decision_row
    where decision_row.proposal_id=v_proposal.id) then
    raise exception using errcode='40001',
      message='organization profile proposal already decided'; end if;
  select display_name into strict v_actor_name from public.profiles where id=v_actor;
  if p_decision='approve' then
    if v_proposal.action='create' then
      if exists(select 1 from public.organization_profile_versions version_row
        where version_row.organization_id=p_expected_organization_id
          and version_row.branch_id=p_expected_branch_id
          and version_row.profile_key=v_proposal.profile_key) then
        raise exception using errcode='40001',
          message='organization profile base version changed'; end if;
      v_new_version:=1; v_previous:=null;
    else
      select version_row.* into v_base from public.organization_profile_versions version_row
      where version_row.id=v_proposal.base_version_id
        and version_row.organization_id=p_expected_organization_id
        and version_row.branch_id=p_expected_branch_id
        and version_row.profile_key=v_proposal.profile_key for key share;
      if not found or v_base.version<>v_proposal.expected_base_version
         or exists(select 1 from public.organization_profile_versions child
           where child.previous_version_id=v_base.id) then
        raise exception using errcode='40001',
          message='organization profile base version changed'; end if;
      v_new_version:=v_base.version+1; v_previous:=v_base.id;
    end if;
    if exists (
      select 1 from public.organization_profile_versions other
      where other.organization_id=p_expected_organization_id
        and other.branch_id=p_expected_branch_id
        and other.profile_key<>v_proposal.profile_key
        and not exists(select 1 from public.organization_profile_versions child
          where child.previous_version_id=other.id)
        and daterange(other.effective_from,other.effective_to,'[]') &&
          daterange(v_proposal.effective_from,v_proposal.effective_to,'[]')
    ) then raise exception using errcode='23514',
      message='organization profile effective periods overlap'; end if;
    insert into public.organization_profile_versions (
      organization_id,branch_id,profile_key,version,previous_version_id,
      source_proposal_id,effective_from,effective_to,permit_number,
      permit_issuing_authority,permit_issued_on,permit_valid_through,
      permit_status_text,organization_type_text,service_items,rate_items,
      approved_capacity,capacity_unit_text,capacity_basis_text,contact_name,
      contact_phone,contact_email,contact_address,change_reason,taxonomy_status,
      attachment_pipeline_status,content_hash,approved_by,approved_by_display_name,
      approval_reauth_challenge_id,approved_at
    ) select proposal_row.organization_id,proposal_row.branch_id,
      proposal_row.profile_key,v_new_version,v_previous,proposal_row.id,
      proposal_row.effective_from,proposal_row.effective_to,
      proposal_row.permit_number,proposal_row.permit_issuing_authority,
      proposal_row.permit_issued_on,proposal_row.permit_valid_through,
      proposal_row.permit_status_text,proposal_row.organization_type_text,
      proposal_row.service_items,proposal_row.rate_items,
      proposal_row.approved_capacity,proposal_row.capacity_unit_text,
      proposal_row.capacity_basis_text,proposal_row.contact_name,
      proposal_row.contact_phone,proposal_row.contact_email,
      proposal_row.contact_address,proposal_row.change_reason,
      proposal_row.taxonomy_status,proposal_row.attachment_pipeline_status,
      proposal_row.content_hash,v_actor,v_actor_name,v_reauth,v_now
    from public.organization_profile_proposals proposal_row
    where proposal_row.id=v_proposal.id
    returning * into v_version;
  end if;
  insert into public.organization_profile_decisions (
    organization_id,branch_id,proposal_id,decision,decision_reason,decided_by,
    decided_by_display_name,decision_reauth_challenge_id,result_version_id,decided_at
  ) values (p_expected_organization_id,p_expected_branch_id,v_proposal.id,p_decision,
    btrim(p_decision_reason),v_actor,v_actor_name,v_reauth,v_version.id,v_now)
  returning * into v_decision;
  insert into private.organization_profile_operations (
    organization_id,branch_id,actor_user_id,idempotency_key,action,request_hash,
    result_proposal_id,result_decision_id,result_version_id,result_status,
    reauth_challenge_id,created_at
  ) values (p_expected_organization_id,p_expected_branch_id,v_actor,
    p_idempotency_key,p_decision,v_hash,v_proposal.id,v_decision.id,v_version.id,
    case when p_decision='approve' then 'approved' else 'rejected' end,
    v_reauth,v_now);
  return query select v_proposal.organization_id,v_proposal.branch_id,v_proposal.id,
    v_decision.id,v_decision.decision,
    case when p_decision='approve' then 'approved' else 'rejected' end,
    v_version.id,v_proposal.profile_key,v_version.version,
    v_version.effective_from,v_version.effective_to,v_proposal.content_hash,
    v_decision.decided_at,false;
end;
$$;

create or replace function private.organization_profile_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_now timestamptz
)
returns jsonb language sql stable security definer set search_path = '' as $$
with terminal as (
  select version_row.* from public.organization_profile_versions version_row
  where version_row.organization_id=p_expected_organization_id
    and version_row.branch_id=p_expected_branch_id
    and not exists(select 1 from public.organization_profile_versions child
      where child.previous_version_id=version_row.id)
), terminal_total as (select count(*)::bigint value from terminal),
version_rows as (
  select jsonb_build_object(
    'version_id',version_row.id,'profile_key',version_row.profile_key,
    'version',version_row.version,'previous_version_id',version_row.previous_version_id,
    'source_proposal_id',version_row.source_proposal_id,
    'effective_from',version_row.effective_from,'effective_to',version_row.effective_to,
    'permit_number',version_row.permit_number,
    'permit_issuing_authority',version_row.permit_issuing_authority,
    'permit_issued_on',version_row.permit_issued_on,
    'permit_valid_through',version_row.permit_valid_through,
    'permit_status_text',version_row.permit_status_text,
    'organization_type_text',version_row.organization_type_text,
    'service_items',version_row.service_items,'rate_items',version_row.rate_items,
    'approved_capacity',version_row.approved_capacity,
    'capacity_unit_text',version_row.capacity_unit_text,
    'capacity_basis_text',version_row.capacity_basis_text,
    'contact_name',version_row.contact_name,'contact_phone',version_row.contact_phone,
    'contact_email',version_row.contact_email,'contact_address',version_row.contact_address,
    'change_reason',version_row.change_reason,
    'taxonomy_status',version_row.taxonomy_status,
    'attachment_pipeline_status',version_row.attachment_pipeline_status,
    'content_hash',version_row.content_hash,'approved_by',version_row.approved_by,
    'approved_by_display_name',version_row.approved_by_display_name,
    'approved_at',version_row.approved_at
  ) item from terminal version_row
  order by version_row.effective_from desc,version_row.profile_key limit 100
), history_total as (
  select count(*)::bigint value from public.organization_profile_versions
  where organization_id=p_expected_organization_id and branch_id=p_expected_branch_id
), history_rows as (
  select jsonb_build_object(
    'version_id',version_row.id,'profile_key',version_row.profile_key,
    'version',version_row.version,'previous_version_id',version_row.previous_version_id,
    'source_proposal_id',version_row.source_proposal_id,
    'effective_from',version_row.effective_from,'effective_to',version_row.effective_to,
    'content_hash',version_row.content_hash,'approved_by_display_name',
    version_row.approved_by_display_name,'approved_at',version_row.approved_at,
    'change_reason',version_row.change_reason
  ) item from public.organization_profile_versions version_row
  where version_row.organization_id=p_expected_organization_id
    and version_row.branch_id=p_expected_branch_id
  order by version_row.approved_at desc,version_row.id limit 300
), proposal_total as (
  select count(*)::bigint value from public.organization_profile_proposals
  where organization_id=p_expected_organization_id and branch_id=p_expected_branch_id
), proposal_rows as (
  select jsonb_build_object(
    'proposal_id',proposal.id,'proposal_key',proposal.proposal_key,
    'proposal_number',proposal.proposal_number,'action',proposal.action,
    'profile_key',proposal.profile_key,'base_version_id',proposal.base_version_id,
    'expected_base_version',proposal.expected_base_version,
    'effective_from',proposal.effective_from,'effective_to',proposal.effective_to,
    'permit_number',proposal.permit_number,
    'permit_issuing_authority',proposal.permit_issuing_authority,
    'permit_issued_on',proposal.permit_issued_on,
    'permit_valid_through',proposal.permit_valid_through,
    'permit_status_text',proposal.permit_status_text,
    'organization_type_text',proposal.organization_type_text,
    'service_items',proposal.service_items,'rate_items',proposal.rate_items,
    'approved_capacity',proposal.approved_capacity,
    'capacity_unit_text',proposal.capacity_unit_text,
    'capacity_basis_text',proposal.capacity_basis_text,
    'contact_name',proposal.contact_name,'contact_phone',proposal.contact_phone,
    'contact_email',proposal.contact_email,'contact_address',proposal.contact_address,
    'change_reason',proposal.change_reason,'taxonomy_status',proposal.taxonomy_status,
    'attachment_pipeline_status',proposal.attachment_pipeline_status,
    'content_hash',proposal.content_hash,'proposed_by',proposal.proposed_by,
    'proposed_by_display_name',proposal.proposed_by_display_name,
    'proposed_at',proposal.proposed_at,
    'status',case when decision.id is null then 'pending'
      when decision.decision='approve' then 'approved' else 'rejected' end,
    'decision_id',decision.id,'decision',decision.decision,
    'decision_reason',decision.decision_reason,
    'decided_by',decision.decided_by,
    'decided_by_display_name',decision.decided_by_display_name,
    'decided_at',decision.decided_at,'result_version_id',decision.result_version_id
  ) item from public.organization_profile_proposals proposal
  left join public.organization_profile_decisions decision
    on decision.proposal_id=proposal.id
  where proposal.organization_id=p_expected_organization_id
    and proposal.branch_id=p_expected_branch_id
  order by proposal.proposal_number desc limit 100
), metrics as (
  select count(*) filter(where effective_from <= (p_now at time zone 'Asia/Taipei')::date
      and (effective_to is null or effective_to >= (p_now at time zone 'Asia/Taipei')::date))::bigint active_total,
    count(*) filter(where permit_valid_through is not null
      and permit_valid_through < (p_now at time zone 'Asia/Taipei')::date)::bigint expired_permit_total,
    max(approved_capacity) filter(where effective_from <= (p_now at time zone 'Asia/Taipei')::date
      and (effective_to is null or effective_to >= (p_now at time zone 'Asia/Taipei')::date))::integer active_capacity
  from terminal
), proposal_metrics as (
  select count(*) filter(where decision.id is null)::bigint pending_total
  from public.organization_profile_proposals proposal
  left join public.organization_profile_decisions decision on decision.proposal_id=proposal.id
  where proposal.organization_id=p_expected_organization_id
    and proposal.branch_id=p_expected_branch_id
)
select jsonb_build_object(
  'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
  'generated_at',p_now,'snapshot_date',(p_now at time zone 'Asia/Taipei')::date,
  'versions',coalesce((select jsonb_agg(item) from version_rows),'[]'::jsonb),
  'version_total',(select value from terminal_total),
  'versions_truncated',(select value>100 from terminal_total),
  'history',coalesce((select jsonb_agg(item) from history_rows),'[]'::jsonb),
  'history_total',(select value from history_total),
  'history_truncated',(select value>300 from history_total),
  'proposals',coalesce((select jsonb_agg(item) from proposal_rows),'[]'::jsonb),
  'proposal_total',(select value from proposal_total),
  'proposals_truncated',(select value>100 from proposal_total),
  'active_version_total',(select active_total from metrics),
  'pending_proposal_total',(select pending_total from proposal_metrics),
  'expired_permit_total',(select expired_permit_total from metrics),
  'active_capacity',(select active_capacity from metrics),
  'official_taxonomy_status','not_configured',
  'manual_taxonomy_status','manual_unstandardized',
  'permit_expiry_reminder_status','not_configured',
  'attachment_pipeline_status','not_configured',
  'export_status','disabled','regulator_sync_status','disabled',
  'offline_status','disabled','recent_aal2_max_age_minutes',15
);
$$;

create or replace function private.organization_profile_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid, branch_id uuid, generated_at timestamptz,
  snapshot_date date, versions jsonb, version_total bigint,
  versions_truncated boolean, history jsonb, history_total bigint,
  history_truncated boolean, proposals jsonb, proposal_total bigint,
  proposals_truncated boolean, active_version_total bigint,
  pending_proposal_total bigint, expired_permit_total bigint,
  active_capacity integer, official_taxonomy_status text,
  manual_taxonomy_status text, permit_expiry_reminder_status text,
  attachment_pipeline_status text, export_status text,
  regulator_sync_status text, offline_status text,
  recent_aal2_max_age_minutes integer
)
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_now timestamptz; v_bundle jsonb; v_after jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or not private.organization_profile_authority(
       p_expected_organization_id,p_expected_branch_id,
       'organization_profile.read',false
     ) then raise exception using errcode='42501',
       message='organization profile snapshot is not permitted'; end if;
  v_now:=clock_timestamp();
  v_bundle:=private.organization_profile_snapshot_bundle(
    p_expected_organization_id,p_expected_branch_id,v_now
  );
  insert into public.audit_events(
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,
    changed_fields,metadata
  ) values (p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'organization_profile_snapshot',p_expected_branch_id::text,
    array['bounded_snapshot'],jsonb_build_object(
      'workflow','page58_organization_profile_v1','generated_at',v_now,
      'version_total',v_bundle->'version_total',
      'proposal_total',v_bundle->'proposal_total',
      'pending_proposal_total',v_bundle->'pending_proposal_total'
    ));
  if not private.organization_profile_authority(
    p_expected_organization_id,p_expected_branch_id,
    'organization_profile.read',false
  ) then raise exception using errcode='42501',
    message='organization profile snapshot final verification failed'; end if;
  v_after:=private.organization_profile_snapshot_bundle(
    p_expected_organization_id,p_expected_branch_id,v_now
  );
  if v_after is distinct from v_bundle then raise exception using errcode='40001',
    message='organization profile snapshot changed during audit'; end if;
  return query select
    (v_bundle->>'organization_id')::uuid,(v_bundle->>'branch_id')::uuid,
    (v_bundle->>'generated_at')::timestamptz,(v_bundle->>'snapshot_date')::date,
    v_bundle->'versions',(v_bundle->>'version_total')::bigint,
    (v_bundle->>'versions_truncated')::boolean,v_bundle->'history',
    (v_bundle->>'history_total')::bigint,(v_bundle->>'history_truncated')::boolean,
    v_bundle->'proposals',(v_bundle->>'proposal_total')::bigint,
    (v_bundle->>'proposals_truncated')::boolean,
    (v_bundle->>'active_version_total')::bigint,
    (v_bundle->>'pending_proposal_total')::bigint,
    (v_bundle->>'expired_permit_total')::bigint,
    (v_bundle->>'active_capacity')::integer,
    v_bundle->>'official_taxonomy_status',v_bundle->>'manual_taxonomy_status',
    v_bundle->>'permit_expiry_reminder_status',
    v_bundle->>'attachment_pipeline_status',v_bundle->>'export_status',
    v_bundle->>'regulator_sync_status',v_bundle->>'offline_status',
    (v_bundle->>'recent_aal2_max_age_minutes')::integer;
end;
$$;

create or replace function public.submit_organization_profile_proposal(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
  p_proposal_key uuid,p_profile_key uuid,p_base_version_id uuid,
  p_expected_base_version integer,p_effective_from date,p_effective_to date,
  p_permit_number text,p_permit_issuing_authority text,p_permit_issued_on date,
  p_permit_valid_through date,p_permit_status_text text,
  p_organization_type_text text,p_service_items jsonb,p_rate_items jsonb,
  p_approved_capacity integer,p_capacity_unit_text text,p_capacity_basis_text text,
  p_contact_name text,p_contact_phone text,p_contact_email text,
  p_contact_address text,p_change_reason text,p_idempotency_key uuid
)
returns table(
  organization_id uuid,branch_id uuid,proposal_id uuid,proposal_key uuid,
  proposal_number integer,proposal_status text,action text,profile_key uuid,
  expected_base_version integer,content_hash text,proposed_at timestamptz,
  replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.submit_organization_profile_proposal_guarded(
    p_expected_organization_id,p_expected_branch_id,p_action,p_proposal_key,
    p_profile_key,p_base_version_id,p_expected_base_version,p_effective_from,
    p_effective_to,p_permit_number,p_permit_issuing_authority,p_permit_issued_on,
    p_permit_valid_through,p_permit_status_text,p_organization_type_text,
    p_service_items,p_rate_items,p_approved_capacity,p_capacity_unit_text,
    p_capacity_basis_text,p_contact_name,p_contact_phone,p_contact_email,
    p_contact_address,p_change_reason,p_idempotency_key
  );
$$;

create or replace function public.decide_organization_profile_proposal(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_proposal_id uuid,
  p_expected_proposal_number integer,p_expected_base_version integer,
  p_decision text,p_decision_reason text,p_idempotency_key uuid
)
returns table(
  organization_id uuid,branch_id uuid,proposal_id uuid,decision_id uuid,
  decision text,proposal_status text,result_version_id uuid,profile_key uuid,
  result_version integer,effective_from date,effective_to date,
  content_hash text,decided_at timestamptz,replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.decide_organization_profile_proposal_guarded(
    p_expected_organization_id,p_expected_branch_id,p_proposal_id,
    p_expected_proposal_number,p_expected_base_version,p_decision,
    p_decision_reason,p_idempotency_key
  );
$$;

create or replace function public.organization_profile_snapshot(
  p_expected_organization_id uuid,p_expected_branch_id uuid
)
returns table(
  organization_id uuid,branch_id uuid,generated_at timestamptz,snapshot_date date,
  versions jsonb,version_total bigint,versions_truncated boolean,history jsonb,
  history_total bigint,history_truncated boolean,proposals jsonb,
  proposal_total bigint,proposals_truncated boolean,active_version_total bigint,
  pending_proposal_total bigint,expired_permit_total bigint,active_capacity integer,
  official_taxonomy_status text,manual_taxonomy_status text,
  permit_expiry_reminder_status text,attachment_pipeline_status text,
  export_status text,regulator_sync_status text,offline_status text,
  recent_aal2_max_age_minutes integer
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.organization_profile_snapshot_response(
    p_expected_organization_id,p_expected_branch_id
  );
$$;

revoke all on table public.organization_profile_proposals from public,anon,authenticated,service_role;
revoke all on table public.organization_profile_versions from public,anon,authenticated,service_role;
revoke all on table public.organization_profile_decisions from public,anon,authenticated,service_role;
revoke all on table private.organization_profile_operations from public,anon,authenticated,service_role;

revoke all on function private.organization_profile_text_ok(text,integer,integer,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.organization_profile_payload_ok(jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.organization_profile_append_only()
  from public,anon,authenticated,service_role;
revoke all on function private.organization_profile_authority(uuid,uuid,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function private.organization_profile_all_field_authority(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.require_organization_profile_reauth(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.organization_profile_snapshot_bundle(uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.submit_organization_profile_proposal_guarded(
  uuid,uuid,text,uuid,uuid,uuid,integer,date,date,text,text,date,date,text,text,
  jsonb,jsonb,integer,text,text,text,text,text,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.decide_organization_profile_proposal_guarded(
  uuid,uuid,uuid,integer,integer,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.organization_profile_snapshot_response(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.submit_organization_profile_proposal_guarded(
  uuid,uuid,text,uuid,uuid,uuid,integer,date,date,text,text,date,date,text,text,
  jsonb,jsonb,integer,text,text,text,text,text,text,text,uuid
) to authenticated;
grant execute on function private.decide_organization_profile_proposal_guarded(
  uuid,uuid,uuid,integer,integer,text,text,uuid
) to authenticated;
grant execute on function private.organization_profile_snapshot_response(uuid,uuid)
  to authenticated;

revoke all on function public.submit_organization_profile_proposal(
  uuid,uuid,text,uuid,uuid,uuid,integer,date,date,text,text,date,date,text,text,
  jsonb,jsonb,integer,text,text,text,text,text,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.decide_organization_profile_proposal(
  uuid,uuid,uuid,integer,integer,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.organization_profile_snapshot(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_organization_profile_proposal(
  uuid,uuid,text,uuid,uuid,uuid,integer,date,date,text,text,date,date,text,text,
  jsonb,jsonb,integer,text,text,text,text,text,text,text,uuid
) to authenticated;
grant execute on function public.decide_organization_profile_proposal(
  uuid,uuid,uuid,integer,integer,text,text,uuid
) to authenticated;
grant execute on function public.organization_profile_snapshot(uuid,uuid)
  to authenticated;

comment on table public.organization_profile_proposals is
  'Immutable full-snapshot organization/branch profile proposals. No proposal becomes effective without a separate decision.';
comment on table public.organization_profile_versions is
  'Immutable effective profile lineage. Terminal logical periods must not overlap; corrections append a new terminal version.';
comment on function public.organization_profile_snapshot(uuid,uuid) is
  'Returns one audited bounded Page-58 snapshot. Official taxonomy, reminder, attachment, export, offline and regulator synchronization boundaries remain explicit.';
