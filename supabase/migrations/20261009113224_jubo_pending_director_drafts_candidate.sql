-- Candidate only. Requires the separately reviewed public pending-client
-- promotion. This grants a branch director a narrow, append-only place for
-- local intake supplements and unscored assessment preparation drafts. It
-- never updates a JUBO source row, the client master, a formal assessment,
-- or an admission/clinical/service record.
begin;
set local lock_timeout = '5s';

insert into public.permissions(permission_key,description,risk_level)
values('clients.intake_draft.manage',
  'Write only JUBO pending-client local intake supplements and unscored assessment preparation drafts',2)
on conflict(permission_key) do nothing;

-- This is a role-template capability, not a user/membership grant. The RPC
-- below additionally requires this exact system role on the exact branch.
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000011'::uuid,p.id
from public.permissions p where p.permission_key='clients.intake_draft.manage'
on conflict do nothing;

create table private.jubo_pending_director_draft_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  pending_link_id uuid not null references private.jubo_public_pending_links(id) on delete restrict,
  source_row_id uuid not null,
  draft_kind text not null check(draft_kind in ('local_supplement','assessment_preparation')),
  form_key text not null,
  revision integer not null check(revision>0),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=10000),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint jubo_pending_draft_kind_form_check check(
    (draft_kind='local_supplement' and form_key='intake_local') or
    (draft_kind='assessment_preparation' and form_key in
      ('spmsq','gds','fall_risk','nsi','barthel','iadl','swallowing','bsrs','body','abcd'))
  ),
  foreign key(client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  unique(client_id,draft_kind,form_key,revision),
  unique(actor_user_id,idempotency_key)
);
create index jubo_pending_draft_latest_idx on private.jubo_pending_director_draft_revisions
  (organization_id,branch_id,client_id,draft_kind,form_key,revision desc);
alter table private.jubo_pending_director_draft_revisions enable row level security;
alter table private.jubo_pending_director_draft_revisions force row level security;
revoke all on private.jubo_pending_director_draft_revisions from public,anon,authenticated,service_role;
create function private.guard_jubo_pending_director_draft_provenance()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
  if not exists(select 1 from private.jubo_public_pending_links link
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
      and pending.organization_id=link.organization_id and pending.branch_id=link.branch_id
    join public.clients client on client.id=link.client_id
      and client.organization_id=link.organization_id and client.branch_id=link.branch_id
    where link.id=new.pending_link_id and link.client_id=new.client_id
      and link.organization_id=new.organization_id and link.branch_id=new.branch_id
      and pending.source_row_id=new.source_row_id
      and client.status='pending' and client.source_system='jubo'
      and client.admitted_on is null and client.ended_on is null) then
    raise exception using errcode='23514',message='JUBO_PENDING_DRAFT_PROVENANCE_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger jubo_pending_draft_provenance before insert
  on private.jubo_pending_director_draft_revisions for each row
  execute function private.guard_jubo_pending_director_draft_provenance();
create trigger jubo_pending_draft_immutable before update or delete
  on private.jubo_pending_director_draft_revisions for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_pending_draft_audit after insert
  on private.jubo_pending_director_draft_revisions for each row
  execute function private.audit_row_change();

