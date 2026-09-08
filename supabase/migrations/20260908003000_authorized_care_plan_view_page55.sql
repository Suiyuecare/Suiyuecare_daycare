-- Page 55: a bounded, audited, single-statement read projection over the
-- immutable authorized-care-plan ledger. This migration deliberately adds no
-- promotion, mutation, statutory limit, claim-eligibility, or diagnosis rule.

create or replace function private.authorized_care_plan_view_json_object_size(
  p_value jsonb
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from jsonb_each(
    case when jsonb_typeof(p_value) = 'object'
      then p_value else '{}'::jsonb end
  );
$$;

create or replace function private.authorized_care_plan_view_json_is_safe(
  p_value jsonb,
  p_max_bytes integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with recursive nodes(value, depth, key_name) as (
    select p_value, 0, null::text
    union all
    select child.value, node.depth + 1, child.key_name
    from nodes node
    cross join lateral (
      select entry.value, entry.key as key_name
      from jsonb_each(
        case when jsonb_typeof(node.value) = 'object'
          then node.value else '{}'::jsonb end
      ) entry
      union all
      select element.value, null::text
      from jsonb_array_elements(
        case when jsonb_typeof(node.value) = 'array'
          then node.value else '[]'::jsonb end
      ) element
    ) child
    where node.depth < 8
  )
  select
    p_value is not null
    and p_max_bytes between 2 and 2097152
    and octet_length(convert_to(p_value::text, 'UTF8')) <= p_max_bytes
    and count(*) <= 1024
    and bool_and(
      key_name is null
      or (
        char_length(key_name) between 1 and 160
        and key_name !~ '[[:cntrl:]]'
      )
    )
    and bool_and(
      jsonb_typeof(value) <> 'string'
      or char_length(value #>> '{}') <= 4000
    )
    and bool_and(
      jsonb_typeof(value) <> 'array'
      or jsonb_array_length(value) <= 200
    )
    and bool_and(
      jsonb_typeof(value) <> 'object'
      or private.authorized_care_plan_view_json_object_size(value) <= 200
    )
    and not bool_or(
      depth = 8
      and (
        (jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0)
        or (
          jsonb_typeof(value) = 'object'
          and private.authorized_care_plan_view_json_object_size(value) > 0
        )
      )
    )
  from nodes;
$$;

create or replace function private.authorized_care_plan_view_json_node_count(
  p_value jsonb
)
returns integer
language sql
immutable
set search_path = ''
as $$
  with recursive nodes(value, depth) as (
    select p_value, 0
    union all
    select child.value, node.depth + 1
    from nodes node
    cross join lateral (
      select entry.value
      from jsonb_each(
        case when jsonb_typeof(node.value) = 'object'
          then node.value else '{}'::jsonb end
      ) entry
      union all
      select element.value
      from jsonb_array_elements(
        case when jsonb_typeof(node.value) = 'array'
          then node.value else '[]'::jsonb end
      ) element
    ) child
    where node.depth < 8
  )
  select count(*)::integer from nodes;
$$;

create or replace function private.authorized_care_plan_view_content_envelope(
  p_value jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'value_state', case when p_value = '{}'::jsonb then 'missing' else 'unknown' end,
    'mapping_status', case when p_value = '{}'::jsonb then 'missing' else 'needs_mapping' end,
    'needs_mapping', p_value <> '{}'::jsonb,
    'canonical_json', p_value::text,
    'content_hash', encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex'),
    'byte_size', octet_length(convert_to(p_value::text, 'UTF8')),
    'node_count', private.authorized_care_plan_view_json_node_count(p_value),
    'top_level_field_count', private.authorized_care_plan_view_json_object_size(p_value)
  );
$$;

create or replace function private.authorized_care_plan_view_provenance_envelope(
  p_value jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'value_state', case when p_value = '{}'::jsonb then 'missing' else 'recorded' end,
    'canonical_json', p_value::text,
    'content_hash', encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex'),
    'byte_size', octet_length(convert_to(p_value::text, 'UTF8')),
    'node_count', private.authorized_care_plan_view_json_node_count(p_value),
    'top_level_field_count', private.authorized_care_plan_view_json_object_size(p_value)
  );
$$;

create or replace function private.authorized_care_plan_view_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_as_of date,
  p_client_id uuid,
  p_authorized_from date,
  p_authorized_to date,
  p_effective_state text,
  p_source_system text,
  p_page integer,
  p_page_size integer,
  p_generated_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with accessible_versions as materialized (
    select
      plan.*,
      client.client_code,
      client.display_name
    from public.authorized_care_plans plan
    join public.clients client
      on client.id = plan.client_id
     and client.organization_id = plan.organization_id
     and client.branch_id = plan.branch_id
    where plan.organization_id = p_expected_organization_id
      and plan.branch_id = p_expected_branch_id
      and (select private.can_staff_access_client(client.id, 'clients.read'))
      and (select private.can_staff_access_client(client.id, 'care_plans.read'))
  ),
  workflow_ranked as (
    select version.*,
      row_number() over (
        partition by version.plan_key
        order by version.version desc, version.created_at desc, version.id desc
      ) as row_number
    from accessible_versions version
  ),
  workflow_heads as (
    select * from workflow_ranked where row_number = 1
  ),
  published_ranked as (
    select version.*,
      row_number() over (
        partition by version.plan_key
        order by version.version desc, version.created_at desc, version.id desc
      ) as row_number
    from accessible_versions version
    where version.status in ('signed', 'voided')
  ),
  published_heads as (
    select * from published_ranked where row_number = 1
  ),
  date_published_ranked as (
    select version.*,
      row_number() over (
        partition by version.plan_key
        order by version.version desc, version.created_at desc, version.id desc
      ) as row_number
    from accessible_versions version
    where version.status in ('signed', 'voided')
      and p_as_of between version.effective_from and version.effective_to
  ),
  date_published_heads as (
    select * from date_published_ranked where row_number = 1
  ),
  stream_heads_unclassified as (
    select
      workflow.plan_key,
      workflow.client_id,
      workflow.client_code,
      workflow.display_name,
      workflow.id as workflow_head_id,
      workflow.version as workflow_head_version,
      workflow.status as workflow_head_status,
      published.id as published_head_id,
      published.version as published_head_version,
      published.status as published_head_status,
      date_published.id as date_terminal_id,
      date_published.version as date_terminal_version,
      date_published.status as date_terminal_status,
      case when published.id is null then workflow.id
        else published.id end as display_id,
      case when published.id is null then workflow.authorized_on
        else published.authorized_on end as display_authorized_on,
      case when published.id is null then workflow.source_system
        else published.source_system end as display_source_system,
      case when published.id is null then workflow.source_record_id
        else published.source_record_id end as display_source_record_id,
      case when published.id is null then workflow.effective_from
        else published.effective_from end as display_effective_from,
      case when published.id is null then workflow.effective_to
        else published.effective_to end as display_effective_to,
      case when published.id is null then workflow.authorization_reference
        else published.authorization_reference end as display_authorization_reference,
      case when published.id is null then workflow.plan_data
        else published.plan_data end as display_plan_data,
      case when published.id is null then workflow.service_limits
        else published.service_limits end as display_service_limits,
      case
        when date_published.status = 'signed' then 'current'
        when date_published.status = 'voided' then 'voided'
        when exists (
          select 1 from accessible_versions future
          where future.plan_key = workflow.plan_key
            and future.status = 'signed'
            and future.effective_from > p_as_of
        ) then 'future'
        when exists (
          select 1 from accessible_versions expired
          where expired.plan_key = workflow.plan_key
            and expired.status = 'signed'
            and expired.effective_to < p_as_of
        ) then 'expired'
        when published.id is not null then 'voided'
        else 'not_published'
      end as effective_state
    from workflow_heads workflow
    left join published_heads published on published.plan_key = workflow.plan_key
    left join date_published_heads date_published
      on date_published.plan_key = workflow.plan_key
  ),
  stream_heads as (
    select head.*,
      count(*) filter (
        where head.date_terminal_status = 'signed'
      ) over (partition by head.client_id) as client_current_stream_count
    from stream_heads_unclassified head
  ),
  filtered_streams as materialized (
    select head.*
    from stream_heads head
    where (p_client_id is null or head.client_id = p_client_id)
      and (p_authorized_from is null or head.display_authorized_on >= p_authorized_from)
      and (p_authorized_to is null or head.display_authorized_on <= p_authorized_to)
      and (p_effective_state = 'all' or head.effective_state = p_effective_state)
      and (p_source_system is null or head.display_source_system = p_source_system)
  ),
  paged_streams as materialized (
    select filtered.*
    from filtered_streams filtered
    order by filtered.client_code collate "C", filtered.client_id, filtered.plan_key
    offset ((p_page - 1) * p_page_size)
    limit p_page_size
  ),
  history_window as materialized (
    select
      version.*,
      lag(version.id) over chain as actual_previous_id,
      lag(version.status) over chain as previous_status,
      lag(version.effective_from) over chain as previous_effective_from,
      lag(version.effective_to) over chain as previous_effective_to,
      lag(version.source_system) over chain as previous_source_system,
      lag(version.source_record_id) over chain as previous_source_record_id,
      lag(version.source_provenance) over chain as previous_source_provenance,
      lag(version.authorized_on) over chain as previous_authorized_on,
      lag(version.authorization_reference) over chain as previous_authorization_reference,
      lag(version.service_limits) over chain as previous_service_limits,
      lag(version.plan_data) over chain as previous_plan_data,
      lag(version.correction_reason) over chain as previous_correction_reason,
      lag(version.approved_at) over chain as previous_approved_at,
      lag(version.signed_at) over chain as previous_signed_at,
      lag(version.content_hash) over chain as previous_content_hash,
      lead(version.id) over chain as next_version_id,
      count(*) over (partition by version.plan_key) as history_count
    from accessible_versions version
    join paged_streams selected on selected.plan_key = version.plan_key
    window chain as (
      partition by version.plan_key
      order by version.version, version.created_at, version.id
    )
  ),
  history_rows as materialized (
    select
      history.*,
      array_remove(array[
        case when history.previous_version_id is not null
          and history.status is distinct from history.previous_status then 'status' end,
        case when history.previous_version_id is not null
          and history.effective_from is distinct from history.previous_effective_from then 'effective_from' end,
        case when history.previous_version_id is not null
          and history.effective_to is distinct from history.previous_effective_to then 'effective_to' end,
        case when history.previous_version_id is not null
          and history.source_system is distinct from history.previous_source_system then 'source_system' end,
        case when history.previous_version_id is not null
          and history.source_record_id is distinct from history.previous_source_record_id then 'source_record_id' end,
        case when history.previous_version_id is not null
          and history.source_provenance is distinct from history.previous_source_provenance then 'source_provenance' end,
        case when history.previous_version_id is not null
          and history.authorized_on is distinct from history.previous_authorized_on then 'authorized_on' end,
        case when history.previous_version_id is not null
          and history.authorization_reference is distinct from history.previous_authorization_reference then 'authorization_reference' end,
        case when history.previous_version_id is not null
          and history.service_limits is distinct from history.previous_service_limits then 'service_limits' end,
        case when history.previous_version_id is not null
          and history.plan_data is distinct from history.previous_plan_data then 'plan_data' end,
        case when history.previous_version_id is not null
          and history.correction_reason is distinct from history.previous_correction_reason then 'correction_reason' end,
        case when history.previous_version_id is not null
          and history.approved_at is distinct from history.previous_approved_at then 'approved_at' end,
        case when history.previous_version_id is not null
          and history.signed_at is distinct from history.previous_signed_at then 'signed_at' end,
        case when history.previous_version_id is not null
          and history.content_hash is distinct from history.previous_content_hash then 'content_hash' end
      ], null) as changed_fields
    from history_window history
  ),
  history_validation as (
    select
      coalesce(bool_and(
        history.history_count <= 50
        and history.version between 1 and 50
        and (
          (history.version = 1 and history.previous_version_id is null)
          or (
            history.version > 1
            and history.previous_version_id = history.actual_previous_id
          )
        )
        and char_length(btrim(history.source_system)) between 1 and 80
        and history.source_system !~ '[[:cntrl:]]'
        and (
          history.source_record_id is null
          or char_length(btrim(history.source_record_id)) between 1 and 240
        )
        and private.authorized_care_plan_view_json_is_safe(
          history.source_provenance, 16384
        )
        and private.authorized_care_plan_view_json_is_safe(
          history.plan_data, 65536
        )
        and private.authorized_care_plan_view_json_is_safe(
          history.service_limits, 65536
        )
      ), true) as valid,
      count(*)::integer as version_count
    from history_rows history
  ),
  history_by_stream as (
    select history.plan_key,
      jsonb_agg(
        jsonb_build_object(
          'version_id', history.id,
          'plan_key', history.plan_key,
          'version', history.version,
          'previous_version_id', history.previous_version_id,
          'next_version_id', history.next_version_id,
          'status', history.status,
          'effective_from', history.effective_from,
          'effective_to', history.effective_to,
          'source_system', history.source_system,
          'source_record_id', history.source_record_id,
          'source_provenance',
            private.authorized_care_plan_view_provenance_envelope(history.source_provenance),
          'authorized_on', history.authorized_on,
          'authorization_reference', history.authorization_reference,
          'service_limits',
            private.authorized_care_plan_view_content_envelope(history.service_limits),
          'plan_data',
            private.authorized_care_plan_view_content_envelope(history.plan_data),
          'correction_reason', history.correction_reason,
          'created_at', history.created_at,
          'approved_at', history.approved_at,
          'signed_at', history.signed_at,
          'content_hash', history.content_hash,
          'is_workflow_head', history.id = stream.workflow_head_id,
          'is_published_head', coalesce(history.id = stream.published_head_id, false),
          'is_current_published',
            coalesce(
              history.id = stream.date_terminal_id
              and stream.date_terminal_status = 'signed',
              false
            ),
          'differences_from_previous', jsonb_build_object(
            'changed_fields', to_jsonb(history.changed_fields),
            'previous_plan_data_hash', case when history.previous_plan_data is null
              then null else encode(sha256(convert_to(history.previous_plan_data::text, 'UTF8')), 'hex') end,
            'previous_service_limits_hash', case when history.previous_service_limits is null
              then null else encode(sha256(convert_to(history.previous_service_limits::text, 'UTF8')), 'hex') end,
            'previous_source_provenance_hash', case when history.previous_source_provenance is null
              then null else encode(sha256(convert_to(history.previous_source_provenance::text, 'UTF8')), 'hex') end
          )
        ) order by history.version desc, history.id
      ) as history
    from history_rows history
    join paged_streams stream on stream.plan_key = history.plan_key
    group by history.plan_key
  ),
  plan_rows as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'plan_key', stream.plan_key,
        'client_id', stream.client_id,
        'client_code', stream.client_code,
        'display_name', stream.display_name,
        'effective_state', stream.effective_state,
        'client_current_stream_count', stream.client_current_stream_count,
        'effective_conflict', stream.client_current_stream_count > 1,
        'workflow_head', jsonb_build_object(
          'version_id', stream.workflow_head_id,
          'version', stream.workflow_head_version,
          'status', stream.workflow_head_status
        ),
        'published_head', case when stream.published_head_id is null then null
          else jsonb_build_object(
            'version_id', stream.published_head_id,
            'version', stream.published_head_version,
            'status', stream.published_head_status
          ) end,
        'current_published_id', case
          when stream.date_terminal_status = 'signed' then stream.date_terminal_id
          else null end,
        'date_terminal_id', stream.date_terminal_id,
        'date_terminal_status', stream.date_terminal_status,
        'display_version_id', stream.display_id,
        'display_authorized_on', stream.display_authorized_on,
        'display_source_system', stream.display_source_system,
        'display_source_record_id', stream.display_source_record_id,
        'display_effective_from', stream.display_effective_from,
        'display_effective_to', stream.display_effective_to,
        'display_authorization_reference', stream.display_authorization_reference,
        'display_needs_mapping',
          stream.display_plan_data <> '{}'::jsonb
          or stream.display_service_limits <> '{}'::jsonb,
        'history_count', jsonb_array_length(history.history),
        'history', history.history
      ) order by stream.client_code collate "C", stream.client_id, stream.plan_key
    ), '[]'::jsonb) as plans
    from paged_streams stream
    join history_by_stream history on history.plan_key = stream.plan_key
  ),
  metrics as (
    select
      count(*)::bigint as matching_stream_total,
      count(*) filter (where effective_state = 'current')::bigint as current_total,
      count(*) filter (where effective_state = 'future')::bigint as future_total,
      count(*) filter (where effective_state = 'expired')::bigint as expired_total,
      count(*) filter (where effective_state = 'voided')::bigint as voided_total,
      count(*) filter (where effective_state = 'not_published')::bigint as not_published_total,
      count(*) filter (
        where display_plan_data <> '{}'::jsonb
           or display_service_limits <> '{}'::jsonb
      )::bigint as needs_mapping_total,
      count(*) filter (where client_current_stream_count > 1)::bigint
        as effective_conflict_total
    from filtered_streams
  ),
  client_options_source as (
    select distinct head.client_id, head.client_code, head.display_name
    from stream_heads head
  ),
  client_options as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', option.client_id,
      'client_code', option.client_code,
      'display_name', option.display_name
    ) order by option.client_code collate "C", option.client_id), '[]'::jsonb) as options
    from (
      select * from client_options_source
      order by client_code collate "C", client_id
      limit 500
    ) option
  ),
  client_option_metrics as (
    select count(*)::bigint as option_total from client_options_source
  ),
  source_options_source as (
    select head.display_source_system as source_system, count(*)::bigint as record_count
    from stream_heads head
    group by head.display_source_system
  ),
  source_options as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source_system', option.source_system,
      'record_count', option.record_count
    ) order by option.source_system collate "C"), '[]'::jsonb) as options
    from (
      select * from source_options_source
      order by source_system collate "C"
      limit 100
    ) option
  ),
  source_option_metrics as (
    select count(*)::bigint as option_total from source_options_source
  ),
  result as (
    select case when validation.valid then jsonb_build_object(
      'schema_version', 'page55-authorized-care-plan-view.v1',
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id,
      'generated_at', p_generated_at,
      'expires_at', p_expires_at,
      'filters', jsonb_build_object(
        'as_of', p_as_of,
        'client_id', p_client_id,
        'authorized_from', p_authorized_from,
        'authorized_to', p_authorized_to,
        'effective_state', p_effective_state,
        'source_system', p_source_system,
        'page', p_page,
        'page_size', p_page_size
      ),
      'metrics', jsonb_build_object(
        'matching_stream_total', metrics.matching_stream_total,
        'page_stream_count', jsonb_array_length(plan_rows.plans),
        'history_version_count', validation.version_count,
        'current_total', metrics.current_total,
        'future_total', metrics.future_total,
        'expired_total', metrics.expired_total,
        'voided_total', metrics.voided_total,
        'not_published_total', metrics.not_published_total,
        'needs_mapping_total', metrics.needs_mapping_total,
        'effective_conflict_total', metrics.effective_conflict_total
      ),
      'plans', plan_rows.plans,
      'client_options', client_options.options,
      'client_option_total', client_option_metrics.option_total,
      'client_options_truncated', client_option_metrics.option_total > 500,
      'source_options', source_options.options,
      'source_option_total', source_option_metrics.option_total,
      'source_options_truncated', source_option_metrics.option_total > 100,
      'bounds', jsonb_build_object(
        'max_page_size', 25,
        'max_history_versions_per_stream', 50,
        'max_content_bytes', 65536,
        'max_provenance_bytes', 16384,
        'max_json_nodes', 1024,
        'max_snapshot_bytes', 2097152
      ),
      'mapping_registry_status', 'not_configured',
      'central_promotion_status', 'not_configured',
      'official_limit_rules_status', 'not_configured',
      'claim_eligibility_status', 'not_asserted',
      'mutation_status', 'read_only'
    ) else null end as payload
    from history_validation validation
    cross join plan_rows
    cross join metrics
    cross join client_options
    cross join client_option_metrics
    cross join source_options
    cross join source_option_metrics
  )
  select payload from result;
