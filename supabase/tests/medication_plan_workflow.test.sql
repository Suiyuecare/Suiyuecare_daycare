begin;

select plan(68);

select ok(
  to_regclass('private.medication_plan_operations') is not null
  and to_regclass('private.medication_plan_terminations') is not null
  and (
    select bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'medication_plan_operations',
        'medication_plan_terminations'
      )
  ),
  'page-8 operation and lifecycle ledgers are private and force RLS'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_medication_plan_draft(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.create_medication_plan_draft(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.create_medication_plan_draft(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.create_medication_plan_draft(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)'::regprocedure
  ),
  'draft creation is an authenticated-only SECURITY INVOKER API wrapper'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.submit_medication_plan(uuid,uuid,uuid,bigint,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.approve_medication_plan(uuid,uuid,uuid,bigint,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.stop_medication_plan(uuid,uuid,uuid,bigint,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.medication_plan_snapshot(uuid,uuid,uuid)',
    'execute'
  )
  and not (
    select bool_or(procedure.prosecdef)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'submit_medication_plan',
        'approve_medication_plan',
        'stop_medication_plan',
        'medication_plan_snapshot'
      )
  ),
  'submit, approve, stop, and snapshot APIs are authenticated SECURITY INVOKER wrappers'
);

select ok(
  not has_function_privilege(
    'public',
    'private.require_medication_plan_reauth_evidence(uuid,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.require_medication_plan_reauth_evidence(uuid,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.require_medication_plan_reauth_evidence(uuid,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'public',
    'private.medication_schedule_is_valid(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'public',
    'private.medication_plan_authority(uuid,uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.create_medication_plan_draft_atomic(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.submit_medication_plan_atomic(uuid,uuid,uuid,bigint,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.approve_medication_plan_atomic(uuid,uuid,uuid,bigint,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.stop_medication_plan_atomic(uuid,uuid,uuid,bigint,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.medication_plan_snapshot(uuid,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.create_medication_plan_draft_response(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.submit_medication_plan_response(uuid,uuid,uuid,bigint,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.approve_medication_plan_response(uuid,uuid,uuid,bigint,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.stop_medication_plan_response(uuid,uuid,uuid,bigint,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.medication_plan_snapshot_response(uuid,uuid,uuid)',
    'execute'
  ),
  'only private minimal response shims are executable; broad cores and evidence helpers remain unreachable'
);

select ok(
  (
    select bool_and(
      procedure.prosecdef
      and array_to_string(procedure.proconfig, ',') like 'search_path=%'
    )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'create_medication_plan_draft_atomic',
        'submit_medication_plan_atomic',
        'approve_medication_plan_atomic',
        'stop_medication_plan_atomic',
        'medication_plan_snapshot'
      )
  ),
  'private transaction cores are SECURITY DEFINER functions with empty search paths'
);

select ok(
  not has_table_privilege('authenticated', 'public.medication_plans', 'select')
  and not has_table_privilege('authenticated', 'public.medication_plans', 'insert')
  and not has_table_privilege('authenticated', 'public.medication_plans', 'update')
  and not has_table_privilege('authenticated', 'public.medication_plans', 'delete')
  and not has_table_privilege('service_role', 'public.medication_plans', 'select')
  and not has_table_privilege('service_role', 'public.medication_plans', 'insert')
  and not has_table_privilege('service_role', 'public.medication_plans', 'update')
  and not has_table_privilege('service_role', 'public.medication_plans', 'delete')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'select')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'insert')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'update')
  and not has_table_privilege('authenticated', 'public.medication_administrations', 'delete')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'select')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'insert')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'update')
  and not has_table_privilege('service_role', 'public.medication_administrations', 'delete'),
  'authenticated and service roles cannot read evidence tables or bypass governed medication writes'
);

select is(
  pg_get_function_identity_arguments(
    'public.create_medication_plan_draft(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)'::regprocedure
  ),
  'p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid, p_previous_plan_id uuid, p_medication_name text, p_dose numeric, p_dose_unit text, p_route text, p_schedule jsonb, p_high_risk boolean, p_effective_from timestamp with time zone, p_effective_to timestamp with time zone, p_idempotency_key uuid',
  'draft input accepts no caller-provided record key, version, source, signer, challenge, or content hash'
);

