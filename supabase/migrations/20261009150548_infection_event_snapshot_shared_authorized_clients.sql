-- Replaces only the page-25 private snapshot projection. Existing grants, RLS,
-- AAL2 checks, final authority recheck, result shape and public wrapper remain.
-- Compute exact-branch authorized clients once so the four list projections do
-- not repeat row-dependent permission joins for every incident or option.

create or replace function private.infection_event_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_infection_type text default null,
  p_handling_status text default 'all',
  p_client_id uuid default null,
  p_cluster_mode text default 'all',
  p_cluster_id uuid default null
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  matching_total bigint,
  infection_provided_total bigint,
  linked_total bigint,
  awaiting_action_total bigint,
  awaiting_closure_total bigint,
  closed_total bigint,
  items_truncated boolean,
  client_options jsonb,
  client_options_available_total bigint,
  client_options_truncated boolean,
  infection_type_options jsonb,
  infection_options_available_total bigint,
  infection_options_truncated boolean,
  cluster_options jsonb,
  cluster_options_available_total bigint,
  cluster_options_truncated boolean,
  infection_taxonomy_status text,
  cluster_threshold_status text,
  legal_reporting_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_generated_at timestamptz := clock_timestamp();
  v_infection_type text := nullif(btrim(p_infection_type), '');
  v_can_view_all boolean;
  v_items jsonb;
  v_item_total bigint;
  v_matching_total bigint;
  v_infection_provided_total bigint;
  v_linked_total bigint;
  v_awaiting_action_total bigint;
  v_awaiting_closure_total bigint;
  v_closed_total bigint;
  v_client_options jsonb;
  v_client_options_available_total bigint;
  v_client_options_truncated boolean;
  v_infection_options jsonb;
  v_infection_options_available_total bigint;
  v_infection_options_truncated boolean;
  v_cluster_options jsonb;
  v_cluster_options_available_total bigint;
  v_cluster_options_truncated boolean;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or (p_date_from is not null and p_date_to is not null and p_date_from > p_date_to)
     or p_handling_status not in ('all', 'reported', 'in_progress', 'closed')
     or p_cluster_mode not in ('all', 'linked', 'unlinked')
     or (p_cluster_id is not null and p_cluster_mode = 'unlinked')
     or (v_infection_type is not null and char_length(v_infection_type) > 240)
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
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     )) then
    raise exception using errcode = '42501', message = 'infection incident snapshot is not permitted';
  end if;

  -- Compute the broad-scope grant in the *same statement snapshot* as the
  -- client projection. A separate PL/pgSQL assignment can retain a grant that
  -- was revoked before the following SELECT begins (READ COMMITTED).
  with projection_authority as materialized (
    select private.has_permission(
      p_expected_organization_id, p_expected_branch_id, 'clients.view_all'
    ) as can_view_all
  ), authorized_clients as materialized (
    select client.id, client.organization_id, client.branch_id,
      client.display_name, client.status, client.admitted_on, client.ended_on
    from public.clients client
    cross join projection_authority authority
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and (
        authority.can_view_all
        or exists (
          select 1 from public.client_assignments assignment
          where assignment.client_id = client.id
            and assignment.organization_id = client.organization_id
            and assignment.branch_id = client.branch_id
            and assignment.assignee_user_id = v_actor
            and assignment.starts_at <= now()
            and (assignment.ends_at is null or assignment.ends_at > now())
        )
      )
  ), accessible as (
    select
      incident.*,
      client.display_name as client_display_name,
      coalesce(timeline.timeline_total, 0)::integer as timeline_total,
      timeline.last_entry_type,
      case when cluster_state.entry_type = 'cluster_link'
        then cluster_state.cluster_id else null end as current_cluster_id,
      case when cluster_state.entry_type = 'cluster_link'
        then cluster_state.cluster_label else null end as current_cluster_label,
      coalesce(timeline.last_committed_at, incident.reported_at) as last_activity_at,
      case
        when timeline.last_entry_type = 'closure' then 'closed'
        when coalesce(timeline.timeline_total, 0) > 0 then 'in_progress'
        else 'reported'
      end as handling_status
    from public.infection_incidents incident
    join authorized_clients client
      on client.id = incident.client_id
     and client.organization_id = incident.organization_id
     and client.branch_id = incident.branch_id
    left join lateral (
      select
        count(*)::integer as timeline_total,
        (array_agg(entry.entry_type order by entry.sequence_number desc))[1]
          as last_entry_type,
        max(entry.committed_at) as last_committed_at
      from public.infection_incident_entries entry
      where entry.incident_id = incident.id
        and entry.organization_id = incident.organization_id
        and entry.branch_id = incident.branch_id
        and entry.client_id = incident.client_id
    ) timeline on true
    left join lateral (
      select entry.entry_type, entry.cluster_id, entry.cluster_label
      from public.infection_incident_entries entry
      where entry.incident_id = incident.id
        and entry.organization_id = incident.organization_id
        and entry.branch_id = incident.branch_id
        and entry.client_id = incident.client_id
        and entry.entry_type in ('cluster_link', 'cluster_unlink')
      order by entry.sequence_number desc
      limit 1
    ) cluster_state on true
    where incident.organization_id = p_expected_organization_id
      and incident.branch_id = p_expected_branch_id
  ), filtered as (
    select accessible.*
    from accessible
    where (p_date_from is null or
      (accessible.occurred_at at time zone 'Asia/Taipei')::date >= p_date_from)
      and (p_date_to is null or
        (accessible.occurred_at at time zone 'Asia/Taipei')::date <= p_date_to)
      and (
        v_infection_type is null
        or (v_infection_type = '__missing__'
          and accessible.infection_type_state = 'missing')
        or (v_infection_type = '__not_applicable__'
          and accessible.infection_type_state = 'not_applicable')
        or (v_infection_type not in ('__missing__', '__not_applicable__')
          and accessible.infection_type_state = 'provided'
          and accessible.infection_type_text = v_infection_type)
      )
      and (p_handling_status = 'all'
        or accessible.handling_status = p_handling_status)
      and (p_client_id is null or accessible.client_id = p_client_id)
      and (p_cluster_id is null or accessible.current_cluster_id = p_cluster_id)
      and (p_cluster_mode = 'all'
        or (p_cluster_mode = 'linked' and accessible.current_cluster_id is not null)
        or (p_cluster_mode = 'unlinked' and accessible.current_cluster_id is null))
  ), selected as (
    select filtered.*
    from filtered
    order by filtered.occurred_at desc, filtered.id desc
    limit 200
  ), selected_stats as (
    select count(*)::bigint as item_total from selected
  ), stats as (
    select
      count(*)::bigint as matching_total,
      count(*) filter (
        where filtered.infection_type_state = 'provided'
      )::bigint as infection_provided_total,
      count(*) filter (
        where filtered.current_cluster_id is not null
      )::bigint as linked_total,
      count(*) filter (
        where filtered.handling_status = 'reported'
      )::bigint as awaiting_action_total,
      count(*) filter (
        where filtered.handling_status = 'in_progress'
      )::bigint as awaiting_closure_total,
      count(*) filter (
        where filtered.handling_status = 'closed'
      )::bigint as closed_total
    from filtered
  ), client_option_candidates as (
    select client.id, client.display_name, client.status,
      client.admitted_on, client.ended_on,
      (client.status = 'active'
        and client.admitted_on is not null
        and client.admitted_on <= (v_generated_at at time zone 'Asia/Taipei')::date
      ) as can_report
    from authorized_clients client
    where (
        client.status = 'active'
        or exists (
          select 1 from public.infection_incidents historical_incident
          where historical_incident.client_id = client.id
            and historical_incident.organization_id = client.organization_id
            and historical_incident.branch_id = client.branch_id
        )
      )
    order by client.display_name collate "C", client.id
  ), client_option_result as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'client_id', option_row.id,
        'display_name', option_row.display_name,
        'client_status', option_row.status,
        'admitted_on', option_row.admitted_on,
        'ended_on', option_row.ended_on,
        'can_report', option_row.can_report
      ) order by option_row.display_name collate "C", option_row.id)
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*)::bigint as available_total,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.display_name collate "C", candidate.id
      ) as ordinality
      from client_option_candidates candidate
    ) option_row
  ), infection_option_candidates as (
    select distinct incident.infection_type_text collate "C" as infection_type_text
    from public.infection_incidents incident
    join authorized_clients client
      on client.id = incident.client_id
     and client.organization_id = incident.organization_id
     and client.branch_id = incident.branch_id
    where incident.organization_id = p_expected_organization_id
      and incident.branch_id = p_expected_branch_id
      and incident.infection_type_state = 'provided'
    order by infection_type_text
  ), infection_option_result as (
    select
      coalesce(jsonb_agg(option_row.infection_type_text order by
        option_row.infection_type_text collate "C")
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*)::bigint as available_total,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.infection_type_text collate "C"
      ) as ordinality
      from infection_option_candidates candidate
    ) option_row
  ), cluster_option_candidates as (
    select cluster.id, cluster.label, cluster.created_at
    from public.infection_clusters cluster
    where cluster.organization_id = p_expected_organization_id
      and cluster.branch_id = p_expected_branch_id
      and exists (
        select 1
        from public.infection_incident_entries entry
        join authorized_clients client
          on client.id = entry.client_id
         and client.organization_id = entry.organization_id
         and client.branch_id = entry.branch_id
        where entry.cluster_id = cluster.id
          and entry.organization_id = cluster.organization_id
          and entry.branch_id = cluster.branch_id
      )
    order by cluster.label collate "C", cluster.id
  ), cluster_option_result as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'cluster_id', option_row.id,
        'label', option_row.label,
        'created_at', option_row.created_at
      ) order by option_row.label collate "C", option_row.id)
        filter (where option_row.ordinality <= 200), '[]'::jsonb) as options,
      count(*)::bigint as available_total,
      count(*) > 200 as truncated
    from (
      select candidate.*, row_number() over (
        order by candidate.label collate "C", candidate.id
      ) as ordinality
      from cluster_option_candidates candidate
    ) option_row
  )
  select
    selected_stats.item_total,
    stats.matching_total,
    stats.infection_provided_total,
    stats.linked_total,
    stats.awaiting_action_total,
    stats.awaiting_closure_total,
    stats.closed_total,
    client_option_result.options,
    client_option_result.available_total,
    client_option_result.truncated,
    infection_option_result.options,
    infection_option_result.available_total,
    infection_option_result.truncated,
    cluster_option_result.options,
    cluster_option_result.available_total,
    cluster_option_result.truncated,
    projection_authority.can_view_all,
    coalesce(jsonb_agg(jsonb_build_object(
      'incident_id', incident.id,
      'client_id', incident.client_id,
      'client_display_name', incident.client_display_name,
      'occurred_at', incident.occurred_at,
      'reported_at', incident.reported_at,
      'location', incident.location,
      'event_summary', incident.event_summary,
      'infection_type_state', incident.infection_type_state,
      'infection_type_text', incident.infection_type_text,
      'current_cluster_id', incident.current_cluster_id,
      'current_cluster_label', incident.current_cluster_label,
      'reporter_display_name', incident.reporter_display_name,
      'handling_status', incident.handling_status,
      'chain_version', incident.timeline_total,
      'last_activity_at', incident.last_activity_at,
      'timeline_total', incident.timeline_total,
      'timeline_truncated', incident.timeline_total > 100,
      'timeline', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'entry_id', timeline_entry.id,
          'sequence_number', timeline_entry.sequence_number,
          'entry_type', timeline_entry.entry_type,
          'occurred_at', timeline_entry.occurred_at,
          'entry_text', timeline_entry.entry_text,
          'cluster_id', timeline_entry.cluster_id,
          'cluster_label', timeline_entry.cluster_label,
          'closure_outcome', timeline_entry.closure_outcome,
          'closure_reason', timeline_entry.closure_reason,
          'committer_display_name', timeline_entry.committer_display_name,
          'committed_at', timeline_entry.committed_at
        ) order by timeline_entry.sequence_number), '[]'::jsonb)
        from (
          select entry.*
          from public.infection_incident_entries entry
          where entry.incident_id = incident.id
            and entry.organization_id = incident.organization_id
            and entry.branch_id = incident.branch_id
            and entry.client_id = incident.client_id
          order by entry.sequence_number desc
          limit 100
        ) timeline_entry
      )
    ) order by incident.occurred_at desc, incident.id desc)
      filter (where incident.id is not null), '[]'::jsonb)
  into
    v_item_total,
    v_matching_total,
    v_infection_provided_total,
    v_linked_total,
    v_awaiting_action_total,
    v_awaiting_closure_total,
    v_closed_total,
    v_client_options,
    v_client_options_available_total,
    v_client_options_truncated,
    v_infection_options,
    v_infection_options_available_total,
    v_infection_options_truncated,
    v_cluster_options,
    v_cluster_options_available_total,
    v_cluster_options_truncated,
    v_can_view_all,
    v_items
  from selected_stats
  cross join stats
  cross join client_option_result
  cross join infection_option_result
  cross join cluster_option_result
  cross join projection_authority
  left join selected incident on true
  group by
    selected_stats.item_total,
    stats.matching_total,
    stats.infection_provided_total,
    stats.linked_total,
    stats.awaiting_action_total,
    stats.awaiting_closure_total,
    stats.closed_total,
    client_option_result.options,
    client_option_result.available_total,
    client_option_result.truncated,
    infection_option_result.options,
    infection_option_result.available_total,
    infection_option_result.truncated,
    cluster_option_result.options,
    cluster_option_result.available_total,
    cluster_option_result.truncated,
    projection_authority.can_view_all;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.read'
     ))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     ))
     or (v_can_view_all and not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.view_all'
     ))) then
    raise exception using errcode = '42501', message = 'infection incident snapshot authority expired';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'infection_incidents', null, '{}'::text[], jsonb_build_object(
      'projection', 'page25_infection_events_v1',
      'interaction', case when p_date_from is null and p_date_to is null
        and v_infection_type is null and p_handling_status = 'all'
        and p_client_id is null and p_cluster_mode = 'all'
        and p_cluster_id is null then 'view' else 'search' end,
      'snapshot_count', v_item_total,
      'matching_count', v_matching_total,
      'items_truncated', v_matching_total > v_item_total,
      'item_limit', 200,
      'timeline_limit', 100,
      'client_options_truncated', v_client_options_truncated,
      'infection_options_truncated', v_infection_options_truncated,
      'cluster_options_truncated', v_cluster_options_truncated,
      'infection_taxonomy_status', 'not_configured',
      'cluster_threshold_status', 'not_configured',
      'legal_reporting_status', 'not_configured'
    )
  );

  -- Final fail-closed check occurs after projection and audit work. Any
  -- authority loss observed here aborts the statement, including its audit
  -- insert, and no incident data is returned.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
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
       p_expected_organization_id, p_expected_branch_id, 'quality_events.read'
     ))
     or (v_can_view_all and not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.view_all'
     ))) then
    raise exception using errcode = '42501', message = 'infection incident snapshot authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_generated_at,
    v_items,
    v_item_total,
    v_matching_total,
    v_infection_provided_total,
    v_linked_total,
    v_awaiting_action_total,
    v_awaiting_closure_total,
    v_closed_total,
    v_matching_total > v_item_total,
    v_client_options,
    v_client_options_available_total,
    v_client_options_truncated,
    v_infection_options,
    v_infection_options_available_total,
    v_infection_options_truncated,
    v_cluster_options,
    v_cluster_options_available_total,
    v_cluster_options_truncated,
    'not_configured'::text,
    'not_configured'::text,
    'not_configured'::text;
end;
$$;
