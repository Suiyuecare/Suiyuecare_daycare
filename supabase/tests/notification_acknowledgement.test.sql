begin;

select plan(35);

select ok(
  to_regclass('private.notification_acknowledgement_operations') is not null
  and (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class relation
    where relation.oid = 'private.notification_acknowledgement_operations'::regclass
  ),
  'notification acknowledgement receipts are private and force RLS'
);

select ok(
  exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'private.notification_acknowledgement_operations'::regclass
      and definition.conname = 'notification_acknowledgement_operations_delivery_scope_fkey'
      and definition.confrelid = 'public.notification_deliveries'::regclass
      and definition.confdeltype = 'r'
  )
  and exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'private.notification_acknowledgement_operations'::regclass
      and definition.conname = 'notification_acknowledgement_operations_actor_key'
      and definition.contype = 'u'
  )
  and exists (
    select 1
    from pg_class index_relation
    join pg_index index_definition
      on index_definition.indexrelid = index_relation.oid
    where index_relation.relname = 'notification_acknowledgement_operations_notification_idx'
  ),
  'the immutable ledger binds exact delivery scope and indexes notification history'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.acknowledge_notification_delivery(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.acknowledge_notification_delivery(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.acknowledge_notification_delivery(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.acknowledge_notification_delivery(uuid,uuid,uuid,public.delivery_status,uuid)'::regprocedure
  ),
  'the public acknowledgement surface is an authenticated-only SECURITY INVOKER wrapper'
);

select is(
  pg_get_function_identity_arguments(
    'public.acknowledge_notification_delivery(uuid,uuid,uuid,public.delivery_status,uuid)'::regprocedure
  ),
  'p_expected_organization_id uuid, p_expected_branch_id uuid, p_notification_delivery_id uuid, p_target_status delivery_status, p_idempotency_key uuid',
  'the RPC requires trusted organization and branch context without a caller-supplied recipient or time'
);

select ok(
  (
    select procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    from pg_proc procedure
    where procedure.oid =
      'private.acknowledge_notification_delivery_guarded(uuid,uuid,uuid,public.delivery_status,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.acknowledge_notification_delivery_guarded(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.acknowledge_notification_delivery_atomic(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.acknowledge_notification_delivery_guarded(uuid,uuid,uuid,public.delivery_status,uuid)',
    'execute'
  ),
  'the guarded SECURITY DEFINER shim validates current staff authority while the ledger core is not directly executable'
);

select ok(
  not has_table_privilege('authenticated', 'public.notification_deliveries', 'insert')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'update')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'delete')
  and not has_column_privilege('authenticated', 'public.notification_deliveries', 'status', 'update')
  and not has_table_privilege('authenticated', 'private.notification_acknowledgement_operations', 'select')
  and not has_table_privilege('authenticated', 'private.notification_acknowledgement_operations', 'insert')
  and not has_table_privilege('service_role', 'private.notification_acknowledgement_operations', 'select')
  and not has_table_privilege('service_role', 'private.notification_acknowledgement_operations', 'insert'),
  'browser and service roles cannot forge delivery state or acknowledgement receipts with direct DML'
);