select ok(
  position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'private.approve_medication_plan_atomic(uuid,uuid,uuid,bigint,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'medication-plan-natural-window:' in pg_get_functiondef(
      'private.approve_medication_plan_atomic(uuid,uuid,uuid,bigint,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'an approved medication plan already covers' in pg_get_functiondef(
      'private.approve_medication_plan_atomic(uuid,uuid,uuid,bigint,uuid)'::regprocedure
    )
  ) > position(
    'medication-plan-natural-window:' in pg_get_functiondef(
      'private.approve_medication_plan_atomic(uuid,uuid,uuid,bigint,uuid)'::regprocedure
    )
  ),
  'approval serializes the natural medication/schedule window before its overlap decision'
);

select ok(
  position(
    'termination.effective_at <= clock_timestamp()' in pg_get_functiondef(
      'private.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
    )
  ) > 0,
  'snapshot applies a future stop or replacement only when its server cutover is reached'
);

select ok(
  exists (
    select 1
    from pg_indexes index_definition
    where index_definition.schemaname = 'public'
      and index_definition.indexname = 'medication_plans_v2_one_submitted_stream_idx'
      and index_definition.indexdef like 'CREATE UNIQUE INDEX%'
  )
  and exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'private.medication_plan_terminations'::regclass
      and constraint_definition.conname = 'medication_plan_terminations_one_per_plan_key'
      and constraint_definition.contype = 'u'
  ),
  'database constraints allow only one submitted stream version and one terminal event per approved plan'
);

select is(
  (
    select count(*)::integer
    from pg_constraint constraint_definition
    cross join lateral unnest(constraint_definition.conkey) foreign_key_column
    where constraint_definition.contype = 'f'
      and constraint_definition.conrelid in (
        'private.medication_plan_operations'::regclass,
        'private.medication_plan_terminations'::regclass
      )
      and not exists (
        select 1
        from pg_index index_definition
        where index_definition.indrelid = constraint_definition.conrelid
          and foreign_key_column = any(index_definition.indkey)
      )
  ),
  0,
  'every page-8 lifecycle and operation foreign-key column participates in an index'
);

select ok(
  (
    select array_agg(attribute.attname order by attribute.attnum)
    from pg_attribute attribute
    where attribute.attrelid =
      'public.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
      and false
  ) is null
  and pg_get_function_result(
    'public.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
  ) not like '%signed_by%'
  and pg_get_function_result(
    'public.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
  ) not like '%challenge%'
  and pg_get_function_result(
    'public.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
  ) not like '%content_hash%'
  and pg_get_function_result(
    'public.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
  ) not like '%source_system%'
  and pg_get_function_result(
    'public.medication_plan_snapshot(uuid,uuid,uuid)'::regprocedure
  ) like '%client_id uuid%',
  'page-8 snapshot omits signer, challenge, hash, and source evidence fields'
);

