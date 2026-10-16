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
