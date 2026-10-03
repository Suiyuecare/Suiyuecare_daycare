-- Page 9: unsigned, append-only TOCC drafts. An AAL1 Google work session may
-- create/revise a draft; only the existing recent-AAL2 core creates a formal
-- signed assessment. No formal TOCC table, signature, or reauth rule is relaxed.
begin;
set local lock_timeout = '5s';

create table private.client_tocc_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_key uuid not null,
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  version integer not null check (version > 0),
  previous_version_id uuid,
  base_assessment_id uuid,
  assessment_date date not null,
  result_status text not null check (result_status in ('clear','monitor','action_required')),
  symptom_summary text,
  risk_summary text,
  evidence_status text not null check (evidence_status in ('not_required','pending','verified','rejected')),
  action_status text not null check (action_status in ('none_required','pending','in_progress','completed','referred')),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_tocc_draft_scope_fkey foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  constraint client_tocc_draft_version_scope_key unique (id,draft_key,organization_id,branch_id,client_id),
  constraint client_tocc_draft_key_version_key unique (draft_key,version),
  constraint client_tocc_draft_previous_fkey foreign key
    (previous_version_id,draft_key,organization_id,branch_id,client_id)
    references private.client_tocc_draft_versions(id,draft_key,organization_id,branch_id,client_id)
    on delete restrict,
  constraint client_tocc_draft_base_fkey foreign key
    (base_assessment_id,organization_id,branch_id,client_id)
    references public.client_tocc_assessments(id,organization_id,branch_id,client_id)
    on delete restrict,
  constraint client_tocc_draft_lineage_check check
    ((version=1 and previous_version_id is null) or (version>1 and previous_version_id is not null)),
  constraint client_tocc_draft_summaries_check check (
    (symptom_summary is null or (char_length(symptom_summary) between 1 and 1000 and symptom_summary !~ '[[:cntrl:]]'))
    and (risk_summary is null or (char_length(risk_summary) between 1 and 1000 and risk_summary !~ '[[:cntrl:]]'))
    and (result_status='clear' or symptom_summary is not null or risk_summary is not null)
    and (result_status<>'action_required' or action_status<>'none_required')
  )
);
create index client_tocc_draft_scope_latest_idx on private.client_tocc_draft_versions
  (organization_id,branch_id,client_id,draft_key,version desc);
create index client_tocc_draft_previous_idx on private.client_tocc_draft_versions(previous_version_id)
  where previous_version_id is not null;
create index client_tocc_draft_base_idx on private.client_tocc_draft_versions(base_assessment_id)
  where base_assessment_id is not null;
create index client_tocc_draft_author_idx on private.client_tocc_draft_versions(created_by);

create table private.client_tocc_draft_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  draft_key uuid not null,
  version_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  session_id uuid not null,
  assurance_level text not null check (assurance_level in ('aal1','aal2')),
  created_at timestamptz not null default clock_timestamp(),
  constraint client_tocc_draft_operation_version_fkey foreign key
    (version_id,draft_key,organization_id,branch_id,client_id)
    references private.client_tocc_draft_versions(id,draft_key,organization_id,branch_id,client_id)
    on delete restrict,
  constraint client_tocc_draft_operation_actor_key unique (actor_user_id,idempotency_key),
  constraint client_tocc_draft_operation_version_key unique (version_id)
);
create index client_tocc_draft_operation_scope_idx on private.client_tocc_draft_operations
  (organization_id,branch_id,client_id,draft_key);

create table private.client_tocc_draft_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  draft_key uuid not null unique,
  draft_version_id uuid not null,
  assessment_id uuid not null unique,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_tocc_draft_signature_version_fkey foreign key
    (draft_version_id,draft_key,organization_id,branch_id,client_id)
    references private.client_tocc_draft_versions(id,draft_key,organization_id,branch_id,client_id)
    on delete restrict,
  constraint client_tocc_draft_signature_assessment_fkey foreign key
    (assessment_id,organization_id,branch_id,client_id)
    references public.client_tocc_assessments(id,organization_id,branch_id,client_id)
    on delete restrict,
  constraint client_tocc_draft_signature_actor_key unique (actor_user_id,idempotency_key)
);
create index client_tocc_draft_signature_scope_idx on private.client_tocc_draft_signatures
  (organization_id,branch_id,client_id);
create index client_tocc_draft_signature_version_idx on private.client_tocc_draft_signatures
  (draft_version_id);
