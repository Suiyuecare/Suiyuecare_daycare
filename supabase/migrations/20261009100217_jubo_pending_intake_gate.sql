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
