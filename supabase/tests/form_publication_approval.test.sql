begin;

select plan(55);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'form_versions'
      and column_name = 'content_hash'
  )
  and exists (
    select 1 from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.form_versions'::regclass
      and constraint_definition.conname = 'form_versions_content_hash_check'
  ),
  'form versions retain a constrained canonical publication hash'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.request_form_publication(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.request_form_publication(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.request_form_publication(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.request_form_publication(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  'publication requests use an authenticated-only SECURITY INVOKER RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.approve_form_publication(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.approve_form_publication(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.approve_form_publication(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.approve_form_publication(uuid,uuid,uuid,uuid)'::regprocedure
  ),
  'publication approvals use an authenticated-only SECURITY INVOKER RPC'
);

select ok(
  (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'private.request_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  )
  and (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.request_form_publication_atomic(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'private transaction definers remain authenticated caller-validating surfaces'
);

select ok(
  not has_table_privilege('authenticated', 'public.form_publication_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.form_publication_requests', 'update')
  and not has_table_privilege('authenticated', 'public.form_publication_requests', 'delete')
  and not has_table_privilege('service_role', 'public.form_publication_requests', 'insert')
  and not has_table_privilege('service_role', 'public.form_publication_requests', 'update')
  and not has_table_privilege('service_role', 'public.form_publication_requests', 'delete'),
  'no application database role can directly author or approve publication evidence'
);

select ok(
  not has_table_privilege('authenticated', 'public.form_definitions', 'insert')
  and not has_table_privilege('authenticated', 'public.form_definitions', 'update')
  and not has_table_privilege('authenticated', 'public.form_definitions', 'delete')
  and not has_table_privilege('authenticated', 'public.form_versions', 'insert')
  and not has_table_privilege('authenticated', 'public.form_versions', 'update')
  and not has_table_privilege('authenticated', 'public.form_versions', 'delete'),
  'authenticated sessions cannot spoof or rewrite definitions and versions'
);

select ok(
  not has_table_privilege('service_role', 'public.form_definitions', 'insert')
  and not has_table_privilege('service_role', 'public.form_definitions', 'update')
  and not has_table_privilege('service_role', 'public.form_definitions', 'delete')
  and not has_table_privilege('service_role', 'public.form_versions', 'insert')
  and not has_table_privilege('service_role', 'public.form_versions', 'update')
  and not has_table_privilege('service_role', 'public.form_versions', 'delete'),
  'service-role credentials cannot bypass governed form publication with DML'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class
   where oid = 'public.form_publication_requests'::regclass),
  'the immutable publication ledger has forced row-level security'
);

select ok(
  position(
    'request.organization_id = p_expected_organization_id' in
    pg_get_functiondef(
      'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'request.branch_id = p_expected_branch_id' in
    pg_get_functiondef(
      'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0,
  'approval locks a publication request only inside selected organization and branch'
);

select ok(
  position(
    '''name'', v_definition.name' in
    pg_get_functiondef(
      'private.request_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0
  and position(
    '''is_official'', v_definition.is_official' in
    pg_get_functiondef(
      'private.request_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0
  and position(
    '''schema_json'', v_version.schema_json' in
    pg_get_functiondef(
      'private.request_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0
  and position(
    '''scoring_json'', v_version.scoring_json' in
    pg_get_functiondef(
      'private.request_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0,
  'canonical content binds definition identity, official flag, schema, and scoring rules'
);

select ok(
  position(
    'form-publish-definition:' in
    pg_get_functiondef(
      'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    )
  ) > 0
  and position('from public.form_versions version' in substring(
    pg_get_functiondef(
      'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
    ) from position(
      'form-publish-definition:' in
      pg_get_functiondef(
        'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
      )
    )
  )) > 0,
  'all publication decisions for one definition serialize before target locks'
);

select ok(
  position('other.status' in pg_get_functiondef(
    'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  )) < position('retired' in pg_get_functiondef(
    'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  ))
  and position('retired' in pg_get_functiondef(
    'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  )) < position('published form effective periods cannot overlap' in pg_get_functiondef(
    'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  )),
  'overlap validation includes both currently published and retired historical periods'
);

-- Test-only inspection grant. The assertions above and the dedicated
-- form_governance_snapshot suite verify that the deployed migration revokes
-- this grant. This transaction-local grant lets the workflow test inspect the
-- immutable ledger without adding a production evidence-read API.
grant select on table public.form_publication_requests to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'form-requester@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'form-approver@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'form-bad-evidence@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('c2000000-0000-4000-8000-000000000001', 'form_publish_a', '表單發布測試機構 A'),
  ('c2000000-0000-4000-8000-000000000002', 'form_publish_b', '表單發布測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'a_main', '表單發布 A 主分支'),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'a_second', '表單發布 A 第二分支'),
  ('c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 'b_main', '表單發布 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('c1000000-0000-4000-8000-000000000001', '表單發布申請人', 'staff'),
  ('c1000000-0000-4000-8000-000000000002', '表單發布核准人', 'staff'),
  ('c1000000-0000-4000-8000-000000000003', '表單發布錯誤證據人', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', null, 'c1000000-0000-4000-8000-000000000001', 'active'),
  ('c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', null, 'c1000000-0000-4000-8000-000000000001', 'active'),
  ('c4000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', null, 'c1000000-0000-4000-8000-000000000002', 'active'),
  ('c4000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000002', null, 'c1000000-0000-4000-8000-000000000002', 'active'),
  ('c4000000-0000-4000-8000-000000000005', 'c2000000-0000-4000-8000-000000000001', null, 'c1000000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('c4000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('c4000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('c4000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('c4000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002'),
  ('c4000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', repeat('4', 64), 'c5200000-0000-4000-8000-000000000001', transaction_timestamp() - interval '2 minutes', 'form-requester-before', transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '4 minutes', transaction_timestamp() - interval '30 seconds', transaction_timestamp() - interval '30 seconds', 'form-requester-after', 'totp', transaction_timestamp() - interval '30 seconds'),
  ('c5000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', repeat('5', 64), 'c5200000-0000-4000-8000-000000000002', transaction_timestamp() - interval '2 minutes', 'form-approver-before', transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '4 minutes', transaction_timestamp() - interval '30 seconds', transaction_timestamp() - interval '30 seconds', 'form-approver-after', 'webauthn', transaction_timestamp() - interval '30 seconds'),
  ('c5000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000003', repeat('6', 64), 'c5200000-0000-4000-8000-000000000003', transaction_timestamp() - interval '2 minutes', 'form-mismatch-before', transaction_timestamp() - interval '1 minute', transaction_timestamp() + interval '4 minutes', transaction_timestamp() - interval '30 seconds', transaction_timestamp() - interval '30 seconds', 'form-mismatch-after', 'phone', transaction_timestamp() - interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('c1000000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'aal2', 'totp', transaction_timestamp() - interval '30 seconds'),
  ('c1000000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000002', 'aal2', 'webauthn', transaction_timestamp() - interval '30 seconds'),
  ('c1000000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000003', 'c5000000-0000-4000-8000-000000000003', 'aal2', 'phone', transaction_timestamp() - interval '20 seconds');

insert into public.form_definitions (
  id, organization_id, form_key, name, category, is_official
) values
  ('c6000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'tenant.assessment_a', '機構 A 評估表', 'assessment', false),
  ('c6000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'tenant.assessment_b', '機構 B 評估表', 'assessment', false),
  ('c6000000-0000-4000-8000-000000000003', null, 'official.assessment', '官方評估表', 'assessment', true),
  ('c6000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001', 'tenant.mutable', '待驗證內容表單', 'assessment', false);

insert into public.form_versions (
  id, form_definition_id, version, status, effective_from, effective_to,
  schema_json, scoring_json, published_at, published_by
) values
  ('c7000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 1, 'draft', '2026-01-01', '2026-01-31', '{"fields":[{"key":"q1","type":"integer"}]}'::jsonb, '{"sum":["q1"]}'::jsonb, null, null),
  ('c7000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000001', 2, 'draft', '2026-02-01', '2026-02-28', '{"fields":[{"key":"q1","type":"integer"}]}'::jsonb, '{"sum":["q1"]}'::jsonb, null, null),
  ('c7000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000001', 3, 'draft', '2026-01-15', '2026-02-15', '{"fields":[{"key":"q2","type":"boolean"}]}'::jsonb, '{}'::jsonb, null, null),
  ('c7000000-0000-4000-8000-000000000004', 'c6000000-0000-4000-8000-000000000001', 4, 'retired', '2026-04-01', '2026-04-30', '{"fields":[{"key":"legacy","type":"text"}]}'::jsonb, '{}'::jsonb, clock_timestamp() - interval '1 year', 'c1000000-0000-4000-8000-000000000002'),
  ('c7000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000001', 5, 'draft', '2026-04-15', '2026-05-15', '{"fields":[{"key":"q5","type":"text"}]}'::jsonb, '{}'::jsonb, null, null),
  ('c7000000-0000-4000-8000-000000000006', 'c6000000-0000-4000-8000-000000000004', 1, 'draft', '2026-06-01', '2026-06-30', '{"fields":[{"key":"m1","type":"integer"}]}'::jsonb, '{"sum":["m1"]}'::jsonb, null, null),
  ('c7000000-0000-4000-8000-000000000007', 'c6000000-0000-4000-8000-000000000002', 1, 'draft', '2026-01-01', '2026-12-31', '{"fields":[]}'::jsonb, '{}'::jsonb, null, null),
  ('c7000000-0000-4000-8000-000000000008', 'c6000000-0000-4000-8000-000000000003', 1, 'draft', '2026-01-01', '2026-12-31', '{"fields":[]}'::jsonb, '{}'::jsonb, null, null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'an AAL1 claim cannot submit a form publication request'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$update public.form_versions
    set status = 'published', published_at = clock_timestamp(),
        published_by = 'c1000000-0000-4000-8000-000000000001'
    where id = 'c7000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an authenticated manager cannot directly publish a form version'
);

select throws_ok(
  $$update public.form_definitions
    set name = '直接竄改名稱'
    where id = 'c6000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an authenticated manager cannot directly rewrite a form definition'
);

select throws_ok(
  $$insert into public.form_publication_requests (
      organization_id, branch_id, form_definition_id, form_version_id,
      form_content_hash, requested_by, requested_reauth_challenge_id,
      request_idempotency_key, request_hash
    ) values (
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001', repeat('a', 64),
      'c1000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000099', repeat('b', 64)
    )$$,
  '42501', null,
  'an authenticated manager cannot forge a publication ledger row'
);

select throws_ok(
  $$select * from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000007',
      'c8000000-0000-4000-8000-000000000002'
    )$$,
  '42501', 'official or cross-tenant forms cannot be published by a tenant',
  'a multi-tenant manager cannot submit another tenant form through context A'
);

select throws_ok(
  $$select * from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000008',
      'c8000000-0000-4000-8000-000000000003'
    )$$,
  '42501', 'official or cross-tenant forms cannot be published by a tenant',
  'tenant governance cannot publish an official global form'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000003"}',
  true
);

select throws_ok(
  $$select * from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000004'
    )$$,
  '42501', 'immutable AAL2 evidence is required for form publication',
  'a recent event not exactly matching its challenge cannot author a request'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('pending'::text, false)$$,
  'a qualified requester stages one tenant form publication'
);

select ok(
  (select organization_id = 'c2000000-0000-4000-8000-000000000001'
      and branch_id = 'c3000000-0000-4000-8000-000000000001'
      and form_definition_id = 'c6000000-0000-4000-8000-000000000001'
      and form_version_id = 'c7000000-0000-4000-8000-000000000001'
      and form_content_hash ~ '^[a-f0-9]{64}$'
      and request_hash ~ '^[a-f0-9]{64}$'
      and requested_by = 'c1000000-0000-4000-8000-000000000001'
      and requested_reauth_challenge_id = 'c5000000-0000-4000-8000-000000000001'
   from public.form_publication_requests
   where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
  'request scope, exact target, hashes, actor, and immutable challenge are server derived'
);

select is(
  (select form_content_hash
   from public.form_publication_requests
   where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
  (
    select encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1,
      'organization_id', definition.organization_id,
      'form_definition_id', definition.id,
      'form_key', definition.form_key,
      'name', definition.name,
      'category', definition.category,
      'is_official', definition.is_official,
      'form_version_id', version.id,
      'version', version.version,
      'effective_from', version.effective_from,
      'effective_to', version.effective_to,
      'schema_json', version.schema_json,
      'scoring_json', version.scoring_json
    )::text, 'UTF8')), 'hex')
    from public.form_versions version
    join public.form_definitions definition
      on definition.id = version.form_definition_id
    where version.id = 'c7000000-0000-4000-8000-000000000001'
  ),
  'the durable content hash exactly binds the canonical definition and version payload'
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('pending'::text, true)$$,
  'an exact pending publication request safely replays'
);

select is(
  (select count(*)::integer
   from public.form_publication_requests
   where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
  1,
  'an exact request retry creates no duplicate ledger row'
);

select throws_ok(
  $$select * from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000002',
      'c8000000-0000-4000-8000-000000000010'
    )$$,
  '23505', 'form publication request idempotency conflict',
  'a request key cannot be reused for another form version'
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
      'c8100000-0000-4000-8000-000000000010'
    )$$,
  '42501', 'form publication requires an independent second approver',
  'the requester cannot approve their own publication request'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000003"}',
  true
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
      'c8100000-0000-4000-8000-000000000011'
    )$$,
  '42501', 'independent immutable AAL2 evidence is required for form approval',
  'an approver with mismatched immutable evidence cannot publish'
);

select ok(
  (select status = 'draft' and published_at is null and content_hash is null
   from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000001')
  and (select status = 'pending'
       from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
  'a rejected approval leaves both version and request unchanged'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000002',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
      'c8100000-0000-4000-8000-000000000012'
    )$$,
  '42501', 'form publication request is outside the selected tenant context',
  'an approver cannot change the selected branch of the request'
);

select results_eq(
  $$select status, replayed
    from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
      'c8100000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, false)$$,
  'an independent qualified approver publishes the unchanged tenant version'
);

select ok(
  (select status = 'published'
      and published_by = 'c1000000-0000-4000-8000-000000000002'
      and published_at between clock_timestamp() - interval '1 minute' and clock_timestamp() + interval '1 minute'
      and content_hash = (
        select form_content_hash from public.form_publication_requests
        where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'
      )
   from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000001'),
  'published state, approver, server time, and exact requested content hash are persisted'
);

select ok(
  (select status = 'approved'
      and approved_by = 'c1000000-0000-4000-8000-000000000002'
      and approved_by <> requested_by
      and approved_reauth_challenge_id = 'c5000000-0000-4000-8000-000000000002'
      and approved_reauth_challenge_id <> requested_reauth_challenge_id
      and approval_hash ~ '^[a-f0-9]{64}$'
      and approved_at = (
        select published_at from public.form_versions
        where id = 'c7000000-0000-4000-8000-000000000001'
      )
   from public.form_publication_requests
   where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
  'publication ledger retains independent actor, exact challenge, hash, and shared commit time'
);

select results_eq(
  $$select status, replayed
    from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
      'c8100000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, true)$$,
  'an exact approval retry returns the durable publication receipt'
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'),
      'c8100000-0000-4000-8000-000000000099'
    )$$,
  '23505', 'form publication request was already decided',
  'a changed approval key cannot replay an approved publication'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, true)$$,
  'the original request exactly replays after publication changed version state'
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000002',
      'c8000000-0000-4000-8000-000000000020'
    )$$,
  $$values ('pending'::text, false)$$,
  'an adjacent non-overlapping version can be submitted'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000020'),
      'c8100000-0000-4000-8000-000000000010'
    )$$,
  '23505', null,
  'an approver cannot reuse an approval key for a different publication'
);

select ok(
  (select status = 'draft' and published_at is null and published_by is null and content_hash is null
   from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000002')
  and (select status = 'pending'
       from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000020'),
  'approval-key collision atomically rolls back version publication and ledger transition'
);

select results_eq(
  $$select status, replayed
    from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000020'),
      'c8100000-0000-4000-8000-000000000020'
    )$$,
  $$values ('approved'::text, false)$$,
  'the rolled-back adjacent version remains independently publishable'
);

select is(
  (select status from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000002'),
  'published'::public.form_status,
  'touching inclusive date periods publish without a false overlap'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000003',
      'c8000000-0000-4000-8000-000000000030'
    )$$,
  $$values ('pending'::text, false)$$,
  'an overlapping draft may be reviewed but is not published early'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000030'),
      'c8100000-0000-4000-8000-000000000030'
    )$$,
  '23P01', 'published form effective periods cannot overlap',
  'approval rejects a period overlapping a published version'
);

select ok(
  (select status = 'draft' and content_hash is null
   from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000003')
  and (select status = 'pending'
       from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000030'),
  'published-period rejection leaves both draft and request unchanged'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000005',
      'c8000000-0000-4000-8000-000000000050'
    )$$,
  $$values ('pending'::text, false)$$,
  'a candidate overlapping retired history can be staged for review'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000050'),
      'c8100000-0000-4000-8000-000000000050'
    )$$,
  '23P01', 'published form effective periods cannot overlap',
  'approval also rejects periods overlapping retired historical rules'
);

select ok(
  (select status = 'draft' and content_hash is null
   from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000005')
  and (select status = 'pending'
       from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000050'),
  'retired-period overlap rejection is atomic'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select status, replayed
    from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000006',
      'c8000000-0000-4000-8000-000000000060'
    )$$,
  $$values ('pending'::text, false)$$,
  'a mutable draft is staged with its original canonical content'
);

reset role;
select set_config('request.jwt.claims', '{}'::text, true);

update public.form_definitions
set name = '送審後已變更名稱'
where id = 'c6000000-0000-4000-8000-000000000004';

update public.form_versions
set schema_json = '{"fields":[{"key":"m1","type":"text"}]}'::jsonb,
    scoring_json = '{"changed":true}'::jsonb
where id = 'c7000000-0000-4000-8000-000000000006';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.request_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'c7000000-0000-4000-8000-000000000006',
      'c8000000-0000-4000-8000-000000000060'
    )$$,
  '23505', 'form publication request idempotency conflict',
  'an exact key cannot replay after definition or rule content changes'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c5100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_form_publication(
      'c2000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      (select id from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000060'),
      'c8100000-0000-4000-8000-000000000060'
    )$$,
  '40001', 'form draft changed after publication was requested',
  'approval refuses changed name, schema, or scoring content'
);

select ok(
  (select status = 'draft' and published_at is null and published_by is null and content_hash is null
   from public.form_versions
   where id = 'c7000000-0000-4000-8000-000000000006')
  and (select status = 'pending'
       from public.form_publication_requests
       where request_idempotency_key = 'c8000000-0000-4000-8000-000000000060'),
  'content-hash mismatch rolls back publication and preserves pending evidence'
);

reset role;
select set_config('request.jwt.claims', '{}'::text, true);

select throws_ok(
  $$update public.form_versions
    set scoring_json = '{"tampered":true}'::jsonb
    where id = 'c7000000-0000-4000-8000-000000000001'$$,
  '55000', 'published form versions are immutable; create a new version',
  'published form content cannot be rewritten even by an owner-level write'
);

select throws_ok(
  $$delete from public.form_versions
    where id = 'c7000000-0000-4000-8000-000000000001'$$,
  '55000', 'published form versions are immutable; create a new version',
  'published form versions cannot be deleted'
);

select throws_ok(
  $$update public.form_publication_requests
    set form_content_hash = repeat('0', 64)
    where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'$$,
  '55000', 'form publication request identity and evidence are immutable',
  'publication request identity and content evidence cannot be changed'
);

select throws_ok(
  $$delete from public.form_publication_requests
    where request_idempotency_key = 'c8000000-0000-4000-8000-000000000010'$$,
  '55000', 'form publication requests are immutable',
  'publication approval evidence cannot be deleted'
);

select is(
  (select count(*)::integer
   from public.form_publication_requests
   where request_idempotency_key in (
     'c8000000-0000-4000-8000-000000000010',
     'c8000000-0000-4000-8000-000000000020',
     'c8000000-0000-4000-8000-000000000030',
     'c8000000-0000-4000-8000-000000000050',
     'c8000000-0000-4000-8000-000000000060'
   )),
  5,
  'five accepted logical requests produce exactly five immutable ledger rows'
);

select * from finish();
rollback;
