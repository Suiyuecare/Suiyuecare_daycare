-- Page 54: actor/branch-scoped immutable daily service summary.
-- All eight source projections are read in one SQL statement. Missing source
-- permission is explicit unknown and never becomes a numeric zero.

insert into public.permissions(permission_key,description,risk_level) values
  ('daily_service_summary.read','Read assigned-client daily service summary snapshots',2),
  ('daily_service_summary.export','Export an immutable daily service summary snapshot',3)
on conflict(permission_key) do nothing;

insert into public.role_permissions(role_id,permission_id)
select role.id,permission.id from public.roles role cross join public.permissions permission
where role.is_system
  and role.role_key in('organization_manager','branch_supervisor',
    'case_manager_social_worker','nurse','care_worker','professional','finance_claims')
  and permission.permission_key='daily_service_summary.read'
on conflict(role_id,permission_id) do nothing;

insert into public.role_permissions(role_id,permission_id)
select role.id,permission.id from public.roles role cross join public.permissions permission
where role.is_system and role.role_key in('organization_manager','branch_supervisor','finance_claims')
  and permission.permission_key='daily_service_summary.export'
on conflict(role_id,permission_id) do nothing;

create table private.daily_service_summary_snapshots_v2(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  service_date date not null,
  filter_client_id uuid,
  completeness_filter text not null,
  payload jsonb not null,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint daily_summary_v2_branch_scope_fkey foreign key(branch_id,organization_id)
    references public.branches(id,organization_id) on delete restrict,
  constraint daily_summary_v2_client_scope_fkey foreign key(filter_client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  constraint daily_summary_v2_scope_key unique(id,organization_id,branch_id,actor_user_id),
  constraint daily_summary_v2_date_check check(extract(year from service_date) between 2000 and 2200),
  constraint daily_summary_v2_filter_check check(completeness_filter in(
    'all','complete','incomplete','limited_access')),
  constraint daily_summary_v2_payload_check check(jsonb_typeof(payload)='object'
    and payload->>'organization_id'=organization_id::text
    and payload->>'branch_id'=branch_id::text
    and payload->>'service_date'=service_date::text
    and payload->>'completeness_filter'=completeness_filter),
  constraint daily_summary_v2_hash_check check(payload_hash~'^[a-f0-9]{64}$'
    and payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex')),
  constraint daily_summary_v2_expiry_check check(expires_at>created_at
    and expires_at<=created_at+interval '20 minutes')
);

create index daily_summary_v2_actor_expiry_idx
  on private.daily_service_summary_snapshots_v2(actor_user_id,expires_at desc);
create index daily_summary_v2_scope_expiry_idx
  on private.daily_service_summary_snapshots_v2(organization_id,branch_id,expires_at desc);
create index daily_summary_v2_branch_fkey_idx
  on private.daily_service_summary_snapshots_v2(branch_id,organization_id);
create index daily_summary_v2_client_fkey_idx
  on private.daily_service_summary_snapshots_v2(filter_client_id,organization_id,branch_id)
  where filter_client_id is not null;

alter table private.daily_service_summary_snapshots_v2 enable row level security;
alter table private.daily_service_summary_snapshots_v2 force row level security;
revoke all on table private.daily_service_summary_snapshots_v2
  from public,anon,authenticated,service_role;

create or replace function private.daily_service_summary_snapshot_immutable_v2()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception using errcode='55000',message='daily service summary snapshot is immutable';
end;
$$;
create trigger daily_service_summary_snapshots_v2_immutable
before update or delete on private.daily_service_summary_snapshots_v2
for each row execute function private.daily_service_summary_snapshot_immutable_v2();

create or replace function private.daily_service_summary_authority_v2(
  p_organization_id uuid,p_branch_id uuid,p_permission text
)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->>'aal','')='aal2'
    and p_permission in('daily_service_summary.read','daily_service_summary.export')
    and exists(select 1 from public.profiles profile where profile.id=auth.uid()
      and profile.kind in('staff','professional','finance') and profile.is_active)
    and exists(select 1 from public.branches branch where branch.id=p_branch_id
      and branch.organization_id=p_organization_id and branch.is_active)
    and private.has_permission(p_organization_id,p_branch_id,'clients.read')
    and private.has_permission(p_organization_id,p_branch_id,p_permission);
$$;

create or replace function private.daily_service_summary_source_authority_v2(
  p_organization_id uuid,p_branch_id uuid,p_client_id uuid,
  p_source_kind text,p_service_date date
)
returns boolean language sql stable security definer set search_path='' as $$
  select p_source_kind in('attendance','vital_signs','care_diary','service_events',
      'activities','meals','transport','abnormal_events')
    and exists(select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_organization_id and client.branch_id=p_branch_id)
    and private.can_staff_access_client(p_client_id,case p_source_kind
      when 'attendance' then 'attendance.read'
      when 'vital_signs' then 'health.read'
      when 'care_diary' then 'care_records.read'
      when 'service_events' then 'services.read'
      when 'activities' then 'activity.read'
      when 'meals' then 'meals.read'
      when 'transport' then 'transport_execution.read'
      when 'abnormal_events' then 'quality_events.read' end)
    and (p_source_kind<>'transport'
      or private.has_permission(p_organization_id,p_branch_id,'transport_execution.manage_any')
      or exists(
        select 1 from public.transport_trip_plan_versions plan
        join public.transport_trip_plan_decisions decision
          on decision.trip_version_id=plan.id and decision.decision in('publish','override')
        cross join lateral jsonb_array_elements(plan.passenger_snapshot) passenger
        where plan.organization_id=p_organization_id and plan.branch_id=p_branch_id
          and plan.service_date=p_service_date and plan.driver_user_id=auth.uid()
          and (passenger.value->>'client_id')::uuid=p_client_id
          and not exists(select 1 from public.transport_trip_plan_versions newer
            join public.transport_trip_plan_decisions newer_decision
              on newer_decision.trip_version_id=newer.id
              and newer_decision.decision in('publish','override')
            where newer.trip_key=plan.trip_key and newer.version>plan.version)
      ));
$$;

create or replace function private.daily_service_summary_payload_v2(
  p_organization_id uuid,p_branch_id uuid,p_service_date date,
  p_client_id uuid,p_completeness_filter text,p_reference_time timestamptz
)
returns jsonb language sql volatile security definer set search_path='' as $$
with
source_config(ordinal,source_kind,source_page,source_label,permission_key) as (
  values (1,'attendance',46,'出勤','attendance.read'),
    (2,'vital_signs',3,'生命徵象','health.read'),
    (3,'care_diary',6,'照顧日誌','care_records.read'),
    (4,'service_events',53,'服務使用','services.read'),
    (5,'activities',30,'活動參與','activity.read'),
    (6,'meals',57,'餐食','meals.read'),
    (7,'transport',48,'接送','transport_execution.read'),
    (8,'abnormal_events',27,'異常事件','quality_events.read')
),
client_pool as materialized(
  select client.id,client.display_name,client.client_code,client.status::text service_status
  from public.clients client
  where client.organization_id=p_organization_id and client.branch_id=p_branch_id
    and client.admitted_on is not null and client.admitted_on<=p_service_date
    and (client.ended_on is null or client.ended_on>=p_service_date)
    and private.can_staff_access_client(client.id,'clients.read')
    and private.can_staff_access_client(client.id,'daily_service_summary.read')
),
selected_clients as materialized(
  select * from client_pool where p_client_id is null or id=p_client_id
),
attendance_raw as materialized(
  select attendance.*,row_number() over(partition by attendance.client_id
    order by attendance.created_at,attendance.id) ordinal
  from public.attendance_records attendance join selected_clients client
    on client.id=attendance.client_id
  where attendance.organization_id=p_organization_id and attendance.branch_id=p_branch_id
    and attendance.service_date=p_service_date and attendance.correction_of_id is null
    and attendance.status<>'cancelled'
    and private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      attendance.client_id,'attendance',p_service_date)
),
attendance_agg as(
  select client_id,'attendance'::text source_kind,count(*)::bigint record_count,
    count(*)::bigint completed_count,0::bigint pending_count,0::bigint exception_count,
    coalesce(jsonb_agg(id order by created_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||status::text||':'||
      coalesce(checked_in_at::text,'')||':'||coalesce(checked_out_at::text,''),',' order by created_at,id),'UTF8')),'hex') source_hash
  from attendance_raw group by client_id
),
vital_sets as materialized(
  select measurement.client_id,coalesce(measurement.measurement_set_id,measurement.id) id,
    min(measurement.measured_at) occurred_at,
    encode(sha256(convert_to(string_agg(measurement.id::text||':'||measurement.measurement_kind||':'||
      coalesce(measurement.numeric_value::text,measurement.text_value,'')||':'||coalesce(measurement.unit,'')
      ,',' order by measurement.id),'UTF8')),'hex') content_hash
  from public.measurements measurement join selected_clients client on client.id=measurement.client_id
  where measurement.organization_id=p_organization_id and measurement.branch_id=p_branch_id
    and measurement.measured_at>=p_service_date::timestamp at time zone 'Asia/Taipei'
    and measurement.measured_at<(p_service_date+1)::timestamp at time zone 'Asia/Taipei'
    and measurement.measurement_kind in('blood_pressure_systolic','blood_pressure_diastolic',
      'pulse','temperature','oxygen_saturation')
    and private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      measurement.client_id,'vital_signs',p_service_date)
  group by measurement.client_id,coalesce(measurement.measurement_set_id,measurement.id)
),
vital_ranked as(
  select vital_sets.*,row_number() over(partition by client_id order by occurred_at,id) ordinal
  from vital_sets
),
vital_agg as(
  select client_id,'vital_signs'::text source_kind,count(*)::bigint record_count,
    count(*)::bigint completed_count,0::bigint pending_count,0::bigint exception_count,
    coalesce(jsonb_agg(id order by occurred_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||content_hash,',' order by occurred_at,id),'UTF8')),'hex') source_hash
  from vital_ranked group by client_id
),
care_raw as materialized(
  select record.*,row_number() over(partition by record.client_id order by record.occurred_at,record.id) ordinal
  from public.care_records record join selected_clients client on client.id=record.client_id
  where record.organization_id=p_organization_id and record.branch_id=p_branch_id
    and record.category='staff/daily-care/care-diary'
    and record.occurred_at>=p_service_date::timestamp at time zone 'Asia/Taipei'
    and record.occurred_at<(p_service_date+1)::timestamp at time zone 'Asia/Taipei'
    and record.status<>'voided'
    and not exists(select 1 from public.care_records child
      where child.previous_version_id=record.id)
    and private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      record.client_id,'care_diary',p_service_date)
),
care_agg as(
  select client_id,'care_diary'::text source_kind,count(*)::bigint record_count,
    count(*) filter(where status='signed')::bigint completed_count,
    count(*) filter(where status<>'signed')::bigint pending_count,
    count(*) filter(where coalesce((data->>'hasAbnormalFlag')::boolean,false))::bigint exception_count,
    coalesce(jsonb_agg(id order by occurred_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||version::text||':'||status::text||':'||
      coalesce(content_hash,encode(sha256(convert_to(data::text,'UTF8')),'hex')),',' order by occurred_at,id),'UTF8')),'hex') source_hash
  from care_raw group by client_id
),
service_raw as materialized(
  select event.*,row_number() over(partition by event.client_id order by event.started_at,event.id) ordinal
  from public.service_events event join selected_clients client on client.id=event.client_id
  where event.organization_id=p_organization_id and event.branch_id=p_branch_id
    and event.started_at>=p_service_date::timestamp at time zone 'Asia/Taipei'
    and event.started_at<(p_service_date+1)::timestamp at time zone 'Asia/Taipei'
    and event.status<>'voided'
    and private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      event.client_id,'service_events',p_service_date)
),
service_agg as(
  select client_id,'service_events'::text source_kind,count(*)::bigint record_count,
    count(*) filter(where status in('completed','cancelled'))::bigint completed_count,
    count(*) filter(where status in('planned','in_progress'))::bigint pending_count,
    count(*) filter(where status='cancelled')::bigint exception_count,
    coalesce(jsonb_agg(id order by started_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||status::text||':'||service_code||':'||
      coalesce(content_hash,encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),',' order by started_at,id),'UTF8')),'hex') source_hash
  from service_raw group by client_id
),
activity_current as materialized(
  select schedule.* from public.activity_schedule_versions schedule
  where schedule.organization_id=p_organization_id and schedule.branch_id=p_branch_id
    and not exists(select 1 from public.activity_schedule_versions child
      where child.previous_version_id=schedule.id)
    and schedule.starts_at<(p_service_date+1)::timestamp at time zone 'Asia/Taipei'
    and schedule.ends_at>=p_service_date::timestamp at time zone 'Asia/Taipei'
),
activity_status as materialized(
  select event.* from public.activity_status_events event
  where event.organization_id=p_organization_id and event.branch_id=p_branch_id
    and not exists(select 1 from public.activity_status_events child
      where child.previous_event_id=event.id)
),
activity_flat as materialized(
  select (participant.value->>'client_id')::uuid client_id,schedule.id,
    schedule.starts_at occurred_at,status.to_status::text raw_status,
    schedule.content_hash||':'||status.content_hash combined_hash,
    row_number() over(partition by (participant.value->>'client_id')::uuid
      order by schedule.starts_at,schedule.id) ordinal
  from activity_current schedule join activity_status status on status.activity_id=schedule.activity_id
  cross join lateral jsonb_array_elements(schedule.participants) participant
  join selected_clients client on client.id=(participant.value->>'client_id')::uuid
  where private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
    client.id,'activities',p_service_date)
),
activity_agg as(
  select client_id,'activities'::text source_kind,count(*)::bigint record_count,
    count(*) filter(where raw_status in('completed','cancelled'))::bigint completed_count,
    count(*) filter(where raw_status in('scheduled','in_progress'))::bigint pending_count,
    count(*) filter(where raw_status='cancelled')::bigint exception_count,
    coalesce(jsonb_agg(id order by occurred_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||raw_status||':'||combined_hash,',' order by occurred_at,id),'UTF8')),'hex') source_hash
  from activity_flat group by client_id
),
meal_current as materialized(
  select plan.* from public.meal_plan_versions plan
  where plan.organization_id=p_organization_id and plan.branch_id=p_branch_id
    and plan.service_date=p_service_date
    and not exists(select 1 from public.meal_plan_versions child
      where child.previous_version_id=plan.id)
),
meal_flat as materialized(
  select (assignment.value->>'client_id')::uuid client_id,plan.id,plan.meal_kind,
    plan.status::text raw_status,
    jsonb_array_length(coalesce(assignment.value->'conflicts','[]'::jsonb)) conflict_count,
    plan.content_hash,
    row_number() over(partition by (assignment.value->>'client_id')::uuid
      order by plan.meal_kind collate "C",plan.id) ordinal
  from meal_current plan cross join lateral jsonb_array_elements(plan.assignment_snapshot) assignment
  join selected_clients client on client.id=(assignment.value->>'client_id')::uuid
  where private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
    client.id,'meals',p_service_date)
),
meal_agg as(
  select client_id,'meals'::text source_kind,count(*)::bigint record_count,
    count(*) filter(where raw_status='prepared')::bigint completed_count,
    count(*) filter(where raw_status='review')::bigint pending_count,
    coalesce(sum(conflict_count),0)::bigint exception_count,
    coalesce(jsonb_agg(id order by meal_kind collate "C",id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||raw_status||':'||content_hash,','
      order by meal_kind collate "C",id),'UTF8')),'hex') source_hash
  from meal_flat group by client_id
),
transport_accepted as materialized(
  select plan.* from public.transport_trip_plan_versions plan
  join public.transport_trip_plan_decisions decision on decision.trip_version_id=plan.id
    and decision.decision in('publish','override')
  where plan.organization_id=p_organization_id and plan.branch_id=p_branch_id
    and plan.service_date=p_service_date
    and not exists(select 1 from public.transport_trip_plan_versions newer
      join public.transport_trip_plan_decisions newer_decision
        on newer_decision.trip_version_id=newer.id
        and newer_decision.decision in('publish','override')
      where newer.trip_key=plan.trip_key and newer.version>plan.version)
),
transport_flat as materialized(
  select (passenger.value->>'client_id')::uuid client_id,
    coalesce(stream.id,plan.id) id,plan.starts_at occurred_at,
    case when stream.id is null then 'not_started'
      when exists(select 1 from public.transport_execution_events event
        where event.stream_id=stream.id and event.event_type='trip_completed') then 'completed'
      else 'in_progress' end raw_status,
    (select count(*) from public.transport_execution_events event
      where event.stream_id=stream.id and event.event_type='exception_recorded'
        and event.client_id=(passenger.value->>'client_id')::uuid)::bigint exception_count,
    plan.content_hash||':'||coalesce(stream.content_hash,'not_started') combined_hash,
    row_number() over(partition by (passenger.value->>'client_id')::uuid
      order by plan.starts_at,plan.id) ordinal
  from transport_accepted plan
  left join public.transport_execution_streams stream on stream.plan_version_id=plan.id
  cross join lateral jsonb_array_elements(plan.passenger_snapshot) passenger
  join selected_clients client on client.id=(passenger.value->>'client_id')::uuid
  where (private.has_permission(p_organization_id,p_branch_id,'transport_execution.manage_any')
      or plan.driver_user_id=auth.uid())
    and private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      client.id,'transport',p_service_date)
),
transport_agg as(
  select client_id,'transport'::text source_kind,count(*)::bigint record_count,
    count(*) filter(where raw_status='completed')::bigint completed_count,
    count(*) filter(where raw_status in('not_started','in_progress'))::bigint pending_count,
    coalesce(sum(exception_count),0)::bigint exception_count,
    coalesce(jsonb_agg(id order by occurred_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||raw_status||':'||combined_hash,',' order by occurred_at,id),'UTF8')),'hex') source_hash
  from transport_flat group by client_id
),
abnormal_flat as materialized(
  select incident.affected_client_id client_id,incident.id,incident.occurred_at,
    case when latest.entry_type='closure' then 'closed' else 'open' end raw_status,
    case when incident.major_state='major' then 1 else 0 end exception_count,
    incident.content_hash||':'||coalesce(latest.content_hash,'reported') combined_hash,
    row_number() over(partition by incident.affected_client_id
      order by incident.occurred_at,incident.id) ordinal
  from public.abnormal_incidents incident
  join selected_clients client on client.id=incident.affected_client_id
  left join lateral(select entry.entry_type,entry.content_hash
    from public.abnormal_incident_entries entry where entry.incident_id=incident.id
    order by entry.sequence_number desc,entry.id desc limit 1) latest on true
  where incident.organization_id=p_organization_id and incident.branch_id=p_branch_id
    and incident.affected_target_kind='client'
    and incident.occurred_at>=p_service_date::timestamp at time zone 'Asia/Taipei'
    and incident.occurred_at<(p_service_date+1)::timestamp at time zone 'Asia/Taipei'
    and private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      client.id,'abnormal_events',p_service_date)
),
abnormal_agg as(
  select client_id,'abnormal_events'::text source_kind,count(*)::bigint record_count,
    count(*) filter(where raw_status='closed')::bigint completed_count,
    count(*) filter(where raw_status='open')::bigint pending_count,
    coalesce(sum(exception_count),0)::bigint exception_count,
    coalesce(jsonb_agg(id order by occurred_at,id) filter(where ordinal<=50),'[]'::jsonb) source_ids,
    encode(sha256(convert_to(string_agg(id::text||':'||raw_status||':'||combined_hash,',' order by occurred_at,id),'UTF8')),'hex') source_hash
  from abnormal_flat group by client_id
),
source_data as materialized(
  select * from attendance_agg union all select * from vital_agg
  union all select * from care_agg union all select * from service_agg
  union all select * from activity_agg union all select * from meal_agg
  union all select * from transport_agg union all select * from abnormal_agg
),
cell_rows as materialized(
  select client.id client_id,config.ordinal,config.source_kind,config.source_page,
    config.source_label,
    private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
      client.id,config.source_kind,p_service_date) authorized,
    coalesce(data.record_count,0)::bigint record_count,
    coalesce(data.completed_count,0)::bigint completed_count,
    coalesce(data.pending_count,0)::bigint pending_count,
    coalesce(data.exception_count,0)::bigint exception_count,
    coalesce(data.source_ids,'[]'::jsonb) source_ids,data.source_hash,
    case config.source_kind
      when 'attendance' then format('/app/staff/service-management/attendance?date=%s&client=%s',p_service_date,client.id)
      when 'vital_signs' then format('/app/staff/daily-care/vital-signs?date=%s&client=%s',p_service_date,client.id)
      when 'care_diary' then format('/app/staff/daily-care/care-diary?date=%s&client=%s',p_service_date,client.id)
      when 'service_events' then format('/app/staff/service-management/service-usage?date=%s&client=%s',p_service_date,client.id)
      when 'activities' then format('/app/staff/social-work/activities?from=%s&to=%s&client=%s',p_service_date,p_service_date,client.id)
      when 'meals' then format('/app/staff/service-management/meals?date=%s',p_service_date)
      when 'transport' then format('/app/staff/service-management/transport-execution?date=%s',p_service_date)
      when 'abnormal_events' then format('/app/staff/quality/incidents?from=%s&to=%s&affected=client',p_service_date,p_service_date)
    end source_href
  from selected_clients client cross join source_config config
  left join source_data data on data.client_id=client.id and data.source_kind=config.source_kind
),
row_base as materialized(
  select client.id client_id,client.display_name,client.client_code,client.service_status,
    jsonb_agg(jsonb_build_object('source_kind',cell.source_kind,
      'source_page',cell.source_page,'source_label',cell.source_label,
      'source_href',cell.source_href,
      'access_status',case when cell.authorized then 'authorized' else 'not_authorized' end,
      'evidence_status',case when not cell.authorized then 'unknown'
        when cell.record_count>0 then 'recorded' else 'no_record' end,
      'record_count',case when cell.authorized then cell.record_count else null end,
      'completed_count',case when cell.authorized then cell.completed_count else null end,
      'pending_count',case when cell.authorized then cell.pending_count else null end,
      'exception_count',case when cell.authorized then cell.exception_count else null end,
      'source_record_ids',case when cell.authorized then cell.source_ids else '[]'::jsonb end,
      'source_records_truncated',cell.authorized and cell.record_count>jsonb_array_length(cell.source_ids),
      'source_hash',case when cell.authorized and cell.record_count>0 then cell.source_hash else null end,
      'status_text',case when not cell.authorized then '未授權，數量未知'
        when cell.record_count=0 then '已查詢，當日無來源紀錄'
        when cell.pending_count>0 then cell.record_count::text||' 筆，其中 '||cell.pending_count::text||' 筆待完成'
        else cell.record_count::text||' 筆來源紀錄' end
    ) order by cell.ordinal) cells,
    count(*) filter(where cell.authorized)::integer authorized_source_count,
    count(*) filter(where cell.authorized and cell.record_count>0)::integer covered_source_count,
    count(*) filter(where not cell.authorized)::integer not_authorized_source_count
  from selected_clients client join cell_rows cell on cell.client_id=client.id
  group by client.id,client.display_name,client.client_code,client.service_status
),
filtered_rows as materialized(
  select row_base.*,
    case when authorized_source_count=0 then null
      else floor(covered_source_count*100.0/authorized_source_count)::integer end completeness_percent
  from row_base where p_completeness_filter='all'
    or (p_completeness_filter='complete' and authorized_source_count>0
      and covered_source_count=authorized_source_count)
    or (p_completeness_filter='incomplete' and authorized_source_count>0
      and covered_source_count<authorized_source_count)
    or (p_completeness_filter='limited_access' and not_authorized_source_count>0)
),
ranked_rows as materialized(
  select filtered_rows.*,row_number() over(order by display_name collate "C",client_id) ordinal
  from filtered_rows
),
row_result as(
  select count(*)::bigint row_total,
    coalesce(jsonb_agg(jsonb_build_object('client_id',client_id,'display_name',display_name,
      'client_code',client_code,'service_status',service_status,'cells',cells,
      'authorized_source_count',authorized_source_count,'covered_source_count',covered_source_count,
      'not_authorized_source_count',not_authorized_source_count,
      'completeness_percent',completeness_percent)
      order by display_name collate "C",client_id) filter(where ordinal<=200),'[]'::jsonb) rows
  from ranked_rows
),
metric_cells as materialized(
  select row.client_id,cell.value cell from filtered_rows row
  cross join lateral jsonb_array_elements(row.cells) cell
),
metrics as(
  select (select count(*) from filtered_rows)::bigint client_total,
    count(*) filter(where cell->>'access_status'='authorized')::bigint authorized_cell_total,
    count(*) filter(where cell->>'access_status'='authorized'
      and (cell->>'record_count')::bigint>0)::bigint covered_cell_total,
    count(*) filter(where cell->>'access_status'<>'authorized')::bigint not_authorized_cell_total,
    case when count(*) filter(where cell->>'source_kind'='attendance'
      and cell->>'access_status'='authorized')=0 then null else
      count(distinct client_id) filter(where cell->>'source_kind'='attendance'
        and cell->>'access_status'='authorized' and (cell->>'record_count')::bigint>0) end recorded_attendance_clients,
    case when count(*) filter(where cell->>'source_kind'='vital_signs'
      and cell->>'access_status'='authorized')=0 then null else
      count(distinct client_id) filter(where cell->>'source_kind'='vital_signs'
        and cell->>'access_status'='authorized' and (cell->>'record_count')::bigint>0) end recorded_vital_clients,
    case when count(*) filter(where cell->>'source_kind'='activities'
      and cell->>'access_status'='authorized')=0 then null else
      count(distinct client_id) filter(where cell->>'source_kind'='activities'
        and cell->>'access_status'='authorized' and (cell->>'record_count')::bigint>0) end activity_participant_clients,
    case when count(*) filter(where cell->>'source_kind'='meals'
      and cell->>'access_status'='authorized')=0 then null else
      count(distinct client_id) filter(where cell->>'source_kind'='meals'
        and cell->>'access_status'='authorized' and (cell->>'record_count')::bigint>0) end meal_assigned_clients,
    case when count(*) filter(where cell->>'source_kind'='transport'
      and cell->>'access_status'='authorized')=0 then null else
      count(distinct client_id) filter(where cell->>'source_kind'='transport'
        and cell->>'access_status'='authorized' and (cell->>'record_count')::bigint>0) end transport_passenger_clients,
    case when count(*) filter(where cell->>'source_kind'='abnormal_events'
      and cell->>'access_status'='authorized')=0 then null else
      coalesce(sum((cell->>'record_count')::bigint) filter(where
        cell->>'source_kind'='abnormal_events' and cell->>'access_status'='authorized'),0) end abnormal_event_total
  from metric_cells
),
client_ranked as materialized(
  select client_pool.*,row_number() over(order by display_name collate "C",id) ordinal
  from client_pool
),
client_result as(
  select count(*)::bigint client_total,
    coalesce(jsonb_agg(jsonb_build_object('client_id',id,'display_name',display_name,
      'client_code',client_code,'service_status',service_status)
      order by display_name collate "C",id) filter(where ordinal<=200),'[]'::jsonb) clients
  from client_ranked
)
select jsonb_build_object('organization_id',p_organization_id,'branch_id',p_branch_id,
  'generated_at',p_reference_time,'service_date',p_service_date,
  'filter_client_id',p_client_id,'completeness_filter',p_completeness_filter,
  'rows',row_result.rows,'row_count',jsonb_array_length(row_result.rows),
  'row_total',row_result.row_total,'rows_truncated',row_result.row_total>jsonb_array_length(row_result.rows),
  'metrics',jsonb_build_object('client_total',metrics.client_total,
    'authorized_cell_total',metrics.authorized_cell_total,'covered_cell_total',metrics.covered_cell_total,
    'not_authorized_cell_total',metrics.not_authorized_cell_total,
    'recorded_attendance_clients',metrics.recorded_attendance_clients,
    'recorded_vital_clients',metrics.recorded_vital_clients,
    'activity_participant_clients',metrics.activity_participant_clients,
    'meal_assigned_clients',metrics.meal_assigned_clients,
    'transport_passenger_clients',metrics.transport_passenger_clients,
    'abnormal_event_total',metrics.abnormal_event_total),
  'client_options',client_result.clients,'client_total',client_result.client_total,
  'client_options_truncated',client_result.client_total>jsonb_array_length(client_result.clients),
  'source_configuration',(select jsonb_agg(jsonb_build_object('source_kind',source_kind,
    'source_page',source_page,'source_label',source_label,'permission',permission_key,
    'configuration_status','configured') order by ordinal) from source_config),
  'consistency_status','single_database_statement_snapshot',
  'export_status','immutable_snapshot_available','offline_status','not_configured')
