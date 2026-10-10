-- Page 79: internal evidence-preparation metadata only. The Taipei 115 source
-- is unapproved for this institution; this migration does not publish official
-- indicators, scores, an upload endpoint, or a submission workflow.
create table private.evaluation_preparation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  item_code text not null check (item_code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'),
  version integer not null check (version between 1 and 1000000),
  previous_version_id uuid unique,
  owner_user_id uuid references auth.users(id) on delete restrict,
  due_on date check (due_on between date '2000-01-01' and date '2100-12-31'),
  evidence_reference uuid,
  progress text not null check (progress in ('collecting','internal_review_requested')),
  change_reason text not null check (change_reason in ('initial','evidence_added','owner_changed','due_date_changed','progress_changed','correction')),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  foreign key (branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
  unique (organization_id,branch_id,item_code,version),
  unique (id,organization_id,branch_id,item_code),
  foreign key (previous_version_id,organization_id,branch_id,item_code)
    references private.evaluation_preparation_versions(id,organization_id,branch_id,item_code) on delete restrict,
  check ((version=1)=(previous_version_id is null)),
  check ((version=1 and change_reason='initial') or (version>1 and change_reason<>'initial')),
  check (progress<>'internal_review_requested' or (owner_user_id is not null and due_on is not null and evidence_reference is not null))
);
create index evaluation_preparation_scope_idx on private.evaluation_preparation_versions(organization_id,branch_id,item_code,version desc);
create index evaluation_preparation_owner_idx on private.evaluation_preparation_versions(owner_user_id) where owner_user_id is not null;

create table private.evaluation_preparation_operations (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  version_id uuid not null references private.evaluation_preparation_versions(id) on delete restrict,
  receipt jsonb not null,
  unique (actor_user_id,idempotency_key)
);
create index evaluation_preparation_operation_version_idx on private.evaluation_preparation_operations(version_id);
alter table private.evaluation_preparation_versions enable row level security;
alter table private.evaluation_preparation_versions force row level security;
alter table private.evaluation_preparation_operations enable row level security;
alter table private.evaluation_preparation_operations force row level security;
revoke all on private.evaluation_preparation_versions,private.evaluation_preparation_operations from public,anon,authenticated,service_role;

create function private.evaluation_preparation_append_only() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='55000',message='evaluation preparation is append-only'; end;
$$;
create trigger evaluation_preparation_versions_append_only before update or delete on private.evaluation_preparation_versions
  for each row execute function private.evaluation_preparation_append_only();
create trigger evaluation_preparation_operations_append_only before update or delete on private.evaluation_preparation_operations
  for each row execute function private.evaluation_preparation_append_only();

-- Reuse the existing manager + audit.view + active tenant + AAL2 authority,
-- instead of admitting everyone who can merely open the catalog route.
create function private.evaluation_preparation_authorized(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select private.data_inventory_authorized(p_org,p_branch);
$$;
create function private.evaluation_preparation_owner_active(p_org uuid,p_branch uuid,p_owner uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select p_owner is null or exists (
    select 1 from public.memberships m join public.profiles p on p.id=m.profile_id
    where m.profile_id=p_owner and m.organization_id=p_org and (m.branch_id=p_branch or m.branch_id is null)
      and p.kind='staff' and p.is_active and m.status='active' and m.starts_at<=clock_timestamp()
      and (m.ends_at is null or m.ends_at>clock_timestamp())
  );
$$;
create function private.evaluation_preparation_version_json(v private.evaluation_preparation_versions)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('versionId',v.id,'itemCode',v.item_code,'version',v.version,
    'previousVersionId',v.previous_version_id,'ownerUserId',v.owner_user_id,'dueOn',v.due_on,
    'evidenceReference',v.evidence_reference,'progress',v.progress,'changeReason',v.change_reason,
    'recordedBy',v.recorded_by,'recordedAt',v.recorded_at,'contentHash',v.content_hash);
$$;

create function private.evaluation_preparation_mutate(p_org uuid,p_branch uuid,p_request jsonb,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_code text; v_expected integer; v_owner uuid; v_due date; v_evidence uuid;
  v_progress text; v_reason text; v_hash text; v_content jsonb; v_receipt jsonb;
  v_old private.evaluation_preparation_versions%rowtype;
  v_new private.evaluation_preparation_versions%rowtype;
  v_prior private.evaluation_preparation_operations%rowtype;
begin
  if not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation denied'; end if;
  if p_key is null or jsonb_typeof(p_request) is distinct from 'object'
    or not p_request ?& array['itemCode','expectedVersion','ownerUserId','dueOn','evidenceReference','progress','changeReason']
    or (select count(*) from jsonb_object_keys(p_request))<>7
    or jsonb_typeof(p_request->'itemCode')<>'string'
    or coalesce(p_request->>'itemCode','') !~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'
    or jsonb_typeof(p_request->'expectedVersion')<>'number'
    or coalesce(p_request->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_request->>'progress','') not in ('collecting','internal_review_requested')
    or coalesce(p_request->>'changeReason','') not in ('initial','evidence_added','owner_changed','due_date_changed','progress_changed','correction')
    or (p_request->'ownerUserId'<>'null'::jsonb and (jsonb_typeof(p_request->'ownerUserId')<>'string'
      or p_request->>'ownerUserId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
    or (p_request->'evidenceReference'<>'null'::jsonb and (jsonb_typeof(p_request->'evidenceReference')<>'string'
      or p_request->>'evidenceReference' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
    or (p_request->'dueOn'<>'null'::jsonb and (jsonb_typeof(p_request->'dueOn')<>'string'
      or p_request->>'dueOn' !~ '^(20[0-9]{2}|2100)-[0-9]{2}-[0-9]{2}$')) then
    raise exception using errcode='22023',message='invalid evaluation preparation request'; end if;
  v_code:=p_request->>'itemCode'; v_expected:=(p_request->>'expectedVersion')::integer;
  v_progress:=p_request->>'progress'; v_reason:=p_request->>'changeReason';
  if (v_expected=0 and v_reason<>'initial') or (v_expected>0 and v_reason='initial') then
    raise exception using errcode='22023',message='invalid evaluation preparation reason'; end if;
  if p_request->'ownerUserId'<>'null'::jsonb then v_owner:=(p_request->>'ownerUserId')::uuid; end if;
  if p_request->'evidenceReference'<>'null'::jsonb then v_evidence:=(p_request->>'evidenceReference')::uuid; end if;
  if p_request->'dueOn'<>'null'::jsonb then
    begin
      v_due:=(p_request->>'dueOn')::date;
      if to_char(v_due,'YYYY-MM-DD')<>p_request->>'dueOn' or v_due>date '2100-12-31' then
        raise exception using errcode='22023',message='invalid evaluation preparation date'; end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='22023',message='invalid evaluation preparation date'; end;
  end if;
  if not private.evaluation_preparation_owner_active(p_org,p_branch,v_owner)
    or (v_progress='internal_review_requested' and (v_owner is null or v_due is null or v_evidence is null)) then
    raise exception using errcode='23514',message='evaluation preparation checklist incomplete'; end if;
  v_content:=jsonb_build_object('itemCode',v_code,'ownerUserId',v_owner,'dueOn',v_due,
    'evidenceReference',v_evidence,'progress',v_progress,'changeReason',v_reason);
  v_hash:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'request',p_request)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_key::text,79));
  if not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation denied'; end if;
  select * into v_prior from private.evaluation_preparation_operations
    where actor_user_id=v_actor and idempotency_key=p_key;
  if found then
    if v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='evaluation preparation idempotency conflict'; end if;
    return v_prior.receipt||jsonb_build_object('replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_branch::text||':'||v_code,79));
  select * into v_old from private.evaluation_preparation_versions
    where organization_id=p_org and branch_id=p_branch and item_code=v_code order by version desc limit 1;
  if coalesce(v_old.version,0)<>v_expected then
    raise exception using errcode='40001',message='evaluation preparation version stale'; end if;
  if not private.evaluation_preparation_owner_active(p_org,p_branch,v_owner)
    or not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation authority changed'; end if;
  v_new.id:=gen_random_uuid(); v_new.organization_id:=p_org; v_new.branch_id:=p_branch;
  v_new.item_code:=v_code; v_new.version:=v_expected+1; v_new.previous_version_id:=v_old.id;
  v_new.owner_user_id:=v_owner; v_new.due_on:=v_due; v_new.evidence_reference:=v_evidence;
  v_new.progress:=v_progress; v_new.change_reason:=v_reason; v_new.recorded_by:=v_actor;
  v_new.recorded_at:=clock_timestamp(); v_new.content_hash:=encode(sha256(convert_to(v_content::text,'UTF8')),'hex');
  insert into private.evaluation_preparation_versions values (v_new.*);
  v_receipt:=jsonb_build_object('operationId',gen_random_uuid(),'organizationId',p_org,'branchId',p_branch,
    'actorUserId',v_actor,'idempotencyKey',p_key,'result',private.evaluation_preparation_version_json(v_new),
    'replayed',false,'formalSubmissionEnabled',false);
  insert into private.evaluation_preparation_operations(actor_user_id,idempotency_key,request_hash,version_id,receipt)
    values(v_actor,p_key,v_hash,v_new.id,v_receipt);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,idempotency_key,changed_fields,metadata)
    values(p_org,p_branch,v_actor,'insert','private.evaluation_preparation_versions',v_new.id::text,p_key,
      array['item_code','owner_user_id','due_on','evidence_reference','progress','change_reason'],
      jsonb_build_object('internal_preparation',true,'version',v_new.version));
  return v_receipt;
end;
$$;

create function private.evaluation_preparation_snapshot(p_org uuid,p_branch uuid,p_page integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_total integer; v_items jsonb; v_owners jsonb; v_now timestamptz;
begin
  if not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation snapshot denied'; end if;
  if p_page not between 1 and 100 then
    raise exception using errcode='22023',message='invalid evaluation preparation page'; end if;
  with latest as (
    select distinct on (item_code) * from private.evaluation_preparation_versions
    where organization_id=p_org and branch_id=p_branch order by item_code,version desc
  )
  select count(*) into v_total from latest;
  with latest as (
    select distinct on (item_code) * from private.evaluation_preparation_versions
    where organization_id=p_org and branch_id=p_branch order by item_code,version desc
  )
  select coalesce(jsonb_agg(private.evaluation_preparation_version_json(v) order by v.item_code),'[]'::jsonb)
    into v_items from (select * from latest order by item_code limit 25 offset (p_page-1)*25) v;
  select coalesce(jsonb_agg(jsonb_build_object('userId',q.profile_id,'name',q.display_name) order by q.display_name,q.profile_id),'[]'::jsonb)
    into v_owners from (
      select distinct p.id as profile_id,p.display_name from public.memberships m
      join public.profiles p on p.id=m.profile_id and p.kind='staff' and p.is_active
      where m.organization_id=p_org and (m.branch_id=p_branch or m.branch_id is null)
        and m.status='active' and m.starts_at<=clock_timestamp()
        and (m.ends_at is null or m.ends_at>clock_timestamp())
      order by p.display_name,p.id limit 200
    ) q;
  if not private.evaluation_preparation_authorized(p_org,p_branch) then
    raise exception using errcode='42501',message='evaluation preparation snapshot denied'; end if;
  v_now:=clock_timestamp();
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
    values(p_org,p_branch,auth.uid(),'select','private.evaluation_preparation_versions',
      jsonb_build_object('internal_preparation',true,'page',p_page,'returned',jsonb_array_length(v_items)));
  return jsonb_build_object('organizationId',p_org,'branchId',p_branch,'generatedAt',v_now,
    'staleAfter',v_now+interval '5 minutes','page',p_page,'pageSize',25,'total',v_total,
    'items',v_items,'owners',v_owners,'sourceStatus','applicability_unapproved',
    'formalSubmissionEnabled',false,'demo',false);
end;
$$;

create function public.evaluation_preparation_mutate(p_expected_organization_id uuid,p_expected_branch_id uuid,p_request jsonb,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.evaluation_preparation_mutate(p_expected_organization_id,p_expected_branch_id,p_request,p_idempotency_key);
$$;
create function public.evaluation_preparation_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_page integer)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.evaluation_preparation_snapshot(p_expected_organization_id,p_expected_branch_id,p_page);
$$;
revoke all on function private.evaluation_preparation_append_only(),private.evaluation_preparation_authorized(uuid,uuid),
  private.evaluation_preparation_owner_active(uuid,uuid,uuid),private.evaluation_preparation_version_json(private.evaluation_preparation_versions),
  private.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid),private.evaluation_preparation_snapshot(uuid,uuid,integer),
  public.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid),public.evaluation_preparation_snapshot(uuid,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function private.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid),
  private.evaluation_preparation_snapshot(uuid,uuid,integer),public.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid),
  public.evaluation_preparation_snapshot(uuid,uuid,integer) to authenticated;
