-- Page 51: manual nursing observations only. No licensed form, score, clinical
-- risk classification or automatic reassessment interval is claimed.
insert into public.permissions(permission_key, description, risk_level) values
  ('nursing_assessments.read', 'Read scoped manual nursing assessments', 2),
  ('nursing_assessments.manage', 'Create and revise assigned-client nursing drafts', 2),
  ('nursing_assessments.sign', 'Sign and correct assigned-client nursing assessments', 3)
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.is_system and (
  (r.role_key in ('nurse','organization_manager','branch_supervisor') and p.permission_key='nursing_assessments.read')
  or (r.role_key='nurse' and p.permission_key in ('nursing_assessments.manage','nursing_assessments.sign'))
) on conflict(role_id, permission_id) do nothing;

create function private.nursing_text_valid(p_text jsonb, p_max integer)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_typeof(p_text)='string'
    and char_length(p_text #>> '{}') between 1 and p_max
    and (p_text #>> '{}')=btrim(p_text #>> '{}')
    and translate(p_text #>> '{}', E'\n\r\t', '') !~ '[[:cntrl:]]', false);
$$;
create function private.nursing_content_valid(p_content jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_field jsonb; v_due jsonb; v_assessed date; v_date date;
begin
  if jsonb_typeof(p_content) is distinct from 'object'
    or not p_content ?& array['formVersionReference','assessedOn','domains','reassessment']
    or (select count(*) from jsonb_object_keys(p_content)) <> 4
    or p_content->>'formVersionReference' is distinct from 'manual-nursing-v1'
    or jsonb_typeof(p_content->'assessedOn') is distinct from 'string'
    or (p_content->>'assessedOn') !~ '^(20[0-9]{2}|21[0-9]{2}|2200)-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_content->'domains') is distinct from 'object'
    or jsonb_typeof(p_content->'reassessment') is distinct from 'object' then return false; end if;
  v_assessed := (p_content->>'assessedOn')::date;
  if to_char(v_assessed,'YYYY-MM-DD') <> p_content->>'assessedOn'
    or (select count(*) from jsonb_object_keys(p_content->'domains')) <> 4
    or not (p_content->'domains') ?& array['observations','problems','measures','response'] then return false; end if;
  for v_field in select value from jsonb_each(p_content->'domains') loop
    if jsonb_typeof(v_field) is distinct from 'object'
      or not v_field ?& array['state','detail','reason']
      or (select count(*) from jsonb_object_keys(v_field)) <> 3
      or coalesce(v_field->>'state','') not in ('recorded','missing','not_applicable') then return false; end if;
    if v_field->>'state'='recorded' then
      if not private.nursing_text_valid(v_field->'detail',5000)
        or v_field->'reason' is distinct from 'null'::jsonb then return false; end if;
    elsif v_field->'detail' is distinct from 'null'::jsonb
      or not private.nursing_text_valid(v_field->'reason',1000) then return false; end if;
  end loop;
  v_due := p_content->'reassessment';
  if (select count(*) from jsonb_object_keys(v_due)) <> 3
    or not v_due ?& array['state','dueOn','reason']
    or coalesce(v_due->>'state','') not in ('recorded','missing','not_applicable')
    or not private.nursing_text_valid(v_due->'reason',1000) then return false; end if;
  if v_due->>'state'='recorded' then
    if jsonb_typeof(v_due->'dueOn') is distinct from 'string'
      or v_due->>'dueOn' !~ '^(20[0-9]{2}|21[0-9]{2}|2200)-[0-9]{2}-[0-9]{2}$' then return false; end if;
    v_date := (v_due->>'dueOn')::date;
    if v_date < v_assessed or to_char(v_date,'YYYY-MM-DD') <> v_due->>'dueOn' then return false; end if;
  elsif v_due->'dueOn' is distinct from 'null'::jsonb then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create table public.nursing_assessment_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  branch_id uuid not null, client_id uuid not null, assessment_key uuid not null,
  version integer not null check(version>0), previous_version_id uuid unique,
  record_state text not null check(record_state in ('draft','signed','corrected')),
  content jsonb not null check(private.nursing_content_valid(content)),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  previous_content_hash text check(previous_content_hash ~ '^[0-9a-f]{64}$'),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorder_display_name text not null,
  correction_reason text,
  signed_at timestamptz, signed_by uuid references auth.users(id) on delete restrict,
  signer_display_name text, signature_purpose text,
  signature_challenge_id uuid references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,organization_id,branch_id,client_id,assessment_key),
  unique(organization_id,branch_id,assessment_key,version),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(previous_version_id,organization_id,branch_id,client_id,assessment_key)
    references public.nursing_assessment_versions(id,organization_id,branch_id,client_id,assessment_key) on delete restrict,
  check((version=1 and previous_version_id is null and previous_content_hash is null)
    or (version>1 and previous_version_id is not null and previous_content_hash is not null)),
  check((record_state='draft' and signed_at is null and signed_by is null and signer_display_name is null
      and signature_purpose is null and signature_challenge_id is null)
    or (record_state<>'draft' and signed_at is not null and signed_at=created_at and signed_by is not null
      and signed_by=recorded_by and signer_display_name is not null
      and signature_purpose=case when record_state='signed' then '人工護理評估簽署' else '人工護理評估更正簽署' end
      and signature_challenge_id is not null)),
  check((record_state='corrected' and correction_reason is not null
      and char_length(btrim(correction_reason)) between 1 and 1000)
    or (record_state<>'corrected' and correction_reason is null))
);
create index nursing_assessments_client_idx on public.nursing_assessment_versions(organization_id,branch_id,client_id,created_at desc);
create index nursing_assessments_recorder_idx on public.nursing_assessment_versions(recorded_by);
create index nursing_assessments_signer_idx on public.nursing_assessment_versions(signed_by) where signed_by is not null;
create index nursing_assessments_challenge_idx on public.nursing_assessment_versions(signature_challenge_id) where signature_challenge_id is not null;
create table private.nursing_assessment_operations (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null, request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  version_id uuid not null references public.nursing_assessment_versions(id) on delete restrict,
  receipt jsonb not null, unique(actor_user_id,idempotency_key)
);
create index nursing_operations_version_idx on private.nursing_assessment_operations(version_id);
alter table public.nursing_assessment_versions enable row level security;
alter table public.nursing_assessment_versions force row level security;
alter table private.nursing_assessment_operations enable row level security;
alter table private.nursing_assessment_operations force row level security;
revoke all on public.nursing_assessment_versions, private.nursing_assessment_operations from public,anon,authenticated,service_role;
create function private.nursing_append_only() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='55000', message='nursing assessment history is append-only'; end;
$$;
create trigger nursing_versions_append_only before update or delete on public.nursing_assessment_versions
for each row execute function private.nursing_append_only();
create trigger nursing_operations_append_only before update or delete on private.nursing_assessment_operations
for each row execute function private.nursing_append_only();
-- Canonical row audit is the sole audit insert per version; signer, purpose,
-- challenge and content hash remain in the immutable signed version itself.
create trigger nursing_assessment_versions_audit_row_change after insert on public.nursing_assessment_versions
for each row execute function private.audit_row_change();

-- Use wall-clock membership validity, including the final snapshot check after
-- work or lock waits. Transaction-start now() can outlive a membership/assignment.
create function private.nursing_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id and r.is_active
    join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
    where m.profile_id=auth.uid() and m.organization_id=p_org
      and (m.branch_id is null or m.branch_id=p_branch)
      and m.status='active' and m.starts_at<=clock_timestamp()
      and (m.ends_at is null or m.ends_at>clock_timestamp())
      and (r.organization_id is null or r.organization_id=p_org) and p.permission_key=p_permission
  );
$$;
create function private.nursing_authority(p_org uuid,p_branch uuid,p_client uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
    and p_permission in ('nursing_assessments.read','nursing_assessments.manage','nursing_assessments.sign')
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.kind='staff')
    and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
      where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
    and private.nursing_permission(p_org,p_branch,'clients.read')
    and private.nursing_permission(p_org,p_branch,'nursing_assessments.read')
    and private.nursing_permission(p_org,p_branch,p_permission)
    and (p_client is null or exists(select 1 from public.clients c where c.id=p_client
      and c.organization_id=p_org and c.branch_id=p_branch
      and (private.nursing_permission(p_org,p_branch,'clients.view_all') or exists (
        select 1 from public.client_assignments a where a.client_id=c.id
          and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
          and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())
      ))))
    and (p_permission='nursing_assessments.read' or (
      exists(select 1 from public.memberships m join public.membership_roles mr on mr.membership_id=m.id
        join public.roles r on r.id=mr.role_id where m.profile_id=auth.uid()
        and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
        and m.status='active' and m.starts_at<=clock_timestamp()
        and (m.ends_at is null or m.ends_at>clock_timestamp())
        and r.is_system and r.is_active and r.role_key='nurse')
      and exists(select 1 from public.client_assignments a where a.client_id=p_client
        and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
        and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))
    )),false);
