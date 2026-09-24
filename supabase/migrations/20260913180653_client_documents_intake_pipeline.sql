begin;
set local lock_timeout = '5s';
-- Storage-owned schemas are never recreated. Local compatibility tests supply a fixture.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $bucket$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('client-intake-documents','client-intake-documents',false,4194304,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing$bucket$;
  if exists(select 1 from storage.buckets where id='client-intake-documents' and public) then raise exception 'client intake bucket must be private'; end if;
  -- Restrictive policies protect this bucket even if unrelated legacy policies are permissive.
  execute $policy$create policy client_intake_documents_browser_block on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'client-intake-documents') with check(bucket_id<>'client-intake-documents')$policy$;
 end if;
end $$;
create table private.client_document_versions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,client_id uuid not null,
 category text not null check(category in ('identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam')),
 version integer not null check(version>0),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),file_size_bytes integer not null check(file_size_bytes between 1 and 4194304),
 object_path text not null unique,created_by uuid not null references public.profiles(id) on delete restrict,
 document_label text,provider text,document_date date,valid_until date,period_from date,period_to date,
 check(document_label is null or char_length(document_label) between 1 and 120),check(provider is null or char_length(provider) between 1 and 120),
 check(valid_until is null or document_date is null or valid_until>=document_date),check((period_from is null)=(period_to is null)),check(period_to is null or period_to>=period_from),
 created_at timestamptz not null default now(),idempotency_key uuid not null,input_hash text not null,
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(client_id,category,version),unique(organization_id,created_by,idempotency_key)
);
create index client_document_scope_idx on private.client_document_versions(organization_id,branch_id,client_id,category,version desc);
create index client_document_client_idx on private.client_document_versions(client_id,organization_id,branch_id);
create index client_document_actor_idx on private.client_document_versions(created_by);
create table private.client_document_scan_results(
 document_id uuid primary key references private.client_document_versions(id) on delete restrict,
 verdict text not null check(verdict in ('clean','infected','failed')),scanner text not null check(scanner~'^[a-zA-Z0-9._-]{3,80}$'),scanned_at timestamptz not null default now()
);
create table private.client_document_review_versions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,client_id uuid not null,
 category text not null check(category in ('identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam')),
 document_version integer not null check(document_version>=0),version integer not null check(version>0),
 decision text not null check(decision in ('reviewed','needs_replacement','not_applicable')),reason text not null check(char_length(reason) between 3 and 300),
 reviewed_by uuid not null references public.profiles(id) on delete restrict,reviewed_at timestamptz not null default now(),
 idempotency_key uuid not null,input_hash text not null,
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(client_id,category,version),unique(organization_id,reviewed_by,idempotency_key)
);
create index client_document_review_scope_idx on private.client_document_review_versions(organization_id,branch_id,client_id,category,version desc);
create index client_document_review_client_idx on private.client_document_review_versions(client_id,organization_id,branch_id);
create index client_document_reviewer_idx on private.client_document_review_versions(reviewed_by);
alter table private.client_document_versions enable row level security; alter table private.client_document_versions force row level security;
alter table private.client_document_scan_results enable row level security; alter table private.client_document_scan_results force row level security;
alter table private.client_document_review_versions enable row level security; alter table private.client_document_review_versions force row level security;
revoke all on private.client_document_versions,private.client_document_scan_results,private.client_document_review_versions from public,anon,authenticated,service_role;
create function private.client_documents_immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception using errcode='55000',message='document evidence is append only'; end; $$;
create trigger client_document_versions_immutable before update or delete on private.client_document_versions for each row execute function private.client_documents_immutable();
create trigger client_document_scan_results_immutable before update or delete on private.client_document_scan_results for each row execute function private.client_documents_immutable();
create trigger client_document_reviews_immutable before update or delete on private.client_document_review_versions for each row execute function private.client_documents_immutable();
create function private.client_document_permission(p_category text,p_write boolean) returns text language sql immutable set search_path='' as $$
 select case when p_category in ('identity_front','identity_back') then 'clients.manage' when p_category='health_exam' then case when p_write then 'health.write' else 'health.read' end when p_category in ('medication_bag','medication_plan','medication_history') then case when p_write then 'medications.manage' else 'medications.read' end end;
