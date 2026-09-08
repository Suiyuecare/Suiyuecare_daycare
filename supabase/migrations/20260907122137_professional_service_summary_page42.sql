-- Page 42: monthly professional-service summary.
--
-- This projection deliberately counts only work that has an authoritative
-- source row. It does not invent missing assessments or service-frequency
-- expectations. Page 35 remains a candidate-only observation workflow and
-- Page 36 remains license-blocked; both states are returned explicitly.

insert into public.permissions (permission_key, description, risk_level) values
  ('professional_service_summary.read',
    'Read assigned-client monthly professional service summaries', 2),
  ('professional_service_summary.export',
    'Export an immutable assigned-client professional service summary snapshot', 3)
on conflict (permission_key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles role
cross join public.permissions permission
where role.is_system
  and role.role_key in (
    'organization_manager', 'branch_supervisor', 'professional'
  )
  and permission.permission_key in (
    'professional_service_summary.read',
    'professional_service_summary.export'
  )
on conflict (role_id, permission_id) do nothing;

create table private.professional_service_summary_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  selected_month date not null,
  filter_client_id uuid,
  filter_professional_kind text not null,
  filter_summary_status text not null,
  payload jsonb not null,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint professional_summary_snapshot_branch_scope_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete restrict,
  constraint professional_summary_snapshot_client_scope_fkey
    foreign key (filter_client_id, organization_id, branch_id)
    references public.clients(id, organization_id, branch_id) on delete restrict,
  constraint professional_summary_snapshot_scope_key unique (
    id, organization_id, branch_id, actor_user_id
  ),
  constraint professional_summary_snapshot_month_check check (
    selected_month = date_trunc('month', selected_month)::date
    and extract(year from selected_month) between 2000 and 2200
  ),
  constraint professional_summary_snapshot_filter_check check (
    filter_professional_kind in (
      'all', 'occupational_therapy', 'physical_therapy', 'chewing',
      'nutrition', 'consultation', 'case_conference', 'referral'
    )
    and filter_summary_status in (
      'all', 'completed', 'pending', 'overdue', 'not_configured'
    )
  ),
  constraint professional_summary_snapshot_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload ->> 'organization_id' = organization_id::text
    and payload ->> 'branch_id' = branch_id::text
    and payload ->> 'month' = to_char(selected_month, 'YYYY-MM')
  ),
  constraint professional_summary_snapshot_hash_check check (
    payload_hash ~ '^[a-f0-9]{64}$'
    and payload_hash = encode(
      sha256(convert_to(payload::text, 'UTF8')), 'hex'
    )
  ),
  constraint professional_summary_snapshot_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '20 minutes'
  )
);

create index professional_summary_snapshot_actor_expiry_idx
  on private.professional_service_summary_snapshots (
    actor_user_id, expires_at desc
  );
create index professional_summary_snapshot_scope_expiry_idx
  on private.professional_service_summary_snapshots (
    organization_id, branch_id, expires_at desc
  );
create index professional_summary_snapshot_branch_fkey_idx
  on private.professional_service_summary_snapshots (
    branch_id, organization_id
  );
create index professional_summary_snapshot_client_fkey_idx
  on private.professional_service_summary_snapshots (
    filter_client_id, organization_id, branch_id
  ) where filter_client_id is not null;

comment on table private.professional_service_summary_snapshots is
  'Actor-scoped 15-minute Page 42 payloads. UI details and CSV export reuse the exact same hashed database snapshot.';

alter table private.professional_service_summary_snapshots
  enable row level security;
alter table private.professional_service_summary_snapshots
  force row level security;

revoke all on table private.professional_service_summary_snapshots
  from public, anon, authenticated, service_role;

create or replace function private.professional_service_summary_snapshot_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000',
    message = 'professional service summary snapshot is immutable';
end;
$$;

create trigger professional_service_summary_snapshots_immutable
before update on private.professional_service_summary_snapshots
for each row execute function
  private.professional_service_summary_snapshot_is_immutable();

create or replace function private.professional_service_summary_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and p_permission in (
      'professional_service_summary.read',
      'professional_service_summary.export'
    )
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional')
        and profile.is_active
    )
    and exists (
      select 1
      from public.branches branch
      where branch.id = p_expected_branch_id
        and branch.organization_id = p_expected_organization_id
        and branch.is_active
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, 'clients.read'
    )
    and private.has_permission(
      p_expected_organization_id, p_expected_branch_id, p_permission
    );
$$;

create or replace function private.professional_service_summary_client_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.professional_service_summary_authority(
      p_expected_organization_id, p_expected_branch_id, p_permission
    )
    and exists (
      select 1
      from public.clients client
      where client.id = p_client_id
        and client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
    )
    and private.can_staff_access_client(p_client_id, 'clients.read')
    and private.can_staff_access_client(
      p_client_id, 'professional_service_summary.read'
    );
$$;

