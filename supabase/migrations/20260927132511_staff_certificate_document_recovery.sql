-- Discover scoped source pointers, read exact original operations, and explicitly
-- close expired reservations. No GET creates a closure or clinical evidence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table private.staff_certificate_document_terminations(
 id uuid primary key default gen_random_uuid(),document_id uuid not null unique references private.staff_certificate_documents(id) on delete restrict,
 organization_id uuid not null,branch_id uuid not null,closed_by uuid not null references public.profiles(id) on delete restrict,
 original_idempotency_key uuid not null,reconciliation_key uuid not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 closed_at timestamptz not null default clock_timestamp(),reason text not null default 'reservation_expired' check(reason='reservation_expired'),
 foreign key(closed_by,original_idempotency_key) references private.staff_certificate_document_operations(actor_user_id,idempotency_key) on delete restrict,
 unique(closed_by,reconciliation_key)
);
create index staff_certificate_document_terminations_original_idx on private.staff_certificate_document_terminations(closed_by,original_idempotency_key);
alter table private.staff_certificate_document_terminations enable row level security;
alter table private.staff_certificate_document_terminations force row level security;
revoke all on private.staff_certificate_document_terminations from public,anon,authenticated,service_role;
create trigger staff_certificate_document_terminations_immutable before update or delete on private.staff_certificate_document_terminations
 for each row execute function private.staff_certificate_append_only();

-- Every explicit POST binds its reconciliation key even when a terminal scan
-- already won. This ledger is an intent/result receipt, never a termination.
create table private.staff_certificate_document_reconciliations(
 actor_user_id uuid not null references public.profiles(id) on delete restrict,reconciliation_key uuid not null,
 organization_id uuid not null,branch_id uuid not null,original_idempotency_key uuid not null,
 document_id uuid not null references private.staff_certificate_documents(id) on delete restrict,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 result_status text not null check(result_status in('completed','expired_closed')),created_at timestamptz not null default clock_timestamp(),
 primary key(actor_user_id,reconciliation_key),
 foreign key(actor_user_id,original_idempotency_key) references private.staff_certificate_document_operations(actor_user_id,idempotency_key) on delete restrict,
 check(original_idempotency_key<>reconciliation_key)
);
create index staff_certificate_document_reconciliations_original_idx on private.staff_certificate_document_reconciliations(actor_user_id,original_idempotency_key);
create index staff_certificate_document_reconciliations_document_idx on private.staff_certificate_document_reconciliations(document_id);
alter table private.staff_certificate_document_reconciliations enable row level security;
alter table private.staff_certificate_document_reconciliations force row level security;
revoke all on private.staff_certificate_document_reconciliations from public,anon,authenticated,service_role;
create trigger staff_certificate_document_reconciliations_immutable before update or delete on private.staff_certificate_document_reconciliations
 for each row execute function private.staff_certificate_append_only();

create function private.staff_certificate_document_termination_json(t private.staff_certificate_document_terminations)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('terminationId',t.id,'documentId',t.document_id,'originalIdempotencyKey',t.original_idempotency_key,
  'reconciliationKey',t.reconciliation_key,'closedBy',t.closed_by,'closedAt',t.closed_at,'reason',t.reason);