select ok(
  exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'public.notification_deliveries'::regclass
      and trigger_definition.tgname = 'notification_deliveries_prevent_confirmed_regression'
      and not trigger_definition.tgisinternal
  )
  and exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'private.notification_acknowledgement_operations'::regclass
      and trigger_definition.tgname = 'notification_acknowledgement_operations_prevent_mutation'
      and not trigger_definition.tgisinternal
  ),
  'terminal confirmation and immutable acknowledgement history are enforced by triggers'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ack-recipient@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ack-other@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ack-inactive@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'ack-no-membership@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('c2000000-0000-4000-8000-000000000001', 'ack_org_a', '通知確認測試機構 A'),
  ('c2000000-0000-4000-8000-000000000002', 'ack_org_b', '通知確認測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'main', '通知確認 A 主分支'),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'other', '通知確認 A 其他分支'),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 'main', '通知確認 B 主分支');

insert into public.profiles (id, display_name, kind, is_active) values
  ('c1000000-0000-4000-8000-000000000001', '通知收件者', 'staff', true),
  ('c1000000-0000-4000-8000-000000000002', '其他收件者', 'staff', true),
  ('c1000000-0000-4000-8000-000000000003', '停用收件者', 'staff', false),
  ('c1000000-0000-4000-8000-000000000004', '無機構收件者', 'staff', true);

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', null, 'c1000000-0000-4000-8000-000000000001', 'active'),
  ('c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'active'),
  ('c4000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'active'),
  ('c4000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('c4000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006');

insert into public.notifications (
  id, organization_id, branch_id, category, priority, title, body,
  audience, status, created_by
) values
  ('c5000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'general', 3, 'A 主分支通知', '請登入系統查看。', '{}'::jsonb, 'sent', 'c1000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 'general', 1, 'A 其他分支通知', '請登入系統查看。', '{}'::jsonb, 'sent', 'c1000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000003', 'general', 1, 'B 主分支通知', '請登入系統查看。', '{}'::jsonb, 'sent', 'c1000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'general', 1, 'A 後續通知', '請登入系統查看。', '{}'::jsonb, 'sent', 'c1000000-0000-4000-8000-000000000001');

insert into public.notification_deliveries (
  id, organization_id, branch_id, notification_id, recipient_user_id,
  channel, status, idempotency_key, sent_at, delivered_at, read_at, confirmed_at
) values
  ('c5100000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'in_app', 'queued', 'c5200000-0000-4000-8000-000000000001', null, null, null, null),
  ('c5100000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'in_app', 'delivered', 'c5200000-0000-4000-8000-000000000002', now() - interval '10 minutes', now() - interval '9 minutes', null, null),
  ('c5100000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'pwa', 'confirmed', 'c5200000-0000-4000-8000-000000000003', now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '4 minutes', now() - interval '3 minutes'),
  ('c5100000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'line', 'failed', 'c5200000-0000-4000-8000-000000000004', now() - interval '10 minutes', null, null, null),
  ('c5100000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'in_app', 'queued', 'c5200000-0000-4000-8000-000000000005', null, null, null, null),
  ('c5100000-0000-4000-8000-000000000006', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'sms', 'sent', 'c5200000-0000-4000-8000-000000000006', now() - interval '10 minutes', null, null, null),
  ('c5100000-0000-4000-8000-000000000007', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'email', 'read', 'c5200000-0000-4000-8000-000000000007', now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '5 minutes', null),
  ('c5100000-0000-4000-8000-000000000008', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'in_app', 'queued', 'c5200000-0000-4000-8000-000000000008', null, null, null, null),
  ('c5100000-0000-4000-8000-000000000009', 'c2000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'in_app', 'queued', 'c5200000-0000-4000-8000-000000000009', null, null, null, null),
  ('c5100000-0000-4000-8000-000000000010', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004', 'in_app', 'queued', 'c5200000-0000-4000-8000-000000000010', null, null, null, null),
  ('c5100000-0000-4000-8000-000000000011', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'in_app', 'queued', 'c5200000-0000-4000-8000-000000000011', null, null, null, null),
  ('c5100000-0000-4000-8000-000000000012', 'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'pwa', 'read', 'c5200000-0000-4000-8000-000000000012', now() - interval '10 minutes', now() - interval '9 minutes', now() - interval '5 minutes', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select status, read_at is not null, confirmed_at is null,
           acknowledged_at = read_at, replayed
    from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000001',
      'read', 'c6000000-0000-4000-8000-000000000001'
    )$$,
  $$values ('read'::public.delivery_status, true, true, true, false)$$,
  'an active AAL2 staff recipient can mark its own queued delivery read'
);

reset role;
select results_eq(
  $$select organization_id, branch_id, recipient_user_id, status,
           read_at is not null, confirmed_at is null
    from public.notification_deliveries
    where id = 'c5100000-0000-4000-8000-000000000001'$$,
  $$values (
    'c2000000-0000-4000-8000-000000000001'::uuid,
    'c3000000-0000-4000-8000-000000000001'::uuid,
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'read'::public.delivery_status, true, true
  )$$,
  'the delivery retains exact tenant, branch, and recipient scope while recording server time'
);

select results_eq(
  $$select organization_id, branch_id, notification_delivery_id,
           recipient_user_id, target_status, result_status,
           request_hash ~ '^[a-f0-9]{64}$',
           result_read_at = created_at, result_confirmed_at is null
    from private.notification_acknowledgement_operations
    where idempotency_key = 'c6000000-0000-4000-8000-000000000001'$$,
  $$values (
    'c2000000-0000-4000-8000-000000000001'::uuid,
    'c3000000-0000-4000-8000-000000000001'::uuid,
    'c5100000-0000-4000-8000-000000000001'::uuid,
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'read'::public.delivery_status, 'read'::public.delivery_status,
    true, true, true
  )$$,
  'the operation ledger stores canonical request identity and server-derived result evidence'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select status, acknowledged_at = read_at, replayed
    from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000001',
      'read', 'c6000000-0000-4000-8000-000000000001'
    )$$,
  $$values ('read'::public.delivery_status, true, true)$$,
  'an exact retry returns the original acknowledgement result'
);

reset role;
select is(
  (
    select count(*)::integer
    from private.notification_acknowledgement_operations
    where idempotency_key = 'c6000000-0000-4000-8000-000000000001'
  ),
  1,
  'exact replay creates no duplicate operation receipt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000001',
      'confirmed', 'c6000000-0000-4000-8000-000000000001'
    )$$,
  '23505', 'notification acknowledgement idempotency conflict',
  'the same key cannot change the acknowledgement target'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000006',
      'read', 'c6000000-0000-4000-8000-000000000001'
    )$$,
  '23505', 'notification acknowledgement idempotency conflict',
  'the same key cannot be retargeted to another delivery'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000002',
      'read', 'c6000000-0000-4000-8000-000000000002'
    )$$,
  '42501', 'notification acknowledgement is not permitted in the selected tenant context',
  'a recipient cannot acknowledge another users delivery'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000002',
      'c5100000-0000-4000-8000-000000000001',
      'read', 'c6000000-0000-4000-8000-000000000003'
    )$$,
  '42501', 'notification acknowledgement is not permitted in the selected tenant context',
  'a selected branch cannot be substituted for the delivery branch'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000002',
      'c3000000-0000-4000-8000-000000000003',
      'c5100000-0000-4000-8000-000000000001',
      'read', 'c6000000-0000-4000-8000-000000000004'
    )$$,
  '42501', 'notification acknowledgement is not permitted in the selected tenant context',
  'an organization the recipient belongs to cannot be substituted for the delivery tenant'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000005',
      'read', 'c6000000-0000-4000-8000-000000000005'
    )$$,
  '42501', 'notification acknowledgement is not permitted in the selected tenant context',
  'a disabled profile cannot acknowledge its own delivery'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000010',
      'read', 'c6000000-0000-4000-8000-000000000006'
    )$$,
  '42501', 'notification acknowledgement is not permitted in the selected tenant context',
  'an active profile without an active selected-tenant membership is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000006',
      'failed', 'c6000000-0000-4000-8000-000000000007'
    )$$,
  '22023', 'notification acknowledgement target must be read or confirmed',
  'the recipient RPC cannot author provider failure states'
);

select results_eq(
  $$select status, read_at is not null, confirmed_at is not null,
           read_at = confirmed_at, confirmed_at = acknowledged_at, replayed
    from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000006',
      'confirmed', 'c6000000-0000-4000-8000-000000000008'
    )$$,
  $$values ('confirmed'::public.delivery_status, true, true, true, true, false)$$,
  'confirming an unread sent delivery records read and confirmation at one server time'
);

reset role;
select results_eq(
  $$select delivery.status, delivery.read_at = operation.created_at,
           delivery.confirmed_at = operation.created_at,
           operation.result_status, operation.result_read_at,
           operation.result_confirmed_at
    from public.notification_deliveries delivery
    join private.notification_acknowledgement_operations operation
      on operation.notification_delivery_id = delivery.id
     and operation.idempotency_key = 'c6000000-0000-4000-8000-000000000008'
    where delivery.id = 'c5100000-0000-4000-8000-000000000006'$$,
  $$select 'confirmed'::public.delivery_status, true, true,
           'confirmed'::public.delivery_status, created_at, created_at
    from private.notification_acknowledgement_operations
    where idempotency_key = 'c6000000-0000-4000-8000-000000000008'$$,
  'the delivery and immutable receipt share the same server confirmation evidence'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select status, read_at < confirmed_at,
           confirmed_at = acknowledged_at, replayed
    from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000007',
      'confirmed', 'c6000000-0000-4000-8000-000000000009'
    )$$,
  $$values ('confirmed'::public.delivery_status, true, true, false)$$,
  'confirming a read delivery preserves its earlier first-read time'
);