$$;
create function private.client_document_access(p_client uuid,p_category text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.care_roster_can_read(p_client,'clients.read')
 -- Identity images contain the complete demographic record, not only a label.
 -- Never let clients.manage alone bypass a revoked sensitive field grant.
 and (p_category not in ('identity_front','identity_back') or private.care_roster_can_read(p_client,'clients.demographics.read'))
 and case when p_write then
 private.can_staff_access_client(p_client,private.client_document_permission(p_category,true)) and private.has_recent_aal2(15)
 else private.care_roster_can_read(p_client,private.client_document_permission(p_category,false)) end;
$$;
create function private.reserve_client_document_guarded(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_client uuid;v_category text;v_key uuid;v_expected integer;v_hash text;v_prior private.client_document_versions;v_latest private.client_document_versions;v_id uuid:=gen_random_uuid();v_path text;v_field text;v_terminal jsonb;
begin
 if auth.uid() is null or not private.has_recent_aal2(15) then raise exception using errcode='42501',message='document reservation denied'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&array['clientId','category','expectedDocumentVersion','idempotency_key','sha256','mimeType','fileSizeBytes'])
 or p_input-array['clientId','category','expectedDocumentVersion','idempotency_key','sha256','mimeType','fileSizeBytes','documentLabel','provider','documentDate','validUntil','periodFrom','periodTo']<>'{}'::jsonb
 or jsonb_typeof(p_input->'clientId') is distinct from 'string' or jsonb_typeof(p_input->'category') is distinct from 'string'
 or jsonb_typeof(p_input->'expectedDocumentVersion') is distinct from 'number' or (p_input->>'expectedDocumentVersion')!~'^[0-9]{1,7}$'
 or jsonb_typeof(p_input->'fileSizeBytes') is distinct from 'number' or (p_input->>'fileSizeBytes')!~'^[0-9]{1,7}$'
 or jsonb_typeof(p_input->'sha256') is distinct from 'string' or (p_input->>'sha256')!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string' or jsonb_typeof(p_input->'mimeType') is distinct from 'string'
 or p_input->>'mimeType' not in ('application/pdf','image/jpeg','image/png') or (p_input->>'fileSizeBytes')::integer not between 1 and 4194304
 then raise exception using errcode='22023',message='invalid document metadata'; end if;
 foreach v_field in array array['documentLabel','provider'] loop
  if p_input?v_field and p_input->v_field<>'null'::jsonb and (jsonb_typeof(p_input->v_field)<>'string' or char_length(btrim(p_input->>v_field)) not between 1 and 120 or (p_input->>v_field)~'[[:cntrl:]]') then raise exception using errcode='22023',message='invalid document descriptive metadata';end if;
 end loop;
 foreach v_field in array array['documentDate','validUntil','periodFrom','periodTo'] loop
  if p_input?v_field and p_input->v_field<>'null'::jsonb then
   if jsonb_typeof(p_input->v_field)<>'string' or (p_input->>v_field)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char((p_input->>v_field)::date,'YYYY-MM-DD')<>p_input->>v_field then raise exception using errcode='22023',message='invalid document date';end if;
  end if;
 end loop;
 if ((p_input->>'periodFrom') is null)<>((p_input->>'periodTo') is null) or (p_input->>'periodFrom')>(p_input->>'periodTo') or (p_input->>'documentDate')>(p_input->>'validUntil') then raise exception using errcode='22023',message='invalid document period';end if;
 v_client:=(p_input->>'clientId')::uuid;v_category:=p_input->>'category';v_key:=(p_input->>'idempotency_key')::uuid;v_expected:=(p_input->>'expectedDocumentVersion')::integer;
 if not exists(select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active where c.id=v_client and c.organization_id=p_org and c.branch_id=p_branch)
 or not private.client_document_access(v_client,v_category,true) then raise exception using errcode='42501',message='document category outside authorized client scope'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||auth.uid()::text||v_key::text,0));
 select * into v_prior from private.client_document_versions where organization_id=p_org and created_by=auth.uid() and idempotency_key=v_key;
 if found then
  if v_prior.input_hash<>v_hash then raise exception using errcode='23505',message='document operation key conflict';end if;
  select jsonb_build_object('id',v_prior.id,'clientId',v_prior.client_id,'category',v_prior.category,'version',v_prior.version,'scanStatus',s.verdict,'persisted',true) into v_terminal from private.client_document_scan_results s where s.document_id=v_prior.id;
  return query select jsonb_build_object('id',v_prior.id,'clientId',v_prior.client_id,'category',v_prior.category,'version',v_prior.version,'sha256',v_prior.sha256,'objectPath',v_prior.object_path,'replayed',true,'terminalReceipt',v_terminal);return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('client-document:'||v_client::text||v_category,0));
 select * into v_latest from private.client_document_versions where client_id=v_client and category=v_category order by version desc limit 1;
 if coalesce(v_latest.version,0)<>v_expected then raise exception using errcode='40001',message='document version changed';end if;
 if v_latest.sha256=p_input->>'sha256' and exists(select 1 from private.client_document_scan_results s where s.document_id=v_latest.id and s.verdict='clean') then raise exception using errcode='23505',message='same attachment already present';end if;
 v_path:=p_org::text||'/'||v_client::text||'/'||v_id::text;
 insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash,document_label,provider,document_date,valid_until,period_from,period_to)
 values(v_id,p_org,p_branch,v_client,v_category,v_expected+1,p_input->>'sha256',p_input->>'mimeType',(p_input->>'fileSizeBytes')::integer,v_path,auth.uid(),v_key,v_hash,p_input->>'documentLabel',p_input->>'provider',(p_input->>'documentDate')::date,(p_input->>'validUntil')::date,(p_input->>'periodFrom')::date,(p_input->>'periodTo')::date);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata) values(p_org,p_branch,auth.uid(),'insert','client_document_versions',v_id::text,array['version'],jsonb_build_object('category',v_category,'version',v_expected+1));
 return query select jsonb_build_object('id',v_id,'clientId',v_client,'category',v_category,'version',v_expected+1,'sha256',p_input->>'sha256','objectPath',v_path,'replayed',false);
