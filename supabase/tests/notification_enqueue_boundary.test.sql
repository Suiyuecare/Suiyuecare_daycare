begin;

select plan(30);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'queue_idempotency_key'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'request_hash'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'queued_reauth_challenge_id'
  ),
  'queued notifications retain request identity, canonical hash, and exact reauthentication evidence'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.enqueue_staff_notification(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.enqueue_staff_notification(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.enqueue_staff_notification(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)'::regprocedure
  ),
  'the public notification writer is an authenticated-only SECURITY INVOKER wrapper'
);

select ok(
  (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'private.enqueue_staff_notification_atomic(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.enqueue_staff_notification_atomic(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.enqueue_staff_notification_atomic(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)',
    'execute'
  ),
  'the private atomic writer validates authenticated callers itself'
);

select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'insert')
  and not has_table_privilege('authenticated', 'public.notifications', 'update')
  and not has_table_privilege('authenticated', 'public.notifications', 'delete')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'insert')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'update')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'delete')
  and not has_column_privilege('authenticated', 'public.notification_deliveries', 'status', 'update')
  and not has_column_privilege('authenticated', 'public.notification_deliveries', 'read_at', 'update'),
  'authenticated callers cannot split, forge, retarget, or directly acknowledge delivery rows'
);

select ok(
  exists (
    select 1
    from pg_class index_relation
    join pg_index index_definition
      on index_definition.indexrelid = index_relation.oid
    where index_relation.relname = 'notifications_actor_queue_idempotency_idx'
      and index_definition.indisunique
  )
  and exists (
    select 1 from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.notifications'::regclass
      and constraint_definition.conname = 'notifications_queued_reauth_challenge_fkey'
      and constraint_definition.confrelid = 'private.reauth_challenges'::regclass
      and constraint_definition.confdeltype = 'r'
  ),
  'notification idempotency is durable and exact challenge evidence cannot be cascaded away'
);

