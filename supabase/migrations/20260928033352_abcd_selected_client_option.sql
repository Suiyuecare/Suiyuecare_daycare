-- Keep the original bounded client list, but include an explicitly selected and
-- independently authorized client even when that client falls beyond row 200.
-- The original snapshot still performs its full authority check and audit first.
create or replace function private.abcd_assessment_snapshot_with_selected_client(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_assessment_year integer default null,
  p_assessment_type text default null, p_reassessment_state text default null,
  p_assessment_state text default null, p_query text default null
) returns table(organization_id uuid, branch_id uuid, generated_at timestamptz,
  assessments jsonb, matching_total bigint, assessments_truncated boolean,
  assessment_total bigint, a_total bigint, b_total bigint, c_total bigint,
  d_total bigint, reassessment_missing_total bigint, draft_total bigint,
  signed_total bigint, clients jsonb, client_total bigint, clients_truncated boolean,
  years jsonb, year_total bigint, years_truncated boolean, form_kind text,
  formal_rule_status text, attachment_status text, notification_status text,
  export_status text, offline_status text)
language sql volatile security definer set search_path = '' as $$
  with original as materialized (
    select * from private.abcd_assessment_snapshot_response(
      p_expected_organization_id,p_expected_branch_id,p_client_id,p_assessment_year,
      p_assessment_type,p_reassessment_state,p_assessment_state,p_query)
  ), bounded_options as (
    select (item.value->>'client_id')::uuid as id,
      item.value->>'display_name' as display_name
    from original snapshot cross join lateral jsonb_array_elements(snapshot.clients) item
  ), client_options as (
    select option.id,option.display_name from bounded_options option
    union all
    select client.id,client.display_name from public.clients client
    where p_client_id is not null and client.id=p_client_id
      and client.organization_id=p_expected_organization_id
      and client.branch_id=p_expected_branch_id
      and private.abcd_assessment_client_authority(
        p_expected_organization_id,p_expected_branch_id,client.id,'abcd_assessments.read')
      and not exists (select 1 from bounded_options option where option.id=client.id)
  ), merged_options as (
    select coalesce(jsonb_agg(jsonb_build_object('client_id',option.id,
      'display_name',option.display_name) order by option.display_name,option.id),'[]'::jsonb) as clients,
      count(*) as option_count
    from client_options option
  )
  select snapshot.organization_id,snapshot.branch_id,snapshot.generated_at,
    snapshot.assessments,snapshot.matching_total,snapshot.assessments_truncated,
    snapshot.assessment_total,snapshot.a_total,snapshot.b_total,snapshot.c_total,
    snapshot.d_total,snapshot.reassessment_missing_total,snapshot.draft_total,
    snapshot.signed_total,merged.clients,snapshot.client_total,
    snapshot.client_total>merged.option_count,snapshot.years,snapshot.year_total,
    snapshot.years_truncated,snapshot.form_kind,snapshot.formal_rule_status,
    snapshot.attachment_status,snapshot.notification_status,snapshot.export_status,
    snapshot.offline_status
  from original snapshot cross join merged_options merged;
$$;

create or replace function public.abcd_assessment_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_client_id uuid default null, p_assessment_year integer default null,
  p_assessment_type text default null, p_reassessment_state text default null,
  p_assessment_state text default null, p_query text default null
) returns table(organization_id uuid, branch_id uuid, generated_at timestamptz,
  assessments jsonb, matching_total bigint, assessments_truncated boolean,
  assessment_total bigint, a_total bigint, b_total bigint, c_total bigint,
  d_total bigint, reassessment_missing_total bigint, draft_total bigint,
  signed_total bigint, clients jsonb, client_total bigint, clients_truncated boolean,
  years jsonb, year_total bigint, years_truncated boolean, form_kind text,
  formal_rule_status text, attachment_status text, notification_status text,
  export_status text, offline_status text)
language sql volatile security invoker set search_path = '' as $$
  select * from private.abcd_assessment_snapshot_with_selected_client(
    p_expected_organization_id,p_expected_branch_id,p_client_id,p_assessment_year,
    p_assessment_type,p_reassessment_state,p_assessment_state,p_query);
$$;

revoke all on function private.abcd_assessment_snapshot_with_selected_client(uuid,uuid,uuid,integer,text,text,text,text)
  from public,anon,service_role;
grant execute on function private.abcd_assessment_snapshot_with_selected_client(uuid,uuid,uuid,integer,text,text,text,text)
  to authenticated;
revoke all on function public.abcd_assessment_snapshot(uuid,uuid,uuid,integer,text,text,text,text)
  from public,anon,service_role;
grant execute on function public.abcd_assessment_snapshot(uuid,uuid,uuid,integer,text,text,text,text)
  to authenticated;