end;$$;
create function private.complete_client_document_guarded(p_document uuid,p_sha256 text,p_verdict text,p_scanner text) returns table(receipt jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_d private.client_document_versions;v_result private.client_document_scan_results;v_exists boolean;
begin
 if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='server scanner registration only';end if;
 if p_verdict is null or p_verdict not in ('clean','infected','failed') or p_scanner is null or p_scanner!~'^[a-zA-Z0-9._-]{3,80}$' then raise exception using errcode='22023',message='invalid scan verdict';end if;
 perform pg_advisory_xact_lock(hashtextextended('document-scan:'||p_document::text,0));
 select * into v_d from private.client_document_versions where id=p_document;
 if not found or v_d.sha256 is distinct from p_sha256 then raise exception using errcode='42501',message='scan reservation mismatch';end if;
 select * into v_result from private.client_document_scan_results where document_id=p_document;
 if found then
  if v_result.verdict<>p_verdict or v_result.scanner<>p_scanner then raise exception using errcode='23505',message='scan evidence conflict';end if;
 else
  if v_d.created_at<now()-interval '15 minutes' or to_regclass('storage.objects') is null then raise exception using errcode='55000',message='reserved upload expired or storage unavailable';end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into v_exists using 'client-intake-documents',v_d.object_path;
  if not v_exists then raise exception using errcode='55000',message='stored object not confirmed';end if;
  insert into private.client_document_scan_results values(p_document,p_verdict,p_scanner,now());
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata) values(v_d.organization_id,v_d.branch_id,v_d.created_by,'insert','client_document_scan_results',p_document::text,array['scan_status'],jsonb_build_object('scan_status',p_verdict));
 end if;
 return query select jsonb_build_object('id',v_d.id,'clientId',v_d.client_id,'category',v_d.category,'version',v_d.version,'scanStatus',p_verdict,'persisted',true);
