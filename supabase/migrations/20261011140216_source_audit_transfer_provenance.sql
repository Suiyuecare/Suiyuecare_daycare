begin;
-- Preserve original audit bytes/IDs while the target retains its existing
-- deployment audit chain. No employee, browser, or service-role writes.
create table private.source_audit_transfer_provenance (
  source_project text not null check(source_project ~ '^[a-z]{20}$'),
  source_audit_id bigint not null,
  organization_id uuid,
  branch_id uuid,
  target_audit_id bigint not null references public.audit_events(id),
  original_record jsonb not null check(jsonb_typeof(original_record)='object'),
  original_sha256 text not null check(original_sha256 ~ '^[0-9a-f]{64}$'),
  transferred_at timestamptz not null default clock_timestamp(),
  primary key(source_project,source_audit_id),
  unique(target_audit_id)
);
alter table private.source_audit_transfer_provenance enable row level security;
alter table private.source_audit_transfer_provenance force row level security;
revoke all on private.source_audit_transfer_provenance from public,anon,authenticated,service_role;
create function private.prevent_source_audit_transfer_change() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'SOURCE_AUDIT_PROVENANCE_IMMUTABLE' using errcode='42501';end;$$;
create trigger source_audit_transfer_immutable before update or delete on private.source_audit_transfer_provenance
for each row execute function private.prevent_source_audit_transfer_change();
revoke all on function private.prevent_source_audit_transfer_change() from public,anon,authenticated,service_role;
commit;
