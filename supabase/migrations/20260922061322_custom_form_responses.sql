begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Tenant-authored forms only. No official questionnaires, clinical scoring,
-- automatic decisions or browser table grants are introduced here.
create table private.custom_form_responses (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 branch_id uuid not null,
 client_id uuid not null references public.clients(id),
 form_version_id uuid not null references public.form_versions(id),
 record_key uuid not null,
 revision integer not null check(revision>0),
 previous_id uuid references private.custom_form_responses(id),
 correction_source_id uuid references private.custom_form_responses(id),
 service_date date not null,
 status text not null check(status in ('draft','signed')),
 schema_snapshot jsonb not null,
 answers jsonb not null check(jsonb_typeof(answers)='object'),
 reason text,
 signature_evidence jsonb,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(branch_id,organization_id) references public.branches(id,organization_id),
 unique(organization_id,record_key,revision),
 check((status='signed')=(signature_evidence is not null)),
 check((revision=1)=(previous_id is null))
);
create index custom_response_client_idx on private.custom_form_responses(client_id,created_at desc,id);
create index custom_response_branch_idx on private.custom_form_responses(branch_id,organization_id);
create index custom_response_form_idx on private.custom_form_responses(form_version_id);
create index custom_response_previous_idx on private.custom_form_responses(previous_id);
create index custom_response_correction_idx on private.custom_form_responses(correction_source_id);
create index custom_response_actor_idx on private.custom_form_responses(actor_id);
create table private.custom_response_receipts (
 organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id),
 idempotency_key uuid not null,
 request_hash text not null,
 response_id uuid not null references private.custom_form_responses(id),
 primary key(organization_id,actor_id,idempotency_key)
);
create index custom_response_receipt_actor_idx on private.custom_response_receipts(actor_id);
create index custom_response_receipt_response_idx on private.custom_response_receipts(response_id);
alter table private.custom_form_responses enable row level security;
alter table private.custom_form_responses force row level security;
alter table private.custom_response_receipts enable row level security;
alter table private.custom_response_receipts force row level security;
revoke all on private.custom_form_responses,private.custom_response_receipts from public,anon,authenticated,service_role;

create function private.reject_custom_response_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='custom responses are append only'; end;$$;
create trigger custom_response_immutable before update or delete on private.custom_form_responses for each row execute function private.reject_custom_response_mutation();
create trigger custom_response_receipt_immutable before update or delete on private.custom_response_receipts for each row execute function private.reject_custom_response_mutation();