select ok(
  pg_get_function_result(
    'public.create_medication_plan_draft(uuid,uuid,uuid,uuid,text,numeric,text,text,jsonb,boolean,timestamptz,timestamptz,uuid)'::regprocedure
  ) like '%client_id uuid%'
  and pg_get_function_result(
    'public.submit_medication_plan(uuid,uuid,uuid,bigint,uuid)'::regprocedure
  ) like '%client_id uuid%'
  and pg_get_function_result(
    'public.approve_medication_plan(uuid,uuid,uuid,bigint,uuid)'::regprocedure
  ) like '%client_id uuid%'
  and pg_get_function_result(
    'public.stop_medication_plan(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure
  ) like '%client_id uuid%',
  'mutation receipts expose only the authoritative client link needed to reject mismatched browser success'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'plan-proposer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'plan-approver@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'plan-mismatch@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'plan-med-only@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('a2000000-0000-4000-8000-000000000001', 'plan_org_a', '用藥計畫測試機構 A'),
  ('a2000000-0000-4000-8000-000000000002', 'plan_org_b', '用藥計畫測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'other', 'A 其他分支'),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values (
  'a9000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'medication_without_identity',
  '只有用藥閱讀',
  'Regression fixture without clients.read.',
  false
);

insert into public.role_permissions (role_id, permission_id)
select 'a9000000-0000-4000-8000-000000000001', permission.id
from public.permissions permission
where permission.permission_key = 'medications.read';

insert into public.profiles (id, display_name, kind) values
  ('a1000000-0000-4000-8000-000000000001', '用藥計畫提案人', 'staff'),
  ('a1000000-0000-4000-8000-000000000002', '用藥計畫核准人', 'staff'),
  ('a1000000-0000-4000-8000-000000000003', '證據錯誤核准人', 'staff'),
  ('a1000000-0000-4000-8000-000000000004', '無個案身分閱讀人', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'active'),
  ('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'active'),
  ('a4000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'active'),
  ('a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'active'),
  ('a4000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'active'),
  ('a4000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('a4000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'),
  ('a4000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005'),
  ('a4000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005'),
  ('a4000000-0000-4000-8000-000000000004', 'a9000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005'),
  ('a4000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000005');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'PLAN-A-1', '用藥計畫個案 A1', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'PLAN-A-2', '未指派個案 A2', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test'),
  ('a5000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'PLAN-B-1', '用藥計畫個案 B1', 'active', (now() at time zone 'Asia/Taipei')::date - 30, null, 'test');

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'medication-plan'),
  ('a6000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'medication-plan'),
  ('a6000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'medication-plan'),
  ('a6000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'medication-plan'),
  ('a6000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'medication-plan'),
  ('a6000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'medication-plan');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('a7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', repeat('1', 64), 'a7200000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes', 'proposer-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '20 seconds', clock_timestamp() - interval '20 seconds', 'proposer-after', 'totp', clock_timestamp() - interval '20 seconds'),
  ('a7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', repeat('2', 64), 'a7200000-0000-4000-8000-000000000002', clock_timestamp() - interval '2 minutes', 'approver-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '20 seconds', clock_timestamp() - interval '20 seconds', 'approver-after', 'webauthn', clock_timestamp() - interval '20 seconds'),
  ('a7000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000003', repeat('3', 64), 'a7200000-0000-4000-8000-000000000003', clock_timestamp() - interval '30 minutes', 'stale-before', clock_timestamp() - interval '29 minutes', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '20 minutes', 'stale-after', 'totp', clock_timestamp() - interval '20 minutes'),
  ('a7000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000004', repeat('4', 64), 'a7200000-0000-4000-8000-000000000004', clock_timestamp() - interval '2 minutes', 'mismatch-before', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '20 seconds', clock_timestamp() - interval '20 seconds', 'mismatch-after', 'phone', clock_timestamp() - interval '20 seconds'),
  ('a7000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', repeat('5', 64), 'a7200000-0000-4000-8000-000000000005', clock_timestamp() - interval '7 minutes', 'older-before', clock_timestamp() - interval '6 minutes', clock_timestamp() + interval '4 minutes', clock_timestamp() - interval '5 minutes', clock_timestamp() - interval '5 minutes', 'older-after', 'totp', clock_timestamp() - interval '5 minutes');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('a1000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'aal2', 'totp', clock_timestamp() - interval '20 seconds'),
  ('a1000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002', 'aal2', 'webauthn', clock_timestamp() - interval '20 seconds'),
  ('a1000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000003', 'aal2', 'totp', clock_timestamp() - interval '20 minutes'),
  ('a1000000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000004', 'aal2', 'phone', clock_timestamp() - interval '10 seconds');

update private.reauth_events event
set verified_at = challenge.factor_verified_at
from private.reauth_challenges challenge
where challenge.id = event.challenge_id
  and challenge.id in (
    'a7000000-0000-4000-8000-000000000001',
    'a7000000-0000-4000-8000-000000000002',
    'a7000000-0000-4000-8000-000000000003',
    'a7000000-0000-4000-8000-000000000004',
    'a7000000-0000-4000-8000-000000000005'
  );

-- Deliberately break the exact immutable evidence match while keeping the
-- mutable event recent, proving that approval checks both rows.
update private.reauth_events
set verified_at = clock_timestamp() - interval '10 seconds'
where challenge_id = 'a7000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from private.create_medication_plan_draft_atomic(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, 'Metformin', 500, 'mg', 'oral',
      '{"times":["08:00"]}'::jsonb, false,
      clock_timestamp(), null,
      'a8000000-0000-4000-8000-000000000099'
    )$$,
  '42501', null,
  'an authenticated caller cannot invoke the private mutation core directly'
);

select throws_ok(
  $$select * from public.medication_plans$$,
  '42501', null,
  'authenticated callers cannot select medication evidence rows directly'
);

select throws_ok(
  $$insert into public.medication_plans (
      organization_id, branch_id, client_id, medication_name, dose, dose_unit,
      route, schedule, effective_from, created_by
    ) values (
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'Forged', 1, 'mg', 'oral', '{"times":["08:00"]}'::jsonb,
      clock_timestamp(), 'a1000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'authenticated callers cannot bypass the page-8 workflow with direct plan insertion'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, 'Metformin', 500, 'mg', 'oral',
      '{"times":["08:00","08:00"]}'::jsonb, false,
      clock_timestamp(), null,
      'a8000000-0000-4000-8000-000000000001'
    )$$,
  '22023', null,
  'duplicate schedule times are rejected before a draft is written'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, 'Metformin', 500, 'mg', 'oral',
      '{"times":["08:00"],"note":"caller-controlled metadata"}'::jsonb, false,
      clock_timestamp(), null,
      'a8000000-0000-4000-8000-000000000004'
    )$$,
  '22023', null,
  'schedule JSON rejects every caller-provided key except times'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, 'Metformin', 500, 'mg', 'oral',
      jsonb_build_object('times', jsonb_build_array(repeat('0', 600))), false,
      clock_timestamp(), null,
      'a8000000-0000-4000-8000-000000000005'
    )$$,
  '22023', null,
  'oversized schedule JSON is rejected by the direct database API'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000003',
      null, 'Metformin', 500, 'mg', 'oral',
      '{"times":["08:00"]}'::jsonb, false,
      clock_timestamp(), null,
      'a8000000-0000-4000-8000-000000000002'
    )$$,
  '42501', null,
  'a client from another organization cannot be targeted through selected organization A'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000002',
      null, 'Metformin', 500, 'mg', 'oral',
      '{"times":["08:00"]}'::jsonb, false,
      clock_timestamp(), null,
      'a8000000-0000-4000-8000-000000000003'
    )$$,
  '42501', null,
  'a manager without assignment or view-all authority cannot author a plan for an unassigned client'
);

select results_eq(
  $$select version, workflow_state, row_version, replayed
    from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, '  Metformin  ', 500, ' mg ', ' oral ',
      '{"times":["08:00","20:00"]}'::jsonb, false,
      '2030-01-01 08:00:00+08'::timestamptz, null,
      'a8000000-0000-4000-8000-000000000010'
    )$$,
  $$values (1, 'draft'::text, 1::bigint, false)$$,
  'an assigned medication manager creates the first normalized draft version'
);

select results_eq(
  $$select version, workflow_state, row_version, replayed
    from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, '  Metformin  ', 500, ' mg ', ' oral ',
      '{"times":["08:00","20:00"]}'::jsonb, false,
      '2030-01-01 08:00:00+08'::timestamptz, null,
      'a8000000-0000-4000-8000-000000000010'
    )$$,
  $$values (1, 'draft'::text, 1::bigint, true)$$,
  'an exact draft retry returns the durable actor-scoped receipt'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, 'Changed drug', 500, 'mg', 'oral',
      '{"times":["08:00","20:00"]}'::jsonb, false,
      '2030-01-01 08:00:00+08'::timestamptz, null,
      'a8000000-0000-4000-8000-000000000010'
    )$$,
  '23505', 'medication plan operation idempotency conflict',
  'reusing an actor key with changed draft content is rejected'
);

select results_eq(
  $$select medication_name, dose, dose_unit, medication_route,
           workflow_state, lifecycle_state, row_version
    from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )
    where medication_name = 'Metformin'$$,
  $$values (
    'Metformin'::text, 500::numeric, 'mg'::text, 'oral'::text,
    'draft'::text, 'draft'::text, 1::bigint
  )$$,
  'the minimal snapshot renders the server-normalized draft'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000099"}',
  true
);

select throws_ok(
  $$select * from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'medications.read without clients.read cannot reveal a medication plan snapshot'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.submit_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      99,
      'a8100000-0000-4000-8000-000000000010'
    )$$,
  '40001', 'medication plan row version changed before submission',
  'optimistic concurrency rejects a stale draft submission'
);

select results_eq(
  $$select workflow_state, row_version, replayed
    from public.submit_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      1,
      'a8100000-0000-4000-8000-000000000011'
    )$$,
  $$values ('submitted'::text, 2::bigint, false)$$,
  'the proposer freezes the latest draft for independent approval'
);

