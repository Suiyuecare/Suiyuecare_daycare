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
  unique (organization_id,identity_sha256)
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

commit;