create index client_tocc_draft_signature_challenge_idx on private.client_tocc_draft_signatures
  (reauth_challenge_id);

alter table private.client_tocc_draft_versions enable row level security;
alter table private.client_tocc_draft_versions force row level security;
alter table private.client_tocc_draft_operations enable row level security;
alter table private.client_tocc_draft_operations force row level security;
alter table private.client_tocc_draft_signatures enable row level security;
alter table private.client_tocc_draft_signatures force row level security;
revoke all on table private.client_tocc_draft_versions,private.client_tocc_draft_operations,
  private.client_tocc_draft_signatures from public,anon,authenticated,service_role;

create trigger client_tocc_draft_versions_immutable before update or delete
  on private.client_tocc_draft_versions for each row execute function private.prevent_client_tocc_mutation();
create trigger client_tocc_draft_operations_immutable before update or delete
  on private.client_tocc_draft_operations for each row execute function private.prevent_client_tocc_mutation();
create trigger client_tocc_draft_signatures_immutable before update or delete
  on private.client_tocc_draft_signatures for each row execute function private.prevent_client_tocc_mutation();
create trigger client_tocc_draft_versions_audit after insert
  on private.client_tocc_draft_versions for each row execute function private.audit_row_change();
create trigger client_tocc_draft_operations_audit after insert
  on private.client_tocc_draft_operations for each row execute function private.audit_row_change();
create trigger client_tocc_draft_signatures_audit after insert
  on private.client_tocc_draft_signatures for each row execute function private.audit_row_change();

create function private.client_tocc_draft_access(
  p_org uuid,p_branch uuid,p_client uuid,p_write boolean
) returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(auth.uid() is not null
    and coalesce(auth.jwt()->>'aal','') in ('aal1','aal2')
    and p_org is not null and p_branch is not null
    and exists(select 1 from public.organizations o where o.id=p_org and o.is_active)
    and exists(select 1 from public.branches b where b.id=p_branch and b.organization_id=p_org and b.is_active)
    and (p_client is null or exists(select 1 from public.clients c where c.id=p_client
      and c.organization_id=p_org and c.branch_id=p_branch))
    and (
      (private.is_staff_google_session_allowed()
        and private.has_routine_staff_permission(p_org,p_branch,'clients.read')
        and private.has_routine_staff_permission(p_org,p_branch,'health.read')
        and (not p_write or private.has_routine_staff_permission(p_org,p_branch,'health.write'))
        and (p_client is null or (private.can_routine_staff_access_client(p_client,'health.read')
          and (not p_write or (private.can_routine_staff_access_client(p_client,'health.write')
            -- A branch-wide view_all grant permits reading, never writing an
            -- unassigned client's unsigned clinical draft.
            and exists(select 1 from public.client_assignments assignment
              where assignment.client_id=p_client and assignment.organization_id=p_org
                and assignment.branch_id=p_branch and assignment.assignee_user_id=auth.uid()
                and assignment.starts_at<=clock_timestamp()
                and (assignment.ends_at is null or assignment.ends_at>clock_timestamp())))))))
      or (auth.jwt()->>'aal'='aal2'
        and private.has_permission(p_org,p_branch,'clients.read')
        and private.has_permission(p_org,p_branch,'health.read')
        and (not p_write or private.has_permission(p_org,p_branch,'health.write'))
        and (p_client is null or (private.can_staff_access_client(p_client,'health.read')
          and (not p_write or private.can_staff_access_client(p_client,'health.write')))))
    ),false);
$$;