select results_eq(
  $$select workflow_state, row_version, replayed
    from public.submit_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      1,
      'a8100000-0000-4000-8000-000000000011'
    )$$,
  $$values ('submitted'::text, 2::bigint, true)$$,
  'an exact submission retry is safe after the mutable draft state changed'
);

select results_eq(
  $$select submitted_by_current_actor, workflow_state
    from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )
    where medication_name = 'Metformin'
      and workflow_state = 'submitted'$$,
  $$values (true, 'submitted'::text)$$,
  'snapshot tells the proposer that their submitted plan requires another approver without exposing identity'
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'medication plan approval requires an independent second person',
  'the proposer cannot approve their own submitted plan'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select submitted_by_current_actor
    from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )
    where medication_name = 'Metformin'
      and workflow_state = 'submitted'$$,
  $$values (false)$$,
  'snapshot permits a different actor to see the independent-approver action without revealing the proposer'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000002'
    )$$,
  '42501', null,
  'an AAL1 claim cannot approve a medication plan'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000003"}',
  true
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000003'
    )$$,
  '42501', null,
  'an AAL2 event older than fifteen minutes cannot approve a plan'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000004"}',
  true
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000004'
    )$$,
  '42501', 'recent immutable AAL2 evidence is required for medication plan approval',
  'a recent mutable event whose challenge evidence does not match is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000003',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000005'
    )$$,
  '42501', 'medication plan is outside the selected tenant context',
  'a multi-tenant approver cannot approve an A plan through selected context B'
);

