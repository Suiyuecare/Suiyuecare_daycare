-- A rule can be retired only through a new, independently approved immutable
-- decision. Historical activations, drafts, scores and signatures are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table private.questionnaire_rule_activations add constraint questionnaire_rule_activation_identity_scope unique(id,organization_id,branch_id);
create table private.questionnaire_rule_retirement_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,branch_id uuid not null,
 activation_id uuid not null,effective_through date not null,reason text not null,
 requested_by uuid not null references auth.users(id) on delete restrict,
 request_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,requested_at timestamptz not null,
 foreign key(activation_id,organization_id,branch_id) references private.questionnaire_rule_activations(id,organization_id,branch_id) on delete restrict,
 unique(id,organization_id,branch_id,activation_id),
 check(effective_through between date '2000-01-01' and date '2199-12-31'),
 check(reason=btrim(reason) and length(reason) between 5 and 1000 and reason !~ '[<>[:cntrl:]]')
);
create table private.questionnaire_rule_retirement_events (
 id uuid primary key default gen_random_uuid(),request_id uuid not null,organization_id uuid not null,branch_id uuid not null,activation_id uuid not null,
 action text not null check(action in ('request','approve','withdraw','return')),
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,reason text,created_at timestamptz not null,
 foreign key(request_id,organization_id,branch_id,activation_id) references private.questionnaire_rule_retirement_requests(id,organization_id,branch_id,activation_id) on delete restrict,
 unique(id,request_id,organization_id,branch_id,activation_id),
 check(((action in ('request','approve') and reason is null) or(action in ('withdraw','return') and reason=btrim(reason) and length(reason) between 5 and 1000 and reason !~ '[<>[:cntrl:]]')) is true)
);
create unique index questionnaire_rule_retirement_one_request_event on private.questionnaire_rule_retirement_events(request_id) where action='request';
create unique index questionnaire_rule_retirement_one_decision_event on private.questionnaire_rule_retirement_events(request_id) where action<>'request';
create table private.questionnaire_rule_retirements (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,approval_event_id uuid not null unique,
 organization_id uuid not null,branch_id uuid not null,activation_id uuid not null unique,effective_through date not null,retired_at timestamptz not null,
 foreign key(activation_id,organization_id,branch_id) references private.questionnaire_rule_activations(id,organization_id,branch_id) on delete restrict,
 foreign key(request_id,organization_id,branch_id,activation_id) references private.questionnaire_rule_retirement_requests(id,organization_id,branch_id,activation_id) on delete restrict,
 foreign key(approval_event_id,request_id,organization_id,branch_id,activation_id) references private.questionnaire_rule_retirement_events(id,request_id,organization_id,branch_id,activation_id) on delete restrict
);
create table private.questionnaire_rule_retirement_operations (
 actor_user_id uuid not null references auth.users(id) on delete restrict,idempotency_key uuid not null,
 organization_id uuid not null,branch_id uuid not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 event_id uuid not null references private.questionnaire_rule_retirement_events(id) on delete restrict,
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),primary key(actor_user_id,idempotency_key),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict
);
create index questionnaire_rule_retirement_queue_idx on private.questionnaire_rule_retirement_requests(organization_id,branch_id,activation_id,requested_at desc,id desc);
create index questionnaire_rule_retirement_activation_idx on private.questionnaire_rule_retirement_requests(activation_id);
create index questionnaire_rule_retirement_actor_idx on private.questionnaire_rule_retirement_requests(requested_by);
create index questionnaire_rule_retirement_challenge_idx on private.questionnaire_rule_retirement_requests(request_challenge_id);
create index questionnaire_rule_retirement_event_actor_idx on private.questionnaire_rule_retirement_events(actor_user_id);
create index questionnaire_rule_retirement_event_challenge_idx on private.questionnaire_rule_retirement_events(challenge_id);
create index questionnaire_rule_retirement_scope_idx on private.questionnaire_rule_retirements(organization_id,branch_id,activation_id);
create index questionnaire_rule_retirement_operation_event_idx on private.questionnaire_rule_retirement_operations(event_id);
create index questionnaire_rule_retirement_operation_scope_idx on private.questionnaire_rule_retirement_operations(organization_id,branch_id);
do $$declare name text;begin
 foreach name in array array['questionnaire_rule_retirement_requests','questionnaire_rule_retirement_events','questionnaire_rule_retirements','questionnaire_rule_retirement_operations'] loop
  execute format('alter table private.%I enable row level security',name);execute format('alter table private.%I force row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_append_only_mutation()',name||'_immutable',name);
 end loop;
end;$$;
create function private.questionnaire_rule_effective_through(p_activation uuid)
returns date language sql stable security invoker set search_path='' as $$
 select least(a.effective_to,(select r.effective_through from private.questionnaire_rule_retirements r where r.activation_id=a.id))
 from private.questionnaire_rule_activations a where a.id=p_activation;
