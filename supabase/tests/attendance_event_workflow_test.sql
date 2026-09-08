begin;

select plan(40);

select ok(
  to_regclass('private.attendance_operations') is not null,
  'private attendance operation ledger exists'
);

select ok(
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'attendance_operations'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'private attendance ledger enables and forces RLS'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.record_attendance_event(uuid,uuid,uuid,text,timestamptz,text,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.record_attendance_event_atomic(uuid,uuid,uuid,text,timestamptz,text,uuid)'::regprocedure
  ),
  'public wrapper is SECURITY INVOKER and private transaction is SECURITY DEFINER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_attendance_event(uuid,uuid,uuid,text,timestamptz,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_attendance_event(uuid,uuid,uuid,text,timestamptz,text,uuid)',
    'execute'
  ),
  'attendance RPC is authenticated-only'
);

select ok(
  has_table_privilege('authenticated', 'public.attendance_records', 'select')
  and not has_table_privilege('authenticated', 'public.attendance_records', 'insert')
  and not has_table_privilege('authenticated', 'public.attendance_records', 'update')
  and not has_table_privilege('authenticated', 'public.attendance_records', 'delete'),
  'authenticated may read but cannot directly mutate attendance rows'
);

select ok(
  not has_table_privilege('authenticated', 'private.attendance_operations', 'select')
  and not has_table_privilege('authenticated', 'private.attendance_operations', 'insert')
  and not has_table_privilege('service_role', 'private.attendance_operations', 'update')
  and not has_table_privilege('service_role', 'private.attendance_operations', 'delete'),
  'private operation ledger has no direct client or service-role data privileges'
);

select ok(
  (
    select
      position(
        'attendance event idempotency conflict'
        in function_definition
      ) > position(
        'from private.attendance_operations operation'
        in function_definition
      )
      and position(
        'v_now := clock_timestamp()'
        in function_definition
      ) > position('return;' in function_definition)
      and position(
        'attendance event cannot be more than five minutes in the future'
        in function_definition
      ) > position('return;' in function_definition)
      and position(
        'v_is_backfill := v_now - p_occurred_at'
        in function_definition
      ) > position('return;' in function_definition)
    from (
      select pg_get_functiondef(
        'private.record_attendance_event_atomic(uuid,uuid,uuid,text,timestamptz,text,uuid)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'exact replay resolves before fresh server time, future, and backfill gates'
);

select ok(
  exists (
    select 1
    from pg_constraint definition
    where definition.conrelid = 'private.attendance_operations'::regclass
      and definition.conname = 'attendance_operations_record_scope_fkey'
      and definition.contype = 'f'
  )
  and exists (
    select 1
    from pg_index definition
    join pg_class index_relation on index_relation.oid = definition.indexrelid
    where definition.indrelid = 'private.attendance_operations'::regclass
      and index_relation.relname = 'attendance_operations_client_day_idx'
  )
  and exists (
    select 1
    from pg_index definition
    join pg_class index_relation on index_relation.oid = definition.indexrelid
    where definition.indrelid = 'private.attendance_operations'::regclass
      and index_relation.relname = 'attendance_operations_attendance_id_idx'
  ),
  'operation ledger has scoped foreign keys, history lookup, and attendance FK indexes'
);

select set_config('test.attendance_now', clock_timestamp()::text, true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'attendance-supervisor-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'attendance-worker-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'attendance-professional-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'attendance-supervisor-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('81000000-0000-4000-8000-000000000001', 'attendance_org_a', '出勤測試機構 A'),
  ('81000000-0000-4000-8000-000000000002', 'attendance_org_b', '出勤測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'main', '出勤 A 主分支'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'second', '出勤 A 第二分支'),
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', 'main', '出勤 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('80000000-0000-4000-8000-000000000001', 'A 分支主管', 'staff'),
  ('80000000-0000-4000-8000-000000000002', 'A 照顧服務員', 'staff'),
  ('80000000-0000-4000-8000-000000000003', 'A 專業人員', 'staff'),
  ('80000000-0000-4000-8000-000000000004', 'B 分支主管', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', 'active'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002', 'active'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000003', 'active'),
  ('83000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003', '80000000-0000-4000-8000-000000000004', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('83000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003'),
  ('83000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006'),
  ('83000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'),
  ('83000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-001', '一般簽到個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-002', '未到個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-003', '請假個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-004', '暫停個案', 'suspended', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-005', '尚未收案個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date + 1), null, 'test'),
  ('84000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-006', '已終止個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 1), 'test'),
  ('84000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 'ATT-A2-001', '其他分支個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003', 'ATT-B-001', '其他機構個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000009', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-009', '負時數個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000010', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-010', '主管補登個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000011', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-011', '員工補登個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000012', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-012', '缺權限個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('84000000-0000-4000-8000-000000000013', '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'ATT-A-013', '過期補登個案', 'active', ((current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test');

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
)
select
  client.organization_id,
  client.branch_id,
  client.id,
  '80000000-0000-4000-8000-000000000002',
  'primary'
from public.clients client
where client.organization_id = '81000000-0000-4000-8000-000000000001'
  and client.branch_id = '82000000-0000-4000-8000-000000000001';

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000012',
  '80000000-0000-4000-8000-000000000003',
  'professional'
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '85000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  '87000000-0000-4000-8000-000000000001',
  current_setting('test.attendance_now')::timestamptz - interval '2 minutes',
  'attendance-before-stepup',
  current_setting('test.attendance_now')::timestamptz - interval '1 minute',
  current_setting('test.attendance_now')::timestamptz + interval '4 minutes',
  current_setting('test.attendance_now')::timestamptz - interval '30 seconds',
  current_setting('test.attendance_now')::timestamptz - interval '30 seconds',
  'attendance-after-stepup',
  'totp',
  current_setting('test.attendance_now')::timestamptz - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '80000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  'aal2',
  'totp',
  current_setting('test.attendance_now')::timestamptz - interval '30 seconds'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal1',
    'session_id', '86000000-0000-4000-8000-000000000002',
    'amr', jsonb_build_array(jsonb_build_object('method', 'password'))
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '5 minutes',
    null,
    '88000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'AAL1 cannot record attendance'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '86000000-0000-4000-8000-000000000002',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp'))
  )::text,
  true
);

select is(
  (select replayed from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '5 minutes',
    null,
    '88000000-0000-4000-8000-000000000001'
  )),
  false,
  'authorized AAL2 worker creates a recent check-in'
);

select results_eq(
  $$select
      service_date,
      status::text,
      source,
      checked_out_at is null
    from public.attendance_records
    where client_id = '84000000-0000-4000-8000-000000000001'$$,
  $$select
      ((current_setting('test.attendance_now')::timestamptz - interval '5 minutes') at time zone 'Asia/Taipei')::date,
      'present'::text,
      'staff'::text,
      true$$,
  'service date is derived in Taipei and recent source is staff'
);

set local time zone 'Pacific/Auckland';

select is(
  (select replayed from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '5 minutes',
    null,
    '88000000-0000-4000-8000-000000000001'
  )),
  true,
  'an exact check-in retry returns the stored operation across session time zones'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '4 minutes',
    null,
    '88000000-0000-4000-8000-000000000001'
  )$$,
  '23505',
  'attendance event idempotency conflict',
  'the same idempotency key cannot represent different content'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '3 minutes',
    null,
    '88000000-0000-4000-8000-000000000002'
  )$$,
  '23514',
  null,
  'a different operation cannot create duplicate attendance on the same day'
);