select results_eq(
  $$select workflow_state, row_version,
           replacement_effective_at is null, replayed
    from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, 3::bigint, true, false)$$,
  'an independent manager atomically approves and signs the first plan version'
);

select results_eq(
  $$select workflow_state, row_version,
           replacement_effective_at is null, replayed
    from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      2,
      'a8200000-0000-4000-8000-000000000010'
    )$$,
  $$values ('approved'::text, 3::bigint, true, true)$$,
  'an exact approval retry is safe and returns the original approval receipt'
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin'
      ),
      3,
      'a8200000-0000-4000-8000-000000000010'
    )$$,
  '23505', 'medication plan operation idempotency conflict',
  'changing an approval request while reusing its actor key is rejected'
);

reset role;

select ok(
  (
    select plan.workflow_state = 'approved'
      and plan.status = 'active'
      and plan.submitted_by = 'a1000000-0000-4000-8000-000000000001'
      and plan.approved_by = 'a1000000-0000-4000-8000-000000000002'
      and plan.submitted_by <> plan.approved_by
      and plan.approval_reauth_challenge_id = 'a7000000-0000-4000-8000-000000000002'
      and plan.approval_signature_purpose = '用藥計畫獨立核准簽署'
      and plan.signed_at = plan.approved_at
      and plan.signed_by = plan.approved_by
      and plan.content_hash ~ '^[a-f0-9]{64}$'
      and (
        select count(*)
        from private.reauth_challenges challenge
        where challenge.user_id = plan.approved_by
          and challenge.session_id = 'a7100000-0000-4000-8000-000000000002'
          and challenge.consumed_at is not null
      ) = 2
    from public.medication_plans plan
    where plan.organization_id = 'a2000000-0000-4000-8000-000000000001'
      and plan.client_id = 'a5000000-0000-4000-8000-000000000001'
      and plan.medication_name = 'Metformin'
  ),
  'approval deterministically stores the latest exact challenge when a session has old and fresh evidence'
);

select is(
  (
    select count(*)::integer
    from private.medication_plan_operations operation
    where operation.operation_kind = 'approve'
      and operation.actor_user_id = 'a1000000-0000-4000-8000-000000000002'
      and operation.idempotency_key = 'a8200000-0000-4000-8000-000000000010'
  ),
  1,
  'an exact approval retry creates one immutable operation receipt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select workflow_state, lifecycle_state, row_version
    from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )
    where medication_name = 'Metformin'$$,
  $$values ('approved'::text, 'scheduled'::text, 3::bigint)$$,
  'the minimal projection shows a future approved plan without exposing signing evidence'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select version, workflow_state, row_version, replayed
    from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      null, 'Metformin', 500, 'mg', 'oral',
      '{"times":["20:00","08:00"]}'::jsonb, false,
      clock_timestamp() - interval '1 hour', null,
      'a8000000-0000-4000-8000-000000000020'
    )$$,
  $$values (1, 'draft'::text, 1::bigint, false)$$,
  'a separate stream may be drafted even when its natural medication window would later overlap'
);

