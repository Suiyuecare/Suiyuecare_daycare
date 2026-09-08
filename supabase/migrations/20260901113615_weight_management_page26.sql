-- Page 26: immutable monthly weight observations, governed threshold versions,
-- append-only acknowledgements, and one bounded tenant/client-scoped snapshot.

insert into public.permissions (permission_key, description, risk_level)
values ('quality_rules.manage', 'Propose and independently publish branch quality threshold rules', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.permission_key = 'quality_rules.manage'
where role.is_system
  and role.role_key in ('organization_manager', 'branch_supervisor', 'nurse')
on conflict (role_id, permission_id) do nothing;

create table public.weight_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  client_id uuid not null,
  observed_at timestamptz not null,
  weight_kg numeric(8,2) not null,
  source text not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorder_display_name text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  content_hash text not null,
  constraint weight_observations_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint weight_observations_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint weight_observations_weight_check check (weight_kg > 0),
  constraint weight_observations_source_check check (
    char_length(btrim(source)) between 1 and 120
    and source = btrim(source)
    and source !~ '[[:cntrl:]]'
  ),
  constraint weight_observations_recorder_name_check check (
    char_length(btrim(recorder_display_name)) between 1 and 120
    and recorder_display_name = btrim(recorder_display_name)
  ),
  constraint weight_observations_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint weight_observations_client_time_key unique (client_id, observed_at)
);

create index weight_observations_scope_month_idx
  on public.weight_observations (organization_id, branch_id, observed_at desc, client_id);
create index weight_observations_client_latest_idx
  on public.weight_observations (client_id, observed_at desc, id desc);
create index weight_observations_recorded_by_idx
  on public.weight_observations (recorded_by, recorded_at desc);

