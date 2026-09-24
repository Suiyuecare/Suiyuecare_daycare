-- Custom publication revision: immutable submitted content, withdrawal/return,
-- and a fresh independently approved request after an explicit saved revision.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table private.custom_form_publication_snapshots (
 request_id uuid primary key references public.form_publication_requests(id) on delete restrict,
 form_version_id uuid not null references public.form_versions(id) on delete restrict,
 base_revision integer not null check(base_revision>0),
 previous_request_id uuid references public.form_publication_requests(id) on delete restrict,
 content jsonb not null check(jsonb_typeof(content)='object'),
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
 check(content_hash=encode(sha256(convert_to(content::text,'UTF8')),'hex'))
);
create index custom_publication_snapshot_version_idx on private.custom_form_publication_snapshots(form_version_id);
create index custom_publication_snapshot_previous_idx on private.custom_form_publication_snapshots(previous_request_id) where previous_request_id is not null;
create table private.custom_form_publication_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.form_publication_requests(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 branch_id uuid not null,
 form_version_id uuid not null references public.form_versions(id) on delete restrict,
 action text not null check(action in ('request','approve','withdraw','return')),
 actor_id uuid not null references auth.users(id) on delete restrict,
 challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
 reason text,
 form_content_hash text not null check(form_content_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null,
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 check((action in ('request','approve') and reason is null) or (action in ('withdraw','return')
  and reason=btrim(reason) and length(reason) between 5 and 1000 and reason !~ '[<>[:cntrl:]]'))
);
create unique index custom_publication_one_request_event on private.custom_form_publication_events(request_id) where action='request';
create unique index custom_publication_one_decision_event on private.custom_form_publication_events(request_id) where action<>'request';
create index custom_publication_event_version_idx on private.custom_form_publication_events(form_version_id,created_at,id);
create index custom_publication_event_actor_idx on private.custom_form_publication_events(actor_id);
create index custom_publication_event_challenge_idx on private.custom_form_publication_events(challenge_id);
create index custom_publication_event_branch_idx on private.custom_form_publication_events(branch_id,organization_id);
create table private.custom_form_publication_receipts (
 organization_id uuid not null references public.organizations(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 idempotency_key uuid not null,
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 event_id uuid not null references private.custom_form_publication_events(id) on delete restrict,
 primary key(organization_id,actor_id,idempotency_key)
);
create index custom_publication_receipt_actor_idx on private.custom_form_publication_receipts(actor_id);
create index custom_publication_receipt_event_idx on private.custom_form_publication_receipts(event_id);
alter table private.custom_form_publication_snapshots enable row level security;
alter table private.custom_form_publication_snapshots force row level security;
alter table private.custom_form_publication_events enable row level security;
alter table private.custom_form_publication_events force row level security;
alter table private.custom_form_publication_receipts enable row level security;
alter table private.custom_form_publication_receipts force row level security;
revoke all on private.custom_form_publication_snapshots,private.custom_form_publication_events,private.custom_form_publication_receipts from public,anon,authenticated,service_role;
create function private.prevent_append_only_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='55000',message='publication evidence is append only'; end;$$;
revoke all on function private.prevent_append_only_mutation() from public,anon,authenticated,service_role;
create trigger custom_publication_snapshot_immutable before update or delete on private.custom_form_publication_snapshots for each row execute function private.prevent_append_only_mutation();
create trigger custom_publication_event_immutable before update or delete on private.custom_form_publication_events for each row execute function private.prevent_append_only_mutation();
create trigger custom_publication_receipt_immutable before update or delete on private.custom_form_publication_receipts for each row execute function private.prevent_append_only_mutation();

create function private.custom_publication_content(p_version uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schema_version',1,'organization_id',d.organization_id,'form_definition_id',d.id,
 'form_key',d.form_key,'name',d.name,'category',d.category,'is_official',d.is_official,
 'form_version_id',v.id,'version',v.version,'effective_from',v.effective_from,'effective_to',v.effective_to,
 'schema_json',v.schema_json,'scoring_json',v.scoring_json)
 from public.form_versions v join public.form_definitions d on d.id=v.form_definition_id where v.id=p_version;
$$;
create function private.custom_publication_payload(p_content jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('formKey',p_content->'form_key','name',p_content->'name','category',p_content->'category',
 'effectiveFrom',p_content->'effective_from','effectiveTo',p_content->'effective_to','schema',p_content->'schema_json');
$$;
-- A namespace is not a capability declaration. Legacy forms may share the
-- prefix yet contain another schema/clinical scoring. One predicate drives
-- both the UI capability flag and the v2 RPC boundary.
create function private.custom_publication_builder_eligible(p_version uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v public.form_versions%rowtype; d public.form_definitions%rowtype;
begin
 select * into v from public.form_versions where id=p_version;
 if not found then return false; end if;
 select * into d from public.form_definitions where id=v.form_definition_id;
 if not found or d.is_official or d.organization_id is null
  or d.form_key !~ '^tenant\.custom\.[a-z][a-z0-9_]{1,59}$'
  or v.schema_json->>'builder' is distinct from 'tenant-custom.v1' or v.scoring_json<>'{}'::jsonb
 then return false; end if;
 perform private.validate_custom_form_payload(private.custom_publication_payload(private.custom_publication_content(v.id)));
 return true;
exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
create function private.custom_publication_event_json(e private.custom_form_publication_events)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'action',e.action,'requestId',e.request_id,'formVersionId',e.form_version_id,
 'branchId',e.branch_id,'actorId',e.actor_id,'byCurrentUser',e.actor_id=auth.uid(),'reason',e.reason,
 'formContentHash',e.form_content_hash,'createdAt',e.created_at);
$$;

-- Existing requests have never been editable. Backfill only byte-equivalent
-- canonical content; a mismatched legacy row stops migration, never guesses.
insert into private.custom_form_publication_snapshots(request_id,form_version_id,base_revision,content,content_hash)
 select q.id,q.form_version_id,v.draft_revision,private.custom_publication_content(v.id),q.form_content_hash
 from public.form_publication_requests q join public.form_versions v on v.id=q.form_version_id;
insert into private.custom_form_publication_events(request_id,organization_id,branch_id,form_version_id,action,actor_id,challenge_id,form_content_hash,created_at)
 select id,organization_id,branch_id,form_version_id,'request',requested_by,requested_reauth_challenge_id,form_content_hash,requested_at from public.form_publication_requests;
insert into private.custom_form_publication_events(request_id,organization_id,branch_id,form_version_id,action,actor_id,challenge_id,form_content_hash,created_at)
 select id,organization_id,branch_id,form_version_id,'approve',approved_by,approved_reauth_challenge_id,form_content_hash,approved_at from public.form_publication_requests where status='approved';

alter table public.form_publication_requests drop constraint form_publication_requests_status_check;
alter table public.form_publication_requests add constraint form_publication_requests_status_check check(status in ('pending','approved','withdrawn','returned'));
alter table public.form_publication_requests drop constraint form_publication_requests_approval_check;
alter table public.form_publication_requests add constraint form_publication_requests_approval_check check(
 (status in ('pending','withdrawn','returned') and approved_by is null and approved_at is null and approved_reauth_challenge_id is null and approval_idempotency_key is null and approval_hash is null)
 or(status='approved' and approved_by is not null and approved_by<>requested_by and approved_at is not null
 and approved_reauth_challenge_id is not null and approved_reauth_challenge_id<>requested_reauth_challenge_id
 and approval_idempotency_key is not null and approval_hash~'^[a-f0-9]{64}$'));

create or replace function private.protect_form_publication_request()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='55000',message='form publication requests are immutable'; end if;
 if old.status<>'pending' or new.status not in ('approved','withdrawn','returned')
  or (to_jsonb(new)-array['status','approved_by','approved_at','approved_reauth_challenge_id','approval_idempotency_key','approval_hash','updated_at'])
   is distinct from (to_jsonb(old)-array['status','approved_by','approved_at','approved_reauth_challenge_id','approval_idempotency_key','approval_hash','updated_at'])
 then raise exception using errcode='55000',message='form publication request identity and evidence are immutable'; end if;
 if new.status in ('withdrawn','returned') and not exists(select 1 from private.custom_form_publication_events e
  where e.request_id=old.id and e.action=case new.status when 'withdrawn' then 'withdraw' else 'return' end
  and e.form_content_hash=old.form_content_hash and e.organization_id=old.organization_id
  and e.form_version_id=old.form_version_id and e.actor_id=auth.uid()
  and ((e.action='withdraw' and e.actor_id=old.requested_by) or(e.action='return' and e.actor_id<>old.requested_by and e.challenge_id<>old.requested_reauth_challenge_id)))
 then raise exception using errcode='55000',message='immutable publication decision evidence required'; end if;
 return new;
end;$$;

create function private.capture_custom_publication_evidence()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v public.form_versions%rowtype; previous public.form_publication_requests%rowtype;
 prior_revision integer; snapshot jsonb;
begin
 if tg_op='INSERT' then
  select * into v from public.form_versions where id=new.form_version_id;
  select * into previous from public.form_publication_requests where form_version_id=new.form_version_id and id<>new.id order by requested_at desc,id desc limit 1;
  if previous.id is not null then
   select base_revision into prior_revision from private.custom_form_publication_snapshots where request_id=previous.id;
   if previous.status not in ('withdrawn','returned') or v.draft_revision<=prior_revision or new.form_content_hash=previous.form_content_hash then
    raise exception using errcode='40001',message='save a revised draft before requesting another review'; end if;
  end if;
  snapshot:=private.custom_publication_content(v.id);
  insert into private.custom_form_publication_snapshots(request_id,form_version_id,base_revision,previous_request_id,content,content_hash)
   values(new.id,v.id,v.draft_revision,previous.id,snapshot,new.form_content_hash);
  insert into private.custom_form_publication_events(request_id,organization_id,branch_id,form_version_id,action,actor_id,challenge_id,form_content_hash,created_at)
   values(new.id,new.organization_id,new.branch_id,v.id,'request',new.requested_by,new.requested_reauth_challenge_id,new.form_content_hash,new.requested_at);
 elsif new.status='approved' then
  insert into private.custom_form_publication_events(request_id,organization_id,branch_id,form_version_id,action,actor_id,challenge_id,form_content_hash,created_at)
   values(new.id,new.organization_id,new.branch_id,new.form_version_id,'approve',new.approved_by,new.approved_reauth_challenge_id,new.form_content_hash,new.approved_at);
 end if;
 return new;
end;$$;
create trigger custom_publication_capture after insert or update on public.form_publication_requests for each row execute function private.capture_custom_publication_evidence();

-- Every writer (including legacy endpoints) shares definition -> version ->
-- request ordering. Readers that load editable drafts use that same barrier.
create function private.lock_custom_publication_version(p_org uuid,p_branch uuid,p_version uuid,p_write boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
declare definition_id uuid;
begin
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,p_write);
 select d.id into definition_id from public.form_definitions d join public.form_versions v on v.form_definition_id=d.id
  where v.id=p_version and d.organization_id=p_org and not d.is_official;
 if definition_id is null then raise exception using errcode='42501',message='official or cross-tenant forms cannot be published by a tenant'; end if;
 perform pg_advisory_xact_lock(hashtextextended('form-publish-definition:'||definition_id::text,0));
 if p_write then perform 1 from public.form_versions where id=p_version for update;
 else perform 1 from public.form_versions where id=p_version for share; end if;
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,p_write);
end;$$;

do $$ declare source text; changed text; signature text; begin
 source:=pg_get_functiondef('private.request_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure);
 if strpos(source,E'  select version.* into v_version\n')=0 or strpos(source,E'  if found then\n    if v_existing.branch_id')=0 then raise exception 'publication request anchors missing'; end if;
 changed:=replace(source,E'  select version.* into v_version\n',E'  perform private.lock_custom_publication_version(p_expected_organization_id,p_expected_branch_id,p_form_version_id,true);\n  select version.* into v_version\n');
 -- A legacy retry cannot accidentally submit the edited draft again. Its old
 -- success shape does not support terminal states, so fail closed explicitly.
 changed:=replace(changed,E'  if found then\n    if v_existing.branch_id',E'  if found then\n    if v_existing.status in (''withdrawn'',''returned'') then raise exception using errcode=''23514'',message=''original publication request is closed''; end if;\n    if v_existing.branch_id');
 if changed=source then raise exception 'publication request lock anchor missing'; end if; execute changed;
 source:=pg_get_functiondef('private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure);
 if strpos(source,E'  select request.* into v_request\n')=0 or strpos(source,E'  if v_request.requested_by = v_actor then')=0 then raise exception 'publication approval anchors missing'; end if;
 changed:=replace(source,E'  select request.* into v_request\n',E'  perform private.lock_custom_publication_version(p_expected_organization_id,p_expected_branch_id,(select q.form_version_id from public.form_publication_requests q where q.id=p_request_id and q.organization_id=p_expected_organization_id),true);\n  select request.* into v_request\n');
 changed:=replace(changed,E'  if v_request.requested_by = v_actor then',E'  if v_request.status <> ''pending'' then raise exception using errcode=''23514'',message=''publication request is no longer pending''; end if;\n  if v_request.requested_by = v_actor then');
 if changed=source then raise exception 'publication approval lock anchor missing'; end if; execute changed;
 foreach signature in array array['private.save_custom_form_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb)','private.read_custom_form_draft_response(uuid,uuid,uuid)'] loop
  source:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(source,'q.form_version_id=v.id)','q.form_version_id=v.id and q.status in (''pending'',''approved''))');
  if changed=source then raise exception 'draft terminal unlock anchor missing'; end if;
  if signature like '%save_%' then
   if strpos(changed,E' else\n  -- Same version')=0 then raise exception 'draft write lock anchor missing'; end if;
   changed:=replace(changed,E' else\n  -- Same version',E' else\n  perform private.lock_custom_publication_version(p_expected_organization_id,p_expected_branch_id,p_form_version_id,true);\n  -- Same version');
  else
   if strpos(changed,E' select * into v from public.form_versions')=0 then raise exception 'draft read lock anchor missing'; end if;
   changed:=replace(changed,E' select * into v from public.form_versions',E' perform private.lock_custom_publication_version(p_expected_organization_id,p_expected_branch_id,p_form_version_id,false);\n select * into v from public.form_versions');
  end if;
  execute changed;
 end loop;
end;$$;

create function private.write_custom_form_publication_v2_atomic(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); kind text; version_id uuid; request_id uuid; revision integer; reason text; fingerprint text;
 v public.form_versions%rowtype; d public.form_definitions%rowtype; q public.form_publication_requests%rowtype;
 e private.custom_form_publication_events%rowtype; receipt private.custom_form_publication_receipts%rowtype;
 legacy record; challenge uuid; stamp timestamptz;
begin
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
 if p_key is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192
  or p_input-array['action','formVersionId','requestId','baseRevision','reason']<>'{}'::jsonb
  or not(p_input ?& array['action','formVersionId','requestId','baseRevision','reason'])
  or not coalesce(p_input->>'action' in ('request','approve','withdraw','return'),false)
 then raise exception using errcode='22023',message='invalid publication operation'; end if;
 begin
  kind:=p_input->>'action'; version_id:=(p_input->>'formVersionId')::uuid; request_id:=(p_input->>'requestId')::uuid;
  revision:=(p_input->>'baseRevision')::integer; reason:=p_input->>'reason';
 exception when others then raise exception using errcode='22023',message='invalid publication identity'; end;
 if version_id is null or ((kind='request')<>(request_id is null))
  or (kind='request' and (revision is null or revision<1 or jsonb_typeof(p_input->'baseRevision')<>'number'))
  or (kind<>'request' and revision is not null)
  or (kind in ('withdraw','return') and (not private.custom_form_plain_text(p_input->'reason',1000) or length(reason)<5))
  or (kind in ('request','approve') and reason is not null)
 then raise exception using errcode='22023',message='invalid publication fields'; end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('custom-publication-v2:'||p_org::text||':'||actor::text||':'||p_key::text,0));
 perform private.lock_custom_publication_version(p_org,p_branch,version_id,true);
 select * into v from public.form_versions where id=version_id;
 select * into d from public.form_definitions where id=v.form_definition_id;
 if not private.custom_publication_builder_eligible(v.id)
 then raise exception using errcode='42501',message='only custom nonclinical forms are governed here'; end if;
 select * into receipt from private.custom_form_publication_receipts where organization_id=p_org and actor_id=actor and idempotency_key=p_key;
 if found then
  if receipt.request_hash<>fingerprint then raise exception using errcode='23505',message='publication idempotency conflict'; end if;
  select * into e from private.custom_form_publication_events where id=receipt.event_id;
  select * into q from public.form_publication_requests where id=e.request_id for update;
 else
  if kind='request' then
   if v.status<>'draft' or v.draft_revision<>revision then raise exception using errcode='40001',message='review the current saved draft revision before submitting'; end if;
   perform private.validate_custom_form_payload(private.custom_publication_payload(private.custom_publication_content(v.id)));
   select * into legacy from private.request_form_publication_atomic(p_org,p_branch,v.id,p_key);
   select * into q from public.form_publication_requests where id=legacy.request_id for update;
   select * into e from private.custom_form_publication_events event where event.request_id=q.id and event.action='request';
  else
   select * into q from public.form_publication_requests where id=request_id and organization_id=p_org and form_version_id=v.id for update;
   if not found then raise exception using errcode='42501',message='publication request outside selected version'; end if;
   if q.status<>'pending' or v.status<>'draft' then raise exception using errcode='23514',message='publication request is no longer pending'; end if;
   if kind='approve' then
    -- The legacy approval must be invoked in its request branch. Current actor
    -- remains the same org-wide manager and is checked against BOTH branches.
    select * into legacy from private.approve_form_publication_atomic(p_org,q.branch_id,q.id,p_key);
    select * into e from private.custom_form_publication_events event where event.request_id=q.id and event.action='approve';
    q.status:='approved';
   else
    challenge:=private.custom_governance_reauth_challenge(); stamp:=clock_timestamp();
    if (kind='withdraw' and q.requested_by<>actor) or (kind='return' and (q.requested_by=actor or q.requested_reauth_challenge_id=challenge))
     then raise exception using errcode='42501',message='requester withdrawal or independent return required'; end if;
    insert into private.custom_form_publication_events(request_id,organization_id,branch_id,form_version_id,action,actor_id,challenge_id,reason,form_content_hash,created_at)
     values(q.id,p_org,p_branch,v.id,kind,actor,challenge,reason,q.form_content_hash,stamp) returning * into e;
    update public.form_publication_requests set status=case kind when 'withdraw' then 'withdrawn' else 'returned' end where id=q.id returning * into q;
   end if;
  end if;
  if e.id is null then raise exception using errcode='55000',message='publication evidence missing'; end if;
  insert into private.custom_form_publication_receipts values(p_org,actor,p_key,fingerprint,e.id);
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,actor,'select','custom_form_publication_v2',q.id::text,'{}',jsonb_build_object('operation',kind,'event_id',e.id,'replayed',receipt.event_id is not null));
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
 -- A fresh operation must still be supported by the exact proof captured in
 -- its immutable event after every audit wait. A different, newer proof must
 -- not silently rescue an expired decision. Historical receipt replays only
 -- require current live authority above, never re-date old signature evidence.
 if receipt.event_id is null and not exists(
  select 1 from private.reauth_events proof join private.reauth_challenges challenge
   on challenge.id=proof.challenge_id and challenge.user_id=proof.user_id and challenge.session_id=proof.session_id
  where challenge.id=e.challenge_id and proof.user_id=actor and proof.session_id=(auth.jwt()->>'session_id')::uuid
   and proof.aal='aal2' and proof.revoked_at is null and proof.verification_method in ('totp','webauthn','phone')
   and challenge.consumed_at is not null and challenge.invalidated_at is null
   and challenge.factor_method=proof.verification_method and challenge.factor_verified_at=proof.verified_at
   and challenge.factor_verified_at>=clock_timestamp()-interval '15 minutes'
   and challenge.factor_verified_at<=clock_timestamp()+interval '1 minute'
 ) then raise exception using errcode='42501',message='original publication decision evidence expired'; end if;
 return jsonb_build_object('event',private.custom_publication_event_json(e),'requestStatus',q.status,'replayed',receipt.event_id is not null);
end;$$;

create function private.read_custom_form_publication_history_v2_scoped(p_org uuid,p_branch uuid,p_version uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.form_versions%rowtype; d public.form_definitions%rowtype; rows jsonb; total integer; editable boolean; payload jsonb;
begin
 perform private.lock_custom_publication_version(p_org,p_branch,p_version,false);
 select * into v from public.form_versions where id=p_version;
 select * into d from public.form_definitions where id=v.form_definition_id;
 if not private.custom_publication_builder_eligible(v.id)
 then raise exception using errcode='42501',message='custom form outside governed scope'; end if;
 select count(*) into total from public.form_publication_requests where form_version_id=v.id;
 select coalesce(jsonb_agg(item order by requested_at desc,id desc),'[]') into rows from(
  select q.id,q.requested_at,jsonb_build_object('id',q.id,'formVersionId',q.form_version_id,'branchId',q.branch_id,'branchName',b.name,
   'baseRevision',s.base_revision,'previousRequestId',s.previous_request_id,'status',q.status,'requestedAt',q.requested_at,
   'requesterId',q.requested_by,'requestedByCurrentUser',q.requested_by=auth.uid(),'formContentHash',q.form_content_hash,
   'payload',private.custom_publication_payload(s.content),'events',(select coalesce(jsonb_agg(private.custom_publication_event_json(e) order by e.created_at,e.id),'[]') from private.custom_form_publication_events e where e.request_id=q.id)) item
  from public.form_publication_requests q join private.custom_form_publication_snapshots s on s.request_id=q.id
  join public.branches b on b.id=q.branch_id where q.form_version_id=v.id order by q.requested_at desc,q.id desc limit 100
 ) selected;
 editable:=v.status='draft' and not exists(select 1 from public.form_publication_requests where form_version_id=v.id and status in ('pending','approved'));
 if editable then payload:=private.custom_publication_payload(private.custom_publication_content(v.id)); perform private.validate_custom_form_payload(payload); end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','custom_form_publication_history_v2',v.id::text,'{}',jsonb_build_object('request_count',total));
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,false);
 return jsonb_build_object('formVersionId',v.id,'currentDraftRevision',v.draft_revision,'currentStatus',v.status,'currentDraft',payload,'requests',rows,'total',total,'truncated',total>100);
end;$$;

create function public.write_custom_form_publication_v2(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.write_custom_form_publication_v2_atomic(p_org,p_branch,p_key,p_input);$$;
create function public.read_custom_form_publication_history_v2(p_org uuid,p_branch uuid,p_version uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.read_custom_form_publication_history_v2_scoped(p_org,p_branch,p_version);$$;

-- V2 is an organization-wide latest-request projection. V1 remains its exact
-- old shape, hiding closed requests with matching totals for rollback clients.
do $$ declare source text; changed text; begin
 source:=pg_get_functiondef('private.form_governance_snapshot_response(uuid,uuid)'::regprocedure);
 changed:=replace(source,'private.form_governance_snapshot_response(','private.form_governance_snapshot_v2_response(');
 changed:=replace(changed,'from public.form_publication_requests request',
  'from (select distinct on (form_version_id) * from public.form_publication_requests order by form_version_id,requested_at desc,id desc) request');
 changed:=replace(changed,E'    and request.branch_id = p_expected_branch_id', '');
 changed:=replace(changed,E'      and request.branch_id = p_expected_branch_id', '');
 changed:=replace(changed,E'      version.version,',E'      version.version,\n      version.draft_revision,\n      private.custom_publication_builder_eligible(version.id) as custom_builder_eligible,');
 changed:=replace(changed,E'''version'', version_row.version,',E'''version'', version_row.version,\n    ''draft_revision'', version_row.draft_revision,\n    ''custom_builder_eligible'',version_row.custom_builder_eligible,');
 changed:=replace(changed,E'''approved_by_current_user'', request_row.approved_by_current_user',E'''approved_by_current_user'', request_row.approved_by_current_user,\n    ''branch_id'',request_row.branch_id,''branch_name'',request_row.branch_name,\n    ''base_revision'',request_row.base_revision,''previous_request_id'',request_row.previous_request_id,\n    ''decision_reason'',request_row.decision_reason,''decided_at'',request_row.decided_at,\n    ''decided_by_current_user'',request_row.decided_by_current_user');
 changed:=replace(changed,E'      request.id,',E'      request.id,\n      request.branch_id,(select b.name from public.branches b where b.id=request.branch_id) as branch_name,\n      (select s.base_revision from private.custom_form_publication_snapshots s where s.request_id=request.id) as base_revision,\n      (select s.previous_request_id from private.custom_form_publication_snapshots s where s.request_id=request.id) as previous_request_id,\n      (select e.reason from private.custom_form_publication_events e where e.request_id=request.id and e.action<>''request'') as decision_reason,\n      (select e.created_at from private.custom_form_publication_events e where e.request_id=request.id and e.action<>''request'') as decided_at,\n      coalesce((select e.actor_id=v_actor from private.custom_form_publication_events e where e.request_id=request.id and e.action<>''request''),false) as decided_by_current_user,');
 changed:=replace(changed,E'  return query select\n',E'  perform private.assert_custom_lifecycle_authority(p_expected_organization_id,p_expected_branch_id,false);\n  return query select\n');
 if changed=source or strpos(changed,'version.draft_revision')=0 or strpos(changed,'''draft_revision''')=0 then raise exception 'v2 snapshot projection anchor missing'; end if;
 execute changed;
 source:=pg_get_functiondef('public.form_governance_snapshot(uuid,uuid)'::regprocedure);
 changed:=replace(replace(source,'public.form_governance_snapshot(','public.form_governance_snapshot_v2('),'private.form_governance_snapshot_response(','private.form_governance_snapshot_v2_response(');
 execute changed;
 source:=pg_get_functiondef('private.form_governance_snapshot_response(uuid,uuid)'::regprocedure);
 changed:=replace(source,'where request.organization_id = p_expected_organization_id',E'where request.organization_id = p_expected_organization_id\n    and request.status in (''pending'',''approved'')');
 changed:=replace(changed,E'  return query select\n',E'  perform private.assert_custom_lifecycle_authority(p_expected_organization_id,p_expected_branch_id,false);\n  return query select\n');
 if changed=source then raise exception 'v1 closed history exclusion anchor missing'; end if; execute changed;
end;$$;

revoke all on function private.custom_publication_content(uuid),private.custom_publication_payload(jsonb),private.custom_publication_event_json(private.custom_form_publication_events),private.capture_custom_publication_evidence(),private.lock_custom_publication_version(uuid,uuid,uuid,boolean),private.write_custom_form_publication_v2_atomic(uuid,uuid,uuid,jsonb),private.read_custom_form_publication_history_v2_scoped(uuid,uuid,uuid),private.form_governance_snapshot_v2_response(uuid,uuid),public.write_custom_form_publication_v2(uuid,uuid,uuid,jsonb),public.read_custom_form_publication_history_v2(uuid,uuid,uuid),public.form_governance_snapshot_v2(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.custom_publication_builder_eligible(uuid) from public,anon,authenticated,service_role;
grant execute on function private.write_custom_form_publication_v2_atomic(uuid,uuid,uuid,jsonb),private.read_custom_form_publication_history_v2_scoped(uuid,uuid,uuid),private.form_governance_snapshot_v2_response(uuid,uuid),public.write_custom_form_publication_v2(uuid,uuid,uuid,jsonb),public.read_custom_form_publication_history_v2(uuid,uuid,uuid),public.form_governance_snapshot_v2(uuid,uuid) to authenticated;
commit;
