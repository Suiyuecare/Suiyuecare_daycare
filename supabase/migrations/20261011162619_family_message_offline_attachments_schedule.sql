begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The same private, content-validated file pipeline is used for a message.
-- A message is immutable; only its original sender can append file evidence.
alter table private.clinical_attachments drop constraint clinical_attachments_source_kind_check;
alter table private.clinical_attachments add constraint clinical_attachments_source_kind_check
 check(source_kind in('care_diary','body_assessment','vaccination','inspection','family_message'));
alter function private.clinical_attachment_source(uuid,uuid,uuid,text,uuid,boolean) rename to clinical_attachment_source_completion_v1;
create function private.clinical_attachment_source(p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_source uuid,p_write boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.family_messages; v_write boolean;
begin
 if p_kind<>'family_message' then return private.clinical_attachment_source_completion_v1(p_org,p_branch,p_client,p_kind,p_source,p_write);end if;
 select * into m from private.family_messages f where f.id=p_source and f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client;
 if not found or auth.uid() is null then raise exception 'MESSAGE_ATTACHMENT_FORBIDDEN' using errcode='42501';end if;
 if exists(select 1 from public.profiles p where p.id=auth.uid() and p.kind='family') then
  perform private.family_client_context(p_org,p_branch,p_client,'messages.read');
  if m.recipient_user_id<>auth.uid() then raise exception 'MESSAGE_ATTACHMENT_FORBIDDEN' using errcode='42501';end if;
  v_write:=m.sender_id=auth.uid() and m.direction='family_to_institution';
 else
  if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(p_client,'clients.read')
   or not private.family_recipient_has_consent(p_org,p_branch,p_client,m.recipient_user_id,'messages.read') then raise exception 'MESSAGE_ATTACHMENT_FORBIDDEN' using errcode='42501';end if;
  v_write:=m.sender_id=auth.uid() and m.direction='institution_to_family';
 end if;
 if p_write and not v_write then raise exception 'MESSAGE_ATTACHMENT_SENDER_ONLY' using errcode='42501';end if;
 return jsonb_build_object('version',1,'state','message','canUpload',v_write);
end;$$;
revoke all on function private.clinical_attachment_source(uuid,uuid,uuid,text,uuid,boolean),private.clinical_attachment_source_completion_v1(uuid,uuid,uuid,text,uuid,boolean) from public,anon,authenticated,service_role;
-- Preserve every existing reservation invariant; widen only the source allowlist.
do $$declare source text;begin
 source:=pg_get_functiondef('private.reserve_clinical_attachment(uuid,uuid,jsonb)'::regprocedure);
 if position($anchor$('care_diary','body_assessment','vaccination','inspection')$anchor$ in source)=0 then raise exception 'clinical reservation allowlist anchor missing';end if;
 source:=replace(source,$anchor$('care_diary','body_assessment','vaccination','inspection')$anchor$,$anchor$('care_diary','body_assessment','vaccination','inspection','family_message')$anchor$);
 execute source;
end;$$;

-- Offline text messages are NEW commands, never edits. A stale thread enters
-- a persisted manual queue, rather than last-write-wins or automatic merging.
create table private.family_message_conflicts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,branch_id uuid not null,client_id uuid not null,
 recipient_user_id uuid not null references public.profiles(id),sender_id uuid not null references public.profiles(id),
 expected_version integer not null check(expected_version>=0),observed_version integer not null check(observed_version>=0),
 body text not null check(char_length(body) between 1 and 2000),created_at timestamptz not null default clock_timestamp(),
 idempotency_key uuid not null,input_hash text not null,unique(sender_id,idempotency_key),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id)
);
create table private.family_message_conflict_reviews(
 conflict_id uuid primary key references private.family_message_conflicts(id),reviewed_by uuid not null references public.profiles(id),
 note text not null check(char_length(btrim(note)) between 1 and 1000),reviewed_at timestamptz not null default clock_timestamp(),
 idempotency_key uuid not null,input_hash text not null,unique(reviewed_by,idempotency_key)
);
create index family_message_conflicts_scope_idx on private.family_message_conflicts(organization_id,branch_id,client_id,recipient_user_id,created_at);
do $$declare t text;begin foreach t in array array['family_message_conflicts','family_message_conflict_reviews'] loop
 execute format('alter table private.%I enable row level security',t);execute format('alter table private.%I force row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger %I before update or delete on private.%I for each row execute function private.client_documents_immutable()',t||'_immutable',t);
