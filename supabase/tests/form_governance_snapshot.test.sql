begin;

select plan(23);

select ok(
  has_function_privilege(
    'authenticated',
    'public.form_governance_snapshot(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.form_governance_snapshot(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.form_governance_snapshot(uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.form_governance_snapshot(uuid,uuid)'::regprocedure
  ),
  'public form governance snapshot is authenticated-only and SECURITY INVOKER'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
      and procedure.provolatile = 'v'
    from pg_proc procedure
    where procedure.oid =
      'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  ),
  'private snapshot is a fixed-search-path volatile SECURITY DEFINER for audited reads'
);

select ok(
  position('private.has_custom_governance_permission' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) > 0
  and position('branch.is_active' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) > 0
  and position('public.audit_events' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) > 0,
  'snapshot checks tenant permissions, active branch, and records an audit event'
);

select ok(
  position('requested_reauth_challenge_id' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0
  and position('approved_reauth_challenge_id' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0
  and position('request_idempotency_key' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0
  and position('approval_idempotency_key' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0
  and position('request_hash' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0
  and position('approval_hash' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0
  and position('private.reauth_' in pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  )) = 0,
  'snapshot never selects immutable AAL2, request/approval hash, or idempotency evidence'
);

select ok(
  pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  ) ~* 'limit 1000[[:space:][:print:]]+limit 5000[[:space:][:print:]]+limit 1000'
  and pg_get_functiondef(
    'private.form_governance_snapshot_response(uuid,uuid)'::regprocedure
  ) ~* 'case[[:space:]]+when request.status = ''pending'' then 0 else 1 end[[:space:][:print:]]+request.requested_at desc',
  'definitions, versions, and publications have hard caps and publication requests are pending-first'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.form_publication_requests', 'select'
  )
  and not has_table_privilege(
    'service_role', 'public.form_publication_requests', 'select'
  ),
  'application database roles cannot directly select the publication ledger'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd2100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'form-snapshot-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'form-snapshot-no-permission@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('d2200000-0000-4000-8000-000000000001', 'form_snapshot_a', '表單快照測試機構 A'),
  ('d2200000-0000-4000-8000-000000000002', 'form_snapshot_b', '表單快照測試機構 B');

insert into public.branches (id, organization_id, code, name, is_active) values
  ('d2300000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000001', 'main', 'A 主分支', true),
  ('d2300000-0000-4000-8000-000000000002', 'd2200000-0000-4000-8000-000000000001', 'inactive', 'A 停用分支', false),
  ('d2300000-0000-4000-8000-000000000003', 'd2200000-0000-4000-8000-000000000002', 'main', 'B 主分支', true);

insert into public.profiles (id, display_name, kind) values
  ('d2100000-0000-4000-8000-000000000001', '表單快照管理員', 'staff'),
  ('d2100000-0000-4000-8000-000000000002', '表單快照無權限人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('d2400000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000001', null, 'd2100000-0000-4000-8000-000000000001', 'active'),
  ('d2400000-0000-4000-8000-000000000002', 'd2200000-0000-4000-8000-000000000001', 'd2300000-0000-4000-8000-000000000001', 'd2100000-0000-4000-8000-000000000002', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('d2400000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  'd2500000-0000-4000-8000-000000000001',
  'd2100000-0000-4000-8000-000000000001',
  'd2510000-0000-4000-8000-000000000001',
  repeat('7', 64),
  'd2520000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '2 minutes',
  'form-snapshot-before',
  transaction_timestamp() - interval '1 minute',
  transaction_timestamp() + interval '4 minutes',
  transaction_timestamp() - interval '30 seconds',
  transaction_timestamp() - interval '30 seconds',
  'form-snapshot-after',
  'totp',
  transaction_timestamp() - interval '30 seconds'
);

insert into public.form_definitions (
  id, organization_id, form_key, name, category, is_official
) values
  ('d2600000-0000-4000-8000-000000000001', 'd2200000-0000-4000-8000-000000000001', 'tenant.page82', '第八十二頁測試表單', 'assessment', false),
  ('d2600000-0000-4000-8000-000000000002', 'd2200000-0000-4000-8000-000000000002', 'tenant.other', '其他機構機密表單', 'assessment', false),
  ('d2600000-0000-4000-8000-000000000003', null, 'official.page82', '官方測試表單', 'assessment', true);

insert into public.form_versions (
  id, form_definition_id, version, status, effective_from, effective_to,
  schema_json, scoring_json, published_at, published_by, content_hash
) values
  ('d2700000-0000-4000-8000-000000000001', 'd2600000-0000-4000-8000-000000000001', 1, 'draft', '2026-09-01', null, '{"fields":[{"key":"one"},{"key":"two"}]}'::jsonb, '{"sum":["one"]}'::jsonb, null, null, null),
  ('d2700000-0000-4000-8000-000000000002', 'd2600000-0000-4000-8000-000000000002', 1, 'draft', '2026-09-01', null, '{"fields":[]}'::jsonb, '{}'::jsonb, null, null, null),
  ('d2700000-0000-4000-8000-000000000003', 'd2600000-0000-4000-8000-000000000003', 1, 'published', '2026-01-01', null, '{"fields":[{"key":"official"}]}'::jsonb, '{}'::jsonb, transaction_timestamp() - interval '1 day', 'd2100000-0000-4000-8000-000000000001', repeat('f', 64));

insert into public.form_publication_requests (
  id, organization_id, branch_id, form_definition_id, form_version_id,
  form_content_hash, status, requested_by, requested_at,
  requested_reauth_challenge_id, request_idempotency_key, request_hash
) values (
  'd2800000-0000-4000-8000-000000000001',
  'd2200000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000001',
  'd2600000-0000-4000-8000-000000000001',
  'd2700000-0000-4000-8000-000000000001',
  encode(sha256(convert_to(private.custom_publication_content('d2700000-0000-4000-8000-000000000001')::text,'UTF8')),'hex'),
  'pending',
  'd2100000-0000-4000-8000-000000000001',
  transaction_timestamp() - interval '10 seconds',
  'd2500000-0000-4000-8000-000000000001',
  'd2810000-0000-4000-8000-000000000001',
  repeat('b', 64)
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d2100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"d2510000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select organization_id, branch_id,
      jsonb_array_length(definitions),
      jsonb_array_length(versions),
      jsonb_array_length(publications)
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    )$$,
  $$values (
    'd2200000-0000-4000-8000-000000000001'::uuid,
    'd2300000-0000-4000-8000-000000000001'::uuid,
    2::integer,
    2::integer,
    1::integer
  )$$,
  'authorized manager receives the selected tenant plus official definitions and no cross-tenant rows'
);

select results_eq(
  $$select definition_total, version_total, publication_total, pending_total,
      definitions_truncated, versions_truncated, publications_truncated
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    )$$,
  $$values (
    2::bigint, 2::bigint, 1::bigint, 1::bigint,
    false, false, false
  )$$,
  'snapshot reports exact totals, pending count, and fail-visible truncation state'
);

select results_eq(
  $$select definition ->> 'form_key'
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    ) snapshot,
    lateral jsonb_array_elements(snapshot.definitions) definition
    order by definition ->> 'form_key'$$,
  $$values ('official.page82'::text), ('tenant.page82'::text)$$,
  'definition projection excludes another tenant even when its form key is known'
);

select results_eq(
  $$select key
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    ) snapshot,
    lateral jsonb_array_elements(snapshot.versions) version,
    lateral jsonb_object_keys(version) key
    where version ->> 'id' = 'd2700000-0000-4000-8000-000000000001'
    order by key$$,
  $$values
    ('content_hash'::text),
    ('effective_from'::text),
    ('effective_to'::text),
    ('form_definition_id'::text),
    ('id'::text),
    ('published_at'::text),
    ('schema_field_count'::text),
    ('scoring_rule_count'::text),
    ('status'::text),
    ('version'::text)$$,
  'version projection exposes only rendered summary fields, never raw schema or scoring JSON'
);

select results_eq(
  $$select (version ->> 'schema_field_count')::integer,
      (version ->> 'scoring_rule_count')::integer
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    ) snapshot,
    lateral jsonb_array_elements(snapshot.versions) version
    where version ->> 'id' = 'd2700000-0000-4000-8000-000000000001'$$,
  $$values (2::integer, 1::integer)$$,
  'field and scoring counts are calculated inside the trusted projection'
);

select results_eq(
  $$select key
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    ) snapshot,
    lateral jsonb_array_elements(snapshot.publications) publication,
    lateral jsonb_object_keys(publication) key
    order by key$$,
  $$values
    ('approved_at'::text),
    ('approved_by_current_user'::text),
    ('form_definition_id'::text),
    ('form_version_id'::text),
    ('id'::text),
    ('requested_at'::text),
    ('requested_by_current_user'::text),
    ('status'::text)$$,
  'publication projection has an exact UI-only shape without immutable request evidence'
);

