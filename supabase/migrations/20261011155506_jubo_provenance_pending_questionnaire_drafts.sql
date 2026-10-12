begin;
set local lock_timeout='5s';

-- Intake preparation only: an approved manager can fill questionnaires for a
-- source-bound JUBO pending master. This is never clinical/formal admission.
create function private.jubo_pending_questionnaire_scope(p_org uuid,p_branch uuid,p_client uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(public.is_staff_login_allowed() and exists(
  select 1 from public.clients c join public.branches b on b.id=c.branch_id and b.organization_id=c.organization_id
   join public.organizations o on o.id=c.organization_id
  where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch
   and c.status='pending' and c.source_system='jubo' and c.admitted_on is null and c.ended_on is null
   and b.is_active and o.is_active
   and exists(select 1 from public.profiles p join public.memberships m on m.profile_id=p.id
    join public.membership_roles mr on mr.membership_id=m.id
    join public.roles r on r.id=mr.role_id
    where p.id=auth.uid() and p.is_active and p.kind in ('staff','professional')
     and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
     and m.status='active' and m.starts_at<=clock_timestamp()
     and (m.ends_at is null or m.ends_at>clock_timestamp())
     and mr.assigned_at<=clock_timestamp() and r.is_active and r.is_system
     and r.role_key in ('organization_manager','branch_supervisor','branch_director'))
   and (exists(select 1 from private.jubo_public_pending_links l
      join private.jubo_intake_profile_sources s on s.promotion_link_id=l.id
      where l.client_id=c.id and l.organization_id=p_org and l.branch_id=p_branch
       and s.organization_id=p_org and s.branch_id=p_branch)
    or exists(select 1 from private.jubo_operator_master_links l
      join private.jubo_operator_imports op on op.id=l.operation_id
       and op.organization_id=l.organization_id and op.branch_id=l.branch_id
      where l.client_id=c.id and l.organization_id=p_org and l.branch_id=p_branch
       and op.execution_mode='database_operator'
       and op.authorization_reference='direct-owner-authorization:20261011:23-master-17-reconcile'
       and op.dataset_sha256='21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da'))
 ),false);
$$;
revoke all on function private.jubo_pending_questionnaire_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Reuse the existing admission/permissions/assignment checks without changing
-- another clinical or operational table's pending-client prohibition.
create function private.guard_jubo_pending_questionnaire_draft() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare target uuid;
begin
 target:=case when tg_op='DELETE' then old.client_id else new.client_id end;
 if exists(select 1 from public.clients where id=target and status='pending') then
  if tg_op='INSERT' and new.record_state='draft' and new.author_user_id=auth.uid()
    and private.jubo_pending_questionnaire_scope(new.organization_id,new.branch_id,new.client_id)
    and private.questionnaire_assessment_authority(new.organization_id,new.branch_id,new.client_id,new.form_key,'manage') then
   return new;
  end if;
  raise exception using errcode='42501',message='JUBO_PENDING_QUESTIONNAIRE_DRAFT_ONLY';
 end if;
 if tg_op='UPDATE' and old.client_id is distinct from new.client_id
   and exists(select 1 from public.clients where id=old.client_id and status='pending') then
  raise exception using errcode='42501',message='JUBO_PENDING_QUESTIONNAIRE_DRAFT_ONLY';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end;
$$;
revoke all on function private.guard_jubo_pending_questionnaire_draft() from public,anon,authenticated,service_role;
drop trigger jubo_pending_client_no_activity on public.questionnaire_assessment_versions;
create trigger jubo_pending_client_no_activity before insert or update or delete on public.questionnaire_assessment_versions
for each row execute function private.guard_jubo_pending_questionnaire_draft();

do $extend$ declare definition text; signature text; anchor text; replacement text; begin
 foreach signature in array array[
  'private.questionnaire_assessment_snapshot_guarded(uuid,uuid,text,uuid)',
  'private.assessment_matrix_snapshot_guarded(uuid,uuid,date,integer,integer)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  anchor:='and c.status in (''active'',''suspended'')';
  replacement:='and (c.status in (''active'',''suspended'') or private.jubo_pending_questionnaire_scope(p_org,p_branch,c.id))';
  if position(anchor in definition)=0 then raise exception 'unexpected questionnaire roster definition'; end if;
  execute replace(definition,anchor,replacement);
 end loop;
 definition:=pg_get_functiondef('private.questionnaire_sign_authority(uuid,uuid,uuid,text)'::regprocedure);
 anchor:='select private.questionnaire_assessment_authority';
 if position(anchor in definition)=0 then raise exception 'unexpected questionnaire sign definition'; end if;
 execute replace(definition,anchor,'select not exists(select 1 from public.clients where id=p_client and status=''pending'') and private.questionnaire_assessment_authority');
 definition:=pg_get_functiondef('private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)'::regprocedure);
 anchor:='-- Serialize operation replay first';
 if position(anchor in definition)=0 then raise exception 'unexpected questionnaire mutation definition'; end if;
 replacement:=$guard$
 if exists(select 1 from public.clients where id=client and status='pending')
  and (action not in ('create','revise') or not private.jubo_pending_questionnaire_scope(p_expected_organization_id,p_expected_branch_id,client)) then
  raise exception using errcode='42501',message='JUBO_PENDING_QUESTIONNAIRE_DRAFT_ONLY'; end if;
 -- Serialize operation replay first$guard$;
 execute replace(definition,anchor,replacement);
end $extend$;
commit;
