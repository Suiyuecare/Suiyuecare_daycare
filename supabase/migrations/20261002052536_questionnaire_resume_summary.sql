begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- One selected client, at most nine authorized forms, and no answer-bearing
-- payload. The assessment's date is not its save order: revisions and separate
-- assessment chains are ordered by the server-created version timestamp.
create index questionnaire_resume_client_saved_idx
  on public.questionnaire_assessment_versions
    (organization_id, branch_id, client_id, form_key, created_at desc, id desc)
  where record_state = 'draft';

create function private.questionnaire_resume_summary_guarded(
  p_org uuid, p_branch uuid, p_client uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_allowed_forms text[];
  v_allowed_after text[];
  v_forms jsonb;
begin
  if v_actor is null or p_org is null or p_branch is null or p_client is null
    or not exists (
      select 1 from public.clients c
      where c.id = p_client and c.organization_id = p_org and c.branch_id = p_branch
        and c.status in ('active', 'suspended')
    ) then
    raise exception using errcode = '42501', message = 'questionnaire resume summary is not permitted';
  end if;

  select array_agg(f.form_key order by f.position) into v_allowed_forms
  from (values
    (1, 'spmsq'), (2, 'gds_15'), (3, 'fall_risk_taipei_115'),
    (4, 'nsi_determine'), (5, 'barthel_adl'), (6, 'lawton_iadl'),
    (7, 'eat10_swallowing'), (8, 'bsrs5'), (9, 'mna_sf')
  ) as f(position, form_key)
  where private.questionnaire_assessment_authority(p_org, p_branch, p_client, f.form_key, 'read') is true;
  if v_allowed_forms is null then
    raise exception using errcode = '42501', message = 'questionnaire resume summary is not permitted';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'formKey', f.form_key,
    'latest', case when v.id is null then 'null'::jsonb else jsonb_build_object(
      'assessmentKey', v.assessment_key,
      'versionId', v.id,
      'version', v.version,
      'assessedOn', v.assessed_on,
      'savedAt', v.created_at,
      'recordState', v.record_state
    ) end
  ) order by f.position), '[]'::jsonb) into v_forms
  from pg_catalog.unnest(v_allowed_forms) with ordinality as f(form_key, position)
  left join lateral (
    select r.id, r.assessment_key, r.version, r.assessed_on, r.created_at,
      r.record_state
    from public.questionnaire_assessment_versions r
    where r.organization_id = p_org and r.branch_id = p_branch
      and r.client_id = p_client and r.form_key = f.form_key
      and r.record_state = 'draft'
      and not exists (
        select 1 from public.questionnaire_assessment_versions child
        where child.previous_version_id = r.id
      )
    order by r.created_at desc, r.id desc
    limit 1
  ) v on true;

  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_org, p_branch, v_actor, 'select', 'questionnaire_assessment_versions',
    'resume-summary', array[]::text[], jsonb_build_object(
      'workflow', 'questionnaire_resume_summary_v1',
      'form_count', jsonb_array_length(v_forms),
      'answers_excluded', true
    )
  );

  -- Audit can wait on a concurrent transaction. If the actor, membership,
  -- client assignment, branch or any form permission changed, discard the
  -- entire read instead of returning a partial or stale-authority result.
  if auth.uid() is distinct from v_actor or not exists (
    select 1 from public.clients c
    where c.id = p_client and c.organization_id = p_org and c.branch_id = p_branch
      and c.status in ('active', 'suspended')
  ) then
    raise exception using errcode = '42501', message = 'questionnaire resume summary authority changed';
  end if;
  select array_agg(f.form_key order by f.position) into v_allowed_after
  from (values
    (1, 'spmsq'), (2, 'gds_15'), (3, 'fall_risk_taipei_115'),
    (4, 'nsi_determine'), (5, 'barthel_adl'), (6, 'lawton_iadl'),
    (7, 'eat10_swallowing'), (8, 'bsrs5'), (9, 'mna_sf')
  ) as f(position, form_key)
  where private.questionnaire_assessment_authority(p_org, p_branch, p_client, f.form_key, 'read') is true;
  if v_allowed_after is distinct from v_allowed_forms then
    raise exception using errcode = '42501', message = 'questionnaire resume summary authority changed';
  end if;
  return jsonb_build_object(
    'clientId', p_client,
    'generatedAt', clock_timestamp(),
    'forms', v_forms
  );
end;
$$;

create function public.questionnaire_resume_summary(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.questionnaire_resume_summary_guarded(
    p_expected_organization_id, p_expected_branch_id, p_client_id
  );
$$;

alter function private.questionnaire_resume_summary_guarded(uuid, uuid, uuid) owner to postgres;
alter function public.questionnaire_resume_summary(uuid, uuid, uuid) owner to postgres;
revoke all on function private.questionnaire_resume_summary_guarded(uuid, uuid, uuid),
  public.questionnaire_resume_summary(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.questionnaire_resume_summary_guarded(uuid, uuid, uuid),
  public.questionnaire_resume_summary(uuid, uuid, uuid) to authenticated;

commit;