end loop;end;$$;
create or replace function private.family_message_write(p_org uuid,p_branch uuid,p_input jsonb,p_staff boolean default false)
returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
declare v_client uuid:=(p_input->>'clientId')::uuid;v_recipient uuid;v_key uuid:=(p_input->>'idempotency_key')::uuid;
 v_body text:=btrim(p_input->>'body');v_hash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');v private.family_messages;c private.family_message_conflicts;v_version integer;v_expected integer;
begin
 if not p_staff then perform private.family_client_context(p_org,p_branch,v_client,'messages.read');v_recipient:=auth.uid();
 else
  if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(v_client,'clients.read') or not exists(select 1 from public.clients cl where cl.id=v_client and cl.organization_id=p_org and cl.branch_id=p_branch) then raise exception 'FAMILY_MESSAGES_FORBIDDEN' using errcode='42501';end if;
  v_recipient:=(p_input->>'recipientUserId')::uuid;
  if not private.family_recipient_has_consent(p_org,p_branch,v_client,v_recipient,'messages.read') then raise exception 'FAMILY_RECIPIENT_CONSENT_REQUIRED' using errcode='42501';end if;
 end if;
 if jsonb_typeof(p_input)<>'object' or p_input-array['action','clientId','recipientUserId','body','expectedVersion','idempotency_key']<>'{}'::jsonb or(not p_staff and p_input?'recipientUserId')
  or v_key is null or v_body is null or char_length(v_body) not between 1 and 2000 or translate(v_body,E'\n\r\t','')~'[[:cntrl:]]'
  or not(p_input?'expectedVersion') or coalesce(p_input->>'expectedVersion','')!~'^(0|[1-9][0-9]{0,8})$' then raise exception 'FAMILY_MESSAGE_INVALID' using errcode='22023';end if;
 v_expected:=(p_input->>'expectedVersion')::integer;
 perform pg_advisory_xact_lock(hashtextextended('family-message:'||auth.uid()||':'||v_key,0));
 -- A lock wait may outlive consent, membership or tenant activation.
 -- Revalidate before revealing an old receipt as well as before new writes.
 if not p_staff then perform private.family_client_context(p_org,p_branch,v_client,'messages.read');
 else
  if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(v_client,'clients.read') or not exists(select 1 from public.clients cl where cl.id=v_client and cl.organization_id=p_org and cl.branch_id=p_branch) then raise exception 'FAMILY_MESSAGES_FORBIDDEN' using errcode='42501';end if;
  if not private.family_recipient_has_consent(p_org,p_branch,v_client,v_recipient,'messages.read') then raise exception 'FAMILY_RECIPIENT_CONSENT_REQUIRED' using errcode='42501';end if;
 end if;
 select * into v from private.family_messages m where m.sender_id=auth.uid() and m.idempotency_key=v_key;
 if found then if v.input_hash<>v_hash or v.client_id<>v_client or v.organization_id<>p_org or v.branch_id<>p_branch then raise exception 'FAMILY_MESSAGE_KEY_CONFLICT' using errcode='40001';end if;
  return query select jsonb_build_object('id',v.id,'replayed',true,'status','saved');return;end if;
 select * into c from private.family_message_conflicts f where f.sender_id=auth.uid() and f.idempotency_key=v_key;
 if found then if c.input_hash<>v_hash or c.client_id<>v_client or c.organization_id<>p_org or c.branch_id<>p_branch then raise exception 'FAMILY_MESSAGE_KEY_CONFLICT' using errcode='40001';end if;
  return query select jsonb_build_object('id',c.id,'replayed',true,'status','conflict');return;end if;
 perform pg_advisory_xact_lock(hashtextextended('family-thread:'||p_org||':'||p_branch||':'||v_client||':'||v_recipient,0));
 if not p_staff then perform private.family_client_context(p_org,p_branch,v_client,'messages.read');
 else
  if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(v_client,'clients.read') or not exists(select 1 from public.clients cl where cl.id=v_client and cl.organization_id=p_org and cl.branch_id=p_branch) then raise exception 'FAMILY_MESSAGES_FORBIDDEN' using errcode='42501';end if;
  if not private.family_recipient_has_consent(p_org,p_branch,v_client,v_recipient,'messages.read') then raise exception 'FAMILY_RECIPIENT_CONSENT_REQUIRED' using errcode='42501';end if;
 end if;
 select count(*)::integer into v_version from private.family_messages m where m.organization_id=p_org and m.branch_id=p_branch and m.client_id=v_client and m.recipient_user_id=v_recipient;
 if v_expected<>v_version then
  insert into private.family_message_conflicts(organization_id,branch_id,client_id,recipient_user_id,sender_id,expected_version,observed_version,body,idempotency_key,input_hash)
   values(p_org,p_branch,v_client,v_recipient,auth.uid(),v_expected,v_version,v_body,v_key,v_hash) returning * into c;
  perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_message_conflicts',c.id,jsonb_build_object('expectedVersion',v_expected,'observedVersion',v_version));
  return query select jsonb_build_object('id',c.id,'replayed',false,'status','conflict');return;
 end if;
 insert into private.family_messages(organization_id,branch_id,client_id,recipient_user_id,sender_id,direction,body,idempotency_key,input_hash)
 values(p_org,p_branch,v_client,v_recipient,auth.uid(),case when p_staff then 'institution_to_family' else 'family_to_institution' end,v_body,v_key,v_hash) returning * into v;
 perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_messages',v.id,'{}'::jsonb);
 return query select jsonb_build_object('id',v.id,'replayed',false,'status','saved');
