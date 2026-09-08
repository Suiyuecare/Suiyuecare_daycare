-- Page 67: recipient-owned notification center.
--
-- The page reads one bounded, audited, tenant/branch-scoped projection and
-- acknowledges only the current actor's in-app delivery.  The existing
-- acknowledgement ledger remains the immutable exact-replay source of truth.
-- Priority 3 is the current technical maximum and is the only level that may
-- be explicitly confirmed.  A business-owned confirmation deadline and
-- escalation rule have not been published, so this migration deliberately
-- does not invent an overdue calculation.

create index if not exists notification_deliveries_recipient_in_app_scope_idx
  on public.notification_deliveries (
    organization_id,
    branch_id,
    recipient_user_id,
    notification_id
  )
  where channel = 'in_app';

create or replace function private.notification_center_snapshot_response(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  unread_total bigint,
  confirmation_pending_total bigint,
  today_total bigint,
  items_truncated boolean,
  confirmation_rule_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_items jsonb;
  v_item_total bigint;
  v_unread_total bigint;
  v_confirmation_pending_total bigint;
  v_today_total bigint;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.profiles profile
       where profile.id = v_actor
         and profile.kind <> 'family'
         and profile.is_active
     )
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'notification center snapshot is not permitted in the selected tenant context';
  end if;

  -- Counts and rows are derived from one materialized eligible set in one SQL
  -- statement. This prevents a concurrent delivery change from producing a
  -- count projection and item projection from different command snapshots.
  with eligible as materialized (
    select
      delivery.id as delivery_id,
      notification.id as notification_id,
      notification.category,
      notification.priority,
      notification.title,
      notification.body,
      notification.source_type,
      notification.source_id,
      coalesce(notification.scheduled_for, notification.created_at) as available_at,
      delivery.status,
      delivery.read_at,
      delivery.confirmed_at,
      notification.priority = 3
        and delivery.confirmed_at is null
        and delivery.status in ('queued', 'sent', 'delivered', 'read')
        as confirmation_pending,
      delivery.read_at is null
        and delivery.status in ('queued', 'sent', 'delivered')
        as unread
    from public.notification_deliveries delivery
    join public.notifications notification
      on notification.id = delivery.notification_id
     and notification.organization_id = delivery.organization_id
    where delivery.organization_id = p_expected_organization_id
      and delivery.branch_id = p_expected_branch_id
      and delivery.recipient_user_id = v_actor
      and delivery.channel = 'in_app'
      and notification.branch_id = p_expected_branch_id
      and notification.status in ('scheduled', 'sending', 'sent')
      and coalesce(notification.scheduled_for, notification.created_at) <= v_now
  ), stats as (
    select
      count(*)::bigint as item_total,
      count(*) filter (where item.unread)::bigint as unread_total,
      count(*) filter (where item.confirmation_pending)::bigint
        as confirmation_pending_total,
      count(*) filter (
        where (item.available_at at time zone 'Asia/Taipei')::date =
          (v_now at time zone 'Asia/Taipei')::date
      )::bigint as today_total
    from eligible item
  ), limited as materialized (
    select item.*
    from eligible item
    order by
      item.confirmation_pending desc,
      item.unread desc,
      item.priority desc,
      item.available_at desc,
      item.delivery_id
    limit 200
  )
  select
    stats.item_total,
    stats.unread_total,
    stats.confirmation_pending_total,
    stats.today_total,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'delivery_id', item.delivery_id,
        'notification_id', item.notification_id,
        'category', item.category,
        'priority', item.priority,
        'title', item.title,
        'body', item.body,
        'source_type', item.source_type,
        'source_id', item.source_id,
        'available_at', item.available_at,
        'status', item.status,
        'read_at', item.read_at,
        'confirmed_at', item.confirmed_at,
        'requires_confirmation', item.priority = 3
      ) order by
        item.confirmation_pending desc,
        item.unread desc,
        item.priority desc,
        item.available_at desc,
        item.delivery_id)
      from limited item
    ), '[]'::jsonb)
  into
    v_item_total,
    v_unread_total,
    v_confirmation_pending_total,
    v_today_total,
    v_items
  from stats;

  -- Recheck live authorization after the bounded materialized projection and
  -- before writing its audit event.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'notification center snapshot authority expired';
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
    'notification_center_snapshot',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page67_recipient_in_app_v1',
      'item_count', jsonb_array_length(v_items),
      'item_total', v_item_total,
      'unread_total', v_unread_total,
      'confirmation_pending_total', v_confirmation_pending_total,
      'today_total', v_today_total,
      'items_truncated', v_item_total > jsonb_array_length(v_items),
      'item_limit', 200,
      'confirmation_rule_status', 'technical_priority_3_only'
    )
  );

  -- A successful audit write must not become a stale-authority escape hatch.
  -- Recheck the complete branch and staff boundary immediately before return.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'notification center snapshot authority expired';
  end if;

  return query select
    p_expected_organization_id,
    p_expected_branch_id,
    v_now,
    v_items,
    v_item_total,
    v_unread_total,
    v_confirmation_pending_total,
    v_today_total,
    v_item_total > jsonb_array_length(v_items),
    'technical_priority_3_only'::text;
