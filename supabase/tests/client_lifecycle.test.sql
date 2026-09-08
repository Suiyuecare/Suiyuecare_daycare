begin;

select plan(45);

select ok(
  to_regclass('public.client_transitions') is not null,
  'client transition ledger exists'
);

select ok(
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'client_transitions'
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'client transitions enable and force RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.client_transitions', 'select')
  and not has_table_privilege('authenticated', 'public.client_transitions', 'insert')
  and not has_table_privilege('authenticated', 'public.client_transitions', 'update')
  and not has_table_privilege('authenticated', 'public.client_transitions', 'delete')
  and not has_table_privilege('anon', 'public.client_transitions', 'select')
  and not has_table_privilege('anon', 'public.client_transitions', 'insert')
  and has_type_privilege('authenticated', 'public.client_transition_kind', 'usage')
  and not has_type_privilege('anon', 'public.client_transition_kind', 'usage'),
  'authenticated can read authorized history but cannot bypass the transition RPC'
);

select ok(
  has_table_privilege('service_role', 'public.client_transitions', 'select')
  and not has_table_privilege('service_role', 'public.client_transitions', 'insert')
  and not has_table_privilege('service_role', 'public.client_transitions', 'update')
  and not has_table_privilege('service_role', 'public.client_transitions', 'delete'),
  'service role can inspect but cannot forge or mutate lifecycle history'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.transition_client(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.transition_client(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.transition_client(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)'::regprocedure
  ),
  'public transition RPC is authenticated-only and SECURITY INVOKER'
);

select results_eq(
  $$select enumlabel::text collate "C"
    from pg_enum
    where enumtypid = 'public.client_transition_kind'::regtype
    order by enumsortorder$$,
  $$values
    ('admit'::text collate "C"),
    ('suspend'::text collate "C"),
    ('resume'::text collate "C"),
    ('transfer'::text collate "C"),
    ('close'::text collate "C"),
    ('death'::text collate "C")$$,
  'the lifecycle enum exposes exactly the six accepted event kinds'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.client_transitions'::regclass
      and constraint_definition.conname = 'client_transitions_client_scope_fkey'
      and constraint_definition.contype = 'f'
  )
  and exists (
    select 1
    from pg_index index_definition
    join pg_class index_relation on index_relation.oid = index_definition.indexrelid
    where index_definition.indrelid = 'public.client_transitions'::regclass
      and index_relation.relname = 'client_transitions_scope_history_idx'
  ),
  'tenant-scoped client foreign key and history index both exist'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'lifecycle-manager-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'lifecycle-supervisor-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'lifecycle-manager-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('51000000-0000-4000-8000-000000000001', 'lifecycle_org_a', '生命週期測試機構 A'),
  ('51000000-0000-4000-8000-000000000002', 'lifecycle_org_b', '生命週期測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'main', '生命週期 A 主分支'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', 'second', '生命週期 A 第二分支'),
  ('52000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', 'main', '生命週期 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('50000000-0000-4000-8000-000000000001', 'A 機構測試管理員', 'staff'),
  ('50000000-0000-4000-8000-000000000002', 'A 分支測試主管', 'staff'),
  ('50000000-0000-4000-8000-000000000003', 'B 機構測試管理員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', null, '50000000-0000-4000-8000-000000000001', 'active'),
  ('53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'active'),
  ('53000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', null, '50000000-0000-4000-8000-000000000003', 'active'),
  ('53000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000002', null, '50000000-0000-4000-8000-000000000001', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('53000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('53000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'),
  ('53000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('53000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, source_system
) values
  ('54000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'LIFE-A-001', '生命週期個案 A1', 'active', null, 'test'),
  ('54000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'LIFE-A-002', '生命週期個案 A2', 'active', '2026-08-01', 'test'),
  ('54000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'LIFE-A-003', '生命週期個案 A3', 'active', '2026-08-01', 'test'),
  ('54000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'LIFE-A-004', '生命週期個案 A4', 'active', '2026-08-10', 'test'),
  ('54000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002', 'LIFE-A-005', '生命週期個案 A5', 'active', '2026-08-01', 'test'),
  ('54000000-0000-4000-8000-000000000006', '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000003', 'LIFE-B-001', '生命週期個案 B1', 'active', '2026-08-01', 'test');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  (
    '55000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
    '55100000-0000-4000-8000-000000000001', repeat('a', 64),
    '55200000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
    'lifecycle-manager-before-stepup', clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
    clock_timestamp() - interval '30 seconds', 'lifecycle-manager-after-stepup', 'totp',
    clock_timestamp() - interval '30 seconds'
  ),
  (
    '55000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002',
    '55100000-0000-4000-8000-000000000002', repeat('b', 64),
    '55200000-0000-4000-8000-000000000002', clock_timestamp() - interval '2 minutes',
    'lifecycle-supervisor-before-stepup', clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
    clock_timestamp() - interval '30 seconds', 'lifecycle-supervisor-after-stepup', 'totp',
    clock_timestamp() - interval '30 seconds'
  );

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  (
    '50000000-0000-4000-8000-000000000001', '55100000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001', 'aal2', 'totp',
    clock_timestamp() - interval '30 seconds'
  ),
  (
    '50000000-0000-4000-8000-000000000002', '55100000-0000-4000-8000-000000000002',
    '55000000-0000-4000-8000-000000000002', 'aal2', 'totp',
    clock_timestamp() - interval '30 seconds'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"55100000-0000-4000-8000-000000000001","amr":[{"method":"password"}]}'::text,
  true
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'admit', '2026-09-01',
      '正式收案', null, 1, '56000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'AAL1 cannot apply a client transition'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '55100000-0000-4000-8000-000000000099',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'lifecycle-no-recent-evidence',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp())::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'admit', '2026-09-01',
      '正式收案', null, 1, '56000000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  null,
  'an AAL2 JWT without recent evidence for the same session is denied'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '55100000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'lifecycle-manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000006', 'close', '2026-09-01',
      '跨機構結案禁止', '不應寫入', 1,
      '56000000-0000-4000-8000-000000000003'
    )$$,
  '42501',
  null,
  'multi-scope actor cannot transition a client outside the selected tenant context'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000002', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '55100000-0000-4000-8000-000000000002',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'lifecycle-supervisor-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000005', 'close', '2026-09-01',
      '跨分支結案禁止', '不應寫入', 1,
      '56000000-0000-4000-8000-000000000004'
    )$$,
  '42501',
  null,
  'branch supervisor cannot transition a client in another branch'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '50000000-0000-4000-8000-000000000001', 'role', 'authenticated',
    'aal', 'aal2', 'session_id', '55100000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'lifecycle-manager-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$insert into public.client_transitions (
      organization_id, branch_id, client_id, event_kind, effective_on, reason,
      handoff_note, from_status, to_status, base_row_version,
      resulting_row_version, idempotency_key, actor_user_id
    ) values (
      '51000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000003',
      '54000000-0000-4000-8000-000000000006', 'close', '2026-09-01',
      '繞過選定範圍結案', '不應寫入', 'active', 'closed', 1, 2,
      '56000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'multi-scope actor cannot bypass selected context with direct transition insert'
);

select throws_ok(
  $$insert into public.client_transitions (
      client_id, event_kind, effective_on, reason, idempotency_key,
      actor_user_id
    ) values (
      '54000000-0000-4000-8000-000000000004', 'suspend', '2026-09-01',
      '缺少基準版本', '56000000-0000-4000-8000-000000000006',
      '50000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'direct insert is denied before trigger validation can be used as a side channel'
);

select lives_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'admit', '2026-09-01',
      '  正式收案  ', null, 1, '56000000-0000-4000-8000-000000000010'
    )$$,
  'manager admits a new client through the RPC'
);

select results_eq(
  $$select client_id, from_status::text collate "C", to_status::text collate "C",
           resulting_row_version, replayed
    from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'admit', '2026-09-01',
      '正式收案', null, 1, '56000000-0000-4000-8000-000000000010'
    )$$,
  $$values (
    '54000000-0000-4000-8000-000000000001'::uuid,
    'active'::text collate "C", 'active'::text collate "C", 2::bigint, true
  )$$,
  'same idempotency key returns the stored transition as a replay'
);

select results_eq(
  $$select organization_id, branch_id, actor_user_id, reason collate "C",
           base_row_version, resulting_row_version,
           created_at is not null
    from public.client_transitions
    where client_id = '54000000-0000-4000-8000-000000000001'
      and event_kind = 'admit'$$,
  $$values (
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000001'::uuid,
    '50000000-0000-4000-8000-000000000001'::uuid,
    '正式收案'::text collate "C", 1::bigint, 2::bigint, true
  )$$,
  'scope, actor, reason, versions, and server timestamp are derived and stored'
);

select results_eq(
  $$select status::text collate "C", admitted_on, ended_on, row_version
    from public.client_directory_snapshot(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'client_lifecycle', 1, null, null,
      '54000000-0000-4000-8000-000000000001'
    )$$,
  $$values ('active'::text collate "C", '2026-09-01'::date, null::date, 2::bigint)$$,
  'admission atomically sets admission date and increments row version'
);

select is(
  (
    select count(*)::integer
    from public.client_transitions
    where actor_user_id = '50000000-0000-4000-8000-000000000001'
      and idempotency_key = '56000000-0000-4000-8000-000000000010'
  ),
  1,
  'idempotent replay creates no duplicate transition'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'admit', '2026-09-01',
      '不同請求內容', null, 1, '56000000-0000-4000-8000-000000000010'
    )$$,
  '23505',
  'client transition idempotency conflict',
  'reusing an idempotency key for different content is rejected'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'suspend', '2026-09-01',
      '版本過舊', null, 1, '56000000-0000-4000-8000-000000000011'
    )$$,
  '40001',
  'client row version conflict',
  'stale expected row version is rejected'
);

select results_eq(
  $$select to_status::text collate "C", resulting_row_version, replayed
    from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'suspend', '2026-09-01',
      '暫停服務', null, 2, '56000000-0000-4000-8000-000000000012'
    )$$,
  $$values ('suspended'::text collate "C", 3::bigint, false)$$,
  'active client can be suspended'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'suspend', '2026-09-01',
      '重複暫停', null, 3, '56000000-0000-4000-8000-000000000013'
    )$$,
  '23514',
  'suspension requires an admitted active client',
  'illegal duplicate suspension is rejected'
);

select results_eq(
  $$select to_status::text collate "C", resulting_row_version
    from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'resume', '2026-09-01',
      '恢復服務', null, 3, '56000000-0000-4000-8000-000000000014'
    )$$,
  $$values ('active'::text collate "C", 4::bigint)$$,
  'suspended client can resume service'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'close', '2026-09-01',
      '完成服務結案', null, 4, '56000000-0000-4000-8000-000000000015'
    )$$,
  '22023',
  'handoff detail is required for transfer, closure, and death',
  'closure without handoff detail is rejected'
);