end;$$;

alter function private.family_workspace(uuid,uuid,uuid) rename to family_workspace_completion_v1;
create function private.family_workspace(p_org uuid,p_branch uuid,p_client uuid) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare v jsonb;v_version integer:=0;begin
 select f.payload into v from private.family_workspace_completion_v1(p_org,p_branch,p_client)f;
 if private.has_current_governed_family_consent(p_client,'messages.read') then select count(*)::integer into v_version from private.family_messages m where m.organization_id=p_org and m.branch_id=p_branch and m.client_id=p_client and m.recipient_user_id=auth.uid();end if;
 return query select v||jsonb_build_object('messageVersion',v_version,'actorScope',jsonb_build_object('organizationId',p_org,'branchId',p_branch,'userId',auth.uid()));
end;$$;
alter function private.family_staff_workspace(uuid,uuid,uuid,uuid) rename to family_staff_workspace_completion_v1;
create function private.family_staff_workspace(p_org uuid,p_branch uuid,p_client uuid,p_recipient uuid default null) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare v jsonb;v_version integer:=0;v_conflicts jsonb:='[]'::jsonb;begin
 select f.payload into v from private.family_staff_workspace_completion_v1(p_org,p_branch,p_client,p_recipient)f;
 if p_recipient is not null then
  select count(*)::integer into v_version from private.family_messages m where m.organization_id=p_org and m.branch_id=p_branch and m.client_id=p_client and m.recipient_user_id=p_recipient;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'body',c.body,'expectedVersion',c.expected_version,'observedVersion',c.observed_version,'at',c.created_at) order by c.created_at),'[]'::jsonb) into v_conflicts
   from(select * from private.family_message_conflicts f where f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client and f.recipient_user_id=p_recipient and not exists(select 1 from private.family_message_conflict_reviews r where r.conflict_id=f.id) order by f.created_at limit 100)c;
 end if;
 return query select v||jsonb_build_object('messageVersion',v_version,'conflicts',v_conflicts);
