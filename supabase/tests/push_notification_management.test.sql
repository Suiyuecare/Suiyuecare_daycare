begin;

select plan(32);

select ok(
  has_function_privilege(
    'authenticated',
    'public.push_notification_management_snapshot(uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.preview_in_app_staff_notification_recipients(uuid,uuid,uuid[])',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.enqueue_in_app_staff_notification(uuid,uuid,text,smallint,text,text,uuid[],timestamptz,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.enqueue_in_app_staff_notification(uuid,uuid,text,smallint,text,text,uuid[],timestamptz,uuid)',
    'execute'
  ),
  'page-45 read, preview, and queue interfaces are authenticated-only'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.enqueue_in_app_staff_notification(uuid,uuid,text,smallint,text,text,uuid[],timestamptz,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.enqueue_in_app_staff_notification_guarded(uuid,uuid,text,smallint,text,text,uuid[],timestamptz,uuid)'::regprocedure
  ),
  'the exposed queue wrapper is invoker-safe and its guarded core validates authority'
);

select ok(
  position(
    'in_app' in pg_get_functiondef(
      'private.enqueue_in_app_staff_notification_guarded(uuid,uuid,text,smallint,text,text,uuid[],timestamptz,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'page45_push_notification' in pg_get_functiondef(
      'private.enqueue_in_app_staff_notification_guarded(uuid,uuid,text,smallint,text,text,uuid[],timestamptz,uuid)'::regprocedure
    )
  ) > 0,
  'the page-specific writer hard-codes in-app and a dedicated source marker'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'page45-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'page45-branch@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'page45-org@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'page45-other-branch@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'page45-family@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'page45-platform@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '45b10000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'page45-no-permission@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('45b20000-0000-4000-8000-000000000001', 'page45_a', '第45頁機構 A'),
  ('45b20000-0000-4000-8000-000000000002', 'page45_b', '第45頁機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('45b30000-0000-4000-8000-000000000001', '45b20000-0000-4000-8000-000000000001', 'main', '第45頁主分支'),
  ('45b30000-0000-4000-8000-000000000002', '45b20000-0000-4000-8000-000000000001', 'other', '第45頁其他分支'),
  ('45b30000-0000-4000-8000-000000000003', '45b20000-0000-4000-8000-000000000002', 'main', '第45頁 B 分支');

insert into public.profiles (id, display_name, kind, employee_code) values
  ('45b10000-0000-4000-8000-000000000001', '第45頁管理員', 'staff', 'P45-001'),
  ('45b10000-0000-4000-8000-000000000002', '第45頁分支員工', 'staff', 'P45-002'),
  ('45b10000-0000-4000-8000-000000000003', '第45頁機構員工', 'professional', 'P45-003'),
  ('45b10000-0000-4000-8000-000000000004', '第45頁其他分支', 'driver', 'P45-004'),
  ('45b10000-0000-4000-8000-000000000005', '第45頁家屬', 'family', null),
  ('45b10000-0000-4000-8000-000000000006', '第45頁平台', 'platform', null),
  ('45b10000-0000-4000-8000-000000000007', '第45頁無權限員工', 'staff', 'P45-007');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('45b40000-0000-4000-8000-000000000001', '45b20000-0000-4000-8000-000000000001', '45b30000-0000-4000-8000-000000000001', '45b10000-0000-4000-8000-000000000001', 'active'),
  ('45b40000-0000-4000-8000-000000000002', '45b20000-0000-4000-8000-000000000001', '45b30000-0000-4000-8000-000000000001', '45b10000-0000-4000-8000-000000000002', 'active'),
  ('45b40000-0000-4000-8000-000000000003', '45b20000-0000-4000-8000-000000000001', null, '45b10000-0000-4000-8000-000000000003', 'active'),
  ('45b40000-0000-4000-8000-000000000004', '45b20000-0000-4000-8000-000000000001', '45b30000-0000-4000-8000-000000000002', '45b10000-0000-4000-8000-000000000004', 'active'),
  ('45b40000-0000-4000-8000-000000000005', '45b20000-0000-4000-8000-000000000001', '45b30000-0000-4000-8000-000000000001', '45b10000-0000-4000-8000-000000000005', 'active'),
  ('45b40000-0000-4000-8000-000000000006', '45b20000-0000-4000-8000-000000000001', null, '45b10000-0000-4000-8000-000000000006', 'active'),
  ('45b40000-0000-4000-8000-000000000007', '45b20000-0000-4000-8000-000000000001', '45b30000-0000-4000-8000-000000000001', '45b10000-0000-4000-8000-000000000007', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('45b40000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('45b40000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006'),
  ('45b40000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'),
  ('45b40000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000008'),
  ('45b40000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000010'),
  ('45b40000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001'),
  ('45b40000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000006');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '45b50000-0000-4000-8000-000000000001',
  '45b10000-0000-4000-8000-000000000001',
  '45b51000-0000-4000-8000-000000000001',
  repeat('4', 64),
  '45b52000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '2 minutes',
  'page45-before',
  transaction_timestamp() - interval '1 minute',
  transaction_timestamp() + interval '4 minutes',
  transaction_timestamp() - interval '30 seconds',
  transaction_timestamp() - interval '30 seconds',
  'page45-after',
  'totp',
  transaction_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '45b10000-0000-4000-8000-000000000001',
  '45b51000-0000-4000-8000-000000000001',
  '45b50000-0000-4000-8000-000000000001',
  'aal2',
  'totp',
  transaction_timestamp() - interval '30 seconds'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"45b10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"45b51000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.push_notification_management_snapshot(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'push notification management snapshot is not permitted in the selected tenant context',
  'AAL1 cannot read the page-45 management snapshot'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '工作提醒', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000002']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'in-app staff notification queue is not permitted in the selected tenant context',
  'AAL1 cannot queue a page-45 notification'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"45b10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"45b51000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select recipient_total, jsonb_array_length(recipients),
           recipients_truncated, notification_total,
           provider_boundary, family_boundary, retry_boundary
    from public.push_notification_management_snapshot(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001'
    )$$,
  $$values (
    4::bigint, 4, false, 0::bigint,
    'in_app_only_no_delivery_worker'::text,
    'relationship_consent_not_available'::text,
    'partial_retry_worker_not_available'::text
  )$$,
  'the bounded snapshot exposes only actual eligible staff and explicit unavailable boundaries'
);

select results_eq(
  $$select array_agg(item ->> 'user_id' order by item ->> 'user_id')
    from public.push_notification_management_snapshot(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001'
    ) snapshot,
    lateral jsonb_array_elements(snapshot.recipients) item$$,
  $$values (array[
    '45b10000-0000-4000-8000-000000000001',
    '45b10000-0000-4000-8000-000000000002',
    '45b10000-0000-4000-8000-000000000003',
    '45b10000-0000-4000-8000-000000000007'
  ]::text[])$$,
  'recipient snapshot includes exact-branch and organization staff but excludes other branch, family, and platform profiles'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.audit_events
    where table_name = 'push_notification_management_snapshot'
      and actor_user_id = '45b10000-0000-4000-8000-000000000001'
  ),
  2,
  'each successful management snapshot is audited'
);

set local role authenticated;

select results_eq(
  $$select recipient_count, jsonb_array_length(recipients), channel, persisted
    from public.preview_in_app_staff_notification_recipients(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001',
      array[
        '45b10000-0000-4000-8000-000000000003',
        '45b10000-0000-4000-8000-000000000002'
      ]::uuid[]
    )$$,
  $$values (2, 2, 'in_app'::text, false)$$,
  'preview returns the exact current in-app staff recipient count without a persistence claim'
);

select results_eq(
  $$select array_agg(item ->> 'user_id' order by item ->> 'user_id')
    from public.preview_in_app_staff_notification_recipients(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001',
      array[
        '45b10000-0000-4000-8000-000000000003',
        '45b10000-0000-4000-8000-000000000002'
      ]::uuid[]
    ) preview,
    lateral jsonb_array_elements(preview.recipients) item$$,
  $$values (array[
    '45b10000-0000-4000-8000-000000000002',
    '45b10000-0000-4000-8000-000000000003'
  ]::text[])$$,
  'preview names are server-derived for exactly the requested current staff ids'
);

reset role;
select ok(
  exists (
    select 1
    from public.audit_events
    where table_name = 'push_notification_recipient_preview'
      and actor_user_id = '45b10000-0000-4000-8000-000000000001'
      and metadata ->> 'channel' = 'in_app'
      and metadata ->> 'recipient_count' = '2'
  ),
  'successful recipient previews leave a bounded audit event without recipient identifiers'
);

set local role authenticated;

select throws_ok(
  $$select * from public.preview_in_app_staff_notification_recipients(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    array['45b10000-0000-4000-8000-000000000004']::uuid[]
  )$$,
  '42501',
  'one or more push notification recipients are outside the selected active staff scope',
  'preview rejects a same-tenant employee scoped only to another branch'
);

select throws_ok(
  $$select * from public.preview_in_app_staff_notification_recipients(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    array['45b10000-0000-4000-8000-000000000005']::uuid[]
  )$$,
  '42501',
  'one or more push notification recipients are outside the selected active staff scope',
  'preview keeps family recipients closed despite branch membership'
);

select throws_ok(
  $$select * from public.preview_in_app_staff_notification_recipients(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    array['45b10000-0000-4000-8000-000000000006']::uuid[]
  )$$,
  '42501',
  'one or more push notification recipients are outside the selected active staff scope',
  'preview excludes platform operators from operational staff recipients'
);

select results_eq(
  $$select delivery_count, notification_status, replayed
    from public.enqueue_in_app_staff_notification(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001',
      ' general ', 2::smallint, ' 工作提醒 ', ' 請登入系統查看最新內容。 ',
      array[
        '45b10000-0000-4000-8000-000000000003',
        '45b10000-0000-4000-8000-000000000002'
      ]::uuid[],
      null,
      '45b60000-0000-4000-8000-000000000002'
    )$$,
  $$values (2, 'scheduled'::text, false)$$,
  'one guarded request atomically creates a scheduled notification and exact in-app fan-out'
);

select results_eq(
  $$select category, title, body, status, source_type,
           audience ->> 'recipient_kind', audience -> 'channels',
           request_hash ~ '^[a-f0-9]{64}$',
           queued_reauth_challenge_id
    from public.notifications
    where queue_idempotency_key = '45b60000-0000-4000-8000-000000000002'$$,
  $$values (
    'general'::text,
    '工作提醒'::text,
    '請登入系統查看最新內容。'::text,
    'scheduled'::text,
    'page45_push_notification'::text,
    'staff'::text,
    '["in_app"]'::jsonb,
    true,
    '45b50000-0000-4000-8000-000000000001'::uuid
  )$$,
  'persisted notification retains canonical scope and exact AAL2 evidence without exposing it in page receipts'
);

select results_eq(
  $$select recipient_user_id, channel, status
    from public.notification_deliveries
    where notification_id = (
      select id from public.notifications
      where queue_idempotency_key = '45b60000-0000-4000-8000-000000000002'
    )
    order by recipient_user_id$$,
  $$values
    ('45b10000-0000-4000-8000-000000000002'::uuid, 'in_app'::text, 'queued'::public.delivery_status),
    ('45b10000-0000-4000-8000-000000000003'::uuid, 'in_app'::text, 'queued'::public.delivery_status)$$,
  'page-45 fan-out contains only queued in-app deliveries and no provider claims'
);

select results_eq(
  $$select notification_total, scheduled_total, queued_delivery_total,
           read_or_confirmed_total, failed_delivery_total,
           jsonb_array_length(notifications)
    from public.push_notification_management_snapshot(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001'
    )$$,
  $$values (1::bigint, 0::bigint, 2::bigint, 0::bigint, 0::bigint, 1)$$,
  'management metrics report queued as queued and never inflate sent, delivered, or read'
);

select is(
  (
    select (notifications -> 0) ?| array[
      'request_hash', 'queue_idempotency_key', 'queued_reauth_challenge_id',
      'audience', 'recipient_user_ids', 'provider_message_id', 'error_code'
    ]
    from public.push_notification_management_snapshot(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001'
    )
  ),
  false,
  'management history omits internal hashes, idempotency, AAL2, audience ids, and provider diagnostics'
);

reset role;
update public.memberships
set status = 'suspended'
where id = '45b40000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"45b10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"45b51000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select delivery_count, replayed
    from public.enqueue_in_app_staff_notification(
      '45b20000-0000-4000-8000-000000000001',
      '45b30000-0000-4000-8000-000000000001',
      'general', 2::smallint, '工作提醒', '請登入系統查看最新內容。',
      array[
        '45b10000-0000-4000-8000-000000000002',
        '45b10000-0000-4000-8000-000000000003'
      ]::uuid[],
      null,
      '45b60000-0000-4000-8000-000000000002'
    )$$,
  $$values (2, true)$$,
  'exact actor-scoped replay returns the persisted receipt even after recipient membership changes'
);

select is(
  (
    select count(*)::integer
    from public.notifications
    where queue_idempotency_key = '45b60000-0000-4000-8000-000000000002'
  ),
  1,
  'exact replay does not duplicate the notification'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 2::smallint, '內容已改變', '請登入系統查看最新內容。',
    array[
      '45b10000-0000-4000-8000-000000000002',
      '45b10000-0000-4000-8000-000000000003'
    ]::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000002'
  )$$,
  '23505',
  'notification queue idempotency conflict',
  'the same actor key cannot replay changed content'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '停用員工', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000002']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'one or more in-app notification recipients are outside the selected active staff scope',
  'a new notification cannot target a now-inactive membership'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '家屬測試', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000005']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000004'
  )$$,
  '42501',
  'one or more in-app notification recipients are outside the selected active staff scope',
  'family delivery remains fail-closed until relationship and consent versions exist'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '平台測試', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000006']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000005'
  )$$,
  '42501',
  'one or more in-app notification recipients are outside the selected active staff scope',
  'platform operators are not operational staff recipients'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '跨分支測試', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000004']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000006'
  )$$,
  '42501',
  'one or more in-app notification recipients are outside the selected active staff scope',
  'another branch recipient cannot be queued'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '敏感內容', '您的血糖資料已更新。',
    array['45b10000-0000-4000-8000-000000000003']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000007'
  )$$,
  '22023',
  'notification copy contains sensitive content',
  'the shared database boundary still rejects sensitive care content'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '過期排程', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000003']::uuid[],
    clock_timestamp() - interval '2 minutes',
    '45b60000-0000-4000-8000-000000000008'
  )$$,
  '22023',
  'notification schedule is in the past',
  'a new page-45 notification cannot be scheduled in the past'
);

