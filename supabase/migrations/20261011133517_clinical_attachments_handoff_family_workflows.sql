
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function private.daycare_completion_audit(p_org uuid,p_branch uuid,p_action text,p_table text,p_id uuid,p_metadata jsonb) returns void language sql security definer set search_path='' as $$
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata) values(p_org,p_branch,auth.uid(),lower(p_action),p_table,p_id::text,p_metadata);
$$;
revoke all on function private.daycare_completion_audit(uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated,service_role;

-- Clinical files use the existing approved scanner, but are evidence attached
-- to an exact record version, rather than a replacement intake document.
create table private.clinical_attachments(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 source_kind text not null check(source_kind in ('care_diary','body_assessment','vaccination','inspection')),
 source_id uuid not null, source_version integer not null check(source_version>0),
 label text not null check(char_length(btrim(label)) between 1 and 120 and label!~'[[:cntrl:]]'),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 file_size_bytes integer not null check(file_size_bytes between 1 and 4194304),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 object_path text not null unique,created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 idempotency_key uuid not null,input_hash text not null,
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id),
 unique(organization_id,created_by,idempotency_key)
);
create table private.clinical_attachment_scans(
 attachment_id uuid primary key references private.clinical_attachments(id),verdict text not null check(verdict in ('clean','infected','failed')),
 scanner text not null,scanned_at timestamptz not null default clock_timestamp(),cancelled_by uuid references public.profiles(id),cancellation_key uuid,cancellation_hash text,
 unique(cancelled_by,cancellation_key),check((cancelled_by is null and cancellation_key is null and cancellation_hash is null) or(cancelled_by is not null and cancellation_key is not null and cancellation_hash~'^[a-f0-9]{64}$' and verdict='failed' and scanner='cancelled-upload'))
);
create table private.clinical_attachment_links(
 attachment_id uuid not null references private.clinical_attachments(id),source_kind text not null,source_id uuid not null,
 linked_at timestamptz not null default clock_timestamp(),primary key(attachment_id,source_kind,source_id)
);
create index clinical_attachments_scope_idx on private.clinical_attachments(organization_id,branch_id,client_id);
create index clinical_attachment_links_source_idx on private.clinical_attachment_links(source_kind,source_id);
alter table private.clinical_attachments enable row level security; alter table private.clinical_attachments force row level security;
alter table private.clinical_attachment_scans enable row level security; alter table private.clinical_attachment_scans force row level security;
alter table private.clinical_attachment_links enable row level security; alter table private.clinical_attachment_links force row level security;
revoke all on private.clinical_attachments,private.clinical_attachment_scans,private.clinical_attachment_links from public,anon,authenticated,service_role;
create trigger clinical_attachments_immutable before update or delete on private.clinical_attachments for each row execute function private.client_documents_immutable();
create trigger clinical_attachment_scans_immutable before update or delete on private.clinical_attachment_scans for each row execute function private.client_documents_immutable();
create trigger clinical_attachment_links_immutable before update or delete on private.clinical_attachment_links for each row execute function private.client_documents_immutable();

create function private.clinical_attachment_source(p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_source uuid,p_write boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_version integer;v_state text;v_current boolean;v_permission text;v_chain uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch)
 or not private.care_roster_can_read(p_client,'clients.read') then raise exception using errcode='42501',message='clinical file client denied';end if;
 if p_kind='care_diary' then
  v_permission:=case when p_write then 'care_records.write' else 'care_records.read' end;
  select record_key into v_chain from public.care_records where id=p_source and client_id=p_client and organization_id=p_org and branch_id=p_branch and category='staff/daily-care/care-diary';
  if p_write and v_chain is not null then perform pg_advisory_xact_lock(hashtextextended('diary-record:'||p_org||':'||v_chain,0));end if;
  select r.version,r.status::text,not exists(select 1 from public.care_records n where n.record_key=r.record_key and n.organization_id=r.organization_id and n.version>r.version)
   into v_version,v_state,v_current from public.care_records r where r.id=p_source and r.client_id=p_client and r.organization_id=p_org and r.branch_id=p_branch and r.category='staff/daily-care/care-diary';
 elsif p_kind='body_assessment' then
  v_permission:=case when p_write then 'body_assessments.manage' else 'body_assessments.read' end;
  select assessment_key into v_chain from public.body_assessment_versions where id=p_source and client_id=p_client and organization_id=p_org and branch_id=p_branch;
  if p_write and v_chain is not null then perform pg_advisory_xact_lock(hashtextextended('body-assessment-chain:'||p_org||':'||p_branch||':'||v_chain,0));end if;
  select r.version,r.record_state,not exists(select 1 from public.body_assessment_versions n where n.assessment_key=r.assessment_key and n.organization_id=r.organization_id and n.version>r.version)
   into v_version,v_state,v_current from public.body_assessment_versions r where r.id=p_source and r.client_id=p_client and r.organization_id=p_org and r.branch_id=p_branch;
 elsif p_kind='vaccination' then
  v_permission:=case when p_write then 'health.write' else 'health.read' end;
  select r.version,r.record_status,not exists(select 1 from public.client_vaccination_versions n where n.vaccination_key=r.vaccination_key and n.organization_id=r.organization_id and n.version>r.version)
   into v_version,v_state,v_current from public.client_vaccination_versions r where r.id=p_source and r.client_id=p_client and r.organization_id=p_org and r.branch_id=p_branch;
 elsif p_kind='inspection' then
  v_permission:=case when p_write then 'health.write' else 'health.read' end;
  select r.version,r.record_status,not exists(select 1 from public.client_inspection_report_versions n where n.report_key=r.report_key and n.organization_id=r.organization_id and n.version>r.version)
   into v_version,v_state,v_current from public.client_inspection_report_versions r where r.id=p_source and r.client_id=p_client and r.organization_id=p_org and r.branch_id=p_branch;
 end if;
 if v_version is null or not private.care_roster_can_read(p_client,v_permission) then raise exception using errcode='42501',message='clinical file source denied';end if;
 if p_write and (not v_current or case when p_kind in ('care_diary','body_assessment') then v_state<>'draft' else v_state<>'active' end) then
  raise exception using errcode='40001',message='clinical file source is frozen';end if;
 return jsonb_build_object('version',v_version,'state',v_state,'canUpload',v_current and case when p_kind in ('care_diary','body_assessment') then v_state='draft' else v_state='active' end);
end;$$;

create function private.clinical_attachments_snapshot(p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_source uuid)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_source jsonb;v_rows jsonb;
begin
 v_source:=private.clinical_attachment_source(p_org,p_branch,p_client,p_kind,p_source,false);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'mimeType',a.mime_type,'fileSizeBytes',a.file_size_bytes,
  'scanStatus',coalesce(s.verdict,'reserved'),'createdAt',a.created_at,'canDownload',coalesce(s.verdict='clean',false)) order by a.created_at),'[]'::jsonb)
 into v_rows from private.clinical_attachments a left join private.clinical_attachment_scans s on s.attachment_id=a.id
 where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client
 and ((a.source_kind=p_kind and a.source_id=p_source) or exists(select 1 from private.clinical_attachment_links l where l.attachment_id=a.id and l.source_kind=p_kind and l.source_id=p_source));
 if jsonb_array_length(v_rows)>100 then raise exception using errcode='54000',message='clinical file list exceeds bounded limit';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)values(p_org,p_branch,auth.uid(),'select','clinical_attachments',p_source::text,jsonb_build_object('source_kind',p_kind));
 return query select jsonb_build_object('clientId',p_client,'sourceId',p_source,'sourceKind',p_kind,'sourceVersion',v_source->'version','canUpload',v_source->'canUpload','rows',v_rows);
end;$$;

