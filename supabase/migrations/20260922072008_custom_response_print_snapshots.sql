begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- This is an export of an already saved, tenant-authored response, not an
-- official form and not a new signature. Never render client-supplied answers.
create table private.custom_response_print_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 branch_id uuid not null,
 client_id uuid not null,
 response_id uuid not null references private.custom_form_responses(id),
 actor_id uuid not null references auth.users(id),
 reauth_challenge_id uuid not null references private.reauth_challenges(id),
 idempotency_key uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 foreign key(branch_id,organization_id) references public.branches(id,organization_id),
 foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id),
 unique(organization_id,actor_id,idempotency_key),
 check(expires_at=created_at+interval '5 minutes')
);
create index custom_response_print_branch_idx on private.custom_response_print_jobs(branch_id,organization_id);
create index custom_response_print_client_idx on private.custom_response_print_jobs(client_id,organization_id,branch_id);
create index custom_response_print_response_idx on private.custom_response_print_jobs(response_id);
create index custom_response_print_actor_idx on private.custom_response_print_jobs(actor_id,created_at desc);
create index custom_response_print_reauth_idx on private.custom_response_print_jobs(reauth_challenge_id);
alter table private.custom_response_print_jobs enable row level security;
alter table private.custom_response_print_jobs force row level security;
revoke all on private.custom_response_print_jobs from public,anon,authenticated,service_role;
create trigger custom_response_print_immutable before update or delete on private.custom_response_print_jobs
 for each row execute function private.reject_custom_response_mutation();

-- In addition to the shared scope guard, every permission and view_all grant
-- is checked with wall-clock timestamps. A transaction that waited on a lock
-- cannot retain an expired membership, assignment or reauthentication event.
create function private.assert_custom_response_print_access(p_org uuid,p_branch uuid,p_client uuid,p_prepare boolean)
returns uuid language plpgsql volatile security invoker set search_path='' as $$
declare required_permission text; challenge uuid; live_view_all boolean;
begin
 if p_org is null or p_branch is null or p_client is null or p_prepare is null
  or coalesce(auth.jwt()->>'aal','')<>'aal2'
 then raise exception using errcode='42501',message='custom response print access denied'; end if;
 perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
 foreach required_permission in array (array['care_records.read','document_printing.read','document_printing.access'] ||
  case when p_prepare then array['document_printing.manage'] else array[]::text[] end) loop
  if not exists(select 1 from public.profiles profile
   join public.memberships m on m.profile_id=profile.id
   join public.membership_roles mr on mr.membership_id=m.id and mr.assigned_at<=clock_timestamp()
   join public.roles role on role.id=mr.role_id and role.is_active and role.role_key not in ('family','platform_ops')
   join public.role_permissions rp on rp.role_id=role.id and rp.granted_at<=clock_timestamp()
   join public.permissions permission on permission.id=rp.permission_id
   where profile.id=auth.uid() and profile.is_active and profile.kind in ('staff','professional','finance','driver')
    and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
    and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
    and (role.organization_id is null or role.organization_id=p_org) and permission.permission_key=required_permission)
  then raise exception using errcode='42501',message='custom response print access denied'; end if;
 end loop;
 select exists(select 1 from public.memberships m
  join public.membership_roles mr on mr.membership_id=m.id and mr.assigned_at<=clock_timestamp()
  join public.roles role on role.id=mr.role_id and role.is_active and role.role_key not in ('family','platform_ops')
  join public.role_permissions rp on rp.role_id=role.id and rp.granted_at<=clock_timestamp()
  join public.permissions permission on permission.id=rp.permission_id and permission.permission_key='clients.view_all'
  where m.profile_id=auth.uid() and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
   and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
   and (role.organization_id is null or role.organization_id=p_org)) into live_view_all;
 if not live_view_all and not exists(select 1 from public.client_assignments a
  where a.organization_id=p_org and a.branch_id=p_branch and a.client_id=p_client and a.assignee_user_id=auth.uid()
   and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))
 then raise exception using errcode='42501',message='custom response print access denied'; end if;
 challenge:=private.require_case_service_record_reauth(auth.uid(),clock_timestamp());
 -- The reauth helper can itself wait for an event/challenge row lock.
 if not private.is_executive_login_allowed() or not exists(select 1 from private.reauth_challenges c
   where c.id=challenge and c.factor_verified_at>=clock_timestamp()-interval '15 minutes'
    and c.invalidated_at is null)
 then raise exception using errcode='42501',message='custom response print access denied'; end if;
 return challenge;
end;$$;

