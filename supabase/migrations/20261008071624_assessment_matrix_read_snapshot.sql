-- Read-only, cross-client monthly view of the nine governed questionnaire drafts.
-- This does not certify completion, signing, scoring, or an official due date.
-- No direct table grant is added: the invoker RPC delegates to a guarded function
-- that rechecks the current admission, branch, form permission and assignment.

create function private.assessment_matrix_snapshot_guarded(
  p_org uuid, p_branch uuid, p_month date,
  p_page integer default 1, p_page_size integer default 20
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_forms text[];
  v_result jsonb;
  v_today_month date := date_trunc('month', clock_timestamp() at time zone 'Asia/Taipei')::date;
begin
  if p_org is null or p_branch is null or p_month is null
    or p_month <> date_trunc('month', p_month)::date
    or p_month < date '2000-01-01' or p_month > v_today_month
    or p_page is null or p_page not between 1 and 10000
    or p_page_size is null or p_page_size not between 1 and 25 then
    raise exception using errcode = '22023', message = 'invalid assessment matrix filters';
  end if;

  -- The existing authority function checks live Google admission, active
  -- membership, organization/branch, clients.read and each form's read scope.
  select array_agg(form_key order by ordinal) into v_forms
  from (values
    ('spmsq',1), ('gds_15',2), ('fall_risk_taipei_115',3),
    ('nsi_determine',4), ('barthel_adl',5), ('lawton_iadl',6),
    ('eat10_swallowing',7), ('bsrs5',8), ('mna_sf',9)
  ) as f(form_key,ordinal)
  where private.questionnaire_assessment_authority(p_org,p_branch,null,f.form_key,'read');

  if coalesce(array_length(v_forms,1),0) = 0 then
    raise exception using errcode = '42501', message = 'assessment matrix is not permitted';
  end if;

  -- The form authorization above has no client argument; the roster below
  -- narrows it to clients.view_all or a currently assigned client. Every
  -- candidate version is joined to this same paged roster and allowed forms.
  with visible_clients as materialized (
    select c.id, c.client_code, c.display_name, c.status
    from public.clients c
    where c.organization_id = p_org and c.branch_id = p_branch
      and c.status in ('active','suspended')
      and (private.questionnaire_assessment_permission(p_org,p_branch,'clients.view_all')
        or exists (
          select 1 from public.client_assignments a
          where a.organization_id = p_org and a.branch_id = p_branch
            and a.client_id = c.id and a.assignee_user_id = auth.uid()
            and a.starts_at <= clock_timestamp()
            and (a.ends_at is null or a.ends_at > clock_timestamp())
        ))
  ), paged_clients as materialized (
    select c.* from visible_clients c
    order by c.client_code collate "C", c.id
    limit p_page_size offset (p_page - 1) * p_page_size
  ), latest_versions as materialized (
    select distinct on (v.client_id,v.form_key)
      v.client_id,v.form_key,v.id,v.version,v.assessed_on
    from public.questionnaire_assessment_versions v
    join paged_clients c on c.id = v.client_id
    where v.organization_id = p_org and v.branch_id = p_branch
      and v.form_key = any(v_forms) and v.record_state = 'draft'
      and v.assessed_on >= p_month
      and v.assessed_on < (p_month + interval '1 month')::date
    order by v.client_id,v.form_key,v.assessed_on desc,
      v.created_at desc,v.version desc,v.id desc
  )
  select jsonb_build_object(
    'month',to_char(p_month,'YYYY-MM'),
    'generatedAt',clock_timestamp(),
    'page',p_page,'pageSize',p_page_size,
    'totalClients',(select count(*) from visible_clients),
    'forms',to_jsonb(v_forms),
    'clients',coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId',c.id,'clientCode',c.client_code,
        'displayName',c.display_name,'serviceStatus',c.status,
        'cells',(
          select jsonb_object_agg(f.form_key,coalesce((
            select jsonb_build_object('state','draft','versionId',v.id,
              'version',v.version,'assessedOn',v.assessed_on)
            from latest_versions v
            where v.client_id = c.id and v.form_key = f.form_key
          ),'{"state":"none"}'::jsonb))
          from unnest(v_forms) as f(form_key)
        )
      ) order by c.client_code collate "C", c.id)
      from paged_clients c
    ),'[]'::jsonb)
  ) into v_result;

  insert into public.audit_events(
    organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata
  ) values (
    p_org,p_branch,auth.uid(),'select','questionnaire_assessment_versions',
    'assessment_matrix',array[]::text[],
    jsonb_build_object('workflow','assessment_matrix_snapshot_v1',
      'month',to_char(p_month,'YYYY-MM'),'page',p_page,
      'visible_rows',jsonb_array_length(v_result->'clients'),
      'form_count',array_length(v_forms,1),'answers_excluded',true)
  );
  return v_result;
end;
$$;

create function public.assessment_matrix_snapshot(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_month date, p_page integer default 1, p_page_size integer default 20
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.assessment_matrix_snapshot_guarded(
    p_expected_organization_id,p_expected_branch_id,p_month,p_page,p_page_size
  );
$$;

revoke all on function private.assessment_matrix_snapshot_guarded(uuid,uuid,date,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer)
  from public,anon,service_role;
grant execute on function private.assessment_matrix_snapshot_guarded(uuid,uuid,date,integer,integer),
  public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer) to authenticated;

comment on function public.assessment_matrix_snapshot(uuid,uuid,date,integer,integer) is
  'Read-only monthly questionnaire draft matrix, limited to currently authorized assigned clients and form scopes. No official completion or due-date assertion.';
