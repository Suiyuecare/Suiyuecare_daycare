begin;

select plan(11);

select ok(
  not (select p.prosecdef
       from pg_proc p
       where p.oid = 'public.approve_import_staging(uuid,uuid,uuid,bigint,uuid,text)'::regprocedure),
  'public import approval RPC remains SECURITY INVOKER'
);

select ok(
  position('batch.organization_id = p_expected_organization_id' in
    pg_get_functiondef('private.approve_import_staging(uuid,uuid,uuid,bigint,uuid,text)'::regprocedure)) > 0
  and position('batch.branch_id = p_expected_branch_id' in
    pg_get_functiondef('private.approve_import_staging(uuid,uuid,uuid,bigint,uuid,text)'::regprocedure)) > 0,
  'import approval locks a batch only inside the selected tenant context'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '76000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'import-scope@example.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.organizations (id, code, name) values
  ('76100000-0000-4000-8000-000000000001', 'import_scope_a', '匯入範圍機構 A'),
  ('76100000-0000-4000-8000-000000000002', 'import_scope_b', '匯入範圍機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('76200000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'main', '匯入 A 分支'),
  ('76200000-0000-4000-8000-000000000002', '76100000-0000-4000-8000-000000000002', 'main', '匯入 B 分支');

insert into public.profiles (id, display_name, kind) values
  ('76000000-0000-4000-8000-000000000001', '跨機構匯入管理員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('76300000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'active'),
  ('76300000-0000-4000-8000-000000000002', '76100000-0000-4000-8000-000000000002', '76200000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000001', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('76300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('76300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '76400000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000001',
  '76500000-0000-4000-8000-000000000001', repeat('a', 64),
  '76600000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes',
  'import-before-stepup', clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds', 'import-after-stepup', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '76000000-0000-4000-8000-000000000001',
  '76500000-0000-4000-8000-000000000001',
  '76400000-0000-4000-8000-000000000001', 'aal2', 'totp',
  clock_timestamp() - interval '30 seconds'
);

insert into public.import_batches (
  id, organization_id, branch_id, uploaded_by, upload_idempotency_key,
  original_file_name, mime_type, encoding, file_size_bytes, sha256,
  mapping_version, status, raw_object_key
) values (
  '76700000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000002',
  '76200000-0000-4000-8000-000000000002',
  '76000000-0000-4000-8000-000000000001',
  '76800000-0000-4000-8000-000000000001',
  'synthetic.html', 'text/html', 'utf-8', 128, repeat('b', 64),
  'test-v1', 'ready_for_approval', 'synthetic/import-scope.html'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '76000000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'aal', 'aal2',
    'session_id', '76500000-0000-4000-8000-000000000001',
    'iat', extract(epoch from clock_timestamp())::bigint,
    'jti', 'import-after-stepup',
    'amr', jsonb_build_array(jsonb_build_object(
      'method', 'totp',
      'timestamp', extract(epoch from clock_timestamp() - interval '30 seconds')::bigint
    ))
  )::text,
  true
);

select throws_ok(
  $$select public.approve_import_staging(
      '76100000-0000-4000-8000-000000000001',
      '76200000-0000-4000-8000-000000000001',
      '76700000-0000-4000-8000-000000000001', 1,
      '76900000-0000-4000-8000-000000000001', repeat('c', 64)
    )$$,
  '42501', null,
  'multi-scope actor cannot approve a B batch from selected context A'
);

select throws_ok(
  $$select public.approve_import_staging(
      '76100000-0000-4000-8000-000000000002',
      '76200000-0000-4000-8000-000000000002',
      '76700000-0000-4000-8000-000000000001', 1,
      '76900000-0000-4000-8000-000000000099', null
    )$$,
  '42501', null,
  'approval rejects a null caller request hash'
);

select is(
  (select (version, approved_at is null)::text
   from public.import_batches
   where id = '76700000-0000-4000-8000-000000000001'),
  '(1,t)',
  'rejected null-hash approval leaves the batch unchanged'
);

select is(
  (public.approve_import_staging(
    '76100000-0000-4000-8000-000000000002',
    '76200000-0000-4000-8000-000000000002',
    '76700000-0000-4000-8000-000000000001', 1,
    '76900000-0000-4000-8000-000000000001', repeat('c', 64)
  ) ->> 'status'),
  'applied',
  'approval succeeds when selected and batch scopes match'
);

select is(
  (public.approve_import_staging(
    '76100000-0000-4000-8000-000000000002',
    '76200000-0000-4000-8000-000000000002',
    '76700000-0000-4000-8000-000000000001', 1,
    '76900000-0000-4000-8000-000000000001', repeat('c', 64)
  ) ->> 'replayed'),
  'true',
  'matching approval replay returns the durable receipt'
);

select is(
  (select version from public.import_batches
   where id = '76700000-0000-4000-8000-000000000001'),
  2::bigint,
  'approval replay does not advance the batch twice'
);

select is(
  (select count(*)::integer from public.import_operations
   where import_batch_id = '76700000-0000-4000-8000-000000000001'),
  1,
  'approval replay creates one operation only'
);

reset role;
select set_config('request.jwt.claims', '{}'::text, true);

select ok(
  (select request_hash <> repeat('c', 64)
   from public.import_operations
   where import_batch_id = '76700000-0000-4000-8000-000000000001')
  and (select request_hash ~ '^[a-f0-9]{64}$'
       from public.import_operations
       where import_batch_id = '76700000-0000-4000-8000-000000000001'),
  'durable operation hash binds the caller hash to organization, branch, batch, and version'
);

select throws_ok(
  $$select public.approve_import_staging(
      '76100000-0000-4000-8000-000000000002',
      '76200000-0000-4000-8000-000000000002',
      '76700000-0000-4000-8000-000000000001', 1,
      '76900000-0000-4000-8000-000000000001', repeat('d', 64)
    )$$,
  '42501', null,
  'approval requires an authenticated active actor after role reset'
);

select * from finish();
rollback;