$$;

create or replace function private.authorized_care_plan_view_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_as_of date,
  p_client_id uuid default null,
  p_authorized_from date default null,
  p_authorized_to date default null,
  p_effective_state text default 'all',
  p_source_system text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  generated_at timestamptz,
  expires_at timestamptz,
  snapshot_json text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_now + interval '60 seconds';
  v_snapshot_id uuid := gen_random_uuid();
  v_effective_state text := lower(coalesce(nullif(btrim(p_effective_state), ''), 'all'));
  v_source_system text := nullif(btrim(p_source_system), '');
  v_payload jsonb;
  v_snapshot_json text;
  v_snapshot_hash text;
  v_item_count integer;
  v_history_count integer;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_as_of is null
     or extract(year from p_as_of) not between 2000 and 2200
     or (p_authorized_from is not null and extract(year from p_authorized_from) not between 2000 and 2200)
     or (p_authorized_to is not null and extract(year from p_authorized_to) not between 2000 and 2200)
     or (p_authorized_from is not null and p_authorized_to is not null
       and p_authorized_from > p_authorized_to)
     or v_effective_state not in (
       'all', 'current', 'future', 'expired', 'voided', 'not_published'
     )
     or (v_source_system is not null and (
       char_length(v_source_system) > 80 or v_source_system ~ '[[:cntrl:]]'
     ))
     or p_page not between 1 and 200
     or p_page_size not between 1 and 25
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1 from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'care_plans.read'
     )) then
    raise exception using errcode = '42501',
      message = 'authorized care plan view snapshot is not permitted';
  end if;

  if p_client_id is not null and not exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and (select private.can_staff_access_client(client.id, 'clients.read'))
      and (select private.can_staff_access_client(client.id, 'care_plans.read'))
  ) then
    raise exception using errcode = '42501',
      message = 'authorized care plan client filter is not permitted';
  end if;

  -- This is the only source-data statement. Its CTE graph builds filters,
  -- totals, options, page rows, full selected histories, and diffs from one
  -- PostgreSQL statement snapshot. The audit insert below does not re-read
  -- source data and is not represented as part of the snapshot.
  select private.authorized_care_plan_view_bundle(
    p_expected_organization_id,
    p_expected_branch_id,
    p_as_of,
    p_client_id,
    p_authorized_from,
    p_authorized_to,
    v_effective_state,
    v_source_system,
    p_page,
    p_page_size,
    v_now,
    v_expires_at
  ) into v_payload;

  if v_payload is null
     or octet_length(convert_to(v_payload::text, 'UTF8')) > 2097152 then
    raise exception using errcode = '54000',
      message = 'authorized care plan view exceeds safe complete snapshot bounds';
  end if;

  v_snapshot_json := v_payload::text;
  v_snapshot_hash := encode(sha256(convert_to(v_snapshot_json, 'UTF8')), 'hex');
  v_item_count := jsonb_array_length(v_payload -> 'plans');
  v_history_count := (v_payload #>> '{metrics,history_version_count}')::integer;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'authorized_care_plan_view_snapshot',
    v_snapshot_id::text,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page55_authorized_care_plan_view_v1',
      'item_count', v_item_count,
      'history_version_count', v_history_count,
      'client_filter_present', p_client_id is not null,
      'authorization_date_filter_present',
        p_authorized_from is not null or p_authorized_to is not null,
      'effective_state_filter_present', v_effective_state <> 'all',
      'source_filter_present', v_source_system is not null,
      'filter_values_logged', false,
      'client_names_logged', false,
      'content_logged', false
    )
  );

  return query select
    v_snapshot_id,
    v_snapshot_hash,
    v_now,
    v_expires_at,
    v_snapshot_json;
