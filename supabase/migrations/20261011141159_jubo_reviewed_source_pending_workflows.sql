
-- Imported reviewed candidate: 20261003152228_jubo_case_source_staging.sql
-- Private, append-only evidence for a reviewed Jubo export.  This migration
-- deliberately does not create operational clients or signed care records.
begin;
set local lock_timeout = '5s';

create table private.jubo_source_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  source_kind text not null check (source_kind in ('client_master', 'daycare_monthly_summary')),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_filename text not null check (char_length(btrim(source_filename)) between 1 and 180
    and source_filename !~ '[[:cntrl:]/\\]' and source_filename ~* '\.xlsx$'),
  storage_path text not null check (char_length(storage_path) between 1 and 500
    and storage_path !~ '[[:cntrl:]]'
    and starts_with(storage_path,
      'organizations/' || organization_id::text || '/branches/' || branch_id::text || '/jubo/')),
  column_labels jsonb not null check (jsonb_typeof(column_labels) = 'array'
    and jsonb_array_length(column_labels) between 1 and 256),
  section_labels jsonb not null check (jsonb_typeof(section_labels) = 'array'
    and jsonb_array_length(section_labels) = jsonb_array_length(column_labels)),
  declared_row_count integer not null check (declared_row_count between 1 and 5000),
  mapping_version text not null check (char_length(btrim(mapping_version)) between 1 and 80),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict,
  unique (id, organization_id, branch_id),
  unique (organization_id, branch_id, source_kind, source_sha256),
  unique (organization_id, branch_id, storage_path)
);

create table private.jubo_source_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  source_row_number integer not null check (source_row_number > 0),
  identity_sha256 text not null check (identity_sha256 ~ '^[a-f0-9]{64}$'),
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'array'
    and octet_length(raw_values::text) <= 262144),
  row_sha256 text not null check (row_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (batch_id, organization_id, branch_id)
    references private.jubo_source_batches(id, organization_id, branch_id) on delete restrict,
  unique (batch_id, source_row_number),
  unique (batch_id, identity_sha256),
  unique (id, organization_id, branch_id)
);

create table private.jubo_client_source_links (
  id uuid primary key default gen_random_uuid(),
  source_row_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  import_operation_id uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  foreign key (source_row_id, organization_id, branch_id)
    references private.jubo_source_rows(id, organization_id, branch_id) on delete restrict,
  foreign key (client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  unique (source_row_id),
  unique (import_operation_id, source_row_id)
);

create index jubo_source_batches_scope_idx
  on private.jubo_source_batches(organization_id, branch_id, source_kind, created_at desc);
create index jubo_source_rows_identity_idx
  on private.jubo_source_rows(organization_id, branch_id, identity_sha256);
create index jubo_client_source_links_client_idx
  on private.jubo_client_source_links(organization_id, branch_id, client_id);

-- The same exact source columns and values must be retained, even if the
-- operational profile has no equivalent field.  No row may be attached to a
-- differently scoped batch, and no duplicate identity may enter one batch.
create function private.validate_jubo_source_row() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_labels jsonb;
begin
  select column_labels into v_labels
  from private.jubo_source_batches
  where id = new.batch_id and organization_id = new.organization_id
    and branch_id = new.branch_id;
  if v_labels is null then
    raise exception using errcode = '42501', message = 'JUBO_SOURCE_SCOPE_MISMATCH';
  end if;
  if jsonb_array_length(new.raw_values) <> jsonb_array_length(v_labels) then
    raise exception using errcode = '22023', message = 'JUBO_COLUMN_COUNT_MISMATCH';
  end if;
  new.row_sha256 := encode(sha256(convert_to(new.raw_values::text, 'UTF8')), 'hex');
  return new;
end;
$$;
create trigger jubo_source_rows_validate before insert on private.jubo_source_rows
  for each row execute function private.validate_jubo_source_row();

do $tables$ declare t text; begin
  foreach t in array array['jubo_source_batches', 'jubo_source_rows', 'jubo_client_source_links'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('alter table private.%I force row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()', t || '_immutable', t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()', t || '_audit', t);
  end loop;
end $tables$;
revoke all on function private.validate_jubo_source_row() from public, anon, authenticated, service_role;

commit;


-- Imported reviewed candidate: 20261008122500_jubo_source_identity_derived.sql
-- Correct the already-versioned JUBO staging trigger without rewriting its
-- applied migration. No operational client or signed record is created here.
begin;
set local lock_timeout = '5s';

create or replace function private.validate_jubo_source_row() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_labels jsonb;
  v_source_kind text;
  v_identity text;
begin
  select column_labels, source_kind into v_labels, v_source_kind
  from private.jubo_source_batches
  where id = new.batch_id and organization_id = new.organization_id
    and branch_id = new.branch_id;
  if v_labels is null then
    raise exception using errcode = '42501', message = 'JUBO_SOURCE_SCOPE_MISMATCH';
  end if;
  if jsonb_array_length(new.raw_values) <> jsonb_array_length(v_labels) then
    raise exception using errcode = '22023', message = 'JUBO_COLUMN_COUNT_MISMATCH';
  end if;
  -- The uniqueness key comes from the original identity cell, never from a
  -- caller-supplied digest. Unsupported forms require source review.
  v_identity := pg_catalog.upper(pg_catalog.regexp_replace(
    coalesce(new.raw_values ->> case v_source_kind
      when 'client_master' then 25 else 29 end, ''),
    '[[:space:]-]', '', 'g'));
  v_identity := pg_catalog.replace(v_identity, '－', '');
  if v_identity !~ '^[A-Z0-9]{8,20}$' then
    raise exception using errcode = '22023', message = 'JUBO_SOURCE_IDENTITY_INVALID';
  end if;
  new.identity_sha256 := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(v_identity, 'UTF8')), 'hex');
  new.row_sha256 := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(new.raw_values::text, 'UTF8')), 'hex');
  return new;
end;
$$;

revoke all on function private.validate_jubo_source_row() from public, anon, authenticated, service_role;
commit;


-- Imported reviewed candidate: 20261009100217_jubo_pending_intake_gate.sql
-- Candidate-only gate for the first reviewed JUBO 23/17 export. No client
-- promotion function is granted here: current operational screens include
-- active clients with admitted_on IS NULL, so a pending case is not safe yet.
begin;
set local lock_timeout = '5s';

-- The source master has one nonempty A-only footer. The existing source_rows
-- table correctly rejects it as an invalid client, but discarding it would
-- make the 24 nonempty source rows appear to be 23/23 complete. Keep it here.
create table private.jubo_source_nonrecord_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  source_row_number integer not null check (source_row_number > 0),
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'array'
    and octet_length(raw_values::text) <= 262144),
  row_sha256 text not null check (row_sha256 ~ '^[a-f0-9]{64}$'),
  review_reason text not null check (char_length(btrim(review_reason)) between 10 and 500),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (batch_id, organization_id, branch_id)
    references private.jubo_source_batches(id, organization_id, branch_id) on delete restrict,
  unique (batch_id, source_row_number)
);
create index jubo_nonrecord_scope_idx
  on private.jubo_source_nonrecord_rows(organization_id, branch_id, batch_id);
create index jubo_nonrecord_reviewer_idx
  on private.jubo_source_nonrecord_rows(reviewed_by);
alter table private.jubo_source_nonrecord_rows enable row level security;
alter table private.jubo_source_nonrecord_rows force row level security;
revoke all on private.jubo_source_nonrecord_rows from public, anon, authenticated, service_role;

create function private.validate_jubo_nonrecord_row() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_kind text; v_width integer;
begin
  select source_kind, jsonb_array_length(column_labels) into v_kind, v_width
  from private.jubo_source_batches
  where id = new.batch_id and organization_id = new.organization_id and branch_id = new.branch_id;
  if v_kind is distinct from 'client_master' or v_width is distinct from 95
    or jsonb_array_length(new.raw_values) is distinct from 95 then
    raise exception using errcode = '22023', message = 'JUBO_NONRECORD_INVALID';
  end if;
  if not exists (select 1 from jsonb_array_elements_text(new.raw_values) with ordinality cell(value, number)
    where number = 1 and nullif(btrim(value), '') is not null)
    or exists (select 1 from jsonb_array_elements_text(new.raw_values) with ordinality cell(value, number)
      where number > 1 and nullif(btrim(value), '') is not null)
    or exists (select 1 from private.jubo_source_rows row_entry
      where row_entry.batch_id = new.batch_id and row_entry.source_row_number = new.source_row_number) then
    raise exception using errcode = '22023', message = 'JUBO_NONRECORD_INVALID';
  end if;
  new.row_sha256 := encode(sha256(convert_to(new.raw_values::text, 'UTF8')), 'hex');
  return new;
end;
$$;
create trigger jubo_source_nonrecord_validate before insert on private.jubo_source_nonrecord_rows
  for each row execute function private.validate_jubo_nonrecord_row();
create trigger jubo_source_nonrecord_immutable before update or delete on private.jubo_source_nonrecord_rows
  for each row execute function private.prevent_import_upload_mutation();
create trigger jubo_source_nonrecord_audit after insert on private.jubo_source_nonrecord_rows
  for each row execute function private.audit_row_change();

-- Excel exports serialize the same date as either YYYY/MM/DD or an integral
-- serial ending in .0. This mirrors the offline verifier; invalid dates do
-- not turn into an inferred birthday.
create function private.jubo_source_date_iso(p_value text) returns date
language plpgsql immutable security invoker set search_path = '' as $$
declare v text := btrim(p_value); v_serial numeric; v_date date;
begin
  if v is null or v = '' then return null; end if;
  if v ~ '^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$' then
    v := replace(v, '/', '-');
    v_date := make_date(split_part(v,'-',1)::integer,
      split_part(v,'-',2)::integer, split_part(v,'-',3)::integer);
    return v_date;
  end if;
  if v ~ '^[0-9]{1,7}(\.0+)?$' then
    v_serial := v::numeric;
    if v_serial between 2 and 2958465 and v_serial <> 60
      and v_serial = trunc(v_serial) then
      return date '1899-12-30' + v_serial::integer;
    end if;
  end if;
  return null;
exception when datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  return null;
end;
$$;

create function private.jubo_source_sex(p_value text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case btrim(p_value)
    when '男' then 'male' when '男性' then 'male'
    when '女' then 'female' when '女性' then 'female'
    when '其他' then 'other' when '未知' then 'unknown'
    else null end;
$$;

-- Only count and reason codes are returned. Raw identifiers, names, values,
-- file names, row hashes and patient-level match results never leave private.
create function private.jubo_pending_intake_preflight(
  p_org uuid, p_branch uuid, p_master uuid, p_monthly uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_master private.jubo_source_batches%rowtype;
  v_monthly private.jubo_source_batches%rowtype;
  v_master_count integer; v_monthly_count integer; v_footer_count integer;
  v_active integer; v_suspended integer; v_closed integer;
  v_unmatched integer; v_orphan integer; v_name_mismatch integer;
  v_dob_mismatch integer; v_sex_mismatch integer; v_phone_mismatch integer;
  v_status_mismatch integer; v_duplicate_existing integer;
  v_source_number_present integer; v_missing_first_service integer;
  v_invalid_dob integer; v_invalid_sex integer; v_missing_name integer;
  v_overlap integer;
  v_reasons text[] := '{}';
begin
  perform private.require_intake_authority(p_org, p_branch, null, false);
  if not private.has_permission(p_org, p_branch, 'imports.manage')
    or not private.has_permission(p_org, p_branch, 'imports.approve') then
    raise exception using errcode = '42501', message = 'JUBO_PREFLIGHT_DENIED';
  end if;
  select * into v_master from private.jubo_source_batches
    where id = p_master and organization_id = p_org and branch_id = p_branch;
  select * into v_monthly from private.jubo_source_batches
    where id = p_monthly and organization_id = p_org and branch_id = p_branch;
  if v_master.id is null or v_monthly.id is null then
    raise exception using errcode = '42501', message = 'JUBO_SOURCE_SCOPE_MISMATCH';
  end if;
  if v_master.source_kind <> 'client_master'
    or v_monthly.source_kind <> 'daycare_monthly_summary'
    or v_master.source_sha256 <> '7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7'
    or v_monthly.source_sha256 <> 'aa1e02c2bc1029bc78d8f7e46c68f979fbdfa1d7010a5ec8e29818bc54854ff4'
    or v_master.mapping_version <> 'jubo-master-monthly-202610-v1'
    or v_monthly.mapping_version <> 'jubo-master-monthly-202610-v1'
    or jsonb_array_length(v_master.column_labels) <> 95
    or jsonb_array_length(v_monthly.column_labels) <> 191 then
    raise exception using errcode = '22023', message = 'JUBO_SOURCE_VERSION_MISMATCH';
  end if;
  select count(*), count(*) filter (where raw_values->>15 = '服務中'),
    count(*) filter (where raw_values->>15 = '暫停服務'),
    count(*) filter (where raw_values->>15 = '結案'),
    count(*) filter (where nullif(btrim(raw_values->>1), '') is not null),
    count(*) filter (where nullif(btrim(raw_values->>9), '') is null),
    count(*) filter (where private.jubo_source_date_iso(raw_values->>23) is null),
    count(*) filter (where private.jubo_source_sex(raw_values->>3) is null),
    count(*) filter (where nullif(btrim(raw_values->>2), '') is null)
    into v_master_count, v_active, v_suspended, v_closed,
      v_source_number_present, v_missing_first_service,
      v_invalid_dob, v_invalid_sex, v_missing_name
  from private.jubo_source_rows where batch_id = p_master;
  select count(*) into v_monthly_count from private.jubo_source_rows where batch_id = p_monthly;
  select count(*) into v_footer_count from private.jubo_source_nonrecord_rows footer
    where footer.batch_id = p_master
      and footer.source_row_number > (select coalesce(max(source_row_number),0)
        from private.jubo_source_rows where batch_id = p_master);
  select count(*) into v_overlap from private.jubo_source_nonrecord_rows footer
    join private.jubo_source_rows row_entry
      on row_entry.batch_id = footer.batch_id
      and row_entry.source_row_number = footer.source_row_number
    where footer.batch_id = p_master;
  select count(*) into v_unmatched from private.jubo_source_rows m
    where m.batch_id = p_master and m.raw_values->>15 = '服務中'
      and not exists (select 1 from private.jubo_source_rows s
        where s.batch_id = p_monthly and s.identity_sha256 = m.identity_sha256);
  select count(*) into v_orphan from private.jubo_source_rows s
    where s.batch_id = p_monthly and not exists (select 1 from private.jubo_source_rows m
      where m.batch_id = p_master and m.identity_sha256 = s.identity_sha256
        and m.raw_values->>15 = '服務中');
  select count(*) filter (where btrim(m.raw_values->>2) is distinct from btrim(s.raw_values->>7)),
    count(*) filter (where private.jubo_source_date_iso(m.raw_values->>23)
      is distinct from private.jubo_source_date_iso(s.raw_values->>9)
      or private.jubo_source_date_iso(s.raw_values->>9) is null),
    count(*) filter (where private.jubo_source_sex(m.raw_values->>3)
      is distinct from private.jubo_source_sex(s.raw_values->>8)
      or private.jubo_source_sex(s.raw_values->>8) is null),
    count(*) filter (where btrim(m.raw_values->>29) is distinct from btrim(s.raw_values->>22)),
    count(*) filter (where s.raw_values->>3 is distinct from '服務中')
    into v_name_mismatch, v_dob_mismatch, v_sex_mismatch, v_phone_mismatch, v_status_mismatch
  from private.jubo_source_rows m join private.jubo_source_rows s
    on s.batch_id = p_monthly and s.identity_sha256 = m.identity_sha256
  where m.batch_id = p_master;
  select count(*) into v_duplicate_existing
    from private.jubo_source_rows m join private.client_intake_identities existing
      on existing.organization_id = p_org and existing.identity_sha256 = m.identity_sha256
    where m.batch_id = p_master;
  if v_master.declared_row_count <> 23 or v_master_count <> 23
    or v_monthly.declared_row_count <> 17 or v_monthly_count <> 17 then
    v_reasons := array_append(v_reasons, 'SOURCE_COUNT_MISMATCH');
  end if;
  if v_footer_count <> 1 or v_overlap > 0 then
    v_reasons := array_append(v_reasons, 'SOURCE_FOOTER_UNREVIEWED');
  end if;
  if v_invalid_dob > 0 or v_invalid_sex > 0 or v_missing_name > 0 then
    v_reasons := array_append(v_reasons, 'SOURCE_REQUIRED_FIELD_INVALID');
  end if;
  if v_active <> 17 or v_suspended <> 1 or v_closed <> 5 then
    v_reasons := array_append(v_reasons, 'SOURCE_STATUS_MISMATCH');
  end if;
  if v_unmatched > 0 or v_orphan > 0 then
    v_reasons := array_append(v_reasons, 'SOURCE_IDENTITY_MISMATCH');
  end if;
  if v_name_mismatch > 0 or v_dob_mismatch > 0 or v_sex_mismatch > 0
    or v_phone_mismatch > 0 or v_status_mismatch > 0 then
    v_reasons := array_append(v_reasons, 'SOURCE_FIELD_MISMATCH');
  end if;
  if v_duplicate_existing > 0 then
    v_reasons := array_append(v_reasons, 'TARGET_IDENTITY_CONFLICT');
  end if;
  -- No patient writes: a dedicated pending lifecycle and every operational
  -- action gate must pass review before any commit RPC can be introduced.
  v_reasons := array_append(v_reasons, 'PENDING_LIFECYCLE_NOT_GUARDED');
  v_reasons := array_append(v_reasons, 'SOURCE_ARTIFACT_NOT_ATTESTED');
  insert into public.audit_events(organization_id, branch_id, actor_user_id, action,
    table_name, row_pk, changed_fields, metadata)
    values (p_org, p_branch, auth.uid(), 'select', 'private.jubo_source_batches', p_master::text,
      '{}', jsonb_build_object('projection', 'jubo_pending_preflight_v1',
        'source_consistent', cardinality(v_reasons) = 2));
  return jsonb_build_object(
    'masterRows', v_master_count, 'monthlyRows', v_monthly_count,
    'nonrecordRows', v_footer_count,
    'sourceStatus', jsonb_build_object('active',v_active,'suspended',v_suspended,'closed',v_closed),
    'exactIdentityMissing', v_unmatched, 'monthlyOrphanRows', v_orphan,
    'fieldDifferences', jsonb_build_object('name',v_name_mismatch,'birthDate',v_dob_mismatch,
      'sex',v_sex_mismatch,'phone',v_phone_mismatch,'status',v_status_mismatch),
    'existingIdentityCollisions', v_duplicate_existing,
    'invalidRequiredFields', jsonb_build_object('birthDate',v_invalid_dob,
      'sex',v_invalid_sex,'name',v_missing_name),
    'missingSourceNumbers', v_master_count - v_source_number_present,
    'missingFirstServiceDates', v_missing_first_service,
    'sourceConsistent', cardinality(v_reasons) = 2,
    'approvedForPromotion', false, 'reasonCodes', to_jsonb(v_reasons));
end;
$$;

create function public.jubo_pending_intake_preflight(
  p_org uuid, p_branch uuid, p_master uuid, p_monthly uuid
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select private.jubo_pending_intake_preflight(p_org,p_branch,p_master,p_monthly);
$$;
alter function private.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function private.validate_jubo_nonrecord_row() from public,anon,authenticated,service_role;
revoke all on function private.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.jubo_pending_intake_preflight(uuid,uuid,uuid,uuid) to authenticated;

commit;


-- Imported reviewed candidate: 20261009101254_jubo_reviewed_pending_registry.sql
-- Candidate-only JUBO intake: a reviewed, isolated pending registry. This
-- migration never creates public.clients or permits care, billing or claims.
-- A future, separately reviewed lifecycle migration is required to promote.
begin;
set local lock_timeout = '5s';

create table private.jubo_verified_source_pairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  master_batch_id uuid not null,
  monthly_batch_id uuid not null,
  master_byte_sha256 text not null check (master_byte_sha256 ~ '^[a-f0-9]{64}$'),
  monthly_byte_sha256 text not null check (monthly_byte_sha256 ~ '^[a-f0-9]{64}$'),
  master_byte_length integer not null check (master_byte_length between 22 and 10485760),
  monthly_byte_length integer not null check (monthly_byte_length between 22 and 10485760),
  master_rows_sha256 text not null check (master_rows_sha256 ~ '^[a-f0-9]{64}$'),
  master_nonrecord_rows_sha256 text not null check (master_nonrecord_rows_sha256 ~ '^[a-f0-9]{64}$'),
  monthly_rows_sha256 text not null check (monthly_rows_sha256 ~ '^[a-f0-9]{64}$'),
  parser_version text not null check (char_length(btrim(parser_version)) between 8 and 80),
  verified_at timestamptz not null default clock_timestamp(),
  foreign key (master_batch_id,organization_id,branch_id)
    references private.jubo_source_batches(id,organization_id,branch_id) on delete restrict,
  foreign key (monthly_batch_id,organization_id,branch_id)
    references private.jubo_source_batches(id,organization_id,branch_id) on delete restrict,
  unique (master_batch_id), unique (monthly_batch_id),
  unique (id,organization_id,branch_id)
);
create index jubo_verified_pairs_scope_idx on private.jubo_verified_source_pairs
  (organization_id,branch_id,verified_at desc);
-- The preceding preflight migration creates this reviewer FK. Keep the
-- candidate chain independently verifiable even before its release patch is
-- cherry-picked into another checkout.
create index if not exists jubo_nonrecord_reviewer_idx on private.jubo_source_nonrecord_rows(reviewed_by);

create table private.jubo_master_row_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  source_row_id uuid not null,
  review_version integer not null check (review_version > 0),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approved','held','rejected')),
  review_reason text not null check (char_length(btrim(review_reason)) between 10 and 1000),
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  unique (pair_id,source_row_id,review_version),
  unique (reviewer_user_id,idempotency_key)
);
create index jubo_master_reviews_latest_idx on private.jubo_master_row_reviews
  (pair_id,source_row_id,review_version desc);
create index jubo_master_reviews_scope_idx on private.jubo_master_row_reviews
  (organization_id,branch_id,reviewed_at desc);
create index jubo_master_reviews_reauth_idx on private.jubo_master_row_reviews
  (reauth_challenge_id);

create table private.jubo_pending_master_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  committed_at timestamptz not null default clock_timestamp(),
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  unique (pair_id), unique (actor_user_id,idempotency_key),
  unique (id,organization_id,branch_id)
);
create index jubo_pending_operations_scope_idx on private.jubo_pending_master_operations
  (organization_id,branch_id,committed_at desc);
