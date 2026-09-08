-- Page 45: bounded staff in-app notification management.
--
-- The existing enqueue_staff_notification transaction remains the writer of
-- record.  This migration adds a narrower page-specific wrapper, an audited
-- recipient preview, and one audited management snapshot.  PWA, LINE, SMS,
-- family recipients, platform operators, and retry-worker controls remain
-- intentionally unreachable through this boundary.

create index if not exists notifications_page45_scope_time_idx
  on public.notifications (organization_id, branch_id, created_at desc, id desc)
  where (audience ->> 'recipient_kind') = 'staff';

create or replace function private.push_notification_current_authority(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.kind in ('staff', 'professional', 'driver', 'finance')
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
      p_expected_organization_id,
      p_expected_branch_id,
      'notifications.manage'
    );
$$;

create or replace function private.push_notification_staff_recipient_is_current(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_recipient_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.memberships membership
      on membership.profile_id = profile.id
    where profile.id = p_recipient_user_id
      and profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= clock_timestamp()
      and (membership.ends_at is null or membership.ends_at > clock_timestamp())
      and (
        membership.branch_id is null
        or membership.branch_id = p_expected_branch_id
      )
  );
$$;

create or replace function private.push_notification_recipient_preview_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_recipient_user_ids uuid[]
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  recipients jsonb,
  recipient_count integer,
  channel text,
  persisted boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_recipients uuid[];
  v_items jsonb;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_recipient_user_ids is null
     or cardinality(p_recipient_user_ids) not between 1 and 500
     or not private.push_notification_current_authority(
       p_expected_organization_id,
       p_expected_branch_id
     ) then
    raise exception using
      errcode = '42501',
      message = 'push notification recipient preview is not permitted in the selected tenant context';
  end if;

  select array_agg(distinct recipient order by recipient)
    into v_recipients
  from unnest(p_recipient_user_ids) recipient;

  if cardinality(v_recipients) not between 1 and 500
     or exists (
       select 1
       from unnest(v_recipients) recipient
       where not private.push_notification_staff_recipient_is_current(
         p_expected_organization_id,
         p_expected_branch_id,
         recipient
       )
     ) then
    raise exception using
      errcode = '42501',
      message = 'one or more push notification recipients are outside the selected active staff scope';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', recipient_row.user_id,
    'display_name', recipient_row.display_name,
    'profile_kind', recipient_row.profile_kind
  ) order by recipient_row.display_name collate "C", recipient_row.user_id), '[]'::jsonb)
    into v_items
  from (
    select profile.id as user_id, profile.display_name, profile.kind as profile_kind
    from public.profiles profile
    where profile.id = any(v_recipients)
  ) recipient_row;

  if jsonb_array_length(v_items) <> cardinality(v_recipients)
     or not private.push_notification_current_authority(
       p_expected_organization_id,
       p_expected_branch_id
     ) then
    raise exception using
      errcode = '42501',
      message = 'push notification recipient preview authority expired';
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
    'push_notification_recipient_preview',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page45_staff_in_app_preview_v1',
      'recipient_count', cardinality(v_recipients),
      'channel', 'in_app'
    )
  );

  if not private.push_notification_current_authority(
    p_expected_organization_id,
    p_expected_branch_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'push notification recipient preview authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_items,
    cardinality(v_recipients),
    'in_app'::text,
    false;
end;
$$;

create or replace function public.preview_in_app_staff_notification_recipients(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_recipient_user_ids uuid[]
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  recipients jsonb,
  recipient_count integer,
  channel text,
  persisted boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.push_notification_recipient_preview_response(
    p_expected_organization_id,
    p_expected_branch_id,
    p_recipient_user_ids
  );
$$;

create or replace function private.enqueue_in_app_staff_notification_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_category text,
  p_priority smallint,
  p_title text,
  p_body text,
  p_recipient_user_ids uuid[],
  p_scheduled_for timestamptz,
  p_idempotency_key uuid
)
returns table(
  notification_id uuid,
  delivery_count integer,
  notification_status text,
  scheduled_for timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_recipients uuid[];
  v_existing boolean;
  v_result record;
  v_notification public.notifications%rowtype;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_recipient_user_ids is null
     or p_idempotency_key is null
     or cardinality(p_recipient_user_ids) not between 1 and 500
     or not private.push_notification_current_authority(
       p_expected_organization_id,
       p_expected_branch_id
     ) then
    raise exception using
      errcode = '42501',
      message = 'in-app staff notification queue is not permitted in the selected tenant context';
  end if;

  select array_agg(distinct recipient order by recipient)
    into v_recipients
  from unnest(p_recipient_user_ids) recipient;

  -- Serialize on exactly the same actor-scoped key used by the shared atomic
  -- writer.  Existing exact replays intentionally survive later recipient
  -- deactivation, while a new write always revalidates every current staff
  -- recipient before the shared transaction is entered.
  perform pg_advisory_xact_lock(hashtextextended(
    'notification-queue:' || p_expected_organization_id::text || ':' ||
    v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select exists (
    select 1
    from public.notifications notification
    where notification.organization_id = p_expected_organization_id
      and notification.created_by = v_actor
      and notification.queue_idempotency_key = p_idempotency_key
  ) into v_existing;

  if not v_existing and (
    cardinality(v_recipients) not between 1 and 500
    or exists (
      select 1
      from unnest(v_recipients) recipient
      where not private.push_notification_staff_recipient_is_current(
        p_expected_organization_id,
        p_expected_branch_id,
        recipient
      )
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'one or more in-app notification recipients are outside the selected active staff scope';
  end if;

  select * into strict v_result
  from private.enqueue_staff_notification_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_category,
    p_priority,
    p_title,
    p_body,
    v_recipients,
    array['in_app']::text[],
    p_scheduled_for,
    'page45_push_notification',
    null,
    p_idempotency_key
  );

  select notification.* into strict v_notification
  from public.notifications notification
  where notification.id = v_result.notification_id
    and notification.organization_id = p_expected_organization_id
    and notification.branch_id = p_expected_branch_id
    and notification.created_by = v_actor;

  if v_notification.source_type <> 'page45_push_notification'
     or v_notification.audience ->> 'recipient_kind' <> 'staff'
     or v_notification.audience -> 'channels' <> '["in_app"]'::jsonb
     or v_result.delivery_count <> cardinality(v_recipients)
     or not private.push_notification_current_authority(
       p_expected_organization_id,
       p_expected_branch_id
     ) then
    raise exception using
      errcode = '42501',
      message = 'in-app staff notification persisted receipt is outside the guarded boundary';
  end if;

  return query select
    v_notification.id,
    v_result.delivery_count::integer,
    v_notification.status,
    v_notification.scheduled_for,
    v_result.replayed::boolean;
end;
$$;

create or replace function public.enqueue_in_app_staff_notification(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_category text,
  p_priority smallint,
  p_title text,
  p_body text,
  p_recipient_user_ids uuid[],
  p_scheduled_for timestamptz,
  p_idempotency_key uuid
)
returns table(
  notification_id uuid,
  delivery_count integer,
  notification_status text,
  scheduled_for timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.enqueue_in_app_staff_notification_guarded(
    p_expected_organization_id,
    p_expected_branch_id,
    p_category,
    p_priority,
    p_title,
    p_body,
    p_recipient_user_ids,
    p_scheduled_for,
    p_idempotency_key
  );
$$;

create or replace function private.push_notification_management_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  recipients jsonb,
  recipient_total bigint,
  recipients_truncated boolean,
  notifications jsonb,
  notification_total bigint,
  notifications_truncated boolean,
  scheduled_total bigint,
  queued_delivery_total bigint,
  read_or_confirmed_total bigint,
  failed_delivery_total bigint,
  provider_boundary text,
  family_boundary text,
  retry_boundary text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_recipients jsonb;
  v_recipient_total bigint;
  v_notifications jsonb;
  v_notification_total bigint;
  v_scheduled_total bigint;
  v_queued_delivery_total bigint;
  v_read_or_confirmed_total bigint;
  v_failed_delivery_total bigint;
begin
  if p_expected_organization_id is null
     or p_expected_branch_id is null
     or not private.push_notification_current_authority(
       p_expected_organization_id,
       p_expected_branch_id
     ) then
    raise exception using
      errcode = '42501',
      message = 'push notification management snapshot is not permitted in the selected tenant context';
  end if;

  with eligible_recipients as materialized (
    select
      profile.id as user_id,
      profile.display_name,
      profile.employee_code,
      profile.kind as profile_kind,
      case
        when bool_or(membership.branch_id = p_expected_branch_id) then 'branch'
        else 'organization'
      end as membership_scope,
      coalesce(
        array_agg(distinct role.name order by role.name)
          filter (where role.name is not null),
        '{}'::text[]
      ) as role_names
    from public.profiles profile
    join public.memberships membership
      on membership.profile_id = profile.id
    left join public.membership_roles membership_role
      on membership_role.membership_id = membership.id
    left join public.roles role
      on role.id = membership_role.role_id
     and role.is_active
     and (role.organization_id is null or role.organization_id = p_expected_organization_id)
    where profile.kind in ('staff', 'professional', 'driver', 'finance')
      and profile.is_active
      and membership.organization_id = p_expected_organization_id
      and membership.status = 'active'
      and membership.starts_at <= v_now
      and (membership.ends_at is null or membership.ends_at > v_now)
      and (
        membership.branch_id is null
        or membership.branch_id = p_expected_branch_id
      )
    group by profile.id
  ), recipient_stats as (
    select count(*)::bigint as recipient_total
    from eligible_recipients
  ), limited_recipients as materialized (
    select *
    from eligible_recipients
    order by display_name collate "C", user_id
    limit 500
  )
  select
    recipient_stats.recipient_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', recipient.user_id,
        'display_name', recipient.display_name,
        'employee_code', recipient.employee_code,
        'profile_kind', recipient.profile_kind,
        'membership_scope', recipient.membership_scope,
        'role_names', recipient.role_names
      ) order by recipient.display_name collate "C", recipient.user_id)
      from limited_recipients recipient
    ), '[]'::jsonb)
  into v_recipient_total, v_recipients
  from recipient_stats;

  with managed_notifications as materialized (
    select
      notification.id,
      notification.category,
      notification.priority,
      notification.title,
      notification.body,
      notification.status as notification_status,
      notification.scheduled_for,
      notification.created_at,
      case
        when notification.created_by = v_actor then '本人'
        else creator.display_name
      end as created_by_label,
      count(delivery.id)::integer as delivery_total,
      count(delivery.id) filter (where delivery.status = 'queued')::integer as queued_count,
      count(delivery.id) filter (where delivery.status = 'sent')::integer as sent_count,
      count(delivery.id) filter (where delivery.status = 'delivered')::integer as delivered_count,
      count(delivery.id) filter (where delivery.status = 'read')::integer as read_count,
      count(delivery.id) filter (where delivery.status = 'confirmed')::integer as confirmed_count,
      count(delivery.id) filter (where delivery.status = 'failed')::integer as failed_count,
      count(delivery.id) filter (where delivery.status = 'suppressed')::integer as suppressed_count
    from public.notifications notification
    join public.profiles creator on creator.id = notification.created_by
    left join public.notification_deliveries delivery
      on delivery.notification_id = notification.id
     and delivery.organization_id = notification.organization_id
     and delivery.branch_id = notification.branch_id
     and delivery.channel = 'in_app'
    where notification.organization_id = p_expected_organization_id
      and notification.branch_id = p_expected_branch_id
      and notification.source_type = 'page45_push_notification'
      and notification.audience ->> 'recipient_kind' = 'staff'
      and notification.audience -> 'channels' = '["in_app"]'::jsonb
    group by notification.id, creator.display_name
  ), notification_stats as (
    select
      count(*)::bigint as notification_total,
      count(*) filter (
        where notification_status = 'scheduled'
          and scheduled_for > v_now
      )::bigint as scheduled_total,
      coalesce(sum(queued_count), 0)::bigint as queued_delivery_total,
      coalesce(sum(read_count + confirmed_count), 0)::bigint as read_or_confirmed_total,
      coalesce(sum(failed_count), 0)::bigint as failed_delivery_total
    from managed_notifications
  ), limited_notifications as materialized (
    select *
    from managed_notifications
    order by created_at desc, id desc
    limit 100
  )
  select
    stats.notification_total,
    stats.scheduled_total,
    stats.queued_delivery_total,
    stats.read_or_confirmed_total,
    stats.failed_delivery_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'notification_id', notification.id,
        'category', notification.category,
        'priority', notification.priority,
        'title', notification.title,
        'body', notification.body,
        'notification_status', notification.notification_status,
        'scheduled_for', notification.scheduled_for,
        'created_at', notification.created_at,
        'created_by_label', notification.created_by_label,
        'delivery_total', notification.delivery_total,
        'queued_count', notification.queued_count,
        'sent_count', notification.sent_count,
        'delivered_count', notification.delivered_count,
        'read_count', notification.read_count,
        'confirmed_count', notification.confirmed_count,
        'failed_count', notification.failed_count,
        'suppressed_count', notification.suppressed_count
      ) order by notification.created_at desc, notification.id desc)
      from limited_notifications notification
    ), '[]'::jsonb)
  into
    v_notification_total,
    v_scheduled_total,
    v_queued_delivery_total,
    v_read_or_confirmed_total,
    v_failed_delivery_total,
    v_notifications
  from notification_stats stats;

  if not private.push_notification_current_authority(
    p_expected_organization_id,
    p_expected_branch_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'push notification management snapshot authority expired';
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
    'push_notification_management_snapshot',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page45_staff_in_app_management_v1',
      'recipient_count', jsonb_array_length(v_recipients),
      'recipient_total', v_recipient_total,
      'recipients_truncated', v_recipient_total > jsonb_array_length(v_recipients),
      'recipient_limit', 500,
      'notification_count', jsonb_array_length(v_notifications),
      'notification_total', v_notification_total,
      'notifications_truncated', v_notification_total > jsonb_array_length(v_notifications),
      'notification_limit', 100
    )
  );

  if not private.push_notification_current_authority(
    p_expected_organization_id,
    p_expected_branch_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'push notification management snapshot authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_recipients,
    v_recipient_total,
    v_recipient_total > jsonb_array_length(v_recipients),
    v_notifications,
    v_notification_total,
    v_notification_total > jsonb_array_length(v_notifications),
    v_scheduled_total,
    v_queued_delivery_total,
    v_read_or_confirmed_total,
    v_failed_delivery_total,
    'in_app_only_no_delivery_worker'::text,
    'relationship_consent_not_available'::text,
    'partial_retry_worker_not_available'::text;
end;
$$;

create or replace function public.push_notification_management_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  recipients jsonb,
  recipient_total bigint,
  recipients_truncated boolean,
  notifications jsonb,
  notification_total bigint,
  notifications_truncated boolean,
  scheduled_total bigint,
  queued_delivery_total bigint,
  read_or_confirmed_total bigint,
  failed_delivery_total bigint,
  provider_boundary text,
  family_boundary text,
  retry_boundary text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.push_notification_management_snapshot_response(
    p_expected_organization_id,
    p_expected_branch_id
  );
$$;

comment on function public.preview_in_app_staff_notification_recipients(uuid, uuid, uuid[]) is
  'Audits and returns the exact current page-45 active staff recipient preview for in-app only.';
comment on function public.enqueue_in_app_staff_notification(uuid, uuid, text, smallint, text, text, uuid[], timestamptz, uuid) is
  'Queues or exactly replays one actor-scoped page-45 staff in-app notification through the shared atomic writer.';
comment on function public.push_notification_management_snapshot(uuid, uuid) is
  'Returns the bounded audited page-45 staff recipient and in-app notification management projection.';

revoke all on function private.push_notification_current_authority(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.push_notification_staff_recipient_is_current(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.push_notification_recipient_preview_response(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_in_app_staff_notification_guarded(uuid, uuid, text, smallint, text, text, uuid[], timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.push_notification_management_snapshot_response(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.preview_in_app_staff_notification_recipients(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_in_app_staff_notification(uuid, uuid, text, smallint, text, text, uuid[], timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.push_notification_management_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.push_notification_current_authority(uuid, uuid)
  to authenticated;
grant execute on function private.push_notification_staff_recipient_is_current(uuid, uuid, uuid)
  to authenticated;
grant execute on function private.push_notification_recipient_preview_response(uuid, uuid, uuid[])
  to authenticated;
grant execute on function private.enqueue_in_app_staff_notification_guarded(uuid, uuid, text, smallint, text, text, uuid[], timestamptz, uuid)
  to authenticated;
grant execute on function private.push_notification_management_snapshot_response(uuid, uuid)
  to authenticated;
grant execute on function public.preview_in_app_staff_notification_recipients(uuid, uuid, uuid[])
  to authenticated;
grant execute on function public.enqueue_in_app_staff_notification(uuid, uuid, text, smallint, text, text, uuid[], timestamptz, uuid)
  to authenticated;
grant execute on function public.push_notification_management_snapshot(uuid, uuid)
  to authenticated;