create function public.has_client_tocc_draft_access(
  target_org_id uuid,target_branch_id uuid,target_client_id uuid default null,
  target_write boolean default false
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.client_tocc_draft_access(target_org_id,target_branch_id,target_client_id,target_write);
$$;

create function private.can_sign_client_tocc_draft(
  p_org uuid,p_branch uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
    or not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'health.write')
    or not exists(select 1 from public.branches b where b.id=p_branch
      and b.organization_id=p_org and b.is_active) then return false; end if;
  perform private.current_client_tocc_reauth_challenge();
  return true;
exception when insufficient_privilege then return false;
end;
$$;

create function public.can_sign_client_tocc_draft(
  target_org_id uuid,target_branch_id uuid
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.can_sign_client_tocc_draft(target_org_id,target_branch_id);
$$;

create function private.save_client_tocc_draft(
  p_org uuid,p_branch uuid,p_action text,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_client_id uuid;
  v_draft_key uuid;
  v_previous_id uuid;
  v_expected_version integer;
  v_expected_hash text;
  v_assessment_date date;
  v_result_status text;
  v_symptom_summary text;
  v_risk_summary text;
  v_evidence_status text;
  v_action_status text;
  v_previous private.client_tocc_draft_versions%rowtype;
  v_result private.client_tocc_draft_versions%rowtype;
  v_operation private.client_tocc_draft_operations%rowtype;
  v_client public.clients%rowtype;
  v_base uuid;
  v_request_hash text;
  v_content_hash text;
  v_session uuid;
  v_receipt jsonb;
begin
  if p_action is null or p_action not in ('create','revise') or p_payload is null
    or jsonb_typeof(p_payload)<>'object' or p_idempotency_key is null
    or not (p_payload ?& array['client_id','draft_key','previous_version_id',
      'expected_version','expected_content_hash','assessment_date','result_status',
      'symptom_summary','risk_summary','evidence_status','action_status'])
    or p_payload-array['client_id','draft_key','previous_version_id',
      'expected_version','expected_content_hash','assessment_date','result_status',
      'symptom_summary','risk_summary','evidence_status','action_status'] <> '{}'::jsonb then
    raise exception using errcode='22023',message='invalid TOCC draft fields';
  end if;
  if jsonb_typeof(p_payload->'client_id')<>'string'
    or jsonb_typeof(p_payload->'draft_key')<>'string'
    or jsonb_typeof(p_payload->'assessment_date')<>'string'
    or jsonb_typeof(p_payload->'result_status')<>'string'
    or jsonb_typeof(p_payload->'evidence_status')<>'string'
    or jsonb_typeof(p_payload->'action_status')<>'string'
    or jsonb_typeof(p_payload->'expected_version')<>'number'
    or jsonb_typeof(p_payload->'previous_version_id') not in ('string','null')
    or jsonb_typeof(p_payload->'expected_content_hash') not in ('string','null')
    or jsonb_typeof(p_payload->'symptom_summary') not in ('string','null')
    or jsonb_typeof(p_payload->'risk_summary') not in ('string','null') then
    raise exception using errcode='22023',message='invalid TOCC draft field types';
  end if;
  v_client_id := (p_payload->>'client_id')::uuid;
  v_draft_key := (p_payload->>'draft_key')::uuid;
  v_previous_id := (p_payload->>'previous_version_id')::uuid;
  v_expected_version := (p_payload->>'expected_version')::integer;
  v_expected_hash := p_payload->>'expected_content_hash';
  v_assessment_date := (p_payload->>'assessment_date')::date;
  v_result_status := p_payload->>'result_status';
  v_symptom_summary := nullif(btrim(p_payload->>'symptom_summary'),'');
  v_risk_summary := nullif(btrim(p_payload->>'risk_summary'),'');
  v_evidence_status := p_payload->>'evidence_status';
  v_action_status := p_payload->>'action_status';
  if v_client_id is null or v_draft_key is null or v_assessment_date is null
    or v_assessment_date>(clock_timestamp() at time zone 'Asia/Taipei')::date
    or v_result_status not in ('clear','monitor','action_required')
    or v_evidence_status not in ('not_required','pending','verified','rejected')
    or v_action_status not in ('none_required','pending','in_progress','completed','referred')
    or (v_result_status<>'clear' and v_symptom_summary is null and v_risk_summary is null)
    or (v_result_status='action_required' and v_action_status='none_required')
    or (v_symptom_summary is not null and (char_length(v_symptom_summary)>1000 or v_symptom_summary~'[[:cntrl:]]'))
    or (v_risk_summary is not null and (char_length(v_risk_summary)>1000 or v_risk_summary~'[[:cntrl:]]'))
    or (p_action='create' and (v_expected_version is distinct from 0
      or v_previous_id is not null or v_expected_hash is not null))
    or (p_action='revise' and (v_expected_version is null or v_expected_version<1
      or v_previous_id is null or v_expected_hash is null
      or v_expected_hash !~ '^[a-f0-9]{64}$')) then
    raise exception using errcode='22023',message='invalid TOCC draft fields';
  end if;
  if not private.client_tocc_draft_access(p_org,p_branch,v_client_id,true) then
    raise exception using errcode='42501',message='TOCC draft access denied';
  end if;
  v_session := (auth.jwt()->>'session_id')::uuid;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'actor',v_actor,'action',p_action,
    'client',v_client_id,'draft',v_draft_key,'previous',v_previous_id,
    'expectedVersion',v_expected_version,'expectedHash',v_expected_hash,
    'date',v_assessment_date,'result',v_result_status,
    'symptoms',v_symptom_summary,'risks',v_risk_summary,
    'evidence',v_evidence_status,'actionStatus',v_action_status
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('tocc-draft:'||v_draft_key::text,0));
  select * into v_operation from private.client_tocc_draft_operations op
    where op.actor_user_id=v_actor and op.idempotency_key=p_idempotency_key;
  if found then
    if v_operation.request_hash<>v_request_hash or v_operation.organization_id<>p_org
      or v_operation.branch_id<>p_branch or v_operation.client_id<>v_client_id
      or v_operation.draft_key<>v_draft_key then
      raise exception using errcode='23505',message='TOCC draft idempotency conflict';
    end if;
    select * into strict v_result from private.client_tocc_draft_versions
      where id=v_operation.version_id;
    return jsonb_build_object('draftKey',v_result.draft_key,'versionId',v_result.id,
      'clientId',v_result.client_id,'version',v_result.version,
      'contentHash',v_result.content_hash,'replayed',true);
  end if;
  select * into v_client from public.clients c where c.id=v_client_id
    and c.organization_id=p_org and c.branch_id=p_branch for update;
  if not found or v_client.status<>'active' or v_client.admitted_on is null
    or v_client.admitted_on>v_assessment_date
    or (v_client.ended_on is not null and v_client.ended_on<v_assessment_date)
    or not private.client_tocc_draft_access(p_org,p_branch,v_client_id,true) then
    raise exception using errcode='42501',message='TOCC draft client outside active assigned scope';
  end if;
  select * into v_previous from private.client_tocc_draft_versions d
    where d.draft_key=v_draft_key order by d.version desc limit 1;
  if p_action='create' then
    if found then raise exception using errcode='23505',message='TOCC draft key already exists'; end if;
    select a.id into v_base from public.client_tocc_assessments a
      where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=v_client_id
      order by a.assessment_version desc limit 1;
  else
    if not found or v_previous.organization_id<>p_org or v_previous.branch_id<>p_branch
      or v_previous.client_id<>v_client_id or v_previous.id<>v_previous_id
      or v_previous.version<>v_expected_version
      or v_previous.content_hash<>v_expected_hash then
      raise exception using errcode='PT409',message='TOCC draft version conflict';
    end if;
    if exists(select 1 from private.client_tocc_draft_signatures s where s.draft_key=v_draft_key) then
      raise exception using errcode='23505',message='signed TOCC draft is immutable';
    end if;
    v_base := v_previous.base_assessment_id;
  end if;
  v_content_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema',1,'org',p_org,'branch',p_branch,'client',v_client_id,
    'draft',v_draft_key,'version',coalesce(v_previous.version,0)+1,
    'previous',v_previous.id,'base',v_base,'date',v_assessment_date,
    'result',v_result_status,'symptoms',v_symptom_summary,'risks',v_risk_summary,
    'evidence',v_evidence_status,'actionStatus',v_action_status
  )::text,'UTF8')),'hex');
  insert into private.client_tocc_draft_versions(
    draft_key,organization_id,branch_id,client_id,version,previous_version_id,
    base_assessment_id,assessment_date,result_status,symptom_summary,risk_summary,
    evidence_status,action_status,content_hash,created_by
  ) values (
    v_draft_key,p_org,p_branch,v_client_id,coalesce(v_previous.version,0)+1,v_previous.id,
    v_base,v_assessment_date,v_result_status,v_symptom_summary,v_risk_summary,
    v_evidence_status,v_action_status,v_content_hash,v_actor
  ) returning * into v_result;
  insert into private.client_tocc_draft_operations(
    organization_id,branch_id,client_id,draft_key,version_id,actor_user_id,
    idempotency_key,request_hash,session_id,assurance_level
  ) values (p_org,p_branch,v_client_id,v_draft_key,v_result.id,v_actor,
    p_idempotency_key,v_request_hash,v_session,auth.jwt()->>'aal');
  v_receipt := jsonb_build_object('draftKey',v_result.draft_key,'versionId',v_result.id,
    'clientId',v_result.client_id,'version',v_result.version,
    'contentHash',v_result.content_hash,'replayed',false);
  return v_receipt;