create table public.weight_observation_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  client_id uuid not null,
  observation_id uuid not null,
  sequence_number integer not null,
  correction_kind text not null,
  replacement_weight_kg numeric(8,2),
  correction_reason text not null,
  corrected_by uuid not null references auth.users(id) on delete restrict,
  corrector_display_name text not null,
  corrected_at timestamptz not null default clock_timestamp(),
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint weight_corrections_observation_scope_fkey
    foreign key (observation_id, organization_id, branch_id, client_id)
    references public.weight_observations(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_corrections_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint weight_corrections_sequence_key unique (observation_id, sequence_number),
  constraint weight_corrections_sequence_check check (sequence_number > 0),
  constraint weight_corrections_kind_check check (correction_kind in ('replace', 'void')),
  constraint weight_corrections_value_check check (
    (correction_kind = 'replace' and replacement_weight_kg > 0)
    or (correction_kind = 'void' and replacement_weight_kg is null)
  ),
  constraint weight_corrections_reason_check check (
    char_length(btrim(correction_reason)) between 1 and 1000
    and correction_reason = btrim(correction_reason)
    and translate(correction_reason, E'\n\r\t', '') !~ '[[:cntrl:]]'
  ),
  constraint weight_corrections_name_check check (
    char_length(btrim(corrector_display_name)) between 1 and 120
    and corrector_display_name = btrim(corrector_display_name)
  ),
  constraint weight_corrections_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

create index weight_corrections_scope_time_idx on public.weight_observation_corrections
  (organization_id, branch_id, corrected_at desc, client_id);
create index weight_corrections_observation_latest_idx on public.weight_observation_corrections
  (observation_id, sequence_number desc);
create index weight_corrections_actor_idx on public.weight_observation_corrections
  (corrected_by, corrected_at desc);
create index weight_corrections_challenge_idx on public.weight_observation_corrections
  (reauth_challenge_id);

create table public.weight_threshold_rule_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  absolute_kg_threshold numeric(8,2) not null,
  percent_threshold numeric(8,2) not null,
  trigger_mode text not null,
  effective_from date not null,
  effective_until date,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  requested_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  request_idempotency_key uuid not null,
  request_hash text not null,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  approved_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  approval_idempotency_key uuid,
  approval_hash text,
  rule_version_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint weight_threshold_requests_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint weight_threshold_requests_threshold_check check (
    absolute_kg_threshold > 0 and percent_threshold > 0
  ),
  constraint weight_threshold_requests_mode_check check (trigger_mode in ('either', 'both')),
  constraint weight_threshold_requests_period_check check (
    effective_from = date_trunc('month', effective_from)::date
    and (effective_until is null or (
      effective_until >= effective_from
      and effective_until = (date_trunc('month', effective_until) + interval '1 month - 1 day')::date
    ))
  ),
  constraint weight_threshold_requests_status_check check (status in ('pending', 'approved')),
  constraint weight_threshold_requests_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
    and (approval_hash is null or approval_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint weight_threshold_requests_approval_check check (
    (status = 'pending' and approved_by is null and approved_at is null
      and approved_reauth_challenge_id is null and approval_idempotency_key is null
      and approval_hash is null and rule_version_id is null)
    or
    (status = 'approved' and approved_by is not null and approved_by <> requested_by
      and approved_at is not null and approved_reauth_challenge_id is not null
      and approved_reauth_challenge_id <> requested_reauth_challenge_id
      and approval_idempotency_key is not null and approval_hash is not null
      and rule_version_id is not null)
  ),
  constraint weight_threshold_requests_actor_key
    unique (organization_id, requested_by, request_idempotency_key)
);

create unique index weight_threshold_requests_approval_key_idx
  on public.weight_threshold_rule_requests (organization_id, approved_by, approval_idempotency_key)
  where approved_by is not null;
create index weight_threshold_requests_scope_queue_idx
  on public.weight_threshold_rule_requests (organization_id, branch_id, status, requested_at desc);
create index weight_threshold_requests_requested_challenge_idx
  on public.weight_threshold_rule_requests (requested_reauth_challenge_id);
create index weight_threshold_requests_approved_challenge_idx
  on public.weight_threshold_rule_requests (approved_reauth_challenge_id)
  where approved_reauth_challenge_id is not null;
create index weight_threshold_requests_rule_version_idx
  on public.weight_threshold_rule_requests (rule_version_id)
  where rule_version_id is not null;

create table public.weight_threshold_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  version_number integer not null,
  absolute_kg_threshold numeric(8,2) not null,
  percent_threshold numeric(8,2) not null,
  trigger_mode text not null,
  effective_from date not null,
  effective_until date,
  request_id uuid not null references public.weight_threshold_rule_requests(id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null,
  approval_reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  content_hash text not null,
  constraint weight_threshold_versions_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint weight_threshold_versions_id_scope_key
    unique (id, organization_id, branch_id),
  constraint weight_threshold_versions_scope_version_key
    unique (organization_id, branch_id, version_number),
  constraint weight_threshold_versions_request_key unique (request_id),
  constraint weight_threshold_versions_number_check check (version_number > 0),
  constraint weight_threshold_versions_threshold_check check (
    absolute_kg_threshold > 0 and percent_threshold > 0
  ),
  constraint weight_threshold_versions_mode_check check (trigger_mode in ('either', 'both')),
  constraint weight_threshold_versions_period_check check (
    effective_from = date_trunc('month', effective_from)::date
    and (effective_until is null or (
      effective_until >= effective_from
      and effective_until = (date_trunc('month', effective_until) + interval '1 month - 1 day')::date
    ))
  ),
  constraint weight_threshold_versions_hash_check check (content_hash ~ '^[a-f0-9]{64}$')
);

alter table public.weight_threshold_rule_requests
  add constraint weight_threshold_requests_rule_fkey
  foreign key (rule_version_id) references public.weight_threshold_rule_versions(id) on delete restrict;

create index weight_threshold_versions_effective_idx
  on public.weight_threshold_rule_versions
  (organization_id, branch_id, effective_from, effective_until, version_number desc);
create index weight_threshold_versions_published_by_idx
  on public.weight_threshold_rule_versions (published_by, published_at desc);
create index weight_threshold_versions_challenge_idx
  on public.weight_threshold_rule_versions (approval_reauth_challenge_id);

create table public.weight_alert_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  client_id uuid not null,
  current_observation_id uuid not null,
  prior_observation_id uuid not null,
  current_correction_id uuid,
  prior_correction_id uuid,
  current_correction_version integer not null,
  prior_correction_version integer not null,
  rule_version_id uuid not null,
  current_weight_kg numeric(8,2) not null,
  prior_weight_kg numeric(8,2) not null,
  delta_kg numeric(9,2) not null,
  delta_percent numeric(18,2) not null,
  absolute_kg_threshold numeric(8,2) not null,
  percent_threshold numeric(8,2) not null,
  trigger_mode text not null,
  rule_content_hash text not null,
  acknowledgement_note text not null,
  acknowledged_by uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz not null default clock_timestamp(),
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  evidence_hash text not null,
  constraint weight_alert_acks_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint weight_alert_acks_id_scope_key
    unique (id, organization_id, branch_id, client_id),
  constraint weight_alert_acks_current_scope_fkey
    foreign key (current_observation_id, organization_id, branch_id, client_id)
    references public.weight_observations(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_alert_acks_prior_scope_fkey
    foreign key (prior_observation_id, organization_id, branch_id, client_id)
    references public.weight_observations(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_alert_acks_current_correction_scope_fkey
    foreign key (current_correction_id, organization_id, branch_id, client_id)
    references public.weight_observation_corrections(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_alert_acks_prior_correction_scope_fkey
    foreign key (prior_correction_id, organization_id, branch_id, client_id)
    references public.weight_observation_corrections(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_alert_acks_rule_scope_fkey
    foreign key (rule_version_id, organization_id, branch_id)
    references public.weight_threshold_rule_versions(id, organization_id, branch_id) on delete restrict,
  constraint weight_alert_acks_tuple_key unique nulls not distinct
    (current_observation_id, current_correction_version,
     prior_observation_id, prior_correction_version, rule_version_id),
  constraint weight_alert_acks_correction_version_check check (
    current_correction_version >= 0 and prior_correction_version >= 0
    and ((current_correction_version = 0 and current_correction_id is null)
      or (current_correction_version > 0 and current_correction_id is not null))
    and ((prior_correction_version = 0 and prior_correction_id is null)
      or (prior_correction_version > 0 and prior_correction_id is not null))
  ),
  constraint weight_alert_acks_weights_check check (
    current_weight_kg > 0 and prior_weight_kg > 0
    and absolute_kg_threshold > 0 and percent_threshold > 0
  ),
  constraint weight_alert_acks_mode_check check (trigger_mode in ('either', 'both')),
  constraint weight_alert_acks_hash_check check (
    rule_content_hash ~ '^[a-f0-9]{64}$' and evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint weight_alert_acks_note_check check (
    char_length(btrim(acknowledgement_note)) between 1 and 1000
    and acknowledgement_note = btrim(acknowledgement_note)
    and translate(acknowledgement_note, E'\n\r\t', '') !~ '[[:cntrl:]]'
  )
);

create index weight_alert_acks_scope_time_idx
  on public.weight_alert_acknowledgements
  (organization_id, branch_id, acknowledged_at desc, client_id);
create index weight_alert_acks_client_idx
  on public.weight_alert_acknowledgements (client_id, acknowledged_at desc);
create index weight_alert_acks_prior_idx
  on public.weight_alert_acknowledgements (prior_observation_id);
create index weight_alert_acks_current_correction_idx
  on public.weight_alert_acknowledgements (current_correction_id)
  where current_correction_id is not null;
create index weight_alert_acks_prior_correction_idx
  on public.weight_alert_acknowledgements (prior_correction_id)
  where prior_correction_id is not null;
create index weight_alert_acks_rule_idx
  on public.weight_alert_acknowledgements (rule_version_id);
create index weight_alert_acks_actor_idx
  on public.weight_alert_acknowledgements (acknowledged_by, acknowledged_at desc);
create index weight_alert_acks_challenge_idx
  on public.weight_alert_acknowledgements (reauth_challenge_id);

create table private.weight_management_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation_kind text not null,
  request_hash text not null,
  observation_id uuid not null,
  correction_id uuid,
  result_correction_version integer,
  prior_observation_id uuid,
  rule_version_id uuid,
  evidence_current_correction_version integer,
  evidence_prior_correction_version integer,
  acknowledgement_id uuid,
  reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  committed_at timestamptz not null default clock_timestamp(),
  constraint weight_operations_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint weight_operations_observation_scope_fkey
    foreign key (observation_id, organization_id, branch_id, client_id)
    references public.weight_observations(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_operations_prior_scope_fkey
    foreign key (prior_observation_id, organization_id, branch_id, client_id)
    references public.weight_observations(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_operations_correction_scope_fkey
    foreign key (correction_id, organization_id, branch_id, client_id)
    references public.weight_observation_corrections(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_operations_rule_scope_fkey
    foreign key (rule_version_id, organization_id, branch_id)
    references public.weight_threshold_rule_versions(id, organization_id, branch_id) on delete restrict,
  constraint weight_operations_ack_scope_fkey
    foreign key (acknowledgement_id, organization_id, branch_id, client_id)
    references public.weight_alert_acknowledgements(id, organization_id, branch_id, client_id) on delete restrict,
  constraint weight_operations_actor_key unique (actor_user_id, idempotency_key),
  constraint weight_operations_kind_check check (operation_kind in ('record', 'correct', 'void', 'acknowledge')),
  constraint weight_operations_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint weight_operations_alignment_check check (
    (operation_kind = 'record' and correction_id is null and result_correction_version is null
      and prior_observation_id is null and rule_version_id is null
      and evidence_current_correction_version is null
      and evidence_prior_correction_version is null
      and acknowledgement_id is null and reauth_challenge_id is null)
    or
    (operation_kind in ('correct', 'void') and correction_id is not null
      and result_correction_version > 0 and prior_observation_id is null
      and rule_version_id is null and evidence_current_correction_version is null
      and evidence_prior_correction_version is null and acknowledgement_id is null
      and reauth_challenge_id is not null)
    or
    (operation_kind = 'acknowledge' and correction_id is null
      and result_correction_version is null and prior_observation_id is not null
      and rule_version_id is not null and evidence_current_correction_version >= 0
      and evidence_prior_correction_version >= 0 and acknowledgement_id is not null
      and reauth_challenge_id is not null)
  )
);

create index weight_operations_scope_time_idx
  on private.weight_management_operations
  (organization_id, branch_id, committed_at desc, client_id);
create index weight_operations_observation_idx
  on private.weight_management_operations (observation_id);
create index weight_operations_correction_idx
  on private.weight_management_operations (correction_id)
  where correction_id is not null;
create index weight_operations_prior_idx
  on private.weight_management_operations (prior_observation_id)
  where prior_observation_id is not null;
create index weight_operations_rule_idx
  on private.weight_management_operations (rule_version_id)
  where rule_version_id is not null;
create index weight_operations_ack_idx
  on private.weight_management_operations (acknowledgement_id)
  where acknowledgement_id is not null;
create index weight_operations_reauth_idx
  on private.weight_management_operations (reauth_challenge_id)
  where reauth_challenge_id is not null;

alter table public.weight_observations enable row level security;
alter table public.weight_observations force row level security;
alter table public.weight_observation_corrections enable row level security;
alter table public.weight_observation_corrections force row level security;
alter table public.weight_threshold_rule_requests enable row level security;
alter table public.weight_threshold_rule_requests force row level security;
alter table public.weight_threshold_rule_versions enable row level security;
alter table public.weight_threshold_rule_versions force row level security;
alter table public.weight_alert_acknowledgements enable row level security;
alter table public.weight_alert_acknowledgements force row level security;
alter table private.weight_management_operations enable row level security;
alter table private.weight_management_operations force row level security;

revoke all on table public.weight_observations from public, anon, authenticated, service_role;
revoke all on table public.weight_observation_corrections from public, anon, authenticated, service_role;
revoke all on table public.weight_threshold_rule_requests from public, anon, authenticated, service_role;
revoke all on table public.weight_threshold_rule_versions from public, anon, authenticated, service_role;
revoke all on table public.weight_alert_acknowledgements from public, anon, authenticated, service_role;
revoke all on table private.weight_management_operations from public, anon, authenticated, service_role;

create policy weight_observations_staff_select on public.weight_observations
for select to authenticated using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);
create policy weight_corrections_staff_select on public.weight_observation_corrections
for select to authenticated using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);
create policy weight_alert_acks_staff_select on public.weight_alert_acknowledgements
for select to authenticated using (
  (select private.can_staff_access_client(client_id, 'clients.read'))
  and (select private.can_staff_access_client(client_id, 'quality_events.read'))
);
create policy weight_threshold_versions_staff_select on public.weight_threshold_rule_versions
for select to authenticated using (
  (select private.has_permission(organization_id, branch_id, 'quality_events.read'))
);
create policy weight_threshold_requests_governor_select on public.weight_threshold_rule_requests
for select to authenticated using (
  requested_by = (select auth.uid())
  or (select private.has_permission(organization_id, branch_id, 'quality_rules.manage'))
);

create or replace function private.prevent_weight_history_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '55000',
    message = 'weight observations, threshold versions, acknowledgements, and receipts are immutable';
end;
$$;

create trigger weight_observations_immutable before update or delete on public.weight_observations
for each row execute function private.prevent_weight_history_mutation();
create trigger weight_corrections_immutable before update or delete on public.weight_observation_corrections
for each row execute function private.prevent_weight_history_mutation();
create trigger weight_threshold_versions_immutable before update or delete on public.weight_threshold_rule_versions
for each row execute function private.prevent_weight_history_mutation();
create trigger weight_alert_acks_immutable before update or delete on public.weight_alert_acknowledgements
for each row execute function private.prevent_weight_history_mutation();
create trigger weight_operations_immutable before update or delete on private.weight_management_operations
for each row execute function private.prevent_weight_history_mutation();

create or replace function private.protect_weight_threshold_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'weight threshold requests cannot be deleted';
  end if;
  if old.status <> 'pending' or new.status <> 'approved'
     or new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.branch_id is distinct from old.branch_id
     or new.absolute_kg_threshold is distinct from old.absolute_kg_threshold
     or new.percent_threshold is distinct from old.percent_threshold
     or new.trigger_mode is distinct from old.trigger_mode
     or new.effective_from is distinct from old.effective_from
     or new.effective_until is distinct from old.effective_until
     or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at
     or new.requested_reauth_challenge_id is distinct from old.requested_reauth_challenge_id
     or new.request_idempotency_key is distinct from old.request_idempotency_key
     or new.request_hash is distinct from old.request_hash
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'weight threshold request evidence is immutable';
  end if;
  return new;
end;
$$;

create trigger weight_threshold_requests_protect
before update or delete on public.weight_threshold_rule_requests
for each row execute function private.protect_weight_threshold_request();
create trigger weight_threshold_rule_requests_set_updated_at
before update on public.weight_threshold_rule_requests
for each row execute function private.set_updated_at();

create trigger weight_observations_audit_row_change
after insert or update or delete on public.weight_observations
for each row execute function private.audit_row_change();
create trigger weight_observation_corrections_audit_row_change
after insert or update or delete on public.weight_observation_corrections
for each row execute function private.audit_row_change();
create trigger weight_threshold_rule_requests_audit_row_change
after insert or update or delete on public.weight_threshold_rule_requests
for each row execute function private.audit_row_change();
create trigger weight_threshold_rule_versions_audit_row_change
after insert or update or delete on public.weight_threshold_rule_versions
for each row execute function private.audit_row_change();
create trigger weight_alert_acknowledgements_audit_row_change
after insert or update or delete on public.weight_alert_acknowledgements
for each row execute function private.audit_row_change();
create trigger weight_operations_audit_row_change
after insert or update or delete on private.weight_management_operations
for each row execute function private.audit_row_change();

create or replace function private.require_weight_reauth(p_actor uuid, p_now timestamptz)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_session_id uuid; v_challenge_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid()
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501',
      message = 'current same-session recent AAL2 evidence is required for weight governance';
  end if;
  begin v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '42501', message = 'valid AAL2 session evidence is required';
  end;
  select challenge.id into v_challenge_id
  from private.reauth_events event
  join private.reauth_challenges challenge
    on challenge.id = event.challenge_id and challenge.user_id = event.user_id
   and challenge.session_id = event.session_id
  where event.user_id = p_actor and event.session_id = v_session_id
    and event.aal = 'aal2' and event.revoked_at is null
    and event.verification_method in ('totp', 'webauthn', 'phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method = event.verification_method
    and challenge.factor_verified_at = event.verified_at
    and challenge.factor_verified_at >= p_now - interval '15 minutes'
    and challenge.factor_verified_at <= p_now + interval '1 minute'
  order by challenge.factor_verified_at desc, challenge.id desc limit 1
  for share of event, challenge;
  if v_challenge_id is null then
    raise exception using errcode = '42501', message = 'valid AAL2 session evidence is required';
  end if;
  return v_challenge_id;
end;
$$;

create or replace function private.validate_weight_threshold_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_request public.weight_threshold_rule_requests%rowtype;
begin
  select request.* into v_request from public.weight_threshold_rule_requests request
  where request.id = new.request_id for share;
  if not found or v_request.status <> 'pending'
     or v_request.organization_id <> new.organization_id
     or v_request.branch_id <> new.branch_id
     or v_request.absolute_kg_threshold <> new.absolute_kg_threshold
     or v_request.percent_threshold <> new.percent_threshold
     or v_request.trigger_mode <> new.trigger_mode
     or v_request.effective_from <> new.effective_from
     or v_request.effective_until is distinct from new.effective_until
     or v_request.requested_by = new.published_by
     or v_request.requested_reauth_challenge_id = new.approval_reauth_challenge_id then
    raise exception using errcode = '23514', message = 'threshold version lacks independent governed request evidence';
  end if;
  if exists (
    select 1 from public.weight_threshold_rule_versions other
    where other.organization_id = new.organization_id
      and other.branch_id = new.branch_id
      and daterange(other.effective_from, coalesce(other.effective_until, 'infinity'::date), '[]')
        && daterange(new.effective_from, coalesce(new.effective_until, 'infinity'::date), '[]')
  ) then
    raise exception using errcode = '23P01', message = 'published weight threshold periods cannot overlap';
  end if;
  return new;
end;
$$;

create trigger weight_threshold_versions_validate
before insert on public.weight_threshold_rule_versions
for each row execute function private.validate_weight_threshold_version();

create or replace function private.request_weight_threshold_rule_atomic(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_absolute_kg_threshold numeric, p_percent_threshold numeric,
  p_trigger_mode text, p_effective_from date, p_effective_until date,
  p_idempotency_key uuid
)
returns table(request_id uuid, status text, request_hash text, replayed boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_hash text; v_existing public.weight_threshold_rule_requests%rowtype;
  v_created public.weight_threshold_rule_requests%rowtype; v_challenge_id uuid;
begin
  if v_actor is null or p_expected_organization_id is null
     or p_expected_branch_id is null or p_absolute_kg_threshold is null
     or p_percent_threshold is null or p_idempotency_key is null
     or p_absolute_kg_threshold <= 0 or p_percent_threshold <= 0
     or p_absolute_kg_threshold <> round(p_absolute_kg_threshold, 2)
     or p_percent_threshold <> round(p_percent_threshold, 2)
     or p_trigger_mode not in ('either', 'both')
     or p_effective_from is null
     or p_effective_from <> date_trunc('month', p_effective_from)::date
     or (p_effective_until is not null and (
       p_effective_until < p_effective_from
       or p_effective_until <>
         (date_trunc('month', p_effective_until) + interval '1 month - 1 day')::date
     )) or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_rules.manage')) then
    raise exception using errcode = '42501', message = 'weight threshold request is not permitted or malformed';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'absolute_kg_threshold', round(p_absolute_kg_threshold, 2),
    'percent_threshold', round(p_percent_threshold, 2),
    'trigger_mode', p_trigger_mode, 'effective_from', p_effective_from,
    'effective_until', p_effective_until, 'requested_by', v_actor
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'weight-rule-request:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select request.* into v_existing from public.weight_threshold_rule_requests request
  where request.organization_id = p_expected_organization_id
    and request.requested_by = v_actor
    and request.request_idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.branch_id <> p_expected_branch_id or v_existing.request_hash <> v_hash then
      raise exception using errcode = '23505', message = 'threshold request idempotency conflict';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.request_hash, true;
    return;
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_rules.manage')) then
    raise exception using errcode = '42501', message = 'weight threshold request authority expired';
  end if;
  v_now := clock_timestamp();
  v_challenge_id := private.require_weight_reauth(v_actor, v_now);
  insert into public.weight_threshold_rule_requests (
    organization_id, branch_id, absolute_kg_threshold, percent_threshold,
    trigger_mode, effective_from, effective_until, requested_by, requested_at,
    requested_reauth_challenge_id, request_idempotency_key, request_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id,
    round(p_absolute_kg_threshold, 2), round(p_percent_threshold, 2),
    p_trigger_mode, p_effective_from, p_effective_until, v_actor, v_now,
    v_challenge_id, p_idempotency_key, v_hash
  ) returning * into v_created;
  return query select v_created.id, v_created.status, v_created.request_hash, false;
end;
$$;

create or replace function private.approve_weight_threshold_rule_atomic(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_request_id uuid, p_idempotency_key uuid
)
returns table(
  request_id uuid, rule_version_id uuid, version_number integer,
  status text, published_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_request public.weight_threshold_rule_requests%rowtype;
  v_rule public.weight_threshold_rule_versions%rowtype;
  v_challenge_id uuid; v_approval_hash text; v_content_hash text; v_version integer;
begin
  if v_actor is null or p_expected_organization_id is null
     or p_expected_branch_id is null or p_request_id is null or p_idempotency_key is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_rules.manage')) then
    raise exception using errcode = '42501', message = 'weight threshold approval is not permitted';
  end if;
  select request.* into v_request from public.weight_threshold_rule_requests request
  where request.id = p_request_id
    and request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id for update;
  if not found then raise exception using errcode = '42501', message = 'threshold request is outside scope'; end if;
  v_approval_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'request_id', v_request.id,
    'request_hash', v_request.request_hash, 'approved_by', v_actor,
    'approval_idempotency_key', p_idempotency_key
  )::text, 'UTF8')), 'hex');
  if v_request.status = 'approved' then
    select rule.* into v_rule from public.weight_threshold_rule_versions rule
      where rule.id = v_request.rule_version_id;
    if v_request.approved_by = v_actor
       and v_request.approval_idempotency_key = p_idempotency_key
       and v_request.approval_hash = v_approval_hash and v_rule.id is not null then
      return query select v_request.id, v_rule.id, v_rule.version_number,
        v_request.status, v_rule.published_at, true;
      return;
    end if;
    raise exception using errcode = '23505', message = 'threshold request was already decided';
  end if;
  if v_request.requested_by = v_actor then
    raise exception using errcode = '42501', message = 'threshold publication requires an independent approver';
  end if;
  if v_request.effective_from <
       date_trunc('month', v_now at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '23514',
      message = 'published weight threshold rules cannot begin in a past Taipei month';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'weight-rule-scope:' || p_expected_organization_id::text || ':' ||
    p_expected_branch_id::text, 0));
  if exists (
    select 1 from public.weight_threshold_rule_versions other
    where other.organization_id = p_expected_organization_id
      and other.branch_id = p_expected_branch_id
      and daterange(other.effective_from, coalesce(other.effective_until, 'infinity'::date), '[]')
        && daterange(v_request.effective_from, coalesce(v_request.effective_until, 'infinity'::date), '[]')
    for update
  ) then
    raise exception using errcode = '23P01', message = 'published weight threshold periods cannot overlap';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_rules.manage')) then
    raise exception using errcode = '42501', message = 'weight threshold approval authority expired';
  end if;
  v_now := clock_timestamp();
  v_challenge_id := private.require_weight_reauth(v_actor, v_now);
  if v_challenge_id = v_request.requested_reauth_challenge_id then
    raise exception using errcode = '42501', message = 'independent approval evidence is required';
  end if;
  select coalesce(max(rule.version_number), 0) + 1 into v_version
  from public.weight_threshold_rule_versions rule
  where rule.organization_id = p_expected_organization_id
    and rule.branch_id = p_expected_branch_id;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'version_number', v_version,
    'absolute_kg_threshold', v_request.absolute_kg_threshold,
    'percent_threshold', v_request.percent_threshold,
    'trigger_mode', v_request.trigger_mode,
    'effective_from', v_request.effective_from,
    'effective_until', v_request.effective_until,
    'request_id', v_request.id
  )::text, 'UTF8')), 'hex');
  insert into public.weight_threshold_rule_versions (
    organization_id, branch_id, version_number, absolute_kg_threshold,
    percent_threshold, trigger_mode, effective_from, effective_until,
    request_id, published_by, published_at, approval_reauth_challenge_id,
    content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_version,
    v_request.absolute_kg_threshold, v_request.percent_threshold,
    v_request.trigger_mode, v_request.effective_from, v_request.effective_until,
    v_request.id, v_actor, v_now, v_challenge_id, v_content_hash
  ) returning * into v_rule;
  update public.weight_threshold_rule_requests request set
    status = 'approved', approved_by = v_actor, approved_at = v_now,
    approved_reauth_challenge_id = v_challenge_id,
    approval_idempotency_key = p_idempotency_key,
    approval_hash = v_approval_hash, rule_version_id = v_rule.id,
    updated_at = v_now
  where request.id = v_request.id returning * into v_request;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_rules.manage')) then
    raise exception using errcode = '42501', message = 'weight threshold approval authority expired';
  end if;
  return query select v_request.id, v_rule.id, v_rule.version_number,
    v_request.status, v_rule.published_at, false;