create function private.assert_custom_response_access(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare live_permissions text[];
begin
 if auth.uid() is null
  or not exists(select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id and b.is_active
    join public.organizations o on o.id=c.organization_id and o.is_active where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
 then raise exception using errcode='42501',message='custom response access denied'; end if;
 -- Legacy AAL2 helpers compare validity windows to transaction-start now().
 -- Rebuild this response boundary's grants with wall-clock timestamps so an
 -- audit/advisory lock wait cannot preserve expired membership or future grants.
 select coalesce(array_agg(distinct permission.permission_key),'{}'::text[]) into live_permissions
 from public.profiles profile
 join public.memberships m on m.profile_id=profile.id
 join public.membership_roles mr on mr.membership_id=m.id and mr.assigned_at<=clock_timestamp()
 join public.roles role on role.id=mr.role_id and role.is_active and role.role_key not in ('family','platform_ops')
 join public.role_permissions rp on rp.role_id=role.id and rp.granted_at<=clock_timestamp()
 join public.permissions permission on permission.id=rp.permission_id
 where profile.id=auth.uid() and profile.is_active and profile.kind in ('staff','professional','finance','driver')
  and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
  and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
  and (role.organization_id is null or role.organization_id=p_org)
  and permission.permission_key in ('care_records.read',p_permission,'clients.view_all');
 -- Keep each admission path's own view_all authority; routine admission must
 -- not inherit the legacy AAL2 permission helper's broader scope.
 if not ((coalesce(auth.jwt()->>'aal','')='aal2' and private.can_staff_access_client(p_client,'care_records.read') and private.can_staff_access_client(p_client,p_permission)
    and live_permissions @> array['care_records.read',p_permission]
    and ('clients.view_all'=any(live_permissions)
     or exists(select 1 from public.client_assignments a
      where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client and a.assignee_user_id=auth.uid()
       and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))))
   or (p_permission in ('care_records.read','care_records.write') and private.can_routine_staff_access_client(p_client,'care_records.read') and private.can_routine_staff_access_client(p_client,p_permission)))
 then raise exception using errcode='42501',message='custom response access denied'; end if;
end;$$;

create function private.validate_custom_answers(p_schema jsonb,p_answers jsonb,p_complete boolean)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare f jsonb; a jsonb; v jsonb; k text; d date;
begin
 if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>65536
  then raise exception using errcode='22023',message='invalid answers'; end if;
 for k in select jsonb_object_keys(p_answers) loop
  if not exists(select 1 from jsonb_array_elements(p_schema->'fields') field where field->>'key'=k)
  then raise exception using errcode='22023',message='unknown answer field'; end if;
 end loop;
 for f in select value from jsonb_array_elements(p_schema->'fields') loop
  a:=p_answers->(f->>'key');
  if a is null then
   if p_complete and (f->>'required')::boolean then raise exception using errcode='23514',message='required answer missing'; end if;
   continue;
  end if;
  if jsonb_typeof(a) is distinct from 'object' or a-array['state','value','reason']<>'{}'::jsonb
   or not coalesce(a->>'state' in ('answered','missing','not_applicable'),false)
  then raise exception using errcode='22023',message='invalid answer state'; end if;
  if a->>'state'<>'answered' then
   if a ? 'value' then raise exception using errcode='22023',message='unanswered field has value'; end if;
   if a->>'state'='not_applicable' and not private.custom_form_plain_text(a->'reason',500)
    then raise exception using errcode='22023',message='not applicable needs reason'; end if;
   -- A required field cannot be bypassed by selecting not applicable. An
   -- institution must publish an optional field when that is permitted.
   if p_complete and (f->>'required')::boolean then raise exception using errcode='23514',message='required answer missing'; end if;
   if a->>'state'='missing' and a ? 'reason' then raise exception using errcode='22023',message='unexpected reason'; end if;
   continue;
  end if;
  if not (a ? 'value') or a ? 'reason' then raise exception using errcode='22023',message='invalid answer value'; end if;
  v:=a->'value';
  case f->>'type'
  when 'text' then
   if jsonb_typeof(v) is distinct from 'string' or length(btrim(v #>> '{}'))=0 or length(v #>> '{}')>(f->>'maxLength')::integer
    or (v #>> '{}') ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid text answer'; end if;
  when 'number' then
   if jsonb_typeof(v) is distinct from 'number' then raise exception using errcode='22023',message='invalid number answer'; end if;
   if (v #>> '{}')::numeric<(f->>'minimum')::numeric or (v #>> '{}')::numeric>(f->>'maximum')::numeric
    then raise exception using errcode='22023',message='number outside range'; end if;
  when 'boolean' then
   if jsonb_typeof(v) is distinct from 'boolean' then raise exception using errcode='22023',message='invalid boolean answer'; end if;
  when 'date' then
   begin
    if jsonb_typeof(v)<>'string' or not coalesce((v #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$',false) then raise exception 'date'; end if;
    d:=(v #>> '{}')::date;
    if d not between date '1900-01-01' and date '2200-12-31' then raise exception 'date'; end if;
   exception when others then raise exception using errcode='22023',message='invalid date answer'; end;
  when 'select' then
   if jsonb_typeof(v) is distinct from 'string' or not (f->'options' @> jsonb_build_array(v))
    then raise exception using errcode='22023',message='invalid choice answer'; end if;
  else raise exception using errcode='22023',message='unsupported field';
  end case;
 end loop;
end;$$;

create function private.custom_response_json(r private.custom_form_responses) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'recordKey',r.record_key,'revision',r.revision,'previousId',r.previous_id,
 'correctionSourceId',r.correction_source_id,'clientId',r.client_id,'formVersionId',r.form_version_id,
 'serviceDate',r.service_date,'status',r.status,'schema',r.schema_snapshot,'answers',r.answers,'reason',r.reason,
 'signatureEvidence',r.signature_evidence,'contentHash',r.content_hash,'actorId',r.actor_id,'createdAt',r.created_at);
$$;

create function private.write_custom_response_atomic(p_org uuid,p_branch uuid,p_client uuid,p_key uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<response_operation>>
declare action text:=p_input->>'action'; actor uuid:=auth.uid(); version_id uuid; previous_id uuid; base integer; day date;
 v public.form_versions%rowtype; d public.form_definitions%rowtype; prev private.custom_form_responses%rowtype;
 result private.custom_form_responses%rowtype; receipt private.custom_response_receipts%rowtype;
 h text; root_id uuid; answers jsonb; reason text; correction uuid; evidence jsonb; stamp timestamptz; challenge uuid; roles jsonb;
begin
 perform private.assert_custom_response_access(p_org,p_branch,p_client,case when action='sign' then 'care_records.sign' else 'care_records.write' end);
 if p_key is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>70000
  or p_input-array['action','formVersionId','previousId','baseRevision','serviceDate','answers','reason']<>'{}'::jsonb
  or not(p_input ?& array['action','formVersionId','previousId','baseRevision','serviceDate','answers','reason'])
  or not coalesce(action in ('save','sign','correct'),false)
 then raise exception using errcode='22023',message='invalid response request'; end if;
 begin
  version_id:=(p_input->>'formVersionId')::uuid; previous_id:=(p_input->>'previousId')::uuid;
  base:=(p_input->>'baseRevision')::integer; day:=(p_input->>'serviceDate')::date;
 exception when others then raise exception using errcode='22023',message='invalid response identity'; end;
 if version_id is null or day is null or not coalesce((p_input->>'serviceDate') ~ '^\d{4}-\d{2}-\d{2}$',false)
  or day not between date '1900-01-01' and (clock_timestamp() at time zone 'Asia/Taipei')::date
  or (previous_id is null)<>(base is null) or base<1 or (previous_id is null and action<>'save')
 then raise exception using errcode='22023',message='invalid response baseline'; end if;
 reason:=p_input->>'reason';
 if (action='correct' and not private.custom_form_plain_text(p_input->'reason',500)) or (action<>'correct' and reason is not null)
 then raise exception using errcode='22023',message='invalid correction reason'; end if;
 h:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'client',p_client,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('custom-response-op:'||p_org||':'||actor||':'||p_key,0));
 perform private.assert_custom_response_access(p_org,p_branch,p_client,case when action='sign' then 'care_records.sign' else 'care_records.write' end);
 -- Replaying a signature is still a signature operation: require fresh,
 -- same-session second-factor evidence after the operation lock, before any
 -- receipt can reveal the earlier signed response.
 if action='sign' then
  challenge:=private.require_case_service_record_reauth(actor,clock_timestamp());
 end if;
 select * into receipt from private.custom_response_receipts where organization_id=p_org and actor_id=actor and idempotency_key=p_key;
 if found then
  if receipt.request_hash<>h then raise exception using errcode='23505',message='response idempotency conflict'; end if;
  select * into strict result from private.custom_form_responses where id=receipt.response_id;
  return jsonb_build_object('record',private.custom_response_json(result),'replayed',true);
 end if;
 select * into v from public.form_versions where id=version_id for share;
 select * into d from public.form_definitions where id=v.form_definition_id and organization_id=p_org and not is_official;
 if d.id is null or d.form_key !~ '^tenant\.custom\.' or v.scoring_json<>'{}'::jsonb
 then raise exception using errcode='42501',message='form outside authorized custom scope'; end if;
 if previous_id is null then
  if v.status<>'published' or v.effective_from is null or day<v.effective_from or (v.effective_to is not null and day>v.effective_to)
   then raise exception using errcode='23514',message='form is not effective'; end if;
  root_id:=gen_random_uuid();
 else
  select * into prev from private.custom_form_responses where id=response_operation.previous_id and organization_id=p_org and branch_id=p_branch and client_id=p_client;
  if not found then raise exception using errcode='42501',message='response outside authorized scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custom-response-chain:'||p_org||':'||prev.record_key,0));
  if prev.revision<>base or exists(select 1 from private.custom_form_responses where organization_id=p_org and record_key=prev.record_key and revision>base)
   then raise exception using errcode='40001',message='response version conflict'; end if;
  if prev.form_version_id<>version_id or prev.service_date<>day or (action='correct' and prev.status<>'signed') or (action<>'correct' and prev.status<>'draft')
   then raise exception using errcode='23514',message='invalid response transition'; end if;
  root_id:=prev.record_key;
 end if;
 -- Validate the stored definition, never a schema supplied by the browser.
 perform private.validate_custom_form_payload(jsonb_build_object('formKey',d.form_key,'name',d.name,'category',d.category,
  'effectiveFrom',v.effective_from,'effectiveTo',v.effective_to,'schema',v.schema_json));
 if previous_id is not null and prev.schema_snapshot<>v.schema_json then raise exception using errcode='23514',message='published schema changed'; end if;
 if action='save' then answers:=p_input->'answers';
 else
  if p_input->'answers'<>'null'::jsonb then raise exception using errcode='22023',message='action cannot replace answers'; end if;
  answers:=prev.answers;
 end if;
 perform private.validate_custom_answers(v.schema_json,answers,action='sign');
 correction:=case when action='correct' then prev.id else prev.correction_source_id end;
 stamp:=clock_timestamp();
 if action='sign' then
  challenge:=private.require_case_service_record_reauth(actor,stamp);
  select coalesce(jsonb_agg(distinct r.role_key),'[]') into roles from public.memberships m
   join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active
   where m.profile_id=actor and m.organization_id=p_org and m.status='active' and m.starts_at<=stamp
   and (m.ends_at is null or m.ends_at>stamp) and (m.branch_id is null or m.branch_id=p_branch)
   and (r.organization_id is null or r.organization_id=p_org) and mr.assigned_at<=stamp;
  evidence:=jsonb_build_object('signerId',actor,'signedAt',stamp,'challengeId',challenge,'roles',roles,'aal','aal2','purpose','本人確認此機構自訂表單填答');
 end if;
 -- Recheck after every potentially blocking lock; deactivation cannot authorize
 -- a write merely because the request was admitted earlier.
 perform private.assert_custom_response_access(p_org,p_branch,p_client,case when action='sign' then 'care_records.sign' else 'care_records.write' end);
 insert into private.custom_form_responses(organization_id,branch_id,client_id,form_version_id,record_key,revision,previous_id,correction_source_id,
  service_date,status,schema_snapshot,answers,reason,signature_evidence,content_hash,actor_id,created_at)
 values(p_org,p_branch,p_client,version_id,root_id,coalesce(base,0)+1,previous_id,correction,day,
  case when action='sign' then 'signed' else 'draft' end,v.schema_json,answers,coalesce(reason,prev.reason),evidence,
  encode(sha256(convert_to(jsonb_build_object('client',p_client,'form',version_id,'schema',v.schema_json,'answers',answers,'day',day,
   'revision',coalesce(base,0)+1,'previous',previous_id,'correction',correction,'reason',coalesce(reason,prev.reason),'signature',evidence)::text,'UTF8')),'hex'),actor,stamp) returning * into result;
 insert into private.custom_response_receipts values(p_org,actor,p_key,h,result.id);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,actor,case when action='sign' then 'sign' else 'insert' end,'custom_form_responses',result.id::text,array['answers','status'],
  jsonb_build_object('revision',result.revision,'form_version_id',version_id,'content_hash',result.content_hash));
 -- The audit INSERT can itself wait on a lock. Recheck immediately before
 -- returning so revocation or expiry rolls back the ledger, receipt and audit.
 if action='sign' then
  if private.require_case_service_record_reauth(actor,clock_timestamp()) is distinct from challenge
   or not exists(select 1 from private.reauth_challenges c where c.id=challenge
    and c.factor_verified_at>=clock_timestamp()-interval '15 minutes' and c.invalidated_at is null)
  then raise exception using errcode='42501',message='current same-session recent AAL2 evidence is required'; end if;
 end if;
 perform private.assert_custom_response_access(p_org,p_branch,p_client,case when action='sign' then 'care_records.sign' else 'care_records.write' end);
 return jsonb_build_object('record',private.custom_response_json(result),'replayed',false);
end;$$;

create function private.read_custom_responses_scoped(p_org uuid,p_branch uuid,p_client uuid,p_before timestamptz,p_before_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare forms jsonb; records jsonb; total integer; stamp timestamptz:=clock_timestamp();
begin
 perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
 if (p_before is null)<>(p_before_id is null) then raise exception using errcode='22023',message='invalid response cursor'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',d.name,'version',v.version,'schema',v.schema_json,'effectiveFrom',v.effective_from,'effectiveTo',v.effective_to) order by d.name,v.version),'[]') into forms
 from public.form_versions v join public.form_definitions d on d.id=v.form_definition_id
 where d.organization_id=p_org and not d.is_official and d.form_key ~ '^tenant\.custom\.' and v.schema_json->>'builder'='tenant-custom.v1'
 and v.status='published' and v.scoring_json='{}'::jsonb and v.effective_from<=(stamp at time zone 'Asia/Taipei')::date
 and (v.effective_to is null or v.effective_to>=(stamp at time zone 'Asia/Taipei')::date);
 -- Count and page share one statement snapshot, so a concurrent append cannot
 -- make the returned total smaller than its page under READ COMMITTED.
 with scoped as materialized (
  select r.* from private.custom_form_responses r
  where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=p_client
 ), page as (
  select r.* from scoped r where p_before is null or (r.created_at,r.id)<(p_before,p_before_id)
  order by r.created_at desc,r.id desc limit 51
 )
 select (select count(*) from scoped),
  coalesce((select jsonb_agg(private.custom_response_json(r::private.custom_form_responses)
    order by r.created_at desc,r.id desc) from page r),'[]') into total,records;
 perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','custom_form_responses',p_client::text,'{}',jsonb_build_object('loaded',least(jsonb_array_length(records),50)));
 -- Never disclose a previously loaded page after a blocking audit write if
 -- the reader no longer has current live authority over this client.
 perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
 return jsonb_build_object('clientId',p_client,'forms',forms,'records',case when jsonb_array_length(records)>50 then records-50 else records end,
  'hasMore',jsonb_array_length(records)>50,'total',total,'generatedAt',stamp);
end;$$;
create function public.write_custom_form_response(p_org uuid,p_branch uuid,p_client uuid,p_key uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.write_custom_response_atomic(p_org,p_branch,p_client,p_key,p_input);$$;
create function public.read_custom_form_responses(p_org uuid,p_branch uuid,p_client uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.read_custom_responses_scoped(p_org,p_branch,p_client,p_before,p_before_id);$$;
revoke all on function private.reject_custom_response_mutation(),private.assert_custom_response_access(uuid,uuid,uuid,text),private.validate_custom_answers(jsonb,jsonb,boolean),private.custom_response_json(private.custom_form_responses),
 private.write_custom_response_atomic(uuid,uuid,uuid,uuid,jsonb),private.read_custom_responses_scoped(uuid,uuid,uuid,timestamptz,uuid),
 public.write_custom_form_response(uuid,uuid,uuid,uuid,jsonb),public.read_custom_form_responses(uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function private.write_custom_response_atomic(uuid,uuid,uuid,uuid,jsonb),private.read_custom_responses_scoped(uuid,uuid,uuid,timestamptz,uuid),
 public.write_custom_form_response(uuid,uuid,uuid,uuid,jsonb),public.read_custom_form_responses(uuid,uuid,uuid,timestamptz,uuid) to authenticated;
commit;