end;
$$;

create or replace function public.authorized_care_plan_view_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_as_of date,
  p_client_id uuid default null,
  p_authorized_from date default null,
  p_authorized_to date default null,
  p_effective_state text default 'all',
  p_source_system text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  generated_at timestamptz,
  expires_at timestamptz,
  snapshot_json text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.authorized_care_plan_view_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_as_of,
    p_client_id,
    p_authorized_from,
    p_authorized_to,
    p_effective_state,
    p_source_system,
    p_page,
    p_page_size
  );
$$;

revoke all on function private.authorized_care_plan_view_json_object_size(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.authorized_care_plan_view_json_is_safe(jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.authorized_care_plan_view_json_node_count(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.authorized_care_plan_view_content_envelope(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.authorized_care_plan_view_provenance_envelope(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.authorized_care_plan_view_bundle(
  uuid, uuid, date, uuid, date, date, text, text, integer, integer,
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.authorized_care_plan_view_snapshot(
  uuid, uuid, date, uuid, date, date, text, text, integer, integer
) from public, anon, service_role;
revoke all on function public.authorized_care_plan_view_snapshot(
  uuid, uuid, date, uuid, date, date, text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.authorized_care_plan_view_snapshot(
  uuid, uuid, date, uuid, date, date, text, text, integer, integer
) to authenticated;
grant execute on function private.authorized_care_plan_view_snapshot(
  uuid, uuid, date, uuid, date, date, text, text, integer, integer
) to authenticated;

comment on function public.authorized_care_plan_view_snapshot(
  uuid, uuid, date, uuid, date, date, text, text, integer, integer
) is
  'Returns one bounded Page55 source statement snapshot with immutable history and audits the read without logging plan values. No official limit or claim eligibility is inferred.';
