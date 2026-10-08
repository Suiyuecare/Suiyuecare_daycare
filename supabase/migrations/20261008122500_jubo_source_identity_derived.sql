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