$$;
create function private.staff_certificate_document_is_expired(d private.staff_certificate_documents,p_now timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(d.uploaded_at<=p_now-interval '15 minutes'
  or exists(select 1 from private.reauth_challenges c where c.id=d.uploader_challenge_id and c.factor_verified_at<=p_now-interval '15 minutes'),false);
$$;
create function private.require_staff_certificate_document_open(p_document uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if exists(select 1 from private.staff_certificate_document_terminations t where t.document_id=p_document) then
  raise exception using errcode='55000',message='certificate document reservation is closed';end if;
end $$;
create function private.require_staff_certificate_document_write_key(p_actor uuid,p_key uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if exists(select 1 from private.staff_certificate_document_reconciliations t where t.actor_user_id=p_actor and t.reconciliation_key=p_key) then
  raise exception using errcode='23505',message='certificate document operation key conflict';end if;
end $$;

-- The immutable original writer remains intact; add a closed-reservation fence
-- at exact, checked anchors in its existing boundary, before and after waits.
do $$declare source text;changed text;anchor text;begin
 source:=pg_get_functiondef('private.reserve_staff_certificate_document_guarded(uuid,uuid,jsonb)'::regprocedure);
 anchor:=E' if not replayed then\n';
 if strpos(source,anchor)=0 then raise exception 'certificate reservation closure pre-audit anchor missing';end if;
 changed:=replace(source,anchor,E' perform private.require_staff_certificate_document_open(d.id);\n'||anchor);
 anchor:=E' perform private.staff_certificate_document_source(p_org,p_branch,cert,version,d.record_content_hash,true);';
 if strpos(changed,anchor)=0 then raise exception 'certificate reservation closure final anchor missing';end if;
 changed:=replace(changed,anchor,anchor||E'\n perform private.require_staff_certificate_document_open(d.id);');execute changed;
 source:=pg_get_functiondef('private.reserve_staff_certificate_document_guarded(uuid,uuid,jsonb)'::regprocedure);
 anchor:=E' v:=private.staff_certificate_document_source(p_org,p_branch,cert,version,p_input->>\'recordContentHash\',true);';
 if strpos(source,anchor)=0 then raise exception 'certificate reserve reconciliation-key anchor missing';end if;
 changed:=replace(source,anchor,E' perform private.require_staff_certificate_document_write_key(actor,key);\n'||anchor);execute changed;
 source:=pg_get_functiondef('private.review_staff_certificate_document_guarded(uuid,uuid,jsonb)'::regprocedure);
 anchor:=E' perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,version,p_input->>\'recordContentHash\',true);';
 if strpos(source,anchor)=0 then raise exception 'certificate review reconciliation-key anchor missing';end if;
 changed:=replace(source,anchor,E' perform private.require_staff_certificate_document_write_key(actor,key);\n'||anchor);execute changed;
 source:=pg_get_functiondef('private.complete_staff_certificate_document_scan_guarded(uuid,text,text,text)'::regprocedure);
 anchor:=E' if not found or d.sha256<>p_sha256 or not private.staff_certificate_document_uploader_current(d) then';
 if strpos(source,anchor)=0 then raise exception 'certificate scan closure initial anchor missing';end if;
 changed:=replace(source,anchor,E' if d.id is not null then perform private.require_staff_certificate_document_open(d.id);end if;\n'||anchor);source:=changed;
 anchor:=E' perform private.staff_certificate_document_source(d.organization_id,d.branch_id,d.certificate_key,d.record_version_id,d.record_content_hash,true);';
 if strpos(source,anchor)=0 then raise exception 'certificate scan closure anchors missing';end if;
 changed:=replace(source,anchor,anchor||E'\n perform private.require_staff_certificate_document_open(d.id);');
 if changed=source then raise exception 'certificate scan closure fence missing';end if;execute changed;
end $$;

create function private.staff_certificate_document_sources_bundle(p_org uuid,p_branch uuid,p_staff_membership_id uuid,p_page integer,p_stamp timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare rows jsonb;total integer;offset_rows integer;manage boolean;
begin
 if p_org is null or p_branch is null or p_page is null or p_page not between 1 and 10000
  or not private.staff_certificate_document_authority(p_org,p_branch,false) then
  raise exception using errcode='42501',message='certificate document source discovery is not permitted';end if;
 manage:=private.staff_certificate_document_permission(p_org,p_branch,'staff_certificates.manage');
 if p_staff_membership_id is not null and not private.staff_certificate_document_read_access(p_org,p_branch,p_staff_membership_id) then
  raise exception using errcode='42501',message='certificate document source discovery is not permitted';end if;
 offset_rows:=(p_page-1)*50;
 select count(*) into total from public.staff_certificate_versions v
 where v.organization_id=p_org and v.branch_id=p_branch and(p_staff_membership_id is null or v.staff_membership_id=p_staff_membership_id)
  and not exists(select 1 from public.staff_certificate_versions next where next.previous_version_id=v.id)
  and private.staff_certificate_document_read_access(p_org,p_branch,v.staff_membership_id);
 select coalesce(jsonb_agg(jsonb_build_object('staffMembershipId',v.staff_membership_id,'staffUserId',v.staff_user_id,
  'displayName',v.staff_display_name,'certificateKey',v.certificate_key,'recordVersionId',v.id,'recordContentHash',v.content_hash,
  'version',v.version,'recordStatus',v.record_status,'certificateType',v.certificate_type,'effectiveOn',v.effective_on,'expiresOn',v.expires_on,
  'canUpload',manage and v.record_status='active' and private.staff_certificate_target_in_scope(p_org,p_branch,v.staff_membership_id,true))
  order by v.staff_display_name,v.staff_membership_id,v.certificate_key),'[]'::jsonb)into rows from(
  select * from public.staff_certificate_versions v where v.organization_id=p_org and v.branch_id=p_branch
   and(p_staff_membership_id is null or v.staff_membership_id=p_staff_membership_id)
   and not exists(select 1 from public.staff_certificate_versions next where next.previous_version_id=v.id)
   and private.staff_certificate_document_read_access(p_org,p_branch,v.staff_membership_id)
  order by v.staff_display_name,v.staff_membership_id,v.certificate_key offset offset_rows limit 50)v;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'staffMembershipId',p_staff_membership_id,
  'generatedAt',p_stamp,'page',p_page,'pageSize',50,'rows',rows,'total',total,'hasMore',offset_rows+jsonb_array_length(rows)<total,
  'canManageDocuments',manage,'serviceEligibility','not_evaluated','signable',false,'demo',false);
end $$;
create function private.staff_certificate_document_sources_guarded(p_org uuid,p_branch uuid,p_staff_membership_id uuid,p_page integer)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;stamp timestamptz:=clock_timestamp();after_result jsonb;
begin
 result:=private.staff_certificate_document_sources_bundle(p_org,p_branch,p_staff_membership_id,p_page,stamp);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','staff_certificate_document_sources',p_branch::text,array['bounded_source_discovery'],
  jsonb_build_object('memberFilterPresent',p_staff_membership_id is not null,'page',p_page,'total',result->'total'));
 after_result:=private.staff_certificate_document_sources_bundle(p_org,p_branch,p_staff_membership_id,p_page,stamp);
 if result is distinct from after_result then raise exception using errcode='40001',message='certificate document sources changed during audit';end if;
 return query select result;
end $$;

create function private.staff_certificate_document_operation_binding(p_action text,p_binding jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare names text[];field text;
begin
 names:=case p_action when 'reserve' then array['staffMembershipId','certificateKey','recordVersionId','recordContentHash','sha256','mimeType','fileSizeBytes']
  when 'review' then array['documentId','recordVersionId','recordContentHash','decision','reasonSha256'] end;
 if names is null or jsonb_typeof(p_binding) is distinct from 'object' or not(p_binding?&names) or p_binding-names<>'{}'::jsonb then
  raise exception using errcode='22023',message='invalid certificate document operation binding';end if;
 foreach field in array case p_action when 'reserve' then array['staffMembershipId','certificateKey','recordVersionId'] else array['documentId','recordVersionId'] end loop
  if jsonb_typeof(p_binding->field) is distinct from 'string' or(p_binding->>field)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
   raise exception using errcode='22023',message='invalid certificate document operation binding';end if;
 end loop;
 foreach field in array case p_action when 'reserve' then array['recordContentHash','sha256'] else array['recordContentHash','reasonSha256'] end loop
  if jsonb_typeof(p_binding->field) is distinct from 'string' or(p_binding->>field)!~'^[a-f0-9]{64}$' then
   raise exception using errcode='22023',message='invalid certificate document operation binding';end if;
 end loop;
 if p_action='reserve' then
  if jsonb_typeof(p_binding->'mimeType') is distinct from 'string' or p_binding->>'mimeType' not in('application/pdf','image/jpeg','image/png')
   or jsonb_typeof(p_binding->'fileSizeBytes') is distinct from 'number' or(p_binding->>'fileSizeBytes')!~'^[0-9]{1,7}$'
   or(p_binding->>'fileSizeBytes')::integer not between 1 and 4194304 then
   raise exception using errcode='22023',message='invalid certificate document operation binding';end if;
 elsif jsonb_typeof(p_binding->'decision') is distinct from 'string' or p_binding->>'decision' not in('verified','rejected') then
  raise exception using errcode='22023',message='invalid certificate document operation binding';end if;
 return p_binding;
end $$;

create function private.staff_certificate_document_original_operation(p_org uuid,p_branch uuid,p_action text,p_key uuid,p_binding jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare op private.staff_certificate_document_operations;d private.staff_certificate_documents;r private.staff_certificate_document_reviews;
 expected_binding jsonb;original_input jsonb;hash text;source public.staff_certificate_versions;
begin
 select * into op from private.staff_certificate_document_operations where actor_user_id=auth.uid() and idempotency_key=p_key;
 if not found or op.organization_id<>p_org or op.branch_id<>p_branch or op.action<>p_action then return null;end if;
 select * into d from private.staff_certificate_documents where id=op.document_id;
 if not found or d.organization_id<>p_org or d.branch_id<>p_branch then raise exception using errcode='55000',message='certificate document original operation is invalid';end if;
 source:=private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,d.record_version_id,d.record_content_hash,false);
 if source.staff_membership_id<>d.staff_membership_id or source.staff_user_id<>d.staff_user_id
  or not private.staff_certificate_document_read_access(p_org,p_branch,d.staff_membership_id) then
  raise exception using errcode='42501',message='certificate document original operation is outside current scope';end if;
 if p_action='reserve' then
  if d.uploaded_by<>auth.uid() or op.review_id is not null then raise exception using errcode='55000',message='certificate document original operation is invalid';end if;
  expected_binding:=jsonb_build_object('staffMembershipId',d.staff_membership_id,'certificateKey',d.certificate_key,'recordVersionId',d.record_version_id,
   'recordContentHash',d.record_content_hash,'sha256',d.sha256,'mimeType',d.mime_type,'fileSizeBytes',d.file_size_bytes);
  original_input:=expected_binding||jsonb_build_object('idempotency_key',p_key);
 else
  select * into r from private.staff_certificate_document_reviews where id=op.review_id and document_id=d.id;
  if not found or r.reviewed_by<>auth.uid() or r.reviewed_by=d.uploaded_by or r.reviewed_by=d.staff_user_id
   or not exists(select 1 from private.staff_certificate_document_scans s where s.document_id=d.id and s.verdict='clean' and s.sha256=d.sha256)
   then raise exception using errcode='55000',message='certificate document original operation is invalid';end if;
  expected_binding:=jsonb_build_object('documentId',d.id,'recordVersionId',d.record_version_id,'recordContentHash',d.record_content_hash,
   'decision',r.decision,'reasonSha256',encode(sha256(convert_to(r.reason,'UTF8')),'hex'));
  original_input:=jsonb_build_object('documentId',d.id,'recordVersionId',d.record_version_id,'recordContentHash',d.record_content_hash,
   'decision',r.decision,'reason',r.reason,'idempotency_key',p_key);
 end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,'action',p_action,'input',original_input)::text,'UTF8')),'hex');
 if hash is distinct from op.request_hash then raise exception using errcode='55000',message='certificate document original operation is invalid';end if;
 if expected_binding is distinct from p_binding then return null;end if;
 return jsonb_build_object('operation',to_jsonb(op),'document',to_jsonb(d),'review',case when r.id is null then null else to_jsonb(r) end);