select results_eq(
  $$select to_status::text collate "C", resulting_row_version
    from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'close', '2026-09-01',
      '完成服務結案', '資料已完成歸檔及交接', 4,
      '56000000-0000-4000-8000-000000000016'
    )$$,
  $$values ('closed'::text collate "C", 5::bigint)$$,
  'closure records handoff and advances to a terminal state'
);

select results_eq(
  $$select status::text collate "C", admitted_on, ended_on, row_version
    from public.client_directory_snapshot(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'client_lifecycle', 1, null, null,
      '54000000-0000-4000-8000-000000000001'
    )$$,
  $$values ('closed'::text collate "C", '2026-09-01'::date, '2026-09-01'::date, 5::bigint)$$,
  'terminal transition preserves admission and sets end date'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000001', 'resume', '2026-09-01',
      '終止後不得恢復', null, 5, '56000000-0000-4000-8000-000000000017'
    )$$,
  '23514',
  'resumption requires an admitted suspended client',
  'terminal lifecycle state cannot be reopened'
);

select throws_ok(
  $$update public.clients
    set status = 'closed', ended_on = '2026-09-01', row_version = row_version + 1
    where id = '54000000-0000-4000-8000-000000000004'$$,
  '42501',
  null,
  'direct client lifecycle mutation is rejected before table DML'
);

