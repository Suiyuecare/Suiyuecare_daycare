-- Explicit adoption of an immutable, deployment-owned questionnaire catalog.
-- This prepares rule governance only: it never signs an assessment, changes an
-- existing draft, grants a role, or silently activates a seeded candidate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.questionnaire_rule_catalog (
 id uuid primary key default gen_random_uuid(),
 form_key text not null check(form_key in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf')),
 form_version text not null check(length(form_version) between 1 and 160),
 rule_version text not null check(length(rule_version) between 1 and 160),
 rule_revision integer not null check(rule_revision between 1 and 1000000),
 catalog_hash text not null unique check(catalog_hash ~ '^[a-f0-9]{64}$'),
 canonical_json text not null check(octet_length(canonical_json) between 2 and 2097152),
 manifest_json jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(form_key,form_version,rule_version,rule_revision),
 check(catalog_hash=encode(sha256(convert_to(canonical_json,'UTF8')),'hex')),
 check(canonical_json::jsonb=manifest_json),
 check((jsonb_typeof(manifest_json)='object'
  and manifest_json-array['schemaVersion','formKey','formVersion','ruleVersion','ruleRevision','form','sourceSnapshot','rules','testVectors']='{}'::jsonb
  and manifest_json ?& array['schemaVersion','formKey','formVersion','ruleVersion','ruleRevision','form','sourceSnapshot','rules','testVectors']
  and manifest_json->>'schemaVersion'='questionnaire-rule-catalog.v1'
  and jsonb_typeof(manifest_json->'formKey')='string' and manifest_json->>'formKey'=form_key
  and jsonb_typeof(manifest_json->'formVersion')='string' and manifest_json->>'formVersion'=form_version
  and jsonb_typeof(manifest_json->'ruleVersion')='string' and manifest_json->>'ruleVersion'=rule_version
  and jsonb_typeof(manifest_json->'ruleRevision')='number' and manifest_json->>'ruleRevision'=rule_revision::text
  and jsonb_typeof(manifest_json->'form')='object' and jsonb_typeof(manifest_json->'sourceSnapshot')='array'
  and jsonb_typeof(manifest_json->'rules')='object' and jsonb_typeof(manifest_json->'testVectors')='array') is true)
);

create table private.questionnaire_rule_review_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 branch_id uuid not null,
 catalog_id uuid not null references private.questionnaire_rule_catalog(id) on delete restrict,
 form_key text not null,
 catalog_hash text not null,
 effective_from date not null,
 effective_to date,
 requested_by uuid not null references auth.users(id) on delete restrict,
 request_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
 requested_at timestamptz not null,
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 unique(id,organization_id,branch_id),
 check(effective_to is null or effective_to>=effective_from),
 check(effective_from between date '2000-01-01' and date '2199-12-31'),
 check(effective_to is null or effective_to<=date '2199-12-31'),
 check(catalog_hash ~ '^[a-f0-9]{64}$')
);
create table private.questionnaire_rule_review_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null,
 organization_id uuid not null,
 branch_id uuid not null,
 action text not null check(action in ('request','approve','withdraw','return')),
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
 reason text,
 created_at timestamptz not null,
 foreign key(request_id,organization_id,branch_id) references private.questionnaire_rule_review_requests(id,organization_id,branch_id) on delete restrict,
 unique(id,request_id,organization_id,branch_id),
 check(((action in ('request','approve') and reason is null)
  or(action in ('withdraw','return') and reason=btrim(reason) and length(reason) between 5 and 1000 and reason !~ '[<>[:cntrl:]]')) is true)
);
create unique index questionnaire_rule_one_request_event on private.questionnaire_rule_review_events(request_id) where action='request';
create unique index questionnaire_rule_one_decision_event on private.questionnaire_rule_review_events(request_id) where action<>'request';
create table private.questionnaire_rule_activations (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 approval_event_id uuid not null unique,
 organization_id uuid not null,
 branch_id uuid not null,
 catalog_id uuid not null references private.questionnaire_rule_catalog(id) on delete restrict,
 form_key text not null,
 catalog_hash text not null check(catalog_hash ~ '^[a-f0-9]{64}$'),
 effective_from date not null,
 effective_to date,
 activated_at timestamptz not null,
 foreign key(request_id,organization_id,branch_id) references private.questionnaire_rule_review_requests(id,organization_id,branch_id) on delete restrict,
 foreign key(approval_event_id,request_id,organization_id,branch_id) references private.questionnaire_rule_review_events(id,request_id,organization_id,branch_id) on delete restrict,
 check(effective_to is null or effective_to>=effective_from)
);
create table private.questionnaire_rule_review_operations (
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 idempotency_key uuid not null,
 organization_id uuid not null,
 branch_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 event_id uuid not null references private.questionnaire_rule_review_events(id) on delete restrict,
 receipt jsonb not null check(jsonb_typeof(receipt)='object'),
 primary key(actor_user_id,idempotency_key),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict
);
create index questionnaire_rule_requests_queue_idx on private.questionnaire_rule_review_requests(organization_id,branch_id,form_key,requested_at desc,id desc);
create index questionnaire_rule_requests_catalog_idx on private.questionnaire_rule_review_requests(catalog_id);
create index questionnaire_rule_requests_actor_idx on private.questionnaire_rule_review_requests(requested_by);
create index questionnaire_rule_requests_challenge_idx on private.questionnaire_rule_review_requests(request_challenge_id);
create index questionnaire_rule_events_actor_idx on private.questionnaire_rule_review_events(actor_user_id);
create index questionnaire_rule_events_challenge_idx on private.questionnaire_rule_review_events(challenge_id);
create index questionnaire_rule_activation_scope_idx on private.questionnaire_rule_activations(organization_id,branch_id,form_key,effective_from,effective_to);
create index questionnaire_rule_activation_catalog_idx on private.questionnaire_rule_activations(catalog_id);
create index questionnaire_rule_operations_event_idx on private.questionnaire_rule_review_operations(event_id);
create index questionnaire_rule_operations_scope_idx on private.questionnaire_rule_review_operations(organization_id,branch_id);