create function private.reserve_clinical_attachment(p_org uuid,p_branch uuid,p_input jsonb)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_client uuid;v_kind text;v_source uuid;v_key uuid;v_hash text;v_record private.clinical_attachments;v_details jsonb;v_scan text;v_id uuid:=gen_random_uuid();
begin
 if jsonb_typeof(p_input)<>'object' or not(p_input?&array['clientId','sourceKind','sourceId','sourceVersion','idempotency_key','sha256','mimeType','fileSizeBytes','label'])
 or p_input-array['clientId','sourceKind','sourceId','sourceVersion','idempotency_key','sha256','mimeType','fileSizeBytes','label']<>'{}'::jsonb
 or p_input->>'sourceKind' not in ('care_diary','body_assessment','vaccination','inspection')
 or (p_input->>'sourceVersion')!~'^[1-9][0-9]{0,6}$' or (p_input->>'sha256')!~'^[a-f0-9]{64}$'
 or p_input->>'mimeType' not in ('application/pdf','image/jpeg','image/png') or (p_input->>'fileSizeBytes')!~'^[1-9][0-9]{0,6}$'
 or (p_input->>'fileSizeBytes')::integer>4194304 or char_length(btrim(p_input->>'label')) not between 1 and 120 or (p_input->>'label')~'[[:cntrl:]]'
 then raise exception using errcode='22023',message='invalid clinical attachment';end if;
 v_client:=(p_input->>'clientId')::uuid;v_kind:=p_input->>'sourceKind';v_source:=(p_input->>'sourceId')::uuid;v_key:=(p_input->>'idempotency_key')::uuid;
 v_details:=private.clinical_attachment_source(p_org,p_branch,v_client,v_kind,v_source,true);
 if (v_details->>'version')::integer<>(p_input->>'sourceVersion')::integer then raise exception using errcode='40001',message='clinical source version changed';end if;
 v_hash:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('clinical-upload:'||p_org||':'||auth.uid()||':'||v_key,0));
 select * into v_record from private.clinical_attachments where organization_id=p_org and created_by=auth.uid() and idempotency_key=v_key;
 if found then
  if v_record.input_hash<>v_hash then raise exception using errcode='23505',message='clinical upload key conflict';end if;
  select verdict into v_scan from private.clinical_attachment_scans where attachment_id=v_record.id;
  return query select jsonb_build_object('id',v_record.id,'clientId',v_client,'sourceId',v_source,'sourceKind',v_kind,'sourceVersion',v_record.source_version,'sha256',v_record.sha256,'objectPath',v_record.object_path,'replayed',true,'scanStatus',v_scan);return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-source:'||v_kind||':'||v_source,0));
 if (select count(*) from private.clinical_attachments a where a.source_id=v_source and a.source_kind=v_kind)>=100 then raise exception using errcode='54000',message='clinical attachment limit reached';end if;
 if exists(select 1 from private.clinical_attachments a join private.clinical_attachment_scans s on s.attachment_id=a.id and s.verdict='clean' where a.source_id=v_source and a.source_kind=v_kind and a.sha256=p_input->>'sha256') then raise exception using errcode='23505',message='duplicate clinical attachment';end if;
 insert into private.clinical_attachments(id,organization_id,branch_id,client_id,source_kind,source_id,source_version,label,mime_type,file_size_bytes,sha256,object_path,created_by,idempotency_key,input_hash)
 values(v_id,p_org,p_branch,v_client,v_kind,v_source,(p_input->>'sourceVersion')::integer,btrim(p_input->>'label'),p_input->>'mimeType',(p_input->>'fileSizeBytes')::integer,p_input->>'sha256',p_org||'/'||v_client||'/'||v_id,auth.uid(),v_key,v_hash);
 return query select jsonb_build_object('id',v_id,'clientId',v_client,'sourceId',v_source,'sourceKind',v_kind,'sourceVersion',p_input->'sourceVersion','sha256',p_input->>'sha256','objectPath',p_org||'/'||v_client||'/'||v_id,'replayed',false,'scanStatus',null);
end;$$;

create function private.complete_clinical_attachment(p_id uuid,p_sha256 text,p_verdict text,p_scanner text)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_record private.clinical_attachments;v_prior private.clinical_attachment_scans;v_exists boolean;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='clinical scanner only';end if;
 if p_verdict not in ('clean','infected','failed') or p_scanner!~'^[a-zA-Z0-9._-]{3,80}$' then raise exception using errcode='22023',message='invalid clinical scan verdict';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-scan:'||p_id,0));
 select * into v_record from private.clinical_attachments where id=p_id;
 if not found or v_record.sha256 is distinct from p_sha256 then raise exception using errcode='42501',message='clinical scan mismatch';end if;
 select * into v_prior from private.clinical_attachment_scans where attachment_id=p_id;
 if found then
  if v_prior.verdict<>p_verdict or v_prior.scanner<>p_scanner then raise exception using errcode='23505',message='clinical scan immutable';end if;
 else
  if to_regclass('storage.objects') is null then raise exception using errcode='55000',message='clinical storage unavailable';end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into v_exists using 'clinical-attachments',v_record.object_path;
  if not v_exists then raise exception using errcode='55000',message='clinical storage not confirmed';end if;
  insert into private.clinical_attachment_scans(attachment_id,verdict,scanner,scanned_at) values(p_id,p_verdict,p_scanner,clock_timestamp());
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)values(v_record.organization_id,v_record.branch_id,v_record.created_by,'insert','clinical_attachment_scan',p_id::text,jsonb_build_object('verdict',p_verdict));
 return query select jsonb_build_object('id',p_id,'clientId',v_record.client_id,'sourceId',v_record.source_id,'sourceKind',v_record.source_kind,'sourceVersion',v_record.source_version,'scanStatus',p_verdict,'persisted',true);
end;$$;

create function private.cancel_clinical_attachment(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
declare v_id uuid:=(p_input->>'attachmentId')::uuid;v_key uuid:=(p_input->>'idempotency_key')::uuid;v_hash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');v private.clinical_attachments;s private.clinical_attachment_scans;
begin
 perform private.clinical_attachment_source(p_org,p_branch,(p_input->>'clientId')::uuid,p_input->>'sourceKind',(p_input->>'sourceId')::uuid,true);
 if v_id is null or v_key is null then raise exception 'CLINICAL_CANCEL_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-cancel:'||auth.uid()||':'||v_key,0));
 select * into s from private.clinical_attachment_scans a where a.cancelled_by=auth.uid() and a.cancellation_key=v_key;
 if found then if s.cancellation_hash<>v_hash then raise exception 'CLINICAL_CANCEL_KEY_CONFLICT' using errcode='23505';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('clinical-scan:'||v_id,0));
  select * into v from private.clinical_attachments a where a.id=v_id and a.organization_id=p_org and a.branch_id=p_branch and a.client_id=(p_input->>'clientId')::uuid and a.source_kind=p_input->>'sourceKind' and a.source_id=(p_input->>'sourceId')::uuid;
  if not found then raise exception 'CLINICAL_CANCEL_FORBIDDEN' using errcode='42501';end if;
  if exists(select 1 from private.clinical_attachment_scans a where a.attachment_id=v_id) then raise exception 'CLINICAL_SCAN_ALREADY_FINAL' using errcode='40001';end if;
  insert into private.clinical_attachment_scans(attachment_id,verdict,scanner,cancelled_by,cancellation_key,cancellation_hash) values(v_id,'failed','cancelled-upload',auth.uid(),v_key,v_hash);
  perform private.daycare_completion_audit(p_org,p_branch,'INSERT','clinical_attachment_cancel',v_id,jsonb_build_object('reason','cancel_unfinished_upload'));
 end if;
 return query select jsonb_build_object('id',v_id,'cancelled',true);