select throws_ok(
  $$update public.client_transitions
    set reason = '禁止修改'
    where client_id = '54000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'authenticated caller has no transition update privilege'
);

select throws_ok(
  $$delete from public.client_transitions
    where client_id = '54000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'authenticated caller has no transition delete privilege'
);

select throws_ok(
  $$insert into public.client_transitions (
      client_id, event_kind, effective_on, reason, handoff_note,
      base_row_version, idempotency_key, actor_user_id
    ) values (
      '54000000-0000-4000-8000-000000000002', 'transfer', '2026-09-01',
      '轉介其他服務單位', '交接資料已由主管確認', 1,
      '56000000-0000-4000-8000-000000000020',
      '50000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'even a valid in-scope transition cannot bypass the sole RPC mutation boundary'
);

select lives_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000002', 'transfer', '2026-09-01',
      '轉介其他服務單位', '交接資料已由主管確認', 1,
      '56000000-0000-4000-8000-000000000020'
    )$$,
  'authorized transfer succeeds only through the selected-context RPC'
);

select results_eq(
  $$select status::text collate "C", ended_on, row_version
    from public.client_directory_snapshot(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'client_lifecycle', 1, null, null,
      '54000000-0000-4000-8000-000000000002'
    )$$,
  $$values ('transferred'::text collate "C", '2026-09-01'::date, 2::bigint)$$,
  'transfer RPC atomically updates client state'
);

