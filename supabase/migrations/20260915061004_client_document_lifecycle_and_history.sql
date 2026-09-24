begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Per-file dispositions never overwrite a scan verdict, original attachment,
-- medication order or the separately versioned category-level intake review.
create table private.client_document_disposition_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 branch_id uuid not null, client_id uuid not null,
 document_id uuid not null references private.client_document_versions(id) on delete restrict,
 category text not null, revision integer not null check(revision between 1 and 1000000),
 disposition text not null check(disposition in ('reviewed','needs_replacement','inactive')),
 reason text not null check(char_length(btrim(reason)) between 3 and 300 and reason!~'[[:cntrl:]]'),
 actor_user_id uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(document_id,revision)
);
create index client_document_disposition_scope_idx on private.client_document_disposition_events(organization_id,branch_id,client_id,document_id,revision desc);
create index client_document_disposition_actor_idx on private.client_document_disposition_events(actor_user_id);
create table private.client_document_disposition_receipts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,branch_id uuid not null,client_id uuid not null,
 actor_user_id uuid not null references public.profiles(id) on delete restrict,
 idempotency_key uuid not null,input_hash text not null check(input_hash~'^[a-f0-9]{64}$'),
 event_id uuid not null references private.client_document_disposition_events(id) on delete restrict,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(organization_id,actor_user_id,idempotency_key)
);
create index client_document_disposition_receipt_scope_idx on private.client_document_disposition_receipts(client_id,organization_id,branch_id);
create index client_document_disposition_receipt_event_idx on private.client_document_disposition_receipts(event_id);
create index client_document_disposition_receipt_actor_idx on private.client_document_disposition_receipts(actor_user_id);

