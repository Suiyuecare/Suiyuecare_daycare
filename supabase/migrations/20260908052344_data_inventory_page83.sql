-- Page 83 source-data inventory: manually entered metadata, not proof of
-- attachment integrity, migration, clinical completeness or release readiness.
create function private.data_inventory_content_valid(c jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; d date;
begin
  if jsonb_typeof(c) is distinct from 'object' or not c ?& array['status','source','accountableRole','periodStart','periodEnd',
    'expectedCount','actualCount','missingRequired','unmapped','conflicts','criticalDifferences','keyFields','amounts','attachments','evidenceReference','reasonCode']
    or (select count(*) from jsonb_object_keys(c))<>16 then return false; end if;
  if coalesce(c->>'status','') not in ('missing','received','not_applicable')
    or coalesce(c->>'source','') not in ('unknown','central_html','previous_system','spreadsheet','paper','organization_file')
    or coalesce(c->>'accountableRole','') not in ('unassigned','organization_manager','branch_supervisor','case_manager_social_worker','nurse','finance_claims')
    or coalesce(c->>'reasonCode','') not in ('none','out_of_scope','no_historical_data','data_correction','source_updated') then return false; end if;
  foreach k in array array['status','source','accountableRole','reasonCode','keyFields','amounts','attachments'] loop
    if jsonb_typeof(c->k)<>'string' then return false; end if;
  end loop;
  foreach k in array array['keyFields','amounts','attachments'] loop
    if c->>k not in ('pending','passed','not_applicable') then return false; end if;
  end loop;
  foreach k in array array['expectedCount','actualCount','missingRequired','unmapped','conflicts','criticalDifferences'] loop
    if c->k<>'null'::jsonb and (jsonb_typeof(c->k)<>'number' or (c->>k)::numeric<0 or (c->>k)::numeric>1000000000
      or trunc((c->>k)::numeric)<>(c->>k)::numeric) then return false; end if;
  end loop;
  foreach k in array array['periodStart','periodEnd'] loop
    if c->k<>'null'::jsonb then
      if jsonb_typeof(c->k)<>'string' or c->>k !~ '^(19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)-[0-9]{2}-[0-9]{2}$' then return false; end if;
      d:=(c->>k)::date; if to_char(d,'YYYY-MM-DD')<>c->>k then return false; end if;
    end if;
  end loop;
  if (c->'periodStart'='null'::jsonb)<>(c->'periodEnd'='null'::jsonb)
    or c->>'periodStart'>c->>'periodEnd' then return false; end if;
  if c->'evidenceReference'<>'null'::jsonb and (jsonb_typeof(c->'evidenceReference')<>'string'
    or c->>'evidenceReference' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then return false; end if;
  if c->>'status'='not_applicable' then
    if c->>'reasonCode' not in ('out_of_scope','no_historical_data') then return false; end if;
    foreach k in array array['periodStart','periodEnd','expectedCount','actualCount','missingRequired','unmapped','conflicts','criticalDifferences'] loop
      if c->k<>'null'::jsonb then return false; end if;
    end loop;
    foreach k in array array['keyFields','amounts','attachments'] loop
      if c->>k<>'not_applicable' then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end;
$$;
create function private.data_inventory_reviewable(k text,c jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(private.data_inventory_content_valid(c) and c->>'status'<>'missing' and c->>'source'<>'unknown'
  and c->>'accountableRole'<>'unassigned' and c->'evidenceReference'<>'null'::jsonb and (
   c->>'status'='not_applicable' or (
    c->'periodStart'<>'null'::jsonb and c->'periodEnd'<>'null'::jsonb
    and c->'expectedCount'<>'null'::jsonb and c->'actualCount'<>'null'::jsonb and c->'expectedCount'=c->'actualCount'
    and c->'missingRequired'='0'::jsonb and c->'unmapped'='0'::jsonb and c->'conflicts'='0'::jsonb and c->'criticalDifferences'='0'::jsonb
    and c->>'keyFields'='passed' and c->>'amounts'<>'pending' and c->>'attachments'<>'pending'
    and (k not in ('billing','claims') or c->>'amounts'='passed')
    and (k<>'history_attachments' or c->>'attachments'='passed')
    and ((c->>'amounts'<>'not_applicable' and c->>'attachments'<>'not_applicable') or c->>'reasonCode' in ('out_of_scope','no_historical_data'))
   )),false);
$$;
create table public.data_inventory_versions(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, branch_id uuid not null,
  item_key text not null check(item_key in ('client_master','consents','authorized_plans','care_execution','medication','attendance_transport',
    'billing','claims','organization','staff','forms_rules','history_attachments')),
  object_id uuid not null, version integer not null check(version between 1 and 1000001), previous_version_id uuid unique,
  content jsonb not null check(private.data_inventory_content_valid(content)), content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  content_recorded_by uuid not null references auth.users(id) on delete restrict,
  review_state text not null check(review_state in ('pending','manually_verified')),
  reviewed_by uuid references auth.users(id) on delete restrict, reviewed_at timestamptz,
  review_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(organization_id,branch_id,item_key,version), unique(id,organization_id,branch_id,item_key,object_id),
  foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
  foreign key(previous_version_id,organization_id,branch_id,item_key,object_id)
    references public.data_inventory_versions(id,organization_id,branch_id,item_key,object_id) on delete restrict,
  check((version=1)=(previous_version_id is null)),
  check((review_state='pending' and reviewed_by is null and reviewed_at is null and review_challenge_id is null and recorded_by=content_recorded_by)
    or (review_state='manually_verified' and reviewed_by is not null and reviewed_by=recorded_by and reviewed_by<>content_recorded_by
      and reviewed_at=created_at and review_challenge_id is not null and version>1 and private.data_inventory_reviewable(item_key,content)))
);
create index data_inventory_branch_idx on public.data_inventory_versions(branch_id,organization_id);
create index data_inventory_previous_idx on public.data_inventory_versions(previous_version_id,organization_id,branch_id,item_key,object_id);
create index data_inventory_author_idx on public.data_inventory_versions(recorded_by);
create index data_inventory_content_author_idx on public.data_inventory_versions(content_recorded_by);
create index data_inventory_reviewer_idx on public.data_inventory_versions(reviewed_by) where reviewed_by is not null;
create index data_inventory_challenge_idx on public.data_inventory_versions(review_challenge_id) where review_challenge_id is not null;
create table private.data_inventory_operations(
  id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null, request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  version_id uuid not null references public.data_inventory_versions(id) on delete restrict,
  receipt jsonb not null, unique(actor_user_id,idempotency_key)
);
create index data_inventory_operation_version_idx on private.data_inventory_operations(version_id);
alter table public.data_inventory_versions enable row level security;
alter table public.data_inventory_versions force row level security;
alter table private.data_inventory_operations enable row level security;
alter table private.data_inventory_operations force row level security;
revoke all on public.data_inventory_versions,private.data_inventory_operations from public,anon,authenticated,service_role;
create function private.data_inventory_append_only() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='55000',message='data inventory is append-only'; end;
$$;
create trigger data_inventory_versions_append_only before update or delete on public.data_inventory_versions for each row execute function private.data_inventory_append_only();
create trigger data_inventory_operations_append_only before update or delete on private.data_inventory_operations for each row execute function private.data_inventory_append_only();
create trigger data_inventory_versions_audit_row_change after insert on public.data_inventory_versions for each row execute function private.audit_row_change();

create function private.data_inventory_authorized(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
  and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind='staff')
  and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
  and exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id and r.is_active and r.is_system
    join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
    where m.profile_id=auth.uid() and m.organization_id=p_org and (m.branch_id=p_branch or (m.branch_id is null and r.role_key='organization_manager'))
    and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
    and r.role_key in ('organization_manager','branch_supervisor') and p.permission_key='audit.view'),false);
$$;
create function private.data_inventory_reauth() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid; v_session uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception using errcode='42501',message='inventory recent AAL2 required'; end if;
  begin v_session:=(auth.jwt()->>'session_id')::uuid;
  exception when others then raise exception using errcode='42501',message='inventory recent AAL2 required'; end;
  select c.id into v_id from private.reauth_events e join private.reauth_challenges c
    on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
  where e.user_id=auth.uid() and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
    and e.verification_method in ('totp','webauthn','phone') and c.consumed_at is not null and c.invalidated_at is null
    and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
    and c.factor_verified_at>=clock_timestamp()-interval '15 minutes' and c.factor_verified_at<=clock_timestamp()+interval '1 minute'
  order by c.factor_verified_at desc limit 1 for share of e,c;
  if v_id is null then raise exception using errcode='42501',message='inventory recent AAL2 required'; end if;
  return v_id;
end;
$$;
create function private.data_inventory_version_json(v public.data_inventory_versions)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('versionId',v.id,'objectId',v.object_id,'itemKey',v.item_key,'version',v.version,'previousVersionId',v.previous_version_id,
  'content',v.content,'contentHash',v.content_hash,'recordedBy',v.recorded_by,'contentRecordedBy',v.content_recorded_by,'createdAt',v.created_at,
  'reviewState',v.review_state,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at,'reviewChallengeId',v.review_challenge_id);
$$;
create function private.mutate_data_inventory(p_org uuid,p_branch uuid,p_request jsonb,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_action text; v_item text; v_expected integer; v_content jsonb; v_challenge uuid;
 v_old public.data_inventory_versions%rowtype; v_new public.data_inventory_versions%rowtype;
 v_operation private.data_inventory_operations%rowtype; v_hash text; v_receipt jsonb; v_operation_id uuid:=gen_random_uuid();
begin
 if not private.data_inventory_authorized(p_org,p_branch) then raise exception using errcode='42501',message='inventory operation denied'; end if;
 if p_key is null or jsonb_typeof(p_request) is distinct from 'object'
  or not p_request ?& array['action','itemKey','expectedVersion']
  or coalesce(p_request->>'action','') not in ('save','verify')
  or jsonb_typeof(p_request->'action')<>'string' or jsonb_typeof(p_request->'itemKey')<>'string'
  or jsonb_typeof(p_request->'expectedVersion')<>'number'
  or (p_request->>'expectedVersion')::numeric<>trunc((p_request->>'expectedVersion')::numeric)
  or (p_request->>'expectedVersion')::numeric not between 0 and 1000000 then
  raise exception using errcode='22023',message='invalid inventory request'; end if;
 v_action:=p_request->>'action'; v_item:=p_request->>'itemKey'; v_expected:=(p_request->>'expectedVersion')::integer;
 if v_item not in ('client_master','consents','authorized_plans','care_execution','medication','attendance_transport',
  'billing','claims','organization','staff','forms_rules','history_attachments')
  or (select count(*) from jsonb_object_keys(p_request))<>(case when v_action='save' then 4 else 5 end) then
  raise exception using errcode='22023',message='invalid inventory request'; end if;
 if v_action='save' then
  v_content:=p_request->'content';
  if not private.data_inventory_content_valid(v_content) or (v_expected>0 and v_content->>'reasonCode'='none') then
   raise exception using errcode='22023',message='invalid inventory content'; end if;
 else
  if v_expected=0 or not p_request ?& array['expectedVersionId','expectedContentHash']
    or jsonb_typeof(p_request->'expectedVersionId')<>'string' or jsonb_typeof(p_request->'expectedContentHash')<>'string'
    or p_request->>'expectedVersionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request->>'expectedContentHash' !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='invalid inventory request'; end if;
  v_challenge:=private.data_inventory_reauth();
 end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'request',p_request)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_key::text,83));
 if not private.data_inventory_authorized(p_org,p_branch) then raise exception using errcode='42501',message='inventory operation denied'; end if;
 if v_action='verify' then v_challenge:=private.data_inventory_reauth(); end if;
 select * into v_operation from private.data_inventory_operations where actor_user_id=v_actor and idempotency_key=p_key;
 if found then
  if v_operation.request_hash<>v_hash then raise exception using errcode='23505',message='inventory idempotency conflict'; end if;
  return v_operation.receipt||jsonb_build_object('replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text||':'||v_item,83));
 select * into v_old from public.data_inventory_versions where organization_id=p_org and branch_id=p_branch and item_key=v_item order by version desc limit 1;
 if coalesce(v_old.version,0)<>v_expected then raise exception using errcode='40001',message='inventory version stale'; end if;
 if v_action='verify' then
  if v_old.id is distinct from (p_request->>'expectedVersionId')::uuid or v_old.content_hash is distinct from p_request->>'expectedContentHash' then
   raise exception using errcode='40001',message='inventory version stale'; end if;
  if v_old.content_recorded_by=v_actor then raise exception using errcode='42501',message='inventory independent reviewer required'; end if;
  if v_old.review_state<>'pending' or not private.data_inventory_reviewable(v_item,v_old.content) then
   raise exception using errcode='23514',message='inventory checklist incomplete'; end if;
  v_content:=v_old.content;
 end if;
 if not private.data_inventory_authorized(p_org,p_branch) then raise exception using errcode='42501',message='inventory operation denied'; end if;
 if v_action='verify' then v_challenge:=private.data_inventory_reauth(); end if;
 v_new.id:=gen_random_uuid(); v_new.organization_id:=p_org; v_new.branch_id:=p_branch; v_new.item_key:=v_item;
 v_new.object_id:=coalesce(v_old.object_id,gen_random_uuid()); v_new.version:=v_expected+1; v_new.previous_version_id:=v_old.id;
 v_new.content:=v_content; v_new.recorded_by:=v_actor; v_new.content_recorded_by:=case when v_action='verify' then v_old.content_recorded_by else v_actor end;
 v_new.created_at:=clock_timestamp(); v_new.review_state:=case when v_action='verify' then 'manually_verified' else 'pending' end;
 if v_action='verify' then v_new.reviewed_by:=v_actor; v_new.reviewed_at:=v_new.created_at; v_new.review_challenge_id:=v_challenge; end if;
 v_new.content_hash:=encode(sha256(convert_to(v_content::text,'UTF8')),'hex');
 insert into public.data_inventory_versions select v_new.*;
 v_receipt:=jsonb_build_object('operationId',v_operation_id,'organizationId',p_org,'branchId',p_branch,'actorUserId',v_actor,
  'idempotencyKey',p_key,'request',p_request,'result',private.data_inventory_version_json(v_new),'replayed',false);
 insert into private.data_inventory_operations(id,actor_user_id,idempotency_key,request_hash,version_id,receipt)
 values(v_operation_id,v_actor,p_key,v_hash,v_new.id,v_receipt);
 if not private.data_inventory_authorized(p_org,p_branch) then raise exception using errcode='42501',message='inventory operation denied'; end if;
 if v_action='verify' then perform private.data_inventory_reauth(); end if;
 return v_receipt;
end;
$$;
create function private.data_inventory_snapshot(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_records jsonb; v_now timestamptz;
begin
 if not private.data_inventory_authorized(p_org,p_branch) then raise exception using errcode='42501',message='inventory snapshot denied'; end if;
 with scoped as materialized(select v.*,row_number() over(partition by item_key order by version desc) as rn,
  count(*) over(partition by item_key) as total from public.data_inventory_versions v where organization_id=p_org and branch_id=p_branch),
 grouped as(select s.item_key,max(s.total) total,jsonb_agg(private.data_inventory_version_json(v) order by s.version desc) history
  from scoped s join public.data_inventory_versions v on v.id=s.id where s.rn<=20 group by s.item_key)
 select coalesce(jsonb_agg(jsonb_build_object('itemKey',item_key,'current',history->0,'history',history,'historyTotal',total,'historyTruncated',total>20) order by item_key),'[]'::jsonb) into v_records from grouped;
 if not private.data_inventory_authorized(p_org,p_branch) then raise exception using errcode='42501',message='inventory snapshot denied'; end if;
 v_now:=clock_timestamp();
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
 values(p_org,p_branch,auth.uid(),'select','public.data_inventory_versions',jsonb_build_object('kind','manual_metadata_snapshot'));
 return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'generatedAt',v_now,'staleAfter',v_now+interval '5 minutes',
  'records',v_records,'demo',false,'verificationKind','manual_metadata_only','formalPromotionStatus','not_configured');
end;
$$;
create function public.mutate_data_inventory(p_expected_organization_id uuid,p_expected_branch_id uuid,p_request jsonb,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.mutate_data_inventory(p_expected_organization_id,p_expected_branch_id,p_request,p_idempotency_key);
$$;
create function public.data_inventory_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.data_inventory_snapshot(p_expected_organization_id,p_expected_branch_id);
$$;
revoke all on function private.data_inventory_content_valid(jsonb),private.data_inventory_reviewable(text,jsonb),private.data_inventory_append_only(),
 private.data_inventory_authorized(uuid,uuid),private.data_inventory_reauth(),private.data_inventory_version_json(public.data_inventory_versions),
 private.mutate_data_inventory(uuid,uuid,jsonb,uuid),private.data_inventory_snapshot(uuid,uuid),
 public.mutate_data_inventory(uuid,uuid,jsonb,uuid),public.data_inventory_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.mutate_data_inventory(uuid,uuid,jsonb,uuid),private.data_inventory_snapshot(uuid,uuid),
 public.mutate_data_inventory(uuid,uuid,jsonb,uuid),public.data_inventory_snapshot(uuid,uuid) to authenticated;