end;
$$;

create or replace function public.request_weight_threshold_rule(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_absolute_kg_threshold numeric, p_percent_threshold numeric,
  p_trigger_mode text, p_effective_from date, p_effective_until date,
  p_idempotency_key uuid
)
returns table(request_id uuid, status text, request_hash text, replayed boolean)
language sql volatile security invoker set search_path = '' as $$
  select * from private.request_weight_threshold_rule_atomic(
    p_expected_organization_id, p_expected_branch_id, p_absolute_kg_threshold,
    p_percent_threshold, p_trigger_mode, p_effective_from, p_effective_until,
    p_idempotency_key
  );
$$;

create or replace function public.approve_weight_threshold_rule(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_request_id uuid, p_idempotency_key uuid
)
returns table(
  request_id uuid, rule_version_id uuid, version_number integer,
  status text, published_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.approve_weight_threshold_rule_atomic(
    p_expected_organization_id, p_expected_branch_id,
    p_request_id, p_idempotency_key
  );
$$;

create or replace function private.record_weight_observation_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_observed_at timestamptz,
  p_weight_kg numeric,
  p_source text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, client_id uuid,
  observation_id uuid, correction_id uuid, correction_version integer,
  prior_observation_id uuid, rule_version_id uuid,
  current_evidence_correction_version integer,
  prior_evidence_correction_version integer,
  acknowledgement_id uuid, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_source text := btrim(p_source);
  v_request_hash text;
  v_existing private.weight_management_operations%rowtype;
  v_client public.clients%rowtype;
  v_observation public.weight_observations%rowtype;
  v_operation private.weight_management_operations%rowtype;
  v_recorder_name text;
  v_observed_date date;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null or p_client_id is null
     or p_observed_at is null or p_weight_kg is null or p_idempotency_key is null
     or p_weight_kg <= 0 or p_weight_kg > 999999.99
     or p_weight_kg <> round(p_weight_kg, 2)
     or v_source is null or char_length(v_source) not between 1 and 120
     or v_source ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'valid weight observation fields are required';
  end if;
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight observation is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'observed_at', p_observed_at, 'weight_kg', round(p_weight_kg, 2),
    'source', v_source, 'actor', v_actor
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'weight-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_existing
  from private.weight_management_operations operation
  where operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.operation_kind <> 'record'
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'weight operation idempotency conflict';
    end if;
    return query select v_existing.id, v_existing.operation_kind,
      v_existing.client_id, v_existing.observation_id,
      v_existing.correction_id, v_existing.result_correction_version,
      v_existing.prior_observation_id, v_existing.rule_version_id,
      v_existing.evidence_current_correction_version,
      v_existing.evidence_prior_correction_version,
      v_existing.acknowledgement_id, v_existing.committed_at, true;
    return;
  end if;

  select client.* into v_client from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for share;
  v_observed_date := (p_observed_at at time zone 'Asia/Taipei')::date;
  if not found then
    raise exception using errcode = '42501', message = 'client is outside the selected tenant and branch';
  end if;
  if v_client.admitted_on is null or v_observed_date < v_client.admitted_on
     or (v_client.ended_on is not null and v_observed_date > v_client.ended_on)
     or p_observed_at > v_now + interval '1 minute' then
    raise exception using errcode = '23514', message = 'observation is outside the client service period or in the future';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight observation authority expired';
  end if;
  select btrim(profile.display_name) into v_recorder_name
  from public.profiles profile where profile.id = v_actor for share;
  if v_recorder_name is null then
    raise exception using errcode = '42501', message = 'staff profile is required';
  end if;

  insert into public.weight_observations (
    organization_id, branch_id, client_id, observed_at, weight_kg, source,
    recorded_by, recorder_display_name, recorded_at, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_observed_at, round(p_weight_kg, 2), v_source, v_actor, v_recorder_name,
    v_now, v_request_hash
  ) returning * into v_observation;

  insert into private.weight_management_operations (
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, observation_id, committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_idempotency_key, 'record', v_request_hash, v_observation.id, v_now
  ) returning * into v_operation;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight observation authority expired';
  end if;

  return query select v_operation.id, v_operation.operation_kind,
    v_operation.client_id, v_operation.observation_id,
    v_operation.correction_id, v_operation.result_correction_version,
    v_operation.prior_observation_id, v_operation.rule_version_id,
    v_operation.evidence_current_correction_version,
    v_operation.evidence_prior_correction_version,
    v_operation.acknowledgement_id, v_operation.committed_at, false;
end;
$$;

create or replace function private.correct_weight_observation_atomic(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_observation_id uuid,
  p_expected_correction_version integer, p_correction_kind text,
  p_replacement_weight_kg numeric, p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, client_id uuid,
  observation_id uuid, correction_id uuid, correction_version integer,
  prior_observation_id uuid, rule_version_id uuid,
  current_evidence_correction_version integer,
  prior_evidence_correction_version integer,
  acknowledgement_id uuid, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_reason text := btrim(p_correction_reason); v_request_hash text;
  v_existing private.weight_management_operations%rowtype;
  v_observation public.weight_observations%rowtype;
  v_previous public.weight_observation_corrections%rowtype;
  v_correction public.weight_observation_corrections%rowtype;
  v_operation private.weight_management_operations%rowtype;
  v_challenge_id uuid; v_name text; v_next integer;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null or p_client_id is null
     or p_observation_id is null or p_expected_correction_version is null
     or p_expected_correction_version < 0 or p_idempotency_key is null
     or p_correction_kind not in ('replace', 'void')
     or (p_correction_kind = 'replace' and (
       p_replacement_weight_kg is null or p_replacement_weight_kg <= 0
       or p_replacement_weight_kg > 999999.99
       or p_replacement_weight_kg <> round(p_replacement_weight_kg, 2)))
     or (p_correction_kind = 'void' and p_replacement_weight_kg is not null)
     or v_reason is null or char_length(v_reason) not between 1 and 1000
     or translate(v_reason, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'valid weight correction fields are required';
  end if;
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight correction is not permitted';
  end if;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'observation_id', p_observation_id,
    'expected_correction_version', p_expected_correction_version,
    'correction_kind', p_correction_kind,
    'replacement_weight_kg', case when p_replacement_weight_kg is null
      then null else round(p_replacement_weight_kg, 2) end,
    'correction_reason', v_reason, 'actor', v_actor
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'weight-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select operation.* into v_existing from private.weight_management_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.operation_kind <> (case p_correction_kind when 'replace' then 'correct' else 'void' end)
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.observation_id <> p_observation_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'weight operation idempotency conflict';
    end if;
    return query select v_existing.id, v_existing.operation_kind,
      v_existing.client_id, v_existing.observation_id,
      v_existing.correction_id, v_existing.result_correction_version,
      v_existing.prior_observation_id, v_existing.rule_version_id,
      v_existing.evidence_current_correction_version,
      v_existing.evidence_prior_correction_version,
      v_existing.acknowledgement_id, v_existing.committed_at, true;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('weight-observation:' || p_observation_id::text, 0));
  select observation.* into v_observation from public.weight_observations observation
  where observation.id = p_observation_id
    and observation.organization_id = p_expected_organization_id
    and observation.branch_id = p_expected_branch_id
    and observation.client_id = p_client_id for share;
  if not found then raise exception using errcode = '42501', message = 'weight observation is outside scope'; end if;
  select correction.* into v_previous from public.weight_observation_corrections correction
  where correction.observation_id = p_observation_id
  order by correction.sequence_number desc limit 1 for update;
  v_next := coalesce(v_previous.sequence_number, 0) + 1;
  if p_expected_correction_version <> v_next - 1 then
    raise exception using errcode = '40001', message = 'weight correction chain changed';
  end if;
  if v_previous.correction_kind = 'void' then
    raise exception using errcode = '23514',
      message = 'a voided observation is terminal; record a new observation instead';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight correction authority expired';
  end if;
  v_now := clock_timestamp();
  v_challenge_id := private.require_weight_reauth(v_actor, v_now);
  select btrim(profile.display_name) into v_name from public.profiles profile
    where profile.id = v_actor for share;
  if v_name is null then raise exception using errcode = '42501', message = 'staff profile is required'; end if;
  insert into public.weight_observation_corrections (
    organization_id, branch_id, client_id, observation_id, sequence_number,
    correction_kind, replacement_weight_kg, correction_reason, corrected_by,
    corrector_display_name, corrected_at, reauth_challenge_id, content_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_observation_id, v_next, p_correction_kind,
    case when p_replacement_weight_kg is null then null else round(p_replacement_weight_kg, 2) end,
    v_reason, v_actor, v_name, v_now, v_challenge_id, v_request_hash
  ) returning * into v_correction;
  insert into private.weight_management_operations (
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, observation_id, correction_id,
    result_correction_version, reauth_challenge_id, committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_idempotency_key, case p_correction_kind when 'replace' then 'correct' else 'void' end,
    v_request_hash, p_observation_id, v_correction.id, v_next, v_challenge_id, v_now
  ) returning * into v_operation;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight correction authority expired';
  end if;
  return query select v_operation.id, v_operation.operation_kind,
    v_operation.client_id, v_operation.observation_id,
    v_operation.correction_id, v_operation.result_correction_version,
    v_operation.prior_observation_id, v_operation.rule_version_id,
    v_operation.evidence_current_correction_version,
    v_operation.evidence_prior_correction_version,
    v_operation.acknowledgement_id, v_operation.committed_at, false;
end;
$$;

create or replace function private.acknowledge_weight_alert_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_current_observation_id uuid,
  p_current_correction_version integer,
  p_prior_observation_id uuid,
  p_prior_correction_version integer,
  p_rule_version_id uuid,
  p_acknowledgement_note text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, client_id uuid,
  observation_id uuid, correction_id uuid, correction_version integer,
  prior_observation_id uuid, rule_version_id uuid,
  current_evidence_correction_version integer,
  prior_evidence_correction_version integer,
  acknowledgement_id uuid, committed_at timestamptz, replayed boolean
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_now timestamptz := clock_timestamp();
  v_note text := btrim(p_acknowledgement_note); v_request_hash text;
  v_existing private.weight_management_operations%rowtype;
  v_current public.weight_observations%rowtype;
  v_prior public.weight_observations%rowtype;
  v_current_correction public.weight_observation_corrections%rowtype;
  v_prior_correction public.weight_observation_corrections%rowtype;
  v_rule public.weight_threshold_rule_versions%rowtype;
  v_ack public.weight_alert_acknowledgements%rowtype;
  v_operation private.weight_management_operations%rowtype;
  v_month_start date; v_prior_month_start date; v_month_end timestamptz;
  v_delta_kg numeric(9,2); v_delta_percent numeric(18,2);
  v_current_weight numeric(8,2); v_prior_weight numeric(8,2);
  v_triggered boolean; v_challenge_id uuid; v_evidence_hash text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null or p_client_id is null
     or p_current_observation_id is null or p_prior_observation_id is null
     or p_current_correction_version is null or p_current_correction_version < 0
     or p_prior_correction_version is null or p_prior_correction_version < 0
     or p_rule_version_id is null or p_idempotency_key is null
     or v_note is null or char_length(v_note) not between 1 and 1000
     or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'valid weight acknowledgement fields are required';
  end if;
  if v_actor is null or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight alert acknowledgement is not permitted';
  end if;

  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id, 'client_id', p_client_id,
    'current_observation_id', p_current_observation_id,
    'current_correction_version', p_current_correction_version,
    'prior_observation_id', p_prior_observation_id,
    'prior_correction_version', p_prior_correction_version,
    'rule_version_id', p_rule_version_id,
    'acknowledgement_note', v_note, 'actor', v_actor
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'weight-operation:' || v_actor::text || ':' || p_idempotency_key::text, 0
  ));
  select operation.* into v_existing
  from private.weight_management_operations operation
  where operation.actor_user_id = v_actor and operation.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.operation_kind <> 'acknowledge'
       or v_existing.organization_id <> p_expected_organization_id
       or v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.observation_id <> p_current_observation_id
       or v_existing.prior_observation_id <> p_prior_observation_id
       or v_existing.rule_version_id <> p_rule_version_id
       or v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '23505', message = 'weight operation idempotency conflict';
    end if;
    return query select v_existing.id, v_existing.operation_kind,
      v_existing.client_id, v_existing.observation_id,
      v_existing.correction_id, v_existing.result_correction_version,
      v_existing.prior_observation_id, v_existing.rule_version_id,
      v_existing.evidence_current_correction_version,
      v_existing.evidence_prior_correction_version,
      v_existing.acknowledgement_id, v_existing.committed_at, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'weight-alert:' || p_current_observation_id::text || ':' ||
    p_prior_observation_id::text || ':' || p_rule_version_id::text, 0
  ));
  select observation.* into v_current from public.weight_observations observation
  where observation.id = p_current_observation_id
    and observation.organization_id = p_expected_organization_id
    and observation.branch_id = p_expected_branch_id
    and observation.client_id = p_client_id for share;
  if not found then raise exception using errcode = '42501', message = 'current observation is outside scope'; end if;
  select observation.* into v_prior from public.weight_observations observation
  where observation.id = p_prior_observation_id
    and observation.organization_id = p_expected_organization_id
    and observation.branch_id = p_expected_branch_id
    and observation.client_id = p_client_id for share;
  if not found then raise exception using errcode = '42501', message = 'prior observation is outside scope'; end if;
  select rule.* into v_rule from public.weight_threshold_rule_versions rule
  where rule.id = p_rule_version_id
    and rule.organization_id = p_expected_organization_id
    and rule.branch_id = p_expected_branch_id for share;
  if not found then raise exception using errcode = '42501', message = 'threshold rule is outside scope'; end if;

  select correction.* into v_current_correction
  from public.weight_observation_corrections correction
  where correction.observation_id = v_current.id
  order by correction.sequence_number desc limit 1 for share;
  if coalesce(v_current_correction.sequence_number, 0) <> p_current_correction_version
     or v_current_correction.correction_kind = 'void' then
    raise exception using errcode = '40001', message = 'current weight evidence changed';
  end if;
  select correction.* into v_prior_correction
  from public.weight_observation_corrections correction
  where correction.observation_id = v_prior.id
  order by correction.sequence_number desc limit 1 for share;
  if coalesce(v_prior_correction.sequence_number, 0) <> p_prior_correction_version
     or v_prior_correction.correction_kind = 'void' then
    raise exception using errcode = '40001', message = 'prior weight evidence changed';
  end if;
  v_current_weight := coalesce(v_current_correction.replacement_weight_kg, v_current.weight_kg);
  v_prior_weight := coalesce(v_prior_correction.replacement_weight_kg, v_prior.weight_kg);

  v_month_start := date_trunc('month', v_current.observed_at at time zone 'Asia/Taipei')::date;
  v_prior_month_start := (v_month_start - interval '1 month')::date;
  v_month_end := ((v_month_start + interval '1 month')::date::timestamp at time zone 'Asia/Taipei');
  if date_trunc('month', v_prior.observed_at at time zone 'Asia/Taipei')::date <> v_prior_month_start
     or v_rule.effective_from > v_month_start
     or (v_rule.effective_until is not null and v_rule.effective_until < v_month_start)
     or exists (
       select 1 from public.weight_observations newer
       left join lateral (select correction.correction_kind
         from public.weight_observation_corrections correction
         where correction.observation_id = newer.id
         order by correction.sequence_number desc limit 1) terminal on true
       where newer.client_id = p_client_id
         and newer.observed_at >= (v_month_start::timestamp at time zone 'Asia/Taipei')
         and newer.observed_at < v_month_end
         and terminal.correction_kind is distinct from 'void'
         and (newer.observed_at, newer.id) > (v_current.observed_at, v_current.id)
     ) or exists (
       select 1 from public.weight_observations newer
       left join lateral (select correction.correction_kind
         from public.weight_observation_corrections correction
         where correction.observation_id = newer.id
         order by correction.sequence_number desc limit 1) terminal on true
       where newer.client_id = p_client_id
         and newer.observed_at >= (v_prior_month_start::timestamp at time zone 'Asia/Taipei')
         and newer.observed_at < (v_month_start::timestamp at time zone 'Asia/Taipei')
         and terminal.correction_kind is distinct from 'void'
         and (newer.observed_at, newer.id) > (v_prior.observed_at, v_prior.id)
     ) then
    raise exception using errcode = '23514', message = 'alert evidence is not the latest exact-month comparison';
  end if;
  if v_prior_weight is null or v_prior_weight <= 0 then
    raise exception using errcode = '23514', message = 'zero or missing baseline cannot be compared';
  end if;
  v_delta_kg := round(v_current_weight - v_prior_weight, 2);
  v_delta_percent := round((v_delta_kg / v_prior_weight) * 100, 2);
  v_triggered := case v_rule.trigger_mode
    when 'either' then abs(v_delta_kg) >= v_rule.absolute_kg_threshold
      or abs(v_delta_percent) >= v_rule.percent_threshold
    when 'both' then abs(v_delta_kg) >= v_rule.absolute_kg_threshold
      and abs(v_delta_percent) >= v_rule.percent_threshold
    else false end;
  if not v_triggered then
    raise exception using errcode = '23514', message = 'only a threshold-triggered change can be acknowledged';
  end if;
  if exists (select 1 from public.weight_alert_acknowledgements ack
    where ack.current_observation_id = p_current_observation_id
      and ack.current_correction_version = p_current_correction_version
      and ack.prior_observation_id = p_prior_observation_id
      and ack.prior_correction_version = p_prior_correction_version
      and ack.rule_version_id = p_rule_version_id) then
    raise exception using errcode = '23505', message = 'weight alert was already acknowledged';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight alert acknowledgement authority expired';
  end if;
  v_now := clock_timestamp();
  v_challenge_id := private.require_weight_reauth(v_actor, v_now);
  v_evidence_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema_version', 1, 'client_id', p_client_id,
    'current_observation_id', v_current.id,
    'current_correction_id', v_current_correction.id,
    'current_correction_version', p_current_correction_version,
    'current_weight_kg', v_current_weight,
    'prior_observation_id', v_prior.id,
    'prior_correction_id', v_prior_correction.id,
    'prior_correction_version', p_prior_correction_version,
    'prior_weight_kg', v_prior_weight,
    'delta_kg', v_delta_kg, 'delta_percent', v_delta_percent,
    'rule_version_id', v_rule.id, 'rule_content_hash', v_rule.content_hash,
    'absolute_kg_threshold', v_rule.absolute_kg_threshold,
    'percent_threshold', v_rule.percent_threshold, 'trigger_mode', v_rule.trigger_mode,
    'note', v_note, 'actor', v_actor
  )::text, 'UTF8')), 'hex');

  insert into public.weight_alert_acknowledgements (
    organization_id, branch_id, client_id, current_observation_id,
    prior_observation_id, current_correction_id, prior_correction_id,
    current_correction_version, prior_correction_version,
    rule_version_id, current_weight_kg, prior_weight_kg,
    delta_kg, delta_percent, absolute_kg_threshold, percent_threshold,
    trigger_mode, rule_content_hash, acknowledgement_note, acknowledged_by,
    acknowledged_at, reauth_challenge_id, evidence_hash
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    v_current.id, v_prior.id, v_current_correction.id, v_prior_correction.id,
    p_current_correction_version, p_prior_correction_version,
    v_rule.id, v_current_weight, v_prior_weight,
    v_delta_kg, v_delta_percent, v_rule.absolute_kg_threshold,
    v_rule.percent_threshold, v_rule.trigger_mode, v_rule.content_hash, v_note,
    v_actor, v_now, v_challenge_id, v_evidence_hash
  ) returning * into v_ack;
  insert into private.weight_management_operations (
    organization_id, branch_id, client_id, actor_user_id, idempotency_key,
    operation_kind, request_hash, observation_id, prior_observation_id,
    rule_version_id, evidence_current_correction_version,
    evidence_prior_correction_version, acknowledgement_id,
    reauth_challenge_id, committed_at
  ) values (
    p_expected_organization_id, p_expected_branch_id, p_client_id, v_actor,
    p_idempotency_key, 'acknowledge', v_request_hash, v_current.id, v_prior.id,
    v_rule.id, p_current_correction_version, p_prior_correction_version,
    v_ack.id, v_challenge_id, v_now
  ) returning * into v_operation;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_recent_aal2(15))
     or not (select private.can_staff_access_client(p_client_id, 'clients.read'))
     or not (select private.can_staff_access_client(p_client_id, 'quality_events.manage')) then
    raise exception using errcode = '42501', message = 'weight alert acknowledgement authority expired';
  end if;
  return query select v_operation.id, v_operation.operation_kind,
    v_operation.client_id, v_operation.observation_id,
    v_operation.correction_id, v_operation.result_correction_version,
    v_operation.prior_observation_id, v_operation.rule_version_id,
    v_operation.evidence_current_correction_version,
    v_operation.evidence_prior_correction_version,
    v_operation.acknowledgement_id, v_operation.committed_at, false;