end $$;
create function private.staff_certificate_document_operation_result(p_org uuid,p_branch uuid,p_action text,p_key uuid,p_binding jsonb,p_nonce uuid,p_stamp timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare original jsonb;d private.staff_certificate_documents;r private.staff_certificate_document_reviews;t private.staff_certificate_document_terminations;
 result jsonb;receipt jsonb;status text;state text;closure jsonb;scan text;
begin
 if p_key is null or p_nonce is null or p_key::text!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or p_nonce::text!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invalid certificate document operation lookup';end if;
 perform private.staff_certificate_document_operation_binding(p_action,p_binding);
 if not private.staff_certificate_document_authority(p_org,p_branch,false) then raise exception using errcode='42501',message='certificate document operation lookup is not permitted';end if;
 original:=private.staff_certificate_document_original_operation(p_org,p_branch,p_action,p_key,p_binding);
 if original is null then status:='not_found';
 else
  select * into d from jsonb_populate_record(null::private.staff_certificate_documents,original->'document');
  receipt:=private.staff_certificate_document_json(d);scan:=receipt->>'scanStatus';
  if p_action='review' then
   select * into r from jsonb_populate_record(null::private.staff_certificate_document_reviews,original->'review');
   receipt:=private.staff_certificate_document_review_json(d,r,false);status:='completed';
  else
   select * into t from private.staff_certificate_document_terminations where document_id=d.id;
   if found then
    if scan<>'reserved' or t.organization_id<>p_org or t.branch_id<>p_branch or t.closed_by<>auth.uid() or t.original_idempotency_key<>p_key
     or t.original_idempotency_key=t.reconciliation_key or t.closed_at<d.uploaded_at or t.closed_at>p_stamp
     or t.request_hash<>encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,
      'originalIdempotencyKey',p_key,'reconciliationKey',t.reconciliation_key,'binding',p_binding)::text,'UTF8')),'hex')
     or not exists(select 1 from private.staff_certificate_document_reconciliations i where i.actor_user_id=t.closed_by
      and i.reconciliation_key=t.reconciliation_key and i.organization_id=t.organization_id and i.branch_id=t.branch_id
      and i.original_idempotency_key=t.original_idempotency_key and i.document_id=t.document_id and i.request_hash=t.request_hash
      and i.result_status='expired_closed') then
     raise exception using errcode='55000',message='certificate document termination evidence is invalid';end if;
    status:='expired_closed';closure:=private.staff_certificate_document_termination_json(t);
   elsif scan='reserved' then status:='reserved';state:=case when private.staff_certificate_document_is_expired(d,p_stamp) then 'expired' else 'pending' end;
   else status:='completed';end if;
  end if;
 end if;
 result:=jsonb_build_object('schemaVersion',1,'organizationId',p_org,'branchId',p_branch,'actorUserId',auth.uid(),'action',p_action,
  'idempotencyKey',p_key,'nonce',p_nonce,'checkedAt',p_stamp,'binding',p_binding,'status',status,'receipt',receipt,
  'reservationState',state,'closure',closure,'persisted',status<>'not_found','demo',false,'serviceEligibility','not_evaluated','signable',false);
 return result;
