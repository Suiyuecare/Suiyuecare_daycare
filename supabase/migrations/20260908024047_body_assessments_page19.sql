-- Page 19: explicit, nonstandard MANUAL body observations. No diagnosis, scoring,
-- official instrument, media storage or automatic disposition is supplied here.
insert into public.permissions(permission_key,description,risk_level) values
 ('body_assessments.read','Read assigned-client manual body observations',2),
 ('body_assessments.manage','Create and revise manual body observation drafts',2),
 ('body_assessments.sign','Sign and correct manual body observations',3)
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.is_system and r.role_key in ('organization_manager','branch_supervisor','nurse','care_worker','professional')
 and p.permission_key in ('body_assessments.read','body_assessments.manage','body_assessments.sign')
on conflict(role_id,permission_id) do nothing;

create function private.body_observations_valid(p_items jsonb,p_signing boolean)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_item jsonb; v_area text; v_areas text[] := '{}'; v_state text; v_key text;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_items) not between 1 and 10 then return false; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item) is distinct from 'object' or not v_item ?& array['area','state','description','reason','disposition']
   or v_item - array['area','state','description','reason','disposition'] <> '{}'::jsonb then return false; end if;
  v_area:=v_item->>'area'; v_state:=v_item->>'state';
  if v_area is null or v_area not in ('head','neck','chest','abdomen','back','left_arm','right_arm','left_leg','right_leg','other')
   or v_area=any(v_areas) or v_state is null or v_state not in ('normal','abnormal','missing','not_applicable') then return false; end if;
  v_areas:=array_append(v_areas,v_area);
  foreach v_key in array array['description','reason','disposition'] loop
   if v_item->v_key <> 'null'::jsonb and (jsonb_typeof(v_item->v_key) is distinct from 'string'
     or char_length(v_item->>v_key) not between 1 and (case when v_key='reason' then 1000 else 2000 end)
     or (v_item->>v_key) <> btrim(v_item->>v_key)
     or translate(v_item->>v_key,E'\n\r\t','') ~ '[[:cntrl:]]') then return false; end if;
  end loop;
  if v_state in ('missing','not_applicable') then
   if v_item->'reason'='null'::jsonb or v_item->'description'<>'null'::jsonb or v_item->'disposition'<>'null'::jsonb then return false; end if;
  else
   if v_item->'reason'<>'null'::jsonb or (v_state='normal' and v_item->'disposition'<>'null'::jsonb)
    or (v_area='other' and v_item->'description'='null'::jsonb) then return false; end if;
   if p_signing and v_state='abnormal' and (v_item->'description'='null'::jsonb or v_item->'disposition'='null'::jsonb) then return false; end if;
  end if;
 end loop;
 return true;
end;
$$;

