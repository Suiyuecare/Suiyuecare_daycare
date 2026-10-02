-- Match the product's explicitly approved Google AAL1 draft/read policy.
-- The existing signed/corrected path still requires same-session recent AAL2.
begin;
set local lock_timeout='5s';

create or replace function private.abcd_assessment_current_authority(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(auth.uid() is not null
    and p_permission in ('abcd_assessments.read','abcd_assessments.manage')
    and exists (select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in ('staff','professional') and profile.is_active)
    and exists (select 1 from public.branches branch where branch.id=p_expected_branch_id
      and branch.organization_id=p_expected_organization_id and branch.is_active)
    and ((coalesce(auth.jwt()->>'aal','')='aal2'
      and private.has_permission(p_expected_organization_id,p_expected_branch_id,p_permission))
      or private.has_routine_intake_permission(p_expected_organization_id,
        p_expected_branch_id,p_permission)),false);
$$;

create or replace function private.abcd_assessment_client_authority(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_client_id uuid,p_permission text
) returns boolean language sql volatile security definer set search_path='' as $$
  select private.abcd_assessment_current_authority(
      p_expected_organization_id,p_expected_branch_id,p_permission)
    and exists (select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id)
    and ((private.can_staff_access_client(p_client_id,'clients.read')
      and private.can_staff_access_client(p_client_id,p_permission))
      or private.has_routine_intake_access(p_expected_organization_id,
        p_expected_branch_id,case when p_permission='abcd_assessments.manage'
          then 'abcd.save' else 'abcd.read' end,p_client_id));
$$;

create function private.abcd_assessment_visible_client(p_client_id uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce(p_permission in ('clients.read','abcd_assessments.read')
    and (private.can_staff_access_client(p_client_id,p_permission)
      or private.can_routine_intake_access_client(p_client_id,p_permission)),false);
$$;

create or replace function private.abcd_assessment_snapshot_response(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_client_id uuid default null,p_assessment_year integer default null,
  p_assessment_type text default null,p_reassessment_state text default null,
  p_assessment_state text default null,p_query text default null
) returns table(organization_id uuid,branch_id uuid,generated_at timestamptz,
  assessments jsonb,matching_total bigint,assessments_truncated boolean,
  assessment_total bigint,a_total bigint,b_total bigint,c_total bigint,
  d_total bigint,reassessment_missing_total bigint,draft_total bigint,
  signed_total bigint,clients jsonb,client_total bigint,clients_truncated boolean,
  years jsonb,year_total bigint,years_truncated boolean,form_kind text,
  formal_rule_status text,attachment_status text,notification_status text,
  export_status text,offline_status text)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();
begin
  if not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.read')
    or (p_client_id is not null and not private.abcd_assessment_client_authority(
      p_expected_organization_id,p_expected_branch_id,p_client_id,'abcd_assessments.read'))
    or (p_assessment_year is not null and p_assessment_year not between 2000 and 2200)
    or (p_assessment_type is not null and p_assessment_type not in ('A','B','C','D'))
    or (p_reassessment_state is not null and p_reassessment_state not in ('recorded','missing','not_applicable'))
    or (p_assessment_state is not null and p_assessment_state not in ('draft','signed','corrected'))
    or (p_query is not null and (char_length(btrim(p_query)) not between 1 and 120
      or btrim(p_query) ~ '[[:cntrl:]]')) then
    raise exception using errcode='42501',message='ABCD assessment snapshot is not permitted';
  end if;
  return query
  with current_assessments as (
    select row.* from public.abcd_assessment_versions row
    where row.organization_id=p_expected_organization_id and row.branch_id=p_expected_branch_id
      and private.abcd_assessment_visible_client(row.client_id,'clients.read')
      and private.abcd_assessment_visible_client(row.client_id,'abcd_assessments.read')
      and not exists (select 1 from public.abcd_assessment_versions child
        where child.previous_version_id=row.id)
  ), matching as (
    select row.* from current_assessments row join public.clients client on client.id=row.client_id
    where (p_client_id is null or row.client_id=p_client_id)
      and (p_assessment_year is null or row.assessment_year=p_assessment_year)
      and (p_assessment_type is null or row.assessment_type=p_assessment_type)
      and (p_reassessment_state is null or row.reassessment_state=p_reassessment_state)
      and (p_assessment_state is null or row.assessment_state=p_assessment_state)
      and (p_query is null or client.display_name ilike '%'||btrim(p_query)||'%'
        or row.assessment_key::text ilike '%'||btrim(p_query)||'%')
  ), page as (
    select row.* from matching row
    order by row.assessment_date desc,row.client_id,row.assessment_type,row.assessment_key limit 200
  ), client_options as (
    select client.id,client.display_name from public.clients client
    where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
      and private.abcd_assessment_visible_client(client.id,'clients.read')
      and private.abcd_assessment_visible_client(client.id,'abcd_assessments.read')
    order by client.display_name,client.id limit 200
  ), year_options as (
    select distinct row.assessment_year from current_assessments row
    order by row.assessment_year desc limit 200
  )
  select p_expected_organization_id,p_expected_branch_id,v_now,
    coalesce((select jsonb_agg(
      private.abcd_assessment_version_json(row,client.display_name)||jsonb_build_object(
        'history',coalesce((select jsonb_agg(
          private.abcd_assessment_version_json(history,client.display_name)
          order by history.version)
          from (select item.* from public.abcd_assessment_versions item
            where item.organization_id=row.organization_id and item.branch_id=row.branch_id
              and item.client_id=row.client_id and item.assessment_key=row.assessment_key
            order by item.version limit 50) history),'[]'::jsonb),
        'history_total',(select count(*) from public.abcd_assessment_versions history
          where history.organization_id=row.organization_id and history.branch_id=row.branch_id
            and history.client_id=row.client_id and history.assessment_key=row.assessment_key)
      ) order by row.assessment_date desc,row.client_id,row.assessment_type,row.assessment_key)
      from page row join public.clients client on client.id=row.client_id),'[]'::jsonb),
    (select count(*) from matching),(select count(*) from matching)>200,
    (select count(*) from matching),(select count(*) from matching row where row.assessment_type='A'),
    (select count(*) from matching row where row.assessment_type='B'),
    (select count(*) from matching row where row.assessment_type='C'),
    (select count(*) from matching row where row.assessment_type='D'),
    (select count(*) from matching row where row.reassessment_state='missing'),
    (select count(*) from matching row where row.assessment_state='draft'),
    (select count(*) from matching row where row.assessment_state in ('signed','corrected')),
    coalesce((select jsonb_agg(jsonb_build_object('client_id',option.id,
      'display_name',option.display_name) order by option.display_name,option.id)
      from client_options option),'[]'::jsonb),
    (select count(*) from public.clients client
      where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
        and private.abcd_assessment_visible_client(client.id,'clients.read')
        and private.abcd_assessment_visible_client(client.id,'abcd_assessments.read')),
    (select count(*) from public.clients client
      where client.organization_id=p_expected_organization_id and client.branch_id=p_expected_branch_id
        and private.abcd_assessment_visible_client(client.id,'clients.read')
        and private.abcd_assessment_visible_client(client.id,'abcd_assessments.read'))>200,
    coalesce((select jsonb_agg(option.assessment_year order by option.assessment_year desc)
      from year_options option),'[]'::jsonb),
    (select count(distinct row.assessment_year) from current_assessments row),
    (select count(distinct row.assessment_year) from current_assessments row)>200,
    'manual_unstandardized','not_configured','not_configured','not_configured',
    'not_configured','not_configured';
  insert into public.audit_events (organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values (
      p_expected_organization_id,p_expected_branch_id,v_actor,'select',
      'abcd_assessment_versions','snapshot',array[]::text[],jsonb_build_object(
        'workflow','page21_abcd_manual_candidate_snapshot_v1','filters_logged',false,
        'narrative_logged',false,'formal_rule_status','not_configured'));
  if not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.read') then
    raise exception using errcode='42501',message='ABCD assessment snapshot authority expired';
  end if;
end;$$;

revoke all on function private.abcd_assessment_visible_client(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.abcd_assessment_current_authority(uuid,uuid,text),
  private.abcd_assessment_client_authority(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text)
  from public,anon,service_role;
grant execute on function private.abcd_assessment_snapshot_response(uuid,uuid,uuid,integer,text,text,text,text)
  to authenticated;
commit;
