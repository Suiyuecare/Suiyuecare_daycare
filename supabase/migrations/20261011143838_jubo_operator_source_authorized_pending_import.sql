
-- Explicit owner authorization is a data migration, never a fabricated Google
-- login, independent reviewer, formal admission, service record or clinical rule.
begin;
set local lock_timeout='5s';

create table private.jubo_operator_imports (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 branch_id uuid not null,
 operator_name name not null, operator_session_user name not null,
 execution_mode text not null check(execution_mode='database_operator'),
 authorization_reference text not null check(authorization_reference='direct-owner-authorization:20261011:23-master-17-reconcile'),
 idempotency_key uuid not null, request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 master_source bytea not null, monthly_source bytea not null,
 dataset jsonb not null check(jsonb_typeof(dataset)='object'),
 dataset_sha256 text not null check(dataset_sha256~'^[a-f0-9]{64}$'),
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 committed_at timestamptz not null default clock_timestamp(),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 unique(operator_name,idempotency_key),unique(organization_id,branch_id),unique(id,organization_id,branch_id),
 check(encode(sha256(master_source),'hex')='7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7'),
 check(encode(sha256(monthly_source),'hex')='aa1e02c2bc1029bc78d8f7e46c68f979fbdfa1d7010a5ec8e29818bc54854ff4'),
 check(dataset_sha256=encode(sha256(convert_to(dataset::text,'UTF8')),'hex')),
 check(dataset_sha256='21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da')
);
create table private.jubo_operator_master_links (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,branch_id uuid not null,operation_id uuid not null,client_id uuid not null unique,
 source_sheet_row integer not null check(source_sheet_row between 6 and 28),
 monthly_source_sheet_row integer check(monthly_source_sheet_row between 5 and 21),
 identity_sha256 text not null check(identity_sha256~'^[a-f0-9]{64}$'),
 source_row_sha256 text not null check(source_row_sha256~'^[a-f0-9]{64}$'),
 profile jsonb not null check(jsonb_typeof(profile)='object'),
 source_status text not null check(source_status in ('服務中','暫停服務','結案')),
 source_opened_on date,source_first_service_on date,source_closed_on date,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(operation_id,organization_id,branch_id) references private.jubo_operator_imports(id,organization_id,branch_id) on delete restrict,
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict deferrable initially deferred,
 unique(operation_id,source_sheet_row),unique(operation_id,monthly_source_sheet_row),unique(organization_id,identity_sha256)
);
create index jubo_operator_master_scope on private.jubo_operator_master_links(organization_id,branch_id,operation_id);
do $stores$ declare t text; begin
 foreach t in array array['jubo_operator_imports','jubo_operator_master_links'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
 end loop;
end $stores$;

-- Retain the existing reviewed-admission/promotion implementation verbatim.
-- One new path verifies an already inserted, exact source-bound master link.
-- A setting, postgres role, operation ID or matching name alone never suffices.
do $guard$ declare definition text; insert_at integer; begin
 definition:=pg_get_functiondef('private.guard_jubo_pending_client_insert()'::regprocedure);
 if position('JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION' in definition)=0 then
  raise exception 'unexpected pending client guard'; end if;
 insert_at:=position(E'begin\n' in definition);
 if insert_at=0 then raise exception 'unexpected pending guard body'; end if;
 definition:=overlay(definition placing E'begin\n'||$body$
  if tg_op='INSERT' and new.status='pending' and current_user='postgres'
     and nullif(current_setting('app.jubo_operator_import_id',true),'') is not null then
   if new.source_system<>'jubo' or new.admitted_on is not null or new.ended_on is not null
    or new.external_key is not null or new.national_id_ciphertext is not null or new.source_updated_at is not null
    or new.row_version<>1 or not exists(
     select 1 from private.jubo_operator_imports op join private.jubo_operator_master_links link
      on link.operation_id=op.id and link.organization_id=op.organization_id and link.branch_id=op.branch_id
     where op.id::text=current_setting('app.jubo_operator_import_id',true)
      and op.operator_name=current_user and op.execution_mode='database_operator'
      and op.authorization_reference='direct-owner-authorization:20261011:23-master-17-reconcile'
      and op.dataset_sha256='21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da'
      and link.client_id=new.id and link.organization_id=new.organization_id and link.branch_id=new.branch_id
      and link.profile->>'clientCode'=new.client_code and link.profile->>'displayName'=new.display_name
      and (link.profile->>'dateOfBirth')::date is not distinct from new.date_of_birth
   ) then raise exception using errcode='42501',message='JUBO_PENDING_CLIENT_REQUIRES_REVIEWED_OPERATION'; end if;
   return new;
  end if;
$body$ from insert_at for 6);
 execute definition;
end $guard$;

create function private.guard_jubo_operator_master_provenance() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare op private.jubo_operator_imports%rowtype; row_data jsonb; summary jsonb; raw_values jsonb;
 expected_profile jsonb; pending private.jubo_pending_master_rows%rowtype; identity text;
begin
 if current_user<>'postgres' or auth.uid() is not null or new.operation_id::text is distinct from current_setting('app.jubo_operator_import_id',true) then
  raise exception using errcode='42501',message='JUBO_OPERATOR_PROVENANCE_REQUIRED'; end if;
 select * into op from private.jubo_operator_imports where id=new.operation_id
  and organization_id=new.organization_id and branch_id=new.branch_id and operator_name=current_user
  and dataset_sha256='21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da';
 if not found then raise exception using errcode='42501',message='JUBO_OPERATOR_PROVENANCE_REQUIRED'; end if;
 select value into row_data from jsonb_array_elements(op.dataset->'master'->'rows') where (value->>'sheetRow')::integer=new.source_sheet_row;
 if row_data is null then raise exception using errcode='23514',message='JUBO_OPERATOR_LINK_SOURCE_MISMATCH'; end if;
 raw_values:=row_data->'rawValues';
 identity:=upper(replace(regexp_replace(coalesce(private.jubo_plan_text(raw_values,25),''),'[[:space:]-]','','g'),'－',''));
 pending.admitted_on:=null; pending.care_eligible:=false;
 pending.identity_sha256:=encode(sha256(convert_to(identity,'UTF8')),'hex');
 pending.display_name:=private.jubo_plan_text(raw_values,2); pending.date_of_birth:=private.jubo_source_date_iso(raw_values->>23);
 pending.sex:=private.jubo_source_sex(raw_values->>3);
 expected_profile:=private.jubo_profile_from_master(raw_values,pending,'JUBO-20261003-'||lpad(new.source_sheet_row::text,3,'0'));
 select value into summary from jsonb_array_elements(op.dataset->'monthly'->'rows')
  where upper(replace(regexp_replace(coalesce(private.jubo_plan_text(value->'rawValues',29),''),'[[:space:]-]','','g'),'－',''))=identity;
 if new.profile is distinct from expected_profile or new.identity_sha256<>pending.identity_sha256
  or new.source_row_sha256<>encode(sha256(convert_to(row_data::text,'UTF8')),'hex')
  or new.source_status is distinct from raw_values->>15
  or new.source_opened_on is distinct from private.jubo_source_date_iso(raw_values->>8)
  or new.source_first_service_on is distinct from private.jubo_source_date_iso(raw_values->>9)
  or new.source_closed_on is distinct from private.jubo_source_date_iso(raw_values->>11)
  or new.monthly_source_sheet_row is distinct from (case when summary is null then null else (summary->>'sheetRow')::integer end) then
  raise exception using errcode='23514',message='JUBO_OPERATOR_LINK_SOURCE_MISMATCH'; end if;
 return new;
end; $$;
revoke all on function private.guard_jubo_operator_master_provenance() from public,anon,authenticated,service_role;
create trigger jubo_operator_master_provenance before insert on private.jubo_operator_master_links
for each row execute function private.guard_jubo_operator_master_provenance();

create function private.import_jubo_operator_pending(p_org uuid,p_branch uuid,p_key uuid,p_authorization text,
 p_master bytea,p_monthly bytea,p_dataset jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare operation uuid; prior private.jubo_operator_imports%rowtype; dataset_sha text; request_sha text;
 row_data jsonb; raw_values jsonb; summary jsonb; client uuid; code text; identity text; identity_hash text;
 pending private.jubo_pending_master_rows%rowtype; profile jsonb; receipt jsonb;
 sheet_row integer; monthly_sheet_row integer; matched integer:=0; count_rows integer:=0;
begin
 if current_user<>'postgres' or auth.uid() is not null then
  raise exception using errcode='42501',message='JUBO_OPERATOR_ONLY'; end if;
 if p_org is null or p_branch is null or p_key is null
  or p_authorization is distinct from 'direct-owner-authorization:20261011:23-master-17-reconcile'
  or not exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and o.id=p_org and b.is_active and o.is_active) then
  raise exception using errcode='22023',message='JUBO_OPERATOR_SCOPE_OR_AUTHORIZATION_INVALID'; end if;
 if p_master is null or p_monthly is null or octet_length(p_master) not between 22 and 10485760
  or octet_length(p_monthly) not between 22 and 10485760
  or encode(sha256(p_master),'hex')<>'7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7'
  or encode(sha256(p_monthly),'hex')<>'aa1e02c2bc1029bc78d8f7e46c68f979fbdfa1d7010a5ec8e29818bc54854ff4' then
  raise exception using errcode='22023',message='JUBO_OPERATOR_SOURCE_BYTES_MISMATCH'; end if;
 if p_dataset is null or jsonb_typeof(p_dataset)<>'object' or octet_length(p_dataset::text)>4194304 then
  raise exception using errcode='22023',message='JUBO_OPERATOR_DATASET_INVALID'; end if;
 dataset_sha:=encode(sha256(convert_to(p_dataset::text,'UTF8')),'hex');
 -- This digest pins all original/normalized cells, types, headers and footer
 -- produced from the exact approved XLSX pair by the static reviewed parser.
 if dataset_sha<>'21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da' then
  raise exception using errcode='22023',message='JUBO_OPERATOR_DATASET_MISMATCH'; end if;
 if p_dataset->>'parserVersion'<>'jubo-xlsx-reader-202610-v1'
  or p_dataset->>'mappingVersion'<>'jubo-master-monthly-202610-v2'
  or jsonb_array_length(p_dataset->'master'->'rows')<>23
  or jsonb_array_length(p_dataset->'monthly'->'rows')<>17
  or jsonb_array_length(p_dataset->'master'->'columnLabels')<>95
  or jsonb_array_length(p_dataset->'monthly'->'columnLabels')<>191
  or jsonb_array_length(p_dataset->'nonRecordRows')<>1 then
  raise exception using errcode='22023',message='JUBO_OPERATOR_SOURCE_COUNTS_MISMATCH'; end if;
 request_sha:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,
  'authorization',p_authorization,'dataset',dataset_sha,'operator',current_user)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('jubo-operator:'||p_org,0));
 select * into prior from private.jubo_operator_imports where operator_name=current_user and idempotency_key=p_key;
 if found then
  if prior.request_sha256<>request_sha then raise exception using errcode='23505',message='JUBO_OPERATOR_IDEMPOTENCY_CONFLICT'; end if;
  return prior.receipt||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from private.jubo_operator_imports where organization_id=p_org and branch_id=p_branch) then
  raise exception using errcode='23505',message='JUBO_OPERATOR_PAIR_ALREADY_IMPORTED'; end if;
 if exists(select 1 from public.clients c where c.organization_id=p_org
  and not exists(select 1 from private.client_intake_identities i where i.client_id=c.id and i.organization_id=p_org)) then
  raise exception using errcode='23505',message='JUBO_EXISTING_CLIENT_IDENTITY_UNBOUND'; end if;
 operation:=gen_random_uuid();
 receipt:=jsonb_build_object('operationId',operation,'masterRows',23,'monthlyReferences',17,'publicPendingClients',23,
  'formalAdmissions',0,'attendanceRecords',0,'serviceRecords',0,'clinicalApprovals',0,
  'executionMode','database_operator','authorizationReference',p_authorization,'replayed',false);
 insert into private.jubo_operator_imports(id,organization_id,branch_id,operator_name,operator_session_user,
  execution_mode,authorization_reference,idempotency_key,request_sha256,master_source,monthly_source,dataset,dataset_sha256,receipt)
 values(operation,p_org,p_branch,current_user,session_user,'database_operator',p_authorization,p_key,
  request_sha,p_master,p_monthly,p_dataset,dataset_sha,receipt);
 perform set_config('app.jubo_operator_import_id',operation::text,true);
 for row_data in select value from jsonb_array_elements(p_dataset->'master'->'rows') order by (value->>'sheetRow')::integer loop
  raw_values:=row_data->'rawValues'; sheet_row:=(row_data->>'sheetRow')::integer;
  if jsonb_array_length(raw_values)<>95 or jsonb_array_length(row_data->'rawCellTypes')<>95
   or jsonb_array_length(row_data->'normalizedValues')<>95 or sheet_row<>6+count_rows then
   raise exception using errcode='22023',message='JUBO_OPERATOR_SOURCE_ROW_INVALID'; end if;
  identity:=upper(replace(regexp_replace(coalesce(private.jubo_plan_text(raw_values,25),''),'[[:space:]-]','','g'),'－',''));
  if identity !~ '^[A-Z][A-Z0-9]{7,19}$' then raise exception using errcode='22023',message='JUBO_OPERATOR_IDENTITY_INVALID'; end if;
  identity_hash:=encode(sha256(convert_to(identity,'UTF8')),'hex');
  if exists(select 1 from private.client_intake_identities i where i.organization_id=p_org and i.identity_sha256=identity_hash)
   or exists(select 1 from private.jubo_pending_master_rows p where p.organization_id=p_org and p.identity_sha256=identity_hash) then
   raise exception using errcode='23505',message='JUBO_PENDING_IDENTITY_COLLISION'; end if;
  select value into summary from jsonb_array_elements(p_dataset->'monthly'->'rows')
   where upper(replace(regexp_replace(coalesce(private.jubo_plan_text(value->'rawValues',29),''),'[[:space:]-]','','g'),'－',''))=identity;
  monthly_sheet_row:=case when summary is null then null else (summary->>'sheetRow')::integer end;
  if raw_values->>15='服務中' then
   if summary is null or summary->'rawValues'->>3<>'服務中'
    or private.jubo_plan_text(raw_values,2) is distinct from private.jubo_plan_text(summary->'rawValues',7)
    or private.jubo_source_date_iso(raw_values->>23) is distinct from private.jubo_source_date_iso(summary->'rawValues'->>9)
    or private.jubo_source_sex(raw_values->>3) is distinct from private.jubo_source_sex(summary->'rawValues'->>8) then
    raise exception using errcode='22023',message='JUBO_OPERATOR_MONTHLY_RECONCILIATION_FAILED'; end if;
   matched:=matched+1;
  elsif summary is not null then raise exception using errcode='22023',message='JUBO_OPERATOR_MONTHLY_RECONCILIATION_FAILED'; end if;
  pending.admitted_on:=null; pending.care_eligible:=false; pending.identity_sha256:=identity_hash;
  pending.display_name:=private.jubo_plan_text(raw_values,2);
  pending.date_of_birth:=private.jubo_source_date_iso(raw_values->>23);
  pending.sex:=private.jubo_source_sex(raw_values->>3);
  client:=gen_random_uuid(); code:='JUBO-20261003-'||lpad(sheet_row::text,3,'0');
  profile:=private.jubo_profile_from_master(raw_values,pending,code);
  insert into private.jubo_operator_master_links(organization_id,branch_id,operation_id,client_id,source_sheet_row,
   monthly_source_sheet_row,identity_sha256,source_row_sha256,profile,source_status,
   source_opened_on,source_first_service_on,source_closed_on)
  values(p_org,p_branch,operation,client,sheet_row,monthly_sheet_row,identity_hash,
   encode(sha256(convert_to(row_data::text,'UTF8')),'hex'),profile,raw_values->>15,
   private.jubo_source_date_iso(raw_values->>8),private.jubo_source_date_iso(raw_values->>9),private.jubo_source_date_iso(raw_values->>11));
  insert into public.clients(id,organization_id,branch_id,client_code,display_name,date_of_birth,status,admitted_on,ended_on,source_system)
  values(client,p_org,p_branch,code,pending.display_name,pending.date_of_birth,'pending',null,null,'jubo');
  insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256)
  values(p_org,p_branch,client,identity_hash);
  count_rows:=count_rows+1;
 end loop;
 if count_rows<>23 or matched<>17 or (select count(*) from private.jubo_operator_master_links where operation_id=operation)<>23
  or (select count(*) from public.clients c join private.jubo_operator_master_links l on l.client_id=c.id
   where l.operation_id=operation and c.status='pending' and c.admitted_on is null and c.ended_on is null)<>23 then
  raise exception using errcode='40001',message='JUBO_OPERATOR_READBACK_MISMATCH'; end if;
 perform set_config('app.jubo_operator_import_id','',true);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,idempotency_key,metadata)
 values(p_org,p_branch,null,'integration','private.jubo_operator_imports',operation::text,p_key,
  jsonb_build_object('execution_mode','database_operator','operator',current_user,'authorization_reference',p_authorization,
   'master_rows',23,'monthly_references',17,'formal_admissions',0,'attendance_records',0));
 return receipt;