-- A timestamp-only cursor can admit rows committed after the first request with
-- an earlier created_at. Freeze a bounded manifest in one MVCC statement instead.
-- Rows keyset on the immutable ordinal; the UUID cursor is actor/scope bound.
create table private.client_document_history_snapshots (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,client_id uuid not null,
 actor_user_id uuid not null references public.profiles(id) on delete restrict,category text,
 generated_at timestamptz not null,expires_at timestamptz not null,
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 check(expires_at=generated_at+interval '5 minutes'),
 check(category is null or category in ('identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam'))
);
create index client_document_history_snapshot_scope_idx on private.client_document_history_snapshots(client_id,organization_id,branch_id);
create index client_document_history_snapshot_actor_idx on private.client_document_history_snapshots(actor_user_id);
create table private.client_document_history_items (
 snapshot_id uuid not null references private.client_document_history_snapshots(id) on delete restrict,
 ordinal integer not null check(ordinal between 1 and 5001),
 document_id uuid not null references private.client_document_versions(id) on delete restrict,
 category text not null,payload jsonb not null,primary key(snapshot_id,ordinal),unique(snapshot_id,document_id)
);
create index client_document_history_item_document_idx on private.client_document_history_items(document_id);
create table private.client_document_history_cursors (
 id uuid primary key default gen_random_uuid(),snapshot_id uuid not null references private.client_document_history_snapshots(id) on delete restrict,
 after_ordinal integer not null check(after_ordinal between 1 and 5000),unique(snapshot_id,after_ordinal)
);
do $$ declare n text; begin
 foreach n in array array['client_document_disposition_events','client_document_disposition_receipts','client_document_history_snapshots','client_document_history_items','client_document_history_cursors'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('alter table private.%I force row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.client_documents_immutable()',n||'_immutable',n);
 end loop;
end;$$;

create function private.client_document_current_disposition(p_document uuid)
returns text language sql stable security definer set search_path='' as $$
 select disposition from private.client_document_disposition_events where document_id=p_document order by revision desc limit 1;
$$;

create function private.assert_client_document_disposition_access(p_org uuid,p_branch uuid,p_client uuid,p_category text)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_recent_aal2(15)
  or not exists(select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active
   join public.organizations o on o.id=c.organization_id and o.is_active where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
  or not private.client_document_access(p_client,p_category,false) or not private.client_document_access(p_client,p_category,true)
 then raise exception using errcode='42501',message='document disposition outside authorized scope';end if;
end;$$;

create function private.change_client_document_disposition_guarded(p_org uuid,p_branch uuid,p_input jsonb)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare d private.client_document_versions; prior private.client_document_disposition_receipts;
 v_client uuid;v_document uuid;v_key uuid;v_expected integer;v_revision integer;v_hash text;v_event uuid;v_receipt jsonb;
begin
 if auth.uid() is null or not private.has_recent_aal2(15) then raise exception using errcode='42501',message='document disposition denied';end if;
 if jsonb_typeof(p_input) is distinct from 'object'
  or not(p_input?&array['clientId','documentId','category','expectedReviewRevision','disposition','reason','idempotency_key'])
  or p_input-array['clientId','documentId','category','expectedReviewRevision','disposition','reason','idempotency_key']<>'{}'::jsonb
  or jsonb_typeof(p_input->'clientId') is distinct from 'string' or jsonb_typeof(p_input->'documentId') is distinct from 'string'
  or jsonb_typeof(p_input->'category') is distinct from 'string' or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string'
  or jsonb_typeof(p_input->'expectedReviewRevision') is distinct from 'number' or (p_input->>'expectedReviewRevision')!~'^[0-9]{1,7}$'
  or jsonb_typeof(p_input->'disposition') is distinct from 'string' or p_input->>'disposition' not in ('reviewed','needs_replacement','inactive')
  or jsonb_typeof(p_input->'reason') is distinct from 'string' or char_length(btrim(p_input->>'reason')) not between 3 and 300 or (p_input->>'reason')~'[[:cntrl:]]'
 then raise exception using errcode='22023',message='invalid document disposition';end if;
 begin
  v_client:=(p_input->>'clientId')::uuid;v_document:=(p_input->>'documentId')::uuid;v_key:=(p_input->>'idempotency_key')::uuid;
 exception when invalid_text_representation then raise exception using errcode='22023',message='invalid document disposition';end;
 v_expected:=(p_input->>'expectedReviewRevision')::integer;
 if v_expected>999999 then raise exception using errcode='22023',message='document disposition revision limit';end if;
 select * into d from private.client_document_versions where id=v_document and client_id=v_client and organization_id=p_org and branch_id=p_branch and category=p_input->>'category';
 if not found or not exists(select 1 from public.organizations o join public.branches b on b.organization_id=o.id
  where o.id=p_org and o.is_active and b.id=p_branch and b.is_active)
  or not private.client_document_access(v_client,d.category,false) or not private.client_document_access(v_client,d.category,true)
 then raise exception using errcode='42501',message='document disposition outside authorized scope';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('document-disposition-key:'||p_org::text||auth.uid()::text||v_key::text,0));
 perform private.assert_client_document_disposition_access(p_org,p_branch,v_client,d.category);
 select * into prior from private.client_document_disposition_receipts where organization_id=p_org and actor_user_id=auth.uid() and idempotency_key=v_key;
 if found then
  if prior.input_hash<>v_hash then raise exception using errcode='23505',message='document disposition key conflict';end if;
  return query select prior.receipt||jsonb_build_object('replayed',true);return;
 end if;
 -- Share the category lock with legacy upload/review so each effective category
 -- projection observes an ordered operation; per-file revision remains separate.
 perform pg_advisory_xact_lock(hashtextextended('client-document:'||v_client::text||d.category,0));
 perform private.assert_client_document_disposition_access(p_org,p_branch,v_client,d.category);
 select coalesce(max(revision),0) into v_revision from private.client_document_disposition_events where document_id=v_document;
 if v_revision<>v_expected then raise exception using errcode='40001',message='document disposition revision changed';end if;
 if p_input->>'disposition'='reviewed' and not exists(select 1 from private.client_document_scan_results where document_id=v_document and verdict='clean')
 then raise exception using errcode='22023',message='clean document required for review';end if;
 insert into private.client_document_disposition_events(organization_id,branch_id,client_id,document_id,category,revision,disposition,reason,actor_user_id)
 values(p_org,p_branch,v_client,v_document,d.category,v_revision+1,p_input->>'disposition',btrim(p_input->>'reason'),auth.uid()) returning id into v_event;
 v_receipt:=jsonb_build_object('clientId',v_client,'documentId',v_document,'category',d.category,'reviewRevision',v_revision+1,'disposition',p_input->>'disposition','persisted',true);
 insert into private.client_document_disposition_receipts(organization_id,branch_id,client_id,actor_user_id,idempotency_key,input_hash,event_id,receipt)
 values(p_org,p_branch,v_client,auth.uid(),v_key,v_hash,v_event,v_receipt);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'insert','client_document_disposition_events',v_event::text,array['disposition','revision'],jsonb_build_object('document_id',v_document,'category',d.category,'revision',v_revision+1,'disposition',p_input->>'disposition'));
 return query select v_receipt||jsonb_build_object('replayed',false);
