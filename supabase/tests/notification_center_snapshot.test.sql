begin;

select plan(24);

select ok(
  to_regprocedure('public.notification_center_snapshot(uuid,uuid)') is not null
  and has_function_privilege(
    'authenticated', 'public.notification_center_snapshot(uuid,uuid)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.notification_center_snapshot(uuid,uuid)', 'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid = 'public.notification_center_snapshot(uuid,uuid)'::regprocedure
  ),
  'the public page-67 snapshot is an authenticated-only SECURITY INVOKER wrapper'
);

select ok(
  (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.notification_center_snapshot_response(uuid,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.notification_center_snapshot_response(uuid,uuid)',
    'execute'
  ),
  'the bounded snapshot core is definer-backed and locks its search path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.acknowledge_notification_delivery_guarded(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.acknowledge_notification_delivery_atomic(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  ),
  'authenticated callers can execute only the current-authority acknowledgement shim'
);

select ok(
  (
    select
      position('limit 200' in lower(pg_get_functiondef(procedure.oid))) > 0
      and position('Asia/Taipei' in pg_get_functiondef(procedure.oid)) > 0
      and position('audit_events' in pg_get_functiondef(procedure.oid)) > 0
      and position('notification center snapshot authority expired' in pg_get_functiondef(procedure.oid)) > 0
    from pg_proc procedure
    where procedure.oid =
      'private.notification_center_snapshot_response(uuid,uuid)'::regprocedure
  ),
  'the snapshot is bounded, Taipei-aware, audited, and rechecks authority before return'
);

select ok(
  (
    select
      position('for share of delivery, notification' in lower(pg_get_functiondef(procedure.oid))) > 0
      and position('notification acknowledgement authority expired' in pg_get_functiondef(procedure.oid)) > 0
      and position('priority 3' in pg_get_functiondef(procedure.oid)) > 0
    from pg_proc procedure
    where procedure.oid =
      'private.acknowledge_notification_delivery_guarded(uuid,uuid,uuid,public.delivery_status,uuid)'::regprocedure
  ),
  'acknowledgement locks its exact target, rechecks current authority, and limits explicit confirmation'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e6710000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'page67-recipient@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e6710000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'page67-other@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e6710000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'page67-family@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('e6720000-0000-4000-8000-000000000001', 'page67_org', '第六十七頁測試機構');

insert into public.branches (id, organization_id, code, name) values
  ('e6730000-0000-4000-8000-000000000001', 'e6720000-0000-4000-8000-000000000001', 'main', '通知中心主分支'),
  ('e6730000-0000-4000-8000-000000000002', 'e6720000-0000-4000-8000-000000000001', 'other', '通知中心其他分支');

insert into public.profiles (id, display_name, kind, is_active) values
  ('e6710000-0000-4000-8000-000000000001', '通知中心收件者', 'staff', true),
  ('e6710000-0000-4000-8000-000000000002', '其他收件者', 'staff', true),
  ('e6710000-0000-4000-8000-000000000003', '通知家屬', 'family', true);

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('e6740000-0000-4000-8000-000000000001', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6710000-0000-4000-8000-000000000001', 'active'),
  ('e6740000-0000-4000-8000-000000000002', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6710000-0000-4000-8000-000000000002', 'active'),
  ('e6740000-0000-4000-8000-000000000003', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6710000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('e6740000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'),
  ('e6740000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006'),
  ('e6740000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000010');

insert into public.notifications (
  id, organization_id, branch_id, category, priority, title, body,
  audience, status, scheduled_for, source_type, source_id, created_by
) values
  ('e6750000-0000-4000-8000-000000000001', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'critical', 3, '最高優先通知', '請登入系統查看並確認。', '{}'::jsonb, 'sent', clock_timestamp() - interval '10 minutes', 'attendance_event', 'e6790000-0000-4000-8000-000000000001', 'e6710000-0000-4000-8000-000000000001'),
  ('e6750000-0000-4000-8000-000000000002', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'general', 1, '昨日已讀通知', '請登入系統查看。', '{}'::jsonb, 'sent', ((clock_timestamp() at time zone 'Asia/Taipei')::date - 1 + time '10:00') at time zone 'Asia/Taipei', null, null, 'e6710000-0000-4000-8000-000000000001'),
  ('e6750000-0000-4000-8000-000000000003', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'future', 2, '未到排程通知', '尚未應顯示。', '{}'::jsonb, 'scheduled', clock_timestamp() + interval '1 hour', null, null, 'e6710000-0000-4000-8000-000000000001'),
  ('e6750000-0000-4000-8000-000000000004', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'other', 2, '其他人通知', '不可顯示。', '{}'::jsonb, 'sent', clock_timestamp() - interval '5 minutes', null, null, 'e6710000-0000-4000-8000-000000000001'),
  ('e6750000-0000-4000-8000-000000000005', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000002', 'branch', 2, '其他分支通知', '不可顯示。', '{}'::jsonb, 'sent', clock_timestamp() - interval '5 minutes', null, null, 'e6710000-0000-4000-8000-000000000001');

insert into public.notification_deliveries (
  id, organization_id, branch_id, notification_id, recipient_user_id,
  channel, status, idempotency_key, sent_at, delivered_at, read_at
) values
  ('e6760000-0000-4000-8000-000000000001', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6750000-0000-4000-8000-000000000001', 'e6710000-0000-4000-8000-000000000001', 'in_app', 'delivered', 'e6770000-0000-4000-8000-000000000001', now() - interval '9 minutes', now() - interval '8 minutes', null),
  ('e6760000-0000-4000-8000-000000000002', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6750000-0000-4000-8000-000000000002', 'e6710000-0000-4000-8000-000000000001', 'in_app', 'read', 'e6770000-0000-4000-8000-000000000002', now() - interval '1 day', now() - interval '1 day', now() - interval '23 hours'),
  ('e6760000-0000-4000-8000-000000000003', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6750000-0000-4000-8000-000000000003', 'e6710000-0000-4000-8000-000000000001', 'in_app', 'queued', 'e6770000-0000-4000-8000-000000000003', null, null, null),
  ('e6760000-0000-4000-8000-000000000004', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6750000-0000-4000-8000-000000000004', 'e6710000-0000-4000-8000-000000000002', 'in_app', 'queued', 'e6770000-0000-4000-8000-000000000004', null, null, null),
  ('e6760000-0000-4000-8000-000000000005', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000002', 'e6750000-0000-4000-8000-000000000005', 'e6710000-0000-4000-8000-000000000001', 'in_app', 'queued', 'e6770000-0000-4000-8000-000000000005', null, null, null),
  ('e6760000-0000-4000-8000-000000000006', 'e6720000-0000-4000-8000-000000000001', 'e6730000-0000-4000-8000-000000000001', 'e6750000-0000-4000-8000-000000000001', 'e6710000-0000-4000-8000-000000000001', 'line', 'delivered', 'e6770000-0000-4000-8000-000000000006', now() - interval '9 minutes', now() - interval '8 minutes', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e6710000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}'::text,
  true
);

select throws_ok(
  $$select * from public.notification_center_snapshot(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'notification center snapshot is not permitted in the selected tenant context',
  'AAL1 staff cannot read the notification center through the database API'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'read', 'e6780000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'notification acknowledgement is not permitted in the selected tenant context',
  'AAL1 staff cannot acknowledge through the database API'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"e6710000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select item_total, unread_total, confirmation_pending_total, today_total,
           jsonb_array_length(items), items_truncated,
           confirmation_rule_status
    from public.notification_center_snapshot(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001'
    )$$,
  $$values (2::bigint, 1::bigint, 1::bigint, 1::bigint, 2, false,
            'technical_priority_3_only'::text)$$,
  'the snapshot counts only due own in-app deliveries in the exact branch'
);

select results_eq(
  $$select items -> 0 ->> 'notification_id',
           items -> 0 ->> 'requires_confirmation',
           items -> 1 ->> 'notification_id'
    from public.notification_center_snapshot(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001'
    )$$,
  $$values (
    'e6750000-0000-4000-8000-000000000001'::text,
    'true'::text,
    'e6750000-0000-4000-8000-000000000002'::text
  )$$,
  'priority-3 pending confirmation sorts before read history'
);

select is(
  (
    select (items -> 0) ?| array[
      'request_hash', 'queue_idempotency_key', 'queued_reauth_challenge_id',
      'recipient_user_id', 'provider_message_id', 'error_code'
    ]
    from public.notification_center_snapshot(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'the recipient projection omits internal hashes, AAL2 evidence, actor ids, and provider diagnostics'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where id = 'e6750000-0000-4000-8000-000000000004'
  ),
  0,
  'the legacy direct notifications table cannot reveal another recipients same-branch content'
);

select throws_ok(
  $$select * from public.notification_center_snapshot(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  'notification center snapshot is not permitted in the selected tenant context',
  'a same-organization branch without membership cannot be substituted'
);

select throws_ok(
  $$select * from private.acknowledge_notification_delivery_atomic(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'read', 'e6780000-0000-4000-8000-000000000002'
    )$$,
  '42501', null,
  'the authenticated role cannot bypass the current-authority shim by calling the ledger core'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000002',
      'confirmed', 'e6780000-0000-4000-8000-000000000003'
    )$$,
  '23514',
  'only technical priority 3 notifications can be explicitly confirmed',
  'a normal-priority notification cannot be converted into a confirmation record'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000003',
      'read', 'e6780000-0000-4000-8000-000000000005'
    )$$,
  '23514',
  'notification is not currently available for acknowledgement',
  'a future scheduled notification cannot be acknowledged before it is visible'
);

select results_eq(
  $$select notification_delivery_id, status, read_at is not null,
           confirmed_at is not null, replayed
    from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'confirmed', 'e6780000-0000-4000-8000-000000000004'
    )$$,
  $$values (
    'e6760000-0000-4000-8000-000000000001'::uuid,
    'confirmed'::public.delivery_status, true, true, false
  )$$,
  'the exact priority-3 in-app delivery can be read and confirmed atomically'
);

select results_eq(
  $$select status, replayed
    from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'confirmed', 'e6780000-0000-4000-8000-000000000004'
    )$$,
  $$values ('confirmed'::public.delivery_status, true)$$,
  'an exact retry returns the original immutable confirmation receipt'
);

reset role;
update public.notifications
set priority = 1, status = 'cancelled'
where id = 'e6750000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e6710000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select status, replayed
    from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'confirmed', 'e6780000-0000-4000-8000-000000000004'
    )$$,
  $$values ('confirmed'::public.delivery_status, true)$$,
  'exact replay remains exact after later cancellation and reprioritization'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'confirmed', 'e6780000-0000-4000-8000-000000000006'
    )$$,
  '23514',
  'notification is not currently available for acknowledgement',
  'cancellation blocks a new acknowledgement operation without invalidating the old receipt'
);

reset role;
select is(
  (
    select count(*)::integer
    from private.notification_acknowledgement_operations
    where idempotency_key = 'e6780000-0000-4000-8000-000000000004'
  ),
  1,
  'exact replay does not duplicate confirmation evidence'
);

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'notification_center_snapshot'
      and event.action = 'select'
      and event.organization_id = 'e6720000-0000-4000-8000-000000000001'
      and event.branch_id = 'e6730000-0000-4000-8000-000000000001'
      and event.actor_user_id = 'e6710000-0000-4000-8000-000000000001'
      and event.metadata ->> 'projection' = 'page67_recipient_in_app_v1'
  ),
  'successful notification reads leave a minimal scoped audit event'
);

update public.memberships
set status = 'ended', ends_at = clock_timestamp()
where id = 'e6740000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e6710000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001',
      'e6760000-0000-4000-8000-000000000001',
      'confirmed', 'e6780000-0000-4000-8000-000000000004'
    )$$,
  '42501',
  'notification acknowledgement is not permitted in the selected tenant context',
  'an exact replay is denied after current membership authority is revoked'
);

select throws_ok(
  $$select * from public.notification_center_snapshot(
      'e6720000-0000-4000-8000-000000000001',
      'e6730000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'notification center snapshot is not permitted in the selected tenant context',
  'snapshot access is denied immediately after membership authority is revoked'
);

reset role;
select ok(
  exists (
    select 1
    from private.notification_acknowledgement_operations operation
    where operation.notification_delivery_id = 'e6760000-0000-4000-8000-000000000001'
      and operation.target_status = 'confirmed'
      and operation.request_hash ~ '^[a-f0-9]{64}$'
      and operation.result_read_at is not null
      and operation.result_confirmed_at is not null
  ),
  'the immutable ledger retains canonical confirmation evidence after access is revoked'
);

select * from finish();
rollback;
