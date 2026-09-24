begin;
set local lock_timeout = '5s';
-- Administrative review is NOT a clinical signature or template publication.
create table private.taipei_abcd_review_events (
 id uuid primary key default gen_random_uuid(), draft_id uuid not null references private.taipei_abcd_draft_versions(id),
 organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 sequence integer not null check(sequence>0), action text not null check(action in ('submit','return','approve','correct')),
 state text not null check(state in ('submitted','returned','approved','draft')),
 actor_user_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 reason text not null check(char_length(btrim(reason)) between 3 and 1000), checklist jsonb not null default '{}',
 correction_of uuid references private.taipei_abcd_draft_versions(id), input_hash text not null,
 idempotency_key uuid not null, unique(draft_id,sequence), unique(actor_user_id,idempotency_key),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id)
);
create index taipei_review_scope_idx on private.taipei_abcd_review_events(organization_id,branch_id,client_id,draft_id,sequence desc);
create index taipei_review_correction_idx on private.taipei_abcd_review_events(correction_of);
alter table private.taipei_abcd_review_events enable row level security;
alter table private.taipei_abcd_review_events force row level security;
revoke all on private.taipei_abcd_review_events from public,anon,authenticated,service_role;
create trigger taipei_reviews_immutable before update or delete on private.taipei_abcd_review_events for each row execute function private.abcd_assessment_history_is_append_only();

create or replace function private.taipei_abcd_require_scope(p_org uuid,p_branch uuid,p_client uuid,p_form text,p_write boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
declare allowed boolean; permission text;
begin
 allowed:=private.abcd_assessment_client_authority(p_org,p_branch,p_client,'abcd_assessments.read')
  and (not p_write or private.abcd_assessment_client_authority(p_org,p_branch,p_client,'abcd_assessments.manage'));
 if not allowed then allowed:=public.has_routine_intake_access(p_org,p_branch,case when p_write then 'abcd.save' else 'abcd.read' end,p_client); end if;
 if auth.uid() is null or not coalesce(allowed,false) then raise exception using errcode='42501',message='Taipei ABC scope denied'; end if;
 foreach permission in array case when p_form='A' then array['clients.demographics.read'] when p_form='C' then array['health.read','care_records.read'] else array[]::text[] end loop
  if not (private.can_staff_access_client(p_client,permission) or private.can_routine_intake_access_client(p_client,permission)) then
   raise exception using errcode='42501',message='Taipei ABC source field permission denied';
  end if;
 end loop;
end; $$;

create function private.taipei_abcd_review_state(p_draft uuid) returns text language sql stable security invoker set search_path='' as $$
 select coalesce((select state from private.taipei_abcd_review_events where draft_id=p_draft order by sequence desc limit 1),'draft'); $$;
create function private.taipei_abcd_is_reviewer(p_org uuid,p_branch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id
 where m.profile_id=auth.uid() and m.organization_id=p_org and (m.branch_id=p_branch or m.branch_id is null)
 and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now())
 and r.is_system and r.is_active and mr.assigned_at<=clock_timestamp()
 and r.role_key in ('organization_manager','branch_supervisor','branch_director')); $$;

create function private.taipei_abcd_review_json(p_draft uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare events jsonb; seq integer;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence,'action',e.action,'state',e.state,'actorId',e.actor_user_id,
  'actorName',coalesce(p.display_name,'授權人員'),'createdAt',e.created_at,'reason',e.reason,'checklist',e.checklist,'correctionOf',e.correction_of)
  order by e.sequence),'[]'),coalesce(max(e.sequence),0) into events,seq from private.taipei_abcd_review_events e
  left join public.profiles p on p.id=e.actor_user_id where e.draft_id=p_draft;
 return jsonb_build_object('state',private.taipei_abcd_review_state(p_draft),'sequence',seq,'events',events,'isElectronicSignature',false,'isOfficialComplete',false);
end; $$;