end;$$;

-- Short-lived navigation snapshots are not clinical evidence. Only expired
-- snapshots belonging to the authenticated reader may be removed, and only
-- through an owner-run scoped read cleanup. Disposition/audit evidence stays
-- permanently append-only. No browser/worker table grant or purge RPC is added.
create function private.client_document_history_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_snapshot uuid;
begin
 if tg_op='DELETE' and current_user='postgres' then
  if tg_table_name='client_document_history_snapshots' then v_snapshot:=old.id;else v_snapshot:=old.snapshot_id;end if;
  if exists(select 1 from private.client_document_history_snapshots where id=v_snapshot and actor_user_id=auth.uid() and expires_at<=clock_timestamp()) then return old;end if;
 end if;
 raise exception using errcode='55000',message='unexpired document history is immutable';
end;$$;
do $$ declare n text; begin
 foreach n in array array['client_document_history_snapshots','client_document_history_items','client_document_history_cursors'] loop
  execute format('drop trigger %I on private.%I',n||'_immutable',n);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.client_document_history_immutable()',n||'_immutable',n);
 end loop;
end;$$;
create function private.prune_expired_client_document_history(p_org uuid,p_branch uuid,p_client uuid)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare item record;removed integer:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active
  join public.organizations o on o.id=c.organization_id and o.is_active where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
  or not private.care_roster_can_read(p_client,'clients.read') then raise exception using errcode='42501',message='document history cleanup denied';end if;
 for item in select id from private.client_document_history_snapshots where organization_id=p_org and branch_id=p_branch and client_id=p_client
  and actor_user_id=auth.uid() and expires_at<=clock_timestamp() order by expires_at,id limit 3 for update skip locked loop
  delete from private.client_document_history_cursors where snapshot_id=item.id;
  delete from private.client_document_history_items where snapshot_id=item.id;
  delete from private.client_document_history_snapshots where id=item.id;
  removed:=removed+1;
 end loop;
 if removed>0 then
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'delete','client_document_history_cache',p_client::text,array['expired_navigation_cache'],jsonb_build_object('snapshot_count',removed));
 end if;
 return removed;
end;$$;
create index client_document_history_expiry_idx on private.client_document_history_snapshots(organization_id,branch_id,client_id,actor_user_id,expires_at,id);