create index jubo_pending_operations_reauth_idx on private.jubo_pending_master_operations
  (reauth_challenge_id);

create table private.jubo_pending_master_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  operation_id uuid not null,
  source_row_id uuid not null,
  monthly_source_row_id uuid,
  identity_sha256 text not null check (identity_sha256 ~ '^[a-f0-9]{64}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  date_of_birth date not null,
  sex text not null check (sex in ('male','female','other','unknown')),
  phone text,
  source_status text not null check (source_status in ('服務中','暫停服務','結案')),
  source_opened_on date,
  source_first_service_on date,
  source_closed_on date,
  admitted_on date check (admitted_on is null),
  care_eligible boolean not null default false check (care_eligible = false),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (operation_id,organization_id,branch_id)
    references private.jubo_pending_master_operations(id,organization_id,branch_id) on delete restrict,
  foreign key (source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (monthly_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  unique (operation_id,source_row_id), unique (source_row_id),
  unique (organization_id,identity_sha256),
  unique (id,organization_id,branch_id)
);
create index jubo_pending_rows_scope_idx on private.jubo_pending_master_rows
  (organization_id,branch_id,source_status);
create index jubo_pending_rows_monthly_source_idx on private.jubo_pending_master_rows
  (monthly_source_row_id) where monthly_source_row_id is not null;

-- Batch row locks serialize staging inserts with source-pair attestation.
-- Once verified, no extra source row or footer can be appended.
create function private.guard_jubo_staging_after_attestation() returns trigger
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform 1 from private.jubo_source_batches
    where id=new.batch_id and organization_id=new.organization_id
      and branch_id=new.branch_id for update;
  if not found then
    raise exception using errcode='42501',message='JUBO_SOURCE_SCOPE_MISMATCH';
  end if;
  if exists(select 1 from private.jubo_verified_source_pairs pair
    where pair.master_batch_id=new.batch_id or pair.monthly_batch_id=new.batch_id) then
    raise exception using errcode='55000',message='JUBO_SOURCE_ALREADY_ATTESTED';
  end if;
  return new;
end;
$$;
create trigger aa_jubo_source_rows_attestation_guard
  before insert on private.jubo_source_rows for each row
  execute function private.guard_jubo_staging_after_attestation();
create trigger aa_jubo_nonrecord_attestation_guard
  before insert on private.jubo_source_nonrecord_rows for each row
  execute function private.guard_jubo_staging_after_attestation();

do $tables$ declare t text; begin
  foreach t in array array[
    'jubo_verified_source_pairs','jubo_master_row_reviews',
    'jubo_pending_master_operations','jubo_pending_master_rows'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

-- Fixed production allowlist. Tests may temporarily replace this function in
-- a rollback-only synthetic database, never in a deployed migration.
create function private.jubo_expected_source_sha256(p_kind text) returns text
language sql immutable security invoker set search_path = '' as $$
  select case p_kind
    when 'client_master' then '7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7'
    when 'daycare_monthly_summary' then 'aa1e02c2bc1029bc78d8f7e46c68f979fbdfa1d7010a5ec8e29818bc54854ff4'
    else null end;
$$;

create function private.jubo_staged_rows_sha256(p_batch uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(string_agg(
    source_row_number::text || ':' || row_sha256, ',' order by source_row_number),''), 'UTF8')), 'hex')
  from private.jubo_source_rows where batch_id = p_batch;
$$;

create function private.jubo_nonrecord_rows_sha256(p_batch uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(string_agg(
    source_row_number::text || ':' || row_sha256, ',' order by source_row_number),''), 'UTF8')), 'hex')
  from private.jubo_source_nonrecord_rows where batch_id = p_batch;
$$;