select throws_ok(
  $$select * from public.push_notification_management_snapshot(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'push notification management snapshot is not permitted in the selected tenant context',
  'the actor cannot substitute another branch in the management snapshot'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"45b10000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.push_notification_management_snapshot(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'push notification management snapshot is not permitted in the selected tenant context',
  'notifications.read without notifications.manage cannot inspect page-45 recipient and management data'
);

select throws_ok(
  $$select * from public.enqueue_in_app_staff_notification(
    '45b20000-0000-4000-8000-000000000001',
    '45b30000-0000-4000-8000-000000000001',
    'general', 1::smallint, '無權限測試', '請登入系統查看。',
    array['45b10000-0000-4000-8000-000000000003']::uuid[],
    null,
    '45b60000-0000-4000-8000-000000000009'
  )$$,
  '42501',
  'in-app staff notification queue is not permitted in the selected tenant context',
  'notifications.read without notifications.manage cannot queue'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.audit_events
    where table_name in (
      'push_notification_management_snapshot',
      'push_notification_recipient_preview'
    )
      and (
        metadata::text like '%45b10000-0000-4000-8000-000000000002%'
        or metadata::text like '%45b10000-0000-4000-8000-000000000003%'
      )
  ),
  0,
  'snapshot and preview audit metadata never records recipient identifiers or names'
);

select * from finish();
rollback;