create function private.client_document_history_guarded(p_org uuid,p_branch uuid,p_client uuid,p_category text default null,p_cursor uuid default null,p_limit integer default 50)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare snap private.client_document_history_snapshots;v_after integer:=0;v_last integer;v_count integer;v_rows jsonb;v_next uuid;v_categories text[];
begin
 if auth.uid() is null or not exists(select 1 from public.clients c
  join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active
  join public.organizations o on o.id=c.organization_id and o.is_active
  where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
  or not private.care_roster_can_read(p_client,'clients.read') then raise exception using errcode='42501',message='document history denied';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_category is not null and p_category not in ('identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam'))
 then raise exception using errcode='22023',message='invalid document history request';end if;
 if p_category is not null and not private.client_document_access(p_client,p_category,false) then raise exception using errcode='42501',message='document history category denied';end if;
 if p_cursor is null then
  perform private.prune_expired_client_document_history(p_org,p_branch,p_client);
  insert into private.client_document_history_snapshots(organization_id,branch_id,client_id,actor_user_id,category,generated_at,expires_at)
  select p_org,p_branch,p_client,auth.uid(),p_category,t,t+interval '5 minutes' from (select clock_timestamp() t)clock returning * into snap;
  select array_agg(cat) into v_categories from unnest(array['identity_front','identity_back','medication_bag','medication_plan','medication_history','health_exam'])cat
   where (p_category is null or p_category=cat) and private.client_document_access(p_client,cat,false);
  insert into private.client_document_history_items(snapshot_id,ordinal,document_id,category,payload)
  select snap.id,(row_number() over(order by d.created_at desc,d.id desc))::integer,d.id,d.category,
   jsonb_build_object('id',d.id,'category',d.category,'version',d.version,'scanStatus',coalesce(s.verdict,'reserved'),
    'documentLabel',d.document_label,'provider',d.provider,'documentDate',d.document_date,'validUntil',d.valid_until,'periodFrom',d.period_from,'periodTo',d.period_to,
    'createdAt',d.created_at,'reviewRevision',coalesce(e.revision,0),'disposition',coalesce(e.disposition,'unreviewed'),'reviewReason',e.reason,'reviewedAt',e.created_at,
    'canDownload',coalesce(s.verdict='clean',false),'historicalOnly',coalesce(e.disposition='inactive',false) or coalesce(d.valid_until<(snap.generated_at at time zone 'Asia/Taipei')::date,false))
  from (select * from private.client_document_versions where organization_id=p_org and branch_id=p_branch and client_id=p_client and category=any(v_categories) order by created_at desc,id desc limit 5001)d
  left join private.client_document_scan_results s on s.document_id=d.id
  left join lateral(select revision,disposition,reason,created_at from private.client_document_disposition_events where document_id=d.id order by revision desc limit 1)e on true;
  get diagnostics v_count=row_count;
  if v_count>5000 then raise exception using errcode='54000',message='document history scope limit';end if;
 else
  select s.* into snap from private.client_document_history_cursors c
   join private.client_document_history_snapshots s on s.id=c.snapshot_id where c.id=p_cursor;
  if not found or snap.organization_id<>p_org or snap.branch_id<>p_branch or snap.client_id<>p_client or snap.actor_user_id<>auth.uid() or snap.category is distinct from p_category
  then raise exception using errcode='22023',message='invalid document history cursor';end if;
  if snap.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='document history snapshot expired';end if;
  select after_ordinal into v_after from private.client_document_history_cursors where id=p_cursor;
 end if;
 -- Reauthorize the complete stored manifest before releasing even a later page.
 -- A revoked field grant cannot be bypassed using a previously issued cursor.
 if exists(select 1 from (select distinct category from private.client_document_history_items where snapshot_id=snap.id)cats where not private.client_document_access(p_client,cats.category,false))
 then raise exception using errcode='42501',message='document history scope changed';end if;
 select coalesce(jsonb_agg(i.payload||jsonb_build_object('canManage',private.client_document_access(p_client,i.category,true)) order by i.ordinal),'[]'::jsonb),max(i.ordinal)
 into v_rows,v_last from (select * from private.client_document_history_items where snapshot_id=snap.id and ordinal>v_after order by ordinal limit p_limit)i;
 if exists(select 1 from private.client_document_history_items where snapshot_id=snap.id and ordinal>v_last) then
  insert into private.client_document_history_cursors(snapshot_id,after_ordinal) values(snap.id,v_last) on conflict(snapshot_id,after_ordinal) do nothing;
  select id into v_next from private.client_document_history_cursors where snapshot_id=snap.id and after_ordinal=v_last;
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','client_document_history',p_client::text,array['metadata_page'],jsonb_build_object('row_count',jsonb_array_length(v_rows),'snapshot_id',snap.id));
 return query select jsonb_build_object('organizationId',p_org,'branchId',p_branch,'clientId',p_client,'category',p_category,'snapshotId',snap.id,
  'generatedAt',snap.generated_at,'expiresAt',snap.expires_at,'rows',v_rows,'nextCursor',v_next,'pageSize',p_limit);