end;
$$;

create function public.save_client_tocc_draft(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
  p_payload jsonb,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.save_client_tocc_draft(p_expected_organization_id,p_expected_branch_id,
    p_action,p_payload,p_idempotency_key);
$$;

create function private.client_tocc_draft_snapshot(
  p_org uuid,p_branch uuid,p_limit integer default 101,p_offset integer default 0
)
returns table(draft_key uuid,version_id uuid,client_id uuid,version integer,
  content_hash text,assessment_date date,result_status text,symptom_summary text,
  risk_summary text,evidence_status text,action_status text,created_at timestamptz,
  signed_assessment_id uuid)
language plpgsql volatile security definer set search_path='' as $$
declare v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 101
    or p_offset is null or p_offset < 0 then
    raise exception using errcode='22023',message='invalid TOCC draft page';
  end if;
  if not private.client_tocc_draft_access(p_org,p_branch,null,false) then
    raise exception using errcode='42501',message='TOCC draft snapshot denied';
  end if;
  return query
    with latest as (
      select distinct on (d.draft_key)
        d.draft_key,d.id as version_id,d.client_id,d.version,d.content_hash,
        d.assessment_date,d.result_status,d.symptom_summary,d.risk_summary,
        d.evidence_status,d.action_status,d.created_at,s.assessment_id as signed_assessment_id
      from private.client_tocc_draft_versions d
      left join private.client_tocc_draft_signatures s on s.draft_key=d.draft_key
      where d.organization_id=p_org and d.branch_id=p_branch
        and private.client_tocc_draft_access(p_org,p_branch,d.client_id,false)
      order by d.draft_key,d.version desc
    )
    select latest.draft_key,latest.version_id,latest.client_id,latest.version,
      latest.content_hash,latest.assessment_date,latest.result_status,
      latest.symptom_summary,latest.risk_summary,latest.evidence_status,
      latest.action_status,latest.created_at,latest.signed_assessment_id
    from latest order by latest.created_at desc,latest.draft_key desc
    limit p_limit offset p_offset;
  get diagnostics v_count = row_count;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.client_tocc_draft_versions',null,
    '{}'::text[],jsonb_build_object('projection','page9_drafts','result_count',v_count));