select is(
  (select replayed from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_out',
    current_setting('test.attendance_now')::timestamptz - interval '1 minute',
    null,
    '88000000-0000-4000-8000-000000000003'
  )),
  false,
  'check-out updates the open attendance row through the transaction'
);

select results_eq(
  $$select
      checked_in_at,
      checked_out_at,
      source,
      replayed
    from public.record_attendance_event(
      '81000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001',
      'check_out',
      current_setting('test.attendance_now')::timestamptz - interval '1 minute',
      null,
      '88000000-0000-4000-8000-000000000003'
    )$$,
  $$select
      current_setting('test.attendance_now')::timestamptz - interval '5 minutes',
      current_setting('test.attendance_now')::timestamptz - interval '1 minute',
      'staff'::text,
      true$$,
  'check-out exact replay returns its original stored result'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'check_out',
    current_setting('test.attendance_now')::timestamptz,
    null,
    '88000000-0000-4000-8000-000000000004'
  )$$,
  '23514',
  null,
  'a completed attendance row cannot be checked out twice'
);

select is(
  (select status::text from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000002',
    'absent',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes',
    null,
    '88000000-0000-4000-8000-000000000005'
  )),
  'absent',
  'absence is recorded without attendance times'
);

select is(
  (select status::text from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000003',
    'leave',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes',
    null,
    '88000000-0000-4000-8000-000000000006'
  )),
  'leave',
  'leave is recorded without attendance times'
);

