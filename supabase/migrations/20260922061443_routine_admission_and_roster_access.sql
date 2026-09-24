-- Explicit administrative continuation: formal admission and supervisor daily
-- allocation only. Suspension/resumption/transfer/closure/death, clinical
-- signatures, medications, permission administration and exports keep AAL2.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.has_routine_completion_access(p_org uuid,p_branch uuid,p_action text,p_client uuid default null)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare permission text; required text[];
begin
 if auth.uid() is null or p_org is null or p_branch is null or not exists(
  select 1 from public.organizations o join public.branches b on b.organization_id=o.id
  where o.id=p_org and b.id=p_branch and o.is_active and b.is_active) then return false;end if;
 required:=case p_action when 'admission.create' then array['clients.read','clients.manage']
  when 'lifecycle.read' then array['clients.read']
  when 'roster.manage' then array['clients.read','clients.view_all','staff_scheduling.manage'] else null end;
 if required is null then return false;end if;
 if p_client is not null and not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch) then return false;end if;
 foreach permission in array required loop
  if not private.has_routine_intake_permission(p_org,p_branch,permission) then return false;end if;
  if p_client is not null and not private.can_routine_intake_access_client(p_client,permission) then return false;end if;
 end loop;
 return true;
end;$$;
create function public.has_routine_completion_access(target_org_id uuid,target_branch_id uuid,target_action text,target_client_id uuid default null)
returns boolean language sql volatile security invoker set search_path='' as $$
 select private.has_routine_completion_access(target_org_id,target_branch_id,target_action,target_client_id);
$$;
create function private.can_routine_admit_client(p_client uuid,p_kind public.client_transition_kind)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_kind='admit' and exists(select 1 from public.clients c where c.id=p_client
  and private.has_routine_completion_access(c.organization_id,c.branch_id,'admission.create',c.id)),false);
$$;

-- Keep all existing state, actor, tenant, version and replay checks. These
-- replacements apply the exception at every original authorization checkpoint,
-- including the fresh statement after the client row lock and the ledger trigger.
do $migration$
declare source text;anchor text;
begin
 source:=pg_get_functiondef('private.transition_client_atomic(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)'::regprocedure);
 anchor:='(select private.has_recent_aal2(15))';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>2 then raise exception 'Unexpected lifecycle AAL2 checkpoints';end if;
 source:=replace(source,anchor,'(select private.has_recent_aal2(15) or private.can_routine_admit_client(p_client_id,p_event_kind))');
 anchor:=$anchor$(select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.manage'
     ))$anchor$;
 if position(anchor in source)=0 then raise exception 'Unexpected lifecycle initial permission';end if;
 source:=replace(source,anchor,'(select private.has_permission(p_expected_organization_id,p_expected_branch_id,''clients.manage'') or private.has_routine_completion_access(p_expected_organization_id,p_expected_branch_id,''admission.create'',p_client_id) and p_event_kind=''admit'')');
 anchor:=$anchor$(select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.manage'
     ))$anchor$;
 if position(anchor in source)=0 then raise exception 'Unexpected lifecycle post-lock permission';end if;
 source:=replace(source,anchor,'(select private.has_permission(p_expected_organization_id,p_expected_branch_id,''clients.manage'') or private.has_routine_completion_access(p_expected_organization_id,p_expected_branch_id,''admission.create'',p_client_id) and p_event_kind=''admit'')');
 anchor:='(select private.can_staff_access_client(v_existing.client_id, ''clients.manage''))';
 if position(anchor in source)=0 then raise exception 'Unexpected lifecycle replay checkpoint';end if;
 source:=replace(source,anchor,'(select private.can_staff_access_client(v_existing.client_id,''clients.manage'') or private.can_routine_admit_client(v_existing.client_id,p_event_kind))');
 anchor:='(select private.can_staff_access_client(p_client_id, ''clients.manage''))';
 if position(anchor in source)=0 then raise exception 'Unexpected lifecycle client checkpoint';end if;
 source:=replace(source,anchor,'(select private.can_staff_access_client(p_client_id,''clients.manage'') or private.can_routine_admit_client(p_client_id,p_event_kind))');
 execute source;

 source:=pg_get_functiondef('private.validate_client_transition()'::regprocedure);
 anchor:='(select private.has_recent_aal2(15))';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>2 then raise exception 'Unexpected lifecycle trigger AAL2 checkpoints';end if;
 source:=replace(source,anchor,'(select private.has_recent_aal2(15) or private.can_routine_admit_client(new.client_id,new.event_kind))');
 anchor:='(select private.can_staff_access_client(new.client_id, ''clients.manage''))';
 if position(anchor in source)=0 then raise exception 'Unexpected lifecycle trigger client checkpoint';end if;
 source:=replace(source,anchor,'(select private.can_staff_access_client(new.client_id,''clients.manage'') or private.can_routine_admit_client(new.client_id,new.event_kind))');
 execute source;

 source:=pg_get_functiondef('private.client_directory_snapshot(uuid,uuid,public.client_directory_purpose,integer,text,uuid,uuid)'::regprocedure);
 anchor:='p_purpose in (''case_center'',''core_daily'',''blood_glucose'',''service_usage'')';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>3 then raise exception 'Unexpected directory routine scope';end if;
 source:=replace(source,anchor,'p_purpose in (''case_center'',''core_daily'',''blood_glucose'',''service_usage'',''client_lifecycle'')');
 execute source;