from row_result cross join metrics cross join client_result;
$$;

create or replace function private.create_daily_service_summary_snapshot_v2(
  p_organization_id uuid,p_branch_id uuid,p_service_date date,
  p_client_id uuid,p_completeness_filter text
)
returns table(snapshot_id uuid,snapshot_hash text,expires_at timestamptz,payload jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();
  v_id uuid:=gen_random_uuid();v_payload jsonb;v_hash text;v_expires timestamptz:=v_now+interval '15 minutes';
begin
  if p_organization_id is null or p_branch_id is null or p_service_date is null
    or extract(year from p_service_date) not between 2000 and 2200
    or p_completeness_filter not in('all','complete','incomplete','limited_access')
    or not private.daily_service_summary_authority_v2(p_organization_id,p_branch_id,
      'daily_service_summary.read') then
    raise exception using errcode='42501',message='daily service summary snapshot is not permitted';
  end if;
  if p_client_id is not null and (not private.can_staff_access_client(p_client_id,'clients.read')
    or not private.can_staff_access_client(p_client_id,'daily_service_summary.read')
    or not exists(select 1 from public.clients client where client.id=p_client_id
      and client.organization_id=p_organization_id and client.branch_id=p_branch_id)) then
    raise exception using errcode='42501',message='daily service summary client is not permitted';
  end if;
  -- The eight source reads occur inside this single SQL projection statement.
  v_payload:=private.daily_service_summary_payload_v2(p_organization_id,p_branch_id,
    p_service_date,p_client_id,p_completeness_filter,v_now);
  if v_payload is null then raise exception using errcode='55000',
    message='daily service summary payload unavailable';end if;
  v_hash:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  insert into private.daily_service_summary_snapshots_v2(id,organization_id,branch_id,
    actor_user_id,service_date,filter_client_id,completeness_filter,payload,payload_hash,
    created_at,expires_at) values(v_id,p_organization_id,p_branch_id,v_actor,p_service_date,
      p_client_id,p_completeness_filter,v_payload,v_hash,v_now,v_expires);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values(p_organization_id,p_branch_id,v_actor,
      'select','daily_service_summary_snapshots_v2',v_id,'{}'::text[],jsonb_build_object(
        'projection','page54_daily_service_summary_v2','snapshot_hash',v_hash,
        'row_count',(v_payload->>'row_count')::integer,
        'row_total',(v_payload->>'row_total')::bigint,'source_count',8,
        'filter_values_logged',false,'client_names_logged',false));
  return query select v_id,v_hash,v_expires,v_payload;
end;
$$;

create or replace function private.export_daily_service_summary_snapshot_v2(
  p_organization_id uuid,p_branch_id uuid,p_snapshot_id uuid
)
returns table(snapshot_id uuid,snapshot_hash text,expires_at timestamptz,payload jsonb)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_now timestamptz:=clock_timestamp();
  v_row private.daily_service_summary_snapshots_v2%rowtype;
begin
  if p_organization_id is null or p_branch_id is null or p_snapshot_id is null
    or not private.daily_service_summary_authority_v2(p_organization_id,p_branch_id,
      'daily_service_summary.export') or not private.has_recent_aal2(15) then
    raise exception using errcode='42501',message='daily service summary export is not permitted';
  end if;
  select snapshot.* into v_row from private.daily_service_summary_snapshots_v2 snapshot
  where snapshot.id=p_snapshot_id and snapshot.organization_id=p_organization_id
    and snapshot.branch_id=p_branch_id and snapshot.actor_user_id=v_actor
    and snapshot.expires_at>v_now for share;
  if not found then raise exception using errcode='42501',
    message='daily service summary export is not permitted';end if;
  if v_row.payload_hash<>encode(sha256(convert_to(v_row.payload::text,'UTF8')),'hex') then
    raise exception using errcode='55000',message='daily service summary integrity failed';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_row.payload->'rows') row_value
    where not private.can_staff_access_client((row_value->>'client_id')::uuid,'clients.read')
      or not private.can_staff_access_client((row_value->>'client_id')::uuid,
        'daily_service_summary.read')
      or exists(select 1 from jsonb_array_elements(row_value->'cells') cell
        where cell->>'access_status'='authorized'
          and not private.daily_service_summary_source_authority_v2(p_organization_id,p_branch_id,
            (row_value->>'client_id')::uuid,cell->>'source_kind',v_row.service_date))
  ) then raise exception using errcode='42501',
    message='daily service summary source authority changed';end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values(p_organization_id,p_branch_id,v_actor,
      'export','daily_service_summary_snapshots_v2',p_snapshot_id,'{}'::text[],jsonb_build_object(
        'projection','page54_daily_service_summary_v2','snapshot_hash',v_row.payload_hash,
        'row_count',(v_row.payload->>'row_count')::integer,
        'filter_values_logged',false,'client_names_logged',false));
  return query select v_row.id,v_row.payload_hash,v_row.expires_at,v_row.payload;