do $$ declare name text; begin
 foreach name in array array['questionnaire_rule_catalog','questionnaire_rule_review_requests','questionnaire_rule_review_events','questionnaire_rule_activations','questionnaire_rule_review_operations'] loop
  execute format('alter table private.%I enable row level security',name);
  execute format('alter table private.%I force row level security',name);
  execute format('revoke all on table private.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_append_only_mutation()',name||'_immutable',name);
 end loop;
end;$$;

create function private.questionnaire_rule_governance_authority(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(auth.uid() is not null
  and(exists(select 1 from private.executive_reader_scope() s where s.organization_id=p_org and(s.branch_id is null or s.branch_id=p_branch))
   or exists(select 1 from private.routine_staff_scope() s where s.organization_id=p_org and(s.branch_id is null or s.branch_id=p_branch)))
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind in ('staff','professional'))
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id and o.is_active where b.id=p_branch and b.organization_id=p_org and b.is_active)
  and private.questionnaire_assessment_permission(p_org,p_branch,'forms.manage'),false);
$$;

create function private.require_questionnaire_rule_reauth(p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare challenge uuid; verified timestamptz; stamp timestamptz:=clock_timestamp(); v_session_id uuid;
begin
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true or coalesce(auth.jwt()->>'aal','')<>'aal2'
 then raise exception using errcode='42501',message='current rule governance and recent AAL2 required'; end if;
 begin v_session_id:=(auth.jwt()->>'session_id')::uuid;
 exception when invalid_text_representation then raise exception using errcode='42501',message='current rule governance and recent AAL2 required'; end;
 select c.id,c.factor_verified_at into challenge,verified from private.reauth_events e join private.reauth_challenges c
  on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
  where e.user_id=auth.uid() and e.session_id=v_session_id and e.aal='aal2' and e.revoked_at is null
   and e.verification_method in ('totp','webauthn','phone') and c.consumed_at is not null and c.invalidated_at is null
   and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
   and exists(select 1 from auth.mfa_amr_claims actual where actual.session_id=v_session_id
    and actual.authentication_method=e.verification_method
    and floor(extract(epoch from actual.updated_at))=floor(extract(epoch from c.factor_verified_at)))
   and exists(select 1 from jsonb_array_elements(auth.jwt()->'amr') claim where claim->>'method'=e.verification_method
    and(claim->>'timestamp')::bigint=floor(extract(epoch from c.factor_verified_at))::bigint)
   and c.factor_verified_at>=stamp-interval '15 minutes' and c.factor_verified_at<=stamp+interval '1 minute'
  order by c.factor_verified_at desc,c.id desc limit 1 for share of e,c;
 stamp:=clock_timestamp();
 if challenge is null or verified<stamp-interval '15 minutes' or verified>stamp+interval '1 minute'
  or private.questionnaire_rule_governance_authority(p_org,p_branch) is not true
 then raise exception using errcode='42501',message='current rule governance and recent AAL2 required'; end if;
 return challenge;
exception when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range then
 raise exception using errcode='42501',message='current rule governance and recent AAL2 required';
end;$$;

create function private.questionnaire_rule_request_json(q private.questionnaire_rule_review_requests)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('requestId',q.id,'formKey',q.form_key,'catalogHash',q.catalog_hash,
  'effectiveFrom',q.effective_from,'effectiveTo',q.effective_to,'requestedBy',q.requested_by,
  'byCurrentUser',q.requested_by=auth.uid(),'requestedAt',q.requested_at,
  'status',coalesce((select case e.action when 'approve' then 'approved' when 'withdraw' then 'withdrawn' else 'returned' end
   from private.questionnaire_rule_review_events e where e.request_id=q.id and e.action<>'request'),'pending'),
  'decision',(select jsonb_build_object('eventId',e.id,'action',e.action,'actorId',e.actor_user_id,'byCurrentUser',e.actor_user_id=auth.uid(),'reason',e.reason,'createdAt',e.created_at)
   from private.questionnaire_rule_review_events e where e.request_id=q.id and e.action<>'request'),
  'activation',(select jsonb_build_object('activationId',a.id,'catalogHash',a.catalog_hash,'effectiveFrom',a.effective_from,'effectiveTo',a.effective_to,'activatedAt',a.activated_at)
   from private.questionnaire_rule_activations a where a.request_id=q.id));
$$;

create function private.write_questionnaire_rule_review_atomic(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); kind text; form text; catalog_fingerprint text; request_id uuid; first_day date; last_day date; reason text;
 challenge uuid; stamp timestamptz; today date; fingerprint text; item private.questionnaire_rule_catalog%rowtype;
 q private.questionnaire_rule_review_requests%rowtype; e private.questionnaire_rule_review_events%rowtype;
 operation private.questionnaire_rule_review_operations%rowtype; result jsonb;
begin
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then
  raise exception using errcode='42501',message='rule governance access denied'; end if;
 if p_key is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8192
  or p_input-array['action','formKey','catalogHash','requestId','effectiveFrom','effectiveTo','reason']<>'{}'::jsonb
  or not(p_input ?& array['action','formKey','catalogHash','requestId','effectiveFrom','effectiveTo','reason'])
  or jsonb_typeof(p_input->'action') is distinct from 'string' or not coalesce(p_input->>'action' in ('request','approve','withdraw','return'),false)
  or jsonb_typeof(p_input->'formKey') is distinct from 'string'
  or jsonb_typeof(p_input->'catalogHash') is distinct from 'string' or coalesce(p_input->>'catalogHash','')!~'^[a-f0-9]{64}$'
 then raise exception using errcode='22023',message='invalid rule review input'; end if;
 kind:=p_input->>'action';form:=p_input->>'formKey';catalog_fingerprint:=p_input->>'catalogHash';
 if(kind='request' and p_input->'requestId'<>'null'::jsonb)
  or(kind<>'request' and(jsonb_typeof(p_input->'requestId') is distinct from 'string' or coalesce(p_input->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
  or(kind='request' and(jsonb_typeof(p_input->'effectiveFrom') is distinct from 'string' or coalesce(p_input->>'effectiveFrom','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or(p_input->'effectiveTo'<>'null'::jsonb and(jsonb_typeof(p_input->'effectiveTo') is distinct from 'string' or coalesce(p_input->>'effectiveTo','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))))
  or(kind<>'request' and(p_input->'effectiveFrom'<>'null'::jsonb or p_input->'effectiveTo'<>'null'::jsonb))
  or(kind in ('request','approve') and p_input->'reason'<>'null'::jsonb)
  or(kind in ('withdraw','return') and(jsonb_typeof(p_input->'reason') is distinct from 'string' or length(p_input->>'reason') not between 5 and 1000
    or p_input->>'reason'<>btrim(p_input->>'reason') or p_input->>'reason'~'[<>[:cntrl:]]'))
 then raise exception using errcode='22023',message='invalid rule review fields'; end if;
 begin request_id:=(p_input->>'requestId')::uuid;first_day:=(p_input->>'effectiveFrom')::date;last_day:=(p_input->>'effectiveTo')::date;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='invalid rule review date or identity'; end;
 reason:=p_input->>'reason';
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,'input',p_input)::text,'UTF8')),'hex');
 -- All future signing writers must share this scoped rule lock. An immutable
 -- activation does not need UPDATE to prevent overlapping publication races.
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-rule-operation:'||actor::text||':'||p_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-rule-scope:'||p_org::text||':'||p_branch::text||':'||form,0));
 challenge:=private.require_questionnaire_rule_reauth(p_org,p_branch);
 select * into operation from private.questionnaire_rule_review_operations o where o.actor_user_id=actor and o.idempotency_key=p_key;
 if found then
  if operation.request_hash<>fingerprint then raise exception using errcode='23505',message='rule review idempotency conflict'; end if;
  result:=operation.receipt||jsonb_build_object('replayed',true);
 else
  select * into item from private.questionnaire_rule_catalog c where c.catalog_hash=catalog_fingerprint and c.form_key=form;
  if not found then raise exception using errcode='42501',message='registered rule catalog required'; end if;
  stamp:=clock_timestamp();today:=(stamp at time zone 'Asia/Taipei')::date;
  if kind='request' then
   if first_day is null or first_day<today or first_day>date '2199-12-31' or(last_day is not null and(last_day<first_day or last_day>date '2199-12-31'))
   then raise exception using errcode='22023',message='rule adoption cannot be backdated'; end if;
   if exists(select 1 from private.questionnaire_rule_review_requests prior where prior.organization_id=p_org and prior.branch_id=p_branch and prior.form_key=form
    and not exists(select 1 from private.questionnaire_rule_review_events decision where decision.request_id=prior.id and decision.action<>'request'))
   then raise exception using errcode='23514',message='a rule review is already pending'; end if;
   if exists(select 1 from private.questionnaire_rule_activations a where a.organization_id=p_org and a.branch_id=p_branch and a.form_key=form
    and daterange(a.effective_from,a.effective_to,'[]')&&daterange(first_day,last_day,'[]'))
   then raise exception using errcode='23514',message='rule effective periods overlap'; end if;
   insert into private.questionnaire_rule_review_requests(organization_id,branch_id,catalog_id,form_key,catalog_hash,effective_from,effective_to,requested_by,request_challenge_id,requested_at)
    values(p_org,p_branch,item.id,form,catalog_fingerprint,first_day,last_day,actor,challenge,stamp) returning * into q;
  else
   select * into q from private.questionnaire_rule_review_requests r where r.id=request_id and r.organization_id=p_org and r.branch_id=p_branch and r.form_key=form and r.catalog_hash=catalog_fingerprint;
   if not found then raise exception using errcode='42501',message='rule request outside selected scope'; end if;
   if exists(select 1 from private.questionnaire_rule_review_events decision where decision.request_id=q.id and decision.action<>'request')
   then raise exception using errcode='23514',message='rule review already decided'; end if;
   if(kind='withdraw' and q.requested_by<>actor) or(kind in ('approve','return') and(q.requested_by=actor or q.request_challenge_id=challenge))
   then raise exception using errcode='42501',message='independent rule review required'; end if;
   if kind='approve' then
    if q.effective_from<today then raise exception using errcode='23514',message='expired proposed start must be requested again'; end if;
    if exists(select 1 from private.questionnaire_rule_activations a where a.organization_id=p_org and a.branch_id=p_branch and a.form_key=form
     and daterange(a.effective_from,a.effective_to,'[]')&&daterange(q.effective_from,q.effective_to,'[]'))
    then raise exception using errcode='23514',message='rule effective periods overlap'; end if;
   end if;
  end if;
  insert into private.questionnaire_rule_review_events(request_id,organization_id,branch_id,action,actor_user_id,challenge_id,reason,created_at)
   values(q.id,p_org,p_branch,kind,actor,challenge,reason,stamp) returning * into e;
  if kind='approve' then
   insert into private.questionnaire_rule_activations(request_id,approval_event_id,organization_id,branch_id,catalog_id,form_key,catalog_hash,effective_from,effective_to,activated_at)
    values(q.id,e.id,p_org,p_branch,item.id,form,catalog_fingerprint,q.effective_from,q.effective_to,stamp);
  end if;
  result:=jsonb_build_object('organizationId',p_org,'branchId',p_branch,'formKey',form,'catalogHash',catalog_fingerprint,'eventId',e.id,
   'operationId',p_key,'actorId',actor,'committedAt',e.created_at,'action',kind,'request',private.questionnaire_rule_request_json(q),'replayed',false);
  insert into private.questionnaire_rule_review_operations(actor_user_id,idempotency_key,organization_id,branch_id,request_hash,event_id,receipt)
   values(actor,p_key,p_org,p_branch,fingerprint,e.id,result);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
   values(p_org,p_branch,actor,'insert','questionnaire_rule_review',q.id::text,array[]::text[],jsonb_build_object('workflow','questionnaire_rule_review_v1','action',kind,'catalog_hash',catalog_fingerprint,'content_excluded',true));
 end if;
 -- Reauth and all live admission/role/session predicates are reevaluated after
 -- FK, insert, and audit waits. Any revocation rolls every business row back.
 perform private.require_questionnaire_rule_reauth(p_org,p_branch);
 if operation.actor_user_id is null and kind in ('request','approve') and q.effective_from<(clock_timestamp() at time zone 'Asia/Taipei')::date
 then raise exception using errcode='23514',message='rule adoption cannot be backdated before commit'; end if;
 return result;
