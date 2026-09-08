-- Page 82 formal read boundary. One audited RPC returns only the fields the
-- form publication workspace renders. Immutable AAL2, request/approval
-- hashes, and persisted idempotency evidence never cross the database
-- boundary. The published version content hash remains a rendered identity.

create or replace function private.form_governance_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  definitions jsonb,
  versions jsonb,
  publications jsonb,
  definition_total bigint,
  version_total bigint,
  publication_total bigint,
  pending_total bigint,
  definitions_truncated boolean,
  versions_truncated boolean,
  publications_truncated boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_definitions jsonb;
  v_versions jsonb;
  v_publications jsonb;
  v_definition_total bigint;
  v_version_total bigint;
  v_publication_total bigint;
  v_pending_total bigint;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       null,
       'forms.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'forms.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'form governance snapshot is not permitted in the selected tenant context';
  end if;

  select count(*)::bigint into v_definition_total
  from public.form_definitions definition
  where definition.organization_id is null
     or definition.organization_id = p_expected_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', definition.id,
    'organization_id', definition.organization_id,
    'form_key', definition.form_key,
    'name', definition.name,
    'category', definition.category,
    'is_official', definition.is_official
  ) order by definition.name collate "C", definition.form_key, definition.id), '[]'::jsonb)
    into v_definitions
  from (
    select definition.*
    from public.form_definitions definition
    where definition.organization_id is null
       or definition.organization_id = p_expected_organization_id
    order by definition.name collate "C", definition.form_key, definition.id
    limit 1000
  ) definition;

  select count(*)::bigint into v_version_total
  from public.form_versions version
  join public.form_definitions definition
    on definition.id = version.form_definition_id
  where definition.organization_id is null
     or definition.organization_id = p_expected_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', version_row.id,
    'form_definition_id', version_row.form_definition_id,
    'version', version_row.version,
    'status', version_row.status,
    'effective_from', version_row.effective_from,
    'effective_to', version_row.effective_to,
    'schema_field_count', version_row.schema_field_count,
    'scoring_rule_count', version_row.scoring_rule_count,
    'published_at', version_row.published_at,
    'content_hash', version_row.content_hash
  ) order by version_row.definition_sort_name collate "C", version_row.form_definition_id, version_row.version desc, version_row.id), '[]'::jsonb)
    into v_versions
  from (
    select
      version.id,
      version.form_definition_id,
      version.version,
      version.status,
      version.effective_from,
      version.effective_to,
      case
        when jsonb_typeof(version.schema_json -> 'fields') = 'array'
          then jsonb_array_length(version.schema_json -> 'fields')
        else (
          select count(*)::integer
          from jsonb_object_keys(version.schema_json)
        )
      end as schema_field_count,
      (
        select count(*)::integer
        from jsonb_object_keys(version.scoring_json)
      ) as scoring_rule_count,
      version.published_at,
      version.content_hash,
      definition.name as definition_sort_name
    from public.form_versions version
    join public.form_definitions definition
      on definition.id = version.form_definition_id
    where definition.id in (
      select (item ->> 'id')::uuid
      from jsonb_array_elements(v_definitions) item
    )
    order by definition.name collate "C", version.form_definition_id,
      version.version desc, version.id
    limit 5000
  ) version_row;

  select
    count(*)::bigint,
    count(*) filter (where request.status = 'pending')::bigint
    into v_publication_total, v_pending_total
  from public.form_publication_requests request
  where request.organization_id = p_expected_organization_id
    and request.branch_id = p_expected_branch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request_row.id,
    'form_definition_id', request_row.form_definition_id,
    'form_version_id', request_row.form_version_id,
    'status', request_row.status,
    'requested_at', request_row.requested_at,
    'requested_by_current_user', request_row.requested_by_current_user,
    'approved_at', request_row.approved_at,
    'approved_by_current_user', request_row.approved_by_current_user
  ) order by request_row.status_priority, request_row.requested_at desc, request_row.id), '[]'::jsonb)
    into v_publications
  from (
    select
      request.id,
      request.form_definition_id,
      request.form_version_id,
      request.status,
      request.requested_at,
      request.requested_by = v_actor as requested_by_current_user,
      request.approved_at,
      coalesce(request.approved_by = v_actor, false) as approved_by_current_user,
      case when request.status = 'pending' then 0 else 1 end as status_priority
    from public.form_publication_requests request
    join public.form_definitions definition
      on definition.id = request.form_definition_id
     and definition.organization_id = p_expected_organization_id
     and not definition.is_official
    join public.form_versions version
      on version.id = request.form_version_id
     and version.form_definition_id = request.form_definition_id
    where request.organization_id = p_expected_organization_id
      and request.branch_id = p_expected_branch_id
      and request.form_definition_id in (
        select (item ->> 'id')::uuid
        from jsonb_array_elements(v_definitions) item
      )
      and request.form_version_id in (
        select (item ->> 'id')::uuid
        from jsonb_array_elements(v_versions) item
      )
    order by
      case when request.status = 'pending' then 0 else 1 end,
      request.requested_at desc,
      request.id
    limit 1000
  ) request_row;

  -- Recheck immediately before returning and recording the access. A waited
  -- query must not return data after the caller's governance authority ends.
  if not (select private.has_permission(
       p_expected_organization_id,
       null,
       'forms.manage'
     ))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'forms.manage'
     )) then
    raise exception using
      errcode = '42501',
      message = 'form governance snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    changed_fields,
    metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'form_governance_snapshot',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page82_minimal',
      'definition_count', jsonb_array_length(v_definitions),
      'version_count', jsonb_array_length(v_versions),
      'publication_count', jsonb_array_length(v_publications),
      'definition_total', v_definition_total,
      'version_total', v_version_total,
      'publication_total', v_publication_total,
      'pending_total', v_pending_total,
      'definitions_truncated', v_definition_total > jsonb_array_length(v_definitions),
      'versions_truncated', v_version_total > jsonb_array_length(v_versions),
      'publications_truncated', v_publication_total > jsonb_array_length(v_publications),
      'definition_limit', 1000,
      'version_limit', 5000,
      'publication_limit', 1000
    )
  );

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_definitions,
    v_versions,
    v_publications,
    v_definition_total,
    v_version_total,
    v_publication_total,
    v_pending_total,
    v_definition_total > jsonb_array_length(v_definitions),
    v_version_total > jsonb_array_length(v_versions),
    v_publication_total > jsonb_array_length(v_publications);
end;
$$;

create or replace function public.form_governance_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  definitions jsonb,
  versions jsonb,
  publications jsonb,
  definition_total bigint,
  version_total bigint,
  publication_total bigint,
  pending_total bigint,
  definitions_truncated boolean,
  versions_truncated boolean,
  publications_truncated boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.form_governance_snapshot_response(
    p_expected_organization_id,
    p_expected_branch_id
  );
$$;

comment on function public.form_governance_snapshot(uuid, uuid) is
  'Returns the minimal audited page-82 definition/version/publication projection for one tenant branch; excludes AAL2, request/approval hashes, and idempotency evidence.';

revoke all on function private.form_governance_snapshot_response(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.form_governance_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.form_governance_snapshot_response(uuid, uuid)
  to authenticated;
grant execute on function public.form_governance_snapshot(uuid, uuid)
  to authenticated;

-- The immutable publication ledger is not a general Data API read surface.
-- The audited snapshot intentionally omits challenge ids, request/approval
-- hashes, persisted idempotency keys, and raw AAL2 evidence.
revoke select on table public.form_publication_requests
  from authenticated, service_role;