end;
$$;

create function public.client_tocc_draft_snapshot(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_limit integer default 101,p_offset integer default 0
) returns table(draft_key uuid,version_id uuid,client_id uuid,version integer,
  content_hash text,assessment_date date,result_status text,symptom_summary text,
  risk_summary text,evidence_status text,action_status text,created_at timestamptz,
  signed_assessment_id uuid)
language sql volatile security invoker set search_path='' as $$
  select * from private.client_tocc_draft_snapshot(
    p_expected_organization_id,p_expected_branch_id,p_limit,p_offset);
$$;

create function private.sign_client_tocc_draft(
  p_org uuid,p_branch uuid,p_draft_key uuid,p_version_id uuid,p_version integer,
  p_content_hash text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid();
  v_latest private.client_tocc_draft_versions%rowtype;
  v_signature private.client_tocc_draft_signatures%rowtype;
  v_current_assessment uuid;
  v_formal record;
  v_challenge uuid;
  v_request_hash text;
begin
  if v_actor is null or p_org is null or p_branch is null or p_draft_key is null
    or p_version_id is null or p_version is null or p_version<1 or p_idempotency_key is null
    or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='invalid TOCC draft signature request';
  end if;
  if coalesce(auth.jwt()->>'aal','')<>'aal2' or not private.has_recent_aal2(15)
    or not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'health.write') then
    raise exception using errcode='42501',message='recent AAL2 TOCC signature required';
  end if;
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'actor',v_actor,'draft',p_draft_key,
    'versionId',p_version_id,'version',p_version,'hash',p_content_hash
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('tocc-draft:'||p_draft_key::text,0));
  select * into v_latest from private.client_tocc_draft_versions d
    where d.draft_key=p_draft_key order by d.version desc limit 1;
  if not found or v_latest.organization_id<>p_org or v_latest.branch_id<>p_branch
    or not private.can_staff_access_client(v_latest.client_id,'clients.read')
    or not private.can_staff_access_client(v_latest.client_id,'health.write') then
    raise exception using errcode='42501',message='TOCC draft signing scope denied';
  end if;
  select * into v_signature from private.client_tocc_draft_signatures s
    where s.draft_key=p_draft_key;
  if found then
    if v_signature.actor_user_id<>v_actor or v_signature.idempotency_key<>p_idempotency_key
      or v_signature.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='TOCC draft already signed';
    end if;
    return jsonb_build_object('draftKey',p_draft_key,
      'assessmentId',v_signature.assessment_id,'versionId',v_signature.draft_version_id,
      'replayed',true);
  end if;
  if v_latest.id<>p_version_id or v_latest.version<>p_version
    or v_latest.content_hash<>p_content_hash then
    raise exception using errcode='PT409',message='TOCC draft version conflict';
  end if;
  -- Serialize against the existing formal writer, which locks the same client.
  perform 1 from public.clients c where c.id=v_latest.client_id
    and c.organization_id=p_org and c.branch_id=p_branch for update;
  if not found then raise exception using errcode='42501',message='TOCC client missing'; end if;
  select a.id into v_current_assessment from public.client_tocc_assessments a
    where a.organization_id=p_org and a.branch_id=p_branch
      and a.client_id=v_latest.client_id order by a.assessment_version desc limit 1;
  if v_current_assessment is distinct from v_latest.base_assessment_id then
    raise exception using errcode='PT409',message='formal TOCC changed since draft creation';
  end if;
  -- This existing core performs the final live assignment, active-client,
  -- same-session factor, challenge, signature hash and immutable insert checks.
  select * into strict v_formal from private.record_client_tocc_assessment_atomic(
    p_org,p_branch,v_latest.client_id,v_latest.assessment_date,
    v_latest.result_status,v_latest.symptom_summary,v_latest.risk_summary,
    v_latest.evidence_status,v_latest.action_status,gen_random_uuid());
  select a.signature_reauth_challenge_id into strict v_challenge
    from public.client_tocc_assessments a where a.id=v_formal.assessment_id;
  insert into private.client_tocc_draft_signatures(
    organization_id,branch_id,client_id,draft_key,draft_version_id,assessment_id,
    actor_user_id,idempotency_key,request_hash,reauth_challenge_id
  ) values (p_org,p_branch,v_latest.client_id,p_draft_key,v_latest.id,
    v_formal.assessment_id,v_actor,p_idempotency_key,v_request_hash,v_challenge);
  return jsonb_build_object('draftKey',p_draft_key,'assessmentId',v_formal.assessment_id,
    'versionId',v_latest.id,'replayed',false);