create or replace function private.professional_service_summary_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_month date,
  p_client_id uuid,
  p_professional_kind text,
  p_summary_status text,
  p_reference_time timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with boundaries as materialized (
    select
      p_month as month_start,
      (p_month + interval '1 month' - interval '1 day')::date as month_end,
      least(
        p_reference_time,
        ((p_month + interval '1 month')::date::timestamp
          at time zone 'Asia/Taipei')
      ) as as_of_at,
      greatest(
        p_month,
        least(
          (p_month + interval '1 month' - interval '1 day')::date,
          (p_reference_time at time zone 'Asia/Taipei')::date
        )
      ) as cutoff_on
  ), visible_clients as materialized (
    select client.id, client.display_name, client.status::text as service_status
    from public.clients client
    where client.organization_id = p_expected_organization_id
      and client.branch_id = p_expected_branch_id
      and private.can_staff_access_client(client.id, 'clients.read')
      and private.can_staff_access_client(
        client.id, 'professional_service_summary.read'
      )
  ), ot_assessment_ranked as materialized (
    select assessment.*, client.display_name as client_display_name,
      client.service_status,
      row_number() over (
        partition by assessment.client_id
        order by assessment.assessed_on desc, assessment.created_at desc,
          assessment.version desc, assessment.id desc
      ) as client_ordinal
    from public.occupational_therapy_assessment_versions assessment
    join visible_clients client on client.id = assessment.client_id
    cross join boundaries boundary
    where assessment.organization_id = p_expected_organization_id
      and assessment.branch_id = p_expected_branch_id
      and assessment.created_at <= boundary.as_of_at
      and assessment.assessed_on <= boundary.month_end
      and private.can_staff_access_client(
        assessment.client_id, 'occupational_therapy_assessments.read'
      )
      and not exists (
        select 1
        from public.occupational_therapy_assessment_versions child
        where child.previous_version_id = assessment.id
          and child.created_at <= boundary.as_of_at
      )
  ), pt_assessment_ranked as materialized (
    select assessment.*, client.display_name as client_display_name,
      client.service_status,
      row_number() over (
        partition by assessment.client_id
        order by assessment.assessed_on desc, assessment.created_at desc,
          assessment.version desc, assessment.id desc
      ) as client_ordinal
    from public.physical_therapy_assessment_versions assessment
    join visible_clients client on client.id = assessment.client_id
    cross join boundaries boundary
    where assessment.organization_id = p_expected_organization_id
      and assessment.branch_id = p_expected_branch_id
      and assessment.created_at <= boundary.as_of_at
      and assessment.assessed_on <= boundary.month_end
      and private.can_staff_access_client(
        assessment.client_id, 'physical_therapy_assessments.read'
      )
      and not exists (
        select 1
        from public.physical_therapy_assessment_versions child
        where child.previous_version_id = assessment.id
          and child.created_at <= boundary.as_of_at
      )
  ), chewing_ranked as materialized (
    select assessment.*, client.display_name as client_display_name,
      client.service_status,
      row_number() over (
        partition by assessment.client_id
        order by assessment.assessed_on desc, assessment.created_at desc,
          assessment.version desc, assessment.id desc
      ) as client_ordinal
    from public.chewing_assessment_versions assessment
    join visible_clients client on client.id = assessment.client_id
    cross join boundaries boundary
    where assessment.organization_id = p_expected_organization_id
      and assessment.branch_id = p_expected_branch_id
      and assessment.created_at <= boundary.as_of_at
      and assessment.assessed_on <= boundary.month_end
      and private.can_staff_access_client(
        assessment.client_id, 'chewing_assessments.read'
      )
      and not exists (
        select 1 from public.chewing_assessment_versions child
        where child.previous_version_id = assessment.id
          and child.created_at <= boundary.as_of_at
      )
  ), mna_ranked as materialized (
    select assessment.*, client.display_name as client_display_name,
      client.service_status,
      row_number() over (
        partition by assessment.client_id
        order by assessment.assessed_on desc, assessment.created_at desc,
          assessment.version desc, assessment.id desc
      ) as client_ordinal
    from public.mna_assessment_versions assessment
    join visible_clients client on client.id = assessment.client_id
    cross join boundaries boundary
    where assessment.organization_id = p_expected_organization_id
      and assessment.branch_id = p_expected_branch_id
      and assessment.created_at <= boundary.as_of_at
      and assessment.assessed_on <= boundary.month_end
      and private.can_staff_access_client(
        assessment.client_id, 'mna_assessments.read'
      )
      and not exists (
        select 1 from public.mna_assessment_versions child
        where child.previous_version_id = assessment.id
          and child.created_at <= boundary.as_of_at
      )
  ), consultation_ranked as materialized (
    select event.*, client.display_name as visible_client_display_name,
      client.service_status,
      row_number() over (
        partition by event.consultation_key order by event.sequence desc,
          event.id desc
      ) as event_ordinal
    from public.interprofessional_consultation_events event
    join visible_clients client on client.id = event.client_id
    cross join boundaries boundary
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.occurred_at <= boundary.as_of_at
      and event.requested_at < ((boundary.month_end + 1)::timestamp
        at time zone 'Asia/Taipei')
      and private.can_staff_access_client(
        event.client_id, 'interprofessional_consultations.read'
      )
  ), conference_ranked as materialized (
    select conference.*, client.display_name as visible_client_display_name,
      client.service_status,
      row_number() over (
        partition by conference.meeting_key order by conference.version desc,
          conference.id desc
      ) as version_ordinal
    from public.case_conference_versions conference
    join visible_clients client on client.id = conference.client_id
    cross join boundaries boundary
    where conference.organization_id = p_expected_organization_id
      and conference.branch_id = p_expected_branch_id
      and conference.occurred_at <= boundary.as_of_at
      and (conference.meeting_starts_at at time zone 'Asia/Taipei')::date
        between boundary.month_start and boundary.month_end
      and private.can_staff_access_client(
        conference.client_id, 'case_conferences.read'
      )
  ), referral_ranked as materialized (
    select event.*, client.display_name as visible_client_display_name,
      client.service_status,
      row_number() over (
        partition by event.referral_key order by event.sequence desc,
          event.id desc
      ) as event_ordinal
    from public.referral_events event
    join visible_clients client on client.id = event.client_id
    cross join boundaries boundary
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.occurred_at <= boundary.as_of_at
      and event.referral_date < ((boundary.month_end + 1)::timestamp
        at time zone 'Asia/Taipei')
      and private.can_staff_access_client(
        event.client_id, 'referral_management.read'
      )
  ), pt_service_terminal as materialized (
    select service.*, client.display_name as client_display_name,
      client.service_status
    from public.physical_therapy_service_record_versions service
    join visible_clients client on client.id = service.client_id
    cross join boundaries boundary
    where service.organization_id = p_expected_organization_id
      and service.branch_id = p_expected_branch_id
      and service.created_at <= boundary.as_of_at
      and (service.occurred_at at time zone 'Asia/Taipei')::date
        between boundary.month_start and boundary.month_end
      and service.occurred_at <= boundary.as_of_at
      and private.can_staff_access_client(
        service.client_id, 'physical_therapy_services.read'
      )
      and not exists (
        select 1
        from public.physical_therapy_service_record_versions child
        where child.previous_version_id = service.id
          and child.created_at <= boundary.as_of_at
      )
  ), ot_service_terminal as materialized (
    select service.*, client.display_name as client_display_name,
      client.service_status
    from public.occupational_therapy_service_record_versions service
    join visible_clients client on client.id = service.client_id
    cross join boundaries boundary
    where service.organization_id = p_expected_organization_id
      and service.branch_id = p_expected_branch_id
      and service.created_at <= boundary.as_of_at
      and (service.occurred_at at time zone 'Asia/Taipei')::date
        between boundary.month_start and boundary.month_end
      and service.occurred_at <= boundary.as_of_at
      and private.can_staff_access_client(
        service.client_id, 'occupational_therapy_services.read'
      )
      and not exists (
        select 1
        from public.occupational_therapy_service_record_versions child
        where child.previous_version_id = service.id
          and child.created_at <= boundary.as_of_at
      )
  ), pt_service_group as materialized (
    select client_id, max(client_display_name) as client_display_name,
      max(service_status) as service_status,
      count(*)::integer as service_count,
      count(*) filter (where record_state in ('signed', 'corrected'))::integer
        as completed_count,
      count(*) filter (where record_state = 'draft')::integer
        as pending_count,
      max((occurred_at at time zone 'Asia/Taipei')::date) as latest_on,
      (array_agg(id order by occurred_at desc, id desc))[1] as latest_id,
      (array_agg(record_key order by occurred_at desc, id desc))[1]
        as latest_key,
      (array_agg(version order by occurred_at desc, id desc))[1]
        as latest_version,
      encode(sha256(convert_to(string_agg(
        content_hash, ',' order by record_key, version
      ), 'UTF8')), 'hex') as source_hash
    from pt_service_terminal
    group by client_id
  ), ot_service_group as materialized (
    select client_id, max(client_display_name) as client_display_name,
      max(service_status) as service_status,
      count(*)::integer as service_count,
      count(*) filter (where record_state in ('signed', 'corrected'))::integer
        as completed_count,
      count(*) filter (where record_state = 'draft')::integer
        as pending_count,
      max((occurred_at at time zone 'Asia/Taipei')::date) as latest_on,
      (array_agg(id order by occurred_at desc, id desc))[1] as latest_id,
      (array_agg(record_key order by occurred_at desc, id desc))[1]
        as latest_key,
      (array_agg(version order by occurred_at desc, id desc))[1]
        as latest_version,
      encode(sha256(convert_to(string_agg(
        content_hash, ',' order by record_key, version
      ), 'UTF8')), 'hex') as source_hash
    from ot_service_terminal
    group by client_id
  ), raw_items as materialized (
    select
      'occupational_therapy_assessment:' || assessment.assessment_key::text
        as item_id,
      'occupational_therapy_assessment'::text as source_kind,
      'occupational_therapy'::text as professional_kind,
      '職能治療'::text as professional_label,
      33::integer as source_page,
      '職能治療評估'::text as source_page_title,
      '/app/staff/professional-care/occupational-assessment?client=' ||
        assessment.client_id::text as source_href,
      assessment.client_id, assessment.client_display_name,
      assessment.service_status,
      assessment.id as source_record_id,
      assessment.assessment_key as source_record_key,
      assessment.version as source_version,
      assessment.record_state as raw_status,
      case
        when assessment.reassessment_due_on < boundary.cutoff_on
          then 'overdue'
        when assessment.record_state = 'draft' then 'pending'
        else 'completed'
      end::text as summary_status,
      'configured_manual_due_date'::text as expectation_status,
      1::integer as expected_count,
      case when assessment.reassessment_due_on >= boundary.cutoff_on
        and assessment.record_state in ('signed', 'corrected')
        then 1 else 0 end::integer as completed_count,
      case when assessment.reassessment_due_on >= boundary.cutoff_on
        and assessment.record_state = 'draft'
        then 1 else 0 end::integer as pending_count,
      case when assessment.reassessment_due_on < boundary.cutoff_on
        then 1 else 0 end::integer as overdue_count,
      0::integer as service_count,
      assessment.assessed_on as latest_on,
      assessment.reassessment_due_on as next_due_on,
      case
        when assessment.reassessment_due_on < boundary.cutoff_on
          then '人工複評日期已逾期'
        when assessment.record_state = 'draft' then '評估草稿待簽署'
        else '最近評估已簽署；複評日期為人工設定'
      end::text as status_reason,
      assessment.content_hash as source_hash
    from ot_assessment_ranked assessment cross join boundaries boundary
    where assessment.client_ordinal = 1

    union all

    select
      'physical_therapy_assessment:' || assessment.assessment_key::text,
      'physical_therapy_assessment', 'physical_therapy', '物理治療',
      34, '物理治療評估',
      '/app/staff/professional-care/physical-assessment?client=' ||
        assessment.client_id::text,
      assessment.client_id, assessment.client_display_name,
      assessment.service_status, assessment.id, assessment.assessment_key,
      assessment.version, assessment.record_state,
      case
        when assessment.reassessment_due_on < boundary.cutoff_on
          then 'overdue'
        when assessment.record_state = 'draft' then 'pending'
        else 'completed'
      end,
      'configured_manual_due_date', 1,
      case when assessment.reassessment_due_on >= boundary.cutoff_on
        and assessment.record_state in ('signed', 'corrected')
        then 1 else 0 end,
      case when assessment.reassessment_due_on >= boundary.cutoff_on
        and assessment.record_state = 'draft'
        then 1 else 0 end,
      case when assessment.reassessment_due_on < boundary.cutoff_on
        then 1 else 0 end,
      0, assessment.assessed_on, assessment.reassessment_due_on,
      case
        when assessment.reassessment_due_on < boundary.cutoff_on
          then '人工複評日期已逾期'
        when assessment.record_state = 'draft' then '評估草稿待簽署'
        else '最近評估已簽署；複評日期為人工設定'
      end,
      assessment.content_hash
    from pt_assessment_ranked assessment cross join boundaries boundary
    where assessment.client_ordinal = 1

    union all

    select
      'chewing_assessment:' || assessment.assessment_key::text,
      'chewing_assessment', 'chewing', '咀嚼能力', 35, '咀嚼能力評估',
      '/app/staff/professional-care/chewing?client=' ||
        assessment.client_id::text,
      assessment.client_id, assessment.client_display_name,
      assessment.service_status, assessment.id, assessment.assessment_key,
      assessment.version, assessment.preview_status,
      'not_configured', 'candidate_only_form_not_published',
      0, 0, 0, 0, 0, assessment.assessed_on, null::date,
      '僅保存未啟用候選規則的預覽；不計為正式完成',
      assessment.content_hash
    from chewing_ranked assessment
    where assessment.client_ordinal = 1

    union all

    select
      'mna_assessment:' || assessment.assessment_key::text,
      'mna_assessment', 'nutrition', '營養', 36, 'MNA 營養評估',
      '/app/staff/professional-care/mna?client=' || assessment.client_id::text,
      assessment.client_id, assessment.client_display_name,
      assessment.service_status, assessment.id, assessment.assessment_key,
      assessment.version, assessment.record_state,
      'not_configured', 'license_required_not_configured',
      0, 0, 0, 0, 0, assessment.assessed_on,
      assessment.reassessment_due_on,
      '電子化授權與正式規則尚未設定；不計為正式完成',
      assessment.content_hash
    from mna_ranked assessment
    where assessment.client_ordinal = 1

    union all

    select
      'consultation:' || consultation.consultation_key::text,
      'consultation', 'consultation', consultation.discipline_label,
      37, '跨專業照會',
      '/app/staff/professional-care/consultations?client=' ||
        consultation.client_id::text,
      consultation.client_id, consultation.visible_client_display_name,
      consultation.service_status, consultation.id,
      consultation.consultation_key, consultation.sequence,
      consultation.status,
      case
        when consultation.status not in ('answered', 'closed')
          and consultation.due_at is not null
          and consultation.due_at < least(
            boundary.as_of_at,
            ((boundary.cutoff_on + 1)::timestamp at time zone 'Asia/Taipei')
          ) then 'overdue'
        when consultation.status in ('answered', 'closed') then 'completed'
        else 'pending'
      end,
      case when consultation.deadline_state = 'dated'
        then 'configured_manual_deadline'
        else 'deadline_' || consultation.deadline_state end,
      1,
      case when consultation.status in ('answered', 'closed') then 1 else 0 end,
      case when consultation.status not in ('answered', 'closed')
        and not (consultation.due_at is not null and consultation.due_at < least(
          boundary.as_of_at,
          ((boundary.cutoff_on + 1)::timestamp at time zone 'Asia/Taipei')
        )) then 1 else 0 end,
      case when consultation.status not in ('answered', 'closed')
        and consultation.due_at is not null and consultation.due_at < least(
          boundary.as_of_at,
          ((boundary.cutoff_on + 1)::timestamp at time zone 'Asia/Taipei')
        ) then 1 else 0 end,
      0,
      (consultation.occurred_at at time zone 'Asia/Taipei')::date,
      case when consultation.due_at is null then null::date
        else (consultation.due_at at time zone 'Asia/Taipei')::date end,
      case
        when consultation.status in ('answered', 'closed') then '照會已回覆或結案'
        when consultation.due_at is null then '照會待處理；期限為缺值或不適用'
        when consultation.due_at < least(
          boundary.as_of_at,
          ((boundary.cutoff_on + 1)::timestamp at time zone 'Asia/Taipei')
        ) then '照會已超過人工期限'
        else '照會待處理'
      end,
      consultation.content_hash
    from consultation_ranked consultation cross join boundaries boundary
    where consultation.event_ordinal = 1
      and (
        consultation.status not in ('answered', 'closed')
        or consultation.occurred_at >=
          (boundary.month_start::timestamp at time zone 'Asia/Taipei')
      )

    union all

    select
      'case_conference:' || conference.meeting_key::text,
      'case_conference', 'case_conference', '跨專業個案研討',
      38, '個案研討會議',
      '/app/staff/professional-care/case-conferences?client=' ||
        conference.client_id::text,
      conference.client_id, conference.visible_client_display_name,
      conference.service_status, conference.id, conference.meeting_key,
      conference.version, conference.status,
      case
        when exists (
          select 1 from jsonb_array_elements(conference.action_items) item
          where item ->> 'action_status' = 'open'
            and item ->> 'deadline_state' = 'dated'
            and (item ->> 'due_date')::date < boundary.cutoff_on
        ) then 'overdue'
        when conference.status = 'draft' or exists (
          select 1 from jsonb_array_elements(conference.action_items) item
          where item ->> 'action_status' = 'open'
        ) then 'pending'
        else 'completed'
      end,
      'configured_action_deadlines', 1,
      case when conference.status = 'signed' and not exists (
        select 1 from jsonb_array_elements(conference.action_items) item
        where item ->> 'action_status' = 'open'
      ) then 1 else 0 end,
      case when not exists (
        select 1 from jsonb_array_elements(conference.action_items) item
        where item ->> 'action_status' = 'open'
          and item ->> 'deadline_state' = 'dated'
          and (item ->> 'due_date')::date < boundary.cutoff_on
      ) and (conference.status = 'draft' or exists (
        select 1 from jsonb_array_elements(conference.action_items) item
        where item ->> 'action_status' = 'open'
      )) then 1 else 0 end,
      case when exists (
        select 1 from jsonb_array_elements(conference.action_items) item
        where item ->> 'action_status' = 'open'
          and item ->> 'deadline_state' = 'dated'
          and (item ->> 'due_date')::date < boundary.cutoff_on
      ) then 1 else 0 end,
      0,
      (conference.meeting_starts_at at time zone 'Asia/Taipei')::date,
      (
        select min((item ->> 'due_date')::date)
        from jsonb_array_elements(conference.action_items) item
        where item ->> 'action_status' = 'open'
          and item ->> 'deadline_state' = 'dated'
      ),
      case
        when conference.status = 'draft' then '會議紀錄草稿待簽署'
        when exists (
          select 1 from jsonb_array_elements(conference.action_items) item
          where item ->> 'action_status' = 'open'
            and item ->> 'deadline_state' = 'dated'
            and (item ->> 'due_date')::date < boundary.cutoff_on
        ) then '會議行動項目逾期'
        when exists (
          select 1 from jsonb_array_elements(conference.action_items) item
          where item ->> 'action_status' = 'open'
        ) then '會議行動項目待完成'
        else '會議紀錄與行動項目已完成'
      end,
      conference.content_hash
    from conference_ranked conference cross join boundaries boundary
    where conference.version_ordinal = 1

    union all

    select
      'referral:' || referral.referral_key::text,
      'referral', 'referral', '轉介', 39, '轉介管理',
      '/app/staff/professional-care/referrals?client=' || referral.client_id::text,
      referral.client_id, referral.visible_client_display_name,
      referral.service_status, referral.id, referral.referral_key,
      referral.sequence, referral.status,
      case when referral.status in ('responded', 'closed')
        then 'completed' else 'pending' end,
      'due_rule_not_configured', 1,
      case when referral.status in ('responded', 'closed') then 1 else 0 end,
      case when referral.status not in ('responded', 'closed') then 1 else 0 end,
      0, 0,
      (referral.occurred_at at time zone 'Asia/Taipei')::date,
      null::date,
      case when referral.status in ('responded', 'closed')
        then '轉介已回覆或結案'
        else '轉介待處理；期限規則尚未設定' end,
      referral.content_hash
    from referral_ranked referral cross join boundaries boundary
    where referral.event_ordinal = 1
      and (
        referral.status not in ('responded', 'closed')
        or referral.occurred_at >=
          (boundary.month_start::timestamp at time zone 'Asia/Taipei')
      )

    union all

    select
      'physical_therapy_service:' || service.client_id::text || ':' ||
        to_char(p_month, 'YYYY-MM'),
      'physical_therapy_service', 'physical_therapy', '物理治療',
      40, '物理治療服務紀錄',
      '/app/staff/professional-care/physical-services?client=' ||
        service.client_id::text || '&from=' || to_char(p_month, 'YYYY-MM-DD') ||
        '&to=' || to_char(
          (p_month + interval '1 month' - interval '1 day')::date,
          'YYYY-MM-DD'
        ),
      service.client_id, service.client_display_name, service.service_status,
      service.latest_id, service.latest_key, service.latest_version,
      case when service.pending_count > 0 then 'draft_present'
        else 'all_terminal' end,
      case when service.pending_count > 0 then 'pending' else 'completed' end,
      'existing_records_only_frequency_not_configured',
      service.service_count, service.completed_count, service.pending_count,
      0, service.service_count, service.latest_on, null::date,
      case when service.pending_count > 0
        then service.pending_count::text || ' 筆服務草稿待簽署；服務頻率未設定'
        else '本月既有服務紀錄均已簽署；服務頻率未設定' end,
      service.source_hash
    from pt_service_group service

    union all

    select
      'occupational_therapy_service:' || service.client_id::text || ':' ||
        to_char(p_month, 'YYYY-MM'),
      'occupational_therapy_service', 'occupational_therapy', '職能治療',
      41, '職能治療服務紀錄',
      '/app/staff/professional-care/occupational-services?client=' ||
        service.client_id::text || '&from=' || to_char(p_month, 'YYYY-MM-DD') ||
        '&to=' || to_char(
          (p_month + interval '1 month' - interval '1 day')::date,
          'YYYY-MM-DD'
        ),
      service.client_id, service.client_display_name, service.service_status,
      service.latest_id, service.latest_key, service.latest_version,
      case when service.pending_count > 0 then 'draft_present'
        else 'all_terminal' end,
      case when service.pending_count > 0 then 'pending' else 'completed' end,
      'existing_records_only_frequency_not_configured',
      service.service_count, service.completed_count, service.pending_count,
      0, service.service_count, service.latest_on, null::date,
      case when service.pending_count > 0
        then service.pending_count::text || ' 筆服務草稿待簽署；服務頻率未設定'
        else '本月既有服務紀錄均已簽署；服務頻率未設定' end,
      service.source_hash
    from ot_service_group service
  ), filtered_items as materialized (
    select item.*
    from raw_items item
    where (p_client_id is null or item.client_id = p_client_id)
      and (p_professional_kind = 'all'
        or item.professional_kind = p_professional_kind)
      and (p_summary_status = 'all'
        or item.summary_status = p_summary_status)
  ), ranked_items as materialized (
    select item.*, row_number() over (
      order by item.client_display_name collate "C",
        item.professional_label collate "C", item.source_page,
        item.latest_on desc nulls last, item.item_id
    ) as ordinal
    from filtered_items item
  ), item_result as (
    select count(*)::bigint as item_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'item_id', item.item_id,
        'source_kind', item.source_kind,
        'professional_kind', item.professional_kind,
        'professional_label', item.professional_label,
        'source_page', item.source_page,
        'source_page_title', item.source_page_title,
        'source_href', item.source_href,
        'client_id', item.client_id,
        'client_display_name', item.client_display_name,
        'service_status', item.service_status,
        'source_record_id', item.source_record_id,
        'source_record_key', item.source_record_key,
        'source_version', item.source_version,
        'raw_status', item.raw_status,
        'summary_status', item.summary_status,
        'expectation_status', item.expectation_status,
        'expected_count', item.expected_count,
        'completed_count', item.completed_count,
        'pending_count', item.pending_count,
        'overdue_count', item.overdue_count,
        'service_count', item.service_count,
        'latest_on', item.latest_on,
        'next_due_on', item.next_due_on,
        'status_reason', item.status_reason,
        'source_hash', item.source_hash
      ) order by item.client_display_name collate "C",
        item.professional_label collate "C", item.source_page,
        item.latest_on desc nulls last, item.item_id)
        filter (where item.ordinal <= 300), '[]'::jsonb) as items
    from ranked_items item
  ), metrics as (
    select
      coalesce(sum(expected_count), 0)::bigint as expected_total,
      coalesce(sum(completed_count), 0)::bigint as completed_total,
      coalesce(sum(pending_count), 0)::bigint as pending_total,
      coalesce(sum(overdue_count), 0)::bigint as overdue_total,
      coalesce(sum(service_count), 0)::bigint as service_total,
      count(*) filter (where summary_status = 'not_configured')::bigint
        as not_configured_item_total
    from filtered_items
  ), client_ranked as materialized (
    select client.*, row_number() over (
      order by client.display_name collate "C", client.id
    ) as ordinal
    from visible_clients client
  ), client_result as (
    select count(*)::bigint as client_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'client_id', client.id,
        'display_name', client.display_name,
        'service_status', client.service_status
      ) order by client.display_name collate "C", client.id)
        filter (where client.ordinal <= 200), '[]'::jsonb) as client_options
    from client_ranked client
  )
  select jsonb_build_object(
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_reference_time,
    'month', to_char(p_month, 'YYYY-MM'),
    'month_start', boundary.month_start,
    'month_end', boundary.month_end,
    'cutoff_on', boundary.cutoff_on,
    'items', item_result.items,
    'item_count', jsonb_array_length(item_result.items),
    'item_total', item_result.item_total,
    'items_truncated', item_result.item_total >
      jsonb_array_length(item_result.items),
    'metrics', jsonb_build_object(
      'expected', metrics.expected_total,
      'completed', metrics.completed_total,
      'pending', metrics.pending_total,
      'overdue', metrics.overdue_total,
      'service_records', metrics.service_total,
      'not_configured_items', metrics.not_configured_item_total
    ),
    'client_options', client_result.client_options,
    'client_total', client_result.client_total,
    'client_options_truncated', client_result.client_total >
      jsonb_array_length(client_result.client_options),
    'source_configuration', jsonb_build_array(
      jsonb_build_object('source_kind', 'occupational_therapy_assessment',
        'source_page', 33, 'data_status', 'configured',
        'expectation_status', 'manual_due_date_only'),
      jsonb_build_object('source_kind', 'physical_therapy_assessment',
        'source_page', 34, 'data_status', 'configured',
        'expectation_status', 'manual_due_date_only'),
      jsonb_build_object('source_kind', 'chewing_assessment',
        'source_page', 35, 'data_status', 'candidate_only',
        'expectation_status', 'not_configured'),
      jsonb_build_object('source_kind', 'mna_assessment',
        'source_page', 36, 'data_status', 'license_required_not_configured',
        'expectation_status', 'not_configured'),
      jsonb_build_object('source_kind', 'consultation',
        'source_page', 37, 'data_status', 'configured',
        'expectation_status', 'manual_deadline_or_explicit_missing_state'),
      jsonb_build_object('source_kind', 'case_conference',
        'source_page', 38, 'data_status', 'configured',
        'expectation_status', 'action_deadline_only'),
      jsonb_build_object('source_kind', 'referral',
        'source_page', 39, 'data_status', 'configured',
        'expectation_status', 'due_rule_not_configured'),
      jsonb_build_object('source_kind', 'physical_therapy_service',
        'source_page', 40, 'data_status', 'configured',
        'expectation_status', 'existing_records_only_frequency_not_configured'),
      jsonb_build_object('source_kind', 'occupational_therapy_service',
        'source_page', 41, 'data_status', 'configured',
        'expectation_status', 'existing_records_only_frequency_not_configured')
    ),
    'source_configuration_count', 9,
    'configured_source_count', 7,
    'not_configured_source_count', 2,
    'expectation_coverage_status', 'partial_authoritative_rows_only',
    'missing_schedule_claim', 'not_made',
    'export_status', 'immutable_snapshot_available',
    'offline_status', 'not_configured'
  )
  from boundaries boundary cross join item_result cross join metrics
  cross join client_result;