select results_eq(
  $$select workflow_state, row_version, replayed
    from public.submit_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and workflow_state = 'draft'
      ),
      1,
      'a8100000-0000-4000-8000-000000000020'
    )$$,
  $$values ('submitted'::text, 2::bigint, false)$$,
  'the overlapping candidate can be submitted but is not yet effective'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and workflow_state = 'submitted'
      ),
      2,
      'a8200000-0000-4000-8000-000000000020'
    )$$,
  '23P01', null,
  'approval rejects the same natural schedule window despite reversed time order'
);

select throws_ok(
  $$select * from public.stop_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and effective_from = '2030-01-01 08:00:00+08'::timestamptz
      ),
      2,
      '醫囑停藥',
      'a8300000-0000-4000-8000-000000000009'
    )$$,
  '40001', 'medication plan row version changed before stop',
  'stop enforces the exact approved row version atomically'
);

select results_eq(
  $$select row_version, lifecycle_state, stopped_at is not null, replayed
    from public.stop_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and effective_from = '2030-01-01 08:00:00+08'::timestamptz
      ),
      3,
      '醫囑停藥',
      'a8300000-0000-4000-8000-000000000010'
    )$$,
  $$values (3::bigint, 'stopped'::text, true, false)$$,
  'stopping a plan appends one server-timed signed lifecycle event'
);

select results_eq(
  $$select row_version, lifecycle_state, stopped_at is not null, replayed
    from public.stop_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and effective_from = '2030-01-01 08:00:00+08'::timestamptz
      ),
      3,
      '醫囑停藥',
      'a8300000-0000-4000-8000-000000000010'
    )$$,
  $$values (3::bigint, 'stopped'::text, true, true)$$,
  'an exact stop retry returns the original server-timed event'
);

select throws_ok(
  $$select * from public.stop_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and effective_from = '2030-01-01 08:00:00+08'::timestamptz
      ),
      3,
      '不同停藥理由',
      'a8300000-0000-4000-8000-000000000010'
    )$$,
  '23505', 'medication plan operation idempotency conflict',
  'reusing a stop key with a changed reason is rejected'
);

select results_eq(
  $$select lifecycle_state, termination_kind, termination_reason,
           terminated_at is not null
    from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )
    where medication_name = 'Metformin'
      and effective_from = '2030-01-01 08:00:00+08'::timestamptz$$,
  $$values ('stopped'::text, 'stopped'::text, '醫囑停藥'::text, true)$$,
  'the projection derives stopped state and reason from the append-only lifecycle event'
);

select results_eq(
  $$select workflow_state, row_version,
           replacement_effective_at is null, replayed
    from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and workflow_state = 'submitted'
      ),
      2,
      'a8200000-0000-4000-8000-000000000020'
    )$$,
  $$values ('approved'::text, 3::bigint, true, false)$$,
  'the previously overlapping plan can be approved only after the old window is terminated'
);

reset role;

select ok(
  (
    select termination.termination_kind = 'stopped'
      and termination.effective_at between clock_timestamp() - interval '2 minutes'
        and clock_timestamp() + interval '1 minute'
      and termination.stopped_by = 'a1000000-0000-4000-8000-000000000002'
      and termination.reauth_challenge_id = 'a7000000-0000-4000-8000-000000000002'
      and termination.reason = '醫囑停藥'
      and termination.content_hash ~ '^[a-f0-9]{64}$'
    from private.medication_plan_terminations termination
    join public.medication_plans plan on plan.id = termination.medication_plan_id
    where plan.effective_from = '2030-01-01 08:00:00+08'::timestamptz
      and plan.medication_name = 'Metformin'
  ),
  'the stop event stores server time, reason, actor, exact AAL2 evidence, and server hash'
);

insert into public.medication_administrations (
  id,
  organization_id,
  branch_id,
  client_id,
  medication_plan_id,
  scheduled_for,
  status,
  idempotency_key
) select
  'a8500000-0000-4000-8000-000000000001',
  plan.organization_id,
  plan.branch_id,
  plan.client_id,
  plan.id,
  '2032-01-01 08:00:00+08'::timestamptz,
  'scheduled',
  'a8600000-0000-4000-8000-000000000001'
