begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A separate metadata-only reader for the nine governed questionnaire forms.
-- A chain is selected by its terminal version's assessment date, never by
-- the original version's date or the order in which revisions were saved.
create function private.questionnaire_assessment_date_lookup_guarded(
  p_org uuid, p_branch uuid, p_form_key text, p_client uuid, p_assessed_on date,
  p_before_created_at timestamptz default null,
  p_before_assessment_key uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_items jsonb;
  v_page jsonb;
  v_total integer;
  v_cursor_valid boolean;
  v_last jsonb;
  v_cursor jsonb;
begin
  if v_actor is null or p_client is null
    or not private.questionnaire_assessment_authority(p_org, p_branch, p_client, p_form_key, 'read') then
    raise exception using errcode = '42501', message = 'questionnaire date lookup is not permitted';
  end if;
  if p_assessed_on is null
    or p_assessed_on not between date '2000-01-01' and (clock_timestamp() at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023', message = 'invalid questionnaire assessment date';
  end if;
  if (p_before_created_at is null) <> (p_before_assessment_key is null) then
    raise exception using errcode = '22023', message = 'both assessment cursor fields are required';
  end if;

  -- The terminal predicate precedes the page limit. The existing date/scope
  -- and chain-version indexes serve the candidate and root lookups; the
  -- unique previous_version_id index identifies terminal rows efficiently.
  with matched as materialized (
    select root.assessment_key,
      root.created_at as assessment_created_at,
      terminal.id as version_id,
      terminal.version,
      terminal.assessed_on,
      terminal.created_at as saved_at,
      terminal.record_state
    from public.questionnaire_assessment_versions terminal
    join public.questionnaire_assessment_versions root
      on root.organization_id = terminal.organization_id
      and root.branch_id = terminal.branch_id
      and root.client_id = terminal.client_id
      and root.form_key = terminal.form_key
      and root.assessment_key = terminal.assessment_key
      and root.version = 1
    where terminal.organization_id = p_org
      and terminal.branch_id = p_branch
      and terminal.client_id = p_client
      and terminal.form_key = p_form_key
      and terminal.assessed_on = p_assessed_on
      and not exists (
        select 1 from public.questionnaire_assessment_versions child
        where child.previous_version_id = terminal.id
      )
  ), page as (
    select * from matched
    where p_before_created_at is null
      or (assessment_created_at, assessment_key) < (p_before_created_at, p_before_assessment_key)
    order by assessment_created_at desc, assessment_key desc
    limit 21
  )
  select coalesce((
      select jsonb_agg(jsonb_build_object(
        'assessmentKey', item.assessment_key,
        'versionId', item.version_id,
        'version', item.version,
        'assessedOn', item.assessed_on,
        'savedAt', item.saved_at,
        'recordState', item.record_state,
        'assessmentCreatedAt', item.assessment_created_at
      ) order by item.assessment_created_at desc, item.assessment_key desc)
      from page item
    ), '[]'::jsonb),
    (select count(*)::integer from matched),
    (p_before_created_at is null or exists (
      select 1 from matched cursor_row
      where cursor_row.assessment_key = p_before_assessment_key
        and cursor_row.assessment_created_at = p_before_created_at
    ))
    into v_items, v_total, v_cursor_valid;

  -- A cursor from another date, client, form or expired terminal is not a
  -- valid continuation even when its timestamp would otherwise sort here.
  if not v_cursor_valid then
    raise exception using errcode = '22023', message = 'assessment cursor no longer matches selected date';
  end if;

  v_page := v_items - 20;
  if jsonb_array_length(v_items) > 20 then
    v_last := v_page -> 19;
    v_cursor := jsonb_build_object(
      'createdAt', v_last ->> 'assessmentCreatedAt',
      'assessmentKey', v_last ->> 'assessmentKey'
    );
  else
    v_cursor := null;
  end if;

  insert into public.audit_events(
    organization_id, branch_id, actor_user_id, action, table_name,
    row_pk, changed_fields, metadata
  ) values (
    p_org, p_branch, v_actor, 'select', 'questionnaire_assessment_versions',
    'assessment-date-lookup', array[]::text[], jsonb_build_object(
      'workflow', 'questionnaire_assessment_date_lookup_v1',
      'row_count', jsonb_array_length(v_page),
      'answers_excluded', true
    )
  );

  if auth.uid() is distinct from v_actor
    or not private.questionnaire_assessment_authority(p_org, p_branch, p_client, p_form_key, 'read') then
    raise exception using errcode = '42501', message = 'questionnaire date lookup authority changed';
  end if;
  return jsonb_build_object(
    'formKey', p_form_key,
    'clientId', p_client,
    'assessedOn', p_assessed_on,
    'assessments', v_page,
    'total', v_total,
    'nextCursor', v_cursor
  );
end;
$$;

create function public.questionnaire_assessment_date_lookup(
  p_expected_organization_id uuid, p_expected_branch_id uuid, p_form_key text,
  p_client_id uuid, p_assessed_on date,
  p_before_created_at timestamptz default null,
  p_before_assessment_key uuid default null
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.questionnaire_assessment_date_lookup_guarded(
    p_expected_organization_id, p_expected_branch_id, p_form_key,
    p_client_id, p_assessed_on, p_before_created_at, p_before_assessment_key
  );
$$;

alter function private.questionnaire_assessment_date_lookup_guarded(uuid, uuid, text, uuid, date, timestamptz, uuid) owner to postgres;
alter function public.questionnaire_assessment_date_lookup(uuid, uuid, text, uuid, date, timestamptz, uuid) owner to postgres;
revoke all on function private.questionnaire_assessment_date_lookup_guarded(uuid, uuid, text, uuid, date, timestamptz, uuid),
  public.questionnaire_assessment_date_lookup(uuid, uuid, text, uuid, date, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.questionnaire_assessment_date_lookup_guarded(uuid, uuid, text, uuid, date, timestamptz, uuid),
  public.questionnaire_assessment_date_lookup(uuid, uuid, text, uuid, date, timestamptz, uuid)
  to authenticated;

commit;