end $$;
create function private.staff_certificate_document_operation_receipt_guarded(p_org uuid,p_branch uuid,p_action text,p_key uuid,p_binding jsonb,p_nonce uuid)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;after_result jsonb;stamp timestamptz:=clock_timestamp();
begin
 result:=private.staff_certificate_document_operation_result(p_org,p_branch,p_action,p_key,p_binding,p_nonce,stamp);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','staff_certificate_document_operation_receipt',p_branch::text,array['original_operation_lookup'],
  jsonb_build_object('operationAction',p_action,'status',result->'status'));
 after_result:=private.staff_certificate_document_operation_result(p_org,p_branch,p_action,p_key,p_binding,p_nonce,stamp);
 if result is distinct from after_result then raise exception using errcode='40001',message='certificate document original operation changed during audit';end if;
 return query select result;
end $$;

create function private.reconcile_expired_staff_certificate_document_guarded(p_org uuid,p_branch uuid,p_key uuid,p_reconciliation_key uuid,p_binding jsonb,p_nonce uuid)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare original jsonb;d private.staff_certificate_documents;t private.staff_certificate_document_terminations;prior private.staff_certificate_document_reconciliations;
 hash text;result jsonb;after_result jsonb;replayed boolean:=false;stamp timestamptz;
begin
 if p_key is null or p_reconciliation_key is null or p_nonce is null or p_key=p_reconciliation_key
  or p_key::text!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or p_reconciliation_key::text!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or p_nonce::text!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
  raise exception using errcode='22023',message='invalid certificate document reconciliation';end if;
 perform private.staff_certificate_document_operation_binding('reserve',p_binding);
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document reconciliation is not permitted';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-operation:'||auth.uid()::text||':'||p_key::text,0));
 -- Share the operation-key namespace with ordinary reservation/review writes.
 -- An existing original key cannot be a reconciliation key, so reject before
 -- acquiring the second key; two reversed original-key requests cannot deadlock.
 if exists(select 1 from private.staff_certificate_document_operations where actor_user_id=auth.uid() and idempotency_key=p_reconciliation_key) then
  raise exception using errcode='23505',message='certificate document reconciliation key conflict';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-operation:'||auth.uid()::text||':'||p_reconciliation_key::text,0));
 original:=private.staff_certificate_document_original_operation(p_org,p_branch,'reserve',p_key,p_binding);
 if original is null then raise exception using errcode='42501',message='certificate document original reservation is not found';end if;
 select * into d from jsonb_populate_record(null::private.staff_certificate_documents,original->'document');
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate:'||p_org::text||':'||p_branch::text||':'||d.certificate_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('staff-certificate-document-scan:'||d.id::text,0));
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document reconciliation is not permitted';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 -- Closure retires only original reservation metadata, never uploads or scans.
 -- A legitimate later certificate head/void must not prevent retiring the old
 -- intent; original_operation still checks current actor and target read scope.
 perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,d.record_version_id,d.record_content_hash,false);
 hash:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,'originalIdempotencyKey',p_key,
  'reconciliationKey',p_reconciliation_key,'binding',p_binding)::text,'UTF8')),'hex');
 select * into prior from private.staff_certificate_document_reconciliations where actor_user_id=auth.uid() and reconciliation_key=p_reconciliation_key;
 if found and(prior.request_hash<>hash or prior.document_id<>d.id) then raise exception using errcode='23505',message='certificate document reconciliation key conflict';end if;
 if exists(select 1 from private.staff_certificate_document_operations where actor_user_id=auth.uid() and idempotency_key=p_reconciliation_key) then
  raise exception using errcode='23505',message='certificate document reconciliation key conflict';end if;
 if exists(select 1 from private.staff_certificate_document_scans where document_id=d.id) then
  -- A scan won the same locks. Report its existing immutable result; never close.
  if exists(select 1 from private.staff_certificate_document_terminations where document_id=d.id) then
   raise exception using errcode='55000',message='certificate document termination evidence is invalid';end if;
  replayed:=true;
 else
  select * into t from private.staff_certificate_document_terminations where document_id=d.id;
  if found then
   if t.closed_by<>auth.uid() or t.original_idempotency_key<>p_key or t.reconciliation_key<>p_reconciliation_key or t.request_hash<>hash then
    raise exception using errcode='23505',message='certificate document reconciliation key conflict';end if;
   replayed:=true;
  else
   if not private.staff_certificate_document_is_expired(d,clock_timestamp()) then raise exception using errcode='22023',message='certificate document reservation has not expired';end if;
   insert into private.staff_certificate_document_terminations(document_id,organization_id,branch_id,closed_by,original_idempotency_key,reconciliation_key,request_hash)
    values(d.id,p_org,p_branch,auth.uid(),p_key,p_reconciliation_key,hash) returning * into t;
  end if;
 end if;
 -- Bind the intent before projecting a closed proof. A closed lookup requires
 -- both immutable ledgers, so a partial/corrupt persisted source fails closed.
 if prior.actor_user_id is null then
  insert into private.staff_certificate_document_reconciliations(actor_user_id,reconciliation_key,organization_id,branch_id,original_idempotency_key,document_id,request_hash,result_status)
  values(auth.uid(),p_reconciliation_key,p_org,p_branch,p_key,d.id,hash,
   case when exists(select 1 from private.staff_certificate_document_scans where document_id=d.id)then 'completed'else 'expired_closed'end) returning * into prior;
 elsif prior.organization_id<>p_org or prior.branch_id<>p_branch or prior.original_idempotency_key<>p_key then
  raise exception using errcode='55000',message='certificate document reconciliation evidence is invalid';end if;
 stamp:=clock_timestamp();
 result:=private.staff_certificate_document_operation_result(p_org,p_branch,'reserve',p_key,p_binding,p_nonce,stamp)
  ||jsonb_build_object('reconciliationKey',p_reconciliation_key,'replayed',replayed);
 if result->>'status' not in('completed','expired_closed') or prior.result_status<>result->>'status' then
  raise exception using errcode='55000',message='certificate document reconciliation result is invalid';end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'insert','staff_certificate_document_expiry_reconciliation',d.id::text,array['expiry_reconciliation'],
  jsonb_build_object('status',result->'status','replayed',replayed));
 if not private.staff_certificate_document_authority(p_org,p_branch,true) then raise exception using errcode='42501',message='certificate document reconciliation final verification failed';end if;
 perform private.require_staff_certificate_document_evidence(p_org,p_branch);
 perform private.staff_certificate_document_source(p_org,p_branch,d.certificate_key,d.record_version_id,d.record_content_hash,false);
 after_result:=private.staff_certificate_document_operation_result(p_org,p_branch,'reserve',p_key,p_binding,p_nonce,stamp)
  ||jsonb_build_object('reconciliationKey',p_reconciliation_key,'replayed',replayed);
 if result is distinct from after_result then raise exception using errcode='40001',message='certificate document reconciliation changed during audit';end if;
 if not exists(select 1 from private.staff_certificate_document_reconciliations r where r.actor_user_id=auth.uid() and r.reconciliation_key=p_reconciliation_key
  and r.organization_id=p_org and r.branch_id=p_branch and r.original_idempotency_key=p_key and r.document_id=d.id and r.request_hash=hash and r.result_status=result->>'status') then
  raise exception using errcode='55000',message='certificate document reconciliation evidence is invalid';end if;
 return query select result;