end;$$;
create function public.cancel_clinical_attachment(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.cancel_clinical_attachment(p_org,p_branch,p_input)$$;
revoke all on function private.cancel_clinical_attachment(uuid,uuid,jsonb),public.cancel_clinical_attachment(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.cancel_clinical_attachment(uuid,uuid,jsonb),public.cancel_clinical_attachment(uuid,uuid,jsonb) to authenticated;
create function private.prepare_clinical_attachment_download(p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_source uuid,p_id uuid)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_record private.clinical_attachments;
begin
 perform private.clinical_attachment_source(p_org,p_branch,p_client,p_kind,p_source,false);
 select a.* into v_record from private.clinical_attachments a join private.clinical_attachment_scans s on s.attachment_id=a.id and s.verdict='clean'
 where a.id=p_id and a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client
 and ((a.source_id=p_source and a.source_kind=p_kind) or exists(select 1 from private.clinical_attachment_links l where l.attachment_id=a.id and l.source_id=p_source and l.source_kind=p_kind));
 if not found then raise exception using errcode='42501',message='clinical attachment download denied';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)values(p_org,p_branch,auth.uid(),'export','clinical_attachment_download',p_id::text,jsonb_build_object('source_version',v_record.source_version,'expires_seconds',60));
 return query select jsonb_build_object('id',p_id,'clientId',p_client,'objectPath',v_record.object_path,'mimeType',v_record.mime_type,'expiresSeconds',60);
end;$$;

-- A submitted/signed successor freezes and copies the evidence references.
-- Pending uploads block finalization; no later scan can silently change it.
create function private.inherit_clinical_attachment_links() returns trigger language plpgsql security definer set search_path='' as $$
declare v_kind text;v_previous uuid;
begin
 v_kind:=case when tg_table_name='care_records' then 'care_diary' else 'body_assessment' end;
 v_previous:=new.previous_version_id;
 if v_previous is null then return new;end if;
 if exists(select 1 from private.clinical_attachments a where a.source_kind=v_kind and a.source_id=v_previous and not exists(select 1 from private.clinical_attachment_scans s where s.attachment_id=a.id)) then
  raise exception using errcode='40001',message='clinical attachment scan pending; retry after scan';end if;
 insert into private.clinical_attachment_links(attachment_id,source_kind,source_id)
 select a.id,v_kind,new.id from private.clinical_attachments a join private.clinical_attachment_scans s on s.attachment_id=a.id and s.verdict='clean'
 where a.source_kind=v_kind and (a.source_id=v_previous or exists(select 1 from private.clinical_attachment_links l where l.attachment_id=a.id and l.source_kind=v_kind and l.source_id=v_previous)) on conflict do nothing;
 return new;
end;$$;
create trigger care_diary_attachment_inherit after insert on public.care_records for each row when(new.category='staff/daily-care/care-diary') execute function private.inherit_clinical_attachment_links();
create trigger body_attachment_inherit after insert on public.body_assessment_versions for each row execute function private.inherit_clinical_attachment_links();

create function public.clinical_attachments_snapshot(p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_source uuid)returns table(payload jsonb)language sql security invoker set search_path='' as $$select * from private.clinical_attachments_snapshot(p_org,p_branch,p_client,p_kind,p_source);$$;
create function public.reserve_clinical_attachment(p_org uuid,p_branch uuid,p_input jsonb)returns table(receipt jsonb)language sql security invoker set search_path='' as $$select * from private.reserve_clinical_attachment(p_org,p_branch,p_input);$$;
create function public.complete_clinical_attachment(p_id uuid,p_sha256 text,p_verdict text,p_scanner text)returns table(receipt jsonb)language sql security invoker set search_path='' as $$select * from private.complete_clinical_attachment(p_id,p_sha256,p_verdict,p_scanner);$$;
create function public.prepare_clinical_attachment_download(p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_source uuid,p_id uuid)returns table(payload jsonb)language sql security invoker set search_path='' as $$select * from private.prepare_clinical_attachment_download(p_org,p_branch,p_client,p_kind,p_source,p_id);$$;
revoke all on function private.clinical_attachment_source(uuid,uuid,uuid,text,uuid,boolean),private.inherit_clinical_attachment_links() from public,anon,authenticated,service_role;
revoke all on function private.clinical_attachments_snapshot(uuid,uuid,uuid,text,uuid),public.clinical_attachments_snapshot(uuid,uuid,uuid,text,uuid),private.reserve_clinical_attachment(uuid,uuid,jsonb),public.reserve_clinical_attachment(uuid,uuid,jsonb),private.prepare_clinical_attachment_download(uuid,uuid,uuid,text,uuid,uuid),public.prepare_clinical_attachment_download(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.clinical_attachments_snapshot(uuid,uuid,uuid,text,uuid),public.clinical_attachments_snapshot(uuid,uuid,uuid,text,uuid),private.reserve_clinical_attachment(uuid,uuid,jsonb),public.reserve_clinical_attachment(uuid,uuid,jsonb),private.prepare_clinical_attachment_download(uuid,uuid,uuid,text,uuid,uuid),public.prepare_clinical_attachment_download(uuid,uuid,uuid,text,uuid,uuid) to authenticated;
revoke all on function private.complete_clinical_attachment(uuid,text,text,text),public.complete_clinical_attachment(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.complete_clinical_attachment(uuid,text,text,text),public.complete_clinical_attachment(uuid,text,text,text) to service_role;
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('clinical-attachments','clinical-attachments',false,4194304,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
  if exists(select 1 from storage.buckets where id='clinical-attachments' and public) then raise exception 'clinical attachment bucket must remain private';end if;
 end if;
 if to_regclass('storage.objects') is not null then
  execute 'create policy clinical_attachment_no_browser_access on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>''clinical-attachments'') with check(bucket_id<>''clinical-attachments'')';
 end if;
end;$$;
-- Independent recipient acknowledgements and follow-up are append-only events.
create table private.care_handoffs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null,
 client_id uuid not null references public.clients(id),source_record_id uuid not null references public.care_records(id),
 sender_id uuid not null references public.profiles(id),owner_id uuid not null references public.profiles(id),message text not null check(char_length(message) between 1 and 1000),
 due_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 constraint care_handoff_independent check(sender_id<>owner_id),foreign key(branch_id,organization_id) references public.branches(id,organization_id)
);
create table private.care_handoff_events(
 id uuid primary key default gen_random_uuid(),handoff_id uuid not null references private.care_handoffs(id),version integer not null check(version>0),
 actor_id uuid not null references public.profiles(id),action text not null check(action in('created','acknowledged','follow_up','closed')),
 note text not null default '' check(char_length(note)<=1000),created_at timestamptz not null default clock_timestamp(),
 idempotency_key uuid not null,input_hash text not null,unique(actor_id,idempotency_key),unique(handoff_id,version)
);
alter table private.care_handoffs enable row level security;alter table private.care_handoffs force row level security;
alter table private.care_handoff_events enable row level security;alter table private.care_handoff_events force row level security;
revoke all on private.care_handoffs,private.care_handoff_events from public,anon,authenticated,service_role;
create index care_handoffs_scope_idx on private.care_handoffs(organization_id,branch_id,client_id,due_at);
create trigger care_handoffs_immutable before update or delete on private.care_handoffs for each row execute function private.client_documents_immutable();
create trigger care_handoff_events_immutable before update or delete on private.care_handoff_events for each row execute function private.client_documents_immutable();
create function private.care_handoff_scope(p_org uuid,p_branch uuid,p_client uuid,p_write boolean) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
 or not private.care_roster_can_read(p_client,case when p_write then 'care_records.write' else 'care_records.read' end) then raise exception 'HANDOFF_FORBIDDEN' using errcode='42501';end if;
end;$$;
create function private.care_handoff_snapshot(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare recipients jsonb;rows jsonb;
begin
 perform private.care_handoff_scope(p_org,p_branch,p_client,false);
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name) order by x.display_name),'[]'::jsonb) into recipients from(
 select distinct p.id,p.display_name from public.profiles p join public.memberships m on m.profile_id=p.id
 join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active
 join public.role_permissions rp on rp.role_id=r.id join public.permissions permission on permission.id=rp.permission_id and permission.permission_key='care_records.write'
 where p.id<>auth.uid() and p.is_active and p.kind in('staff','professional') and m.organization_id=p_org and (m.branch_id=p_branch or m.branch_id is null)
 and m.status='active' and m.starts_at<=statement_timestamp() and(m.ends_at is null or m.ends_at>statement_timestamp()) limit 200)x;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'sourceRecordId',h.source_record_id,'senderName',sender.display_name,'ownerId',h.owner_id,'ownerName',owner.display_name,
 'message',h.message,'dueAt',h.due_at,'createdAt',h.created_at,'version',latest.version,'status',case latest.action when 'follow_up' then 'acknowledged' else latest.action end,
 'acknowledgedAt',(select min(e.created_at) from private.care_handoff_events e where e.handoff_id=h.id and e.action='acknowledged'),
 'events',(select jsonb_agg(jsonb_build_object('action',e.action,'note',e.note,'at',e.created_at,'actorName',actor.display_name) order by e.version) from private.care_handoff_events e join public.profiles actor on actor.id=e.actor_id where e.handoff_id=h.id)) order by h.due_at),'[]'::jsonb)
 into rows from(select * from private.care_handoffs where organization_id=p_org and branch_id=p_branch and client_id=p_client order by due_at desc limit 100)h
 join public.profiles sender on sender.id=h.sender_id join public.profiles owner on owner.id=h.owner_id
 cross join lateral(select * from private.care_handoff_events e where e.handoff_id=h.id order by version desc limit 1)latest;
 perform private.daycare_completion_audit(p_org,p_branch,'SELECT','care_handoffs',p_client,'{}'::jsonb);
 return query select jsonb_build_object('clientId',p_client,'actorId',auth.uid(),'recipients',recipients,'rows',rows);