$$;

create or replace function private.create_professional_service_summary_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_month date,
  p_client_id uuid,
  p_professional_kind text,
  p_summary_status text
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  expires_at timestamptz,
  payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_professional_kind text := lower(coalesce(
    nullif(btrim(p_professional_kind), ''), 'all'
  ));
  v_summary_status text := lower(coalesce(
    nullif(btrim(p_summary_status), ''), 'all'
  ));
  v_payload jsonb;
  v_snapshot_id uuid := gen_random_uuid();
  v_hash text;
  v_expires timestamptz := v_now + interval '15 minutes';
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_month is null
     or p_month <> date_trunc('month', p_month)::date
     or extract(year from p_month) not between 2000 and 2200
     or v_professional_kind not in (
       'all', 'occupational_therapy', 'physical_therapy', 'chewing',
       'nutrition', 'consultation', 'case_conference', 'referral'
     )
     or v_summary_status not in (
       'all', 'completed', 'pending', 'overdue', 'not_configured'
     )
     or not private.professional_service_summary_authority(
       p_expected_organization_id, p_expected_branch_id,
       'professional_service_summary.read'
     ) then
    raise exception using errcode = '42501',
      message = 'professional service summary snapshot is not permitted';
  end if;

  if p_client_id is not null and
     not private.professional_service_summary_client_authority(
       p_expected_organization_id, p_expected_branch_id, p_client_id,
       'professional_service_summary.read'
     ) then
    raise exception using errcode = '42501',
      message = 'professional service summary client filter is not permitted';
  end if;

  v_payload := private.professional_service_summary_bundle(
    p_expected_organization_id, p_expected_branch_id, p_month, p_client_id,
    v_professional_kind, v_summary_status, v_now
  );
  if v_payload is null then
    raise exception using errcode = '55000',
      message = 'professional service summary snapshot is unavailable';
  end if;
  v_hash := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  -- Opportunistic bounded retention; no expired snapshot can be exported.
  delete from private.professional_service_summary_snapshots snapshot
  where snapshot.expires_at <= v_now;

  insert into private.professional_service_summary_snapshots (
    id, organization_id, branch_id, actor_user_id, selected_month,
    filter_client_id, filter_professional_kind, filter_summary_status,
    payload, payload_hash, created_at, expires_at
  ) values (
    v_snapshot_id, p_expected_organization_id, p_expected_branch_id, v_actor,
    p_month, p_client_id, v_professional_kind, v_summary_status, v_payload,
    v_hash, v_now, v_expires
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'select',
    'professional_service_summary_snapshots', v_snapshot_id, '{}'::text[],
    jsonb_build_object(
      'projection', 'page42_professional_service_summary_v1',
      'snapshot_hash', v_hash,
      'item_count', (v_payload ->> 'item_count')::integer,
      'item_total', (v_payload ->> 'item_total')::bigint,
      'items_truncated', (v_payload ->> 'items_truncated')::boolean,
      'source_configuration_count', 9,
      'filter_values_logged', false,
      'client_names_logged', false
    )
  );

  if not private.professional_service_summary_authority(
       p_expected_organization_id, p_expected_branch_id,
       'professional_service_summary.read'
     ) then
    raise exception using errcode = '42501',
      message = 'professional service summary authority changed';
  end if;

  return query select v_snapshot_id, v_hash, v_expires, v_payload;