-- Only a trusted database worker can call this. It checks the actual bytea,
-- not a caller-supplied hash; the worker must parse those same bytes using the
-- bounded server-only XLSX reader before inserting immutable staged rows.
create function private.register_verified_jubo_pair(
  p_org uuid,p_branch uuid,p_master uuid,p_monthly uuid,
  p_master_bytes bytea,p_monthly_bytes bytea,
  p_master_headers jsonb,p_monthly_headers jsonb,p_parser_version text
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare v_master private.jubo_source_batches%rowtype;
  v_monthly private.jubo_source_batches%rowtype;
  v_master_sha text; v_monthly_sha text; v_result uuid;
  v_master_count integer; v_monthly_count integer; v_footer_count integer;
begin
  if p_org is null or p_branch is null or p_master is null or p_monthly is null
    or p_master_bytes is null or p_monthly_bytes is null
    or octet_length(p_master_bytes) not between 22 and 10485760
    or octet_length(p_monthly_bytes) not between 22 and 10485760
    or p_parser_version is distinct from 'jubo-xlsx-reader-202610-v1' then
    raise exception using errcode='22023',message='JUBO_ATTESTATION_INVALID';
  end if;
  perform 1 from private.jubo_source_batches
    where id in (p_master,p_monthly) order by id for update;
  select * into v_master from private.jubo_source_batches
    where id=p_master and organization_id=p_org and branch_id=p_branch;
  select * into v_monthly from private.jubo_source_batches
    where id=p_monthly and organization_id=p_org and branch_id=p_branch;
  if v_master.id is null or v_monthly.id is null
    or v_master.source_kind <> 'client_master'
    or v_monthly.source_kind <> 'daycare_monthly_summary'
    or v_master.mapping_version <> 'jubo-master-monthly-202610-v1'
    or v_monthly.mapping_version <> 'jubo-master-monthly-202610-v1'
    or v_master.column_labels is distinct from p_master_headers
    or v_monthly.column_labels is distinct from p_monthly_headers
    or jsonb_array_length(v_master.column_labels) <> 95
    or jsonb_array_length(v_monthly.column_labels) <> 191 then
    raise exception using errcode='22023',message='JUBO_ATTESTATION_SOURCE_MISMATCH';
  end if;
  v_master_sha:=encode(sha256(p_master_bytes),'hex');
  v_monthly_sha:=encode(sha256(p_monthly_bytes),'hex');
  if v_master_sha is distinct from v_master.source_sha256
    or v_monthly_sha is distinct from v_monthly.source_sha256
    or v_master_sha is distinct from private.jubo_expected_source_sha256('client_master')
    or v_monthly_sha is distinct from private.jubo_expected_source_sha256('daycare_monthly_summary') then
    raise exception using errcode='22023',message='JUBO_ATTESTATION_HASH_MISMATCH';
  end if;
  select count(*) into v_master_count from private.jubo_source_rows where batch_id=p_master;
  select count(*) into v_monthly_count from private.jubo_source_rows where batch_id=p_monthly;
  select count(*) into v_footer_count from private.jubo_source_nonrecord_rows footer
    where footer.batch_id=p_master and footer.source_row_number >
      (select max(source_row_number) from private.jubo_source_rows where batch_id=p_master);
  if v_master.declared_row_count <> 23 or v_monthly.declared_row_count <> 17
    or v_master_count <> 23 or v_monthly_count <> 17 or v_footer_count <> 1
    or (select count(*) from private.jubo_source_nonrecord_rows where batch_id=p_master) <> 1 then
    raise exception using errcode='22023',message='JUBO_ATTESTATION_ROW_COUNT_MISMATCH';
  end if;
  insert into private.jubo_verified_source_pairs(organization_id,branch_id,
    master_batch_id,monthly_batch_id,master_byte_sha256,monthly_byte_sha256,
    master_byte_length,monthly_byte_length,master_rows_sha256,
    master_nonrecord_rows_sha256,monthly_rows_sha256,parser_version)
  values(p_org,p_branch,p_master,p_monthly,v_master_sha,v_monthly_sha,
    octet_length(p_master_bytes),octet_length(p_monthly_bytes),
    private.jubo_staged_rows_sha256(p_master),
    private.jubo_nonrecord_rows_sha256(p_master),
    private.jubo_staged_rows_sha256(p_monthly),p_parser_version)
  returning id into v_result;
  return v_result;
end;
$$;

revoke all on function private.jubo_expected_source_sha256(text) from public,anon,authenticated,service_role;
revoke all on function private.jubo_staged_rows_sha256(uuid) from public,anon,authenticated,service_role;
revoke all on function private.jubo_nonrecord_rows_sha256(uuid) from public,anon,authenticated,service_role;
revoke all on function private.guard_jubo_staging_after_attestation() from public,anon,authenticated,service_role;
revoke all on function private.register_verified_jubo_pair(uuid,uuid,uuid,uuid,bytea,bytea,jsonb,jsonb,text)
  from public,anon,authenticated,service_role;

create function private.review_jubo_master_row(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,
  p_expected_row_sha256 text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pair private.jubo_verified_source_pairs%rowtype;
  v_row private.jubo_source_rows%rowtype;
  v_previous private.jubo_master_row_reviews%rowtype;
  v_challenge uuid; v_reason text := btrim(p_reason);
  v_request_sha text; v_review_version integer; v_result private.jubo_master_row_reviews%rowtype;
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve') then
    raise exception using errcode='42501',message='JUBO_REVIEW_DENIED';
  end if;
  v_challenge:=private.current_client_master_reauth_challenge();
  if p_pair is null or p_source_row is null or p_idempotency_key is null
    or p_expected_row_sha256 !~ '^[a-f0-9]{64}$'
    or p_decision not in ('approved','held','rejected')
    or char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode='22023',message='JUBO_REVIEW_INVALID';
  end if;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  select * into v_row from private.jubo_source_rows
    where id=p_source_row and batch_id=v_pair.master_batch_id
      and organization_id=p_org and branch_id=p_branch;
  if v_pair.id is null or v_row.id is null
    or v_row.row_sha256 is distinct from p_expected_row_sha256 then
    raise exception using errcode='42501',message='JUBO_REVIEW_SOURCE_MISMATCH';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair,'row',p_source_row,
    'rowSha',p_expected_row_sha256,'decision',p_decision,'reason',v_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-review:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_master_row_reviews
    where reviewer_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v_previous.id is not null then
    if v_previous.request_sha256 <> v_request_sha then
      raise exception using errcode='23505',message='JUBO_REVIEW_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('reviewId',v_previous.id,'reviewVersion',v_previous.review_version,
      'decision',v_previous.decision,'replayed',true);
  end if;
  if exists(select 1 from private.jubo_pending_master_operations where pair_id=p_pair) then
    raise exception using errcode='42501',message='JUBO_PAIR_ALREADY_COMMITTED';
  end if;
  perform 1 from private.jubo_source_rows where id=v_row.id for update;
  select coalesce(max(review_version),0)+1 into v_review_version
    from private.jubo_master_row_reviews where pair_id=p_pair and source_row_id=p_source_row;
  insert into private.jubo_master_row_reviews(organization_id,branch_id,pair_id,source_row_id,
    review_version,source_row_sha256,decision,review_reason,reviewer_user_id,
    reauth_challenge_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_pair,p_source_row,v_review_version,p_expected_row_sha256,
    p_decision,v_reason,auth.uid(),v_challenge,p_idempotency_key,v_request_sha)
  returning * into v_result;
  return jsonb_build_object('reviewId',v_result.id,'reviewVersion',v_result.review_version,
    'decision',v_result.decision,'replayed',false);
end;
$$;

create function public.review_jubo_master_row(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,
  p_expected_row_sha256 text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select private.review_jubo_master_row(p_org,p_branch,p_pair,p_source_row,
    p_expected_row_sha256,p_decision,p_reason,p_idempotency_key);
$$;

create function private.commit_jubo_pending_registry(
  p_org uuid,p_branch uuid,p_pair uuid,p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pair private.jubo_verified_source_pairs%rowtype;
  v_previous private.jubo_pending_master_operations%rowtype;
  v_operation uuid; v_challenge uuid; v_request_sha text; v_receipt jsonb;
  v_master_count integer; v_monthly_count integer; v_active integer;
  v_suspended integer; v_closed integer; v_match_count integer;
  v_approved_count integer; v_existing_count integer;
  v_record private.jubo_source_rows%rowtype;
  v_monthly_row uuid; v_opened date; v_first date; v_closed_on date;
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve')
    or not private.has_permission(p_org,p_branch,'imports.manage') then
    raise exception using errcode='42501',message='JUBO_PENDING_DENIED';
  end if;
  v_challenge:=private.current_client_master_reauth_challenge();
  if p_pair is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='JUBO_PENDING_INVALID';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-pending:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_master_operations
    where actor_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v_previous.id is not null then
    if v_previous.request_sha256 <> v_request_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_IDEMPOTENCY_CONFLICT';
    end if;
    return v_previous.receipt||jsonb_build_object('replayed',true);
  end if;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  if v_pair.id is null then
    raise exception using errcode='42501',message='JUBO_PENDING_SCOPE_MISMATCH';
  end if;
  if exists(select 1 from private.jubo_pending_master_operations where pair_id=p_pair) then
    raise exception using errcode='23505',message='JUBO_PAIR_ALREADY_COMMITTED';
  end if;
  if v_pair.master_rows_sha256 <> private.jubo_staged_rows_sha256(v_pair.master_batch_id)
    or v_pair.master_nonrecord_rows_sha256 <>
      private.jubo_nonrecord_rows_sha256(v_pair.master_batch_id)
    or v_pair.monthly_rows_sha256 <> private.jubo_staged_rows_sha256(v_pair.monthly_batch_id) then
    raise exception using errcode='22023',message='JUBO_SOURCE_CHANGED_AFTER_ATTESTATION';
  end if;
  select count(*),count(*) filter (where raw_values->>15='服務中'),
    count(*) filter (where raw_values->>15='暫停服務'),
    count(*) filter (where raw_values->>15='結案')
    into v_master_count,v_active,v_suspended,v_closed
    from private.jubo_source_rows where batch_id=v_pair.master_batch_id;
  select count(*) into v_monthly_count from private.jubo_source_rows
    where batch_id=v_pair.monthly_batch_id;
  select count(*) into v_match_count from private.jubo_source_rows master
    join private.jubo_source_rows monthly on monthly.batch_id=v_pair.monthly_batch_id
      and monthly.identity_sha256=master.identity_sha256
    where master.batch_id=v_pair.master_batch_id
      and master.raw_values->>15='服務中'
      and monthly.raw_values->>3='服務中'
      and btrim(master.raw_values->>2)=btrim(monthly.raw_values->>7)
      and private.jubo_source_date_iso(master.raw_values->>23)
        is not distinct from private.jubo_source_date_iso(monthly.raw_values->>9)
      and private.jubo_source_date_iso(monthly.raw_values->>9) is not null
      and private.jubo_source_sex(master.raw_values->>3)
        is not distinct from private.jubo_source_sex(monthly.raw_values->>8)
      and private.jubo_source_sex(monthly.raw_values->>8) is not null
      and btrim(master.raw_values->>29) is not distinct from btrim(monthly.raw_values->>22);
  if v_master_count <> 23 or v_monthly_count <> 17 or v_active <> 17
    or v_suspended <> 1 or v_closed <> 5 or v_match_count <> 17 then
    raise exception using errcode='22023',message='JUBO_PENDING_SOURCE_CONFLICT';
  end if;
  select count(*) into v_approved_count from private.jubo_source_rows source_row
    join lateral (select decision,source_row_sha256 from private.jubo_master_row_reviews review
      where review.pair_id=p_pair and review.source_row_id=source_row.id
      order by review_version desc limit 1) review on true
    where source_row.batch_id=v_pair.master_batch_id
      and review.decision='approved'
      and review.source_row_sha256=source_row.row_sha256;
  if v_approved_count <> 23 then
    raise exception using errcode='42501',message='JUBO_PENDING_REVIEWS_INCOMPLETE';
  end if;
  -- A legacy public client without a bound identity cannot be compared by
  -- exact identifier. Never silently create a second person while that gap
  -- exists; the owner must reconcile those cases first.
  if exists(select 1 from public.clients existing
    where existing.organization_id=p_org
      and not exists(select 1 from private.client_intake_identities bound
        where bound.client_id=existing.id and bound.organization_id=p_org)) then
    raise exception using errcode='23505',message='JUBO_EXISTING_CLIENT_IDENTITY_UNBOUND';
  end if;
  select count(*) into v_existing_count from private.jubo_source_rows source_row
    where source_row.batch_id=v_pair.master_batch_id
      and (exists(select 1 from private.client_intake_identities identity_record
        where identity_record.organization_id=p_org
          and identity_record.identity_sha256=source_row.identity_sha256)
      or exists(select 1 from private.jubo_pending_master_rows pending
        where pending.organization_id=p_org
          and pending.identity_sha256=source_row.identity_sha256));
  if v_existing_count <> 0 then
    raise exception using errcode='23505',message='JUBO_PENDING_IDENTITY_COLLISION';
  end if;
  v_operation:=gen_random_uuid();
  v_receipt:=jsonb_build_object('operationId',v_operation,'pendingMasterRows',23,
    'monthlyReferences',17,'publicClientsCreated',0,'careEligible',0,
    'formallyPromoted',false,'replayed',false);
  insert into private.jubo_pending_master_operations(id,organization_id,branch_id,
    pair_id,actor_user_id,reauth_challenge_id,idempotency_key,request_sha256,receipt)
    values(v_operation,p_org,p_branch,p_pair,auth.uid(),v_challenge,
      p_idempotency_key,v_request_sha,v_receipt);
  for v_record in select * from private.jubo_source_rows
    where batch_id=v_pair.master_batch_id order by source_row_number loop
    select id into v_monthly_row from private.jubo_source_rows
      where batch_id=v_pair.monthly_batch_id
        and identity_sha256=v_record.identity_sha256;
    v_opened:=private.jubo_source_date_iso(v_record.raw_values->>8);
    v_first:=private.jubo_source_date_iso(v_record.raw_values->>9);
    v_closed_on:=private.jubo_source_date_iso(v_record.raw_values->>11);
    if private.jubo_source_date_iso(v_record.raw_values->>23) is null
      or private.jubo_source_sex(v_record.raw_values->>3) is null
      or nullif(btrim(v_record.raw_values->>2),'') is null
      or (nullif(btrim(v_record.raw_values->>8),'') is not null and v_opened is null)
      or (nullif(btrim(v_record.raw_values->>9),'') is not null and v_first is null)
      or (nullif(btrim(v_record.raw_values->>11),'') is not null and v_closed_on is null) then
      raise exception using errcode='22023',message='JUBO_PENDING_REQUIRED_FIELD_INVALID';
    end if;
    insert into private.jubo_pending_master_rows(organization_id,branch_id,operation_id,
      source_row_id,monthly_source_row_id,identity_sha256,display_name,date_of_birth,
      sex,phone,source_status,source_opened_on,source_first_service_on,source_closed_on)
    values(p_org,p_branch,v_operation,v_record.id,v_monthly_row,v_record.identity_sha256,
      btrim(v_record.raw_values->>2),private.jubo_source_date_iso(v_record.raw_values->>23),
      private.jubo_source_sex(v_record.raw_values->>3),nullif(btrim(v_record.raw_values->>29),''),
      v_record.raw_values->>15,v_opened,v_first,v_closed_on);
  end loop;
  if (select count(*) from private.jubo_pending_master_rows where operation_id=v_operation) <> 23
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_operation and monthly_source_row_id is not null) <> 17 then
    raise exception using errcode='40001',message='JUBO_PENDING_READBACK_MISMATCH';
  end if;
  return v_receipt;
end;
$$;

create function public.commit_jubo_pending_registry(
  p_org uuid,p_branch uuid,p_pair uuid,p_idempotency_key uuid
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select private.commit_jubo_pending_registry(p_org,p_branch,p_pair,p_idempotency_key);
$$;

alter function private.review_jubo_master_row(uuid,uuid,uuid,uuid,text,text,text,uuid) owner to postgres;
alter function private.commit_jubo_pending_registry(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function private.review_jubo_master_row(uuid,uuid,uuid,uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.commit_jubo_pending_registry(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.review_jubo_master_row(uuid,uuid,uuid,uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.commit_jubo_pending_registry(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.review_jubo_master_row(uuid,uuid,uuid,uuid,text,text,text,uuid)
  to authenticated;
grant execute on function private.commit_jubo_pending_registry(uuid,uuid,uuid,uuid)
  to authenticated;
grant execute on function public.review_jubo_master_row(uuid,uuid,uuid,uuid,text,text,text,uuid)
  to authenticated;
grant execute on function public.commit_jubo_pending_registry(uuid,uuid,uuid,uuid)
  to authenticated;

comment on function public.commit_jubo_pending_registry(uuid,uuid,uuid,uuid) is
  'Creates private, non-operational pending source registry only. Does not create public.clients or authorize care.';

commit;


-- Imported reviewed candidate: 20261009102100_jubo_pending_client_status_candidate.sql
-- Candidate-only lifecycle value. It is distinct from active+NULL so existing
-- operational queries using status='active' cannot mistake it for attendance.
-- A later migration must separately review every operational read/write path
-- and the pending->admitted transition before exposing public promotion.
begin;
set local lock_timeout = '5s';
alter type public.client_status add value if not exists 'pending';
commit;


-- Imported reviewed candidate: 20261009102101_jubo_public_pending_promotion_candidate.sql
-- Candidate only: an owner-only, ungranted path for 23 formally visible
-- client master shells. All rows remain pending and non-operational. This
-- must not be exposed until the entire operational gate matrix and the
-- trusted same-bytes XLSX staging worker pass formal PostgreSQL tests.
begin;
set local lock_timeout = '5s';

alter table public.clients add constraint clients_pending_has_no_service_period
  check (status <> 'pending' or (admitted_on is null and ended_on is null));

create table private.jubo_public_pending_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  pending_operation_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt)='object'),
  committed_at timestamptz not null default clock_timestamp(),
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (pending_operation_id,organization_id,branch_id)
    references private.jubo_pending_master_operations(id,organization_id,branch_id) on delete restrict,
  unique(pair_id),unique(pending_operation_id),unique(actor_user_id,idempotency_key),
  unique(id,organization_id,branch_id)
);
create index jubo_public_pending_promotions_scope_idx on private.jubo_public_pending_promotions
  (organization_id,branch_id,committed_at desc);
create index jubo_public_pending_promotions_reauth_idx on private.jubo_public_pending_promotions
  (reauth_challenge_id);

create table private.jubo_public_pending_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  promotion_id uuid not null,
  pending_row_id uuid not null,
  client_id uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  foreign key (promotion_id,organization_id,branch_id)
    references private.jubo_public_pending_promotions(id,organization_id,branch_id) on delete restrict,
  foreign key (pending_row_id,organization_id,branch_id)
    references private.jubo_pending_master_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  unique(pending_row_id),unique(client_id)
);
create index jubo_public_pending_links_scope_idx on private.jubo_public_pending_links
  (organization_id,branch_id,promotion_id);

do $tables$ declare t text; begin
  foreach t in array array['jubo_public_pending_promotions','jubo_public_pending_links'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

-- Existing clients_insert RLS is broader than this one reviewed source path.
-- Even an authorized manager cannot directly create a pending case without
-- the owner-only transaction and its immutable operation evidence.
create function private.guard_jubo_pending_client_insert() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare v_operation uuid;
begin
  -- Test OLD first. Otherwise pending -> active could escape through the
  -- new-status early return before a reviewed admission transition exists.
  if tg_op='UPDATE' and old.status='pending' then
    raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_TRANSITION_DISABLED';
  end if;
  if new.status <> 'pending' then return new; end if;
  if tg_op <> 'INSERT' or current_user <> 'postgres' then
    raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION';
  end if;
  begin
    v_operation:=nullif(current_setting('app.jubo_pending_promotion_id',true),'')::uuid;
  exception when invalid_text_representation then
    v_operation:=null;
  end;
  if v_operation is null or new.source_system <> 'jubo'
    or not exists(select 1 from private.jubo_public_pending_promotions op
      where op.id=v_operation and op.organization_id=new.organization_id
        and op.branch_id=new.branch_id) then
    raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION';
  end if;
  return new;
end;
$$;
create trigger aa_jubo_pending_client_insert_guard before insert or update on public.clients
  for each row execute function private.guard_jubo_pending_client_insert();

-- Defence in depth: no public client-linked table may write a record for a
-- pending person. Assessment drafts need a separate, explicitly reviewed
-- allowlist later; signed assessments, transport, medication, attendance,
-- service and claims are all denied by default now.
create function private.reject_pending_client_activity() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_client uuid;
begin
  if tg_op='DELETE' then v_client:=old.client_id;
  else v_client:=new.client_id; end if;
  if v_client is not null and exists(select 1 from public.clients client
    where client.id=v_client and client.status='pending') then
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='UPDATE' and old.client_id is distinct from new.client_id
    and exists(select 1 from public.clients client
      where client.id=old.client_id and client.status='pending') then
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
do $triggers$ declare t record; begin
  for t in select distinct table_name from information_schema.columns
    where table_schema='public' and column_name='client_id' and data_type='uuid'
      and table_name in (select table_name from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE')
    order by table_name loop
    execute format('create trigger jubo_pending_client_no_activity before insert or update or delete on public.%I for each row execute function private.reject_pending_client_activity()',t.table_name);
  end loop;
end $triggers$;

create function private.promote_jubo_public_pending_candidate(
  p_org uuid,p_branch uuid,p_pair uuid,p_idempotency_key uuid
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_pair private.jubo_verified_source_pairs%rowtype;
  v_pending_operation private.jubo_pending_master_operations%rowtype;
  v_previous private.jubo_public_pending_promotions%rowtype;
  v_row private.jubo_pending_master_rows%rowtype;
  v_challenge uuid; v_request_sha text; v_promotion uuid; v_client uuid;
  v_receipt jsonb; v_linked integer; v_monthly integer;
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve')
    or not private.has_permission(p_org,p_branch,'imports.manage') then
    raise exception using errcode='42501',message='JUBO_PUBLIC_PENDING_DENIED';
  end if;
  v_challenge:=private.current_client_master_reauth_challenge();
  if p_org is null or p_branch is null or p_pair is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='JUBO_PUBLIC_PENDING_INVALID';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-public-pending:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_public_pending_promotions
    where actor_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v_previous.id is not null then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PUBLIC_PENDING_IDEMPOTENCY_CONFLICT';
    end if;
    return v_previous.receipt||jsonb_build_object('replayed',true);
  end if;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  select * into v_pending_operation from private.jubo_pending_master_operations
    where pair_id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  if v_pair.id is null or v_pending_operation.id is null then
    raise exception using errcode='42501',message='JUBO_PUBLIC_PENDING_SCOPE_MISMATCH';
  end if;
  if exists(select 1 from private.jubo_public_pending_promotions where pair_id=p_pair) then
    raise exception using errcode='23505',message='JUBO_PUBLIC_PENDING_ALREADY_COMMITTED';
  end if;
  if v_pair.master_byte_sha256<>private.jubo_expected_source_sha256('client_master')
    or v_pair.monthly_byte_sha256<>private.jubo_expected_source_sha256('daycare_monthly_summary')
    or v_pair.master_rows_sha256<>private.jubo_staged_rows_sha256(v_pair.master_batch_id)
    or v_pair.master_nonrecord_rows_sha256<>private.jubo_nonrecord_rows_sha256(v_pair.master_batch_id)
    or v_pair.monthly_rows_sha256<>private.jubo_staged_rows_sha256(v_pair.monthly_batch_id) then
    raise exception using errcode='22023',message='JUBO_PUBLIC_PENDING_SOURCE_MISMATCH';
  end if;
  if (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id)<>23
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and monthly_source_row_id is not null)<>17
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and source_status='服務中')<>17
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and source_status='暫停服務')<>1
    or (select count(*) from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and source_status='結案')<>5
    or exists(select 1 from private.jubo_pending_master_rows
      where operation_id=v_pending_operation.id and (admitted_on is not null or care_eligible)) then
    raise exception using errcode='22023',message='JUBO_PUBLIC_PENDING_COUNT_MISMATCH';
  end if;
  -- A lock prevents a concurrent legacy client insert from escaping the
  -- unbound-identity scan. The exact identity index still handles races with
  -- existing bound clients. This is intentionally a rare one-time operation.
  perform set_config('lock_timeout','5s',true);
  lock table public.clients in share row exclusive mode;
  if exists(select 1 from public.clients existing where existing.organization_id=p_org
    and not exists(select 1 from private.client_intake_identities bound
      where bound.client_id=existing.id and bound.organization_id=p_org))
    or exists(select 1 from private.jubo_pending_master_rows pending
      join private.client_intake_identities bound
        on bound.organization_id=p_org and bound.identity_sha256=pending.identity_sha256
      where pending.operation_id=v_pending_operation.id) then
    raise exception using errcode='23505',message='JUBO_PUBLIC_PENDING_IDENTITY_COLLISION';
  end if;
  v_promotion:=gen_random_uuid();
  v_receipt:=jsonb_build_object('promotionId',v_promotion,'publicPendingClients',23,
    'monthlyMatches',17,'sourceActive',17,'sourceSuspended',1,'sourceClosed',5,
    'careEligible',0,'admitted',0,'replayed',false);
  insert into private.jubo_public_pending_promotions(id,organization_id,branch_id,pair_id,
    pending_operation_id,actor_user_id,reauth_challenge_id,idempotency_key,
    request_sha256,receipt) values(v_promotion,p_org,p_branch,p_pair,
    v_pending_operation.id,auth.uid(),v_challenge,p_idempotency_key,v_request_sha,v_receipt);
  perform set_config('app.jubo_pending_promotion_id',v_promotion::text,true);
  for v_row in select * from private.jubo_pending_master_rows
    where operation_id=v_pending_operation.id order by id loop
    v_client:=gen_random_uuid();
    insert into public.clients(id,organization_id,branch_id,client_code,display_name,
      date_of_birth,status,admitted_on,ended_on,source_system)
      values(v_client,p_org,p_branch,'JUBO-'||replace(v_client::text,'-',''),
        v_row.display_name,v_row.date_of_birth,'pending',null,null,'jubo');
    insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256)
      values(p_org,p_branch,v_client,v_row.identity_sha256);
    insert into private.jubo_public_pending_links(organization_id,branch_id,promotion_id,
      pending_row_id,client_id) values(p_org,p_branch,v_promotion,v_row.id,v_client);
    insert into private.jubo_client_source_links(source_row_id,organization_id,branch_id,
      client_id,import_operation_id) values(v_row.source_row_id,p_org,p_branch,v_client,v_promotion);
  end loop;
  select count(*),count(*) filter (where pending.monthly_source_row_id is not null)
    into v_linked,v_monthly
    from private.jubo_public_pending_links link
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
    join public.clients client on client.id=link.client_id
    where link.promotion_id=v_promotion and client.status='pending'
      and client.admitted_on is null and client.ended_on is null;
  if v_linked<>23 or v_monthly<>17 then
    raise exception using errcode='40001',message='JUBO_PUBLIC_PENDING_READBACK_MISMATCH';
  end if;
  return v_receipt;
end;
$$;
alter function private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function private.guard_jubo_pending_client_insert() from public,anon,authenticated,service_role;
revoke all on function private.reject_pending_client_activity() from public,anon,authenticated,service_role;
revoke all on function private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
comment on function private.promote_jubo_public_pending_candidate(uuid,uuid,uuid,uuid) is
  'Candidate only: NO Data API grant; cannot run until same-bytes parser worker, full operational gate and formal PostgreSQL concurrency checks pass.';
commit;


-- Imported reviewed candidate: 20261009110651_jubo_pending_private_assessment_draft_gate.sql
-- Candidate only. This depends on 20261009102101 and must not ship until
-- the public pending-client status/parsers and all operational paths pass QA.
-- A pending person can accumulate assessment DRAFTS, not a signed, submitted,
-- approved, printed, or exported formal record.
begin;
set local lock_timeout = '5s';

create function private.assert_jubo_pending_private_client_boundary(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_id uuid,
  p_is_assessment_draft boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_status public.client_status;
begin
  if p_organization_id is null or p_branch_id is null or p_client_id is null
    or p_is_assessment_draft is null then
    raise exception using errcode = '42501',
      message = 'JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH';
  end if;

  select client.status into v_status
    from public.clients client
   where client.id = p_client_id
     and client.organization_id = p_organization_id
     and client.branch_id = p_branch_id;
  if not found then
    raise exception using errcode = '42501',
      message = 'JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH';
  end if;

  if v_status = 'pending' and not p_is_assessment_draft then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED';
  end if;
end;
$$;

create function private.guard_jubo_pending_private_client_write() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_is_assessment_draft boolean;
begin
  if tg_op <> 'INSERT' or tg_nargs <> 1
    or tg_argv[0] not in ('draft', 'custom_response', 'formal') then
    raise exception using errcode = '42501',
      message = 'JUBO_PRIVATE_GATE_CONFIGURATION_INVALID';
  end if;

  v_is_assessment_draft := case tg_argv[0]
    when 'draft' then true
    when 'custom_response' then to_jsonb(new)->>'status' = 'draft'
    else false
  end;
  perform private.assert_jubo_pending_private_client_boundary(
    new.organization_id, new.branch_id, new.client_id, v_is_assessment_draft
  );
  return new;
end;
$$;

-- Before-insert triggers protect privileged writer functions and owner/direct
-- writes alike. The target tables are not exposed to anon/authenticated or
-- service_role; no new Data API grants are introduced.
create trigger jubo_pending_private_draft_gate
  before insert on private.custom_form_responses
  for each row execute function private.guard_jubo_pending_private_client_write('custom_response');
create trigger jubo_pending_private_draft_gate
  before insert on private.taipei_abcd_draft_versions
  for each row execute function private.guard_jubo_pending_private_client_write('draft');
create trigger jubo_pending_private_draft_gate
  before insert on private.taipei_abcd_draft_operations
  for each row execute function private.guard_jubo_pending_private_client_write('draft');

create trigger jubo_pending_private_formal_gate
  before insert on private.taipei_abcd_review_events
  for each row execute function private.guard_jubo_pending_private_client_write('formal');
create trigger jubo_pending_private_formal_gate
  before insert on private.taipei_abcd_export_snapshots
  for each row execute function private.guard_jubo_pending_private_client_write('formal');
create trigger jubo_pending_private_formal_gate
  before insert on private.custom_response_print_jobs
  for each row execute function private.guard_jubo_pending_private_client_write('formal');

revoke all on function private.assert_jubo_pending_private_client_boundary(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_jubo_pending_private_client_write()
  from public, anon, authenticated, service_role;
comment on function private.assert_jubo_pending_private_client_boundary(uuid, uuid, uuid, boolean) is
  'Candidate-only private form boundary: pending permits draft storage, rejects formal output; exact org/branch/client scope required.';
commit;


-- Imported reviewed candidate: 20261009112158_jubo_pending_intake_profiles_candidate.sql
-- Candidate only. Attach a complete intake-profile v1 to each reviewed JUBO
-- public pending client in the *same transaction* as its source link. This
-- augments, but does not enable, the owner-only promotion candidate. No
-- admission date, attendance, clinical act or signed assessment is inferred.
begin;
set local lock_timeout = '5s';

create table private.jubo_intake_profile_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  promotion_id uuid not null,
  promotion_link_id uuid not null unique,
  client_id uuid not null unique,
  intake_version_id uuid not null unique references private.client_intake_versions(id) on delete restrict,
  pair_id uuid not null,
  master_source_row_id uuid not null unique,
  monthly_source_row_id uuid,
  master_source_row_sha256 text not null check (master_source_row_sha256 ~ '^[a-f0-9]{64}$'),
  profile_sha256 text not null check (profile_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_review_sha256 text not null check (mapping_review_sha256 ~ '^[a-f0-9]{64}$'),
  source_sheet_row integer not null check (source_sheet_row > 0),
  source_field_indices jsonb not null check (jsonb_typeof(source_field_indices)='object'),
  warning_codes text[] not null check (warning_codes <@ array[
    'MISSING_MONTHLY_SUMMARY','MISSING_DATE_OF_BIRTH','MISSING_CONTACT_PHONE','REVIEW_SOURCE_NORMALIZATION',
    'REVIEW_WEEKLY_SCHEDULE','REVIEW_TRANSPORT','REVIEW_ABCD_ASSESSMENTS',
    'REVIEW_IDENTITY_DOCUMENT','REVIEW_MEDICATION_EVIDENCE',
    'REVIEW_HEALTH_EXAM','REVIEW_CONSENT']::text[]),
  normalization_field_indices jsonb not null check (jsonb_typeof(normalization_field_indices)='object'),
  mapping_version text not null check (mapping_version = 'jubo-master-monthly-202610-v2'),
  parser_version text not null check (char_length(btrim(parser_version)) between 8 and 80),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (promotion_id,organization_id,branch_id)
    references private.jubo_public_pending_promotions(id,organization_id,branch_id) on delete restrict,
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (master_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (monthly_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict
);
create index jubo_intake_profile_sources_scope_idx on private.jubo_intake_profile_sources
  (organization_id,branch_id,promotion_id);
create index jubo_intake_profile_sources_pair_idx on private.jubo_intake_profile_sources(pair_id);
create index jubo_intake_profile_sources_monthly_idx on private.jubo_intake_profile_sources(monthly_source_row_id)
  where monthly_source_row_id is not null;
alter table private.jubo_intake_profile_sources enable row level security;
alter table private.jubo_intake_profile_sources force row level security;
revoke all on private.jubo_intake_profile_sources from public,anon,authenticated,service_role;
create trigger jubo_intake_profile_sources_immutable before update or delete
  on private.jubo_intake_profile_sources for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_intake_profile_sources_audit after insert
  on private.jubo_intake_profile_sources for each row execute function private.audit_row_change();

-- V1 approvals bind only original source rows. They cannot authorize the V2
-- display transformation. This intentionally has no browser/service-role
-- grants or publication RPC: a separate AAL2 review workflow must be built
-- and accepted before any real pending-client promotion is possible.
create table private.jubo_profile_mapping_v2_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  master_source_row_id uuid not null,
  review_version integer not null check (review_version>0),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_review_sha256 text not null check (mapping_review_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_version text not null check (mapping_version='jubo-master-monthly-202610-v2'),
  decision text not null check (decision in ('approved','held','rejected')),
  review_reason text not null check (char_length(btrim(review_reason)) between 10 and 1000),
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (master_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  unique(pair_id,master_source_row_id,review_version)
);
create index jubo_profile_mapping_v2_reviews_latest_idx on private.jubo_profile_mapping_v2_reviews
  (pair_id,master_source_row_id,review_version desc);
create index jubo_profile_mapping_v2_reviews_reauth_idx on private.jubo_profile_mapping_v2_reviews
  (reauth_challenge_id);
alter table private.jubo_profile_mapping_v2_reviews enable row level security;
alter table private.jubo_profile_mapping_v2_reviews force row level security;
revoke all on private.jubo_profile_mapping_v2_reviews from public,anon,authenticated,service_role;
create trigger jubo_profile_mapping_v2_reviews_immutable before update or delete
  on private.jubo_profile_mapping_v2_reviews for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_profile_mapping_v2_reviews_audit after insert
  on private.jubo_profile_mapping_v2_reviews for each row execute function private.audit_row_change();

-- Source values in v1 are not automatically editable just because they are
-- tagged jubo_export rather than central. In particular, merely adding
-- 'pending' to the generic write_intake_profile status predicate must not
-- allow a manager to overwrite them. A reviewed local supplement path with a
-- narrow field allowlist is a separate release gate, not implemented here.
create function private.guard_jubo_pending_profile_version() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if new.source_batch_id is null and exists(
    select 1 from private.jubo_intake_profile_sources source_link
    where source_link.client_id=new.client_id) then
    raise exception using errcode='42501',
      message='JUBO_PENDING_PROFILE_SUPPLEMENT_NOT_PUBLISHED';
  end if;
  return new;
end;
$$;
create trigger aa_jubo_pending_profile_version_guard before insert
  on private.client_intake_versions for each row
  execute function private.guard_jubo_pending_profile_version();

-- Match the mapped text contract of the server-only JuboImportPlan. Numbers,
-- objects and arrays in text columns are not silently coerced into strings.
create function private.jubo_plan_text(p_values jsonb,p_index integer) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb;
begin
  if jsonb_typeof(p_values) <> 'array' or p_index < 0 or p_index >= jsonb_array_length(p_values) then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  v:=p_values->p_index;
  if v is null or jsonb_typeof(v)='null' then return null; end if;
  if jsonb_typeof(v)<>'string' then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  return nullif(btrim(pg_catalog.normalize(v#>>'{}','NFKC')),'');
end;
$$;

create function private.jubo_contact_display_text(p_values jsonb,p_index integer) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare v text;
begin
  v:=private.jubo_plan_text(p_values,p_index);
  -- Preserve boundaries between source lines rather than concatenating
  -- potentially distinct people or phone numbers. Original bytes stay in
  -- jubo_source_rows.raw_values for mandatory human review.
  return pg_catalog.regexp_replace(v,'[[:cntrl:]]+',' / ','g');
end;
$$;

create function private.jubo_normalization_evidence(p_values jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare v_nfkc jsonb:='[]'::jsonb; v_separator jsonb:='[]'::jsonb;
  v_index integer; v_raw text;
begin
  if jsonb_typeof(p_values)<>'array' or jsonb_array_length(p_values)<>95 then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  foreach v_index in array array[2,3,23,25,32,35,48,54,78,79,80,81] loop
    v_raw:=p_values->>v_index;
    if v_raw is not null and pg_catalog.normalize(v_raw,'NFKC') is distinct from v_raw then
      v_nfkc:=v_nfkc||to_jsonb(v_index);
    end if;
    if v_index in (78,79,80,81) and v_raw ~ '[[:cntrl:]]' then
      v_separator:=v_separator||to_jsonb(v_index);
    end if;
  end loop;
  return jsonb_build_object('nfkc',v_nfkc,'contactSeparator',v_separator);
end;
$$;

create function private.jubo_profile_from_master(
  p_values jsonb,p_pending private.jubo_pending_master_rows,p_client_code text
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v_identity text; v_cms_text text; v_cms integer;
  v_primary_name text; v_primary_phone text; v_proxy_name text; v_proxy_phone text;
  v_contacts jsonb:='[]'::jsonb; v_profile jsonb;
begin
  if jsonb_array_length(p_values)<>95 or p_pending.admitted_on is not null
    or p_pending.care_eligible or p_client_code is null then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  v_identity:=upper(regexp_replace(coalesce(private.jubo_plan_text(p_values,25),''),
    '[[:space:]-]','','g'));
  v_identity:=replace(v_identity,'－','');
  if v_identity !~ '^[A-Z][A-Z0-9]{7,19}$'
    or encode(sha256(convert_to(v_identity,'UTF8')),'hex')<>p_pending.identity_sha256
    or private.jubo_plan_text(p_values,2) is distinct from p_pending.display_name
    or private.jubo_source_date_iso(p_values->>23) is distinct from p_pending.date_of_birth
    or private.jubo_source_sex(p_values->>3) is distinct from p_pending.sex then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_MISMATCH';
  end if;
  v_cms_text:=regexp_replace(coalesce(p_values->>48,''),'[[:space:]]','','g');
  if v_cms_text<>'' then
    if v_cms_text !~ '^(第)?[1-8](級)?$' then
      raise exception using errcode='22023',message='JUBO_PROFILE_CMS_INVALID';
    end if;
    v_cms:=regexp_replace(v_cms_text,'^(第)?([1-8])(級)?$','\2')::integer;
  end if;
  if jsonb_typeof(p_values->48) not in ('null','string','number') then
    raise exception using errcode='22023',message='JUBO_PROFILE_CMS_INVALID';
  end if;
  v_primary_name:=private.jubo_contact_display_text(p_values,78);
  v_primary_phone:=private.jubo_contact_display_text(p_values,79);
  v_proxy_name:=private.jubo_contact_display_text(p_values,80);
  v_proxy_phone:=private.jubo_contact_display_text(p_values,81);
  if (v_primary_name is null and v_primary_phone is not null)
    or (v_proxy_name is null and v_proxy_phone is not null) then
    raise exception using errcode='22023',message='JUBO_PROFILE_CONTACT_INVALID';
  end if;
  if v_primary_name is not null then
    v_contacts:=v_contacts||jsonb_build_array(jsonb_build_object('name',v_primary_name,
      'relationship','','phone',coalesce(v_primary_phone,''),'address','',
      'isPrimary',true,'isEmergency',false));
  end if;
  if v_proxy_name is not null then
    v_contacts:=v_contacts||jsonb_build_array(jsonb_build_object('name',v_proxy_name,
      'relationship','','phone',coalesce(v_proxy_phone,''),'address','',
      'isPrimary',false,'isEmergency',false));
  end if;
  v_profile:=jsonb_build_object(
    'displayName',p_pending.display_name,'clientCode',p_client_code,
    'dateOfBirth',p_pending.date_of_birth::text,'identityNumber',v_identity,
    'sex',p_pending.sex,'phone',null,
    'registeredAddress',private.jubo_plan_text(p_values,32),
    'residentialAddress',private.jubo_plan_text(p_values,35),
    'cmsLevel',v_cms,'disability',private.jubo_plan_text(p_values,54),
    'contacts',v_contacts,'consent',jsonb_build_object('status','pending','confirmedOn',null),
    'notes','');
  return private.validate_intake_profile(v_profile);
end;
$$;

create function private.jubo_profile_mapping_fingerprint(
  p_values jsonb,p_pending private.jubo_pending_master_rows
) returns text language plpgsql volatile security invoker set search_path='' as $$
declare v_profile jsonb; v_normalization jsonb; v_row_sha text;
begin
  -- clientCode is generated only at public creation. Exclude it from the
  -- reviewed display digest so the pre-promotion candidate is deterministic.
  v_profile:=private.jubo_profile_from_master(p_values,p_pending,'JUBO-REVIEW-CANDIDATE');
  v_normalization:=private.jubo_normalization_evidence(p_values);
  v_row_sha:=encode(sha256(convert_to(p_values::text,'UTF8')),'hex');
  return encode(sha256(convert_to(jsonb_build_object(
    'mappingVersion','jubo-master-monthly-202610-v2',
    'sourceRowSha256',v_row_sha,
    'displayProfile',v_profile-'clientCode',
    'normalization',v_normalization)::text,'UTF8')),'hex');
end;
$$;

create function private.create_jubo_pending_intake_profile() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_promotion private.jubo_public_pending_promotions%rowtype;
  v_pending private.jubo_pending_master_rows%rowtype;
  v_pair private.jubo_verified_source_pairs%rowtype;
  v_master private.jubo_source_rows%rowtype;
  v_monthly private.jubo_source_rows%rowtype;
  v_client public.clients%rowtype;
  v_profile jsonb; v_version uuid; v_authority jsonb; v_warnings text[]:='{}';
  v_normalization jsonb; v_mapping_fingerprint text;
  v_mapping_review private.jubo_profile_mapping_v2_reviews%rowtype;
begin
  -- The private table is ungranted to API roles. The transaction marker also
  -- binds this side-effect to the reviewed promotion that inserted the link.
  if current_setting('app.jubo_pending_promotion_id',true)
      is distinct from new.promotion_id::text then
    raise exception using errcode='42501',message='JUBO_PROFILE_REVIEWED_PROMOTION_REQUIRED';
  end if;
  select * into v_promotion from private.jubo_public_pending_promotions
    where id=new.promotion_id and organization_id=new.organization_id
      and branch_id=new.branch_id;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=v_promotion.pair_id and organization_id=new.organization_id
      and branch_id=new.branch_id;
  select * into v_pending from private.jubo_pending_master_rows
    where id=new.pending_row_id and operation_id=v_promotion.pending_operation_id
      and organization_id=new.organization_id and branch_id=new.branch_id;
  select * into v_master from private.jubo_source_rows
    where id=v_pending.source_row_id and batch_id=v_pair.master_batch_id
      and organization_id=new.organization_id and branch_id=new.branch_id;
  select * into v_client from public.clients
    where id=new.client_id and organization_id=new.organization_id
      and branch_id=new.branch_id and status='pending' and admitted_on is null
      and ended_on is null and source_system='jubo';
  if v_promotion.id is null or v_pair.id is null or v_pending.id is null
    or v_master.id is null or v_client.id is null
    or v_master.row_sha256 <> encode(sha256(convert_to(v_master.raw_values::text,'UTF8')),'hex')
    or exists(select 1 from private.client_intake_versions where client_id=new.client_id) then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_MISMATCH';
  end if;
  if v_pending.monthly_source_row_id is not null then
    select * into v_monthly from private.jubo_source_rows
      where id=v_pending.monthly_source_row_id and batch_id=v_pair.monthly_batch_id
        and identity_sha256=v_pending.identity_sha256
        and organization_id=new.organization_id and branch_id=new.branch_id;
    if v_monthly.id is null then
      raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_MISMATCH';
    end if;
  end if;
  v_mapping_fingerprint:=private.jubo_profile_mapping_fingerprint(v_master.raw_values,v_pending);
  select * into v_mapping_review from private.jubo_profile_mapping_v2_reviews
    where pair_id=v_pair.id and master_source_row_id=v_master.id
      and organization_id=new.organization_id and branch_id=new.branch_id
    order by review_version desc limit 1;
  if v_mapping_review.id is null or v_mapping_review.decision<>'approved'
    or v_mapping_review.source_row_sha256<>v_master.row_sha256
    or v_mapping_review.mapping_review_sha256<>v_mapping_fingerprint then
    raise exception using errcode='42501',message='JUBO_PROFILE_MAPPING_V2_REVIEW_REQUIRED';
  end if;
  v_profile:=private.jubo_profile_from_master(v_master.raw_values,v_pending,v_client.client_code);
  v_normalization:=private.jubo_normalization_evidence(v_master.raw_values);
  if jsonb_array_length(v_normalization->'nfkc')>0
    or jsonb_array_length(v_normalization->'contactSeparator')>0 then
    v_warnings:=array_append(v_warnings,'REVIEW_SOURCE_NORMALIZATION');
  end if;
  if v_pending.monthly_source_row_id is null then
    v_warnings:=array_append(v_warnings,'MISSING_MONTHLY_SUMMARY');
  end if;
  if v_profile->'dateOfBirth'='null'::jsonb then
    v_warnings:=array_append(v_warnings,'MISSING_DATE_OF_BIRTH');
  end if;
  if exists(select 1 from jsonb_array_elements(v_profile->'contacts') contact_entry
    where nullif(contact_entry->>'phone','') is null) then
    v_warnings:=array_append(v_warnings,'MISSING_CONTACT_PHONE');
  end if;
  v_warnings:=v_warnings||array['REVIEW_WEEKLY_SCHEDULE','REVIEW_TRANSPORT',
    'REVIEW_ABCD_ASSESSMENTS','REVIEW_IDENTITY_DOCUMENT',
    'REVIEW_MEDICATION_EVIDENCE','REVIEW_HEALTH_EXAM','REVIEW_CONSENT'];
  -- JUBO is a reviewed vendor export, not the central CMS system of record.
  -- A later central import may supersede official fields after explicit review.
  v_authority:=jsonb_build_object(
    'displayName','jubo_export','dateOfBirth','jubo_export','identityNumber','jubo_export',
    'sex','jubo_export','registeredAddress','jubo_export',
    'residentialAddress','jubo_export','cmsLevel','jubo_export',
    'disability','jubo_export','contacts','jubo_export',
    'clientCode','local','phone','unverified','consent','unverified','notes','local');
  insert into private.client_intake_versions(organization_id,branch_id,client_id,
    version,profile,field_authority,actor_user_id)
    values(new.organization_id,new.branch_id,new.client_id,1,v_profile,
      v_authority,v_promotion.actor_user_id) returning id into v_version;
  insert into private.jubo_intake_profile_sources(organization_id,branch_id,
    promotion_id,promotion_link_id,client_id,intake_version_id,pair_id,
    master_source_row_id,monthly_source_row_id,master_source_row_sha256,
    profile_sha256,mapping_review_sha256,source_sheet_row,source_field_indices,warning_codes,
    normalization_field_indices,mapping_version,parser_version)
    values(new.organization_id,new.branch_id,new.promotion_id,new.id,new.client_id,
      v_version,v_pair.id,v_master.id,v_pending.monthly_source_row_id,
      v_master.row_sha256,encode(sha256(convert_to(v_profile::text,'UTF8')),'hex'),
      v_mapping_fingerprint,
      v_master.source_row_number,
      jsonb_build_object('displayName',2,'sex',3,'dateOfBirth',23,
        'identityNumber',25,'registeredAddress',32,'residentialAddress',35,
        'cmsLevel',48,'disability',54,'contacts',jsonb_build_array(78,79,80,81)),
      v_warnings,v_normalization,
      'jubo-master-monthly-202610-v2',v_pair.parser_version);
  return new;
end;
$$;
create trigger jubo_public_pending_profile after insert on private.jubo_public_pending_links
  for each row execute function private.create_jubo_pending_intake_profile();

revoke all on function private.jubo_plan_text(jsonb,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_contact_display_text(jsonb,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_normalization_evidence(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.guard_jubo_pending_profile_version()
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_profile_from_master(jsonb,private.jubo_pending_master_rows,text)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_profile_mapping_fingerprint(jsonb,private.jubo_pending_master_rows)
  from public,anon,authenticated,service_role;
revoke all on function private.create_jubo_pending_intake_profile()
  from public,anon,authenticated,service_role;
comment on table private.jubo_intake_profile_sources is
  'Candidate-only immutable JUBO source evidence for intake profile v1; no service authorization.';
commit;


-- Imported reviewed candidate: 20261009113224_jubo_pending_director_drafts_candidate.sql
-- Candidate only. Requires the separately reviewed public pending-client
-- promotion. This grants a branch director a narrow, append-only place for
-- local intake supplements and unscored assessment preparation drafts. It
-- never updates a JUBO source row, the client master, a formal assessment,
-- or an admission/clinical/service record.
begin;
set local lock_timeout = '5s';

insert into public.permissions(permission_key,description,risk_level)
values('clients.intake_draft.manage',
  'Write only JUBO pending-client local intake supplements and unscored assessment preparation drafts',2)
on conflict(permission_key) do nothing;

-- This is a role-template capability, not a user/membership grant. The RPC
-- below additionally requires this exact system role on the exact branch.
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011'::uuid,p.id
from public.permissions p where p.permission_key='clients.intake_draft.manage'
on conflict do nothing;

create table private.jubo_pending_director_draft_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  pending_link_id uuid not null references private.jubo_public_pending_links(id) on delete restrict,
  source_row_id uuid not null,
  draft_kind text not null check(draft_kind in ('local_supplement','assessment_preparation')),
  form_key text not null,
  revision integer not null check(revision>0),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=10000),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint jubo_pending_draft_kind_form_check check(
    (draft_kind='local_supplement' and form_key='intake_local') or
    (draft_kind='assessment_preparation' and form_key in
      ('spmsq','gds','fall_risk','nsi','barthel','iadl','swallowing','bsrs','body','abcd'))
  ),
  foreign key(client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  unique(client_id,draft_kind,form_key,revision),
  unique(actor_user_id,idempotency_key)
);
create index jubo_pending_draft_latest_idx on private.jubo_pending_director_draft_revisions
  (organization_id,branch_id,client_id,draft_kind,form_key,revision desc);
alter table private.jubo_pending_director_draft_revisions enable row level security;
alter table private.jubo_pending_director_draft_revisions force row level security;
revoke all on private.jubo_pending_director_draft_revisions from public,anon,authenticated,service_role;
create function private.guard_jubo_pending_director_draft_provenance()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
  if not exists(select 1 from private.jubo_public_pending_links link
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
      and pending.organization_id=link.organization_id and pending.branch_id=link.branch_id
    join public.clients client on client.id=link.client_id
      and client.organization_id=link.organization_id and client.branch_id=link.branch_id
    where link.id=new.pending_link_id and link.client_id=new.client_id
      and link.organization_id=new.organization_id and link.branch_id=new.branch_id
      and pending.source_row_id=new.source_row_id
      and client.status='pending' and client.source_system='jubo'
      and client.admitted_on is null and client.ended_on is null) then
    raise exception using errcode='23514',message='JUBO_PENDING_DRAFT_PROVENANCE_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger jubo_pending_draft_provenance before insert
  on private.jubo_pending_director_draft_revisions for each row
  execute function private.guard_jubo_pending_director_draft_provenance();
create trigger jubo_pending_draft_immutable before update or delete
  on private.jubo_pending_director_draft_revisions for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_pending_draft_audit after insert
  on private.jubo_pending_director_draft_revisions for each row
  execute function private.audit_row_change();

-- Data protection is not delegated to clients.manage or an organization-wide
-- branch_supervisor role. routine_staff_scope checks approved Google identity,
-- actual Auth session, active staff membership and revocation on each call.
create function private.require_jubo_pending_director_draft_scope(
  p_org uuid,p_branch uuid,p_client uuid
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_source uuid;
begin
  if auth.uid() is null or p_org is null or p_branch is null or p_client is null
    or not exists(
      select 1 from private.routine_staff_scope() scope
      join public.roles role on role.id=scope.role_id and role.is_system
        and role.role_key='branch_director' and role.is_active
      join public.role_permissions grant_row on grant_row.role_id=role.id
        and grant_row.granted_at<=clock_timestamp()
      join public.permissions permission on permission.id=grant_row.permission_id
        and permission.permission_key='clients.intake_draft.manage'
      join public.branches branch on branch.id=p_branch and branch.organization_id=p_org
        and branch.is_active
      join public.organizations organization on organization.id=p_org and organization.is_active
      where scope.organization_id=p_org and scope.branch_id=p_branch
        and exists(select 1 from public.role_permissions rp
          join public.permissions p on p.id=rp.permission_id
          where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
            and p.permission_key='clients.read')
        and exists(select 1 from public.role_permissions rp
          join public.permissions p on p.id=rp.permission_id
          where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
            and p.permission_key='clients.view_all')
    ) then
    raise exception using errcode='42501',message='JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;
  select pending.source_row_id into v_source
  from public.clients client
  join private.jubo_public_pending_links link on link.client_id=client.id
    and link.organization_id=client.organization_id and link.branch_id=client.branch_id
  join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
    and pending.organization_id=client.organization_id and pending.branch_id=client.branch_id
  where client.id=p_client and client.organization_id=p_org and client.branch_id=p_branch
    and client.status='pending' and client.source_system='jubo'
    and client.admitted_on is null and client.ended_on is null;
  if v_source is null then
    raise exception using errcode='42501',message='JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;
  return v_source;
end;
$$;

-- Payloads are intentionally smaller than the official intake profile and
-- cannot assert identity, eligibility, consent, score, signature or service.
create function private.validate_jubo_pending_director_draft(
  p_kind text,p_form_key text,p_payload jsonb
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare k text; v jsonb; item jsonb; d date;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>10000 then
    raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
  end if;
  if p_kind='local_supplement' and p_form_key='intake_local' then
    if exists(select 1 from jsonb_object_keys(p_payload) as field(key)
      where key not in ('contactPreference','visitPlanningNote','followUpNote'))
      or p_payload='{}'::jsonb then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    if p_payload ? 'contactPreference' and
      (jsonb_typeof(p_payload->'contactPreference')<>'string' or
       p_payload->>'contactPreference' not in ('phone','in_person','written','unknown')) then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    for k,v in select key,value from jsonb_each(p_payload)
      where key in ('visitPlanningNote','followUpNote') loop
      if jsonb_typeof(v)<>'string' or char_length(v#>>'{}')>1000
        or (v#>>'{}')~'[[:cntrl:]]' then
        raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
      end if;
    end loop;
  elsif p_kind='assessment_preparation' and p_form_key in
    ('spmsq','gds','fall_risk','nsi','barthel','iadl','swallowing','bsrs','body','abcd') then
    if exists(select 1 from jsonb_object_keys(p_payload) as field(key)
      where key not in ('formVersion','assessmentDate','answers','qualitativeNote'))
      or coalesce(p_payload->>'formVersion','') !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
      or coalesce(jsonb_typeof(p_payload->'assessmentDate'),'')<>'string'
      or coalesce(jsonb_typeof(p_payload->'answers'),'')<>'object' then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    if (select count(*) from jsonb_object_keys(p_payload->'answers'))>50 then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    d:=private.intake_date(p_payload->>'assessmentDate');
    if d is null or d>(clock_timestamp() at time zone 'Asia/Taipei')::date then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    if p_payload ? 'qualitativeNote' and
      (jsonb_typeof(p_payload->'qualitativeNote')<>'string'
       or char_length(p_payload->>'qualitativeNote')>2000
       or (p_payload->>'qualitativeNote')~'[[:cntrl:]]') then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    for k,v in select key,value from jsonb_each(p_payload->'answers') loop
      if k !~ '^[a-z][a-z0-9_]{0,63}$' or jsonb_typeof(v) not in
        ('string','number','boolean','array') then
        raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
      end if;
      if jsonb_typeof(v)='array' then
        if jsonb_array_length(v)>12 then
          raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
        end if;
        for item in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(item) not in ('string','number','boolean')
            or char_length(item#>>'{}')>1000 or (item#>>'{}')~'[[:cntrl:]]' then
            raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
          end if;
        end loop;
      elsif char_length(v#>>'{}')>1000 or (v#>>'{}')~'[[:cntrl:]]' then
        raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
      end if;
    end loop;
  else
    raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
  end if;
  return p_payload;
end;
$$;

create function private.save_jubo_pending_director_draft(
  p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_form_key text,
  p_expected_revision integer,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_source uuid; v_link uuid; v_previous private.jubo_pending_director_draft_revisions%rowtype;
  v_request_sha text; v_revision integer; v_payload jsonb; v_id uuid;
begin
  v_source:=private.require_jubo_pending_director_draft_scope(p_org,p_branch,p_client);
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
  end if;
  v_payload:=private.validate_jubo_pending_director_draft(p_kind,p_form_key,p_payload);
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'client',p_client,'kind',p_kind,'formKey',p_form_key,
    'expectedRevision',p_expected_revision,'payload',v_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'jubo-director-draft:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_director_draft_revisions
    where actor_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_DRAFT_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('draftId',v_previous.id,'revision',v_previous.revision,
      'kind',v_previous.draft_kind,'formKey',v_previous.form_key,'replayed',true,
      'formalRecord',false);
  end if;
  perform 1 from public.clients where id=p_client and organization_id=p_org
    and branch_id=p_branch and status='pending' for update;
  if not found then
    raise exception using errcode='42501',message='JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;
  select link.id into v_link from private.jubo_public_pending_links link
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
    where link.client_id=p_client and link.organization_id=p_org and link.branch_id=p_branch
      and pending.source_row_id=v_source;
  select * into v_previous from private.jubo_pending_director_draft_revisions
    where client_id=p_client and draft_kind=p_kind and form_key=p_form_key
    order by revision desc limit 1;
  v_revision:=coalesce(v_previous.revision,0);
  if v_revision<>p_expected_revision then
    raise exception using errcode='40001',message='JUBO_PENDING_DRAFT_VERSION_CONFLICT';
  end if;
  insert into private.jubo_pending_director_draft_revisions(
    organization_id,branch_id,client_id,pending_link_id,source_row_id,
    draft_kind,form_key,revision,payload,actor_user_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_client,v_link,v_source,p_kind,p_form_key,v_revision+1,
    v_payload,auth.uid(),p_idempotency_key,v_request_sha)
  returning id into v_id;
  return jsonb_build_object('draftId',v_id,'revision',v_revision+1,
    'kind',p_kind,'formKey',p_form_key,'replayed',false,'formalRecord',false);
end;
$$;

create function private.jubo_pending_director_draft_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_source uuid; v_local jsonb; v_assessments jsonb;
begin
  v_source:=private.require_jubo_pending_director_draft_scope(p_org,p_branch,p_client);
  select jsonb_build_object('revision',row.revision,'payload',row.payload)
    into v_local from private.jubo_pending_director_draft_revisions row
    where row.client_id=p_client and row.draft_kind='local_supplement'
    order by row.revision desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('formKey',entry.form_key,
      'revision',entry.revision,'payload',entry.payload) order by entry.form_key),'[]'::jsonb)
    into v_assessments
  from (select distinct on (row.form_key) row.form_key,row.revision,row.payload
    from private.jubo_pending_director_draft_revisions row
    where row.client_id=p_client and row.draft_kind='assessment_preparation'
    order by row.form_key,row.revision desc) entry;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,
    action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.jubo_pending_director_draft_revisions',
    p_client::text,'{}'::text[],jsonb_build_object('projection','pending_director_drafts_v1'));
  return jsonb_build_object('clientId',p_client,'status','pending',
    'sourceSystem','jubo','localSupplement',v_local,
    'assessmentPreparations',v_assessments,'formalRecord',false);
end;
$$;

create function public.save_jubo_pending_director_draft(
  p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_form_key text,
  p_expected_revision integer,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.save_jubo_pending_director_draft(p_org,p_branch,p_client,
    p_kind,p_form_key,p_expected_revision,p_payload,p_idempotency_key);
$$;
create function public.jubo_pending_director_draft_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_pending_director_draft_workspace(p_org,p_branch,p_client);
$$;

revoke all on function private.require_jubo_pending_director_draft_scope(uuid,uuid,uuid),
  private.guard_jubo_pending_director_draft_provenance(),
  private.validate_jubo_pending_director_draft(text,text,jsonb),
  private.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  private.jubo_pending_director_draft_workspace(uuid,uuid,uuid),
  public.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  public.jubo_pending_director_draft_workspace(uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  private.jubo_pending_director_draft_workspace(uuid,uuid,uuid),
  public.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  public.jubo_pending_director_draft_workspace(uuid,uuid,uuid)
to authenticated;

comment on table private.jubo_pending_director_draft_revisions is
  'Candidate only. Append-only local supplement and unscored assessment preparation history for reviewed JUBO pending clients; never formal assessment or clinical evidence.';
commit;


-- Imported reviewed candidate: 20261009114600_jubo_same_bytes_private_stage.sql
-- Candidate-only private JUBO source staging. The reviewed pair is not an
-- operational client import. A trusted server worker supplies bytes and the
-- output of the pinned parser in one database transaction.
begin;
set local lock_timeout = '5s';

-- Existing source batches used a storage path without storing source bytes.
-- New private-db batches retain the exact approved XLSX bytes in the same
-- transaction as their parsed rows; old external-object batches remain valid.
alter table private.jubo_source_batches
  add column source_storage_backend text not null default 'external_object'
    check (source_storage_backend in ('external_object','private_db')),
  add column source_bytes bytea,
  add constraint jubo_source_private_bytes_ck check (
    (source_storage_backend = 'external_object' and source_bytes is null) or
    (source_storage_backend = 'private_db' and source_bytes is not null
      and octet_length(source_bytes) between 22 and 10485760
      and encode(sha256(source_bytes), 'hex') = source_sha256));

alter table private.jubo_source_rows
  add column normalized_values jsonb,
  add column raw_cell_types jsonb,
  add constraint jubo_source_normalized_width_ck check (
    normalized_values is null or
    (jsonb_typeof(normalized_values) = 'array'
      and jsonb_array_length(normalized_values) = jsonb_array_length(raw_values))),
  add constraint jubo_source_cell_types_width_ck check (
    raw_cell_types is null or
    (jsonb_typeof(raw_cell_types) = 'array'
      and jsonb_array_length(raw_cell_types) = jsonb_array_length(raw_values)));

alter table private.jubo_source_nonrecord_rows
  add column normalized_values jsonb,
  add column raw_cell_types jsonb,
  add constraint jubo_nonrecord_normalized_width_ck check (
    normalized_values is null or
    (jsonb_typeof(normalized_values) = 'array'
      and jsonb_array_length(normalized_values) = jsonb_array_length(raw_values))),
  add constraint jubo_nonrecord_cell_types_width_ck check (
    raw_cell_types is null or
    (jsonb_typeof(raw_cell_types) = 'array'
      and jsonb_array_length(raw_cell_types) = jsonb_array_length(raw_values)));

-- A direct SQL insert cannot create a private-db source row that has no
-- normalized/cell-type evidence. Historical external-object rows are not
-- retroactively fabricated.
create function private.require_jubo_private_stage_cells() returns trigger
language plpgsql volatile security invoker set search_path = '' as $$
declare v_backend text;
begin
  select source_storage_backend into v_backend from private.jubo_source_batches
    where id=new.batch_id and organization_id=new.organization_id
      and branch_id=new.branch_id;
  if v_backend = 'private_db' and
    (new.normalized_values is null or new.raw_cell_types is null) then
    raise exception using errcode='22023',message='JUBO_STAGE_CELLS_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger jubo_source_rows_private_cells before insert
  on private.jubo_source_rows for each row
  execute function private.require_jubo_private_stage_cells();
create trigger jubo_nonrecord_rows_private_cells before insert
  on private.jubo_source_nonrecord_rows for each row
  execute function private.require_jubo_private_stage_cells();
revoke all on function private.require_jubo_private_stage_cells()
  from public,anon,authenticated,service_role;

-- The only idempotent receipt covers the exact pair, parser version, actor,
-- scope and reviewed footer classification. Never place raw values in receipt.
create table private.jubo_source_stage_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  master_batch_id uuid not null,
  monthly_batch_id uuid not null,
  verified_pair_id uuid not null,
  parser_version text not null check (parser_version = 'jubo-xlsx-reader-202610-v1'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (master_batch_id,organization_id,branch_id)
    references private.jubo_source_batches(id,organization_id,branch_id) on delete restrict,
  foreign key (monthly_batch_id,organization_id,branch_id)
    references private.jubo_source_batches(id,organization_id,branch_id) on delete restrict,
  foreign key (verified_pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  unique (actor_user_id,idempotency_key),
  unique (master_batch_id), unique (monthly_batch_id), unique (verified_pair_id)
);
create index jubo_source_stage_operations_scope_idx
  on private.jubo_source_stage_operations(organization_id,branch_id,created_at desc);
create index jubo_source_stage_operations_reauth_idx
  on private.jubo_source_stage_operations(reauth_challenge_id);

create function private.validate_jubo_source_stage_operation() returns trigger
language plpgsql volatile security invoker set search_path = '' as $$
declare v_pair private.jubo_verified_source_pairs%rowtype;
  v_master private.jubo_source_batches%rowtype;
  v_monthly private.jubo_source_batches%rowtype;
begin
  select * into v_pair from private.jubo_verified_source_pairs where
    id=new.verified_pair_id and organization_id=new.organization_id
    and branch_id=new.branch_id;
  select * into v_master from private.jubo_source_batches where
    id=new.master_batch_id and organization_id=new.organization_id
    and branch_id=new.branch_id;
  select * into v_monthly from private.jubo_source_batches where
    id=new.monthly_batch_id and organization_id=new.organization_id
    and branch_id=new.branch_id;
  if v_pair.id is null or v_master.id is null or v_monthly.id is null
    or v_pair.master_batch_id <> new.master_batch_id
    or v_pair.monthly_batch_id <> new.monthly_batch_id
    or v_pair.parser_version <> new.parser_version
    or v_master.source_storage_backend <> 'private_db'
    or v_monthly.source_storage_backend <> 'private_db'
    or v_pair.master_byte_sha256 <> v_master.source_sha256
    or v_pair.monthly_byte_sha256 <> v_monthly.source_sha256
    or v_pair.master_byte_length <> octet_length(v_master.source_bytes)
    or v_pair.monthly_byte_length <> octet_length(v_monthly.source_bytes) then
    raise exception using errcode='22023',message='JUBO_STAGE_PAIR_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger jubo_source_stage_operation_validate before insert
  on private.jubo_source_stage_operations for each row
  execute function private.validate_jubo_source_stage_operation();
revoke all on function private.validate_jubo_source_stage_operation()
  from public,anon,authenticated,service_role;
alter table private.jubo_source_stage_operations enable row level security;
alter table private.jubo_source_stage_operations force row level security;
revoke all on private.jubo_source_stage_operations from public,anon,authenticated,service_role;
create trigger jubo_source_stage_operations_immutable before update or delete
  on private.jubo_source_stage_operations for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_source_stage_operations_audit after insert
  on private.jubo_source_stage_operations for each row
  execute function private.audit_row_change();

commit;


-- Imported reviewed candidate: 20261009123421_jubo_pending_activation_candidate.sql
-- Candidate-only admission review for the 23 reviewed JUBO master shells.
-- This is intentionally NOT an admission endpoint. The current document
-- pipeline has no verified official eligibility / signed service-agreement
-- category, so evidence remains unverified and the existing pending->active
-- trigger stays closed. A later migration needs source-bound proof and a
-- separately reviewed lifecycle transition before enabling formal service.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table private.jubo_public_pending_links
  add constraint jubo_public_pending_links_id_scope_key unique(id,organization_id,branch_id,client_id);

create table private.jubo_pending_admission_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  pending_link_id uuid not null,
  proposal_version integer not null check(proposal_version between 1 and 1000000),
  expected_client_row_version bigint not null check(expected_client_row_version>0),
  proposed_admitted_on date not null check(proposed_admitted_on between date '2000-01-01' and date '2100-01-01'),
  -- Opaque references and hashes are attestations to be checked by a future
  -- trusted source worker, NOT proof that the referenced documents exist.
  eligibility_reference text not null check(char_length(btrim(eligibility_reference)) between 8 and 240 and eligibility_reference !~ '[[:cntrl:]]'),
  eligibility_sha256 text not null check(eligibility_sha256 ~ '^[a-f0-9]{64}$'),
  eligibility_from date not null,
  eligibility_to date not null,
  agreement_reference text not null check(char_length(btrim(agreement_reference)) between 8 and 240 and agreement_reference !~ '[[:cntrl:]]'),
  agreement_sha256 text not null check(agreement_sha256 ~ '^[a-f0-9]{64}$'),
  source_identity_sha256 text not null check(source_identity_sha256 ~ '^[a-f0-9]{64}$'),
  source_verification_status text not null default 'unverified' check(source_verification_status='unverified'),
  review_reason text not null check(char_length(btrim(review_reason)) between 10 and 1000 and review_reason !~ '[[:cntrl:]]'),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  proposed_at timestamptz not null default clock_timestamp(),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(pending_link_id,organization_id,branch_id,client_id)
    references private.jubo_public_pending_links(id,organization_id,branch_id,client_id) on delete restrict,
  unique(client_id,proposal_version),
  unique(proposed_by,idempotency_key),
  unique(id,organization_id,branch_id,client_id),
  check(eligibility_to>=eligibility_from and proposed_admitted_on between eligibility_from and eligibility_to)
);
create index jubo_pending_admission_proposals_scope_idx on private.jubo_pending_admission_proposals
  (organization_id,branch_id,client_id,proposal_version desc);
create index jubo_pending_admission_proposals_reauth_idx on private.jubo_pending_admission_proposals(reauth_challenge_id);

create table private.jubo_pending_admission_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  proposal_id uuid not null,
  proposal_sha256 text not null check(proposal_sha256 ~ '^[a-f0-9]{64}$'),
  decision text not null check(decision in ('approved','held','rejected')),
  review_reason text not null check(char_length(btrim(review_reason)) between 10 and 1000 and review_reason !~ '[[:cntrl:]]'),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key(proposal_id,organization_id,branch_id,client_id)
    references private.jubo_pending_admission_proposals(id,organization_id,branch_id,client_id) on delete restrict,
  unique(proposal_id),
  unique(reviewed_by,idempotency_key)
);
create index jubo_pending_admission_reviews_scope_idx on private.jubo_pending_admission_reviews
  (organization_id,branch_id,client_id,reviewed_at desc);
create index jubo_pending_admission_reviews_reauth_idx on private.jubo_pending_admission_reviews(reauth_challenge_id);

do $tables$ declare t text; begin
  foreach t in array array['jubo_pending_admission_proposals','jubo_pending_admission_reviews'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

-- The general client-master AAL2 helper currently admits only the pinned
-- executive. This local helper additionally admits an individually approved
-- staff Google session, without relaxing any global authorization function.
create function private.current_jubo_pending_reviewer_challenge()
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_challenge uuid; v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null or auth.jwt()->>'aal' is distinct from 'aal2'
    or not (private.is_executive_login_allowed() or private.is_staff_google_session_allowed()) then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_AAL2_REQUIRED';
  end if;
  begin v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_AAL2_REQUIRED';
  end;
  select challenge.id into v_challenge from private.reauth_events event
  join private.reauth_challenges challenge on challenge.id=event.challenge_id
    and challenge.user_id=event.user_id and challenge.session_id=event.session_id
  where event.user_id=auth.uid() and event.session_id=v_session and event.aal='aal2'
    and event.revoked_at is null and event.verification_method in ('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and challenge.factor_verified_at=event.verified_at
    and challenge.factor_verified_at between v_now-interval '15 minutes' and v_now+interval '1 minute'
  order by challenge.factor_verified_at desc,challenge.id desc limit 1
  for share of event,challenge;
  if v_challenge is null then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_AAL2_REQUIRED';
  end if;
  return v_challenge;
end;
$$;

create function private.require_jubo_pending_admission_reviewer(p_org uuid,p_branch uuid,p_client uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid;
begin
  if auth.uid() is null or p_org is null or p_branch is null or p_client is null
    or not exists(select 1 from public.organizations o join public.branches b
      on b.organization_id=o.id where o.id=p_org and b.id=p_branch and o.is_active and b.is_active)
    or not ((private.has_permission(p_org,p_branch,'clients.read')
      and private.has_permission(p_org,p_branch,'clients.demographics.read')
      and private.has_permission(p_org,p_branch,'clients.manage')
      and private.can_staff_access_client(p_client,'clients.manage'))
      or private.has_routine_intake_access(p_org,p_branch,'profile.update',p_client))
    or not exists(select 1 from public.clients c
      join private.jubo_public_pending_links link on link.client_id=c.id
        and link.organization_id=c.organization_id and link.branch_id=c.branch_id
      join private.jubo_pending_master_rows source_row on source_row.id=link.pending_row_id
      where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch
        and c.source_system='jubo' and c.status='pending' and c.admitted_on is null
        and c.ended_on is null and source_row.source_status='服務中') then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SCOPE_DENIED';
  end if;
  v_challenge:=private.current_jubo_pending_reviewer_challenge();
  return v_challenge;
end;
$$;

create function private.propose_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_admitted_on date,
  p_eligibility_reference text,p_eligibility_sha256 text,
  p_eligibility_from date,p_eligibility_to date,
  p_agreement_reference text,p_agreement_sha256 text,
  p_expected_client_row_version bigint,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_client public.clients%rowtype; v_link private.jubo_public_pending_links%rowtype;
  v_identity text; v_challenge uuid; v_previous private.jubo_pending_admission_proposals%rowtype;
  v_result private.jubo_pending_admission_proposals%rowtype; v_request_sha text; v_version integer;
begin
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  if p_admitted_on is null or p_admitted_on<date '2000-01-01'
    or p_admitted_on>(clock_timestamp() at time zone 'Asia/Taipei')::date
    or p_eligibility_from is null or p_eligibility_to is null
    or p_admitted_on not between p_eligibility_from and p_eligibility_to
    or p_expected_client_row_version is null or p_expected_client_row_version<1
    or p_idempotency_key is null
    or coalesce(char_length(btrim(p_eligibility_reference)),0) not between 8 and 240
    or coalesce(char_length(btrim(p_agreement_reference)),0) not between 8 and 240
    or p_eligibility_reference~'[[:cntrl:]]' or p_agreement_reference~'[[:cntrl:]]'
    or p_eligibility_sha256 is null or p_eligibility_sha256 !~ '^[a-f0-9]{64}$'
    or p_agreement_sha256 is null or p_agreement_sha256 !~ '^[a-f0-9]{64}$'
    or coalesce(char_length(btrim(p_reason)),0) not between 10 and 1000
    or p_reason~'[[:cntrl:]]' then
    raise exception using errcode='22023',message='JUBO_PENDING_ADMISSION_INVALID';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'client',p_client,'date',p_admitted_on,
    'eligibilityReference',btrim(p_eligibility_reference),'eligibilitySha',p_eligibility_sha256,
    'from',p_eligibility_from,'to',p_eligibility_to,
    'agreementReference',btrim(p_agreement_reference),'agreementSha',p_agreement_sha256,
    'version',p_expected_client_row_version,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-proposal:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_admission_proposals
    where proposed_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_ADMISSION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('proposalId',v_previous.id,'proposalSha256',v_previous.request_sha256,
      'version',v_previous.proposal_version,'status','awaiting_second_review',
      'sourceVerified',false,'admissionEnabled',false,'replayed',true);
  end if;
  select * into v_client from public.clients c
    where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch for update;
  if v_client.id is null or v_client.status<>'pending' or v_client.admitted_on is not null
    or v_client.ended_on is not null or v_client.row_version<>p_expected_client_row_version then
    raise exception using errcode='40001',message='JUBO_PENDING_ADMISSION_CLIENT_CHANGED';
  end if;
  -- Recheck live membership/branch after the row lock, not only at request start.
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  select * into v_link from private.jubo_public_pending_links
    where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  select identity_sha256 into v_identity from private.client_intake_identities
    where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  if v_link.id is null or v_identity is null then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SOURCE_MISSING';
  end if;
  select coalesce(max(proposal_version),0)+1 into v_version
    from private.jubo_pending_admission_proposals where client_id=p_client;
  insert into private.jubo_pending_admission_proposals(
    organization_id,branch_id,client_id,pending_link_id,proposal_version,
    expected_client_row_version,proposed_admitted_on,eligibility_reference,
    eligibility_sha256,eligibility_from,eligibility_to,agreement_reference,
    agreement_sha256,source_identity_sha256,review_reason,proposed_by,
    reauth_challenge_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_client,v_link.id,v_version,p_expected_client_row_version,
    p_admitted_on,btrim(p_eligibility_reference),p_eligibility_sha256,
    p_eligibility_from,p_eligibility_to,btrim(p_agreement_reference),
    p_agreement_sha256,v_identity,btrim(p_reason),auth.uid(),v_challenge,
    p_idempotency_key,v_request_sha) returning * into v_result;
  return jsonb_build_object('proposalId',v_result.id,'proposalSha256',v_result.request_sha256,
    'version',v_result.proposal_version,'status','awaiting_second_review',
    'sourceVerified',false,'admissionEnabled',false,'replayed',false);
end;
$$;

create function public.propose_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_admitted_on date,
  p_eligibility_reference text,p_eligibility_sha256 text,
  p_eligibility_from date,p_eligibility_to date,
  p_agreement_reference text,p_agreement_sha256 text,
  p_expected_client_row_version bigint,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.propose_jubo_pending_admission(p_org,p_branch,p_client,p_admitted_on,
    p_eligibility_reference,p_eligibility_sha256,p_eligibility_from,p_eligibility_to,
    p_agreement_reference,p_agreement_sha256,p_expected_client_row_version,p_reason,p_idempotency_key);
$$;

create function private.review_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_proposal uuid,p_expected_sha256 text,
  p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_client public.clients%rowtype;
  v_proposal private.jubo_pending_admission_proposals%rowtype;
  v_previous private.jubo_pending_admission_reviews%rowtype;
  v_result private.jubo_pending_admission_reviews%rowtype; v_sha text;
begin
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  if p_proposal is null or p_expected_sha256 is null or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_decision not in ('approved','held','rejected') or p_decision is null
    or p_idempotency_key is null or coalesce(char_length(btrim(p_reason)),0) not between 10 and 1000
    or p_reason~'[[:cntrl:]]' then
    raise exception using errcode='22023',message='JUBO_PENDING_ADMISSION_REVIEW_INVALID';
  end if;
  v_sha:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,
    'client',p_client,'proposal',p_proposal,'expectedSha',p_expected_sha256,
    'decision',p_decision,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-review:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_admission_reviews
    where reviewed_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.request_sha256<>v_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_ADMISSION_REVIEW_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('reviewId',v_previous.id,'decision',v_previous.decision,
      'status','source_verification_required','admissionEnabled',false,'replayed',true);
  end if;
  select * into v_client from public.clients c
    where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch for update;
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  select * into v_proposal from private.jubo_pending_admission_proposals
    where id=p_proposal and organization_id=p_org and branch_id=p_branch and client_id=p_client;
  if v_client.id is null or v_proposal.id is null or v_proposal.proposed_by=auth.uid()
    or v_client.row_version<>v_proposal.expected_client_row_version
    or v_proposal.request_sha256<>p_expected_sha256
    or v_proposal.source_verification_status<>'unverified'
    or v_proposal.proposal_version<>(select max(proposal_version)
      from private.jubo_pending_admission_proposals where client_id=p_client) then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED';
  end if;
  if exists(select 1 from private.jubo_pending_admission_reviews where proposal_id=p_proposal) then
    raise exception using errcode='23505',message='JUBO_PENDING_ADMISSION_ALREADY_REVIEWED';
  end if;
  insert into private.jubo_pending_admission_reviews(
    organization_id,branch_id,client_id,proposal_id,proposal_sha256,
    decision,review_reason,reviewed_by,reauth_challenge_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_client,p_proposal,p_expected_sha256,p_decision,btrim(p_reason),
    auth.uid(),v_challenge,p_idempotency_key,v_sha) returning * into v_result;
  return jsonb_build_object('reviewId',v_result.id,'decision',v_result.decision,
    'status','source_verification_required','admissionEnabled',false,'replayed',false);
end;
$$;

create function public.review_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_proposal uuid,p_expected_sha256 text,
  p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.review_jubo_pending_admission(p_org,p_branch,p_client,p_proposal,
    p_expected_sha256,p_decision,p_reason,p_idempotency_key);
$$;

-- Explicit final boundary. No public wrapper or grant exists; even a privileged
-- caller cannot mark a client active until an official source-verification
-- contract, evidence linkage and lifecycle migration are separately reviewed.
create function private.activate_jubo_pending_client_candidate(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SOURCE_UNCONFIGURED';
end;
$$;

alter function private.current_jubo_pending_reviewer_challenge() owner to postgres;
alter function private.require_jubo_pending_admission_reviewer(uuid,uuid,uuid) owner to postgres;
alter function private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid) owner to postgres;
alter function private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid) owner to postgres;
alter function private.activate_jubo_pending_client_candidate(uuid,uuid,uuid) owner to postgres;
revoke all on function private.current_jubo_pending_reviewer_challenge(),
  private.require_jubo_pending_admission_reviewer(uuid,uuid,uuid),
  private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid),
  private.activate_jubo_pending_client_candidate(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid),
  public.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)
  to authenticated;
comment on function private.activate_jubo_pending_client_candidate(uuid,uuid,uuid) is
  'Fail closed: official eligibility source, signed agreement evidence and a separately reviewed lifecycle transition are not configured. Never infer admission from JUBO first service date.';
commit;


-- Imported reviewed candidate: 20261009125818_jubo_pending_direct_insert_guards.sql
-- Owner/direct-DML backstops for pending JUBO master shells. The application
-- RPCs already reject these rows, but an owner/import path must not create a
-- care allocation or even a draft transport passenger snapshot for them.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.reject_pending_jubo_care_roster_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.clients client
    where client.id = new.client_id
      and client.organization_id = new.organization_id
      and client.branch_id = new.branch_id
      and client.source_system = 'jubo'
      and client.status = 'pending'
  ) then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  return new;
end;
$$;

create trigger jubo_pending_care_roster_no_insert
before insert on private.care_roster_versions
for each row execute function private.reject_pending_jubo_care_roster_insert();

create function private.reject_pending_jubo_transport_plan_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Let the existing snapshot constraint validate malformed JSON. A valid
  -- passenger UUID, however, must never identify a pending JUBO shell.
  if jsonb_typeof(new.passenger_snapshot) is distinct from 'array' then
    return new;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.passenger_snapshot) passenger(value)
    join public.clients client on client.id = case
      when coalesce(passenger.value->>'client_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (passenger.value->>'client_id')::uuid
      else null::uuid end
    where client.organization_id = new.organization_id
      and client.branch_id = new.branch_id
      and client.source_system = 'jubo'
      and client.status = 'pending'
  ) then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  return new;
end;
$$;

create trigger jubo_pending_transport_plan_no_insert
before insert on public.transport_trip_plan_versions
for each row execute function private.reject_pending_jubo_transport_plan_insert();

revoke all on function private.reject_pending_jubo_care_roster_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_pending_jubo_transport_plan_insert()
  from public, anon, authenticated, service_role;
commit;


-- Imported reviewed candidate: 20261009131000_jubo_profile_mapping_v2_review_candidate.sql
-- Candidate only: one source-bound, purpose-bound human preview and decision
-- per JUBO v2 intake-profile mapping. This does not grant public promotion.
begin;
set local lock_timeout = '5s';

create table private.jubo_profile_mapping_v2_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  master_source_row_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_session_id uuid not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  review_purpose text not null check (review_purpose='jubo_intake_profile_mapping_v2'),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_review_sha256 text not null check (mapping_review_sha256 ~ '^[a-f0-9]{64}$'),
  presented_payload_sha256 text not null check (presented_payload_sha256 ~ '^[a-f0-9]{64}$'),
  presented_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (master_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  check (expires_at > presented_at and expires_at <= presented_at + interval '15 minutes')
);
create index jubo_profile_v2_previews_scope_idx on private.jubo_profile_mapping_v2_previews
  (organization_id,branch_id,pair_id,master_source_row_id,presented_at desc);
create index jubo_profile_v2_previews_actor_idx on private.jubo_profile_mapping_v2_previews
  (actor_user_id,actor_session_id,expires_at desc);
alter table private.jubo_profile_mapping_v2_previews enable row level security;
alter table private.jubo_profile_mapping_v2_previews force row level security;
revoke all on private.jubo_profile_mapping_v2_previews from public,anon,authenticated,service_role;
create trigger jubo_profile_v2_previews_immutable before update or delete
  on private.jubo_profile_mapping_v2_previews for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_profile_v2_previews_audit after insert
  on private.jubo_profile_mapping_v2_previews for each row execute function private.audit_row_change();

alter table private.jubo_profile_mapping_v2_reviews
  add column review_purpose text not null
    check (review_purpose='jubo_intake_profile_mapping_v2'),
  add column preview_id uuid not null unique
    references private.jubo_profile_mapping_v2_previews(id) on delete restrict,
  add column presented_payload_sha256 text not null
    check (presented_payload_sha256 ~ '^[a-f0-9]{64}$'),
  add column idempotency_key uuid not null,
  add column request_sha256 text not null
    check (request_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint jubo_profile_v2_review_actor_key unique (reviewer_user_id,idempotency_key);

-- The fixed purpose is checked at both entry points and persisted with the
-- exact evidence digest. This is not a claim that a server can prove what a
-- human visually read; the UI must present the returned original/display pair.
create function private.require_jubo_profile_v2_reviewer(p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if auth.uid() is null
    or not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve') then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REVIEW_DENIED';
  end if;
  return private.current_client_master_reauth_challenge();
end;
$$;

create function private.preview_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_purpose text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_session uuid; v_pair private.jubo_verified_source_pairs%rowtype;
  v_pending_operation private.jubo_pending_master_operations%rowtype;
  v_pending private.jubo_pending_master_rows%rowtype;
  v_source private.jubo_source_rows%rowtype;
  v_v1 private.jubo_master_row_reviews%rowtype;
  v_profile jsonb; v_normalization jsonb; v_payload jsonb;
  v_fingerprint text; v_payload_sha text; v_preview uuid; v_now timestamptz;
begin
  v_challenge:=private.require_jubo_profile_v2_reviewer(p_org,p_branch);
  if p_pair is null or p_source_row is null
    or p_purpose is distinct from 'jubo_intake_profile_mapping_v2' then
    raise exception using errcode='22023',message='JUBO_PROFILE_V2_PREVIEW_INVALID';
  end if;
  v_session:=(auth.jwt()->>'session_id')::uuid;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch;
  select * into v_pending_operation from private.jubo_pending_master_operations
    where pair_id=p_pair and organization_id=p_org and branch_id=p_branch;
  select * into v_source from private.jubo_source_rows
    where id=p_source_row and batch_id=v_pair.master_batch_id
      and organization_id=p_org and branch_id=p_branch;
  select * into v_pending from private.jubo_pending_master_rows
    where operation_id=v_pending_operation.id and source_row_id=p_source_row
      and organization_id=p_org and branch_id=p_branch;
  select * into v_v1 from private.jubo_master_row_reviews
    where pair_id=p_pair and source_row_id=p_source_row
      and organization_id=p_org and branch_id=p_branch
    order by review_version desc limit 1;
  if v_pair.id is null or v_pending_operation.id is null
    or v_source.id is null or v_pending.id is null
    or v_v1.id is null or v_v1.decision<>'approved'
    or v_v1.source_row_sha256<>v_source.row_sha256
    or v_source.row_sha256<>encode(sha256(convert_to(v_source.raw_values::text,'UTF8')),'hex')
    or exists(select 1 from private.jubo_public_pending_promotions where pair_id=p_pair) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SOURCE_UNAVAILABLE';
  end if;
  v_profile:=private.jubo_profile_from_master(v_source.raw_values,v_pending,'JUBO-REVIEW-CANDIDATE');
  v_normalization:=private.jubo_normalization_evidence(v_source.raw_values);
  v_fingerprint:=private.jubo_profile_mapping_fingerprint(v_source.raw_values,v_pending);
  v_payload:=jsonb_build_object(
    'reviewPurpose',p_purpose,'mappingVersion','jubo-master-monthly-202610-v2',
    'pairId',p_pair,'sourceRowId',p_source_row,'sourceSheetRow',v_source.source_row_number,
    'sourceRowSha256',v_source.row_sha256,'mappingReviewSha256',v_fingerprint,
    'monthlySourceRowId',v_pending.monthly_source_row_id,
    'originalMappedValues',jsonb_build_object(
      'displayName',jsonb_build_object('index',2,'value',v_source.raw_values->2),
      'sex',jsonb_build_object('index',3,'value',v_source.raw_values->3),
      'dateOfBirth',jsonb_build_object('index',23,'value',v_source.raw_values->23),
      'identityNumber',jsonb_build_object('index',25,'value',v_source.raw_values->25),
      'registeredAddress',jsonb_build_object('index',32,'value',v_source.raw_values->32),
      'residentialAddress',jsonb_build_object('index',35,'value',v_source.raw_values->35),
      'cmsLevel',jsonb_build_object('index',48,'value',v_source.raw_values->48),
      'disability',jsonb_build_object('index',54,'value',v_source.raw_values->54),
      'primaryContactName',jsonb_build_object('index',78,'value',v_source.raw_values->78),
      'primaryContactPhone',jsonb_build_object('index',79,'value',v_source.raw_values->79),
      'proxyName',jsonb_build_object('index',80,'value',v_source.raw_values->80),
      'proxyPhone',jsonb_build_object('index',81,'value',v_source.raw_values->81)),
    'displayProfile',v_profile-'clientCode',
    'normalizationFieldIndices',v_normalization,
    'normalizationRequiresConfirmation',
      jsonb_array_length(v_normalization->'nfkc')>0
        or jsonb_array_length(v_normalization->'contactSeparator')>0);
  v_payload_sha:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  if private.current_client_master_reauth_challenge()<>v_challenge then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REAUTH_EXPIRED';
  end if;
  v_now:=clock_timestamp();
  insert into private.jubo_profile_mapping_v2_previews(
    organization_id,branch_id,pair_id,master_source_row_id,actor_user_id,
    actor_session_id,reauth_challenge_id,review_purpose,source_row_sha256,
    mapping_review_sha256,presented_payload_sha256,presented_at,expires_at)
  values(p_org,p_branch,p_pair,p_source_row,auth.uid(),v_session,v_challenge,
    p_purpose,v_source.row_sha256,v_fingerprint,v_payload_sha,v_now,v_now+interval '15 minutes')
  returning id into v_preview;
  return v_payload||jsonb_build_object('previewId',v_preview,
    'previewSha256',v_payload_sha,'expiresAt',v_now+interval '15 minutes');
end;
$$;

create function public.preview_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_purpose text
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.preview_jubo_profile_mapping_v2(p_org,p_branch,p_pair,p_source_row,p_purpose);
$$;

create function private.review_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_session uuid; v_preview private.jubo_profile_mapping_v2_previews%rowtype;
  v_source private.jubo_source_rows%rowtype; v_pending private.jubo_pending_master_rows%rowtype;
  v_pair private.jubo_verified_source_pairs%rowtype;
  v_v1 private.jubo_master_row_reviews%rowtype;
  v_previous private.jubo_profile_mapping_v2_reviews%rowtype;
  v_result private.jubo_profile_mapping_v2_reviews%rowtype;
  v_reason text:=btrim(p_reason); v_fingerprint text; v_request_sha text;
  v_version integer;
begin
  v_challenge:=private.require_jubo_profile_v2_reviewer(p_org,p_branch);
  if p_pair is null or p_source_row is null or p_preview is null
    or p_idempotency_key is null or p_expected_source_sha256 is null
    or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[a-f0-9]{64}$'
    or p_expected_preview_sha256 is null or p_expected_preview_sha256 !~ '^[a-f0-9]{64}$'
    or p_purpose is distinct from 'jubo_intake_profile_mapping_v2'
    or p_decision is null or p_decision not in ('approved','held','rejected')
    or v_reason is null or char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode='22023',message='JUBO_PROFILE_V2_REVIEW_INVALID';
  end if;
  v_session:=(auth.jwt()->>'session_id')::uuid;
  -- Public promotion locks this same pair row. A held/rejected supersession
  -- must serialize before or after the whole promotion, never mid-loop.
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  select * into v_source from private.jubo_source_rows
    where id=p_source_row and batch_id=v_pair.master_batch_id
      and organization_id=p_org and branch_id=p_branch for update;
  select * into v_pending from private.jubo_pending_master_rows
    where source_row_id=p_source_row and organization_id=p_org and branch_id=p_branch;
  select * into v_v1 from private.jubo_master_row_reviews
    where pair_id=p_pair and source_row_id=p_source_row
      and organization_id=p_org and branch_id=p_branch
    order by review_version desc limit 1;
  if v_pair.id is null or v_source.id is null or v_pending.id is null
    or v_v1.id is null or v_v1.decision<>'approved'
    or v_v1.source_row_sha256<>v_source.row_sha256
    or exists(select 1 from private.jubo_public_pending_promotions where pair_id=p_pair) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SOURCE_UNAVAILABLE';
  end if;
  v_fingerprint:=private.jubo_profile_mapping_fingerprint(v_source.raw_values,v_pending);
  select * into v_preview from private.jubo_profile_mapping_v2_previews
    where id=p_preview and organization_id=p_org and branch_id=p_branch
      and pair_id=p_pair and master_source_row_id=p_source_row
      and actor_user_id=auth.uid() and actor_session_id=v_session for share;
  if v_preview.id is null or v_preview.expires_at<=clock_timestamp()
    or v_preview.review_purpose<>p_purpose
    or v_preview.reauth_challenge_id<>v_challenge
    or v_source.row_sha256<>p_expected_source_sha256
    or v_source.row_sha256<>v_preview.source_row_sha256
    or v_source.row_sha256<>encode(sha256(convert_to(v_source.raw_values::text,'UTF8')),'hex')
    or v_fingerprint<>p_expected_fingerprint
    or v_fingerprint<>v_preview.mapping_review_sha256
    or v_preview.presented_payload_sha256<>p_expected_preview_sha256 then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_PREVIEW_MISMATCH';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair,'row',p_source_row,
    'preview',p_preview,'sourceSha',p_expected_source_sha256,
    'fingerprint',p_expected_fingerprint,'previewSha',p_expected_preview_sha256,
    'purpose',p_purpose,'decision',p_decision,'reason',v_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-profile-v2:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_profile_mapping_v2_reviews
    where reviewer_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v_previous.id is not null then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PROFILE_V2_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('reviewId',v_previous.id,'reviewVersion',v_previous.review_version,
      'decision',v_previous.decision,'replayed',true);
  end if;
  if exists(select 1 from private.jubo_profile_mapping_v2_reviews where preview_id=p_preview) then
    raise exception using errcode='23505',message='JUBO_PROFILE_V2_PREVIEW_ALREADY_REVIEWED';
  end if;
  if private.current_client_master_reauth_challenge()<>v_challenge
    or v_preview.expires_at<=clock_timestamp() then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REAUTH_EXPIRED';
  end if;
  select coalesce(max(review_version),0)+1 into v_version
    from private.jubo_profile_mapping_v2_reviews
    where pair_id=p_pair and master_source_row_id=p_source_row;
  insert into private.jubo_profile_mapping_v2_reviews(
    organization_id,branch_id,pair_id,master_source_row_id,review_version,
    source_row_sha256,mapping_review_sha256,mapping_version,decision,review_reason,
    reviewer_user_id,reauth_challenge_id,review_purpose,preview_id,
    presented_payload_sha256,idempotency_key,request_sha256)
  values(p_org,p_branch,p_pair,p_source_row,v_version,p_expected_source_sha256,
    p_expected_fingerprint,'jubo-master-monthly-202610-v2',p_decision,v_reason,
    auth.uid(),v_challenge,p_purpose,p_preview,p_expected_preview_sha256,
    p_idempotency_key,v_request_sha) returning * into v_result;
  return jsonb_build_object('reviewId',v_result.id,'reviewVersion',v_result.review_version,
    'decision',v_result.decision,'replayed',false);
end;
$$;

create function public.review_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.review_jubo_profile_mapping_v2(p_org,p_branch,p_pair,p_source_row,p_preview,
    p_expected_source_sha256,p_expected_fingerprint,p_expected_preview_sha256,
    p_purpose,p_decision,p_reason,p_idempotency_key);
$$;

alter function private.require_jubo_profile_v2_reviewer(uuid,uuid) owner to postgres;
alter function private.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text) owner to postgres;
alter function private.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) owner to postgres;
revoke all on function private.require_jubo_profile_v2_reviewer(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  to authenticated;
grant execute on function private.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  to authenticated;
grant execute on function public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
comment on function public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) is
  'Candidate only: review one exact JUBO v2 profile mapping after same-session AAL2 preview. No promotion or care authorization.';
commit;


-- Imported reviewed candidate: 20261009131303_jubo_v2_receipt_recovery_candidate.sql
-- Candidate only. A timed-out decision may already have committed even after
-- its preview and AAL2 challenge expire. This endpoint never creates a review:
-- it only returns the exact same actor/session/request receipt, if committed.
begin;
set local lock_timeout = '5s';

create function private.require_jubo_profile_v2_review_scope(p_org uuid,p_branch uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  -- has_permission/is_active_user intentionally require an AAL2 JWT. Use the
  -- already-admitted Google session plus the same current membership grants
  -- for RECEIPT reads; never let this helper authorize a new write by itself.
  if p_org is null or p_branch is null or auth.uid() is null
    or public.is_staff_login_allowed() is not true
    or not exists (select 1 from public.branches branch
      join public.organizations organization on organization.id=branch.organization_id
      where branch.id=p_branch and branch.organization_id=p_org
        and branch.is_active and organization.is_active)
    or not exists (
      select 1 from public.memberships membership
      where membership.profile_id=auth.uid()
        and membership.organization_id=p_org
        and (membership.branch_id is null or membership.branch_id=p_branch)
        and membership.status='active'
        and membership.starts_at<=clock_timestamp()
        and (membership.ends_at is null or membership.ends_at>clock_timestamp())
        and exists (select 1 from public.membership_roles manager_assignment
          join public.roles manager_role on manager_role.id=manager_assignment.role_id
          where manager_assignment.membership_id=membership.id
            and manager_assignment.assigned_at<=clock_timestamp()
            and manager_role.is_active and manager_role.is_system
            and (manager_role.organization_id is null or manager_role.organization_id=p_org)
            and manager_role.role_key in ('organization_manager','branch_supervisor','branch_director'))
        and (select count(distinct permission.permission_key)
          from public.membership_roles assignment
          join public.roles role on role.id=assignment.role_id
          join public.role_permissions granted on granted.role_id=role.id
          join public.permissions permission on permission.id=granted.permission_id
          where assignment.membership_id=membership.id
            and assignment.assigned_at<=clock_timestamp()
            and role.is_active and (role.organization_id is null or role.organization_id=p_org)
            and granted.granted_at<=clock_timestamp()
            and permission.permission_key in (
              'clients.read','clients.demographics.read','clients.manage',
              'clients.view_all','imports.approve'))=5
    ) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REVIEW_DENIED';
  end if;
end;
$$;

-- Keep the existing write/preview gate unchanged in strength, and bring its
-- role check into line with the app gate. Receipt lookup calls only the scope
-- half, so stale AAL2 never authorizes a NEW write.
create or replace function private.require_jubo_profile_v2_reviewer(p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.require_jubo_profile_v2_review_scope(p_org,p_branch);
  -- Preserve the pre-existing AAL2-coupled database permission checks for
  -- preview, queue, and NEW decisions. Scope-only access is read-receipt only.
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve') then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REVIEW_DENIED';
  end if;
  return private.current_client_master_reauth_challenge();
end;
$$;

create function private.jubo_profile_mapping_v2_review_receipt(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_previous private.jubo_profile_mapping_v2_reviews%rowtype;
  v_reason text:=btrim(p_reason); v_request_sha text;
begin
  perform private.require_jubo_profile_v2_review_scope(p_org,p_branch);
  if p_pair is null or p_source_row is null or p_preview is null
    or p_idempotency_key is null or p_expected_source_sha256 is null
    or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[a-f0-9]{64}$'
    or p_expected_preview_sha256 is null or p_expected_preview_sha256 !~ '^[a-f0-9]{64}$'
    or p_purpose is distinct from 'jubo_intake_profile_mapping_v2'
    or p_decision is null or p_decision not in ('approved','held','rejected')
    or v_reason is null or char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode='22023',message='JUBO_PROFILE_V2_RECEIPT_INVALID';
  end if;
  begin
    v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SESSION_REQUIRED';
  end;
  if v_session is null or not exists (
    select 1 from auth.sessions session
    where session.id=v_session and session.user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SESSION_REQUIRED';
  end if;
  -- Keep this canonical JSONB request digest identical to the write RPC.
  -- A lookup with only an idempotency key would disclose another decision.
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair,'row',p_source_row,
    'preview',p_preview,'sourceSha',p_expected_source_sha256,
    'fingerprint',p_expected_fingerprint,'previewSha',p_expected_preview_sha256,
    'purpose',p_purpose,'decision',p_decision,'reason',v_reason)::text,'UTF8')),'hex');
  select review.* into v_previous from private.jubo_profile_mapping_v2_reviews review
    join private.jubo_profile_mapping_v2_previews preview on preview.id=review.preview_id
    where review.reviewer_user_id=auth.uid() and review.idempotency_key=p_idempotency_key
      and review.organization_id=p_org and review.branch_id=p_branch
      and review.pair_id=p_pair and review.master_source_row_id=p_source_row
      and review.preview_id=p_preview and review.review_purpose=p_purpose
      and preview.actor_user_id=auth.uid() and preview.actor_session_id=v_session;
  if v_previous.id is null then
    -- Absence is NOT proof of a failed write: the first request may still run.
    return jsonb_build_object('status','unconfirmed','receipt',null);
  end if;
  if v_previous.request_sha256<>v_request_sha then
    raise exception using errcode='23505',message='JUBO_PROFILE_V2_IDEMPOTENCY_CONFLICT';
  end if;
  return jsonb_build_object('status','found','receipt',jsonb_build_object(
    'reviewId',v_previous.id,'reviewVersion',v_previous.review_version,
    'decision',v_previous.decision,'replayed',true));
end;
$$;

create function public.jubo_profile_mapping_v2_review_receipt(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_profile_mapping_v2_review_receipt(p_org,p_branch,p_pair,p_source_row,p_preview,
    p_expected_source_sha256,p_expected_fingerprint,p_expected_preview_sha256,
    p_purpose,p_decision,p_reason,p_idempotency_key);
$$;

alter function private.require_jubo_profile_v2_review_scope(uuid,uuid) owner to postgres;
alter function private.require_jubo_profile_v2_reviewer(uuid,uuid) owner to postgres;
alter function private.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) owner to postgres;
revoke all on function private.require_jubo_profile_v2_review_scope(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.require_jubo_profile_v2_reviewer(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
comment on function public.jubo_profile_mapping_v2_review_receipt(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) is
  'Read-only same-actor, same-session, exact-request receipt lookup after an uncertain JUBO v2 review; no new approval, no AAL2 bypass for writes.';
commit;


-- Imported reviewed candidate: 20261009132000_jubo_pending_external_result_gate.sql
-- Candidate only. External assessment results are formal, append-only results,
-- never preparation drafts. Guard the ledger itself so every writer is covered.
begin;
set local lock_timeout = '5s';

create trigger jubo_pending_external_result_formal_gate
  before insert on private.external_assessment_results
  for each row execute function private.guard_jubo_pending_private_client_write('formal');

comment on trigger jubo_pending_external_result_formal_gate on private.external_assessment_results is
  'Reject a formal external assessment result for a pending JUBO intake at the storage boundary.';
commit;


-- Imported reviewed candidate: 20261009132001_jubo_profile_v2_review_queue_candidate.sql
-- Candidate-only list for the already verified 23/17 pair. No source cells,
-- names, contact details or identity keys leave this read-only function.
begin;
set local lock_timeout = '5s';

create function private.jubo_profile_mapping_v2_review_queue(
  p_org uuid,p_branch uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_total integer; v_pairs jsonb;
begin
  v_challenge:=private.require_jubo_profile_v2_reviewer(p_org,p_branch);
  select count(*) into v_total
    from private.jubo_verified_source_pairs pair
    join private.jubo_pending_master_operations operation
      on operation.pair_id=pair.id and operation.organization_id=p_org
      and operation.branch_id=p_branch
    where pair.organization_id=p_org and pair.branch_id=p_branch
      and not exists (select 1 from private.jubo_public_pending_promotions promoted
        where promoted.pair_id=pair.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'pairId',pairs.id,
    'verifiedAt',pairs.verified_at,
    'sourceRows',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'sourceRowId',source_row.id,
        'sourceSheetRow',source_row.source_row_number,
        'reviewVersion',coalesce(latest.review_version,0),
        'decision',case
          when latest.id is null then 'unreviewed'
          when latest.mapping_version<>'jubo-master-monthly-202610-v2'
            or latest.source_row_sha256<>source_row.row_sha256
            or latest.mapping_review_sha256<>
              private.jubo_profile_mapping_fingerprint(source_row.raw_values,pending)
            then 'stale'
          else latest.decision end
      ) order by source_row.source_row_number),'[]'::jsonb)
      from private.jubo_pending_master_rows pending
      join private.jubo_source_rows source_row
        on source_row.id=pending.source_row_id
        and source_row.organization_id=p_org and source_row.branch_id=p_branch
        and source_row.batch_id=pairs.master_batch_id
      left join lateral (
        select review.id,review.review_version,review.decision,
          review.mapping_version,review.source_row_sha256,review.mapping_review_sha256
        from private.jubo_profile_mapping_v2_reviews review
        where review.pair_id=pairs.id and review.master_source_row_id=source_row.id
          and review.organization_id=p_org and review.branch_id=p_branch
        order by review.review_version desc limit 1
      ) latest on true
      where pending.operation_id=pairs.operation_id
        and pending.organization_id=p_org and pending.branch_id=p_branch
    )
  ) order by pairs.verified_at desc,pairs.id),'[]'::jsonb) into v_pairs
  from (
    select pair.id,pair.master_batch_id,pair.verified_at,operation.id operation_id
    from private.jubo_verified_source_pairs pair
    join private.jubo_pending_master_operations operation
      on operation.pair_id=pair.id and operation.organization_id=p_org
      and operation.branch_id=p_branch
    where pair.organization_id=p_org and pair.branch_id=p_branch
      and not exists (select 1 from private.jubo_public_pending_promotions promoted
        where promoted.pair_id=pair.id)
    order by pair.verified_at desc,pair.id limit 20
  ) pairs;
  if private.current_client_master_reauth_challenge()<>v_challenge then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REAUTH_EXPIRED';
  end if;
  return jsonb_build_object('pairs',v_pairs,'eligiblePairCount',v_total,
    'reviewPurpose','jubo_intake_profile_mapping_v2');
end;
$$;

create function public.jubo_profile_mapping_v2_review_queue(
  p_org uuid,p_branch uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_profile_mapping_v2_review_queue(p_org,p_branch);
$$;

alter function private.jubo_profile_mapping_v2_review_queue(uuid,uuid) owner to postgres;
revoke all on function private.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  to authenticated;
grant execute on function public.jubo_profile_mapping_v2_review_queue(uuid,uuid)
  to authenticated;
comment on function public.jubo_profile_mapping_v2_review_queue(uuid,uuid) is
  'Candidate-only AAL2-scoped row ordinals and v2 review states; no original or normalized personal data.';
commit;


-- Imported reviewed candidate: 20261009132521_jubo_pending_director_exact_receipt.sql
-- Recover an uncertain director draft by the exact, immutable original operation.
-- Reading the latest form revision cannot prove an earlier write once a second
-- director has appended another revision. This RPC never creates a draft.
begin;
set local lock_timeout = '5s';

create function private.jubo_pending_director_exact_receipt(
  p_org uuid, p_branch uuid, p_client uuid, p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_row private.jubo_pending_director_draft_revisions%rowtype;
  v_found boolean;
begin
  if auth.uid() is null or p_org is null or p_branch is null or p_client is null
    or p_idempotency_key is null or not exists(
      select 1 from private.routine_staff_scope() scope
      join public.roles role on role.id = scope.role_id and role.is_system
        and role.role_key = 'branch_director' and role.is_active
      join public.branches branch on branch.id = p_branch
        and branch.organization_id = p_org and branch.is_active
      join public.organizations organization on organization.id = p_org
        and organization.is_active
      where scope.organization_id = p_org and scope.branch_id = p_branch
        and not exists (
          select 1 from (values ('clients.read'), ('clients.view_all'),
            ('clients.intake_draft.manage'), ('clients.jubo_pending_source.read')) needed(permission_key)
          where not exists (
            select 1 from public.role_permissions rp
            join public.permissions permission on permission.id = rp.permission_id
            where rp.role_id = role.id and rp.granted_at <= clock_timestamp()
              and permission.permission_key = needed.permission_key
          )
        )
    ) then
    raise exception using errcode = '42501', message = 'JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;

  -- The actor/tenant/branch/client/key equality is essential: a director may
  -- only resolve their own already-submitted operation, including if a newer
  -- revision was appended or the client subsequently left pending intake.
  select * into v_row from private.jubo_pending_director_draft_revisions row
  where row.actor_user_id = auth.uid() and row.organization_id = p_org
    and row.branch_id = p_branch and row.client_id = p_client
    and row.idempotency_key = p_idempotency_key;
  v_found := found;

  insert into public.audit_events(organization_id, branch_id, actor_user_id,
    action, table_name, row_pk, changed_fields, metadata)
  values (p_org, p_branch, auth.uid(), 'select',
    'private.jubo_pending_director_draft_revisions',
    case when v_found then v_row.id::text else p_client::text end,
    '{}'::text[], jsonb_build_object('projection', 'pending_director_exact_receipt_v1',
      'found', v_found));

  if not v_found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'clientId', v_row.client_id,
    'expectedRevision', v_row.revision - 1, 'payload', v_row.payload,
    'receipt', jsonb_build_object('draftId', v_row.id, 'revision', v_row.revision,
      'kind', v_row.draft_kind, 'formKey', v_row.form_key,
      'replayed', true, 'formalRecord', false));
end;
$$;

create function public.jubo_pending_director_exact_receipt(
  p_org uuid, p_branch uuid, p_client uuid, p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.jubo_pending_director_exact_receipt(
    p_org, p_branch, p_client, p_idempotency_key);
$$;

revoke all on function private.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid),
  public.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function private.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid),
  public.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid)
to authenticated;

commit;


-- Imported reviewed candidate: 20261009133000_jubo_pending_director_workspace.sql
-- Candidate only. The director may compare the immutable JUBO source with
-- the reviewed display profile for a pending client of the exact branch.
-- This does not grant clients.demographics.read, clients.manage, admission,
-- formal assessment, service, medication, transport or claims permissions.
begin;
set local lock_timeout = '5s';

insert into public.permissions(permission_key,description,risk_level)
values('clients.jubo_pending_source.read',
  'Read only reviewed JUBO source and mapped profile for pending clients in the director exact branch',2)
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011'::uuid,p.id
from public.permissions p where p.permission_key='clients.jubo_pending_source.read'
on conflict do nothing;

create function private.require_jubo_pending_director_source_scope(p_org uuid,p_branch uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if auth.uid() is null or p_org is null or p_branch is null or not exists(
    select 1 from private.routine_staff_scope() scope
    join public.roles role on role.id=scope.role_id and role.is_system
      and role.role_key='branch_director' and role.is_active
    join public.role_permissions grant_row on grant_row.role_id=role.id
      and grant_row.granted_at<=clock_timestamp()
    join public.permissions permission on permission.id=grant_row.permission_id
      and permission.permission_key='clients.jubo_pending_source.read'
    join public.branches branch on branch.id=p_branch
      and branch.organization_id=p_org and branch.is_active
    join public.organizations organization on organization.id=p_org and organization.is_active
    where scope.organization_id=p_org and scope.branch_id=p_branch
      and exists(select 1 from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id
        where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
          and p.permission_key='clients.read')
      and exists(select 1 from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id
        where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
          and p.permission_key='clients.view_all')
  ) then
    raise exception using errcode='42501',message='JUBO_DIRECTOR_SOURCE_ACCESS_DENIED';
  end if;
end;
$$;

create function private.jubo_pending_director_directory(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_total integer; v_rows jsonb;
begin
  perform private.require_jubo_pending_director_source_scope(p_org,p_branch);
  select count(*)::integer into v_total
  from public.clients client
  join private.jubo_public_pending_links link on link.client_id=client.id
    and link.organization_id=client.organization_id and link.branch_id=client.branch_id
  join private.jubo_intake_profile_sources source_link on source_link.client_id=client.id
    and source_link.organization_id=client.organization_id
    and source_link.branch_id=client.branch_id
  where client.organization_id=p_org and client.branch_id=p_branch
    and client.status='pending' and client.source_system='jubo'
    and client.admitted_on is null and client.ended_on is null;
  if v_total>500 then
    raise exception using errcode='54000',message='JUBO_DIRECTOR_DIRECTORY_TOO_LARGE';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('clientId',row.id,
    'displayName',row.display_name,'clientCode',row.client_code,
    'sourceStatus',row.source_status) order by row.display_name,row.id),'[]'::jsonb)
    into v_rows
  from (
    select client.id,client.display_name,client.client_code,pending.source_status
    from public.clients client
    join private.jubo_public_pending_links link on link.client_id=client.id
      and link.organization_id=client.organization_id and link.branch_id=client.branch_id
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
      and pending.organization_id=client.organization_id and pending.branch_id=client.branch_id
    join private.jubo_intake_profile_sources source_link on source_link.client_id=client.id
      and source_link.organization_id=client.organization_id
      and source_link.branch_id=client.branch_id
    where client.organization_id=p_org and client.branch_id=p_branch
      and client.status='pending' and client.source_system='jubo'
      and client.admitted_on is null and client.ended_on is null
    order by client.display_name,client.id
    limit 500
  ) row;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,
    action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.jubo_intake_profile_sources',
    p_branch::text,'{}'::text[],jsonb_build_object('projection','pending_director_directory_v1',
      'resultCount',v_total));
  return jsonb_build_object('clients',v_rows,'total',v_total);
end;
$$;

create function private.jubo_pending_director_source_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_source_id uuid; v_source private.jubo_source_rows%rowtype;
  v_pending private.jubo_pending_master_rows%rowtype;
  v_profile_source private.jubo_intake_profile_sources%rowtype;
  v_profile private.client_intake_versions%rowtype;
  v_review private.jubo_profile_mapping_v2_reviews%rowtype;
  v_fields jsonb; v_drafts jsonb;
begin
  perform private.require_jubo_pending_director_source_scope(p_org,p_branch);
  v_source_id:=private.require_jubo_pending_director_draft_scope(p_org,p_branch,p_client);
  select source.* into v_source from private.jubo_source_rows source
    where source.id=v_source_id and source.organization_id=p_org and source.branch_id=p_branch;
  select pending.* into v_pending from private.jubo_pending_master_rows pending
    where pending.source_row_id=v_source_id and pending.organization_id=p_org
      and pending.branch_id=p_branch;
  select source_link.* into v_profile_source from private.jubo_intake_profile_sources source_link
    where source_link.client_id=p_client and source_link.master_source_row_id=v_source_id
      and source_link.organization_id=p_org and source_link.branch_id=p_branch;
  select profile.* into v_profile from private.client_intake_versions profile
    where profile.id=v_profile_source.intake_version_id and profile.client_id=p_client
      and profile.organization_id=p_org and profile.branch_id=p_branch;
  select review.* into v_review from private.jubo_profile_mapping_v2_reviews review
    where review.pair_id=v_profile_source.pair_id and review.master_source_row_id=v_source_id
      and review.organization_id=p_org and review.branch_id=p_branch
    order by review.review_version desc limit 1;
  if v_source.id is null or v_pending.id is null or v_profile_source.id is null
    or v_profile.id is null or v_review.id is null
    or v_review.decision<>'approved'
    or v_source.row_sha256<>v_profile_source.master_source_row_sha256
    or v_source.row_sha256<>v_review.source_row_sha256
    or v_source.row_sha256<>encode(sha256(convert_to(v_source.raw_values::text,'UTF8')),'hex')
    or v_profile_source.profile_sha256<>encode(sha256(convert_to(v_profile.profile::text,'UTF8')),'hex')
    or v_profile_source.mapping_review_sha256<>v_review.mapping_review_sha256 then
    raise exception using errcode='42501',message='JUBO_DIRECTOR_SOURCE_UNAVAILABLE';
  end if;
  -- Identity is deliberately masked in this lower-privilege director view.
  -- The exact source remains private and immutable for a separate authorized
  -- identity-review workflow.
  v_fields:=jsonb_build_array(
    jsonb_build_object('key','displayName','label','姓名','original',v_source.raw_values->>2,
      'display',v_profile.profile->>'displayName'),
    jsonb_build_object('key','sex','label','性別','original',v_source.raw_values->>3,
      'display',v_profile.profile->>'sex'),
    jsonb_build_object('key','dateOfBirth','label','出生日期','original',v_source.raw_values->>23,
      'display',v_profile.profile->>'dateOfBirth'),
    jsonb_build_object('key','identityNumber','label','身分識別碼末四碼',
      'original',case when v_source.raw_values->>25 is null then null
        else '••••'||right(v_source.raw_values->>25,4) end,
      'display',case when v_profile.profile->>'identityNumber' is null then null
        else '••••'||right(v_profile.profile->>'identityNumber',4) end),
    jsonb_build_object('key','registeredAddress','label','戶籍地址',
      'original',v_source.raw_values->>32,'display',v_profile.profile->>'registeredAddress'),
    jsonb_build_object('key','residentialAddress','label','居住地址',
      'original',v_source.raw_values->>35,'display',v_profile.profile->>'residentialAddress'),
    jsonb_build_object('key','cmsLevel','label','CMS 等級',
      'original',v_source.raw_values->>48,'display',v_profile.profile->>'cmsLevel'),
    jsonb_build_object('key','disability','label','身障資料',
      'original',v_source.raw_values->>54,'display',v_profile.profile->>'disability'),
    jsonb_build_object('key','primaryContactName','label','主要聯絡人',
      'original',v_source.raw_values->>78,'display',v_profile.profile->'contacts'->0->>'name'),
    jsonb_build_object('key','primaryContactPhone','label','主要聯絡電話',
      'original',v_source.raw_values->>79,'display',v_profile.profile->'contacts'->0->>'phone'),
    jsonb_build_object('key','proxyName','label','代理人',
      'original',v_source.raw_values->>80,'display',
      (select contact->>'name' from jsonb_array_elements(v_profile.profile->'contacts') contact
       where contact->>'isPrimary'='false' limit 1)),
    jsonb_build_object('key','proxyPhone','label','代理人電話',
      'original',v_source.raw_values->>81,'display',
      (select contact->>'phone' from jsonb_array_elements(v_profile.profile->'contacts') contact
       where contact->>'isPrimary'='false' limit 1)));
  v_drafts:=private.jubo_pending_director_draft_workspace(p_org,p_branch,p_client);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,
    action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.jubo_source_rows',
    v_source.id::text,'{}'::text[],jsonb_build_object('projection','pending_director_source_v1',
      'clientId',p_client,'sourceRowId',v_source.id));
  return v_drafts||jsonb_build_object(
    'clientCode',v_profile.profile->>'clientCode',
    'displayName',v_profile.profile->>'displayName',
    'sourceStatus',v_pending.source_status,
    'sourceFirstServiceOn',v_pending.source_first_service_on,
    'profileVersion',v_profile.version,
    'humanReview',jsonb_build_object('decision',v_review.decision,
      'version',v_review.review_version,'reviewedAt',v_review.reviewed_at),
    'normalizationFieldIndices',v_profile_source.normalization_field_indices,
    'fields',v_fields,'formalOperationsAllowed',false);
end;
$$;

create function public.jubo_pending_director_directory(p_org uuid,p_branch uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_pending_director_directory(p_org,p_branch);
$$;
create function public.jubo_pending_director_source_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_pending_director_source_workspace(p_org,p_branch,p_client);
$$;

revoke all on function private.require_jubo_pending_director_source_scope(uuid,uuid),
  private.jubo_pending_director_directory(uuid,uuid),
  private.jubo_pending_director_source_workspace(uuid,uuid,uuid),
  public.jubo_pending_director_directory(uuid,uuid),
  public.jubo_pending_director_source_workspace(uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.jubo_pending_director_directory(uuid,uuid),
  private.jubo_pending_director_source_workspace(uuid,uuid,uuid),
  public.jubo_pending_director_directory(uuid,uuid),
  public.jubo_pending_director_source_workspace(uuid,uuid,uuid)
to authenticated;
commit;


-- Imported reviewed candidate: 20261009142000_jubo_pending_assessment_drafts_candidate.sql
-- Candidate only. Permit five existing append-only candidate assessments for
-- reviewed JUBO public pending clients. All other client-linked operations
-- remain blocked; the formal signing RPCs and rule publication stay disabled.
begin;
set local lock_timeout = '5s';

alter table public.spmsq_assessment_versions
  drop constraint spmsq_assessment_service_status_check,
  add constraint spmsq_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.gds_assessment_versions
  drop constraint gds_assessment_service_status_check,
  add constraint gds_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.fall_risk_assessment_versions
  drop constraint fall_risk_assessment_service_status_check,
  add constraint fall_risk_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.nsi_nutrition_screening_versions
  drop constraint nsi_nutrition_screening_service_status_check,
  add constraint nsi_nutrition_screening_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.chewing_assessment_versions
  drop constraint chewing_assessment_service_status_check,
  add constraint chewing_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));

-- Replace the broad pending-client deny trigger on only these five tables.
-- Its replacement keeps the same deny path for UPDATE/DELETE and for all
-- non-draft states. The original function and every other table's trigger
-- remain unchanged.
create function private.guard_jubo_pending_assessment_draft() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_client public.clients%rowtype; v_client_id uuid;
begin
  if tg_op='DELETE' then v_client_id:=old.client_id;
  else v_client_id:=new.client_id; end if;
  select * into v_client from public.clients where id=v_client_id;
  if v_client.id is not null and v_client.status='pending' then
    if tg_op='INSERT' and tg_table_schema='public' and tg_table_name=any(array[
      'spmsq_assessment_versions','gds_assessment_versions',
      'fall_risk_assessment_versions','nsi_nutrition_screening_versions',
      'chewing_assessment_versions'])
      and v_client.source_system='jubo'
      and v_client.admitted_on is null and v_client.ended_on is null
      and new.organization_id=v_client.organization_id
      and new.branch_id=v_client.branch_id
      and new.record_state='draft_preview'
      and new.governance_status='candidate_unactivated'
      and new.service_status_at_assessment='pending'
      and new.author_user_id=auth.uid()
      and exists(select 1 from private.jubo_public_pending_links link
        join private.jubo_intake_profile_sources source_profile
          on source_profile.promotion_link_id=link.id
        where link.client_id=v_client.id
          and link.organization_id=v_client.organization_id
          and link.branch_id=v_client.branch_id) then
      return new;
    end if;
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='UPDATE' and old.client_id is distinct from new.client_id
    and exists(select 1 from public.clients previous_client
      where previous_client.id=old.client_id and previous_client.status='pending') then
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
alter function private.guard_jubo_pending_assessment_draft() owner to postgres;
revoke all on function private.guard_jubo_pending_assessment_draft()
  from public,anon,authenticated,service_role;

do $drafts$ declare v_table text; begin
  foreach v_table in array array[
    'spmsq_assessment_versions','gds_assessment_versions',
    'fall_risk_assessment_versions','nsi_nutrition_screening_versions',
    'chewing_assessment_versions'] loop
    execute format('drop trigger jubo_pending_client_no_activity on public.%I',v_table);
    execute format('create trigger jubo_pending_client_no_activity before insert or update or delete on public.%I for each row execute function private.guard_jubo_pending_assessment_draft()',v_table);
  end loop;
end $drafts$;
comment on function private.guard_jubo_pending_assessment_draft() is
  'Candidate-only exact five-table draft_preview exception for reviewed JUBO pending clients; no signed or operational records.';
commit;


-- Imported reviewed candidate: 20261009150000_jubo_transport_passenger_scope_guard.sql
-- Transport passengers are JSON snapshots without a client foreign key. In
-- addition to the existing pending-intake restriction, reject every missing or
-- foreign-scope client before a privileged writer can persist a draft.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.reject_pending_jubo_transport_plan_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The table constraint handles non-arrays. A valid array must refer only to
  -- real clients in this exact organization and branch, regardless of status.
  if jsonb_typeof(new.passenger_snapshot) is distinct from 'array' then
    return new;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.passenger_snapshot) passenger(value)
    left join public.clients client on client.id = case
      when coalesce(passenger.value->>'client_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (passenger.value->>'client_id')::uuid
      else null::uuid end
    where jsonb_typeof(passenger.value) is distinct from 'object'
      or client.id is null
      or client.organization_id is distinct from new.organization_id
      or client.branch_id is distinct from new.branch_id
  ) then
    raise exception using errcode = '23514',
      message = 'TRANSPORT_PASSENGER_SCOPE_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.passenger_snapshot) passenger(value)
    join public.clients client on client.id = case
      when coalesce(passenger.value->>'client_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (passenger.value->>'client_id')::uuid
      else null::uuid end
    where client.organization_id = new.organization_id
      and client.branch_id = new.branch_id
      and client.source_system = 'jubo'
      and client.status = 'pending'
  ) then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_pending_jubo_transport_plan_insert()
  from public, anon, authenticated, service_role;
commit;


-- Imported reviewed candidate: 20261009150001_jubo_candidate_foreign_key_indexes.sql
-- Candidate-only JUBO records: index the referencing side of newly added
-- foreign keys. Keep the existing pair-leading review index for pair lookups;
-- the source-leading index below serves source-row FK checks and covers the
-- organization/branch columns counted by the foundation schema contract.
begin;
set local lock_timeout = '5s';

create index jubo_pending_admission_proposals_link_fk_idx
  on private.jubo_pending_admission_proposals
  (pending_link_id, organization_id, branch_id, client_id);

create index jubo_pending_director_drafts_source_fk_idx
  on private.jubo_pending_director_draft_revisions
  (source_row_id, organization_id, branch_id);

create index jubo_pending_director_drafts_link_fk_idx
  on private.jubo_pending_director_draft_revisions (pending_link_id);

create index jubo_profile_v2_previews_reauth_fk_idx
  on private.jubo_profile_mapping_v2_previews (reauth_challenge_id);

create index jubo_profile_v2_reviews_source_fk_idx
  on private.jubo_profile_mapping_v2_reviews
  (master_source_row_id, organization_id, branch_id);

commit;