end;$$;
create function private.care_handoff_write(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare client_id uuid:=(p_input->>'clientId')::uuid;key uuid:=(p_input->>'idempotency_key')::uuid;action text:=p_input->>'action';h private.care_handoffs;existing private.care_handoff_events;v integer;digest text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
begin
 perform private.care_handoff_scope(p_org,p_branch,client_id,true);
 if key is null or action is null or action not in('create','acknowledge','follow_up','close') or jsonb_typeof(p_input)<>'object' then raise exception 'INVALID_HANDOFF' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('handoff-idempotency:'||auth.uid()||':'||key,0));
 select * into existing from private.care_handoff_events e where e.actor_id=auth.uid() and e.idempotency_key=key;
 if found then
 if existing.input_hash<>digest or not exists(select 1 from private.care_handoffs ch where ch.id=existing.handoff_id and ch.organization_id=p_org and ch.branch_id=p_branch and ch.client_id=client_id) then raise exception 'HANDOFF_REPLAY_MISMATCH' using errcode='40001';end if;
 return query select jsonb_build_object('id',existing.handoff_id,'version',existing.version,'replayed',true);return;end if;
 if action='create' then
 if not exists(select 1 from public.care_records r where r.id=(p_input->>'sourceRecordId')::uuid and r.client_id=client_id and r.organization_id=p_org and r.branch_id=p_branch and r.category='staff/daily-care/care-diary') then raise exception 'HANDOFF_SOURCE_INVALID' using errcode='42501';end if;
 if not exists(select 1 from public.profiles p join public.memberships m on m.profile_id=p.id where p.id=(p_input->>'ownerId')::uuid and p.id<>auth.uid() and p.is_active and p.kind in('staff','professional') and m.organization_id=p_org and(m.branch_id=p_branch or m.branch_id is null) and m.status='active' and m.starts_at<=statement_timestamp() and(m.ends_at is null or m.ends_at>statement_timestamp()))
 or not exists(select 1 from private.care_handoff_snapshot(p_org,p_branch,client_id)s,jsonb_array_elements(s.payload->'recipients')r where(r->>'id')::uuid=(p_input->>'ownerId')::uuid)
 then raise exception 'HANDOFF_OWNER_INVALID' using errcode='42501';end if;
 if (p_input->>'dueAt')::timestamptz<statement_timestamp() or(p_input->>'dueAt')::timestamptz>statement_timestamp()+interval '30 days' or nullif(btrim(p_input->>'message'),'') is null then raise exception 'HANDOFF_FIELDS_INVALID' using errcode='22023';end if;
 insert into private.care_handoffs(organization_id,branch_id,client_id,source_record_id,sender_id,owner_id,message,due_at) values(p_org,p_branch,client_id,(p_input->>'sourceRecordId')::uuid,auth.uid(),(p_input->>'ownerId')::uuid,btrim(p_input->>'message'),(p_input->>'dueAt')::timestamptz) returning * into h;v:=1;
 else
 select * into h from private.care_handoffs ch where ch.id=(p_input->>'id')::uuid and ch.organization_id=p_org and ch.branch_id=p_branch and ch.client_id=client_id for update;
 if not found or h.owner_id<>auth.uid() or h.sender_id=auth.uid() then raise exception 'HANDOFF_RECIPIENT_REQUIRED' using errcode='42501';end if;
 select * into existing from private.care_handoff_events e where e.handoff_id=h.id order by version desc limit 1;
 if existing.version<>(p_input->>'expectedVersion')::integer or existing.action='closed' then raise exception 'HANDOFF_VERSION_CONFLICT' using errcode='40001';end if;
 if(action='acknowledge' and existing.action<>'created') or(action in('follow_up','close') and existing.action not in('acknowledged','follow_up')) then raise exception 'HANDOFF_SEQUENCE_INVALID' using errcode='40001';end if;
 if action in('follow_up','close') and nullif(btrim(p_input->>'note'),'') is null then raise exception 'HANDOFF_FOLLOWUP_REQUIRED' using errcode='22023';end if;
 if existing.version>=1000 then raise exception 'HANDOFF_EVENT_LIMIT' using errcode='54000';end if;
 v:=existing.version+1;
 end if;
 insert into private.care_handoff_events(handoff_id,version,actor_id,action,note,idempotency_key,input_hash) values(h.id,v,auth.uid(),case action when 'create' then 'created' when 'acknowledge' then 'acknowledged' when 'close' then 'closed' else 'follow_up' end,coalesce(btrim(p_input->>'note'),''),key,digest);
 perform private.daycare_completion_audit(p_org,p_branch,'INSERT','care_handoff_events',h.id,jsonb_build_object('version',v,'action',action));
 return query select jsonb_build_object('id',h.id,'version',v,'replayed',false);