end;
$$;

create or replace function private.export_professional_service_summary_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_snapshot_id uuid
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  expires_at timestamptz,
  payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_row private.professional_service_summary_snapshots%rowtype;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
     or p_snapshot_id is null
     or not private.professional_service_summary_authority(
       p_expected_organization_id, p_expected_branch_id,
       'professional_service_summary.export'
     )
     or not private.has_recent_aal2(15) then
    raise exception using errcode = '42501',
      message = 'professional service summary export is not permitted';
  end if;

  select snapshot.* into v_row
  from private.professional_service_summary_snapshots snapshot
  where snapshot.id = p_snapshot_id
    and snapshot.organization_id = p_expected_organization_id
    and snapshot.branch_id = p_expected_branch_id
    and snapshot.actor_user_id = v_actor
    and snapshot.expires_at > v_now
  for share;

  if not found then
    raise exception using errcode = '42501',
      message = 'professional service summary export is not permitted';
  end if;
  if v_row.payload_hash <> encode(
       sha256(convert_to(v_row.payload::text, 'UTF8')), 'hex'
     ) then
    raise exception using errcode = '55000',
      message = 'professional service summary snapshot integrity failed';
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id, p_expected_branch_id, v_actor, 'export',
    'professional_service_summary_snapshots', p_snapshot_id, '{}'::text[],
    jsonb_build_object(
      'projection', 'page42_professional_service_summary_v1',
      'snapshot_hash', v_row.payload_hash,
      'item_count', (v_row.payload ->> 'item_count')::integer,
      'item_total', (v_row.payload ->> 'item_total')::bigint,
      'filter_values_logged', false,
      'client_names_logged', false
    )
  );

  return query
  select v_row.id, v_row.payload_hash, v_row.expires_at, v_row.payload;