end;$$;

create function private.read_questionnaire_rule_review_scoped(p_org uuid,p_branch uuid,p_form_key text,p_before_created_at timestamptz,p_before_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare catalogs jsonb; items jsonb; page jsonb; total integer; next_cursor jsonb;
begin
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule governance read denied'; end if;
 if p_form_key is null or p_form_key not in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf')
  or((p_before_created_at is null)<>(p_before_id is null)) or(p_before_created_at is not null and(not isfinite(p_before_created_at) or p_before_created_at>clock_timestamp()+interval '1 minute'))
 then raise exception using errcode='22023',message='invalid rule history cursor'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('formKey',c.form_key,'formVersion',c.form_version,'ruleVersion',c.rule_version,'ruleRevision',c.rule_revision,'catalogHash',c.catalog_hash) order by c.created_at desc,c.id desc),'[]'::jsonb)
  into catalogs from(select * from private.questionnaire_rule_catalog where form_key=p_form_key order by created_at desc,id desc limit 50)c;
 with matching as(select * from private.questionnaire_rule_review_requests q where q.organization_id=p_org and q.branch_id=p_branch and q.form_key=p_form_key),
  selected as(select * from matching where p_before_created_at is null or(requested_at,id)<(p_before_created_at,p_before_id) order by requested_at desc,id desc limit 21)
 select coalesce((select jsonb_agg(private.questionnaire_rule_request_json(s) order by s.requested_at desc,s.id desc) from selected s),'[]'::jsonb),(select count(*)::integer from matching) into items,total;
 page:=items-20;
 if jsonb_array_length(items)>20 then next_cursor:=jsonb_build_object('createdAt',page->19->'requestedAt','id',page->19->'requestId'); else next_cursor:=null; end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_rule_review','rule-history',array[]::text[],jsonb_build_object('workflow','questionnaire_rule_review_v1','form_key',p_form_key,'row_count',jsonb_array_length(page),'content_excluded',true));
 if private.questionnaire_rule_governance_authority(p_org,p_branch) is not true then raise exception using errcode='42501',message='rule governance read changed'; end if;
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'formKey',p_form_key,'catalogs',catalogs,'requests',page,'total',total,'nextCursor',next_cursor,'generatedAt',clock_timestamp());
end;$$;