end;$$;
create function public.care_handoff_snapshot(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb) language sql security invoker set search_path='' as $$select * from private.care_handoff_snapshot(p_org,p_branch,p_client)$$;
create function public.care_handoff_write(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.care_handoff_write(p_org,p_branch,p_input)$$;
revoke all on function private.care_handoff_scope(uuid,uuid,uuid,boolean),private.care_handoff_snapshot(uuid,uuid,uuid),private.care_handoff_write(uuid,uuid,jsonb),public.care_handoff_snapshot(uuid,uuid,uuid),public.care_handoff_write(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.care_handoff_snapshot(uuid,uuid,uuid),private.care_handoff_write(uuid,uuid,jsonb),public.care_handoff_snapshot(uuid,uuid,uuid),public.care_handoff_write(uuid,uuid,jsonb) to authenticated;

insert into public.permissions(permission_key,description,risk_level) values('family.publish','Approve explicit client-scoped family disclosures',3),('family.messages','Communicate with consent-bound family recipient',1) on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id) select r.id,p.id from public.roles r cross join public.permissions p where r.is_system and r.role_key in('organization_admin','branch_supervisor','case_manager_social_worker','nurse','organization_manager','branch_manager','facility_director') and p.permission_key in('family.publish','family.messages') on conflict do nothing;
create table private.family_publications(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null,client_id uuid not null references public.clients(id),
 category text not null check(category in('care','health','attendance','schedule','billing','document','notice')),
 source_id uuid not null,source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),title text not null check(char_length(title) between 1 and 120),
 summary text not null check(char_length(summary) between 1 and 1000),occurred_at timestamptz not null,published_by uuid not null references public.profiles(id),published_at timestamptz not null default clock_timestamp(),
 idempotency_key uuid not null,input_hash text not null,unique(published_by,idempotency_key),foreign key(branch_id,organization_id) references public.branches(id,organization_id)
);
create table private.family_publication_withdrawals(publication_id uuid primary key references private.family_publications(id),actor_id uuid not null references public.profiles(id),reason text not null check(char_length(reason) between 1 and 1000),withdrawn_at timestamptz not null default clock_timestamp(),idempotency_key uuid not null,input_hash text not null,unique(actor_id,idempotency_key));
create table private.family_messages(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null,client_id uuid not null references public.clients(id),
 recipient_user_id uuid not null references public.profiles(id),sender_id uuid not null references public.profiles(id),direction text not null check(direction in('family_to_institution','institution_to_family')),
 body text not null check(char_length(body) between 1 and 2000),created_at timestamptz not null default clock_timestamp(),idempotency_key uuid not null,input_hash text not null,
 unique(sender_id,idempotency_key),foreign key(branch_id,organization_id) references public.branches(id,organization_id)
);
create table private.family_read_receipts(message_id uuid not null references private.family_messages(id),actor_id uuid not null references public.profiles(id),read_at timestamptz not null default clock_timestamp(),primary key(message_id,actor_id));
create table private.family_preferences(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),client_id uuid not null references public.clients(id),version integer not null,
 push_enabled boolean not null,categories text[] not null,quiet_start time not null,quiet_end time not null,contact_phone text,
 created_at timestamptz not null default clock_timestamp(),idempotency_key uuid not null,input_hash text not null,unique(user_id,client_id,version),unique(user_id,idempotency_key)
);
do $$declare t text;begin foreach t in array array['family_publications','family_publication_withdrawals','family_messages','family_read_receipts','family_preferences'] loop
 execute format('alter table private.%I enable row level security',t);execute format('alter table private.%I force row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on private.%I for each row execute function private.client_documents_immutable()',t||'_immutable',t);
end loop;end;$$;
create index family_publications_scope_idx on private.family_publications(organization_id,branch_id,client_id,published_at desc);
create index family_messages_recipient_idx on private.family_messages(client_id,recipient_user_id,created_at desc);
-- Checks another recipient without impersonating them or weakening the evidence-bound grant.
create function private.family_recipient_has_consent(p_org uuid,p_branch uuid,p_client uuid,p_user uuid,p_scope text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles profile join public.memberships membership on membership.profile_id=profile.id
 join public.membership_roles mr on mr.membership_id=membership.id join public.roles role on role.id=mr.role_id and role.role_key='family' and role.is_active
 join public.consents c on c.recipient_user_id=profile.id and c.organization_id=membership.organization_id and(membership.branch_id=c.branch_id or membership.branch_id is null)
 join private.family_consent_verification_evidence e on e.id=c.verification_evidence_id and e.organization_id=c.organization_id and e.branch_id=c.branch_id and e.client_id=c.client_id and e.recipient_user_id=c.recipient_user_id
 and e.relationship=c.relationship and e.scopes=c.scopes and e.document_version=c.document_version and e.consent_expires_at is not distinct from c.expires_at and e.evidence_hash=c.evidence_hash and e.consumed_consent_id=c.id and e.consumed_by=c.created_by and e.consumed_at is not null and e.consumed_at>=e.verified_at and e.consumed_at<=e.expires_at
 join private.reauth_challenges challenge on challenge.id=c.grant_reauth_challenge_id and challenge.user_id=c.created_by and challenge.consumed_at is not null and challenge.factor_verified_at is not null and challenge.factor_method in('totp','webauthn','phone')
 where profile.id=p_user and profile.kind='family' and profile.is_active and membership.status='active' and membership.starts_at<=statement_timestamp() and(membership.ends_at is null or membership.ends_at>statement_timestamp())
 and c.organization_id=p_org and c.branch_id=p_branch and c.client_id=p_client and c.workflow_version=1 and c.revoked_at is null and c.consented_at<=statement_timestamp() and(c.expires_at is null or c.expires_at>statement_timestamp()) and p_scope=any(c.scopes) and 'client.read'=any(c.scopes) and not('*'=any(c.scopes)));