end;
$$;

create or replace function public.professional_service_summary_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_month date,
  p_client_id uuid default null,
  p_professional_kind text default 'all',
  p_summary_status text default 'all'
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  expires_at timestamptz,
  payload jsonb
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.create_professional_service_summary_snapshot(
    p_expected_organization_id, p_expected_branch_id, p_month, p_client_id,
    p_professional_kind, p_summary_status
  );
$$;

create or replace function public.professional_service_summary_export_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_snapshot_id uuid
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  expires_at timestamptz,
  payload jsonb
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.export_professional_service_summary_snapshot(
    p_expected_organization_id, p_expected_branch_id, p_snapshot_id
  );
$$;

revoke all on function private.professional_service_summary_authority(uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.professional_service_summary_snapshot_is_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.professional_service_summary_client_authority(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.create_professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.export_professional_service_summary_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.professional_service_summary_export_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)
  to authenticated;
grant execute on function public.professional_service_summary_export_snapshot(uuid,uuid,uuid)
  to authenticated;
grant execute on function private.create_professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)
  to authenticated;
grant execute on function private.export_professional_service_summary_snapshot(uuid,uuid,uuid)
  to authenticated;

comment on function public.professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)
is 'Page 42 assigned-client monthly snapshot. Metrics, bounded detail and export derive from the same persisted payload; unavailable schedules and governed tools are explicit.';
comment on function public.professional_service_summary_export_snapshot(uuid,uuid,uuid)
is 'Returns only the current actor own unexpired Page 42 payload after recent same-session AAL2 and integrity verification.';