end;
$$;

create or replace function public.record_weight_observation(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid,
  p_observed_at timestamptz, p_weight_kg numeric, p_source text, p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, client_id uuid,
  observation_id uuid, correction_id uuid, correction_version integer,
  prior_observation_id uuid, rule_version_id uuid,
  current_evidence_correction_version integer,
  prior_evidence_correction_version integer,
  acknowledgement_id uuid, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.record_weight_observation_atomic(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_observed_at, p_weight_kg, p_source, p_idempotency_key
  );
$$;

create or replace function public.correct_weight_observation(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid, p_observation_id uuid,
  p_expected_correction_version integer, p_correction_kind text,
  p_replacement_weight_kg numeric, p_correction_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, client_id uuid,
  observation_id uuid, correction_id uuid, correction_version integer,
  prior_observation_id uuid, rule_version_id uuid,
  current_evidence_correction_version integer,
  prior_evidence_correction_version integer,
  acknowledgement_id uuid, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.correct_weight_observation_atomic(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_observation_id, p_expected_correction_version, p_correction_kind,
    p_replacement_weight_kg, p_correction_reason, p_idempotency_key
  );
$$;

create or replace function public.acknowledge_weight_alert(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid,
  p_current_observation_id uuid, p_current_correction_version integer,
  p_prior_observation_id uuid, p_prior_correction_version integer,
  p_rule_version_id uuid, p_acknowledgement_note text, p_idempotency_key uuid
)
returns table(
  operation_id uuid, operation_kind text, client_id uuid,
  observation_id uuid, correction_id uuid, correction_version integer,
  prior_observation_id uuid, rule_version_id uuid,
  current_evidence_correction_version integer,
  prior_evidence_correction_version integer,
  acknowledgement_id uuid, committed_at timestamptz, replayed boolean
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.acknowledge_weight_alert_atomic(
    p_expected_organization_id, p_expected_branch_id, p_client_id,
    p_current_observation_id, p_current_correction_version,
    p_prior_observation_id, p_prior_correction_version, p_rule_version_id,
    p_acknowledgement_note, p_idempotency_key
  );
$$;

create or replace function private.weight_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_target_month date,
  p_client_id uuid,
  p_change_direction text,
  p_alert_status text
)
returns table(
  organization_id uuid, branch_id uuid, target_month date,
  generated_at timestamptz, items jsonb, item_total bigint,
  matching_total bigint, measured_total bigint, missing_total bigint,
  alert_total bigint, acknowledged_total bigint, unacknowledged_total bigint,
  items_truncated boolean, client_options jsonb, client_option_total bigint,
  client_options_truncated boolean, threshold_rule_status text,
  threshold_rule_id uuid, threshold_version_number integer,
  absolute_kg_threshold numeric, percent_threshold numeric, trigger_mode text
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_generated_at timestamptz := clock_timestamp();
  v_month_end date; v_current_month date;
  v_items jsonb; v_item_total bigint; v_matching_total bigint;
  v_measured_total bigint; v_missing_total bigint; v_alert_total bigint;
  v_acknowledged_total bigint; v_unacknowledged_total bigint;
  v_client_options jsonb; v_client_option_total bigint;
  v_client_options_truncated boolean;
  v_header_rule public.weight_threshold_rule_versions%rowtype;
begin
  v_current_month := date_trunc('month', v_generated_at at time zone 'Asia/Taipei')::date;
  if v_actor is null or p_expected_organization_id is null
     or p_expected_branch_id is null or p_target_month is null
     or p_target_month <> date_trunc('month', p_target_month)::date
     or p_target_month < date '2000-01-01' or p_target_month > v_current_month
     or p_change_direction not in ('all', 'gain', 'loss', 'no_change', 'unavailable')
     or p_alert_status not in (
       'all', 'alert', 'acknowledged', 'unacknowledged',
       'within_threshold', 'not_comparable', 'not_configured'
     )
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active)
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read')) then
    raise exception using errcode = '42501', message = 'weight management snapshot is not permitted';
  end if;
  if p_client_id is not null and (
    not (select private.can_staff_access_client(p_client_id, 'clients.read'))
    or not (select private.can_staff_access_client(p_client_id, 'quality_events.read'))
  ) then
    raise exception using errcode = '42501', message = 'selected client is outside the weight management scope';
  end if;
  v_month_end := (p_target_month + interval '1 month - 1 day')::date;

  select rule.* into v_header_rule
  from public.weight_threshold_rule_versions rule
  where rule.organization_id = p_expected_organization_id
    and rule.branch_id = p_expected_branch_id
    and rule.effective_from <= p_target_month
    and (rule.effective_until is null or rule.effective_until >= p_target_month)
  order by rule.version_number desc limit 1;

  with client_base as (
    select client.*,
      (p_target_month - interval '1 month')::date as prior_month_start,
      (p_target_month - interval '1 day')::date as prior_month_end
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and client.admitted_on is not null
      and client.admitted_on <= v_month_end
      and (client.ended_on is null or client.ended_on >= p_target_month)
      and (select private.can_staff_access_client(client.id, 'clients.read'))
      and (select private.can_staff_access_client(client.id, 'quality_events.read'))
  ), comparison as (
    select base.id as client_id, base.display_name, base.status as client_status,
      base.admitted_on, base.ended_on,
      current_observation.id as current_observation_id,
      current_observation.weight_kg as current_original_weight_kg,
      current_observation.effective_weight_kg as current_weight_kg,
      current_observation.observed_at as current_observed_at,
      current_observation.source as current_source,
      current_observation.recorded_at as current_recorded_at,
      current_observation.recorder_display_name,
      current_observation.correction_id as current_correction_id,
      current_observation.correction_version as current_correction_version,
      current_observation.correction_kind as current_correction_kind,
      current_observation.correction_reason as current_correction_reason,
      prior_observation.id as prior_observation_id,
      prior_observation.effective_weight_kg as prior_weight_kg,
      prior_observation.observed_at as prior_observed_at,
      prior_observation.correction_id as prior_correction_id,
      prior_observation.correction_version as prior_correction_version,
      (base.admitted_on <= base.prior_month_end
        and (base.ended_on is null or base.ended_on >= base.prior_month_start))
        as prior_applicable
    from client_base base
    left join lateral (
      select observation.*,
        terminal.id as correction_id,
        coalesce(terminal.sequence_number, 0) as correction_version,
        terminal.correction_kind, terminal.correction_reason,
        coalesce(terminal.replacement_weight_kg, observation.weight_kg)
          as effective_weight_kg
      from public.weight_observations observation
      left join lateral (
        select correction.* from public.weight_observation_corrections correction
        where correction.observation_id = observation.id
        order by correction.sequence_number desc limit 1
      ) terminal on true
      where observation.client_id = base.id
        and observation.organization_id = p_expected_organization_id
        and observation.branch_id = p_expected_branch_id
        and observation.observed_at >= (p_target_month::timestamp at time zone 'Asia/Taipei')
        and observation.observed_at < (((p_target_month + interval '1 month')::date)::timestamp at time zone 'Asia/Taipei')
        and terminal.correction_kind is distinct from 'void'
      order by observation.observed_at desc, observation.id desc limit 1
    ) current_observation on true
    left join lateral (
      select observation.*,
        terminal.id as correction_id,
        coalesce(terminal.sequence_number, 0) as correction_version,
        terminal.correction_kind, terminal.correction_reason,
        coalesce(terminal.replacement_weight_kg, observation.weight_kg)
          as effective_weight_kg
      from public.weight_observations observation
      left join lateral (
        select correction.* from public.weight_observation_corrections correction
        where correction.observation_id = observation.id
        order by correction.sequence_number desc limit 1
      ) terminal on true
      where observation.client_id = base.id
        and observation.organization_id = p_expected_organization_id
        and observation.branch_id = p_expected_branch_id
        and observation.observed_at >= (base.prior_month_start::timestamp at time zone 'Asia/Taipei')
        and observation.observed_at < (p_target_month::timestamp at time zone 'Asia/Taipei')
        and terminal.correction_kind is distinct from 'void'
      order by observation.observed_at desc, observation.id desc limit 1
    ) prior_observation on true
  ), calculated as (
    select comparison.*,
      case when comparison.current_observation_id is null then 'missing' else 'provided' end as current_state,
      case when not comparison.prior_applicable then 'not_applicable'
        when comparison.prior_observation_id is null then 'missing'
        else 'provided' end as prior_state,
      case when comparison.current_observation_id is not null
          and comparison.prior_observation_id is not null
          and comparison.prior_weight_kg > 0
        then round(comparison.current_weight_kg - comparison.prior_weight_kg, 2)
        else null end as delta_kg,
      case when comparison.current_observation_id is not null
          and comparison.prior_observation_id is not null
          and comparison.prior_weight_kg > 0
        then round(((comparison.current_weight_kg - comparison.prior_weight_kg)
          / comparison.prior_weight_kg) * 100, 2)
        else null end as delta_percent
    from comparison
  ), evaluated as (
    select calculated.*,
      case when calculated.delta_kg is null then 'unavailable'
        when calculated.delta_kg > 0 then 'gain'
        when calculated.delta_kg < 0 then 'loss'
        else 'no_change' end as change_direction,
      case
        when v_header_rule.id is null then 'not_configured'
        when calculated.delta_kg is null or calculated.delta_percent is null then 'not_comparable'
        when (
          (v_header_rule.trigger_mode = 'either' and (
            abs(calculated.delta_kg) >= v_header_rule.absolute_kg_threshold
            or abs(calculated.delta_percent) >= v_header_rule.percent_threshold
          )) or
          (v_header_rule.trigger_mode = 'both' and (
            abs(calculated.delta_kg) >= v_header_rule.absolute_kg_threshold
            and abs(calculated.delta_percent) >= v_header_rule.percent_threshold
          ))
        ) then case when acknowledgement.id is null
          then 'unacknowledged' else 'acknowledged' end
        else 'within_threshold'
      end as alert_status,
      acknowledgement.id as acknowledgement_id,
      acknowledgement.acknowledgement_note,
      acknowledgement.acknowledged_at,
      acknowledgement.acknowledged_by
    from calculated
    left join public.weight_alert_acknowledgements acknowledgement
      on acknowledgement.current_observation_id = calculated.current_observation_id
     and acknowledgement.current_correction_version = calculated.current_correction_version
     and acknowledgement.prior_observation_id = calculated.prior_observation_id
     and acknowledgement.prior_correction_version = calculated.prior_correction_version
     and acknowledgement.rule_version_id = v_header_rule.id
  ), filtered as (
    select evaluated.* from evaluated
    where (p_client_id is null or evaluated.client_id = p_client_id)
      and (p_change_direction = 'all' or evaluated.change_direction = p_change_direction)
      and (
        p_alert_status = 'all'
        or evaluated.alert_status = p_alert_status
        or (p_alert_status = 'alert'
          and evaluated.alert_status in ('acknowledged', 'unacknowledged'))
      )
  ), selected as (
    select filtered.* from filtered
    order by filtered.display_name collate "C", filtered.client_id limit 200
  ), stats as (
    select count(*)::bigint as matching_total,
      count(*) filter (where current_state = 'provided')::bigint as measured_total,
      count(*) filter (where current_state = 'missing')::bigint as missing_total,
      count(*) filter (where alert_status in ('acknowledged', 'unacknowledged'))::bigint as alert_total,
      count(*) filter (where alert_status = 'acknowledged')::bigint as acknowledged_total,
      count(*) filter (where alert_status = 'unacknowledged')::bigint as unacknowledged_total
    from filtered
  ), selected_stats as (select count(*)::bigint as item_total from selected),
  option_candidates as (
    select base.id, base.display_name, base.status,
      (base.status = 'active' and base.admitted_on is not null
       and base.admitted_on <= (v_generated_at at time zone 'Asia/Taipei')::date
       and base.ended_on is null) as can_record
    from client_base base
  ), option_selected as (
    select candidate.* from option_candidates candidate
    order by candidate.display_name collate "C", candidate.id limit 200
  ), option_stats as (
    select count(*)::bigint as option_total from option_candidates
  ), option_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option_row.id, 'display_name', option_row.display_name,
      'client_status', option_row.status, 'can_record', option_row.can_record
    ) order by option_row.display_name collate "C", option_row.id)
      filter (where option_row.id is not null), '[]'::jsonb) as options,
      option_stats.option_total,
      option_stats.option_total > 200 as truncated
    from option_stats left join option_selected option_row on true
    group by option_stats.option_total
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', item.client_id, 'client_display_name', item.display_name,
      'client_status', item.client_status,
      'current_state', item.current_state,
      'current_observation_id', item.current_observation_id,
      'current_original_weight_kg', item.current_original_weight_kg,
      'current_weight_kg', item.current_weight_kg,
      'current_observed_at', item.current_observed_at,
      'current_source', item.current_source,
      'current_recorded_at', item.current_recorded_at,
      'recorder_display_name', item.recorder_display_name,
      'current_correction_id', item.current_correction_id,
      'current_correction_version', coalesce(item.current_correction_version, 0),
      'current_correction_kind', item.current_correction_kind,
      'current_correction_reason', item.current_correction_reason,
      'prior_state', item.prior_state,
      'prior_observation_id', item.prior_observation_id,
      'prior_weight_kg', item.prior_weight_kg,
      'prior_observed_at', item.prior_observed_at,
      'prior_correction_id', item.prior_correction_id,
      'prior_correction_version', coalesce(item.prior_correction_version, 0),
      'delta_kg', item.delta_kg, 'delta_percent', item.delta_percent,
      'change_direction', item.change_direction, 'alert_status', item.alert_status,
      'rule_version_id', v_header_rule.id,
      'rule_version_number', v_header_rule.version_number,
      'absolute_kg_threshold', v_header_rule.absolute_kg_threshold,
      'percent_threshold', v_header_rule.percent_threshold,
      'trigger_mode', v_header_rule.trigger_mode,
      'acknowledgement_id', item.acknowledgement_id,
      'acknowledgement_note', item.acknowledgement_note,
      'acknowledged_at', item.acknowledged_at,
      'acknowledged_by', item.acknowledged_by
    ) order by item.display_name collate "C", item.client_id)
      filter (where item.client_id is not null), '[]'::jsonb),
    selected_stats.item_total, stats.matching_total, stats.measured_total,
    stats.missing_total, stats.alert_total, stats.acknowledged_total,
    stats.unacknowledged_total, option_result.options,
    option_result.option_total, option_result.truncated
  into v_items, v_item_total, v_matching_total, v_measured_total,
    v_missing_total, v_alert_total, v_acknowledged_total,
    v_unacknowledged_total, v_client_options, v_client_option_total,
    v_client_options_truncated
  from selected_stats cross join stats cross join option_result
  left join selected item on true
  group by selected_stats.item_total, stats.matching_total, stats.measured_total,
    stats.missing_total, stats.alert_total, stats.acknowledged_total,
    stats.unacknowledged_total, option_result.options,
    option_result.option_total, option_result.truncated;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read')) then
    raise exception using errcode = '42501', message = 'weight management snapshot authority expired';
  end if;
  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'weight_observations', null, '{}'::text[], jsonb_build_object(
      'projection', 'page26_weight_management_v1', 'target_month', p_target_month,
      'interaction', case when p_client_id is null and p_change_direction = 'all'
        and p_alert_status = 'all' then 'view' else 'search' end,
      'snapshot_count', v_item_total, 'matching_count', v_matching_total,
      'items_truncated', v_matching_total > v_item_total, 'item_limit', 200,
      'client_option_total', v_client_option_total,
      'client_options_truncated', v_client_options_truncated,
      'threshold_rule_status', case when v_header_rule.id is null
        then 'not_configured' else 'published' end,
      'comparison_policy', 'previous_calendar_month_only',
      'rounding_scale', 2
    )
  );
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id and branch.is_active)
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'))
     or (p_client_id is not null and (
       not (select private.can_staff_access_client(p_client_id, 'clients.read'))
       or not (select private.can_staff_access_client(p_client_id, 'quality_events.read'))
     )) then
    raise exception using errcode = '42501', message = 'weight management snapshot authority expired';
  end if;
  return query select p_expected_organization_id, p_expected_branch_id,
    p_target_month, v_generated_at, v_items, v_item_total, v_matching_total,
    v_measured_total, v_missing_total, v_alert_total, v_acknowledged_total,
    v_unacknowledged_total, v_matching_total > v_item_total,
    v_client_options, v_client_option_total, v_client_options_truncated,
    case when v_header_rule.id is null then 'not_configured' else 'published' end,
    v_header_rule.id, v_header_rule.version_number,
    v_header_rule.absolute_kg_threshold, v_header_rule.percent_threshold,
    v_header_rule.trigger_mode;