end;
$$;

create function public.sign_client_tocc_draft(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_draft_key uuid,
  p_expected_version_id uuid,p_expected_version integer,
  p_expected_content_hash text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.sign_client_tocc_draft(p_expected_organization_id,
    p_expected_branch_id,p_draft_key,p_expected_version_id,
    p_expected_version,p_expected_content_hash,p_idempotency_key);
$$;

alter function private.client_tocc_draft_access(uuid,uuid,uuid,boolean) owner to postgres;
alter function private.can_sign_client_tocc_draft(uuid,uuid) owner to postgres;
alter function private.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid) owner to postgres;
alter function private.client_tocc_draft_snapshot(uuid,uuid,integer,integer) owner to postgres;
alter function private.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid) owner to postgres;
revoke all on function private.client_tocc_draft_access(uuid,uuid,uuid,boolean),
  private.can_sign_client_tocc_draft(uuid,uuid),
  private.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid),
  private.client_tocc_draft_snapshot(uuid,uuid,integer,integer),
  private.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid),
  public.has_client_tocc_draft_access(uuid,uuid,uuid,boolean),
  public.can_sign_client_tocc_draft(uuid,uuid),
  public.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid),
  public.client_tocc_draft_snapshot(uuid,uuid,integer,integer),
  public.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.client_tocc_draft_access(uuid,uuid,uuid,boolean),
  private.can_sign_client_tocc_draft(uuid,uuid),
  private.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid),
  private.client_tocc_draft_snapshot(uuid,uuid,integer,integer),
  private.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid),
  public.has_client_tocc_draft_access(uuid,uuid,uuid,boolean),
  public.can_sign_client_tocc_draft(uuid,uuid),
  public.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid),
  public.client_tocc_draft_snapshot(uuid,uuid,integer,integer),
  public.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid)
  to authenticated;
commit;