select ok(
  (
    select
      position('if found then' in function_definition)
        < position('v_valid_recipient_count' in substring(
          function_definition from position('if found then' in function_definition)
        )) + position('if found then' in function_definition)
      and position('return;' in function_definition)
        < position('one or more notification recipients' in function_definition)
      and position('v_now := clock_timestamp()' in function_definition)
        < position('insert into public.notifications' in function_definition)
      and position('insert into public.notifications' in function_definition)
        < position('insert into public.notification_deliveries' in function_definition)
    from (
      select pg_get_functiondef(
        'private.enqueue_staff_notification_atomic(uuid,uuid,text,smallint,text,text,uuid[],text[],timestamptz,text,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'exact replay precedes mutable recipient checks and notification plus fan-out share one transaction'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notify-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'notify-staff-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'notify-staff-org@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'notify-staff-other-branch@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'notify-staff-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'notify-family-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'notify-no-permission@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('b2000000-0000-4000-8000-000000000001', 'notify_org_a', '通知測試機構 A'),
  ('b2000000-0000-4000-8000-000000000002', 'notify_org_b', '通知測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'main', '通知 A 主分支'),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'other', '通知 A 其他分支'),
  ('b3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000002', 'main', '通知 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('b1000000-0000-4000-8000-000000000001', '通知管理員', 'staff'),
  ('b1000000-0000-4000-8000-000000000002', '通知分支員工', 'staff'),
  ('b1000000-0000-4000-8000-000000000003', '通知機構員工', 'staff'),
  ('b1000000-0000-4000-8000-000000000004', '通知其他分支員工', 'staff'),
  ('b1000000-0000-4000-8000-000000000005', '通知 B 員工', 'staff'),
  ('b1000000-0000-4000-8000-000000000006', '通知家屬', 'family'),
  ('b1000000-0000-4000-8000-000000000007', '通知無權限人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', null, 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b4000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', null, 'b1000000-0000-4000-8000-000000000001', 'active'),
  ('b4000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'active'),
  ('b4000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000001', null, 'b1000000-0000-4000-8000-000000000003', 'active'),
  ('b4000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004', 'active'),
  ('b4000000-0000-4000-8000-000000000006', 'b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000005', 'active'),
  ('b4000000-0000-4000-8000-000000000007', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000006', 'active'),
  ('b4000000-0000-4000-8000-000000000008', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000007', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('b4000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('b4000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('b4000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006'),
  ('b4000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000006'),
  ('b4000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006'),
  ('b4000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006'),
  ('b4000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000010');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('b5000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', repeat('1', 64), 'b5200000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes', 'notify-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'notify-after', 'totp', now() - interval '30 seconds'),
  ('b5000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000007', 'b5100000-0000-4000-8000-000000000002', repeat('2', 64), 'b5200000-0000-4000-8000-000000000002', clock_timestamp() - interval '2 minutes', 'notify-no-permission-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'notify-no-permission-after', 'totp', now() - interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('b1000000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'aal2', 'totp', now() - interval '30 seconds'),
  ('b1000000-0000-4000-8000-000000000007', 'b5100000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000002', 'aal2', 'totp', now() - interval '30 seconds');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"b5100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '今日提醒', '請登入系統查看最新通知。',
      array['b1000000-0000-4000-8000-000000000002']::uuid[],
      array['in_app']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'notification queue is not permitted',
  'AAL1 cannot enqueue a notification'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b5100000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select delivery_count, replayed
    from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      ' general ', 2::smallint, ' 今日提醒 ', ' 請登入系統查看最新通知。 ',
      array[
        'b1000000-0000-4000-8000-000000000003',
        'b1000000-0000-4000-8000-000000000002'
      ]::uuid[],
      array['pwa', 'in_app']::text[], null, 'calendar', 'event-1',
      'b6000000-0000-4000-8000-000000000002'
    )$$,
  $$values (4, false)$$,
  'one authorized request creates the complete recipient-channel fan-out'
);

select results_eq(
  $$select organization_id, branch_id, category, priority, title, body,
           status, source_type, source_id, created_by,
           queue_idempotency_key,
           request_hash ~ '^[a-f0-9]{64}$',
           queued_reauth_challenge_id,
           audience ->> 'recipient_kind',
           jsonb_array_length(audience -> 'recipient_user_ids'),
           jsonb_array_length(audience -> 'channels')
    from public.notifications
    where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'$$,
  $$values (
    'b2000000-0000-4000-8000-000000000001'::uuid,
    'b3000000-0000-4000-8000-000000000001'::uuid,
    'general'::text, 2::smallint, '今日提醒'::text,
    '請登入系統查看最新通知。'::text, 'scheduled'::text,
    'calendar'::text, 'event-1'::text,
    'b1000000-0000-4000-8000-000000000001'::uuid,
    'b6000000-0000-4000-8000-000000000002'::uuid,
    true,
    'b5000000-0000-4000-8000-000000000001'::uuid,
    'staff'::text, 2, 2
  )$$,
  'scope, content, actor, canonical hash, audience, and exact AAL2 evidence are server-derived'
);

select results_eq(
  $$select recipient_user_id, channel, status
    from public.notification_deliveries
    where notification_id = (
      select id from public.notifications
      where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'
    )
    order by recipient_user_id, channel$$,
  $$values
    ('b1000000-0000-4000-8000-000000000002'::uuid, 'in_app'::text, 'queued'::public.delivery_status),
    ('b1000000-0000-4000-8000-000000000002'::uuid, 'pwa'::text, 'queued'::public.delivery_status),
    ('b1000000-0000-4000-8000-000000000003'::uuid, 'in_app'::text, 'queued'::public.delivery_status),
    ('b1000000-0000-4000-8000-000000000003'::uuid, 'pwa'::text, 'queued'::public.delivery_status)$$,
  'every delivery inherits the exact notification tenant, branch, recipient, channel, and queued state'
);

select results_eq(
  $$select delivery_count, replayed
    from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 2::smallint, '今日提醒', '請登入系統查看最新通知。',
      array[
        'b1000000-0000-4000-8000-000000000002',
        'b1000000-0000-4000-8000-000000000003',
        'b1000000-0000-4000-8000-000000000002'
      ]::uuid[],
      array['in_app', 'pwa', 'in_app']::text[], null, 'calendar', 'event-1',
      'b6000000-0000-4000-8000-000000000002'
    )$$,
  $$values (4, true)$$,
  'recipient and channel order or duplicates do not change an exact semantic replay'
);

select is(
  (
    select count(*)::integer from public.notifications
    where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'
  ),
  1,
  'exact replay creates no duplicate notification'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 2::smallint, '內容已變更', '請登入系統查看最新通知。',
      array['b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003']::uuid[],
      array['in_app','pwa']::text[], null, 'calendar', 'event-1',
      'b6000000-0000-4000-8000-000000000002'
    )$$,
  '23505',
  'notification queue idempotency conflict',
  'reusing a key for changed content is rejected'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '跨機構測試', '請登入系統查看。',
      array['b1000000-0000-4000-8000-000000000005']::uuid[],
      array['in_app']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000003'
    )$$,
  '42501',
  'one or more notification recipients are outside the selected staff scope',
  'selected organization A rejects a recipient the actor can access in organization B'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '跨分支測試', '請登入系統查看。',
      array['b1000000-0000-4000-8000-000000000004']::uuid[],
      array['in_app']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000004'
    )$$,
  '42501',
  'one or more notification recipients are outside the selected staff scope',
  'a branch-scoped recipient in another branch is rejected'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '家屬測試', '請登入系統查看。',
      array['b1000000-0000-4000-8000-000000000006']::uuid[],
      array['line']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000005'
    )$$,
  '42501',
  'one or more notification recipients are outside the selected staff scope',
  'family delivery remains closed until a client and consent version are explicit'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '健康提醒', '您的血糖資料已更新。',
      array['b1000000-0000-4000-8000-000000000002']::uuid[],
      array['in_app']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000006'
    )$$,
  '22023',
  'notification copy contains sensitive content',
  'sensitive health content is rejected inside the database boundary'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '一般提醒', '請登入系統查看。',
      array['b1000000-0000-4000-8000-000000000002']::uuid[],
      array['fax']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000007'
    )$$,
  '22023',
  'notification recipients or channels are invalid',
  'unknown delivery channels are rejected'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '一般提醒', '請登入系統查看。',
      array['b1000000-0000-4000-8000-000000000002']::uuid[],
      array['in_app']::text[], now() - interval '2 minutes', null, null,
      'b6000000-0000-4000-8000-000000000008'
    )$$,
  '22023',
  'notification schedule is in the past',
  'a newly queued notification cannot be scheduled in the past'
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '原子回滾測試', '請登入系統查看。',
      array[
        'b1000000-0000-4000-8000-000000000002',
        'b1000000-0000-4000-8000-000000000005'
      ]::uuid[],
      array['in_app']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000009'
    )$$,
  '42501',
  'one or more notification recipients are outside the selected staff scope',
  'one invalid recipient rejects the whole fan-out'
);

select is(
  (
    select count(*)::integer from public.notifications
    where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000009'
  ),
  0,
  'a rejected mixed-recipient request leaves no notification master row'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2","session_id":"b5100000-0000-4000-8000-000000000002"}'::text,
  true
);

select throws_ok(
  $$select * from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 1::smallint, '無權限測試', '請登入系統查看。',
      array['b1000000-0000-4000-8000-000000000002']::uuid[],
      array['in_app']::text[], null, null, null,
      'b6000000-0000-4000-8000-000000000010'
    )$$,
  '42501',
  'notification queue is not permitted',
  'recent AAL2 does not replace notifications.manage permission'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b5100000-0000-4000-8000-000000000001"}'::text,
  true
);

