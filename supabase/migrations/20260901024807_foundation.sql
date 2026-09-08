-- Day-care management system: tenant-safe relational foundation.
-- This migration is intentionally self-contained and can be replayed by
-- `supabase db reset` without depending on a remote project.

create schema if not exists private;

comment on schema private is
  'Non-exposed security helpers and restricted authentication evidence.';

create type public.profile_kind as enum (
  'platform',
  'staff',
  'professional',
  'driver',
  'finance',
  'family'
);

create type public.membership_status as enum (
  'invited',
  'active',
  'suspended',
  'ended'
);

create type public.client_status as enum (
  'active',
  'suspended',
  'transferred',
  'closed',
  'deceased'
);

create type public.record_status as enum (
  'draft',
  'signed',
  'superseded',
  'voided'
);

create type public.form_status as enum (
  'draft',
  'published',
  'retired'
);

create type public.attendance_status as enum (
  'present',
  'absent',
  'leave',
  'cancelled'
);

create type public.medication_plan_status as enum (
  'draft',
  'active',
  'superseded',
  'retired'
);

create type public.medication_administration_status as enum (
  'scheduled',
  'administered',
  'refused',
  'held',
  'missed',
  'voided'
);

create type public.service_event_status as enum (
  'planned',
  'in_progress',
  'completed',
  'cancelled',
  'voided'
);

create type public.claim_status as enum (
  'draft',
  'validated',
  'exported',
  'submitted',
  'accepted',
  'rejected',
  'reconciled',
  'voided'
);

create type public.import_batch_status as enum (
  'queued',
  'parsed',
  'mapping_required',
  'validation_failed',
  'ready_for_approval',
  'imported',
  'duplicate',
  'superseded'
);

create type public.delivery_status as enum (
  'queued',
  'sent',
  'delivered',
  'read',
  'confirmed',
  'failed',
  'suppressed'
);