select results_eq(
  $$select event_kind::text collate "C", from_status::text collate "C",
           to_status::text collate "C",
           base_row_version, resulting_row_version
    from public.client_transitions
    where client_id = '54000000-0000-4000-8000-000000000002'$$,
  $$values ('transfer'::text collate "C", 'active'::text collate "C",
            'transferred'::text collate "C", 1::bigint, 2::bigint)$$,
  'transfer history stores the derived state boundary'
);

select results_eq(
  $$select to_status::text collate "C", resulting_row_version
    from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000003', 'death', '2026-09-01',
      '通報死亡結案', '文件與關係人聯繫紀錄已交接', 1,
      '56000000-0000-4000-8000-000000000021'
    )$$,
  $$values ('deceased'::text collate "C", 2::bigint)$$,
  'death transition reaches the deceased terminal state'
);

select results_eq(
  $$select status::text collate "C", ended_on, row_version
    from public.client_directory_snapshot(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'client_lifecycle', 1, null, null,
      '54000000-0000-4000-8000-000000000003'
    )$$,
  $$values ('deceased'::text collate "C", '2026-09-01'::date, 2::bigint)$$,
  'death transition stores end date on the client row'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000004', 'suspend', '2026-08-09',
      '早於收案日期', null, 1, '56000000-0000-4000-8000-000000000022'
    )$$,
  '23514',
  'client transition cannot precede the admission date',
  'transition cannot precede the stored admission date'
);

select throws_ok(
  $$select * from public.transition_client(
      '51000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      '54000000-0000-4000-8000-000000000004', 'suspend',
      ((clock_timestamp() at time zone 'Asia/Taipei')::date + 1),
      '未來事件禁止提前生效', null, 1,
      '56000000-0000-4000-8000-000000000023'
    )$$,
  '22023',
  'client transition effective date cannot be in the future',
  'future transition date is rejected'
);

select is(
  (select count(*)::integer from public.client_transitions),
  6,
  'tenant manager sees exactly the six successful transitions in their tenant'
);

select is(
  (
    select count(*)::integer
    from public.client_transitions
    where organization_id = '51000000-0000-4000-8000-000000000002'
  ),
  0,
  'cross-tenant lifecycle rows remain invisible'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_events
    where organization_id = '51000000-0000-4000-8000-000000000001'
      and table_name = 'public.client_transitions'
      and action = 'insert'
  ),
  6,
  'every successful transition creates one immutable audit marker'
);

select is(
  (
    select count(*)::integer
    from public.audit_events
    where organization_id = '51000000-0000-4000-8000-000000000001'
      and table_name = 'public.clients'
      and action = 'update'
      and changed_fields @> array['row_version']::text[]
  ),
  6,
  'every transition also audits the resulting client version update'
);

select is(
  (
    select count(*)::integer
    from public.audit_events
    where organization_id = '51000000-0000-4000-8000-000000000001'
      and table_name = 'public.client_transitions'
      and (
        metadata::text like '%正式收案%'
        or metadata::text like '%交接資料已由主管確認%'
      )
  ),
  0,
  'audit metadata contains no transition reason or handoff content'
);

reset role;

select throws_ok(
  $$update public.client_transitions
    set reason = '即使資料庫擁有者也不得修改'
    where client_id = '54000000-0000-4000-8000-000000000001'$$,
  '55000',
  'client transitions are append-only',
  'append-only trigger blocks privileged update'
);

select throws_ok(
  $$delete from public.client_transitions
    where client_id = '54000000-0000-4000-8000-000000000001'$$,
  '55000',
  'client transitions are append-only',
  'append-only trigger blocks privileged delete'
);

select * from finish();

rollback;