create table public.body_assessment_versions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 assessment_key uuid not null, version integer not null check(version between 1 and 1000001), previous_version_id uuid unique,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), record_state text not null check(record_state in ('draft','signed','corrected')),
 instrument text not null default 'manual_nonstandard_body_observation_v1' check(instrument='manual_nonstandard_body_observation_v1'),
 observed_at timestamptz not null, observations jsonb not null,
 reason text not null check(char_length(reason) between 1 and 1000 and reason=btrim(reason) and translate(reason,E'\n\r\t','') !~ '[[:cntrl:]]'),
 actor_user_id uuid not null references auth.users(id) on delete restrict, actor_display_name text not null,
 signed_at timestamptz, signed_by uuid references auth.users(id) on delete restrict, signer_role_keys text[], signature_purpose text,
 signature_reauth_challenge_id uuid references private.reauth_challenges(id) on delete restrict, created_at timestamptz not null default clock_timestamp(),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
 unique(id,organization_id,branch_id,client_id,assessment_key), unique(organization_id,branch_id,assessment_key,version),
 foreign key(previous_version_id,organization_id,branch_id,client_id,assessment_key)
  references public.body_assessment_versions(id,organization_id,branch_id,client_id,assessment_key) on delete restrict,
 check((version=1)=(previous_version_id is null)),
 check(private.body_observations_valid(observations,record_state<>'draft')),
 check(extract(year from observed_at at time zone 'Asia/Taipei') between 2000 and 2200 and observed_at <= created_at + interval '5 minutes'),
 check(char_length(actor_display_name) between 1 and 160 and actor_display_name=btrim(actor_display_name) and actor_display_name !~ '[[:cntrl:]]'),
 check((record_state='draft' and signed_at is null and signed_by is null and signer_role_keys is null
    and signature_purpose is null and signature_reauth_challenge_id is null)
  or (record_state in ('signed','corrected') and signed_at is not null and signed_at=created_at and signed_by is not null and signed_by=actor_user_id
    and signer_role_keys is not null and cardinality(signer_role_keys) between 1 and 50 and signature_reauth_challenge_id is not null
    and signature_purpose=case when record_state='signed' then '人工身體觀察簽署' else '人工身體觀察更正簽署' end)),
 check(record_state<>'corrected' or char_length(reason)>=8)
);
create table private.body_assessment_operations(
 id uuid primary key, organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
 actor_user_id uuid not null references auth.users(id) on delete restrict, idempotency_key uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), result_version_id uuid not null,
 result_assessment_key uuid not null, receipt jsonb not null,
 unique(actor_user_id,idempotency_key),
 foreign key(result_version_id,organization_id,branch_id,client_id,result_assessment_key)
  references public.body_assessment_versions(id,organization_id,branch_id,client_id,assessment_key) on delete restrict
);
create index body_assessment_scope_idx on public.body_assessment_versions(organization_id,branch_id,assessment_key,version desc);
create index body_assessment_client_idx on public.body_assessment_versions(client_id,observed_at desc);
create index body_assessment_actor_idx on public.body_assessment_versions(actor_user_id);
create index body_assessment_signer_idx on public.body_assessment_versions(signed_by) where signed_by is not null;
create index body_assessment_reauth_idx on public.body_assessment_versions(signature_reauth_challenge_id) where signature_reauth_challenge_id is not null;
create index body_assessment_operation_result_idx on private.body_assessment_operations(result_version_id);
create index body_assessment_operation_scope_idx on private.body_assessment_operations(organization_id,branch_id,client_id,result_assessment_key);
alter table public.body_assessment_versions enable row level security;
alter table public.body_assessment_versions force row level security;
alter table private.body_assessment_operations enable row level security;
alter table private.body_assessment_operations force row level security;
revoke all on public.body_assessment_versions,private.body_assessment_operations from public,anon,authenticated,service_role;
create function private.body_assessment_append_only() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='55000',message='body assessment history is append-only'; end; $$;
create trigger body_assessment_versions_append_only before update or delete on public.body_assessment_versions
 for each row execute function private.body_assessment_append_only();
create trigger body_assessment_operations_append_only before update or delete on private.body_assessment_operations
 for each row execute function private.body_assessment_append_only();
create trigger body_assessment_versions_audit_row_change after insert on public.body_assessment_versions for each row execute function private.audit_row_change();
create trigger body_assessment_operations_audit_row_change after insert on private.body_assessment_operations for each row execute function private.audit_row_change();

create function private.body_assessment_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
  join public.roles r on r.id=mr.role_id and r.is_active join public.role_permissions rp on rp.role_id=r.id
  join public.permissions p on p.id=rp.permission_id where m.profile_id=auth.uid() and m.organization_id=p_org
   and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
   and (m.branch_id is null or m.branch_id=p_branch) and (r.organization_id is null or r.organization_id=p_org)
   and p.permission_key=p_permission);
$$;
create function private.body_assessment_authority(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(auth.jwt()->>'aal','')='aal2'
  and p_permission in ('body_assessments.read','body_assessments.manage','body_assessments.sign')
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind in ('staff','professional'))
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and private.body_assessment_permission(p_org,p_branch,'clients.read') and private.body_assessment_permission(p_org,p_branch,'body_assessments.read')
  and private.body_assessment_permission(p_org,p_branch,p_permission)
  and (p_client is null or (exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
    and (private.body_assessment_permission(p_org,p_branch,'clients.view_all') or exists(select 1 from public.client_assignments a
      where a.client_id=p_client and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
      and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())))));