from public.medication_plans plan
join private.medication_plan_operations operation
  on operation.medication_plan_id = plan.id
 and operation.operation_kind = 'create_draft'
 and operation.idempotency_key = 'a8000000-0000-4000-8000-000000000020';

insert into public.medication_administrations (
  id,
  organization_id,
  branch_id,
  client_id,
  medication_plan_id,
  scheduled_for,
  status,
  idempotency_key
) select
  'a8500000-0000-4000-8000-000000000002',
  plan.organization_id,
  plan.branch_id,
  plan.client_id,
  plan.id,
  '2036-01-01 08:00:00+08'::timestamptz,
  'scheduled',
  'a8600000-0000-4000-8000-000000000002'
from public.medication_plans plan
join private.medication_plan_operations operation
  on operation.medication_plan_id = plan.id
 and operation.operation_kind = 'create_draft'
 and operation.idempotency_key = 'a8000000-0000-4000-8000-000000000020';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$select version, workflow_state, row_version, replayed
    from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        )
        where medication_name = 'Metformin'
          and workflow_state = 'approved'
          and termination_kind is null
      ),
      'Metformin XR', 750, 'mg', 'oral',
      '{"times":["08:00","20:00"]}'::jsonb, false,
      '2035-01-01 08:00:00+08'::timestamptz, null,
      'a8000000-0000-4000-8000-000000000030'
    )$$,
  $$values (2, 'draft'::text, 1::bigint, false)$$,
  'a medication change creates a new version linked to the latest approved plan'
);

select results_eq(
  $$select workflow_state, row_version, replayed
    from public.submit_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin XR'
      ),
      1,
      'a8100000-0000-4000-8000-000000000030'
    )$$,
  $$values ('submitted'::text, 2::bigint, false)$$,
  'the new medication version is frozen before independent approval'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select version, workflow_state, row_version,
           effective_from = '2035-01-01 08:00:00+08'::timestamptz,
           replacement_effective_at = '2035-01-01 08:00:00+08'::timestamptz,
           replayed
    from public.approve_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin XR'
      ),
      2,
      'a8200000-0000-4000-8000-000000000030'
    )$$,
  $$values (2, 'approved'::text, 3::bigint, true, true, false)$$,
  'approving a future replacement preserves its requested cutover instead of activating it early'
);

select throws_ok(
  $$select * from public.create_medication_plan_draft(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin XR'
      ),
      'Metformin XR next', 1000, 'mg', 'oral',
      '{"times":["08:00","20:00"]}'::jsonb, false,
      '2036-01-01 08:00:00+08'::timestamptz, null,
      'a8000000-0000-4000-8000-000000000031'
    )$$,
  '23514', 'a future replacement target is locked against revision until its immutable scheduled cutover',
  'a scheduled replacement cannot branch again before its immutable incoming cutover'
);

select throws_ok(
  $$select * from public.stop_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin XR'
      ),
      3,
      '取消未來換藥',
      'a8300000-0000-4000-8000-000000000031'
    )$$,
  '23514', 'a future replacement target is locked by its immutable scheduled cutover',
  'a future replacement target cannot be stopped while its immutable incoming cutover is pending'
);

select throws_ok(
  $$select * from public.stop_medication_plan(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      (
        select plan_id from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin XR'
      ),
      3,
      '取消未來換藥',
      'a8300000-0000-4000-8000-000000000031'
    )$$,
  '23514', 'a future replacement target is locked by its immutable scheduled cutover',
  'retrying the same rejected future-cutover stop remains rejected and creates no replay receipt'
);

reset role;