-- All existing draft validation and idempotency protections remain intact.
alter function private.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid) rename to save_taipei_abcd_draft_before_review;
revoke all on function private.save_taipei_abcd_draft_before_review(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function private.save_taipei_abcd_draft(p_org uuid,p_branch uuid,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare old private.taipei_abcd_draft_versions;
begin
 perform private.taipei_abcd_require_scope(p_org,p_branch,(p_payload->>'client_id')::uuid,p_payload->>'form',true);
 perform pg_advisory_xact_lock(hashtextextended('taipei-abcd-key:'||auth.uid()::text||':'||p_key::text,0));
 if exists(select 1 from private.taipei_abcd_draft_operations where actor_user_id=auth.uid() and idempotency_key=p_key) then
  return private.save_taipei_abcd_draft_before_review(p_org,p_branch,p_payload,p_key);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('taipei-abcd-chain:'||p_org::text||':'||p_branch::text||':'||(p_payload->>'client_id')||':'||(p_payload->>'form')||':'||(p_payload->>'usage_year')||':'||(p_payload->>'month'),0));
 select * into old from private.taipei_abcd_draft_versions where organization_id=p_org and branch_id=p_branch and client_id=(p_payload->>'client_id')::uuid
  and form=p_payload->>'form' and usage_year=(p_payload->>'usage_year')::integer and month=(p_payload->>'month')::integer order by version desc limit 1;
 if private.taipei_abcd_review_state(old.id) in ('submitted','approved') then raise exception using errcode='55000',message='Submitted or approved snapshot is frozen; return or create correction first'; end if;
 return private.save_taipei_abcd_draft_before_review(p_org,p_branch,p_payload,p_key);
end; $$;

alter function private.taipei_abcd_draft_snapshot(uuid,uuid,uuid,text,integer,integer) rename to taipei_abcd_draft_snapshot_before_review;
revoke all on function private.taipei_abcd_draft_snapshot_before_review(uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
create function private.taipei_abcd_draft_snapshot(p_org uuid,p_branch uuid,p_client uuid,p_form text,p_year integer,p_month integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; review jsonb; editable boolean; submitter uuid;
begin
 result:=private.taipei_abcd_draft_snapshot_before_review(p_org,p_branch,p_client,p_form,p_year,p_month);
 review:=private.taipei_abcd_review_json((result->'latest'->>'id')::uuid);
 editable:=private.abcd_assessment_client_authority(p_org,p_branch,p_client,'abcd_assessments.manage') or public.has_routine_intake_access(p_org,p_branch,'abcd.save',p_client);
 select actor_user_id into submitter from private.taipei_abcd_review_events where draft_id=(result->'latest'->>'id')::uuid and action='submit' order by sequence desc limit 1;
 return result||jsonb_build_object('workflow',review,'canEdit',editable and review->>'state' not in ('submitted','approved'),
 'canSubmit',editable and review->>'state' in ('draft','returned'),
 'canReview',editable and private.taipei_abcd_is_reviewer(p_org,p_branch) and review->>'state'='submitted' and submitter is distinct from auth.uid()
  and not exists(select 1 from private.taipei_abcd_draft_versions d where d.id=(result->'latest'->>'id')::uuid and d.actor_user_id=auth.uid()),
 'canCorrect',editable and review->>'state'='approved',
 'canExport',private.has_recent_aal2(15) and private.can_staff_access_client(p_client,'document_printing.read') and private.can_staff_access_client(p_client,'document_printing.manage') and private.can_staff_access_client(p_client,'document_printing.access'));
end; $$;

create function private.taipei_abcd_checklist_valid(p_form text,p_answers jsonb,p_checklist jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare section text; section_count integer; item jsonb; missing_count integer;
begin
 if jsonb_typeof(p_checklist) is distinct from 'object' or not private.taipei_abcd_answers_valid(p_form,p_answers)
 or exists(select 1 from jsonb_each(p_answers) a where a.value->>'state'='unconfirmed')
 or not exists(select 1 from jsonb_each(p_answers) a where a.value->>'state'='recorded') then return false; end if;
 select count(distinct split_part(key,'.',1)) into section_count from jsonb_each(private.taipei_abcd_field_spec()->p_form);
 if (select count(*) from jsonb_object_keys(p_checklist))<>section_count then return false; end if;
 for section in select distinct split_part(key,'.',1) from jsonb_each(private.taipei_abcd_field_spec()->p_form) loop
  item:=p_checklist->section;
  if item is null or jsonb_typeof(item)<>'object' or item-array['confirmed','pendingReason']<>'{}'::jsonb
   or not item?&array['confirmed','pendingReason'] or item->'confirmed'<>'true'::jsonb then return false; end if;
  select count(*) into missing_count from jsonb_each(private.taipei_abcd_field_spec()->p_form) f where split_part(f.key,'.',1)=section
   and coalesce(p_answers->f.key->>'state','missing')='missing';
  if missing_count>0 then
   if jsonb_typeof(item->'pendingReason') is distinct from 'string' or char_length(btrim(item->>'pendingReason')) not between 3 and 1000 then return false; end if;
  elsif item->'pendingReason'<>'null'::jsonb then return false; end if;
  if coalesce(item->>'pendingReason','')~'[[:cntrl:]]' then return false; end if;
 end loop;
 return true;
end; $$;

create function private.taipei_abcd_transition(p_org uuid,p_branch uuid,p_input jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare old private.taipei_abcd_draft_versions; result private.taipei_abcd_draft_versions; ev private.taipei_abcd_review_events; prior private.taipei_abcd_review_events;
 action text; reason text; key uuid; input_hash text; seq integer; state text; submitter uuid; checklist jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Authenticated actor required'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not p_input?&array['clientId','draftId','contentHash','expectedSequence','action','reason','checklist','idempotency_key']
 or p_input-array['clientId','draftId','contentHash','expectedSequence','action','reason','checklist','idempotency_key']<>'{}'::jsonb
 or jsonb_typeof(p_input->'expectedSequence') is distinct from 'number' or (p_input->>'expectedSequence')!~'^[0-9]{1,7}$'
 or jsonb_typeof(p_input->'reason') is distinct from 'string' or char_length(btrim(p_input->>'reason')) not between 3 and 1000 or (p_input->>'reason')~'[[:cntrl:]]'
 or p_input->>'action' not in ('submit','return','approve','correct') then raise exception using errcode='22023',message='Invalid administrative operation'; end if;
 select * into old from private.taipei_abcd_draft_versions where id=(p_input->>'draftId')::uuid and client_id=(p_input->>'clientId')::uuid and organization_id=p_org and branch_id=p_branch;
 if not found then raise exception using errcode='42501',message='Draft outside scope'; end if;
 perform private.taipei_abcd_require_scope(p_org,p_branch,old.client_id,old.form,true);
 action:=p_input->>'action'; reason:=btrim(p_input->>'reason'); key:=(p_input->>'idempotency_key')::uuid;
 if key is null or old.content_hash is distinct from p_input->>'contentHash' then raise exception using errcode='40001',message='Draft identity changed'; end if;
 if action in ('return','approve') and not private.taipei_abcd_is_reviewer(p_org,p_branch) then raise exception using errcode='42501',message='Administrative supervisor required'; end if;
 input_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('taipei-abcd-review-key:'||auth.uid()::text||':'||key::text,0));
 select * into prior from private.taipei_abcd_review_events where actor_user_id=auth.uid() and idempotency_key=key;
 if found then
  if prior.input_hash<>input_hash then raise exception using errcode='23505',message='Review replay conflict'; end if;
  return jsonb_build_object('eventId',prior.id,'draftId',prior.draft_id,'state',prior.state,'sequence',prior.sequence,'idempotencyKey',key,'replayed',true,'isElectronicSignature',false);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('taipei-abcd-chain:'||p_org::text||':'||p_branch::text||':'||old.client_id::text||':'||old.form||':'||old.usage_year::text||':'||old.month::text,0));
 if exists(select 1 from private.taipei_abcd_draft_versions where previous_version_id=old.id) then raise exception using errcode='40001',message='Only latest draft can transition'; end if;
 select coalesce(max(sequence),0) into seq from private.taipei_abcd_review_events where draft_id=old.id;
 state:=private.taipei_abcd_review_state(old.id);
 if seq<>(p_input->>'expectedSequence')::integer then raise exception using errcode='40001',message='Review version changed'; end if;
 checklist:=p_input->'checklist';
 if action='submit' then
  if state not in ('draft','returned') or not private.taipei_abcd_checklist_valid(old.form,old.answers,checklist) then raise exception using errcode='22023',message='Confirm every section and resolve source suggestions before submission'; end if;
  state:='submitted';
 elsif action in ('return','approve') then
  select e.actor_user_id into submitter from private.taipei_abcd_review_events e where e.draft_id=old.id and e.action='submit' order by e.sequence desc limit 1;
  if state<>'submitted' or submitter=auth.uid() or old.actor_user_id=auth.uid() then raise exception using errcode='42501',message='Independent reviewer required for submitted snapshot'; end if;
  if checklist<>'{}'::jsonb then raise exception using errcode='22023',message='Review must retain submitted checklist'; end if;
  select e.checklist into checklist from private.taipei_abcd_review_events e where draft_id=old.id and e.action='submit' order by sequence desc limit 1;
  state:=case when action='return' then 'returned' else 'approved' end;
 else
  if state<>'approved' or checklist<>'{}'::jsonb then raise exception using errcode='55000',message='Correction requires approved predecessor and reason'; end if;
  insert into private.taipei_abcd_draft_versions(organization_id,branch_id,client_id,form,usage_year,month,template_key,source_revision,source_sha256,
   version,previous_version_id,answers,source_snapshot,content_hash,actor_user_id)
  values(p_org,p_branch,old.client_id,old.form,old.usage_year,old.month,old.template_key,old.source_revision,old.source_sha256,old.version+1,old.id,old.answers,old.source_snapshot,
   encode(sha256(convert_to(jsonb_build_object('correctionOf',old.id,'previousHash',old.content_hash,'version',old.version+1,'reason',reason)::text,'UTF8')),'hex'),auth.uid()) returning * into result;
  state:='draft'; seq:=0;
 end if;
 insert into private.taipei_abcd_review_events(draft_id,organization_id,branch_id,client_id,sequence,action,state,actor_user_id,reason,checklist,correction_of,input_hash,idempotency_key)
 values(coalesce(result.id,old.id),p_org,p_branch,old.client_id,seq+1,action,state,auth.uid(),reason,checklist,case when action='correct' then old.id end,input_hash,key) returning * into ev;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),case when action='correct' then 'correct' else 'insert' end,'taipei_abcd_review_events',ev.id::text,array['administrative_state'],jsonb_build_object('state',state,'is_electronic_signature',false));
 return jsonb_build_object('eventId',ev.id,'draftId',ev.draft_id,'state',state,'sequence',ev.sequence,'idempotencyKey',key,'replayed',false,'isElectronicSignature',false);
end; $$;
create function public.taipei_abcd_transition(p_expected_organization_id uuid,p_expected_branch_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.taipei_abcd_transition(p_expected_organization_id,p_expected_branch_id,p_input); $$;

revoke all on function private.taipei_abcd_review_state(uuid),private.taipei_abcd_is_reviewer(uuid,uuid),private.taipei_abcd_review_json(uuid),private.taipei_abcd_checklist_valid(text,jsonb,jsonb),private.taipei_abcd_transition(uuid,uuid,jsonb),public.taipei_abcd_transition(uuid,uuid,jsonb),private.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid),private.taipei_abcd_draft_snapshot(uuid,uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.taipei_abcd_transition(uuid,uuid,jsonb),public.taipei_abcd_transition(uuid,uuid,jsonb),private.save_taipei_abcd_draft(uuid,uuid,jsonb,uuid),private.taipei_abcd_draft_snapshot(uuid,uuid,uuid,text,integer,integer) to authenticated;
create table private.taipei_abcd_export_snapshots (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 draft_id uuid not null references private.taipei_abcd_draft_versions(id), actor_user_id uuid not null references auth.users(id),
 font_asset_key text not null check(font_asset_key='taipei-crosswalk-font-v1'), snapshot jsonb not null, snapshot_hash text not null,
 input_hash text not null, idempotency_key uuid not null, created_at timestamptz not null default clock_timestamp(),
 unique(actor_user_id,idempotency_key), foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id)
);
create index taipei_export_scope_idx on private.taipei_abcd_export_snapshots(organization_id,branch_id,client_id);
create index taipei_export_draft_idx on private.taipei_abcd_export_snapshots(draft_id);
alter table private.taipei_abcd_export_snapshots enable row level security;
alter table private.taipei_abcd_export_snapshots force row level security;
revoke all on private.taipei_abcd_export_snapshots from public,anon,authenticated,service_role;
create trigger taipei_exports_immutable before update or delete on private.taipei_abcd_export_snapshots for each row execute function private.abcd_assessment_history_is_append_only();
create function private.taipei_abcd_export(p_org uuid,p_branch uuid,p_input jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare draft private.taipei_abcd_draft_versions; result private.taipei_abcd_export_snapshots;
 key uuid; input_hash text; seq integer; payload jsonb; review jsonb;
begin
 if auth.uid() is null or not private.has_recent_aal2(15) then raise exception using errcode='42501',message='Recent personal reauthentication required for export'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not p_input?&array['clientId','draftId','contentHash','expectedSequence','idempotency_key']
 or p_input-array['clientId','draftId','contentHash','expectedSequence','idempotency_key']<>'{}'::jsonb
 or jsonb_typeof(p_input->'expectedSequence') is distinct from 'number' or (p_input->>'expectedSequence')!~'^[0-9]{1,7}$' then raise exception using errcode='22023',message='Invalid export identity'; end if;
 select * into draft from private.taipei_abcd_draft_versions where id=(p_input->>'draftId')::uuid and client_id=(p_input->>'clientId')::uuid and organization_id=p_org and branch_id=p_branch;
 if not found then raise exception using errcode='42501',message='Export outside client scope'; end if;
 perform private.taipei_abcd_require_scope(p_org,p_branch,draft.client_id,draft.form,false);
 if not private.can_staff_access_client(draft.client_id,'document_printing.manage') or not private.can_staff_access_client(draft.client_id,'document_printing.access')
 or not private.can_staff_access_client(draft.client_id,'document_printing.read') then raise exception using errcode='42501',message='Export permission denied'; end if;
 key:=(p_input->>'idempotency_key')::uuid;
 if key is null or draft.content_hash is distinct from p_input->>'contentHash' then raise exception using errcode='40001',message='Export version mismatch'; end if;
 input_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('taipei-abcd-export-key:'||auth.uid()::text||':'||key::text,0));
 select * into result from private.taipei_abcd_export_snapshots where actor_user_id=auth.uid() and idempotency_key=key;
 if found then
  if result.input_hash<>input_hash then raise exception using errcode='23505',message='Export replay mismatch'; end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('taipei-abcd-chain:'||p_org::text||':'||p_branch::text||':'||draft.client_id::text||':'||draft.form||':'||draft.usage_year::text||':'||draft.month::text,0));
  review:=private.taipei_abcd_review_json(draft.id); seq:=(review->>'sequence')::integer;
  if seq<>(p_input->>'expectedSequence')::integer then raise exception using errcode='40001',message='Review snapshot changed'; end if;
  select jsonb_build_object('draft',private.taipei_abcd_draft_json(draft),'workflow',review,'generatedAt',clock_timestamp(),
   'sourceRevision',draft.source_revision,'sourceSha256',draft.source_sha256,'templateKey',draft.template_key,
   'organization',jsonb_build_object('organizationId',o.id,'organizationName',o.name,'branchId',b.id,'branchName',b.name),
   'client',jsonb_build_object('clientId',c.id,'displayName',c.display_name,'clientCode',c.client_code),
   'isElectronicSignature',false,'isOfficialComplete',false,'rendererVersion','taipei-crosswalk-v1','fontAssetKey','taipei-crosswalk-font-v1') into payload
   from public.clients c join public.organizations o on o.id=c.organization_id join public.branches b on b.id=c.branch_id
   where c.id=draft.client_id and c.organization_id=p_org and c.branch_id=p_branch;
  insert into private.taipei_abcd_export_snapshots(organization_id,branch_id,client_id,draft_id,actor_user_id,font_asset_key,snapshot,snapshot_hash,input_hash,idempotency_key)
   values(p_org,p_branch,draft.client_id,draft.id,auth.uid(),'taipei-crosswalk-font-v1',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),input_hash,key) returning * into result;
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'export','taipei_abcd_export_snapshots',result.id::text,array['snapshot'],jsonb_build_object('draft_version',draft.version,'review_sequence',p_input->'expectedSequence','is_electronic_signature',false));
 if result.snapshot_hash is distinct from encode(sha256(convert_to(result.snapshot::text,'UTF8')),'hex') then raise exception using errcode='55000',message='Export snapshot integrity mismatch'; end if;
 return jsonb_build_object('id',result.id,'snapshot',result.snapshot,'snapshotHash',result.snapshot_hash,'fontAssetKey',result.font_asset_key);
end; $$;
create function public.taipei_abcd_export(p_expected_organization_id uuid,p_expected_branch_id uuid,p_input jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.taipei_abcd_export(p_expected_organization_id,p_expected_branch_id,p_input); $$;
revoke all on function private.taipei_abcd_export(uuid,uuid,jsonb),public.taipei_abcd_export(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.taipei_abcd_export(uuid,uuid,jsonb),public.taipei_abcd_export(uuid,uuid,jsonb) to authenticated;
commit;