end;$$;
create function private.review_client_document_guarded(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_client uuid;v_category text;v_key uuid;v_expected integer;v_document integer;v_latest private.client_document_versions;v_prior private.client_document_review_versions;v_version integer;v_hash text;
begin
 if auth.uid() is null or not private.has_recent_aal2(15) then raise exception using errcode='42501',message='document review denied';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&array['clientId','category','expectedDocumentVersion','expectedReviewVersion','decision','reason','idempotency_key'])
 or p_input-array['clientId','category','expectedDocumentVersion','expectedReviewVersion','decision','reason','idempotency_key']<>'{}'::jsonb
 or jsonb_typeof(p_input->'clientId') is distinct from 'string' or jsonb_typeof(p_input->'category') is distinct from 'string' or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string'
 or jsonb_typeof(p_input->'expectedDocumentVersion') is distinct from 'number' or (p_input->>'expectedDocumentVersion')!~'^[0-9]{1,7}$'
 or jsonb_typeof(p_input->'expectedReviewVersion') is distinct from 'number' or (p_input->>'expectedReviewVersion')!~'^[0-9]{1,7}$'
 or jsonb_typeof(p_input->'decision') is distinct from 'string' or p_input->>'decision' not in ('reviewed','needs_replacement','not_applicable')
 or jsonb_typeof(p_input->'reason') is distinct from 'string' or char_length(btrim(p_input->>'reason')) not between 3 and 300 or (p_input->>'reason')~'[[:cntrl:]]'
 then raise exception using errcode='22023',message='invalid document review';end if;
 v_client:=(p_input->>'clientId')::uuid;v_category:=p_input->>'category';v_key:=(p_input->>'idempotency_key')::uuid;v_expected:=(p_input->>'expectedReviewVersion')::integer;v_document:=(p_input->>'expectedDocumentVersion')::integer;
 if not exists(select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active where c.id=v_client and c.organization_id=p_org and c.branch_id=p_branch)
 or not private.client_document_access(v_client,v_category,true) then raise exception using errcode='42501',message='document review outside client scope';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('document-review:'||p_org::text||auth.uid()::text||v_key::text,0));
 select * into v_prior from private.client_document_review_versions where organization_id=p_org and reviewed_by=auth.uid() and idempotency_key=v_key;
 if found then
  if v_prior.input_hash<>v_hash then raise exception using errcode='23505',message='document review key conflict';end if;
  return query select jsonb_build_object('clientId',v_client,'category',v_category,'reviewVersion',v_prior.version,'decision',v_prior.decision,'persisted',true,'replayed',true);return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('client-document:'||v_client::text||v_category,0));
 select * into v_latest from private.client_document_versions where client_id=v_client and category=v_category order by version desc limit 1;
 select coalesce(max(version),0) into v_version from private.client_document_review_versions where client_id=v_client and category=v_category;
 if v_version<>v_expected or coalesce(v_latest.version,0)<>v_document then raise exception using errcode='40001',message='document review base changed';end if;
 if p_input->>'decision'<>'not_applicable' and not exists(select 1 from private.client_document_scan_results where document_id=v_latest.id and verdict='clean') then raise exception using errcode='22023',message='clean document required for review';end if;
 insert into private.client_document_review_versions(organization_id,branch_id,client_id,category,document_version,version,decision,reason,reviewed_by,idempotency_key,input_hash) values(p_org,p_branch,v_client,v_category,v_document,v_version+1,p_input->>'decision',btrim(p_input->>'reason'),auth.uid(),v_key,v_hash);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata) values(p_org,p_branch,auth.uid(),'insert','client_document_review_versions',v_client::text,array['review_version'],jsonb_build_object('category',v_category,'version',v_version+1,'decision',p_input->>'decision'));
 return query select jsonb_build_object('clientId',v_client,'category',v_category,'reviewVersion',v_version+1,'decision',p_input->>'decision','persisted',true,'replayed',false);
end;$$;
create function private.client_documents_snapshot_guarded(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_category text;v_d private.client_document_versions;v_r private.client_document_review_versions;v_scan text;v_status text;v_access boolean;v_manage boolean;v_rows jsonb:='[]';v_history jsonb;v_history_count integer;
begin
 if auth.uid() is null or not exists(select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch) or not private.care_roster_can_read(p_client,'clients.read') then raise exception using errcode='42501',message='client documents snapshot denied';end if;
 foreach v_category in array array['identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam'] loop
  v_access:=private.client_document_access(p_client,v_category,false);v_manage:=v_access and private.client_document_access(p_client,v_category,true);
  v_d:=null;v_r:=null;v_scan:=null;v_status:='restricted';
  if v_access then
   select * into v_d from private.client_document_versions where client_id=p_client and category=v_category order by version desc limit 1;
   select * into v_r from private.client_document_review_versions where client_id=p_client and category=v_category order by version desc limit 1;
   select verdict into v_scan from private.client_document_scan_results where document_id=v_d.id;
   v_status:=case when v_d.id is null then 'missing' when v_scan is null then 'scanning' when v_scan='clean' then 'needs_review' else 'needs_replacement' end;
   if v_r.id is not null and v_r.document_version=coalesce(v_d.version,0) and (v_r.decision='not_applicable' or v_scan='clean') then v_status:=v_r.decision;end if;
  end if;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('category',v_category,'accessible',v_access,'canManage',v_manage,'documentId',v_d.id,'documentVersion',coalesce(v_d.version,0),'reviewVersion',coalesce(v_r.version,0),'status',v_status,'scanStatus',case when v_d.id is null then null else coalesce(v_scan,'reserved') end,'canDownload',coalesce(v_access and v_scan='clean',false),'mimeType',v_d.mime_type,'fileSizeBytes',v_d.file_size_bytes,'reservedAt',v_d.created_at,'reviewReason',v_r.reason));
 end loop;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata) values(p_org,p_branch,auth.uid(),'select','client_documents_snapshot',p_client::text,array['bounded_snapshot'],'{"category_count":6}');
 select count(*) into v_history_count from private.client_document_versions d where d.client_id=p_client and private.client_document_access(p_client,d.category,false);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'category',d.category,'version',d.version,'scanStatus',coalesce(s.verdict,'reserved'),'documentLabel',d.document_label,'provider',d.provider,'documentDate',d.document_date,'validUntil',d.valid_until,'periodFrom',d.period_from,'periodTo',d.period_to) order by d.created_at desc,d.id),'[]') into v_history
 from (select * from private.client_document_versions where client_id=p_client and private.client_document_access(p_client,category,false) order by created_at desc,id limit 200)d left join private.client_document_scan_results s on s.document_id=d.id;
 return query select jsonb_build_object('clientId',p_client,'generatedAt',now(),'rows',v_rows,'history',v_history,'historyTruncated',v_history_count>200);