end;
$$;

create or replace function public.daily_service_summary_snapshot_v2(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_service_date date,
  p_client_id uuid default null,p_completeness_filter text default 'all'
)
returns table(snapshot_id uuid,snapshot_hash text,expires_at timestamptz,payload jsonb)
language sql volatile security invoker set search_path='' as $$
  select * from private.create_daily_service_summary_snapshot_v2(
    p_expected_organization_id,p_expected_branch_id,p_service_date,p_client_id,
    p_completeness_filter);
$$;

create or replace function public.daily_service_summary_export_snapshot_v2(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_snapshot_id uuid
)
returns table(snapshot_id uuid,snapshot_hash text,expires_at timestamptz,payload jsonb)
language sql volatile security invoker set search_path='' as $$
  select * from private.export_daily_service_summary_snapshot_v2(
    p_expected_organization_id,p_expected_branch_id,p_snapshot_id);
$$;

revoke all on function private.daily_service_summary_snapshot_immutable_v2()
  from public,anon,authenticated,service_role;
revoke all on function private.daily_service_summary_authority_v2(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.daily_service_summary_source_authority_v2(uuid,uuid,uuid,text,date)
  from public,anon,authenticated,service_role;
revoke all on function private.daily_service_summary_payload_v2(uuid,uuid,date,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.create_daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.export_daily_service_summary_snapshot_v2(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.daily_service_summary_export_snapshot_v2(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.create_daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)
  to authenticated;
grant execute on function private.export_daily_service_summary_snapshot_v2(uuid,uuid,uuid)
  to authenticated;
grant execute on function public.daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)
  to authenticated;
grant execute on function public.daily_service_summary_export_snapshot_v2(uuid,uuid,uuid)
  to authenticated;

comment on table private.daily_service_summary_snapshots_v2 is
  'Actor and branch scoped 15-minute immutable Page54 snapshots. Eight source reads are assembled by one database projection statement.';
comment on function public.daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text) is
  'Creates one Page54 snapshot; unavailable source permissions remain unknown and outside completeness denominators.';
comment on function public.daily_service_summary_export_snapshot_v2(uuid,uuid,uuid) is
  'Re-fetches the exact unexpired actor snapshot after recent same-session AAL2 and source-scope revalidation.';