end $$;

create function public.staff_certificate_document_sources(p_org uuid,p_branch uuid,p_staff_membership_id uuid default null,p_page integer default 1)
returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$select * from private.staff_certificate_document_sources_guarded(p_org,p_branch,p_staff_membership_id,p_page);$$;
create function public.staff_certificate_document_operation_receipt(p_org uuid,p_branch uuid,p_action text,p_key uuid,p_binding jsonb,p_nonce uuid)
returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$select * from private.staff_certificate_document_operation_receipt_guarded(p_org,p_branch,p_action,p_key,p_binding,p_nonce);$$;
create function public.reconcile_expired_staff_certificate_document(p_org uuid,p_branch uuid,p_key uuid,p_reconciliation_key uuid,p_binding jsonb,p_nonce uuid)
returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$select * from private.reconcile_expired_staff_certificate_document_guarded(p_org,p_branch,p_key,p_reconciliation_key,p_binding,p_nonce);$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
 and p.proname in('staff_certificate_document_termination_json','staff_certificate_document_is_expired','require_staff_certificate_document_open','require_staff_certificate_document_write_key',
  'staff_certificate_document_sources_bundle','staff_certificate_document_sources_guarded','staff_certificate_document_operation_binding',
  'staff_certificate_document_original_operation','staff_certificate_document_operation_result','staff_certificate_document_operation_receipt_guarded',
  'reconcile_expired_staff_certificate_document_guarded','staff_certificate_document_sources','staff_certificate_document_operation_receipt','reconcile_expired_staff_certificate_document') loop
  execute format('alter function %s owner to postgres',f.signature);execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function private.staff_certificate_document_sources_guarded(uuid,uuid,uuid,integer),public.staff_certificate_document_sources(uuid,uuid,uuid,integer),
 private.staff_certificate_document_operation_receipt_guarded(uuid,uuid,text,uuid,jsonb,uuid),public.staff_certificate_document_operation_receipt(uuid,uuid,text,uuid,jsonb,uuid),
 private.reconcile_expired_staff_certificate_document_guarded(uuid,uuid,uuid,uuid,jsonb,uuid),public.reconcile_expired_staff_certificate_document(uuid,uuid,uuid,uuid,jsonb,uuid) to authenticated;
comment on table private.staff_certificate_document_terminations is 'Explicit immutable expired-reservation closure only; never a scan, qualification, clinical approval or object deletion.';
comment on table private.staff_certificate_document_reconciliations is 'Immutable original intent binding for every explicit reconciliation, including a terminal scan winner; never evidence approval or eligibility.';
commit;