end;$$;

create function public.change_client_document_disposition(p_org uuid,p_branch uuid,p_input jsonb)
returns table(receipt jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.change_client_document_disposition_guarded(p_org,p_branch,p_input);$$;
create function public.client_document_history(p_org uuid,p_branch uuid,p_client uuid,p_category text default null,p_cursor uuid default null,p_limit integer default 50)
returns table(payload jsonb) language sql volatile security invoker set search_path='' as $$ select * from private.client_document_history_guarded(p_org,p_branch,p_client,p_category,p_cursor,p_limit);$$;
revoke all on function private.client_document_current_disposition(uuid),private.assert_client_document_disposition_access(uuid,uuid,uuid,text),
 private.client_document_history_immutable(),private.prune_expired_client_document_history(uuid,uuid,uuid),
 private.change_client_document_disposition_guarded(uuid,uuid,jsonb),public.change_client_document_disposition(uuid,uuid,jsonb),
 private.client_document_history_guarded(uuid,uuid,uuid,text,uuid,integer),public.client_document_history(uuid,uuid,uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.change_client_document_disposition_guarded(uuid,uuid,jsonb),public.change_client_document_disposition(uuid,uuid,jsonb),
 private.client_document_history_guarded(uuid,uuid,uuid,text,uuid,integer),public.client_document_history(uuid,uuid,uuid,text,uuid,integer) to authenticated;

-- Preserve the complete deployed upload/category-review/download contracts.
-- Add only an effective per-document overlay to the existing latest-category
-- projection and completeness CASE, within their original MVCC statement.
-- Assert every exact source anchor before altering a function: a changed
-- deployment baseline must stop the transaction rather than silently drift.
do $$ declare source text; old_fragment text;new_fragment text; begin
 source:=pg_get_functiondef('private.client_documents_snapshot_guarded(uuid,uuid,uuid)'::regprocedure);
 old_fragment:='v_history_count integer;';
 if position(old_fragment in source)=0 then raise exception 'document snapshot lifecycle declaration anchor missing';end if;
 source:=replace(source,old_fragment,'v_history_count integer;v_disposition text;v_revision integer;v_disposition_reason text;');
 old_fragment:='  end if;'||chr(10)||'  v_rows:=v_rows||jsonb_build_array';
 if position(old_fragment in source)=0 then raise exception 'document snapshot lifecycle state anchor missing';end if;
 new_fragment:=$fragment$   select disposition,revision,reason into v_disposition,v_revision,v_disposition_reason from private.client_document_disposition_events where document_id=v_d.id order by revision desc limit 1;
   if v_disposition in ('inactive','needs_replacement') then v_status:='needs_replacement';
   elsif v_disposition='reviewed' and v_scan='clean' then v_status:='reviewed';end if;
  else v_disposition:=null;v_revision:=0;v_disposition_reason:=null;
  end if;
  v_rows:=v_rows||jsonb_build_array$fragment$;
 source:=replace(source,old_fragment,new_fragment);
 old_fragment:='''reviewReason'',v_r.reason';
 if position(old_fragment in source)=0 then raise exception 'document snapshot lifecycle metadata anchor missing';end if;
 source:=replace(source,old_fragment,'''reviewReason'',v_r.reason,''categoryReviewDecision'',v_r.decision,''documentReviewReason'',v_disposition_reason,''documentDisposition'',coalesce(v_disposition,''unreviewed''),''documentReviewRevision'',coalesce(v_revision,0),''documentHistoricalOnly'',coalesce(v_disposition=''inactive'',false) or coalesce(v_d.valid_until<(clock_timestamp() at time zone ''Asia/Taipei'')::date,false)');
 old_fragment:='if auth.uid() is null or not exists(select 1 from public.clients';
 if position(old_fragment in source)=0 then raise exception 'document snapshot organization guard anchor missing';end if;
 source:=replace(source,old_fragment,'if not exists(select 1 from public.organizations where id=p_org and is_active) or auth.uid() is null or not exists(select 1 from public.clients');
 execute source;

 source:=pg_get_functiondef('private.intake_completeness_snapshot(uuid,uuid,date)'::regprocedure);
 old_fragment:='when r.document_version=coalesce(d.version,0) and r.decision=''not_applicable'' then ''not_applicable''';
 if position(old_fragment in source)=0 then raise exception 'intake report disposition priority anchor missing';end if;
 source:=replace(source,old_fragment,'when private.client_document_current_disposition(d.id) in (''inactive'',''needs_replacement'') then ''replacement'''||chr(10)||'    when r.document_version=coalesce(d.version,0) and r.decision=''not_applicable'' and coalesce(private.client_document_current_disposition(d.id),''unreviewed'')<>''reviewed'' then ''not_applicable''');
 old_fragment:='when r.document_version=d.version and r.decision=''needs_replacement'' then ''replacement''';
 if position(old_fragment in source)=0 then raise exception 'intake report replacement anchor missing';end if;
 source:=replace(source,old_fragment,'when r.document_version=d.version and r.decision=''needs_replacement'' and coalesce(private.client_document_current_disposition(d.id),''unreviewed'')<>''reviewed'' then ''replacement''');
 old_fragment:='when r.document_version=d.version and r.decision=''reviewed'' then ''complete''';
 if position(old_fragment in source)=0 then raise exception 'intake report reviewed anchor missing';end if;
 source:=replace(source,old_fragment,'when private.client_document_current_disposition(d.id)=''reviewed'' or (r.document_version=d.version and r.decision=''reviewed'') then ''complete''');
 execute source;

 source:=pg_get_functiondef('private.prepare_client_document_download_guarded(uuid,uuid,uuid,uuid)'::regprocedure);
 old_fragment:='if not found or auth.uid() is null';
 if position(old_fragment in source)=0 then raise exception 'document download organization guard anchor missing';end if;
 source:=replace(source,old_fragment,'if not found or not exists(select 1 from public.organizations where id=p_org and is_active) or auth.uid() is null');
 old_fragment:='''expires_seconds'',60';
 if position(old_fragment in source)=0 then raise exception 'document download audit anchor missing';end if;
 source:=replace(source,old_fragment,old_fragment||',''historical_only'',coalesce(private.client_document_current_disposition(p_document)=''inactive'',false) or coalesce(v_d.valid_until<(clock_timestamp() at time zone ''Asia/Taipei'')::date,false)');
 old_fragment:='''expiresSeconds'',60';
 if position(old_fragment in source)=0 then raise exception 'document download metadata anchor missing';end if;
 source:=replace(source,old_fragment,old_fragment||',''disposition'',coalesce(private.client_document_current_disposition(p_document),''unreviewed''),''historicalOnly'',coalesce(private.client_document_current_disposition(p_document)=''inactive'',false) or coalesce(v_d.valid_until<(clock_timestamp() at time zone ''Asia/Taipei'')::date,false)');
 execute source;
end;$$;

comment on function public.client_document_history(uuid,uuid,uuid,text,uuid,integer) is 'Frozen metadata history, 5000 item maximum, 5 minute actor-scoped snapshot; every cursor reauthorizes live client/category access. Not a current medication order.';
comment on function public.change_client_document_disposition(uuid,uuid,jsonb) is 'Append-only reasoned disposition for exactly one attachment; does not sign or change a clinical medication plan.';

commit;