-- Data protection is not delegated to clients.manage or an organization-wide
-- branch_supervisor role. routine_staff_scope checks approved Google identity,
-- actual Auth session, active staff membership and revocation on each call.
create function private.require_jubo_pending_director_draft_scope(
  p_org uuid,p_branch uuid,p_client uuid
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_source uuid;
begin
  if auth.uid() is null or p_org is null or p_branch is null or p_client is null
    or not exists(
      select 1 from private.routine_staff_scope() scope
      join public.roles role on role.id=scope.role_id and role.is_system
        and role.role_key='branch_director' and role.is_active
      join public.role_permissions grant_row on grant_row.role_id=role.id
        and grant_row.granted_at<=clock_timestamp()
      join public.permissions permission on permission.id=grant_row.permission_id
        and permission.permission_key='clients.intake_draft.manage'
      join public.branches branch on branch.id=p_branch and branch.organization_id=p_org
        and branch.is_active
      join public.organizations organization on organization.id=p_org and organization.is_active
      where scope.organization_id=p_org and scope.branch_id=p_branch
        and exists(select 1 from public.role_permissions rp
          join public.permissions p on p.id=rp.permission_id
          where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
            and p.permission_key='clients.read')
        and exists(select 1 from public.role_permissions rp
          join public.permissions p on p.id=rp.permission_id
          where rp.role_id=role.id and rp.granted_at<=clock_timestamp()
            and p.permission_key='clients.view_all')
    ) then
    raise exception using errcode='42501',message='JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;
  select pending.source_row_id into v_source
  from public.clients client
  join private.jubo_public_pending_links link on link.client_id=client.id
    and link.organization_id=client.organization_id and link.branch_id=client.branch_id
  join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
    and pending.organization_id=client.organization_id and pending.branch_id=client.branch_id
  where client.id=p_client and client.organization_id=p_org and client.branch_id=p_branch
    and client.status='pending' and client.source_system='jubo'
    and client.admitted_on is null and client.ended_on is null;
  if v_source is null then
    raise exception using errcode='42501',message='JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;
  return v_source;
end;
$$;

-- Payloads are intentionally smaller than the official intake profile and
-- cannot assert identity, eligibility, consent, score, signature or service.
create function private.validate_jubo_pending_director_draft(
  p_kind text,p_form_key text,p_payload jsonb
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare k text; v jsonb; item jsonb; d date;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>10000 then
    raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
  end if;
  if p_kind='local_supplement' and p_form_key='intake_local' then
    if exists(select 1 from jsonb_object_keys(p_payload) as field(key)
      where key not in ('contactPreference','visitPlanningNote','followUpNote'))
      or p_payload='{}'::jsonb then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    if p_payload ? 'contactPreference' and
      (jsonb_typeof(p_payload->'contactPreference')<>'string' or
       p_payload->>'contactPreference' not in ('phone','in_person','written','unknown')) then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    for k,v in select key,value from jsonb_each(p_payload)
      where key in ('visitPlanningNote','followUpNote') loop
      if jsonb_typeof(v)<>'string' or char_length(v#>>'{}')>1000
        or (v#>>'{}')~'[[:cntrl:]]' then
        raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
      end if;
    end loop;
  elsif p_kind='assessment_preparation' and p_form_key in
    ('spmsq','gds','fall_risk','nsi','barthel','iadl','swallowing','bsrs','body','abcd') then
    if exists(select 1 from jsonb_object_keys(p_payload) as field(key)
      where key not in ('formVersion','assessmentDate','answers','qualitativeNote'))
      or coalesce(p_payload->>'formVersion','') !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
      or coalesce(jsonb_typeof(p_payload->'assessmentDate'),'')<>'string'
      or coalesce(jsonb_typeof(p_payload->'answers'),'')<>'object' then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    if (select count(*) from jsonb_object_keys(p_payload->'answers'))>50 then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    d:=private.intake_date(p_payload->>'assessmentDate');
    if d is null or d>(clock_timestamp() at time zone 'Asia/Taipei')::date then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    if p_payload ? 'qualitativeNote' and
      (jsonb_typeof(p_payload->'qualitativeNote')<>'string'
       or char_length(p_payload->>'qualitativeNote')>2000
       or (p_payload->>'qualitativeNote')~'[[:cntrl:]]') then
      raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
    end if;
    for k,v in select key,value from jsonb_each(p_payload->'answers') loop
      if k !~ '^[a-z][a-z0-9_]{0,63}$' or jsonb_typeof(v) not in
        ('string','number','boolean','array') then
        raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
      end if;
      if jsonb_typeof(v)='array' then
        if jsonb_array_length(v)>12 then
          raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
        end if;
        for item in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(item) not in ('string','number','boolean')
            or char_length(item#>>'{}')>1000 or (item#>>'{}')~'[[:cntrl:]]' then
            raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
          end if;
        end loop;
      elsif char_length(v#>>'{}')>1000 or (v#>>'{}')~'[[:cntrl:]]' then
        raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
      end if;
    end loop;
  else
    raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
  end if;
  return p_payload;
end;
$$;

create function private.save_jubo_pending_director_draft(
  p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_form_key text,
  p_expected_revision integer,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_source uuid; v_link uuid; v_previous private.jubo_pending_director_draft_revisions%rowtype;
  v_request_sha text; v_revision integer; v_payload jsonb; v_id uuid;
begin
  v_source:=private.require_jubo_pending_director_draft_scope(p_org,p_branch,p_client);
  if p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='JUBO_PENDING_DRAFT_INVALID';
  end if;
  v_payload:=private.validate_jubo_pending_director_draft(p_kind,p_form_key,p_payload);
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'client',p_client,'kind',p_kind,'formKey',p_form_key,
    'expectedRevision',p_expected_revision,'payload',v_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'jubo-director-draft:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_director_draft_revisions
    where actor_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_DRAFT_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('draftId',v_previous.id,'revision',v_previous.revision,
      'kind',v_previous.draft_kind,'formKey',v_previous.form_key,'replayed',true,
      'formalRecord',false);
  end if;
  perform 1 from public.clients where id=p_client and organization_id=p_org
    and branch_id=p_branch and status='pending' for update;
  if not found then
    raise exception using errcode='42501',message='JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;
  select link.id into v_link from private.jubo_public_pending_links link
    join private.jubo_pending_master_rows pending on pending.id=link.pending_row_id
    where link.client_id=p_client and link.organization_id=p_org and link.branch_id=p_branch
      and pending.source_row_id=v_source;
  select * into v_previous from private.jubo_pending_director_draft_revisions
    where client_id=p_client and draft_kind=p_kind and form_key=p_form_key
    order by revision desc limit 1;
  v_revision:=coalesce(v_previous.revision,0);
  if v_revision<>p_expected_revision then
    raise exception using errcode='40001',message='JUBO_PENDING_DRAFT_VERSION_CONFLICT';
  end if;
  insert into private.jubo_pending_director_draft_revisions(
    organization_id,branch_id,client_id,pending_link_id,source_row_id,
    draft_kind,form_key,revision,payload,actor_user_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_client,v_link,v_source,p_kind,p_form_key,v_revision+1,
    v_payload,auth.uid(),p_idempotency_key,v_request_sha)
  returning id into v_id;
  return jsonb_build_object('draftId',v_id,'revision',v_revision+1,
    'kind',p_kind,'formKey',p_form_key,'replayed',false,'formalRecord',false);
end;
$$;

create function private.jubo_pending_director_draft_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_source uuid; v_local jsonb; v_assessments jsonb;
begin
  v_source:=private.require_jubo_pending_director_draft_scope(p_org,p_branch,p_client);
  select jsonb_build_object('revision',row.revision,'payload',row.payload)
    into v_local from private.jubo_pending_director_draft_revisions row
    where row.client_id=p_client and row.draft_kind='local_supplement'
    order by row.revision desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('formKey',entry.form_key,
      'revision',entry.revision,'payload',entry.payload) order by entry.form_key),'[]'::jsonb)
    into v_assessments
  from (select distinct on (row.form_key) row.form_key,row.revision,row.payload
    from private.jubo_pending_director_draft_revisions row
    where row.client_id=p_client and row.draft_kind='assessment_preparation'
    order by row.form_key,row.revision desc) entry;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,
    action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.jubo_pending_director_draft_revisions',
    p_client::text,'{}'::text[],jsonb_build_object('projection','pending_director_drafts_v1'));
  return jsonb_build_object('clientId',p_client,'status','pending',
    'sourceSystem','jubo','localSupplement',v_local,
    'assessmentPreparations',v_assessments,'formalRecord',false);
end;
$$;

create function public.save_jubo_pending_director_draft(
  p_org uuid,p_branch uuid,p_client uuid,p_kind text,p_form_key text,
  p_expected_revision integer,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.save_jubo_pending_director_draft(p_org,p_branch,p_client,
    p_kind,p_form_key,p_expected_revision,p_payload,p_idempotency_key);
$$;
create function public.jubo_pending_director_draft_workspace(
  p_org uuid,p_branch uuid,p_client uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.jubo_pending_director_draft_workspace(p_org,p_branch,p_client);
$$;

revoke all on function private.require_jubo_pending_director_draft_scope(uuid,uuid,uuid),
  private.guard_jubo_pending_director_draft_provenance(),
  private.validate_jubo_pending_director_draft(text,text,jsonb),
  private.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  private.jubo_pending_director_draft_workspace(uuid,uuid,uuid),
  public.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  public.jubo_pending_director_draft_workspace(uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  private.jubo_pending_director_draft_workspace(uuid,uuid,uuid),
  public.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid),
  public.jubo_pending_director_draft_workspace(uuid,uuid,uuid)
to authenticated;

comment on table private.jubo_pending_director_draft_revisions is
  'Candidate only. Append-only local supplement and unscored assessment preparation history for reviewed JUBO pending clients; never formal assessment or clinical evidence.';
commit;