end;
$$;

create or replace function public.notification_center_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid
)
returns table(
  organization_id uuid,
  branch_id uuid,
  generated_at timestamptz,
  items jsonb,
  item_total bigint,
  unread_total bigint,
  confirmation_pending_total bigint,
  today_total bigint,
  items_truncated boolean,
  confirmation_rule_status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.notification_center_snapshot_response(
    p_expected_organization_id,
    p_expected_branch_id
  );
$$;

comment on function public.notification_center_snapshot(uuid, uuid) is
  'Returns the current staff recipients bounded and audited in-app notification projection for page 67.';

-- A guarded shim preserves the original immutable acknowledgement ledger but
-- closes its legacy AAL1 and stale-membership replay gap. Page 67 only exposes
-- in-app delivery ids, while the shared acknowledgement boundary remains usable
-- by future channel-specific inboxes. Confirmation is limited to priority 3.
create or replace function private.acknowledge_notification_delivery_guarded(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_notification_delivery_id uuid,
  p_target_status public.delivery_status,
  p_idempotency_key uuid
)
returns table(
  acknowledgement_operation_id uuid,
  notification_delivery_id uuid,
  notification_id uuid,
  status public.delivery_status,
  read_at timestamptz,
  confirmed_at timestamptz,
  acknowledged_at timestamptz,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_priority smallint;
  v_notification_status text;
  v_available_at timestamptz;
  v_has_existing_operation boolean;
  v_result record;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_notification_delivery_id is null
     or p_target_status is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'organization, branch, delivery, target status, and idempotency key are required';
  end if;

  if p_target_status not in ('read', 'confirmed') then
    raise exception using
      errcode = '22023',
      message = 'notification acknowledgement target must be read or confirmed';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'notification acknowledgement is not permitted in the selected tenant context';
  end if;

  -- Inspecting the replay ledger must use the same actor/key serialization as
  -- the immutable core. An exact replay is evidence retrieval and must remain
  -- exact even if the notification is later cancelled or reprioritized.
  perform pg_advisory_xact_lock(hashtextextended(
    'notification-ack:' || v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select exists (
    select 1
    from private.notification_acknowledgement_operations operation
    where operation.recipient_user_id = v_actor
      and operation.idempotency_key = p_idempotency_key
  ) into v_has_existing_operation;

  if not v_has_existing_operation then
    select
      notification.priority,
      notification.status,
      coalesce(notification.scheduled_for, notification.created_at)
      into v_priority, v_notification_status, v_available_at
    from public.notification_deliveries delivery
    join public.notifications notification
      on notification.id = delivery.notification_id
     and notification.organization_id = delivery.organization_id
    where delivery.id = p_notification_delivery_id
      and delivery.organization_id = p_expected_organization_id
      and delivery.branch_id = p_expected_branch_id
      and delivery.recipient_user_id = v_actor
      and notification.branch_id = p_expected_branch_id
    for share of delivery, notification;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'notification acknowledgement is not permitted in the selected tenant context';
    end if;

    if v_notification_status not in ('scheduled', 'sending', 'sent')
       or v_available_at > clock_timestamp() then
      raise exception using
        errcode = '23514',
        message = 'notification is not currently available for acknowledgement';
    end if;

    if p_target_status = 'confirmed' and v_priority <> 3 then
      raise exception using
        errcode = '23514',
        message = 'only technical priority 3 notifications can be explicitly confirmed';
    end if;
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'notification acknowledgement authority expired';
  end if;

  select * into strict v_result
  from private.acknowledge_notification_delivery_atomic(
    p_expected_organization_id,
    p_expected_branch_id,
    p_notification_delivery_id,
    p_target_status,
    p_idempotency_key
  );

  -- The core can block on a row/advisory lock. Do not return either a new
  -- receipt or an exact replay if authority changed while it was waiting.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'notifications.read'
     )) then
    raise exception using
      errcode = '42501',
      message = 'notification acknowledgement authority expired';
  end if;

  return query select
    v_result.acknowledgement_operation_id::uuid,
    v_result.notification_delivery_id::uuid,
    v_result.notification_id::uuid,
    v_result.status::public.delivery_status,
    v_result.read_at::timestamptz,
    v_result.confirmed_at::timestamptz,
    v_result.acknowledged_at::timestamptz,
    v_result.replayed::boolean;
end;
$$;

create or replace function public.acknowledge_notification_delivery(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_notification_delivery_id uuid,
  p_target_status public.delivery_status,
  p_idempotency_key uuid
)
returns table(
  acknowledgement_operation_id uuid,
  notification_delivery_id uuid,
  notification_id uuid,
  status public.delivery_status,
  read_at timestamptz,
  confirmed_at timestamptz,
  acknowledged_at timestamptz,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.acknowledge_notification_delivery_guarded(
    p_expected_organization_id,
    p_expected_branch_id,
    p_notification_delivery_id,
    p_target_status,
    p_idempotency_key
  );
$$;

revoke all on function private.notification_center_snapshot_response(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.notification_center_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_notification_delivery_atomic(
  uuid, uuid, uuid, public.delivery_status, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_notification_delivery_guarded(
  uuid, uuid, uuid, public.delivery_status, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.acknowledge_notification_delivery(
  uuid, uuid, uuid, public.delivery_status, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.notification_center_snapshot_response(uuid, uuid)
  to authenticated;
grant execute on function public.notification_center_snapshot(uuid, uuid)
  to authenticated;
grant execute on function private.acknowledge_notification_delivery_guarded(
  uuid, uuid, uuid, public.delivery_status, uuid
) to authenticated;
grant execute on function public.acknowledge_notification_delivery(
  uuid, uuid, uuid, public.delivery_status, uuid
) to authenticated;

-- A notifications.read role may inspect only notifications actually addressed
-- to the current recipient. notifications.manage remains the explicit
-- branch-wide administrative read boundary. This closes the legacy direct
-- Data API path that otherwise bypassed page 67 recipient ownership.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select
on public.notifications for select
to authenticated
using (
  (select private.has_permission(
    organization_id,
    branch_id,
    'notifications.manage'
  ))
  or (
    (select private.has_permission(
      organization_id,
      branch_id,
      'notifications.read'
    ))
    and exists (
      select 1
      from public.notification_deliveries delivery
      where delivery.notification_id = notifications.id
        and delivery.organization_id = notifications.organization_id
        and delivery.branch_id is not distinct from notifications.branch_id
        and delivery.recipient_user_id = (select auth.uid())
    )
  )
);