$$;
revoke all on function private.family_recipient_has_consent(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function private.family_category_scope(p_category text) returns text language sql immutable set search_path='' as $$select case p_category when 'care' then 'care.read' when 'health' then 'health.summary' when 'attendance' then 'care.read' when 'schedule' then 'schedule.read' when 'billing' then 'billing.read' when 'document' then 'documents.read' when 'notice' then 'messages.read' end$$;
create function private.family_client_context(p_org uuid,p_branch uuid,p_client uuid,p_scope text) returns void language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null or not exists(select 1 from private.family_tenant_context()ctx where ctx.organization_id=p_org and ctx.branch_id=p_branch)
 or not exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
 or not private.has_current_governed_family_consent(p_client,'client.read') or not private.has_current_governed_family_consent(p_client,p_scope)
 then raise exception 'FAMILY_CONSENT_REQUIRED' using errcode='42501';end if;end;$$;
create function private.family_source_hash(p_org uuid,p_branch uuid,p_client uuid,p_category text,p_source uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare h text;
begin
 if p_category='care' then select r.content_hash into h from public.care_records r where r.id=p_source and r.organization_id=p_org and r.branch_id=p_branch and r.client_id=p_client and r.status::text in('signed','corrected') and not exists(select 1 from public.care_records n where n.organization_id=r.organization_id and n.record_key=r.record_key and n.version>r.version);
 elsif p_category='health' then select encode(sha256(convert_to(row_to_json(m)::text,'UTF8')),'hex') into h from public.measurements m where m.id=p_source and m.organization_id=p_org and m.branch_id=p_branch and m.client_id=p_client;
 elsif p_category='attendance' then select encode(sha256(convert_to(row_to_json(a)::text,'UTF8')),'hex') into h from public.attendance_records a where a.id=p_source and a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client and not exists(select 1 from public.attendance_records next where next.correction_of_id=a.id);
 elsif p_category='schedule' then select encode(sha256(convert_to(a.content_hash||':'||coalesce((select s.content_hash from public.activity_status_events s where s.organization_id=a.organization_id and s.branch_id=a.branch_id and s.activity_id=a.activity_id order by s.sequence desc limit 1),'scheduled'),'UTF8')),'hex') into h from public.activity_schedule_versions a where a.id=p_source and a.organization_id=p_org and a.branch_id=p_branch and exists(select 1 from jsonb_array_elements(a.participants)p where(p->>'client_id')::uuid=p_client) and not exists(select 1 from public.activity_schedule_versions n where n.activity_id=a.activity_id and n.version>a.version);
 elsif p_category='billing' then select i.content_hash into h from public.billing_invoices i where i.id=p_source and i.organization_id=p_org and i.branch_id=p_branch and i.client_id=p_client;
 elsif p_category='document' then select a.sha256 into h from private.clinical_attachments a join private.clinical_attachment_scans s on s.attachment_id=a.id and s.verdict='clean' where a.id=p_source and a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client;
 elsif p_category='notice' then select encode(sha256(convert_to(row_to_json(n)::text,'UTF8')),'hex') into h from public.notifications n where n.id=p_source and n.organization_id=p_org and n.branch_id=p_branch and n.status='sent';
 end if;
 return h;
end;$$;
create function private.family_publish(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare client_id uuid:=(p_input->>'clientId')::uuid;category text:=p_input->>'category';key uuid:=(p_input->>'idempotency_key')::uuid;source_id uuid:=(p_input->>'sourceId')::uuid;hash text;inputhash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');v private.family_publications;
begin
 if auth.uid() is null or not private.has_permission(p_org,p_branch,'family.publish') or not private.has_recent_aal2(15) or not private.care_roster_can_read(client_id,'clients.read')
 or not exists(select 1 from public.clients c where c.id=client_id and c.organization_id=p_org and c.branch_id=p_branch) then raise exception 'FAMILY_PUBLISH_FORBIDDEN' using errcode='42501';end if;
 if key is null or source_id is null or private.family_category_scope(category) is null or nullif(btrim(p_input->>'title'),'') is null or nullif(btrim(p_input->>'summary'),'') is null or(p_input->>'occurredAt')::timestamptz is null then raise exception 'FAMILY_PUBLICATION_INVALID' using errcode='22023';end if;
 if category='billing' and not private.has_permission(p_org,p_branch,'billing.read') then raise exception 'FAMILY_BILLING_FORBIDDEN' using errcode='42501';end if;
 if category='health' and not private.care_roster_can_read(client_id,'health.read') then raise exception 'FAMILY_HEALTH_FORBIDDEN' using errcode='42501';end if;
 if category='care' and not private.care_roster_can_read(client_id,'care_records.read') then raise exception 'FAMILY_CARE_FORBIDDEN' using errcode='42501';end if;
 if category='attendance' and not private.care_roster_can_read(client_id,'attendance.read') then raise exception 'FAMILY_ATTENDANCE_FORBIDDEN' using errcode='42501';end if;
 if category='schedule' and not private.has_permission(p_org,p_branch,'activity.read') then raise exception 'FAMILY_SCHEDULE_FORBIDDEN' using errcode='42501';end if;
 if category='document' then perform private.clinical_attachment_source(p_org,p_branch,client_id,(select a.source_kind from private.clinical_attachments a where a.id=source_id),(select a.source_id from private.clinical_attachments a where a.id=source_id),false);end if;
 hash:=private.family_source_hash(p_org,p_branch,client_id,category,source_id);if hash is null then raise exception 'FAMILY_SOURCE_INVALID' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('family-publication:'||auth.uid()||':'||key,0));
 select * into v from private.family_publications p where p.published_by=auth.uid() and p.idempotency_key=key;
 if found then if v.input_hash<>inputhash or v.organization_id<>p_org or v.branch_id<>p_branch or v.client_id<>client_id then raise exception 'FAMILY_PUBLICATION_CONFLICT' using errcode='40001';end if;return query select jsonb_build_object('id',v.id,'replayed',true);return;end if;
 insert into private.family_publications(organization_id,branch_id,client_id,category,source_id,source_hash,title,summary,occurred_at,published_by,idempotency_key,input_hash) values(p_org,p_branch,client_id,category,source_id,hash,btrim(p_input->>'title'),btrim(p_input->>'summary'),(p_input->>'occurredAt')::timestamptz,auth.uid(),key,inputhash) returning * into v;
 perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_publications',v.id,jsonb_build_object('category',category,'sourceId',source_id,'sourceHash',hash));
 return query select jsonb_build_object('id',v.id,'replayed',false);
end;$$;
create function private.family_workspace(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare publications jsonb;messages jsonb;preferences jsonb;scopes jsonb;unread integer;
begin
 perform private.family_client_context(p_org,p_branch,p_client,'client.read');
 select coalesce(jsonb_agg(s),'[]'::jsonb) into scopes from unnest(array['care.read','health.summary','schedule.read','billing.read','documents.read','messages.read'])s where private.has_current_governed_family_consent(p_client,s);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'category',p.category,'title',p.title,'summary',p.summary,'occurredAt',p.occurred_at,'publishedAt',p.published_at,'sourceId',p.source_id,
 'bill',case when p.category='billing' then(select jsonb_build_object('total',i.invoice_total,'currency',i.currency,'periodFrom',i.period_start,'periodTo',i.period_end,'balance',coalesce((select balance_after from public.billing_ledger_entries e where e.invoice_id=i.id order by invoice_ledger_version desc limit 1),i.invoice_total),'lines',(select coalesce(jsonb_agg(jsonb_build_object('name',l.fee_name,'quantity',l.quantity,'amount',l.amount) order by l.line_number),'[]'::jsonb) from public.billing_invoice_lines l where l.invoice_id=i.id),'receipts',(select coalesce(jsonb_agg(jsonb_build_object('number',r.receipt_number,'amount',r.amount,'at',r.issued_at)),'[]'::jsonb) from public.billing_receipts r where r.invoice_id=i.id)) from public.billing_invoices i where i.id=p.source_id) else null end) order by p.occurred_at desc),'[]'::jsonb) into publications
 from(select * from private.family_publications f where f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client
 and private.has_current_governed_family_consent(p_client,private.family_category_scope(f.category)) and not exists(select 1 from private.family_publication_withdrawals w where w.publication_id=f.id)
 and f.source_hash=private.family_source_hash(p_org,p_branch,p_client,f.category,f.source_id) order by f.occurred_at desc limit 100)p;
 if private.has_current_governed_family_consent(p_client,'messages.read') then
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'direction',m.direction,'at',m.created_at,'read',exists(select 1 from private.family_read_receipts r where r.message_id=m.id and r.actor_id=auth.uid())) order by m.created_at),'[]'::jsonb) into messages from(select * from private.family_messages f where f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client and f.recipient_user_id=auth.uid() order by f.created_at desc limit 100)m;
 select count(*)::integer into unread from private.family_messages m where m.organization_id=p_org and m.branch_id=p_branch and m.client_id=p_client and m.recipient_user_id=auth.uid() and m.direction='institution_to_family' and not exists(select 1 from private.family_read_receipts r where r.message_id=m.id and r.actor_id=auth.uid());
 else messages:='[]'::jsonb;unread:=0;end if;
 select jsonb_build_object('version',p.version,'pushEnabled',p.push_enabled,'categories',p.categories,'quietStart',to_char(p.quiet_start,'HH24:MI'),'quietEnd',to_char(p.quiet_end,'HH24:MI'),'contactPhone',p.contact_phone) into preferences from private.family_preferences p where p.user_id=auth.uid() and p.client_id=p_client order by p.version desc limit 1;
 preferences:=coalesce(preferences,jsonb_build_object('version',0,'pushEnabled',false,'categories',array['messages'],'quietStart','21:00','quietEnd','08:00','contactPhone',null));
 perform private.daycare_completion_audit(p_org,p_branch,'SELECT','family_workspace',p_client,'{}'::jsonb);
 return query select jsonb_build_object('clientId',p_client,'scopes',scopes,'publications',publications,'messages',messages,'preferences',preferences,'unreadCount',unread,'updatedAt',clock_timestamp());
end;$$;
create function private.family_message_write(p_org uuid,p_branch uuid,p_input jsonb,p_staff boolean default false) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare client_id uuid:=(p_input->>'clientId')::uuid;recipient uuid;key uuid:=(p_input->>'idempotency_key')::uuid;body text:=btrim(p_input->>'body');digest text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');v private.family_messages;
begin
 if not p_staff then perform private.family_client_context(p_org,p_branch,client_id,'messages.read');recipient:=auth.uid();
 else if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(client_id,'clients.read') or not exists(select 1 from public.clients c where c.id=client_id and c.organization_id=p_org and c.branch_id=p_branch) then raise exception 'FAMILY_MESSAGES_FORBIDDEN' using errcode='42501';end if;
 recipient:=(p_input->>'recipientUserId')::uuid;
 -- Consent recipient evidence is checked without impersonating the recipient.
 if not private.family_recipient_has_consent(p_org,p_branch,client_id,recipient,'messages.read') then raise exception 'FAMILY_RECIPIENT_CONSENT_REQUIRED' using errcode='42501';end if;
 end if;
 if key is null or body is null or char_length(body) not between 1 and 2000 or translate(body,E'\n\r\t','')~'[[:cntrl:]]' then raise exception 'FAMILY_MESSAGE_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('family-message:'||auth.uid()||':'||key,0));
 select * into v from private.family_messages m where m.sender_id=auth.uid() and m.idempotency_key=key;
 if found then if v.input_hash<>digest or v.client_id<>client_id or v.organization_id<>p_org or v.branch_id<>p_branch then raise exception 'FAMILY_MESSAGE_CONFLICT' using errcode='40001';end if;return query select jsonb_build_object('id',v.id,'replayed',true);return;end if;
 insert into private.family_messages(organization_id,branch_id,client_id,recipient_user_id,sender_id,direction,body,idempotency_key,input_hash) values(p_org,p_branch,client_id,recipient,auth.uid(),case when p_staff then 'institution_to_family' else 'family_to_institution' end,body,key,digest) returning * into v;
 perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_messages',v.id,'{}'::jsonb);return query select jsonb_build_object('id',v.id,'replayed',false);
