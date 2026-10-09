-- Candidate only. Permit five existing append-only candidate assessments for
-- reviewed JUBO public pending clients. All other client-linked operations
-- remain blocked; the formal signing RPCs and rule publication stay disabled.
begin;
set local lock_timeout = '5s';

alter table public.spmsq_assessment_versions
  drop constraint spmsq_assessment_service_status_check,
  add constraint spmsq_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.gds_assessment_versions
  drop constraint gds_assessment_service_status_check,
  add constraint gds_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.fall_risk_assessment_versions
  drop constraint fall_risk_assessment_service_status_check,
  add constraint fall_risk_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.nsi_nutrition_screening_versions
  drop constraint nsi_nutrition_screening_service_status_check,
  add constraint nsi_nutrition_screening_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));
alter table public.chewing_assessment_versions
  drop constraint chewing_assessment_service_status_check,
  add constraint chewing_assessment_service_status_check check (
    service_status_at_assessment in
      ('pending','active','suspended','transferred','closed','deceased'));

-- Replace the broad pending-client deny trigger on only these five tables.
-- Its replacement keeps the same deny path for UPDATE/DELETE and for all
-- non-draft states. The original function and every other table's trigger
-- remain unchanged.
create function private.guard_jubo_pending_assessment_draft() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_client public.clients%rowtype; v_client_id uuid;
begin
  if tg_op='DELETE' then v_client_id:=old.client_id;
  else v_client_id:=new.client_id; end if;
  select * into v_client from public.clients where id=v_client_id;
  if v_client.id is not null and v_client.status='pending' then
    if tg_op='INSERT' and tg_table_schema='public' and tg_table_name=any(array[
      'spmsq_assessment_versions','gds_assessment_versions',
      'fall_risk_assessment_versions','nsi_nutrition_screening_versions',
      'chewing_assessment_versions'])
      and v_client.source_system='jubo'
      and v_client.admitted_on is null and v_client.ended_on is null
      and new.organization_id=v_client.organization_id
      and new.branch_id=v_client.branch_id
      and new.record_state='draft_preview'
      and new.governance_status='candidate_unactivated'
      and new.service_status_at_assessment='pending'
      and new.author_user_id=auth.uid()
      and exists(select 1 from private.jubo_public_pending_links link
        join private.jubo_intake_profile_sources source_profile
          on source_profile.promotion_link_id=link.id
        where link.client_id=v_client.id
          and link.organization_id=v_client.organization_id
          and link.branch_id=v_client.branch_id) then
      return new;
    end if;
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='UPDATE' and old.client_id is distinct from new.client_id
    and exists(select 1 from public.clients previous_client
      where previous_client.id=old.client_id and previous_client.status='pending') then
    raise exception using errcode='23514',message='JUBO_PENDING_CLIENT_OPERATION_DENIED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
alter function private.guard_jubo_pending_assessment_draft() owner to postgres;
revoke all on function private.guard_jubo_pending_assessment_draft()
  from public,anon,authenticated,service_role;

do $drafts$ declare v_table text; begin
  foreach v_table in array array[
    'spmsq_assessment_versions','gds_assessment_versions',
    'fall_risk_assessment_versions','nsi_nutrition_screening_versions',
    'chewing_assessment_versions'] loop
    execute format('drop trigger jubo_pending_client_no_activity on public.%I',v_table);
    execute format('create trigger jubo_pending_client_no_activity before insert or update or delete on public.%I for each row execute function private.guard_jubo_pending_assessment_draft()',v_table);
  end loop;
end $drafts$;
comment on function private.guard_jubo_pending_assessment_draft() is
  'Candidate-only exact five-table draft_preview exception for reviewed JUBO pending clients; no signed or operational records.';
commit;