select results_eq(
  $$select (publication ->> 'requested_by_current_user')::boolean,
      (publication ->> 'approved_by_current_user')::boolean,
      publication ->> 'status'
    from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    ) snapshot,
    lateral jsonb_array_elements(snapshot.publications) publication$$,
  $$values (true, false, 'pending'::text)$$,
  'snapshot derives only current-actor booleans instead of exposing actor identifiers'
);

reset role;

select is(
  (select count(*)::integer
   from public.audit_events event
   where event.actor_user_id = 'd2100000-0000-4000-8000-000000000001'
     and event.table_name = 'form_governance_snapshot'
     and event.metadata ->> 'projection' = 'page82_minimal'),
  7,
  'every successful form governance snapshot read writes one audit event'
);

select ok(
  not exists (
    select 1
    from public.audit_events event
    where event.actor_user_id = 'd2100000-0000-4000-8000-000000000001'
      and event.table_name = 'form_governance_snapshot'
      and (
        event.row_pk is not null
        or event.idempotency_key is not null
        or event.metadata::text ~ '(d2800000|tenant.page82|第八十二頁|其他機構機密)'
      )
  ),
  'snapshot audit stores aggregate counts only and no form, request, or idempotency identifiers'
);

select results_eq(
  $$select
      (metadata ->> 'definition_count')::integer,
      (metadata ->> 'version_count')::integer,
      (metadata ->> 'publication_count')::integer
    from public.audit_events
    where actor_user_id = 'd2100000-0000-4000-8000-000000000001'
      and table_name = 'form_governance_snapshot'
      and metadata ->> 'projection' = 'page82_minimal'
    order by id
    limit 1$$,
  $$values (2::integer, 2::integer, 1::integer)$$,
  'audit metadata records only aggregate projection counts'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d2100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"d2510000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.form_publication_requests$$,
  '42501', null,
  'authenticated managers cannot bypass the audited snapshot with direct ledger SELECT'
);

select throws_ok(
  $$select * from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000002'
    )$$,
  '42501', null,
  'inactive branches cannot be used as a form governance context'
);

select throws_ok(
  $$select * from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000002',
      'd2300000-0000-4000-8000-000000000003'
    )$$,
  '42501', null,
  'a manager cannot select another organization context'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d2100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'an active staff member without forms.manage cannot read the snapshot'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{}', true);

select throws_ok(
  $$select * from public.form_governance_snapshot(
      'd2200000-0000-4000-8000-000000000001',
      'd2300000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'anonymous callers cannot execute the form governance snapshot'
);

reset role;
set local role service_role;

select throws_ok(
  $$select * from public.form_publication_requests$$,
  '42501', null,
  'service-role credentials cannot directly read publication evidence'
);

reset role;

select is(
  (select count(*)::integer
   from public.audit_events event
   where event.actor_user_id in (
     'd2100000-0000-4000-8000-000000000001',
     'd2100000-0000-4000-8000-000000000002'
   )
     and event.table_name = 'form_governance_snapshot'
     and event.metadata ->> 'projection' = 'page82_minimal'),
  7,
  'denied cross-scope and permission attempts create no misleading successful-read audit event'
);

select * from finish();
rollback;