select results_eq(
  $$select status, read_at < acknowledged_at,
           confirmed_at is null, replayed
    from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000012',
      'read', 'c6000000-0000-4000-8000-000000000013'
    )$$,
  $$values ('read'::public.delivery_status, true, true, false)$$,
  'an independently keyed read of an already-read delivery preserves the first-read time'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000003',
      'read', 'c6000000-0000-4000-8000-000000000010'
    )$$,
  '23514', 'notification delivery cannot transition to requested acknowledgement status',
  'a confirmed delivery cannot regress to read through the RPC'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000004',
      'read', 'c6000000-0000-4000-8000-000000000011'
    )$$,
  '23514', 'notification delivery cannot transition to requested acknowledgement status',
  'failed provider delivery state cannot be overwritten by a recipient acknowledgement'
);

select throws_ok(
  $$update public.notification_deliveries
    set status = 'read', read_at = clock_timestamp()
    where id = 'c5100000-0000-4000-8000-000000000011'$$,
  '42501', null,
  'authenticated recipients still cannot bypass the RPC with direct delivery DML'
);

reset role;
select throws_ok(
  $$update public.notification_deliveries
    set status = 'delivered'
    where id = 'c5100000-0000-4000-8000-000000000003'$$,
  '23514', 'confirmed notification delivery cannot regress or lose evidence',
  'confirmation cannot regress even through a privileged provider-side update'
);