create function private.custom_response_print_json(j private.custom_response_print_jobs,p_replayed boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('jobId',j.id,'organizationId',j.organization_id,'branchId',j.branch_id,
  'responseId',j.response_id,'clientId',j.client_id,'actorId',j.actor_id,'createdAt',j.created_at,
  'expiresAt',j.expires_at,'snapshotHash',j.snapshot_hash,'snapshot',j.snapshot,'replayed',p_replayed);
$$;

create function private.prepare_custom_response_print_atomic(p_org uuid,p_branch uuid,p_client uuid,p_response uuid,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); j private.custom_response_print_jobs%rowtype; r private.custom_form_responses%rowtype;
 challenge uuid; payload jsonb; request_hash text; stamp timestamptz;
begin
 challenge:=private.assert_custom_response_print_access(p_org,p_branch,p_client,true);
 if p_response is null or p_key is null then raise exception using errcode='22023',message='invalid print request'; end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'client',p_client,'response',p_response)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('custom-response-print:'||p_org||':'||actor||':'||p_key,0));
 challenge:=private.assert_custom_response_print_access(p_org,p_branch,p_client,true);
 select * into j from private.custom_response_print_jobs where organization_id=p_org and actor_id=actor and idempotency_key=p_key;
 if found then
  if j.request_hash<>request_hash then raise exception using errcode='23505',message='print idempotency conflict'; end if;
  if j.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='print link expired'; end if;
  return private.custom_response_print_json(j,true);
 end if;
 select * into r from private.custom_form_responses where id=p_response and organization_id=p_org and branch_id=p_branch and client_id=p_client;
 if not found then raise exception using errcode='42501',message='custom response print access denied'; end if;
 select jsonb_build_object('response',private.custom_response_json(r),'organizationName',o.name,'branchName',b.name,
  'clientCode',c.client_code,'clientName',c.display_name,'formKey',d.form_key,'formName',d.name,
  'formVersion',v.version,'preparedByName',profile.display_name) into payload
 from public.clients c join public.organizations o on o.id=c.organization_id
 join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id
 join public.form_versions v on v.id=r.form_version_id
 join public.form_definitions d on d.id=v.form_definition_id and d.organization_id=p_org and not d.is_official
 join public.profiles profile on profile.id=actor
 where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch and d.form_key ~ '^tenant\.custom\.';
 if payload is null then raise exception using errcode='42501',message='custom response print access denied'; end if;
 challenge:=private.assert_custom_response_print_access(p_org,p_branch,p_client,true);
 stamp:=clock_timestamp();
 insert into private.custom_response_print_jobs(organization_id,branch_id,client_id,response_id,actor_id,reauth_challenge_id,idempotency_key,
  request_hash,snapshot,snapshot_hash,created_at,expires_at)
 values(p_org,p_branch,p_client,p_response,actor,challenge,p_key,request_hash,payload,
  encode(sha256(convert_to(payload::text,'UTF8')),'hex'),stamp,stamp+interval '5 minutes') returning * into j;
 -- Audit contains identities and hashes only, never answers, names or content.
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata,occurred_at)
 values(p_org,p_branch,actor,'print','custom_response_print_jobs',j.id::text,'{}',
  jsonb_build_object('operation','prepare','response_id',p_response,'snapshot_hash',j.snapshot_hash),stamp);
 perform private.assert_custom_response_print_access(p_org,p_branch,p_client,true);
 if j.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='print link expired'; end if;
 return private.custom_response_print_json(j,false);
end;$$;

create function private.read_custom_response_print_scoped(p_org uuid,p_branch uuid,p_job uuid,p_snapshot_hash text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare j private.custom_response_print_jobs%rowtype; challenge uuid; stamp timestamptz;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='custom response print access denied'; end if;
 if p_job is null or p_org is null or p_branch is null or not coalesce(p_snapshot_hash ~ '^[a-f0-9]{64}$',false)
 then raise exception using errcode='22023',message='invalid print request'; end if;
 select * into j from private.custom_response_print_jobs
  where id=p_job and organization_id=p_org and branch_id=p_branch and actor_id=auth.uid() and snapshot_hash=p_snapshot_hash;
 if not found then raise exception using errcode='42501',message='custom response print access denied'; end if;
 challenge:=private.assert_custom_response_print_access(p_org,p_branch,j.client_id,false);
 if j.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='print link expired'; end if;
 stamp:=clock_timestamp();
 -- Each invocation is an access authorization check. The server may call this
 -- before and after rendering, so this is NOT a successful download counter.
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata,occurred_at)
 values(p_org,p_branch,auth.uid(),'export','custom_response_print_jobs',j.id::text,'{}',
  jsonb_build_object('operation','read_authorization_check','response_id',j.response_id,'snapshot_hash',j.snapshot_hash,'reauth_challenge_id',challenge),stamp);
 -- Auditing may block; discard the whole transaction if scope or TTL expired.
 perform private.assert_custom_response_print_access(p_org,p_branch,j.client_id,false);
 if j.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='print link expired'; end if;
 return private.custom_response_print_json(j,false);
end;$$;

create function public.prepare_custom_response_print(p_org uuid,p_branch uuid,p_client uuid,p_response uuid,p_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.prepare_custom_response_print_atomic(p_org,p_branch,p_client,p_response,p_key);$$;
create function public.read_custom_response_print(p_org uuid,p_branch uuid,p_job uuid,p_snapshot_hash text)
returns jsonb language sql volatile security invoker set search_path='' as $$select private.read_custom_response_print_scoped(p_org,p_branch,p_job,p_snapshot_hash);$$;
revoke all on function private.assert_custom_response_print_access(uuid,uuid,uuid,boolean),
 private.custom_response_print_json(private.custom_response_print_jobs,boolean),
 private.prepare_custom_response_print_atomic(uuid,uuid,uuid,uuid,uuid),private.read_custom_response_print_scoped(uuid,uuid,uuid,text),
 public.prepare_custom_response_print(uuid,uuid,uuid,uuid,uuid),public.read_custom_response_print(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function private.prepare_custom_response_print_atomic(uuid,uuid,uuid,uuid,uuid),
 private.read_custom_response_print_scoped(uuid,uuid,uuid,text),public.prepare_custom_response_print(uuid,uuid,uuid,uuid,uuid),
 public.read_custom_response_print(uuid,uuid,uuid,text) to authenticated;
commit;