$$;
revoke all on function private.questionnaire_rule_effective_through(uuid) from public,anon,authenticated,service_role;

-- Only replace the two overlap expressions. Both the adoption and retirement
-- writers share the exact same rule-scope transaction lock before this read.
do $$declare definition text;updated text;begin
 definition:=pg_get_functiondef('private.write_questionnaire_rule_review_atomic(uuid,uuid,uuid,jsonb)'::regprocedure);
 if length(definition)-length(replace(definition,'daterange(a.effective_from,a.effective_to,''[]'')',''))<>2*length('daterange(a.effective_from,a.effective_to,''[]'')')
 then raise exception 'rule overlap anchors missing';end if;
 updated:=replace(definition,'daterange(a.effective_from,a.effective_to,''[]'')','daterange(a.effective_from,private.questionnaire_rule_effective_through(a.id),''[]'')');
 if strpos(updated,'  if operation.request_hash<>fingerprint then')=0 then raise exception 'rule operation conflict anchor missing';end if;
 -- Operation keys cannot be repurposed across the two governance endpoints.
 updated:=replace(updated,' else'||chr(10)||'  select * into item from private.questionnaire_rule_catalog',
  ' else'||chr(10)||'  if exists(select 1 from private.questionnaire_rule_retirement_operations prior where prior.actor_user_id=actor and prior.idempotency_key=p_key) then raise exception using errcode=''23505'',message=''rule operation key reused across workflow'';end if;'||chr(10)||'  select * into item from private.questionnaire_rule_catalog');
 if updated=definition or strpos(updated,'rule operation key reused across workflow')=0 then raise exception 'rule retirement receipt anchor missing';end if;
 execute updated;
end;$$;
create function private.questionnaire_rule_retirement_request_json(q private.questionnaire_rule_retirement_requests)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',q.id,'activationId',q.activation_id,'formKey',a.form_key,'catalogHash',a.catalog_hash,
  'effectiveThrough',q.effective_through,'reason',q.reason,'requestedBy',q.requested_by,'byCurrentUser',q.requested_by=auth.uid(),'requestedAt',q.requested_at,
  'status',coalesce((select case e.action when 'approve' then 'approved' when 'withdraw' then 'withdrawn' else 'returned' end from private.questionnaire_rule_retirement_events e where e.request_id=q.id and e.action<>'request'),'pending'),
  'decision',(select jsonb_build_object('eventId',e.id,'action',e.action,'actorId',e.actor_user_id,'byCurrentUser',e.actor_user_id=auth.uid(),'reason',e.reason,'createdAt',e.created_at) from private.questionnaire_rule_retirement_events e where e.request_id=q.id and e.action<>'request'),
  'retirement',(select jsonb_build_object('retirementId',r.id,'effectiveThrough',r.effective_through,'retiredAt',r.retired_at) from private.questionnaire_rule_retirements r where r.request_id=q.id))
 from private.questionnaire_rule_activations a where a.id=q.activation_id;
