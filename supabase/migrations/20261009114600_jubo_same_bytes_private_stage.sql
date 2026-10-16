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