end;$$;
create function private.family_message_conflict_review(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language plpgsql security definer set search_path='' as $$
declare c private.family_message_conflicts;r private.family_message_conflict_reviews;v_id uuid:=(p_input->>'conflictId')::uuid;v_key uuid:=(p_input->>'idempotency_key')::uuid;v_hash text:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');begin
 select * into c from private.family_message_conflicts f where f.id=v_id and f.organization_id=p_org and f.branch_id=p_branch and f.client_id=(p_input->>'clientId')::uuid;
 if not found or not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(c.client_id,'clients.read')
 or not private.family_recipient_has_consent(p_org,p_branch,c.client_id,c.recipient_user_id,'messages.read') then raise exception 'FAMILY_CONFLICT_REVIEW_FORBIDDEN' using errcode='42501';end if;
 if v_key is null or nullif(btrim(p_input->>'note'),'') is null or char_length(p_input->>'note')>1000 then raise exception 'FAMILY_CONFLICT_REVIEW_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('family-conflict-review:'||v_id,0));
 if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(c.client_id,'clients.read')
 or not private.family_recipient_has_consent(p_org,p_branch,c.client_id,c.recipient_user_id,'messages.read') then raise exception 'FAMILY_CONFLICT_REVIEW_FORBIDDEN' using errcode='42501';end if;
 select * into r from private.family_message_conflict_reviews f where f.reviewed_by=auth.uid() and f.idempotency_key=v_key;
 if found then if r.input_hash<>v_hash then raise exception 'FAMILY_CONFLICT_REVIEW_KEY' using errcode='40001';end if;return query select jsonb_build_object('id',r.conflict_id,'replayed',true);return;end if;
 if exists(select 1 from private.family_message_conflict_reviews f where f.conflict_id=v_id) then raise exception 'FAMILY_CONFLICT_ALREADY_REVIEWED' using errcode='40001';end if;
 insert into private.family_message_conflict_reviews(conflict_id,reviewed_by,note,idempotency_key,input_hash)values(v_id,auth.uid(),btrim(p_input->>'note'),v_key,v_hash);
 perform private.daycare_completion_audit(p_org,p_branch,'INSERT','family_message_conflict_reviews',v_id,'{}'::jsonb);
 return query select jsonb_build_object('id',v_id,'replayed',false);
end;$$;
create function public.family_message_conflict_review(p_org uuid,p_branch uuid,p_input jsonb) returns table(receipt jsonb) language sql security invoker set search_path='' as $$select * from private.family_message_conflict_review(p_org,p_branch,p_input)$$;

-- A single exact-client projection owns BOTH staff and family monthly data.
-- No passenger names, addresses, driver/vehicle identities or clinical notes.
create function private.family_schedule_projection(p_org uuid,p_branch uuid,p_client uuid,p_month date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;begin
 with trips as (
 select p.id,p.version,p.service_date,p.starts_at,p.ends_at,p.direction,p.content_hash,
  c.request_hash cancellation_hash,e.event_type,e.content_hash event_hash,
  case when c.id is not null then 'cancelled' when e.event_type='passenger_alighted' then 'alighted' when e.event_type='passenger_boarded' then 'boarded' when e.event_type='exception_recorded' then 'attention' else 'scheduled' end state
 from public.transport_trip_plan_versions p join public.transport_trip_plan_decisions d on d.trip_version_id=p.id and d.decision in('publish','override')
 left join private.transport_trip_cancellations c on c.trip_key=p.trip_key
 left join lateral(select ev.event_type,ev.content_hash from public.transport_execution_events ev join public.transport_execution_streams s on s.id=ev.stream_id and s.plan_version_id=p.id
  where ev.organization_id=p_org and ev.branch_id=p_branch and ev.client_id=p_client order by ev.sequence desc limit 1)e on true
 where p.organization_id=p_org and p.branch_id=p_branch and p.service_date>=p_month and p.service_date<(p_month+interval '1 month')::date
 and not exists(select 1 from public.transport_trip_plan_versions n where n.trip_key=p.trip_key and n.version>p.version)
 and exists(select 1 from jsonb_array_elements(p.passenger_snapshot)passenger where passenger->>'client_id'=p_client::text)
 ),activities as(
 select distinct a.id,a.version,a.starts_at,a.ends_at,f.title,coalesce((select s.to_status from public.activity_status_events s where s.activity_id=a.activity_id and s.organization_id=p_org and s.branch_id=p_branch order by s.sequence desc limit 1),'scheduled') state,private.family_source_hash(p_org,p_branch,p_client,'schedule',a.id) source_hash
 from private.family_publications f join public.activity_schedule_versions a on a.id=f.source_id
 where f.organization_id=p_org and f.branch_id=p_branch and f.client_id=p_client and f.category='schedule'
 and (a.starts_at at time zone 'Asia/Taipei')::date>=p_month and (a.starts_at at time zone 'Asia/Taipei')::date<(p_month+interval '1 month')::date
 and not exists(select 1 from private.family_publication_withdrawals w where w.publication_id=f.id)
 and not exists(select 1 from public.activity_schedule_versions n where n.activity_id=a.activity_id and n.version>a.version)
 and exists(select 1 from jsonb_array_elements(a.participants)p where p->>'client_id'=p_client::text)
 -- Preserve the exact approved schedule version but reflect subsequent
 -- cancellation/completion from the same authoritative status stream.
 and f.source_hash=encode(sha256(convert_to(a.content_hash||':'||coalesce((select s.content_hash from public.activity_status_events s where s.activity_id=a.activity_id and s.organization_id=p_org and s.branch_id=p_branch and s.changed_at<=f.published_at order by s.sequence desc limit 1),'scheduled'),'UTF8')),'hex')
 ),rows as(
 select id,starts_at,jsonb_build_object('id',id,'kind','transport','version',version,'date',service_date,'startsAt',starts_at,'endsAt',ends_at,'direction',direction,'title',case direction when 'pickup' then '到站接送' else '返家接送' end,'status',state,'sourceHash',encode(sha256(convert_to(content_hash||':'||coalesce(cancellation_hash,'')||':'||coalesce(event_hash,''),'UTF8')),'hex'))row from trips
 union all select id,starts_at,jsonb_build_object('id',id,'kind','activity','version',version,'date',(starts_at at time zone 'Asia/Taipei')::date,'startsAt',starts_at,'endsAt',ends_at,'direction',null,'title',title,'status',case when state='cancelled' then 'cancelled' when state='completed' then 'completed' else 'scheduled' end,'sourceHash',source_hash) from activities
 ) select coalesce(jsonb_agg(row order by starts_at,id),'[]'::jsonb) into v_rows from rows;
 if jsonb_array_length(v_rows)>1000 then raise exception 'FAMILY_MONTHLY_LIMIT' using errcode='54000';end if;
 return jsonb_build_object('clientId',p_client,'month',to_char(p_month,'YYYY-MM'),'items',v_rows,'snapshotHash',encode(sha256(convert_to(v_rows::text,'UTF8')),'hex'));
end;$$;
create function private.family_schedule_snapshot(p_org uuid,p_branch uuid,p_client uuid,p_month date,p_staff boolean default false) returns table(payload jsonb) language plpgsql security definer set search_path='' as $$
declare v jsonb;begin
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month not between date '2000-01-01' and date '2100-01-01' then raise exception 'FAMILY_MONTH_INVALID' using errcode='22023';end if;
 if p_staff then
  if not private.has_permission(p_org,p_branch,'family.messages') or not private.care_roster_can_read(p_client,'clients.read') or not exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch) then raise exception 'FAMILY_SCHEDULE_FORBIDDEN' using errcode='42501';end if;
 else perform private.family_client_context(p_org,p_branch,p_client,'schedule.read');end if;
 v:=private.family_schedule_projection(p_org,p_branch,p_client,p_month);
 perform private.daycare_completion_audit(p_org,p_branch,'SELECT','family_schedule_snapshot',p_client,jsonb_build_object('month',p_month,'snapshotHash',v->>'snapshotHash'));
 return query select v||jsonb_build_object('updatedAt',clock_timestamp());
end;$$;
create function public.family_schedule_snapshot(p_org uuid,p_branch uuid,p_client uuid,p_month date,p_staff boolean default false) returns table(payload jsonb) language sql security invoker set search_path='' as $$select * from private.family_schedule_snapshot(p_org,p_branch,p_client,p_month,p_staff)$$;
do $$declare f record;begin for f in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('private','public') and p.proname in('family_workspace','family_staff_workspace','family_workspace_completion_v1','family_staff_workspace_completion_v1','family_schedule_projection','family_schedule_snapshot','family_message_conflict_review') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.signature!~'(completion_v1|family_schedule_projection)' then execute format('grant execute on function %s to authenticated',f.signature);end if;
end loop;end;$$;
commit;