select throws_ok(
  $$insert into public.notifications (
      organization_id, branch_id, category, priority, title, body, audience,
      status, created_by
    ) values (
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'forged', 1, '偽造', '偽造', '{}'::jsonb, 'draft',
      'b1000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'direct notification insertion is denied'
);

select throws_ok(
  $$update public.notifications set title = '偽造異動'
    where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'direct notification mutation is denied'
);

select throws_ok(
  $$delete from public.notifications
    where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'direct notification deletion is denied'
);

select throws_ok(
  $$insert into public.notification_deliveries (
      organization_id, branch_id, notification_id, recipient_user_id,
      channel, status, idempotency_key
    ) values (
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      (select id from public.notifications
       where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'),
      'b1000000-0000-4000-8000-000000000005',
      'in_app', 'queued', 'b6000000-0000-4000-8000-000000000011'
    )$$,
  '42501',
  null,
  'direct delivery insertion cannot retarget a notification to another tenant user'
);

select throws_ok(
  $$update public.notification_deliveries set status = 'confirmed'
    where notification_id = (
      select id from public.notifications
      where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  null,
  'direct delivery status mutation is denied until the acknowledgement RPC exists'
);

reset role;
update public.memberships
set status = 'ended'
where id = 'b4000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b5100000-0000-4000-8000-000000000001"}'::text,
  true
);

select results_eq(
  $$select delivery_count, replayed
    from public.enqueue_staff_notification(
      'b2000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'general', 2::smallint, '今日提醒', '請登入系統查看最新通知。',
      array['b1000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003']::uuid[],
      array['in_app','pwa']::text[], null, 'calendar', 'event-1',
      'b6000000-0000-4000-8000-000000000002'
    )$$,
  $$values (4, true)$$,
  'an exact committed request remains replayable after a recipient later becomes inactive'
);

select is(
  (
    select count(*)::integer from public.notification_deliveries
    where notification_id = (
      select id from public.notifications
      where queue_idempotency_key = 'b6000000-0000-4000-8000-000000000002'
    )
  ),
  4,
  'post-change replay still creates no duplicate delivery rows'
);

reset role;

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.notifications'
      and event.action = 'insert'
      and event.organization_id = 'b2000000-0000-4000-8000-000000000001'
      and event.branch_id = 'b3000000-0000-4000-8000-000000000001'
      and event.actor_user_id = 'b1000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.notification_deliveries'
      and event.action = 'insert'
      and event.organization_id = 'b2000000-0000-4000-8000-000000000001'
      and event.actor_user_id = 'b1000000-0000-4000-8000-000000000001'
  ),
  'notification and delivery creation are both represented in the append-only audit ledger'
);

select * from finish();
rollback;