$$;
create function private.write_questionnaire_rule_retirement_atomic(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();kind text;form text;catalog_fingerprint text;activation uuid;request_id uuid;last_day date;reason text;
 challenge uuid;stamp timestamptz;today date;fingerprint text;a private.questionnaire_rule_activations%rowtype;
 q private.questionnaire_rule_retirement_requests%rowtype;e private.questionnaire_rule_retirement_events%rowtype;
 operation private.questionnaire_rule_retirement_operations%rowtype;result jsonb;
begin
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule retirement access denied';end if;
 if p_key is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8192
  or p_input-array['action','formKey','catalogHash','activationId','requestId','effectiveThrough','reason']<>'{}'::jsonb
  or not(p_input ?& array['action','formKey','catalogHash','activationId','requestId','effectiveThrough','reason'])
  or jsonb_typeof(p_input->'action') is distinct from 'string' or not coalesce(p_input->>'action' in ('request','approve','withdraw','return'),false)
  or jsonb_typeof(p_input->'formKey') is distinct from 'string'
  or jsonb_typeof(p_input->'catalogHash') is distinct from 'string' or coalesce(p_input->>'catalogHash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_input->'activationId') is distinct from 'string' or coalesce(p_input->>'activationId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 then raise exception using errcode='22023',message='invalid rule retirement input';end if;
 kind:=p_input->>'action';form:=p_input->>'formKey';catalog_fingerprint:=p_input->>'catalogHash';
 if(kind='request' and p_input->'requestId'<>'null'::jsonb)
  or(kind<>'request' and(jsonb_typeof(p_input->'requestId') is distinct from 'string' or coalesce(p_input->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  or(kind='request' and(jsonb_typeof(p_input->'effectiveThrough') is distinct from 'string' or coalesce(p_input->>'effectiveThrough','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
  or(kind<>'request' and p_input->'effectiveThrough'<>'null'::jsonb)
  or(kind='approve' and p_input->'reason'<>'null'::jsonb)
  or(kind<>'approve' and(jsonb_typeof(p_input->'reason') is distinct from 'string' or length(p_input->>'reason') not between 5 and 1000
    or p_input->>'reason'<>btrim(p_input->>'reason') or p_input->>'reason'~'[<>[:cntrl:]]'))
 then raise exception using errcode='22023',message='invalid rule retirement fields';end if;
 begin activation:=(p_input->>'activationId')::uuid;request_id:=(p_input->>'requestId')::uuid;last_day:=(p_input->>'effectiveThrough')::date;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid retirement date or identity';end;
 reason:=p_input->>'reason';fingerprint:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-rule-operation:'||actor::text||':'||p_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-rule-scope:'||p_org::text||':'||p_branch::text||':'||form,0));
 challenge:=private.require_questionnaire_rule_reauth(p_org,p_branch);
 select * into operation from private.questionnaire_rule_retirement_operations o where o.actor_user_id=actor and o.idempotency_key=p_key;
 if found then
  if operation.request_hash<>fingerprint then raise exception using errcode='23505',message='rule retirement idempotency conflict';end if;
  result:=operation.receipt||jsonb_build_object('replayed',true);
 else
  if exists(select 1 from private.questionnaire_rule_review_operations prior where prior.actor_user_id=actor and prior.idempotency_key=p_key)
  then raise exception using errcode='23505',message='rule operation key reused across workflow';end if;
  select * into a from private.questionnaire_rule_activations existing where existing.id=activation and existing.organization_id=p_org and existing.branch_id=p_branch and existing.form_key=form and existing.catalog_hash=catalog_fingerprint;
  if not found then raise exception using errcode='42501',message='activation outside selected scope';end if;
  stamp:=clock_timestamp();today:=(stamp at time zone 'Asia/Taipei')::date;
  if kind='request' then
   if last_day is null or last_day<today or last_day<a.effective_from or last_day>date '2199-12-31' or(a.effective_to is not null and last_day>=a.effective_to)
   then raise exception using errcode='22023',message='retirement must shorten a future valid effective range';end if;
   if exists(select 1 from private.questionnaire_rule_retirements final where final.activation_id=a.id)
   then raise exception using errcode='23514',message='activation already has an approved retirement';end if;
   if exists(select 1 from private.questionnaire_rule_retirement_requests prior where prior.activation_id=a.id
    and not exists(select 1 from private.questionnaire_rule_retirement_events decision where decision.request_id=prior.id and decision.action<>'request'))
   then raise exception using errcode='23514',message='retirement review already pending';end if;
   insert into private.questionnaire_rule_retirement_requests(organization_id,branch_id,activation_id,effective_through,reason,requested_by,request_challenge_id,requested_at)
    values(p_org,p_branch,a.id,last_day,reason,actor,challenge,stamp) returning * into q;
  else
   select * into q from private.questionnaire_rule_retirement_requests r where r.id=request_id and r.organization_id=p_org and r.branch_id=p_branch and r.activation_id=a.id;
   if not found then raise exception using errcode='42501',message='retirement request outside selected scope';end if;
   if exists(select 1 from private.questionnaire_rule_retirement_events decision where decision.request_id=q.id and decision.action<>'request')
   then raise exception using errcode='23514',message='retirement review already decided';end if;
   if(kind='withdraw' and q.requested_by<>actor) or(kind in ('approve','return') and(q.requested_by=actor or q.request_challenge_id=challenge))
   then raise exception using errcode='42501',message='independent rule retirement required';end if;
   if kind='approve' and(q.effective_through<today or q.effective_through<a.effective_from or(a.effective_to is not null and q.effective_through>=a.effective_to)
    or exists(select 1 from private.questionnaire_rule_retirements final where final.activation_id=a.id))
   then raise exception using errcode='23514',message='proposed retirement no longer valid';end if;
  end if;
  insert into private.questionnaire_rule_retirement_events(request_id,organization_id,branch_id,activation_id,action,actor_user_id,challenge_id,reason,created_at)
   values(q.id,p_org,p_branch,a.id,kind,actor,challenge,case when kind='request' then null else reason end,stamp) returning * into e;
  if kind='approve' then insert into private.questionnaire_rule_retirements(request_id,approval_event_id,organization_id,branch_id,activation_id,effective_through,retired_at)
   values(q.id,e.id,p_org,p_branch,a.id,q.effective_through,stamp);end if;
  result:=jsonb_build_object('organizationId',p_org,'branchId',p_branch,'formKey',form,'catalogHash',catalog_fingerprint,'activationId',a.id,
   'eventId',e.id,'operationId',p_key,'actorId',actor,'committedAt',e.created_at,'action',kind,'request',private.questionnaire_rule_retirement_request_json(q),'replayed',false);
  insert into private.questionnaire_rule_retirement_operations(actor_user_id,idempotency_key,organization_id,branch_id,request_hash,event_id,receipt)
   values(actor,p_key,p_org,p_branch,fingerprint,e.id,result);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
   values(p_org,p_branch,actor,'insert','questionnaire_rule_retirement',q.id::text,array[]::text[],jsonb_build_object('workflow','questionnaire_rule_retirement_v1','action',kind,'content_excluded',true));
 end if;
 perform private.require_questionnaire_rule_reauth(p_org,p_branch);
 if operation.actor_user_id is null and kind in ('request','approve') and q.effective_through<(clock_timestamp() at time zone 'Asia/Taipei')::date
 then raise exception using errcode='23514',message='retirement cannot be backdated before commit';end if;
 return result;
end;$$;

create function private.read_questionnaire_rule_retirement_scoped(p_org uuid,p_branch uuid,p_activation uuid,p_before_created_at timestamptz,p_before_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a private.questionnaire_rule_activations%rowtype;items jsonb;page jsonb;total integer;next_cursor jsonb;
begin
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule retirement read denied';end if;
 if p_activation is null or((p_before_created_at is null)<>(p_before_id is null)) or(p_before_created_at is not null and(not isfinite(p_before_created_at) or p_before_created_at>clock_timestamp()+interval '1 minute'))
 then raise exception using errcode='22023',message='invalid retirement history cursor';end if;
 select * into a from private.questionnaire_rule_activations existing where existing.id=p_activation and existing.organization_id=p_org and existing.branch_id=p_branch;
 if not found then raise exception using errcode='42501',message='activation outside selected scope';end if;
 with matching as(select * from private.questionnaire_rule_retirement_requests q where q.organization_id=p_org and q.branch_id=p_branch and q.activation_id=p_activation),
  selected as(select * from matching where p_before_created_at is null or(requested_at,id)<(p_before_created_at,p_before_id) order by requested_at desc,id desc limit 21)
 select coalesce((select jsonb_agg(private.questionnaire_rule_retirement_request_json(s) order by s.requested_at desc,s.id desc) from selected s),'[]'::jsonb),(select count(*)::integer from matching) into items,total;
 page:=items-20;
 if jsonb_array_length(items)>20 then next_cursor:=jsonb_build_object('createdAt',page->19->'requestedAt','id',page->19->'requestId');else next_cursor:=null;end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_rule_retirement','retirement-history',array[]::text[],jsonb_build_object('workflow','questionnaire_rule_retirement_v1','row_count',jsonb_array_length(page),'content_excluded',true));
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule retirement read changed';end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'activationId',a.id,'formKey',a.form_key,'catalogHash',a.catalog_hash,
  'originalEffectiveTo',a.effective_to,'effectiveThrough',private.questionnaire_rule_effective_through(a.id),'requests',page,'total',total,'nextCursor',next_cursor,'generatedAt',clock_timestamp());
end;$$;
create function public.write_questionnaire_rule_retirement(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.write_questionnaire_rule_retirement_atomic(p_org,p_branch,p_key,p_input);$$;
create function public.read_questionnaire_rule_retirement(p_org uuid,p_branch uuid,p_activation uuid,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.read_questionnaire_rule_retirement_scoped(p_org,p_branch,p_activation,p_before_created_at,p_before_id);$$;
revoke all on function private.questionnaire_rule_retirement_request_json(private.questionnaire_rule_retirement_requests),private.write_questionnaire_rule_retirement_atomic(uuid,uuid,uuid,jsonb),
 private.read_questionnaire_rule_retirement_scoped(uuid,uuid,uuid,timestamptz,uuid),public.write_questionnaire_rule_retirement(uuid,uuid,uuid,jsonb),
 public.read_questionnaire_rule_retirement(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function private.write_questionnaire_rule_retirement_atomic(uuid,uuid,uuid,jsonb),private.read_questionnaire_rule_retirement_scoped(uuid,uuid,uuid,timestamptz,uuid),
 public.write_questionnaire_rule_retirement(uuid,uuid,uuid,jsonb),public.read_questionnaire_rule_retirement(uuid,uuid,uuid,timestamptz,uuid) to authenticated;
comment on table private.questionnaire_rule_retirements is 'Independent, non-backdated rule availability cutoff. Original rule releases and historical assessments remain immutable.';
commit;