select ok(
  (
    select plan.row_version = 3
      and not exists (
        select 1
        from private.medication_plan_terminations own_termination
        where own_termination.medication_plan_id = plan.id
      )
      and (
        select count(*)
        from private.medication_plan_terminations incoming
        where incoming.replacement_plan_id = plan.id
          and incoming.termination_kind = 'replaced'
          and incoming.effective_at = '2035-01-01 08:00:00+08'::timestamptz
      ) = 1
      and not exists (
        select 1
        from private.medication_plan_operations operation
        where operation.idempotency_key in (
          'a8000000-0000-4000-8000-000000000031',
          'a8300000-0000-4000-8000-000000000031'
        )
      )
      and not exists (
        select 1
        from public.medication_plans newer
        where newer.record_key = plan.record_key
          and newer.version > plan.version
      )
      and (
        select array_agg(administration.status::text order by administration.id)
        from public.medication_administrations administration
        where administration.id in (
          'a8500000-0000-4000-8000-000000000001',
          'a8500000-0000-4000-8000-000000000002'
        )
      ) = array['scheduled', 'voided']::text[]
    from public.medication_plans plan
    where plan.medication_name = 'Metformin XR'
  ),
  'rejected cutover cancellation mutates no plan, slot, termination, or operation receipt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a7100000-0000-4000-8000-000000000002"}',
  true
);

select results_eq(
  $$select medication_name, version, lifecycle_state, termination_kind
    from public.medication_plan_snapshot(
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001'
    )
    where medication_name in ('Metformin', 'Metformin XR')
      and record_key = (
        select record_key
        from public.medication_plan_snapshot(
          'a2000000-0000-4000-8000-000000000001',
          'a3000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001'
        ) where medication_name = 'Metformin XR'
      )
    order by version$$,
  $$values
    ('Metformin'::text, 1, 'active'::text, 'replaced'::text),
    ('Metformin XR'::text, 2, 'scheduled'::text, null::text)$$,
  'before the future cutover the snapshot keeps the old plan active and the replacement scheduled'
);

reset role;

select ok(
  (
    select old_plan.workflow_state = 'approved'
      and old_plan.status = 'active'
      and old_plan.signed_at is not null
      and old_plan.signed_by = 'a1000000-0000-4000-8000-000000000002'
      and old_plan.content_hash ~ '^[a-f0-9]{64}$'
      and termination.termination_kind = 'replaced'
      and termination.effective_at = new_plan.effective_from
      and termination.replacement_plan_id = new_plan.id
    from public.medication_plans old_plan
    join private.medication_plan_terminations termination
      on termination.medication_plan_id = old_plan.id
    join public.medication_plans new_plan
      on new_plan.id = termination.replacement_plan_id
    where old_plan.medication_name = 'Metformin'
      and new_plan.medication_name = 'Metformin XR'
  ),
  'replacement leaves the old signed document unchanged and records lifecycle state separately'
);

select is(
  (
    select status::text
    from public.medication_administrations
    where id = 'a8500000-0000-4000-8000-000000000001'
  ),
  'scheduled',
  'replacement preserves prior-plan slots scheduled before the future cutover'
);

select is(
  (
    select status::text
    from public.medication_administrations
    where id = 'a8500000-0000-4000-8000-000000000002'
  ),
  'voided',
  'replacement voids only prior-plan slots at or after the future cutover'
);

select throws_ok(
  $$update public.medication_plans
    set dose = 999
    where medication_name = 'Metformin XR'$$,
  '55000', null,
  'an owner cannot mutate an approved plan document after signing'
);

select throws_ok(
  $$delete from public.medication_plans
    where medication_name = 'Metformin XR'$$,
  '55000', null,
  'an owner cannot delete an approved plan document after signing'
);

select throws_ok(
  $$delete from private.medication_plan_terminations
    where replacement_plan_id is not null$$,
  '55000', 'medication plan lifecycle and operation history is immutable',
  'replacement lifecycle evidence cannot be deleted even by the owner'
);

select throws_ok(
  $$update private.medication_plan_operations
    set result_workflow_state = 'stopped'
    where idempotency_key = 'a8200000-0000-4000-8000-000000000030'$$,
  '55000', 'medication plan lifecycle and operation history is immutable',
  'operation receipts cannot be rewritten even by the owner'
);

select ok(
  exists (
    select 1
    from public.audit_events event
    where event.table_name = 'medication_plans'
      and event.action = 'select'
      and event.row_pk = 'a5000000-0000-4000-8000-000000000001'
      and event.metadata ->> 'projection' = 'page8_minimal'
  )
  and exists (
    select 1
    from public.audit_events event
    where event.table_name = 'private.medication_plan_terminations'
      and event.action = 'insert'
  )
  and exists (
    select 1
    from public.audit_events event
    where event.table_name = 'private.medication_plan_operations'
      and event.action = 'insert'
  ),
  'snapshot reads, lifecycle events, and governed operations all leave non-PII audit evidence'
);

select * from finish();
rollback;