end;$$;
create function private.family_preference_write(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare client_id uuid:=(p_input->>'clientId')::uuid;key uuid:=(p_input->>'idempotency_key')::uuid;v private.family_preferences;latest integer;digest text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');categories text[];
begin
 perform private.family_client_context(p_org,p_branch,client_id,'client.read');
 if key is null or jsonb_typeof(p_input->'pushEnabled') is distinct from 'boolean' or jsonb_typeof(p_input->'categories') is distinct from 'array' or(p_input->>'quietStart')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' or(p_input->>'quietEnd')!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'FAMILY_PREFERENCES_INVALID' using errcode='22023';end if;
 select array_agg(c) into categories from jsonb_array_elements_text(p_input->'categories')c;
 categories:=coalesce(categories,'{}'::text[]);if not categories<@array['messages','care','schedule','billing']::text[] or cardinality(categories)>4 or (p_input->>'contactPhone') is not null and(p_input->>'contactPhone')!~'^09[0-9]{8}$' then raise exception 'FAMILY_PREFERENCES_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('family-preferences:'||auth.uid()||':'||client_id,0));
 select * into v from private.family_preferences p where p.user_id=auth.uid() and p.idempotency_key=key;
 if found then if v.client_id<>client_id or v.input_hash<>digest then raise exception 'FAMILY_PREFERENCES_CONFLICT' using errcode='40001';end if;return query select jsonb_build_object('id',v.id,'version',v.version,'replayed',true);return;end if;
 select coalesce(max(p.version),0) into latest from private.family_preferences p where p.user_id=auth.uid() and p.client_id=client_id;
 if latest is distinct from(p_input->>'expectedVersion')::integer then raise exception 'FAMILY_PREFERENCES_VERSION_CONFLICT' using errcode='40001';end if;
 insert into private.family_preferences(user_id,client_id,version,push_enabled,categories,quiet_start,quiet_end,contact_phone,idempotency_key,input_hash) values(auth.uid(),client_id,latest+1,(p_input->>'pushEnabled')::boolean,categories,(p_input->>'quietStart')::time,(p_input->>'quietEnd')::time,p_input->>'contactPhone',key,digest) returning * into v;
 perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_preferences',v.id,jsonb_build_object('version',v.version));return query select jsonb_build_object('id',v.id,'version',v.version,'replayed',false);
end;$$;
create function private.family_read_message(p_org uuid,p_branch uuid,p_client uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.family_client_context(p_org,p_branch,p_client,'messages.read');
 if not exists(select 1 from private.family_messages m where m.id=p_id and m.organization_id=p_org and m.branch_id=p_branch and m.client_id=p_client and m.recipient_user_id=auth.uid()) then raise exception 'FAMILY_MESSAGE_FORBIDDEN' using errcode='42501';end if;
 insert into private.family_read_receipts(message_id,actor_id) values(p_id,auth.uid()) on conflict do nothing;perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_read_receipts',p_id,'{}'::jsonb);end;$$;
create function private.family_document_download(p_org uuid,p_branch uuid,p_client uuid,p_publication uuid) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare p private.family_publications;a private.clinical_attachments;
begin perform private.family_client_context(p_org,p_branch,p_client,'documents.read');
 select * into p from private.family_publications f where f.id=p_publication and f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client and f.category='document' and not exists(select 1 from private.family_publication_withdrawals w where w.publication_id=f.id);
 if not found or p.source_hash is distinct from private.family_source_hash(p_org,p_branch,p_client,'document',p.source_id) then raise exception 'FAMILY_DOCUMENT_FORBIDDEN' using errcode='42501';end if;
 select * into a from private.clinical_attachments c where c.id=p.source_id;
 perform private.daycare_completion_audit(p_org,p_branch,'EXPORT','family_document',p.id,jsonb_build_object('sourceId',a.id,'sha256',a.sha256));
 return query select jsonb_build_object('id',a.id,'objectPath',a.object_path,'mimeType',a.mime_type,'expiresSeconds',60);end;$$;
create function private.family_staff_workspace(p_org uuid,p_branch uuid,p_client uuid,p_recipient uuid default null) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare recipients jsonb;messages jsonb;publications jsonb;sources jsonb;can_publish boolean;
begin
 if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(p_client,'clients.read') or not exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch) then raise exception 'FAMILY_STAFF_FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by p.display_name),'[]'::jsonb) into recipients from public.profiles p where private.family_recipient_has_consent(p_org,p_branch,p_client,p.id,'messages.read');
 if p_recipient is not null and not private.family_recipient_has_consent(p_org,p_branch,p_client,p_recipient,'messages.read') then raise exception 'FAMILY_RECIPIENT_CONSENT_REQUIRED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'direction',m.direction,'at',m.created_at,'read',exists(select 1 from private.family_read_receipts r where r.message_id=m.id and r.actor_id=m.recipient_user_id)) order by m.created_at),'[]'::jsonb) into messages from(select * from private.family_messages f where f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client and f.recipient_user_id=p_recipient order by f.created_at desc limit 100)m;
 can_publish:=private.has_permission(p_org,p_branch,'family.publish') and private.has_recent_aal2(15);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'category',p.category,'title',p.title,'summary',p.summary,'occurredAt',p.occurred_at,'publishedAt',p.published_at,'sourceId',p.source_id,'withdrawn',exists(select 1 from private.family_publication_withdrawals w where w.publication_id=p.id),'sourceCurrent',coalesce(p.source_hash=private.family_source_hash(p_org,p_branch,p_client,p.category,p.source_id),false)) order by p.published_at desc),'[]'::jsonb) into publications from(select * from private.family_publications f where f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client and ((f.category='notice') or (f.category='care' and private.care_roster_can_read(p_client,'care_records.read')) or (f.category='attendance' and private.care_roster_can_read(p_client,'attendance.read')) or (f.category='schedule' and private.has_permission(p_org,p_branch,'activity.read')) or (f.category='health' and private.care_roster_can_read(p_client,'health.read')) or (f.category='billing' and private.has_permission(p_org,p_branch,'billing.read')) or (f.category='document' and exists(select 1 from private.clinical_attachments a where a.id=f.source_id and private.care_roster_can_read(p_client,case a.source_kind when 'care_diary' then 'care_records.read' when 'body_assessment' then 'body_assessments.read' else 'health.read' end)))) order by f.published_at desc limit 100)p;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'category',s.category,'at',s.at,'label',s.label) order by s.at desc),'[]'::jsonb) into sources from(
 select r.id,'care'::text category,r.occurred_at at,'照顧日誌'::text label from public.care_records r where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=p_client and r.category='staff/daily-care/care-diary' and private.care_roster_can_read(p_client,'care_records.read') and private.family_source_hash(p_org,p_branch,p_client,'care',r.id) is not null
 union all select m.id,'health',m.measured_at,'健康量測' from public.measurements m where m.organization_id=p_org and m.branch_id=p_branch and m.client_id=p_client and private.care_roster_can_read(p_client,'health.read')
 union all select a.id,'attendance',coalesce(a.checked_in_at,a.created_at),'個案出勤' from public.attendance_records a where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client and private.care_roster_can_read(p_client,'attendance.read') and private.family_source_hash(p_org,p_branch,p_client,'attendance',a.id) is not null
 union all select a.id,'schedule',a.starts_at,'活動行程' from public.activity_schedule_versions a where a.organization_id=p_org and a.branch_id=p_branch and private.has_permission(p_org,p_branch,'activity.read') and private.family_source_hash(p_org,p_branch,p_client,'schedule',a.id) is not null
 union all select i.id,'billing',i.created_at,'帳單 '||i.invoice_number from public.billing_invoices i where i.organization_id=p_org and i.branch_id=p_branch and i.client_id=p_client and private.has_permission(p_org,p_branch,'billing.read')
 union all select a.id,'document',a.created_at,a.label from private.clinical_attachments a join private.clinical_attachment_scans scan on scan.attachment_id=a.id and scan.verdict='clean' where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client and private.care_roster_can_read(p_client,case a.source_kind when 'care_diary' then 'care_records.read' when 'body_assessment' then 'body_assessments.read' else 'health.read' end)
 order by at desc limit 100)s;
 perform private.daycare_completion_audit(p_org,p_branch,'SELECT','family_staff_workspace',p_client,'{}'::jsonb);
 return query select jsonb_build_object('clientId',p_client,'recipientId',p_recipient,'recipients',recipients,'messages',messages,'publications',publications,'sources',sources,'canPublish',can_publish,'updatedAt',clock_timestamp());