end;
$$;

create or replace function public.weight_management_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_target_month date, p_client_id uuid, p_change_direction text,
  p_alert_status text
)
returns table(
  organization_id uuid, branch_id uuid, target_month date,
  generated_at timestamptz, items jsonb, item_total bigint,
  matching_total bigint, measured_total bigint, missing_total bigint,
  alert_total bigint, acknowledged_total bigint, unacknowledged_total bigint,
  items_truncated boolean, client_options jsonb, client_option_total bigint,
  client_options_truncated boolean, threshold_rule_status text,
  threshold_rule_id uuid, threshold_version_number integer,
  absolute_kg_threshold numeric, percent_threshold numeric, trigger_mode text
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.weight_management_snapshot_response(
    p_expected_organization_id, p_expected_branch_id, p_target_month,
    p_client_id, p_change_direction, p_alert_status
  );
$$;

comment on table public.weight_observations is
  'Immutable raw kg observations; missing months have no synthetic zero row.';
comment on table public.weight_observation_corrections is
  'Append-only correction/void chain; monthly projection uses the terminal valid version.';
comment on table public.weight_threshold_rule_versions is
  'Immutable independently approved monthly threshold versions; no automatic clinical diagnosis.';
comment on table public.weight_alert_acknowledgements is
  'Frozen evidence for one exact current/prior correction-version and threshold tuple.';
comment on function public.weight_management_snapshot(uuid, uuid, date, uuid, text, text) is
  'Returns one audited Page-26 snapshot using only the immediately previous Taipei calendar month.';

revoke all on function private.prevent_weight_history_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_weight_threshold_request()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_weight_threshold_version()
  from public, anon, authenticated, service_role;
revoke all on function private.require_weight_reauth(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.request_weight_threshold_rule_atomic(uuid, uuid, numeric, numeric, text, date, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.approve_weight_threshold_rule_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.record_weight_observation_atomic(uuid, uuid, uuid, timestamptz, numeric, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.correct_weight_observation_atomic(uuid, uuid, uuid, uuid, integer, text, numeric, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_weight_alert_atomic(uuid, uuid, uuid, uuid, integer, uuid, integer, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.weight_management_snapshot_response(uuid, uuid, date, uuid, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.request_weight_threshold_rule(uuid, uuid, numeric, numeric, text, date, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_weight_threshold_rule(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_weight_observation(uuid, uuid, uuid, timestamptz, numeric, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.correct_weight_observation(uuid, uuid, uuid, uuid, integer, text, numeric, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_weight_alert(uuid, uuid, uuid, uuid, integer, uuid, integer, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.weight_management_snapshot(uuid, uuid, date, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function private.request_weight_threshold_rule_atomic(uuid, uuid, numeric, numeric, text, date, date, uuid)
  to authenticated;
grant execute on function private.approve_weight_threshold_rule_atomic(uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function private.record_weight_observation_atomic(uuid, uuid, uuid, timestamptz, numeric, text, uuid)
  to authenticated;
grant execute on function private.correct_weight_observation_atomic(uuid, uuid, uuid, uuid, integer, text, numeric, text, uuid)
  to authenticated;
grant execute on function private.acknowledge_weight_alert_atomic(uuid, uuid, uuid, uuid, integer, uuid, integer, uuid, text, uuid)
  to authenticated;
grant execute on function private.weight_management_snapshot_response(uuid, uuid, date, uuid, text, text)
  to authenticated;

grant execute on function public.request_weight_threshold_rule(uuid, uuid, numeric, numeric, text, date, date, uuid)
  to authenticated;
grant execute on function public.approve_weight_threshold_rule(uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.record_weight_observation(uuid, uuid, uuid, timestamptz, numeric, text, uuid)
  to authenticated;
grant execute on function public.correct_weight_observation(uuid, uuid, uuid, uuid, integer, text, numeric, text, uuid)
  to authenticated;
grant execute on function public.acknowledge_weight_alert(uuid, uuid, uuid, uuid, integer, uuid, integer, uuid, text, uuid)
  to authenticated;
grant execute on function public.weight_management_snapshot(uuid, uuid, date, uuid, text, text)
  to authenticated;