end;$$;
create function private.prepare_client_document_download_guarded(p_org uuid,p_branch uuid,p_client uuid,p_document uuid) returns table(payload jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_d private.client_document_versions;
begin
 select * into v_d from private.client_document_versions where id=p_document and client_id=p_client and organization_id=p_org and branch_id=p_branch;
 if not found or auth.uid() is null or not private.has_recent_aal2(15) or not private.client_document_access(p_client,v_d.category,false)
 or not exists(select 1 from public.branches where id=p_branch and organization_id=p_org and is_active)
 or not exists(select 1 from private.client_document_scan_results where document_id=p_document and verdict='clean') then raise exception using errcode='42501',message='document download denied';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata) values(p_org,p_branch,auth.uid(),'select','client_document_download',p_document::text,array['short_lived_download'],jsonb_build_object('version',v_d.version,'expires_seconds',60));
 return query select jsonb_build_object('id',v_d.id,'clientId',p_client,'category',v_d.category,'version',v_d.version,'objectPath',v_d.object_path,'mimeType',v_d.mime_type,'expiresSeconds',60);
end;$$;
create function public.reserve_client_document(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.reserve_client_document_guarded(p_org,p_branch,p_input);$$;
create function public.complete_client_document_scan(p_document uuid,p_sha256 text,p_verdict text,p_scanner text) returns table(receipt jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.complete_client_document_guarded(p_document,p_sha256,p_verdict,p_scanner);$$;
create function public.review_client_document(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.review_client_document_guarded(p_org,p_branch,p_input);$$;
create function public.client_documents_snapshot(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.client_documents_snapshot_guarded(p_org,p_branch,p_client);$$;
create function public.prepare_client_document_download(p_org uuid,p_branch uuid,p_client uuid,p_document uuid) returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.prepare_client_document_download_guarded(p_org,p_branch,p_client,p_document);$$;
revoke all on function private.client_documents_immutable(),private.client_document_permission(text,boolean),private.client_document_access(uuid,text,boolean),
 private.reserve_client_document_guarded(uuid,uuid,jsonb),private.complete_client_document_guarded(uuid,text,text,text),private.review_client_document_guarded(uuid,uuid,jsonb),private.client_documents_snapshot_guarded(uuid,uuid,uuid),private.prepare_client_document_download_guarded(uuid,uuid,uuid,uuid),
 public.reserve_client_document(uuid,uuid,jsonb),public.complete_client_document_scan(uuid,text,text,text),public.review_client_document(uuid,uuid,jsonb),public.client_documents_snapshot(uuid,uuid,uuid),public.prepare_client_document_download(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.reserve_client_document_guarded(uuid,uuid,jsonb),private.review_client_document_guarded(uuid,uuid,jsonb),private.client_documents_snapshot_guarded(uuid,uuid,uuid),private.prepare_client_document_download_guarded(uuid,uuid,uuid,uuid),
 public.reserve_client_document(uuid,uuid,jsonb),public.review_client_document(uuid,uuid,jsonb),public.client_documents_snapshot(uuid,uuid,uuid),public.prepare_client_document_download(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function private.complete_client_document_guarded(uuid,text,text,text),public.complete_client_document_scan(uuid,text,text,text) to service_role;
commit;