select is(
  (select replayed from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000009',
    'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '5 minutes',
    null,
    '88000000-0000-4000-8000-000000000007'
  )),
  false,
  'negative-duration fixture has an open check-in'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000009',
    'check_out',
    current_setting('test.attendance_now')::timestamptz - interval '10 minutes',
    null,
    '88000000-0000-4000-8000-000000000008'
  )$$,
  '23514',
  'check-out cannot precede check-in',
  'negative attendance duration is rejected'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000004', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes', null,
    '88000000-0000-4000-8000-000000000009'
  )$$,
  '23514', null, 'a suspended client cannot receive attendance'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000005', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes', null,
    '88000000-0000-4000-8000-000000000010'
  )$$,
  '23514', null, 'a client cannot attend before admission'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000006', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes', null,
    '88000000-0000-4000-8000-000000000011'
  )$$,
  '23514', null, 'a client cannot attend after the end date'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000007', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes', null,
    '88000000-0000-4000-8000-000000000012'
  )$$,
  '42501', null, 'branch-scoped worker cannot write another branch'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003',
    '84000000-0000-4000-8000-000000000008', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes', null,
    '88000000-0000-4000-8000-000000000013'
  )$$,
  '42501', null, 'worker cannot write another tenant'
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000011', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 hours', '稍後補登',
    '88000000-0000-4000-8000-000000000014'
  )$$,
  '42501', null, 'attendance.write alone cannot create a backfill'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000003',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '86000000-0000-4000-8000-000000000003',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp'))
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000012', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 minutes', null,
    '88000000-0000-4000-8000-000000000015'
  )$$,
  '42501', null, 'assigned staff without attendance.write remains denied'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '86000000-0000-4000-8000-000000000001',
    'iat', extract(epoch from current_setting('test.attendance_now')::timestamptz)::bigint,
    'jti', 'attendance-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp'))
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000010', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 hours', null,
    '88000000-0000-4000-8000-000000000016'
  )$$,
  '22023', 'a non-empty reason is required for attendance backfill',
  'backfill requires a non-empty reason'
);

select results_eq(
  $$select source, replayed from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000010', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 hours', '紙本時間補登',
    '88000000-0000-4000-8000-000000000017'
  )$$,
  $$values ('staff_backfill'::text, false)$$,
  'authorized recent AAL2 supervisor creates staff_backfill history'
);

select throws_ok(
  $$insert into public.attendance_records (
      organization_id, branch_id, client_id, service_date, status,
      checked_in_at, source, idempotency_key, recorded_by
    ) values (
      '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000013',
      (current_setting('test.attendance_now')::timestamptz at time zone 'Asia/Taipei')::date,
      'present', current_setting('test.attendance_now')::timestamptz,
      'staff', '88000000-0000-4000-8000-000000000018',
      '80000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null, 'direct authenticated INSERT is rejected'
);

select throws_ok(
  $$update public.attendance_records
    set checked_out_at = current_setting('test.attendance_now')::timestamptz
    where client_id = '84000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'direct authenticated UPDATE is rejected'
);

reset role;

select is(
  (select count(*)::integer from private.attendance_operations
   where client_id = '84000000-0000-4000-8000-000000000001'),
  2,
  'check-in and check-out have independent immutable operation rows'
);

select is(
  (select reason from private.attendance_operations
   where client_id = '84000000-0000-4000-8000-000000000010'),
  '紙本時間補登',
  'backfill ledger retains the normalized reason'
);

select ok(
  exists (
    select 1 from public.audit_events
    where table_name = 'public.attendance_records'
      and organization_id = '81000000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.audit_events
    where table_name = 'private.attendance_operations'
      and organization_id = '81000000-0000-4000-8000-000000000001'
  ),
  'base attendance and immutable operations both emit audit events'
);

select throws_ok(
  $$update private.attendance_operations set reason = '竄改' where true$$,
  '55000', 'attendance operation history is immutable',
  'operation ledger rejects UPDATE even for the test owner'
);

select throws_ok(
  $$delete from private.attendance_operations where true$$,
  '55000', 'attendance operation history is immutable',
  'operation ledger rejects DELETE even for the test owner'
);

update private.reauth_events
set verified_at = current_setting('test.attendance_now')::timestamptz - interval '16 minutes'
where user_id = '80000000-0000-4000-8000-000000000001'
  and session_id = '86000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '80000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2',
    'session_id', '86000000-0000-4000-8000-000000000001',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp'))
  )::text,
  true
);

select throws_ok(
  $$select * from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000013', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 hours', '過期重新驗證',
    '88000000-0000-4000-8000-000000000019'
  )$$,
  '42501', null, 'expired recent AAL2 cannot create a new backfill'
);

select is(
  (select replayed from public.record_attendance_event(
    '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000010', 'check_in',
    current_setting('test.attendance_now')::timestamptz - interval '2 hours', '紙本時間補登',
    '88000000-0000-4000-8000-000000000017'
  )),
  true,
  'an exact backfill retry remains replayable without creating a second write'
);

reset role;

select is(
  (select count(*)::integer from private.attendance_operations
   where organization_id = '81000000-0000-4000-8000-000000000001'
     and idempotency_key = '88000000-0000-4000-8000-000000000017'),
  1,
  'exact backfill replay creates no duplicate ledger row'
);

select * from finish();
rollback;