$$;
create function private.nursing_reauth(p_actor uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid; v_session uuid;
begin
  if p_actor is null or p_actor<>auth.uid() or coalesce(auth.jwt()->>'aal','')<>'aal2'
    or not private.has_recent_aal2(15) then
    raise exception using errcode='42501',message='nursing signing requires recent same-session AAL2'; end if;
  begin v_session := (auth.jwt()->>'session_id')::uuid;
  exception when others then raise exception using errcode='42501',message='nursing signing requires recent same-session AAL2'; end;
  select c.id into v_id from private.reauth_events e join private.reauth_challenges c
    on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
  where e.user_id=p_actor and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
    and e.verification_method in ('totp','webauthn','phone') and c.consumed_at is not null
    and c.invalidated_at is null and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
    and c.factor_verified_at>=clock_timestamp()-interval '15 minutes'
    and c.factor_verified_at<=clock_timestamp()+interval '1 minute'
  order by c.factor_verified_at desc limit 1 for share of e,c;
  if v_id is null then raise exception using errcode='42501',message='nursing signing requires recent same-session AAL2'; end if;
  return v_id;
end;
$$;
create function private.nursing_version_json(v public.nursing_assessment_versions)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('versionId',v.id,'assessmentKey',v.assessment_key,'version',v.version,
  'previousVersionId',v.previous_version_id,'state',v.record_state,'content',v.content,'contentHash',v.content_hash,
  'previousContentHash',v.previous_content_hash,'recordedBy',v.recorded_by,'recorderDisplayName',v.recorder_display_name,
  'correctionReason',v.correction_reason,'signedAt',v.signed_at,'signedBy',v.signed_by,
  'signerDisplayName',v.signer_display_name,'signaturePurpose',v.signature_purpose,
  'signatureChallengeId',v.signature_challenge_id,'createdAt',v.created_at);
$$;

create function private.mutate_nursing_assessment(p_org uuid,p_branch uuid,p_request jsonb,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_action text; v_client uuid; v_chain uuid; v_previous_id uuid;
  v_expected integer; v_permission text; v_content jsonb; v_reason text; v_challenge uuid;
  v_old public.nursing_assessment_versions%rowtype; v_new public.nursing_assessment_versions%rowtype;
  v_operation private.nursing_assessment_operations%rowtype; v_hash text; v_now timestamptz;
  v_name text; v_receipt jsonb; v_operation_id uuid:=gen_random_uuid(); v_keys text[];
begin
  if jsonb_typeof(p_request) is distinct from 'object' or p_key is null then
    raise exception using errcode='22023',message='invalid nursing request'; end if;
  v_action:=p_request->>'action';
  if v_action is null or v_action not in ('create_draft','revise_draft','sign','correct') then
    raise exception using errcode='22023',message='invalid nursing request'; end if;
  v_keys:=case when v_action='create_draft' then array['action','clientId','content']
    when v_action='sign' then array['action','clientId','assessmentKey','previousVersionId','expectedVersion','expectedContentHash']
    when v_action='revise_draft' then array['action','clientId','assessmentKey','previousVersionId','expectedVersion','expectedContentHash','content']
    else array['action','clientId','assessmentKey','previousVersionId','expectedVersion','expectedContentHash','content','correctionReason'] end;
  if not p_request ?& v_keys or (select count(*) from jsonb_object_keys(p_request))<>cardinality(v_keys)
    or jsonb_typeof(p_request->'clientId') is distinct from 'string' then
    raise exception using errcode='22023',message='invalid nursing request'; end if;
  begin
    v_client:=(p_request->>'clientId')::uuid;
    if v_action<>'create_draft' then
      v_chain:=(p_request->>'assessmentKey')::uuid;
      v_previous_id:=(p_request->>'previousVersionId')::uuid;
      v_expected:=(p_request->>'expectedVersion')::integer;
    end if;
  exception when others then raise exception using errcode='22023',message='invalid nursing request'; end;
  if v_client is null or (v_action<>'create_draft' and (v_chain is null or v_previous_id is null
    or v_expected is null or v_expected<1 or jsonb_typeof(p_request->'expectedVersion')<>'number'
    or (p_request->>'expectedVersion')!~'^[1-9][0-9]*$'
    or coalesce(p_request->>'expectedContentHash','')!~'^[0-9a-f]{64}$')) then
    raise exception using errcode='22023',message='invalid nursing request'; end if;
  v_permission:=case when v_action in ('sign','correct') then 'nursing_assessments.sign' else 'nursing_assessments.manage' end;
  if not private.nursing_authority(p_org,p_branch,v_client,v_permission) then
    raise exception using errcode='42501',message='nursing operation is not permitted'; end if;
  if v_action<>'sign' then
    v_content:=p_request->'content';
    if not private.nursing_content_valid(v_content) or (v_content->>'assessedOn')::date>(clock_timestamp() at time zone 'Asia/Taipei')::date then
      raise exception using errcode='22023',message='invalid nursing content'; end if;
  end if;
  if v_action='correct' then
    if not private.nursing_text_valid(p_request->'correctionReason',1000) then
      raise exception using errcode='22023',message='correction reason is required'; end if;
    v_reason:=p_request->>'correctionReason';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('organizationId',p_org,'branchId',p_branch,
    'actorUserId',v_actor,'request',p_request)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('nursing-operation:'||v_actor::text||':'||p_key::text,0));
  -- Reauthorize after lock wait, including exact replays. Signature replays must
  -- satisfy a fresh challenge in the calling session before returning a receipt.
  if not private.nursing_authority(p_org,p_branch,v_client,v_permission) then
    raise exception using errcode='42501',message='nursing authority expired'; end if;
  if v_action in ('sign','correct') then v_challenge:=private.nursing_reauth(v_actor); end if;
  select * into v_operation from private.nursing_assessment_operations o where o.actor_user_id=v_actor and o.idempotency_key=p_key;
  if found then
    if v_operation.request_hash<>v_hash then raise exception using errcode='23505',message='nursing idempotency conflict'; end if;
    return v_operation.receipt || jsonb_build_object('replayed',true);
  end if;
  v_chain:=coalesce(v_chain,gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended('nursing-chain:'||p_org::text||':'||p_branch::text||':'||v_chain::text,0));
  if v_action<>'create_draft' then
    select * into v_old from public.nursing_assessment_versions v where v.organization_id=p_org
      and v.branch_id=p_branch and v.client_id=v_client and v.assessment_key=v_chain
      order by v.version desc limit 1 for share;
    if v_old.id is null or v_old.id<>v_previous_id or v_old.version<>v_expected
      or v_old.content_hash<>p_request->>'expectedContentHash' then
      raise exception using errcode='40001',message='nursing version is stale'; end if;
    if (v_action in ('revise_draft','sign') and v_old.record_state<>'draft')
      or (v_action='correct' and v_old.record_state='draft') then
      raise exception using errcode='23514',message='nursing state does not allow this operation'; end if;
    if v_action='sign' then v_content:=v_old.content; end if;
  end if;
  if not private.nursing_authority(p_org,p_branch,v_client,v_permission) then
    raise exception using errcode='42501',message='nursing authority expired'; end if;
  if v_action in ('sign','correct') then v_challenge:=private.nursing_reauth(v_actor); end if;
  v_now:=clock_timestamp();
  select p.display_name into strict v_name from public.profiles p where p.id=v_actor and p.is_active;
  v_new.id:=gen_random_uuid(); v_new.organization_id:=p_org; v_new.branch_id:=p_branch; v_new.client_id:=v_client;
  v_new.assessment_key:=v_chain; v_new.version:=coalesce(v_expected,0)+1;
  v_new.previous_version_id:=v_previous_id; v_new.previous_content_hash:=v_old.content_hash;
  v_new.record_state:=case when v_action='sign' then 'signed' when v_action='correct' then 'corrected' else 'draft' end;
  v_new.content:=v_content; v_new.recorded_by:=v_actor; v_new.recorder_display_name:=v_name;
  v_new.correction_reason:=v_reason; v_new.created_at:=v_now;
  if v_action in ('sign','correct') then
    v_new.signed_at:=v_now; v_new.signed_by:=v_actor; v_new.signer_display_name:=v_name;
    v_new.signature_challenge_id:=v_challenge;
    v_new.signature_purpose:=case when v_action='sign' then '人工護理評估簽署' else '人工護理評估更正簽署' end;
  end if;
  v_new.content_hash:=encode(sha256(convert_to((to_jsonb(v_new)-'content_hash')::text,'UTF8')),'hex');
  insert into public.nursing_assessment_versions select v_new.*;
  v_receipt:=jsonb_build_object('operationId',v_operation_id,'organizationId',p_org,'branchId',p_branch,
    'actorUserId',v_actor,'idempotencyKey',p_key,'request',p_request,'result',private.nursing_version_json(v_new),
    'replayed',false,'persisted',true,'demo',false);
  insert into private.nursing_assessment_operations(id,actor_user_id,idempotency_key,request_hash,version_id,receipt)
    values(v_operation_id,v_actor,p_key,v_hash,v_new.id,v_receipt);
  if not private.nursing_authority(p_org,p_branch,v_client,v_permission) then
    raise exception using errcode='42501',message='nursing authority expired'; end if;
  return v_receipt;
end;
$$;

create function private.nursing_assessment_snapshot(p_org uuid,p_branch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_clients jsonb; v_total integer; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
  if not private.nursing_authority(p_org,p_branch,null,'nursing_assessments.read') then
    raise exception using errcode='42501',message='nursing snapshot is not permitted'; end if;
  with scoped_clients as materialized (select c.* from public.clients c where c.organization_id=p_org and c.branch_id=p_branch
    and private.nursing_authority(p_org,p_branch,c.id,'nursing_assessments.read')),
  page_clients as (select * from scoped_clients order by display_name,id limit 100)
  select (select count(*) from scoped_clients),coalesce(jsonb_agg(jsonb_build_object('clientId',c.id,'displayName',c.display_name,'serviceStatus',c.status,
    'versions',coalesce((select jsonb_agg(private.nursing_version_json(v) order by v.created_at desc,v.version desc)
      from (select * from public.nursing_assessment_versions a where a.organization_id=p_org and a.branch_id=p_branch
        and a.client_id=c.id order by a.created_at desc,a.version desc limit 50) v),'[]'::jsonb),
    'versionsTotal',(select count(*) from public.nursing_assessment_versions a where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=c.id),
    'versionsTruncated',(select count(*)>50 from public.nursing_assessment_versions a where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=c.id))
    order by c.display_name,c.id),'[]'::jsonb) into v_total,v_clients
  from page_clients c;
  if not private.nursing_authority(p_org,p_branch,null,'nursing_assessments.read') or exists(
    select 1 from jsonb_array_elements(v_clients) c where not private.nursing_authority(p_org,p_branch,(c->>'clientId')::uuid,'nursing_assessments.read')) then
    raise exception using errcode='42501',message='nursing snapshot authority expired'; end if;
  v_result:=jsonb_build_object('organizationId',p_org,'branchId',p_branch,'generatedAt',v_now,'staleAfter',v_now+interval '5 minutes',
    'clients',v_clients,'clientTotal',v_total,'clientsTruncated',v_total>100,'officialScoreStatus','not_configured',
    'attachmentStatus','not_configured','exportStatus','not_configured','notificationStatus','not_configured',
    'offlineStatus','not_configured','demo',false);
  return v_result;
end;
$$;
create function public.mutate_nursing_assessment(p_expected_organization_id uuid,p_expected_branch_id uuid,p_request jsonb,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.mutate_nursing_assessment(p_expected_organization_id,p_expected_branch_id,p_request,p_idempotency_key);
$$;
create function public.nursing_assessment_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.nursing_assessment_snapshot(p_expected_organization_id,p_expected_branch_id);
$$;
revoke all on function private.nursing_text_valid(jsonb,integer),private.nursing_content_valid(jsonb),private.nursing_append_only(),
  private.nursing_permission(uuid,uuid,text),private.nursing_authority(uuid,uuid,uuid,text),private.nursing_reauth(uuid),
  private.nursing_version_json(public.nursing_assessment_versions),private.mutate_nursing_assessment(uuid,uuid,jsonb,uuid),
  private.nursing_assessment_snapshot(uuid,uuid),public.mutate_nursing_assessment(uuid,uuid,jsonb,uuid),
  public.nursing_assessment_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.mutate_nursing_assessment(uuid,uuid,jsonb,uuid),private.nursing_assessment_snapshot(uuid,uuid),
  public.mutate_nursing_assessment(uuid,uuid,jsonb,uuid),public.nursing_assessment_snapshot(uuid,uuid) to authenticated;