create type public.sync_status as enum (
  'pending',
  'applied',
  'conflict',
  'rejected'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  timezone text not null default 'Asia/Taipei',
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_code_format_check
    check (code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  constraint organizations_timezone_check
    check (timezone = 'Asia/Taipei'),
  constraint organizations_settings_object_check
    check (jsonb_typeof(settings) = 'object')
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  capacity smallint,
  is_active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_capacity_check check (capacity is null or capacity > 0),
  constraint branches_code_format_check check (code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  constraint branches_settings_object_check check (jsonb_typeof(settings) = 'object'),
  constraint branches_organization_code_key unique (organization_id, code),
  constraint branches_id_organization_key unique (id, organization_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  kind public.profile_kind not null default 'staff',
  employee_code text,
  is_active boolean not null default true,
  locale text not null default 'zh-TW',
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint profiles_locale_check check (locale in ('zh-TW', 'en'))
);

create table public.permissions (
  id bigint generated always as identity primary key,
  permission_key text not null unique,
  description text not null,
  risk_level smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permissions_key_format_check
    check (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint permissions_risk_level_check check (risk_level between 0 and 3)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  role_key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_key_format_check check (role_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint roles_system_scope_check check (
    (is_system and organization_id is null)
    or (not is_system and organization_id is not null)
  ),
  constraint roles_id_organization_key unique nulls not distinct (id, organization_id)
);

create unique index roles_system_role_key_idx
  on public.roles (role_key)
  where organization_id is null;

create unique index roles_tenant_role_key_idx
  on public.roles (organization_id, role_key)
  where organization_id is not null;

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id bigint not null references public.permissions(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  primary key (role_id, permission_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status public.membership_status not null default 'invited',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint memberships_period_check check (ends_at is null or ends_at > starts_at),
  constraint memberships_scope_profile_key
    unique nulls not distinct (organization_id, branch_id, profile_id),
  constraint memberships_id_scope_key
    unique nulls not distinct (id, organization_id, branch_id)
);

create table public.membership_roles (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (membership_id, role_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  client_code text not null,
  external_key text,
  display_name text not null,
  date_of_birth date,
  national_id_ciphertext bytea,
  status public.client_status not null default 'active',
  admitted_on date,
  ended_on date,
  source_system text not null default 'local',
  source_updated_at timestamptz,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint clients_display_name_check check (char_length(btrim(display_name)) between 1 and 120),
  constraint clients_period_check check (ended_on is null or admitted_on is null or ended_on >= admitted_on),
  constraint clients_row_version_check check (row_version > 0),
  constraint clients_organization_code_key unique (organization_id, client_code),
  constraint clients_id_scope_key unique (id, organization_id, branch_id)
);

create unique index clients_organization_external_key_idx
  on public.clients (organization_id, external_key)
  where external_key is not null;

create table public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  assignee_user_id uuid not null references auth.users(id) on delete restrict,
  assignment_kind text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_assignments_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete cascade,
  constraint client_assignments_period_check check (ends_at is null or ends_at > starts_at),
  constraint client_assignments_kind_check check (char_length(btrim(assignment_kind)) between 1 and 64)
);

create unique index client_assignments_active_unique_idx
  on public.client_assignments (client_id, assignee_user_id, assignment_kind)
  where ends_at is null;

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  relationship text not null,
  scopes text[] not null,
  document_version text not null,
  consented_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  evidence_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consents_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete cascade,
  constraint consents_relationship_check check (char_length(btrim(relationship)) between 1 and 80),
  constraint consents_scopes_check check (cardinality(scopes) > 0),
  constraint consents_period_check check (expires_at is null or expires_at > consented_at),
  constraint consents_revocation_check check (revoked_at is null or revoked_at >= consented_at),
  constraint consents_evidence_hash_check check (evidence_hash ~ '^[a-f0-9]{64}$')
);

create unique index consents_active_recipient_idx
  on public.consents (client_id, recipient_user_id, document_version)
  where revoked_at is null;

create table public.form_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  form_key text not null,
  name text not null,
  category text not null,
  is_official boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_definitions_key_check check (form_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  constraint form_definitions_official_scope_check check (not is_official or organization_id is null),
  constraint form_definitions_id_organization_key unique nulls not distinct (id, organization_id)
);

create unique index form_definitions_official_key_idx
  on public.form_definitions (form_key)
  where organization_id is null;

create unique index form_definitions_tenant_key_idx
  on public.form_definitions (organization_id, form_key)
  where organization_id is not null;

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_definition_id uuid not null references public.form_definitions(id) on delete restrict,
  version integer not null,
  status public.form_status not null default 'draft',
  effective_from date,
  effective_to date,
  schema_json jsonb not null,
  scoring_json jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_versions_version_check check (version > 0),
  constraint form_versions_period_check check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint form_versions_schema_object_check check (jsonb_typeof(schema_json) = 'object'),
  constraint form_versions_scoring_object_check check (jsonb_typeof(scoring_json) = 'object'),
  constraint form_versions_publish_state_check check (
    (status = 'draft' and published_at is null and published_by is null)
    or (status <> 'draft' and published_at is not null and published_by is not null)
  ),
  constraint form_versions_definition_version_key unique (form_definition_id, version)
);

create table public.care_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  form_version_id uuid references public.form_versions(id) on delete restrict,
  record_key uuid not null default gen_random_uuid(),
  version integer not null default 1,
  previous_version_id uuid,
  category text not null,
  status public.record_status not null default 'draft',
  occurred_at timestamptz not null,
  effective_from timestamptz,
  effective_to timestamptz,
  data jsonb not null default '{}'::jsonb,
  source_system text not null default 'local',
  source_record_id text,
  import_batch_id uuid,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  signature_purpose text,
  content_hash text,
  correction_reason text,
  row_version bigint not null default 1,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_records_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint care_records_id_scope_key unique (id, organization_id, branch_id, client_id),
  constraint care_records_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, client_id)
    references public.care_records(id, organization_id, branch_id, client_id) on delete restrict,
  constraint care_records_version_check check (version > 0 and row_version > 0),
  constraint care_records_period_check check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint care_records_data_object_check check (jsonb_typeof(data) = 'object'),
  constraint care_records_signature_check check (
    (status = 'draft' and signed_at is null and signed_by is null and content_hash is null)
    or (
      status <> 'draft'
      and signed_at is not null
      and signed_by is not null
      and content_hash ~ '^[a-f0-9]{64}$'
      and char_length(btrim(signature_purpose)) > 0
    )
  ),
  constraint care_records_correction_check check (
    previous_version_id is null or char_length(btrim(correction_reason)) > 0
  ),
  constraint care_records_record_version_key unique (organization_id, record_key, version)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  service_date date not null,
  status public.attendance_status not null default 'present',
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  source text not null default 'staff',
  correction_of_id uuid,
  correction_reason text,
  idempotency_key uuid not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint attendance_records_id_scope_key unique (id, organization_id, branch_id, client_id),
  constraint attendance_records_correction_scope_fkey
    foreign key (correction_of_id, organization_id, branch_id, client_id)
    references public.attendance_records(id, organization_id, branch_id, client_id) on delete restrict,
  constraint attendance_records_time_check check (
    checked_out_at is null or checked_in_at is null or checked_out_at >= checked_in_at
  ),
  constraint attendance_records_correction_check check (
    correction_of_id is null or char_length(btrim(correction_reason)) > 0
  ),
  constraint attendance_records_signature_check check (
    signed_at is null
    or (signed_by is not null and content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint attendance_records_scope_idempotency_key unique (organization_id, idempotency_key)
);

create unique index attendance_records_current_day_idx
  on public.attendance_records (client_id, service_date)
  where correction_of_id is null and status <> 'cancelled';

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  measurement_kind text not null,
  measured_at timestamptz not null,
  numeric_value numeric(12,4),
  text_value text,
  unit text,
  context jsonb not null default '{}'::jsonb,
  source text not null default 'staff',
  recorded_by uuid references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint measurements_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint measurements_value_check check (
    (numeric_value is not null)::integer + (text_value is not null)::integer = 1
  ),
  constraint measurements_context_object_check check (jsonb_typeof(context) = 'object'),
  constraint measurements_scope_idempotency_key unique (organization_id, idempotency_key)
);

create table public.medication_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  record_key uuid not null default gen_random_uuid(),
  version integer not null default 1,
  previous_version_id uuid,
  medication_name text not null,
  dose numeric(12,4) not null,
  dose_unit text not null,
  route text not null,
  schedule jsonb not null,
  high_risk boolean not null default false,
  effective_from timestamptz not null,
  effective_to timestamptz,
  status public.medication_plan_status not null default 'draft',
  source_system text not null default 'local',
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  content_hash text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_plans_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint medication_plans_previous_scope_fkey
    foreign key (previous_version_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id) on delete restrict,
  constraint medication_plans_version_check check (version > 0),
  constraint medication_plans_dose_check check (dose > 0),
  constraint medication_plans_period_check check (effective_to is null or effective_to >= effective_from),
  constraint medication_plans_schedule_object_check check (jsonb_typeof(schedule) = 'object'),
  constraint medication_plans_signature_check check (
    signed_at is null
    or (signed_by is not null and content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint medication_plans_record_version_key unique (organization_id, record_key, version),
  constraint medication_plans_id_scope_key unique (id, organization_id, branch_id, client_id)
);

create table public.medication_administrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  medication_plan_id uuid not null,
  scheduled_for timestamptz not null,
  administered_at timestamptz,
  status public.medication_administration_status not null default 'scheduled',
  actual_dose numeric(12,4),
  dose_unit text,
  reason text,
  late_entry boolean not null default false,
  requires_second_verification boolean not null default false,
  recorded_by uuid references auth.users(id) on delete restrict,
  second_verified_by uuid references auth.users(id) on delete restrict,
  second_verified_at timestamptz,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  content_hash text,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_administrations_plan_scope_fkey
    foreign key (medication_plan_id, organization_id, branch_id, client_id)
    references public.medication_plans(id, organization_id, branch_id, client_id) on delete restrict,
  constraint medication_administrations_dose_check check (actual_dose is null or actual_dose > 0),
  constraint medication_administrations_execution_check check (
    status <> 'administered'
    or (administered_at is not null and actual_dose is not null and recorded_by is not null)
  ),
  constraint medication_administrations_verifier_check check (
    second_verified_by is null or recorded_by is null or second_verified_by <> recorded_by
  ),
  constraint medication_administrations_verification_state_check check (
    not requires_second_verification
    or signed_at is null
    or (second_verified_by is not null and second_verified_at is not null)
  ),
  constraint medication_administrations_signature_check check (
    signed_at is null
    or (signed_by is not null and content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint medication_administrations_plan_schedule_key unique (medication_plan_id, scheduled_for),
  constraint medication_administrations_scope_idempotency_key unique (organization_id, idempotency_key)
);

create table public.service_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  care_plan_record_id uuid,
  service_code text not null,
  status public.service_event_status not null default 'planned',
  started_at timestamptz not null,
  ended_at timestamptz,
  staff_user_id uuid references auth.users(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb,
  idempotency_key uuid not null,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_events_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint service_events_care_plan_scope_fkey
    foreign key (care_plan_record_id, organization_id, branch_id, client_id)
    references public.care_records(id, organization_id, branch_id, client_id) on delete restrict,
  constraint service_events_period_check check (ended_at is null or ended_at >= started_at),
  constraint service_events_completion_check check (status <> 'completed' or ended_at is not null),
  constraint service_events_evidence_object_check check (jsonb_typeof(evidence) = 'object'),
  constraint service_events_signature_check check (
    signed_at is null
    or (signed_by is not null and content_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint service_events_scope_idempotency_key unique (organization_id, idempotency_key),
  constraint service_events_id_scope_key unique (id, organization_id, branch_id, client_id)
);

create table public.claim_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  claim_period_start date not null,
  claim_period_end date not null,
  format_version text not null,
  status public.claim_status not null default 'draft',
  snapshot_hash text,
  exported_at timestamptz,
  submitted_at timestamptz,
  reconciled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_batches_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint claim_batches_period_check check (claim_period_end >= claim_period_start),
  constraint claim_batches_snapshot_hash_check check (
    snapshot_hash is null or snapshot_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint claim_batches_export_state_check check (
    status in ('draft', 'validated') or (snapshot_hash is not null and exported_at is not null)
  ),
  constraint claim_batches_id_scope_key unique (id, organization_id, branch_id),
  constraint claim_batches_period_format_key unique (
    organization_id,
    branch_id,
    claim_period_start,
    claim_period_end,
    format_version
  )
);

create table public.claim_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  claim_batch_id uuid not null,
  client_id uuid not null,
  service_event_id uuid not null,
  service_code text not null,
  service_date date not null,
  units numeric(12,4) not null,
  amount numeric(14,2) not null,
  evidence_hash text not null,
  response_code text,
  response_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_items_batch_scope_fkey
    foreign key (claim_batch_id, organization_id, branch_id)
    references public.claim_batches(id, organization_id, branch_id) on delete cascade,
  constraint claim_items_client_scope_fkey
    foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint claim_items_service_scope_fkey
    foreign key (service_event_id, organization_id, branch_id, client_id)
    references public.service_events(id, organization_id, branch_id, client_id) on delete restrict,
  constraint claim_items_units_check check (units > 0),
  constraint claim_items_amount_check check (amount >= 0),
  constraint claim_items_evidence_hash_check check (evidence_hash ~ '^[a-f0-9]{64}$'),
  constraint claim_items_batch_service_key unique (claim_batch_id, service_event_id)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  upload_idempotency_key uuid not null,
  version bigint not null default 1,
  original_file_name text not null,
  mime_type text not null,
  encoding text not null,
  file_size_bytes bigint not null,
  sha256 text not null,
  normalized_fingerprint text,
  mapping_version text not null,
  status public.import_batch_status not null default 'queued',
  raw_object_key text not null,
  raw_object_version text,
  retain_until date not null default (
    (((now() at time zone 'Asia/Taipei')::date + interval '7 years')::date)
  ),
  section_count integer not null default 0,
  mapped_field_count integer not null default 0,
  unmapped_field_count integer not null default 0,
  conflict_count integer not null default 0,
  warning_count integer not null default 0,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  failure_code text,
  staging_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_batches_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint import_batches_file_name_check check (char_length(original_file_name) between 1 and 255),
  constraint import_batches_version_check check (version > 0),
  constraint import_batches_mime_check check (mime_type in ('text/html', 'application/xhtml+xml')),
  constraint import_batches_encoding_check check (lower(encoding) in ('utf-8', 'utf8')),
  constraint import_batches_file_size_check check (file_size_bytes between 1 and 26214400),
  constraint import_batches_sha256_check check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint import_batches_fingerprint_check check (
    normalized_fingerprint is null or normalized_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint import_batches_retention_check check (
    retain_until >= (((created_at at time zone 'Asia/Taipei')::date + interval '7 years')::date)
  ),
  constraint import_batches_counts_check check (
    section_count >= 0
    and mapped_field_count >= 0
    and unmapped_field_count >= 0
    and conflict_count >= 0
    and warning_count >= 0
  ),
  constraint import_batches_staging_payload_check check (
    jsonb_typeof(staging_payload) = 'object'
    and octet_length(staging_payload::text) <= 16777216
  ),
  constraint import_batches_approval_check check (
    status <> 'imported' or (approved_by is not null and approved_at is not null)
  ),
  constraint import_batches_branch_hash_key unique (organization_id, branch_id, sha256),
  constraint import_batches_upload_idempotency_key unique (
    organization_id,
    branch_id,
    uploaded_by,
    upload_idempotency_key
  ),
  constraint import_batches_id_scope_key unique (id, organization_id, branch_id)
);

create table public.import_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  import_batch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_kind text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  expected_version bigint,
  result_version bigint,
  status text not null default 'pending',
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_operations_batch_scope_fkey
    foreign key (import_batch_id, organization_id, branch_id)
    references public.import_batches(id, organization_id, branch_id) on delete restrict,
  constraint import_operations_kind_check check (
    operation_kind in ('upload', 'reparse', 'approve')
  ),
  constraint import_operations_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint import_operations_version_check check (
    (expected_version is null or expected_version > 0)
    and (result_version is null or result_version > 0)
    and (
      (operation_kind = 'upload' and expected_version is null)
      or (operation_kind in ('reparse', 'approve') and expected_version is not null)
    )
    and (
      expected_version is null
      or result_version is null
      or result_version >= expected_version
    )
  ),
  constraint import_operations_status_check check (
    status in ('pending', 'applied', 'failed')
  ),
  constraint import_operations_completion_check check (
    (
      status = 'pending'
      and completed_at is null
      and result_version is null
      and error_code is null
    )
    or (
      status = 'applied'
      and completed_at is not null
      and result_version is not null
      and error_code is null
    )
    or (
      status = 'failed'
      and completed_at is not null
      and result_version is null
      and error_code is not null
    )
  ),
  constraint import_operations_actor_idempotency_key unique (
    organization_id,
    branch_id,
    actor_user_id,
    idempotency_key
  )
);

create table public.import_fields (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  branch_id uuid not null,
  import_batch_id uuid not null,
  ordinal integer not null,
  section_code text not null,
  parent_path text[] not null default '{}'::text[],
  field_code text,
  field_label text not null,
  raw_value text,
  normalized_value jsonb,
  source_locator text not null,
  mapping_status text not null default 'unmapped',
  warning_codes text[] not null default '{}'::text[],
  target_entity text,
  target_field text,
  conflict jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_fields_batch_scope_fkey
    foreign key (import_batch_id, organization_id, branch_id)
    references public.import_batches(id, organization_id, branch_id) on delete cascade,
  constraint import_fields_ordinal_check check (ordinal >= 0),
  constraint import_fields_mapping_status_check check (
    mapping_status in ('mapped', 'unmapped', 'ignored', 'conflict', 'invalid')
  ),
  constraint import_fields_conflict_object_check check (
    conflict is null or jsonb_typeof(conflict) = 'object'
  ),
  constraint import_fields_batch_ordinal_key unique (import_batch_id, ordinal)
);

alter table public.care_records
  add constraint care_records_import_batch_fkey
  foreign key (import_batch_id, organization_id, branch_id)
  references public.import_batches(id, organization_id, branch_id) on delete restrict;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  category text not null,
  priority smallint not null default 1,
  title text not null,
  body text not null,
  audience jsonb not null,
  status text not null default 'draft',
  scheduled_for timestamptz,
  source_type text,
  source_id text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint notifications_priority_check check (priority between 0 and 3),
  constraint notifications_audience_object_check check (jsonb_typeof(audience) = 'object'),
  constraint notifications_status_check check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  constraint notifications_id_organization_key unique (id, organization_id)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid,
  notification_id uuid not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  status public.delivery_status not null default 'queued',
  idempotency_key uuid not null,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_notification_scope_fkey
    foreign key (notification_id, organization_id)
    references public.notifications(id, organization_id) on delete cascade,
  constraint notification_deliveries_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint notification_deliveries_channel_check check (channel in ('in_app', 'pwa', 'line', 'sms', 'email')),
  constraint notification_deliveries_scope_idempotency_key unique (organization_id, idempotency_key),
  constraint notification_deliveries_target_key unique (notification_id, recipient_user_id, channel)
);

create table public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  idempotency_key uuid not null,
  entity_type text not null,
  entity_id uuid,
  base_version bigint,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload_hash text not null,
  status public.sync_status not null default 'pending',
  conflict_details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_operations_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint sync_operations_device_id_check check (char_length(device_id) between 8 and 200),
  constraint sync_operations_base_version_check check (base_version is null or base_version > 0),
  constraint sync_operations_payload_hash_check check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint sync_operations_conflict_check check (
    status <> 'conflict' or jsonb_typeof(conflict_details) = 'object'
  ),
  constraint sync_operations_user_idempotency_key unique (organization_id, user_id, idempotency_key)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  branch_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  row_pk text,
  occurred_at timestamptz not null default now(),
  request_id text,
  idempotency_key uuid,
  changed_fields text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_events_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint audit_events_action_check check (
    action in ('select', 'insert', 'update', 'delete', 'export', 'print', 'sign', 'correct', 'permission_change', 'rule_change', 'integration')
  ),
  constraint audit_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table private.reauth_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  aal text not null,
  verification_method text not null,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reauth_events_aal_check check (aal = 'aal2'),
  constraint reauth_events_method_check check (
    verification_method in ('totp', 'webauthn', 'phone', 'recovery', 'unknown')
  ),
  constraint reauth_events_revoked_check check (revoked_at is null or revoked_at >= verified_at),
  constraint reauth_events_user_session_key unique (user_id, session_id)
);

create table private.reauth_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  nonce_sha256 text not null unique,
  idempotency_key uuid not null,
  issued_jwt_iat timestamptz not null,
  issued_jwt_jti text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_jwt_iat timestamptz,
  consumed_jwt_jti text,
  factor_method text,
  factor_verified_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint reauth_challenges_nonce_check check (nonce_sha256 ~ '^[a-f0-9]{64}$'),
  constraint reauth_challenges_period_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
  ),
  constraint reauth_challenges_consume_check check (
    (
      consumed_at is null
      and consumed_jwt_iat is null
      and consumed_jwt_jti is null
      and factor_method is null
      and factor_verified_at is null
      and invalidated_at is null
      and invalidation_reason is null
    )
    or (
      consumed_at is not null
      and consumed_jwt_iat is not null
      and factor_method in ('totp', 'webauthn', 'phone')
      and factor_verified_at is not null
      and factor_verified_at <= consumed_at + interval '1 minute'
      and invalidated_at is null
      and invalidation_reason is null
    )
    or (
      consumed_at is null
      and consumed_jwt_iat is null
      and consumed_jwt_jti is null
      and factor_method is null
      and factor_verified_at is null
      and invalidated_at is not null
      and invalidated_at >= created_at
      and char_length(btrim(invalidation_reason)) between 1 and 80
    )
  ),
  constraint reauth_challenges_user_session_idempotency_key
    unique (user_id, session_id, idempotency_key)
);

alter table private.reauth_events
  add column challenge_id uuid not null unique
  references private.reauth_challenges(id) on delete restrict;

-- Foreign-key and tenant/time access indexes. PostgreSQL does not create these
-- automatically for referencing columns.
create index branches_organization_id_idx on public.branches (organization_id);
create index roles_organization_id_idx on public.roles (organization_id) where organization_id is not null;
create index role_permissions_permission_id_idx on public.role_permissions (permission_id);
create index role_permissions_granted_by_idx on public.role_permissions (granted_by) where granted_by is not null;
create index memberships_profile_scope_idx on public.memberships (profile_id, organization_id, branch_id, status);
create index memberships_branch_id_idx on public.memberships (branch_id) where branch_id is not null;
create index membership_roles_role_id_idx on public.membership_roles (role_id);
create index membership_roles_assigned_by_idx on public.membership_roles (assigned_by) where assigned_by is not null;
create index clients_branch_status_idx on public.clients (organization_id, branch_id, status, display_name);
create index client_assignments_assignee_active_idx
  on public.client_assignments (assignee_user_id, organization_id, branch_id, client_id)
  where ends_at is null;
create index client_assignments_client_id_idx on public.client_assignments (client_id);
create index client_assignments_assigned_by_idx on public.client_assignments (assigned_by) where assigned_by is not null;
create index consents_recipient_active_idx
  on public.consents (recipient_user_id, client_id)
  where revoked_at is null;
create index consents_scope_client_idx on public.consents (organization_id, branch_id, client_id);
create index consents_created_by_idx on public.consents (created_by) where created_by is not null;
create index form_versions_definition_status_idx on public.form_versions (form_definition_id, status, effective_from);
create index form_versions_published_by_idx on public.form_versions (published_by) where published_by is not null;
create index care_records_client_category_time_idx
  on public.care_records (organization_id, branch_id, client_id, category, occurred_at desc);
create index care_records_form_version_id_idx on public.care_records (form_version_id) where form_version_id is not null;
create index care_records_previous_version_id_idx on public.care_records (previous_version_id) where previous_version_id is not null;
create index care_records_import_batch_id_idx on public.care_records (import_batch_id) where import_batch_id is not null;
create index care_records_created_by_idx on public.care_records (created_by);
create index care_records_signed_by_idx on public.care_records (signed_by) where signed_by is not null;
create index attendance_records_branch_date_idx
  on public.attendance_records (organization_id, branch_id, service_date, status);
create index attendance_records_correction_id_idx on public.attendance_records (correction_of_id) where correction_of_id is not null;
create index attendance_records_recorded_by_idx on public.attendance_records (recorded_by);
create index attendance_records_signed_by_idx on public.attendance_records (signed_by) where signed_by is not null;
create index measurements_client_kind_time_idx
  on public.measurements (organization_id, branch_id, client_id, measurement_kind, measured_at desc);
create index measurements_recorded_by_idx on public.measurements (recorded_by) where recorded_by is not null;
create index medication_plans_client_time_idx
  on public.medication_plans (organization_id, branch_id, client_id, effective_from desc);
create index medication_plans_previous_version_id_idx on public.medication_plans (previous_version_id) where previous_version_id is not null;
create index medication_plans_created_by_idx on public.medication_plans (created_by);
create index medication_plans_signed_by_idx on public.medication_plans (signed_by) where signed_by is not null;
create index medication_administrations_client_schedule_idx
  on public.medication_administrations (organization_id, branch_id, client_id, scheduled_for, status);
create index medication_administrations_plan_id_idx on public.medication_administrations (medication_plan_id);
create index medication_administrations_recorded_by_idx
  on public.medication_administrations (recorded_by) where recorded_by is not null;
create index medication_administrations_second_verified_by_idx
  on public.medication_administrations (second_verified_by) where second_verified_by is not null;
create index medication_administrations_signed_by_idx
  on public.medication_administrations (signed_by) where signed_by is not null;
create index service_events_client_time_idx
  on public.service_events (organization_id, branch_id, client_id, started_at desc, status);
create index service_events_care_plan_record_id_idx on public.service_events (care_plan_record_id) where care_plan_record_id is not null;
create index service_events_staff_user_id_idx on public.service_events (staff_user_id) where staff_user_id is not null;
create index service_events_signed_by_idx on public.service_events (signed_by) where signed_by is not null;
create index claim_batches_branch_period_idx
  on public.claim_batches (organization_id, branch_id, claim_period_start desc, status);
create index claim_batches_created_by_idx on public.claim_batches (created_by);
create index claim_items_client_date_idx on public.claim_items (client_id, service_date desc);
create index claim_items_service_event_id_idx on public.claim_items (service_event_id);
create index claim_items_scope_date_idx on public.claim_items (organization_id, branch_id, service_date desc);
create index import_batches_branch_created_idx
  on public.import_batches (organization_id, branch_id, created_at desc, status);
create index import_batches_uploaded_by_idx on public.import_batches (uploaded_by);
create index import_batches_approved_by_idx on public.import_batches (approved_by) where approved_by is not null;
create index import_operations_batch_created_idx
  on public.import_operations (import_batch_id, created_at desc);
create index import_operations_actor_status_idx
  on public.import_operations (actor_user_id, status, created_at desc);
create index import_operations_scope_created_idx
  on public.import_operations (organization_id, branch_id, created_at desc);
create index import_fields_mapping_queue_idx
  on public.import_fields (import_batch_id, mapping_status, ordinal);
create index import_fields_scope_batch_idx on public.import_fields (organization_id, branch_id, import_batch_id);
create index notifications_branch_schedule_idx
  on public.notifications (organization_id, branch_id, status, scheduled_for);
create index notifications_created_by_idx on public.notifications (created_by);
create index notification_deliveries_recipient_status_idx
  on public.notification_deliveries (recipient_user_id, status, created_at desc);
create index notification_deliveries_scope_notification_idx
  on public.notification_deliveries (organization_id, branch_id, notification_id);
create index sync_operations_user_status_idx
  on public.sync_operations (user_id, status, received_at desc);
create index sync_operations_scope_received_idx
  on public.sync_operations (organization_id, branch_id, received_at desc);
create index audit_events_scope_time_idx
  on public.audit_events (organization_id, branch_id, occurred_at desc);
create index audit_events_actor_time_idx
  on public.audit_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;
create index audit_events_request_id_idx
  on public.audit_events (request_id)
  where request_id is not null;
create unique index audit_events_line_webhook_event_key
  on public.audit_events (table_name, row_pk)
  where table_name = 'line_webhook_events' and row_pk is not null;
create index reauth_events_recent_idx
  on private.reauth_events (user_id, session_id, verified_at desc)
  where revoked_at is null;
create unique index reauth_challenges_one_pending_key
  on private.reauth_challenges (user_id, session_id)
  where consumed_at is null and invalidated_at is null;

-- The permission catalogue is schema state, not optional demonstration data.
insert into public.permissions (permission_key, description, risk_level) values
  ('organizations.manage', 'Manage organization settings', 3),
  ('branches.manage', 'Manage branch settings', 3),
  ('profiles.manage', 'Manage staff profiles', 3),
  ('memberships.manage', 'Manage organization membership', 3),
  ('roles.manage', 'Manage roles and permission assignments', 3),
  ('clients.read', 'Read authorized client identity data', 1),
  ('clients.view_all', 'Read every client within the authorized branch scope', 2),
  ('clients.manage', 'Create and update client identity data', 2),
  ('clients.assign', 'Assign staff to clients', 3),
  ('consents.manage', 'Manage client and family consent', 3),
  ('forms.manage', 'Publish form and scoring rule versions', 3),
  ('care_records.read', 'Read authorized care records', 1),
  ('care_records.write', 'Create and edit draft care records', 2),
  ('care_records.sign', 'Sign care records', 3),
  ('attendance.read', 'Read attendance records', 1),
  ('attendance.write', 'Record attendance', 2),
  ('attendance.correct', 'Correct signed attendance records', 3),
  ('health.read', 'Read health measurements', 2),
  ('health.write', 'Record health measurements', 2),
  ('medications.read', 'Read medication plans and administrations', 2),
  ('medications.manage', 'Manage medication plans', 3),
  ('medications.administer', 'Record medication administration', 3),
  ('medications.verify', 'Independently verify medication administration', 3),
  ('services.read', 'Read service events', 1),
  ('services.write', 'Record service events', 2),
  ('services.sign', 'Sign completed service events', 3),
  ('claims.read', 'Read claim batches and items', 2),
  ('claims.manage', 'Build and reconcile claim batches', 3),
  ('claims.export', 'Export or submit immutable claim snapshots', 3),
  ('imports.manage', 'Upload and review staged imports', 3),
  ('imports.approve', 'Approve staged imports into production records', 3),
  ('notifications.read', 'Read operational notifications', 0),
  ('notifications.manage', 'Create and send notifications', 2),
  ('audit.view', 'Read tenant audit events', 3),
  ('sync.use', 'Use limited offline synchronization', 1);

insert into public.roles (id, role_key, name, description, is_system) values
  ('10000000-0000-4000-8000-000000000001', 'platform_ops', '平台維運人員', 'Infrastructure operations; no client permissions by default.', true),
  ('10000000-0000-4000-8000-000000000002', 'organization_manager', '機構管理員', 'Organization-wide administration.', true),
  ('10000000-0000-4000-8000-000000000003', 'branch_supervisor', '分支主管', 'Branch-wide supervision.', true),
  ('10000000-0000-4000-8000-000000000004', 'case_manager_social_worker', '個管／社工', 'Assigned-client case and social work.', true),
  ('10000000-0000-4000-8000-000000000005', 'nurse', '護理人員', 'Assigned-client nursing and medication duties.', true),
  ('10000000-0000-4000-8000-000000000006', 'care_worker', '照顧服務員', 'Assigned-client daily care duties.', true),
  ('10000000-0000-4000-8000-000000000007', 'professional', '專業人員', 'Assigned-client PT, OT, nutrition, or other professional services.', true),
  ('10000000-0000-4000-8000-000000000008', 'transport_driver', '交通與駕駛人員', 'Assigned transport duties.', true),
  ('10000000-0000-4000-8000-000000000009', 'finance_claims', '財務／申報人員', 'Billing and claim preparation.', true),
  ('10000000-0000-4000-8000-000000000010', 'family', '家屬／關係人', 'Consent-scoped family portal access.', true);

-- System templates are deliberately conservative. Tenant administrators may
-- clone them into organization-specific roles and then use the governed role UI.
insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000001'::uuid, id
from public.permissions
where permission_key in ('organizations.manage', 'branches.manage', 'audit.view');

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000002'::uuid, id
from public.permissions
where permission_key <> 'medications.verify';

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000003'::uuid, id
from public.permissions
where permission_key not in ('organizations.manage');

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000004'::uuid, id
from public.permissions
where permission_key in (
  'clients.read', 'care_records.read', 'care_records.write', 'care_records.sign',
  'attendance.read', 'health.read', 'services.read', 'services.write',
  'services.sign', 'notifications.read', 'sync.use'
);

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000005'::uuid, id
from public.permissions
where permission_key in (
  'clients.read', 'care_records.read', 'care_records.write', 'care_records.sign',
  'attendance.read', 'health.read', 'health.write', 'medications.read',
  'medications.manage', 'medications.administer', 'medications.verify',
  'services.read', 'services.write', 'services.sign', 'notifications.read', 'sync.use'
);

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000006'::uuid, id
from public.permissions
where permission_key in (
  'clients.read', 'care_records.read', 'care_records.write', 'attendance.read',
  'attendance.write', 'health.read', 'health.write', 'medications.read',
  'medications.administer', 'services.read', 'services.write',
  'notifications.read', 'sync.use'
);

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000007'::uuid, id
from public.permissions
where permission_key in (
  'clients.read', 'care_records.read', 'care_records.write', 'care_records.sign',
  'health.read', 'services.read', 'services.write', 'services.sign',
  'notifications.read', 'sync.use'
);

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000008'::uuid, id
from public.permissions
where permission_key in ('clients.read', 'attendance.read', 'services.read', 'services.write', 'notifications.read', 'sync.use');

insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000009'::uuid, id
from public.permissions
where permission_key in ('claims.read', 'claims.manage', 'claims.export', 'notifications.read', 'audit.view');

-- Family access is consent-scoped through dedicated whitelist RPCs and direct
-- recipient delivery rows. The family template intentionally has no staff
-- permission grants, including notifications.read and sync.use.