end;$migration$;

create policy routine_completion_lifecycle_read on public.client_transitions for select to authenticated
using (private.has_routine_completion_access(organization_id,branch_id,'lifecycle.read',client_id));

create or replace function private.assert_care_roster_authority(p_org uuid,p_branch uuid,p_client uuid default null)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if private.has_routine_completion_access(p_org,p_branch,'roster.manage',p_client) then return;end if;
 if auth.uid() is null or not private.has_recent_aal2(15)
  or not private.has_permission(p_org,p_branch,'staff_scheduling.manage')
  or not private.has_permission(p_org,p_branch,'clients.view_all')
  or not private.has_permission(p_org,p_branch,'clients.read')
  or not exists(select 1 from public.organizations o join public.branches b on b.organization_id=o.id and b.is_active
   where o.id=p_org and o.is_active and b.id=p_branch)
  or (p_client is not null and (not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch)
   or not private.can_staff_access_client(p_client,'clients.read')))
 then raise exception using errcode='42501',message='daily allocation is not permitted';end if;
end;$$;
create or replace function private.care_roster_manager(p_org uuid,p_branch uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and (
  private.has_routine_completion_access(p_org,p_branch,'roster.manage',null)
  or (private.has_permission(p_org,p_branch,'staff_scheduling.manage') and private.has_permission(p_org,p_branch,'clients.view_all'))
  or (private.has_executive_read_permission(p_org,p_branch,'clients.view_all') and private.has_executive_read_permission(p_org,p_branch,'staff_scheduling.read')));
$$;

-- Evidence records the actual assurance level. No reauth event is invented.
alter table public.client_transitions add column auth_context jsonb;
alter table private.care_roster_versions add column auth_context jsonb;
create function private.capture_routine_completion_auth() returns trigger
language plpgsql security definer set search_path='' as $$
declare action text;
begin
 action:=case when tg_table_name='client_transitions' then 'admission.create' else 'roster.manage' end;
 if (tg_table_name<>'client_transitions' or to_jsonb(new)->>'event_kind'='admit')
  and private.has_routine_completion_access(new.organization_id,new.branch_id,action,new.client_id) then
  new.auth_context:=jsonb_build_object('policyVersion','approved-google-completion@1','method','google_oauth','action',action,
   'actorUserId',auth.uid(),'sessionId',auth.jwt()->>'session_id','assuranceLevel',auth.jwt()->>'aal','verifiedAt',clock_timestamp());
 else
  new.auth_context:=jsonb_build_object('method','legacy_recent_aal2','assuranceLevel',auth.jwt()->>'aal','sessionId',auth.jwt()->>'session_id');
 end if;
 return new;
end;$$;
-- Admission's validator supplies the scope before this alphabetically-later trigger.
create trigger zz_capture_completion_auth before insert on public.client_transitions for each row execute function private.capture_routine_completion_auth();
create trigger zz_capture_completion_auth before insert on private.care_roster_versions for each row execute function private.capture_routine_completion_auth();

revoke all on function private.has_routine_completion_access(uuid,uuid,text,uuid),public.has_routine_completion_access(uuid,uuid,text,uuid),
 private.can_routine_admit_client(uuid,public.client_transition_kind),private.capture_routine_completion_auth() from public,anon,authenticated,service_role;
grant execute on function private.has_routine_completion_access(uuid,uuid,text,uuid),public.has_routine_completion_access(uuid,uuid,text,uuid) to authenticated;
comment on function public.has_routine_completion_access(uuid,uuid,text,uuid) is 'Self-only live Google policy for admission, lifecycle read and supervisor roster; never recent AAL2 or clinical signing evidence.';
commit;