create function public.write_questionnaire_rule_review(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.write_questionnaire_rule_review_atomic(p_org,p_branch,p_key,p_input);$$;
create function public.read_questionnaire_rule_review(p_org uuid,p_branch uuid,p_form_key text,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.read_questionnaire_rule_review_scoped(p_org,p_branch,p_form_key,p_before_created_at,p_before_id);$$;
revoke all on function private.questionnaire_rule_governance_authority(uuid,uuid),private.require_questionnaire_rule_reauth(uuid,uuid),
 private.questionnaire_rule_request_json(private.questionnaire_rule_review_requests),private.write_questionnaire_rule_review_atomic(uuid,uuid,uuid,jsonb),
 private.read_questionnaire_rule_review_scoped(uuid,uuid,text,timestamptz,uuid),public.write_questionnaire_rule_review(uuid,uuid,uuid,jsonb),
 public.read_questionnaire_rule_review(uuid,uuid,text,timestamptz,uuid) from public,anon,authenticated,service_role;
-- Public SECURITY INVOKER wrappers need EXECUTE on only their corresponding
-- guarded implementation. The helpers and all private table paths stay closed.
grant execute on function private.write_questionnaire_rule_review_atomic(uuid,uuid,uuid,jsonb),private.read_questionnaire_rule_review_scoped(uuid,uuid,text,timestamptz,uuid),
 public.write_questionnaire_rule_review(uuid,uuid,uuid,jsonb),public.read_questionnaire_rule_review(uuid,uuid,text,timestamptz,uuid) to authenticated;
comment on table private.questionnaire_rule_catalog is 'Deployment-owned immutable questionnaire and scoring manifest; candidates are not approvals.';
comment on table private.questionnaire_rule_activations is 'Independent same-branch adoption proof; not a clinical signature and not authority to modify historical assessments.';
commit;