end;$$;
create function private.family_withdraw(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
declare v_client uuid:=(p_input->>'clientId')::uuid;v_id uuid:=(p_input->>'publicationId')::uuid;v_key uuid:=(p_input->>'idempotency_key')::uuid;v_hash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');v private.family_publication_withdrawals;
begin
 if not private.has_permission(p_org,p_branch,'family.publish') or not private.has_recent_aal2(15) or not private.care_roster_can_read(v_client,'clients.read') or not exists(select 1 from private.family_publications p where p.id=v_id and p.organization_id=p_org and p.branch_id=p_branch and p.client_id=v_client) then raise exception 'FAMILY_WITHDRAW_FORBIDDEN' using errcode='42501';end if;
 if v_key is null or nullif(btrim(p_input->>'reason'),'') is null or char_length(p_input->>'reason')>1000 then raise exception 'FAMILY_WITHDRAW_REASON_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('family-withdraw:'||auth.uid()||':'||v_key,0));
 select * into v from private.family_publication_withdrawals w where w.actor_id=auth.uid() and w.idempotency_key=v_key;
 if found then if v.input_hash<>v_hash then raise exception 'FAMILY_WITHDRAW_KEY_CONFLICT' using errcode='23505';end if;return query select jsonb_build_object('id',v.publication_id,'replayed',true);return;end if;
 insert into private.family_publication_withdrawals(publication_id,actor_id,reason,idempotency_key,input_hash) values(v_id,auth.uid(),btrim(p_input->>'reason'),v_key,v_hash);
 perform private.daycare_completion_audit(p_org,p_branch,'UPDATE','family_publication_withdrawals',v_id,'{}'::jsonb);return query select jsonb_build_object('id',v_id,'replayed',false);
end;$$;
create function public.family_staff_workspace(p_org uuid,p_branch uuid,p_client uuid,p_recipient uuid default null) returns table(payload jsonb) language sql security invoker set search_path='' as $$select * from private.family_staff_workspace(p_org,p_branch,p_client,p_recipient)$$;
create function public.family_withdraw(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.family_withdraw(p_org,p_branch,p_input)$$;
revoke all on function private.family_staff_workspace(uuid,uuid,uuid,uuid),public.family_staff_workspace(uuid,uuid,uuid,uuid),private.family_withdraw(uuid,uuid,jsonb),public.family_withdraw(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.family_staff_workspace(uuid,uuid,uuid,uuid),public.family_staff_workspace(uuid,uuid,uuid,uuid),private.family_withdraw(uuid,uuid,jsonb),public.family_withdraw(uuid,uuid,jsonb) to authenticated;
create function public.family_workspace(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb) language sql security invoker set search_path='' as $$select * from private.family_workspace(p_org,p_branch,p_client)$$;
create function public.family_publish(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.family_publish(p_org,p_branch,p_input)$$;
create function public.family_message_write(p_org uuid,p_branch uuid,p_input jsonb,p_staff boolean default false) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.family_message_write(p_org,p_branch,p_input,p_staff)$$;
create function public.family_preference_write(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.family_preference_write(p_org,p_branch,p_input)$$;
create function public.family_read_message(p_org uuid,p_branch uuid,p_client uuid,p_id uuid) returns void language sql security invoker set search_path='' as $$select private.family_read_message(p_org,p_branch,p_client,p_id)$$;
create function public.family_document_download(p_org uuid,p_branch uuid,p_client uuid,p_publication uuid) returns table(payload jsonb) language sql security invoker set search_path='' as $$select * from private.family_document_download(p_org,p_branch,p_client,p_publication)$$;
do $$declare f record;begin for f in select n.nspname,p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname in('family_category_scope','family_client_context','family_source_hash','family_workspace','family_publish','family_message_write','family_preference_write','family_read_message','family_document_download') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
 if f.signature not like '%family_category_scope%' and f.signature not like '%family_client_context%' and f.signature not like '%family_source_hash%' then execute 'grant execute on function '||f.signature||' to authenticated';end if;
end loop;end;$$;

-- Family context never inherits the employee/CEO admission gate.
create or replace function private.family_tenant_context(p_expected_organization_id uuid default null,p_expected_branch_id uuid default null)
returns table(organization_id uuid,organization_name text,branch_id uuid,branch_name text,display_name text,role_keys text[],scopes text[])
language sql stable security definer set search_path='' as $$
 select o.id,o.name,b.id,b.name,p.display_name,array['family']::text[],array['family:authorized_client']::text[]
 from public.profiles p join public.memberships m on m.profile_id=p.id
 join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active and r.role_key='family'
 join public.organizations o on o.id=m.organization_id join public.branches b on b.organization_id=o.id and (m.branch_id is null or m.branch_id=b.id)
 where p.id=(select auth.uid()) and p.kind='family' and p.is_active and m.status='active'
 and m.starts_at<=statement_timestamp() and (m.ends_at is null or m.ends_at>statement_timestamp())
 -- Admission must not call has_current_governed_family_consent here: that
 -- helper checks is_family_user -> is_active_user -> family login admission.
 -- The recipient predicate independently verifies the same exact consumed
 -- evidence, live membership, role, expiry and grant actor without recursion.
 and exists(select 1 from public.clients c where c.organization_id=o.id and c.branch_id=b.id
   and private.family_recipient_has_consent(o.id,b.id,c.id,p.id,'client.read'))
 group by o.id,o.name,b.id,b.name,p.display_name
 order by (o.id=p_expected_organization_id) desc nulls last,(b.id=p_expected_branch_id) desc nulls last,b.name,b.id;
$$;
create or replace function public.family_tenant_context(p_expected_organization_id uuid default null,p_expected_branch_id uuid default null)
returns table(organization_id uuid,organization_name text,branch_id uuid,branch_name text,display_name text,role_keys text[],scopes text[])
language sql stable security invoker set search_path='' as $$select * from private.family_tenant_context(p_expected_organization_id,p_expected_branch_id)$$;
create or replace function public.is_family_login_allowed() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.family_tenant_context())$$;
revoke all on function private.family_tenant_context(uuid,uuid),public.family_tenant_context(uuid,uuid),public.is_family_login_allowed() from public,anon,authenticated,service_role;
grant execute on function private.family_tenant_context(uuid,uuid),public.family_tenant_context(uuid,uuid),public.is_family_login_allowed() to authenticated;
commit;