$$;
create function private.body_assessment_reauth(p_actor uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_challenge uuid; v_now timestamptz:=clock_timestamp();
begin
 if p_actor is null or p_actor<>auth.uid() or not private.has_recent_aal2(15) or coalesce(auth.jwt()->>'aal','')<>'aal2' then
  raise exception using errcode='42501',message='body assessment requires recent same-session AAL2'; end if;
 begin v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then raise exception using errcode='42501',message='body assessment requires recent same-session AAL2'; end;
 select c.id into v_challenge from private.reauth_challenges c join private.reauth_events e
  on e.challenge_id=c.id and e.user_id=c.user_id and e.session_id=c.session_id
 where e.user_id=p_actor and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
  and c.consumed_at is not null and c.invalidated_at is null and e.verification_method in ('totp','webauthn','phone')
  and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and c.factor_verified_at between v_now-interval '15 minutes' and v_now+interval '1 minute'
 order by c.factor_verified_at desc,c.id desc limit 1 for share of c,e;
 if v_challenge is null then raise exception using errcode='42501',message='body assessment requires recent same-session AAL2'; end if;
 return v_challenge;
end; $$;

create function private.mutate_body_assessment_guarded(p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_action text; v_permission text; v_client uuid; v_key uuid; v_previous uuid;
 v_expected integer; v_expected_hash text; v_reason text; v_observed timestamptz; v_items jsonb;
 v_hash text; v_request_hash text; v_challenge uuid; v_now timestamptz; v_actor_name text; v_roles text[];
 v_state text; v_result public.body_assessment_versions%rowtype; v_prior public.body_assessment_versions%rowtype;
 v_op private.body_assessment_operations%rowtype; v_operation_id uuid:=gen_random_uuid(); v_receipt jsonb; v_keys text[];
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_idempotency_key is null
  or p_expected_organization_id is null or p_expected_branch_id is null then raise exception using errcode='22023',message='invalid body assessment payload'; end if;
 v_action:=p_payload->>'action';
 if v_action is null or v_action not in ('create','revise','sign','correct') then raise exception using errcode='22023',message='invalid body assessment action'; end if;
 v_permission:=case when v_action in ('create','revise') then 'body_assessments.manage' else 'body_assessments.sign' end;
 if not private.body_assessment_authority(p_expected_organization_id,p_expected_branch_id,null,v_permission) then
  raise exception using errcode='42501',message='body assessment operation is not permitted'; end if;
 v_keys:=array['action','client_id','assessment_key','previous_version_id','expected_version','expected_content_hash','reason'];
 if v_action<>'sign' then v_keys:=v_keys||array['observed_at','observations','instrument']; end if;
 if not p_payload ?& v_keys or p_payload-v_keys<>'{}'::jsonb
  or jsonb_typeof(p_payload->'client_id')<>'string' or jsonb_typeof(p_payload->'reason')<>'string'
  or jsonb_typeof(p_payload->'expected_version')<>'number' or (p_payload->>'expected_version') !~ '^(0|[1-9][0-9]{0,6})$' then
  raise exception using errcode='22023',message='invalid body assessment payload'; end if;
 begin v_client:=(p_payload->>'client_id')::uuid; v_key:=(p_payload->>'assessment_key')::uuid;
  v_previous:=(p_payload->>'previous_version_id')::uuid; v_expected:=(p_payload->>'expected_version')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid body assessment baseline'; end;
 v_expected_hash:=p_payload->>'expected_content_hash'; v_reason:=p_payload->>'reason';
 if not private.body_assessment_authority(p_expected_organization_id,p_expected_branch_id,v_client,v_permission) or v_client is null then
  raise exception using errcode='42501',message='body assessment client is not permitted'; end if;
 if v_expected>1000000 or (v_action='create' and (p_payload->'assessment_key'<>'null'::jsonb or p_payload->'previous_version_id'<>'null'::jsonb
    or v_expected<>0 or p_payload->'expected_content_hash'<>'null'::jsonb))
  or (v_action<>'create' and (jsonb_typeof(p_payload->'assessment_key')<>'string' or jsonb_typeof(p_payload->'previous_version_id')<>'string'
    or jsonb_typeof(p_payload->'expected_content_hash')<>'string' or v_key is null or v_previous is null or v_expected<1 or v_expected_hash is null or v_expected_hash !~ '^[a-f0-9]{64}$')) then
  raise exception using errcode='22023',message='invalid body assessment baseline'; end if;
 if v_reason<>btrim(v_reason) or char_length(v_reason) not between (case when v_action='correct' then 8 else 1 end) and 1000
  or translate(v_reason,E'\n\r\t','') ~ '[[:cntrl:]]'
  or (v_action='sign' and v_reason<>'本人確認已核對所選部位的人工觀察與處置') then
  raise exception using errcode='22023',message='invalid body assessment reason'; end if;
 if v_action<>'sign' then
  if p_payload->>'instrument' is distinct from 'manual_nonstandard_body_observation_v1'
    or jsonb_typeof(p_payload->'observed_at') is distinct from 'string'
    or (p_payload->>'observed_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
    or not private.body_observations_valid(p_payload->'observations',v_action='correct') then
   raise exception using errcode='22023',message='invalid manual body observations'; end if;
  begin v_observed:=(p_payload->>'observed_at')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid body observation time'; end;
  if extract(year from v_observed at time zone 'Asia/Taipei') not between 2000 and 2200 or v_observed>clock_timestamp()+interval '5 minutes' then
   raise exception using errcode='22023',message='invalid body observation time'; end if;
  v_items:=p_payload->'observations';
 end if;
 if v_action in ('sign','correct') then v_challenge:=private.body_assessment_reauth(v_actor); end if;
 v_request_hash:=encode(sha256(convert_to(jsonb_build_object('organization_id',p_expected_organization_id,
  'branch_id',p_expected_branch_id,'payload',p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('body-assessment-operation:'||v_actor::text||':'||p_idempotency_key::text,0));
 select * into v_op from private.body_assessment_operations o where o.actor_user_id=v_actor and o.idempotency_key=p_idempotency_key;
 if v_op.id is not null then
  if v_op.request_hash<>v_request_hash then raise exception using errcode='23505',message='body assessment idempotency conflict'; end if;
  if not private.body_assessment_authority(p_expected_organization_id,p_expected_branch_id,v_op.client_id,v_permission) then
   raise exception using errcode='42501',message='body assessment replay is not permitted'; end if;
  if v_action in ('sign','correct') then perform private.body_assessment_reauth(v_actor); end if;
  return v_op.receipt||jsonb_build_object('replayed',true);
 end if;
 v_key:=coalesce(v_key,gen_random_uuid());
 perform pg_advisory_xact_lock(hashtextextended('body-assessment-chain:'||p_expected_organization_id::text||':'||p_expected_branch_id::text||':'||v_key::text,0));
 if v_action<>'create' then
  select r.* into v_prior from public.body_assessment_versions r where r.organization_id=p_expected_organization_id
   and r.branch_id=p_expected_branch_id and r.client_id=v_client and r.assessment_key=v_key
   order by r.version desc limit 1 for share;
  if v_prior.id is null or v_prior.id<>v_previous or v_prior.version<>v_expected or v_prior.content_hash<>v_expected_hash then
   raise exception using errcode='40001',message='body assessment version is stale'; end if;
  if (v_action in ('revise','sign') and v_prior.record_state<>'draft') or (v_action='correct' and v_prior.record_state not in ('signed','corrected')) then
   raise exception using errcode='23514',message='body assessment state transition is invalid'; end if;
 end if;
 if v_action='sign' then v_observed:=v_prior.observed_at; v_items:=v_prior.observations; end if;
 if v_action in ('sign','correct') and not private.body_observations_valid(v_items,true) then
  raise exception using errcode='23514',message='abnormal body observations require description and human disposition before signing'; end if;
 v_state:=case when v_action='sign' then 'signed' when v_action='correct' then 'corrected' else 'draft' end;
 v_now:=clock_timestamp();
 select p.display_name into v_actor_name from public.profiles p where p.id=v_actor and p.is_active;
 if v_state<>'draft' then
  v_challenge:=private.body_assessment_reauth(v_actor);
  select array_agg(distinct r.role_key order by r.role_key) into v_roles from public.memberships m
   join public.membership_roles mr on mr.membership_id=m.id join public.roles r on r.id=mr.role_id and r.is_active
   where m.profile_id=v_actor and m.organization_id=p_expected_organization_id and m.status='active'
    and m.starts_at<=v_now and (m.ends_at is null or m.ends_at>v_now) and (m.branch_id is null or m.branch_id=p_expected_branch_id)
    and (r.organization_id is null or r.organization_id=p_expected_organization_id);
 end if;
 if v_actor_name is null or (v_state<>'draft' and coalesce(cardinality(v_roles),0)=0)
  or not private.body_assessment_authority(p_expected_organization_id,p_expected_branch_id,v_client,v_permission) then
  raise exception using errcode='42501',message='body assessment authority expired'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('schema_version',1,'organization_id',p_expected_organization_id,
  'branch_id',p_expected_branch_id,'client_id',v_client,'assessment_key',v_key,'version',v_expected+1,'previous_version_id',v_previous,
  'record_state',v_state,'instrument','manual_nonstandard_body_observation_v1','observed_at',v_observed,'observations',v_items,
  'reason',v_reason,'actor_user_id',v_actor,'actor_display_name',v_actor_name,'signer_roles',v_roles,'reauth_challenge_id',v_challenge,'created_at',v_now)::text,'UTF8')),'hex');
 insert into public.body_assessment_versions(organization_id,branch_id,client_id,assessment_key,version,previous_version_id,
  content_hash,record_state,observed_at,observations,reason,actor_user_id,actor_display_name,signed_at,signed_by,signer_role_keys,
  signature_purpose,signature_reauth_challenge_id,created_at)
 values(p_expected_organization_id,p_expected_branch_id,v_client,v_key,v_expected+1,v_previous,v_hash,v_state,v_observed,v_items,v_reason,
  v_actor,v_actor_name,case when v_state<>'draft' then v_now end,case when v_state<>'draft' then v_actor end,v_roles,
  case when v_state='signed' then '人工身體觀察簽署' when v_state='corrected' then '人工身體觀察更正簽署' end,v_challenge,v_now) returning * into v_result;
 v_receipt:=jsonb_build_object('operation_id',v_operation_id,'organization_id',p_expected_organization_id,'branch_id',p_expected_branch_id,
  'actor_user_id',v_actor,'client_id',v_client,'idempotency_key',p_idempotency_key,'request_payload',p_payload,'assessment_key',v_key,
  'version_id',v_result.id,'version',v_result.version,'record_state',v_state,'content_hash',v_hash,'committed_at',v_now,'replayed',false);
 insert into private.body_assessment_operations(id,organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_hash,
  result_version_id,result_assessment_key,receipt) values(v_operation_id,p_expected_organization_id,p_expected_branch_id,v_client,
  v_actor,p_idempotency_key,v_request_hash,v_result.id,v_key,v_receipt);
 return v_receipt;
end; $$;
create function public.mutate_body_assessment(p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid)
returns table(operation_id uuid,organization_id uuid,branch_id uuid,actor_user_id uuid,client_id uuid,idempotency_key uuid,request_payload jsonb,
 assessment_key uuid,version_id uuid,version integer,record_state text,content_hash text,committed_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
 select r.* from jsonb_to_record(private.mutate_body_assessment_guarded(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key))
  as r(operation_id uuid,organization_id uuid,branch_id uuid,actor_user_id uuid,client_id uuid,idempotency_key uuid,request_payload jsonb,
  assessment_key uuid,version_id uuid,version integer,record_state text,content_hash text,committed_at timestamptz,replayed boolean);
$$;

create function private.body_assessment_version_json(p_row public.body_assessment_versions,p_name text)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select (to_jsonb(p_row)-array['id','organization_id','branch_id'])||jsonb_build_object('version_id',p_row.id,'client_display_name',p_name);
$$;
create function private.body_assessment_snapshot_guarded(p_org uuid,p_branch uuid,p_client uuid,p_state text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not private.body_assessment_authority(p_org,p_branch,p_client,'body_assessments.read') then
  raise exception using errcode='42501',message='body assessment snapshot is not permitted'; end if;
 if p_state is not null and p_state not in ('draft','signed','corrected') then raise exception using errcode='22023',message='invalid body assessment filters'; end if;
 with clients as materialized(select c.id,c.display_name from public.clients c where c.organization_id=p_org and c.branch_id=p_branch
   and private.body_assessment_authority(p_org,p_branch,c.id,'body_assessments.read')),
 current_records as materialized(select distinct on(r.assessment_key) r.* from public.body_assessment_versions r
   join clients c on c.id=r.client_id where r.organization_id=p_org and r.branch_id=p_branch order by r.assessment_key,r.version desc),
 matching as materialized(select r.* from current_records r where (p_client is null or r.client_id=p_client) and (p_state is null or r.record_state=p_state)),
 page as (select * from matching order by observed_at desc,assessment_key limit 200),
 options as (select * from clients order by display_name,id limit 200)
 select jsonb_build_object('organization_id',p_org,'branch_id',p_branch,'generated_at',clock_timestamp(),
  'records',coalesce((select jsonb_agg(private.body_assessment_version_json(r,c.display_name)||jsonb_build_object(
   'history',coalesce((select jsonb_agg(private.body_assessment_version_json(h,c.display_name) order by h.version desc)
     from(select old.* from public.body_assessment_versions old where old.organization_id=p_org and old.branch_id=p_branch
      and old.client_id=r.client_id and old.assessment_key=r.assessment_key and old.version<r.version order by old.version desc limit 50) h),'[]'::jsonb),
   'history_total',(select count(*) from public.body_assessment_versions h where h.organization_id=p_org and h.branch_id=p_branch
     and h.client_id=r.client_id and h.assessment_key=r.assessment_key and h.version<r.version)) order by r.observed_at desc,r.assessment_key)
   from page r join clients c on c.id=r.client_id),'[]'::jsonb),
  'matching_total',(select count(*) from matching),'records_truncated',(select count(*) from matching)>200,
  'clients',coalesce((select jsonb_agg(jsonb_build_object('client_id',c.id,'display_name',c.display_name) order by c.display_name,c.id) from options c),'[]'::jsonb),
  'client_total',(select count(*) from clients),'clients_truncated',(select count(*) from clients)>200,'attachment_status','not_configured') into v_result;
 -- The read is one SQL statement; recheck all returned clients immediately before release.
 if not private.body_assessment_authority(p_org,p_branch,p_client,'body_assessments.read')
  or exists(select 1 from jsonb_array_elements(v_result->'records') r where not private.body_assessment_authority(p_org,p_branch,(r->>'client_id')::uuid,'body_assessments.read'))
  or exists(select 1 from jsonb_array_elements(v_result->'clients') c where not private.body_assessment_authority(p_org,p_branch,(c->>'client_id')::uuid,'body_assessments.read')) then
  raise exception using errcode='42501',message='body assessment snapshot authority expired'; end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_org,p_branch,auth.uid(),'select','body_assessment_versions','snapshot',array[]::text[],
  jsonb_build_object('workflow','page19_body_assessment_snapshot_v1','narrative_logged',false));
 return v_result;
end; $$;
create function public.body_assessment_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid default null,p_state text default null)
returns table(organization_id uuid,branch_id uuid,generated_at timestamptz,records jsonb,matching_total bigint,records_truncated boolean,
 clients jsonb,client_total bigint,clients_truncated boolean,attachment_status text)
language sql volatile security invoker set search_path='' as $$
 select r.* from jsonb_to_record(private.body_assessment_snapshot_guarded(p_expected_organization_id,p_expected_branch_id,p_client_id,p_state))
 as r(organization_id uuid,branch_id uuid,generated_at timestamptz,records jsonb,matching_total bigint,records_truncated boolean,
 clients jsonb,client_total bigint,clients_truncated boolean,attachment_status text);
$$;
revoke all on function private.body_observations_valid(jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function private.body_assessment_append_only() from public,anon,authenticated,service_role;
revoke all on function private.body_assessment_authority(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.body_assessment_permission(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.body_assessment_reauth(uuid) from public,anon,authenticated,service_role;
revoke all on function private.body_assessment_version_json(public.body_assessment_versions,text) from public,anon,authenticated,service_role;
revoke all on function private.mutate_body_assessment_guarded(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function private.body_assessment_snapshot_guarded(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.mutate_body_assessment(uuid,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.body_assessment_snapshot(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.mutate_body_assessment_guarded(uuid,uuid,jsonb,uuid),private.body_assessment_snapshot_guarded(uuid,uuid,uuid,text),
 public.mutate_body_assessment(uuid,uuid,jsonb,uuid),public.body_assessment_snapshot(uuid,uuid,uuid,text) to authenticated;