end; $$;
alter function private.import_jubo_operator_pending(uuid,uuid,uuid,text,bytea,bytea,jsonb) owner to postgres;
revoke all on function private.import_jubo_operator_pending(uuid,uuid,uuid,text,bytea,bytea,jsonb)
 from public,anon,authenticated,service_role;

-- Existing scoped/field-permission/Google admission checks run first. The
-- operator-sourced baseline is read-only provenance, not an authored version.
do $snapshot$ declare definition text; begin
 definition:=pg_get_functiondef('private.client_intake_snapshot(uuid,uuid,uuid)'::regprocedure);
 if position('coalesce(v.profile,jsonb_build_object(' in definition)=0 then
  raise exception 'unexpected intake snapshot definition'; end if;
 definition:=replace(definition,'coalesce(v.profile,jsonb_build_object(',
  'coalesce(v.profile,(select link.profile from private.jubo_operator_master_links link where link.client_id=c.id and link.organization_id=p_org and link.branch_id=p_branch),jsonb_build_object(');
 execute definition;
end $snapshot$;
comment on function private.import_jubo_operator_pending(uuid,uuid,uuid,text,bytea,bytea,jsonb) is
 'Postgres operator only, explicit owner source-data authorization. Creates exactly 23 pending basic profiles and reconciles 17 source rows. Never admits, signs, approves a formula or manufactures a Google identity.';
commit;