select throws_ok(
  $$update public.notification_deliveries
    set status = 'delivered'
    where id = 'c5100000-0000-4000-8000-000000000001'$$,
  '23514', 'read notification delivery can only advance to confirmed',
  'a read delivery cannot regress to a provider delivery state'
);

select throws_ok(
  $$update public.notification_deliveries
    set read_at = clock_timestamp()
    where id = 'c5100000-0000-4000-8000-000000000001'$$,
  '23514', 'notification read time is immutable once recorded',
  'the first-read server timestamp cannot be rewritten'
);

select throws_ok(
  $$update private.notification_acknowledgement_operations
    set request_hash = repeat('0', 64)
    where idempotency_key = 'c6000000-0000-4000-8000-000000000001'$$,
  '55000', 'notification acknowledgement history is immutable',
  'the operation ledger rejects updates even by its owner'
);

select throws_ok(
  $$delete from private.notification_acknowledgement_operations
    where idempotency_key = 'c6000000-0000-4000-8000-000000000001'$$,
  '55000', 'notification acknowledgement history is immutable',
  'the operation ledger rejects deletes even by its owner'
);

select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.notification_deliveries'
      and event.action = 'update'
      and event.organization_id = 'c2000000-0000-4000-8000-000000000001'
      and event.branch_id = 'c3000000-0000-4000-8000-000000000001'
      and event.actor_user_id = 'c1000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events event
    where event.table_name = 'private.notification_acknowledgement_operations'
      and event.action = 'insert'
      and event.organization_id = 'c2000000-0000-4000-8000-000000000001'
      and event.branch_id = 'c3000000-0000-4000-8000-000000000001'
      and event.actor_user_id = 'c1000000-0000-4000-8000-000000000001'
  ),
  'delivery mutation and immutable acknowledgement receipt are both auditable without payload content'
);

update public.memberships
set status = 'ended'
where id = 'c4000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000001',
      'read', 'c6000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'notification acknowledgement is not permitted in the selected tenant context',
  'an exact replay cannot bypass current membership and permission revocation'
);

select throws_ok(
  $$select * from public.acknowledge_notification_delivery(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c5100000-0000-4000-8000-000000000011',
      'read', 'c6000000-0000-4000-8000-000000000012'
    )$$,
  '42501', 'notification acknowledgement is not permitted in the selected tenant context',
  'an ended membership cannot authorize a new acknowledgement'
);

select * from finish();
rollback;
