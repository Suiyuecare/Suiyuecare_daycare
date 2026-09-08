begin;

set local timezone to 'Asia/Taipei';

select plan(45);

select ok(
  has_function_privilege(
    'authenticated',
    'public.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)'::regprocedure
  ),
  'Page83 public snapshot is authenticated-only and SECURITY INVOKER'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc procedure
    where procedure.oid =
      'private.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)'::regprocedure
  ),
  'Page83 guarded snapshot is fixed-search-path volatile SECURITY DEFINER'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.integrations_audit_snapshot_bundle(uuid,uuid,date,date,timestamp with time zone,timestamp with time zone,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.integrations_audit_resource_category(text)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.integrations_audit_safe_record_id(text,text)', 'execute'
  ),
  'authenticated cannot invoke Page83 redaction or source helpers directly'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.interprofessional_consultation_outbox', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.referral_notification_outbox', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.care_communication_delivery_events', 'select'
  )
  and not has_table_privilege('authenticated', 'public.audit_events', 'insert')
  and not has_table_privilege('authenticated', 'public.audit_events', 'select')
  and not has_table_privilege('authenticated', 'public.audit_events', 'update')
  and not has_table_privilege('authenticated', 'public.audit_events', 'delete')
  and has_table_privilege('service_role', 'public.audit_events', 'select'),
  'Page83 exposes no direct authenticated audit ledger access and preserves service access'
);

select ok(
  to_regclass('public.integrations_audit_import_time_idx') is not null
  and to_regclass('public.integrations_audit_delivery_time_idx') is not null
  and to_regclass('public.integrations_audit_sync_time_idx') is not null
  and to_regclass('public.integrations_audit_claim_time_idx') is not null
  and to_regclass('public.integrations_audit_consultation_outbox_time_idx') is not null
  and to_regclass('public.integrations_audit_referral_outbox_time_idx') is not null
  and to_regclass('public.integrations_audit_communication_time_idx') is not null,
  'all newly scanned persisted sources have scope-first time indexes'
);

select ok(
  position('batch.updated_at >= p_window_start' in pg_get_functiondef(
    'private.integrations_audit_snapshot_bundle(uuid,uuid,date,date,timestamp with time zone,timestamp with time zone,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
  )) > 0
  and position('delivery.updated_at >= p_window_start' in pg_get_functiondef(
    'private.integrations_audit_snapshot_bundle(uuid,uuid,date,date,timestamp with time zone,timestamp with time zone,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
  )) > 0
  and position('operation.updated_at >= p_window_start' in pg_get_functiondef(
    'private.integrations_audit_snapshot_bundle(uuid,uuid,date,date,timestamp with time zone,timestamp with time zone,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
  )) > 0
  and position('queued.queued_at >= p_window_start' in pg_get_functiondef(
    'private.integrations_audit_snapshot_bundle(uuid,uuid,date,date,timestamp with time zone,timestamp with time zone,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
  )) > 0
  and position('delivery.occurred_at >= p_window_start' in pg_get_functiondef(
    'private.integrations_audit_snapshot_bundle(uuid,uuid,date,date,timestamp with time zone,timestamp with time zone,text,text,text,text,uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
  )) > 0,
  'each materialized source arm applies its time bound before union materialization'
);

select ok(
  position('private.has_recent_aal2(15)' in pg_get_functiondef(
    'private.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)'::regprocedure
  )) > 0
  and position('audit.view' in pg_get_functiondef(
    'private.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)'::regprocedure
  )) > 0
  and position('public.audit_events' in pg_get_functiondef(
    'private.integrations_audit_snapshot(uuid,uuid,date,date,text,text,text,text,uuid,uuid)'::regprocedure
  )) > 0,
  'Page83 requires recent same-session AAL2 plus audit.view and audits successful reads'
);

select ok(
  position('physical_therapy_service_record_versions' in pg_get_functiondef(
    'private.integrations_audit_resource_category(text)'::regprocedure
  )) > 0
  and position('occupational_therapy_service_record_versions' in pg_get_functiondef(
    'private.integrations_audit_resource_category(text)'::regprocedure
  )) > 0
  and position('billing_receipts' in pg_get_functiondef(
    'private.integrations_audit_resource_category(text)'::regprocedure
  )) > 0
  and position('transport_execution_events' in pg_get_functiondef(
    'private.integrations_audit_resource_category(text)'::regprocedure
  )) > 0
  and position('physical_therapy_services' in pg_get_functiondef(
    'private.integrations_audit_resource_category(text)'::regprocedure
  )) = 0
  and position('occupational_therapy_services' in pg_get_functiondef(
    'private.integrations_audit_resource_category(text)'::regprocedure
  )) = 0,
  'resource mapping names actual audit writers and contains no retired therapy aliases'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '98300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'page83-reader@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '98300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'page83-no-permission@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '98300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'page83-other-org@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('98310000-0000-4000-8000-000000000001', 'page83_org_a', 'Page83 合成機構 A'),
  ('98310000-0000-4000-8000-000000000002', 'page83_org_b', 'Page83 合成機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('98320000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', 'main', 'Page83 A 主分支'),
  ('98320000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000001', 'second', 'Page83 A 第二分支'),
  ('98320000-0000-4000-8000-000000000003', '98310000-0000-4000-8000-000000000002', 'main', 'Page83 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('98300000-0000-4000-8000-000000000001', 'Page83 分支稽核員', 'staff'),
  ('98300000-0000-4000-8000-000000000002', 'Page83 無權限員工', 'staff'),
  ('98300000-0000-4000-8000-000000000003', 'Page83 其他機構稽核員', 'staff');

insert into public.roles (id, organization_id, role_key, name, is_system) values
  ('98330000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', 'page83_audit_reader', 'Page83 A 稽核讀者', false),
  ('98330000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000002', 'page83_audit_reader', 'Page83 B 稽核讀者', false);

insert into public.role_permissions (role_id, permission_id)
select role_id, permission.id
from (values
  ('98330000-0000-4000-8000-000000000001'::uuid),
  ('98330000-0000-4000-8000-000000000002'::uuid)
) role(role_id)
cross join public.permissions permission
where permission.permission_key = 'audit.view';

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('98340000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'active'),
  ('98340000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000002', 'active'),
  ('98340000-0000-4000-8000-000000000003', '98310000-0000-4000-8000-000000000002', '98320000-0000-4000-8000-000000000003', '98300000-0000-4000-8000-000000000003', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('98340000-0000-4000-8000-000000000001', '98330000-0000-4000-8000-000000000001'),
  ('98340000-0000-4000-8000-000000000003', '98330000-0000-4000-8000-000000000002');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values
  ('98351000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', '98350000-0000-4000-8000-000000000001', repeat('1',64), '98352000-0000-4000-8000-000000000001', clock_timestamp()-interval '2 minutes', 'page83-a-before', clock_timestamp()-interval '1 minute', clock_timestamp()+interval '4 minutes', clock_timestamp()-interval '30 seconds', clock_timestamp()-interval '30 seconds', 'page83-a-after', 'totp', clock_timestamp()-interval '30 seconds'),
  ('98351000-0000-4000-8000-000000000002', '98300000-0000-4000-8000-000000000002', '98350000-0000-4000-8000-000000000002', repeat('2',64), '98352000-0000-4000-8000-000000000002', clock_timestamp()-interval '2 minutes', 'page83-b-before', clock_timestamp()-interval '1 minute', clock_timestamp()+interval '4 minutes', clock_timestamp()-interval '30 seconds', clock_timestamp()-interval '30 seconds', 'page83-b-after', 'totp', clock_timestamp()-interval '30 seconds'),
  ('98351000-0000-4000-8000-000000000003', '98300000-0000-4000-8000-000000000003', '98350000-0000-4000-8000-000000000003', repeat('3',64), '98352000-0000-4000-8000-000000000003', clock_timestamp()-interval '2 minutes', 'page83-c-before', clock_timestamp()-interval '1 minute', clock_timestamp()+interval '4 minutes', clock_timestamp()-interval '30 seconds', clock_timestamp()-interval '30 seconds', 'page83-c-after', 'totp', clock_timestamp()-interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('98300000-0000-4000-8000-000000000001', '98350000-0000-4000-8000-000000000001', '98351000-0000-4000-8000-000000000001', 'aal2', 'totp', clock_timestamp() - interval '30 seconds'),
  ('98300000-0000-4000-8000-000000000002', '98350000-0000-4000-8000-000000000002', '98351000-0000-4000-8000-000000000002', 'aal2', 'totp', clock_timestamp() - interval '30 seconds'),
  ('98300000-0000-4000-8000-000000000003', '98350000-0000-4000-8000-000000000003', '98351000-0000-4000-8000-000000000003', 'aal2', 'totp', clock_timestamp() - interval '30 seconds');

insert into public.import_batches (
  id, organization_id, branch_id, uploaded_by, upload_idempotency_key,
  original_file_name, mime_type, encoding, file_size_bytes, sha256,
  mapping_version, status, raw_object_key, failure_code
) values
  ('98360000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', '98361000-0000-4000-8000-000000000001', 'mapping.html', 'text/html', 'utf-8', 120, repeat('1', 64), 'v1', 'mapping_required', 'private/page83/mapping', null),
  ('98360000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', '98361000-0000-4000-8000-000000000002', 'failed.html', 'text/html', 'utf-8', 121, repeat('2', 64), 'v1', 'validation_failed', 'private/page83/failed', 'SYNTHETIC_PRIVATE_FAILURE_CANARY'),
  ('98360000-0000-4000-8000-000000000003', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000002', '98300000-0000-4000-8000-000000000001', '98361000-0000-4000-8000-000000000003', 'other-branch.html', 'text/html', 'utf-8', 122, repeat('3', 64), 'v1', 'duplicate', 'private/page83/other-branch', null),
  ('98360000-0000-4000-8000-000000000004', '98310000-0000-4000-8000-000000000002', '98320000-0000-4000-8000-000000000003', '98300000-0000-4000-8000-000000000003', '98361000-0000-4000-8000-000000000004', 'other-org.html', 'text/html', 'utf-8', 123, repeat('4', 64), 'v1', 'duplicate', 'private/page83/other-org', null);

insert into public.notifications (
  id, organization_id, branch_id, category, priority, title, body,
  audience, status, created_by
) values
  ('98370000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', 'synthetic', 1, 'Page83 合成通知一', '登入查看', '{}'::jsonb, 'sent', '98300000-0000-4000-8000-000000000001'),
  ('98370000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', 'synthetic', 1, 'Page83 合成通知二', '登入查看', '{}'::jsonb, 'sent', '98300000-0000-4000-8000-000000000001');

insert into public.notification_deliveries (
  id, organization_id, branch_id, notification_id, recipient_user_id,
  channel, status, idempotency_key, provider_message_id, error_code
) values
  ('98371000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98370000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'line', 'failed', '98372000-0000-4000-8000-000000000001', 'PROVIDER-SECRET', 'address=private@example.invalid'),
  ('98371000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98370000-0000-4000-8000-000000000002', '98300000-0000-4000-8000-000000000001', 'pwa', 'delivered', '98372000-0000-4000-8000-000000000002', null, null);

insert into public.sync_operations (
  id, organization_id, branch_id, user_id, device_id, idempotency_key,
  entity_type, occurred_at, payload_hash, status, conflict_details
) values (
  '98380000-0000-4000-8000-000000000001',
  '98310000-0000-4000-8000-000000000001',
  '98320000-0000-4000-8000-000000000001',
  '98300000-0000-4000-8000-000000000001',
  'page83-device-conflict',
  '98381000-0000-4000-8000-000000000001',
  'synthetic', clock_timestamp(), repeat('5', 64), 'conflict',
  '{"client_name":"SHOULD_NEVER_LEAVE_DB"}'::jsonb
);

insert into public.sync_operations (
  id, organization_id, branch_id, user_id, device_id, idempotency_key,
  entity_type, occurred_at, payload_hash, status
)
select gen_random_uuid(),
  '98310000-0000-4000-8000-000000000001',
  '98320000-0000-4000-8000-000000000001',
  '98300000-0000-4000-8000-000000000001',
  'page83-device-' || series::text,
  gen_random_uuid(), 'synthetic', clock_timestamp(), repeat('6', 64), 'applied'
from generate_series(1, 104) series;

insert into public.claim_batches (
  id, organization_id, branch_id, claim_period_start, claim_period_end,
  format_version, status, snapshot_hash, snapshot_hash_version, exported_at, created_by
) values
  ('98390000-0000-4000-8000-000000000001', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', current_date, current_date, 'synthetic-v1', 'draft', null, null, null, '98300000-0000-4000-8000-000000000001'),
  ('98390000-0000-4000-8000-000000000002', '98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', current_date - 1, current_date - 1, 'synthetic-v1', 'rejected', repeat('7', 64), 'legacy-js-v1', clock_timestamp(), '98300000-0000-4000-8000-000000000001');

-- Remove setup noise before creating one actual canonical row-trigger event.
-- This owner-only cleanup is test fixture isolation; no application role has
-- delete privilege on the append-only ledger.
delete from public.audit_events
where organization_id in (
  '98310000-0000-4000-8000-000000000001',
  '98310000-0000-4000-8000-000000000002'
);

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status, source_system
) values (
  '983b0000-0000-4000-8000-000000000001',
  '98310000-0000-4000-8000-000000000001',
  '98320000-0000-4000-8000-000000000001',
  'PAGE83-TRIGGER-001', 'Page83 合成觸發器個案', 'active', 'synthetic_test'
);

insert into public.audit_events (
  organization_id, branch_id, actor_user_id, action, table_name, row_pk,
  request_id, idempotency_key, changed_fields, metadata
) values
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'integration', 'notification_deliveries', '98371000-0000-4000-8000-000000000001', '983a0000-0000-4000-8000-000000000001', null, array['recipient_email'], '{"token":"AUDIT_SECRET"}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'insert', 'import_fields', '123', null, null, array['raw_value'], '{"name":"PRIVATE"}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'update', 'phone_0912345678_private', '0912345678', 'not-a-safe-request-id', null, array['secret'], '{"payload":"PRIVATE"}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'delete', 'notification_deliveries', '0912345678', 'contact@example.invalid', null, '{}'::text[], '{}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'sign', 'physical_therapy_service_record_versions', '983c0000-0000-4000-8000-000000000001', null, null, '{}'::text[], '{}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'correct', 'public.staff_vaccination_versions', '983c0000-0000-4000-8000-000000000002', null, null, '{}'::text[], '{}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'print', 'public.billing_receipts', '983c0000-0000-4000-8000-000000000003', null, null, '{}'::text[], '{}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000001', '98300000-0000-4000-8000-000000000001', 'export', 'public.transport_execution_events', '983c0000-0000-4000-8000-000000000004', null, null, '{}'::text[], '{}'::jsonb),
  ('98310000-0000-4000-8000-000000000001', '98320000-0000-4000-8000-000000000002', '98300000-0000-4000-8000-000000000001', 'integration', 'notification_deliveries', '98371000-0000-4000-8000-000000000001', null, null, '{}'::text[], '{"branch":"SECRET"}'::jsonb),
  ('98310000-0000-4000-8000-000000000002', '98320000-0000-4000-8000-000000000003', '98300000-0000-4000-8000-000000000003', 'integration', 'notification_deliveries', '98371000-0000-4000-8000-000000000001', null, null, '{}'::text[], '{"org":"SECRET"}'::jsonb);

insert into public.audit_events (
  organization_id, branch_id, actor_user_id, action, table_name, row_pk,
  changed_fields, metadata, occurred_at
)
select
  '98310000-0000-4000-8000-000000000001',
  '98320000-0000-4000-8000-000000000001',
  '98300000-0000-4000-8000-000000000001',
  'update', 'synthetic_unlisted_resource', 'PRIVATE-' || series::text,
  array['payload'], '{"secret":"BULK_PRIVATE"}'::jsonb,
  clock_timestamp() - interval '1 minute'
from generate_series(1, 205) series;

set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"98300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"98350000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000001',
    (clock_timestamp() at time zone 'Asia/Taipei')::date,
    (clock_timestamp() at time zone 'Asia/Taipei')::date
  )$$,
  '42501', null,
  'AAL1 is denied before the Page83 source snapshot'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98350000-0000-4000-8000-000000000099"}',
  true
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000001', current_date, current_date
  )$$,
  '42501', null,
  'AAL2 without recent same-session evidence is denied'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98300000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98350000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000001', current_date, current_date
  )$$,
  '42501', null,
  'active staff without audit.view is denied rather than receiving an empty snapshot'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98350000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok(
  $$select table_name, row_pk, changed_fields, metadata
    from public.audit_events limit 1$$,
  '42501', null,
  'authenticated cannot bypass the redacted RPC by selecting raw audit evidence'
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000002', current_date, current_date
  )$$,
  '42501', null,
  'branch-scoped reader cannot query a sibling branch'
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000002',
    '98320000-0000-4000-8000-000000000003', current_date, current_date
  )$$,
  '42501', null,
  'branch-scoped reader cannot query another organization'
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000001', current_date - 90, current_date
  )$$,
  '42501', null,
  'more than 90 inclusive calendar days is rejected'
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000001', current_date, current_date,
    'line', 'all', 'all', 'all'
  )$$,
  '42501', null,
  'unknown integration filter is rejected'
);

select throws_ok(
  $$select * from public.integrations_audit_snapshot(
    '98310000-0000-4000-8000-000000000001',
    '98320000-0000-4000-8000-000000000001', current_date, current_date,
    'all', 'healthy', 'login', 'raw_table'
  )$$,
  '42501', null,
  'unknown state, action and resource vocabulary is rejected'
);

create temporary table page83_snapshot_result as
select * from public.integrations_audit_snapshot(
  '98310000-0000-4000-8000-000000000001',
  '98320000-0000-4000-8000-000000000001',
  (clock_timestamp() at time zone 'Asia/Taipei')::date,
  (clock_timestamp() at time zone 'Asia/Taipei')::date
);

select ok(
  (
    select snapshot_hash = encode(sha256(convert_to(snapshot_json, 'UTF8')), 'hex')
      and stale_after - generated_at = interval '60 seconds'
      and snapshot_json::jsonb ->> 'schema_version' = 'page83-integrations-audit.v1'
      and snapshot_json::jsonb ->> 'consistency_status' = 'single_database_statement_snapshot'
      and snapshot_json::jsonb ->> 'demo' = 'false'
    from page83_snapshot_result
  ),
  'snapshot is a 60-second immutable hash-bound formal database projection'
);

select results_eq(
  $$select
      snapshot_json::jsonb #>> '{access_requirements,permission}',
      snapshot_json::jsonb #>> '{access_requirements,recent_same_session_aal2_required}',
      snapshot_json::jsonb #>> '{capabilities,integration_registry_status}',
      snapshot_json::jsonb #>> '{capabilities,provider_regional_compliance_status}',
      snapshot_json::jsonb #>> '{capabilities,retry_commands_status}',
      snapshot_json::jsonb #>> '{capabilities,payload_inspection_status}',
      snapshot_json::jsonb #>> '{capabilities,mutation_status}'
    from page83_snapshot_result$$,
  $$values ('audit.view'::text, 'true'::text, 'unconfigured'::text,
    'unconfigured'::text, 'unconfigured'::text, 'prohibited'::text,
    'read_only'::text)$$,
  'missing governance/provider/command capabilities remain explicit and are not inferred from zero rows'
);

select is(
  (select jsonb_array_length(snapshot_json::jsonb -> 'inventory')
   from page83_snapshot_result),
  7,
  'inventory always contains all seven persisted-source categories'
);

select results_eq(
  $$select item ->> 'integration_key', item ->> 'record_total',
      item ->> 'attention_total', item ->> 'pending_total',
      item ->> 'activity_state'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'inventory') item
    where item ->> 'integration_key' = 'central_html_import'$$,
  $$values ('central_html_import'::text, '2'::text, '2'::text, '1'::text,
    'attention'::text)$$,
  'import mapping and validation states produce exact branch-local pending and attention totals'
);

select results_eq(
  $$select item ->> 'integration_key', item ->> 'record_total',
      item ->> 'attention_total', item ->> 'activity_state'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'inventory') item
    where item ->> 'integration_key' in (
      'notification_delivery', 'pwa_sync', 'claims'
    ) order by item ->> 'integration_key'$$,
  $$values
    ('claims'::text, '2'::text, '1'::text, 'attention'::text),
    ('notification_delivery'::text, '2'::text, '1'::text, 'attention'::text),
    ('pwa_sync'::text, '105'::text, '1'::text, 'attention'::text)$$,
  'delivery, sync and claim persisted states are counted independently without cross-branch rows'
);

select results_eq(
  $$select item ->> 'integration_key', item ->> 'record_total',
      item ->> 'latest_activity_at', item ->> 'governance_status'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'inventory') item
    where item ->> 'integration_key' in (
      'consultation_notification_outbox', 'referral_notification_outbox',
      'family_communication_delivery'
    ) order by item ->> 'integration_key'$$,
  $$values
    ('consultation_notification_outbox'::text, '0'::text, null::text, 'unconfigured'::text),
    ('family_communication_delivery'::text, '0'::text, null::text, 'unconfigured'::text),
    ('referral_notification_outbox'::text, '0'::text, null::text, 'unconfigured'::text)$$,
  'no-activity outboxes remain unconfigured rather than being labelled healthy or connected'
);

select results_eq(
  $$select
      snapshot_json::jsonb ->> 'signal_matching_total',
      jsonb_array_length(snapshot_json::jsonb -> 'signals')::text,
      snapshot_json::jsonb ->> 'signals_truncated'
    from page83_snapshot_result$$,
  $$values ('111'::text, '100'::text, 'true'::text)$$,
  'signal rows are capped at 100 while full-set totals remain exact'
);

select ok(
  (
    select bool_and(
      item ? 'signal_id'
      and item ? 'integration_key'
      and item ? 'occurred_at'
      and item ? 'state'
      and item ? 'source_path'
      and not item ? 'payload'
      and not item ? 'provider_message_id'
      and not item ? 'conflict_details'
    )
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'signals') item
  ),
  'bounded signals expose only the stable operational vocabulary'
);

select results_eq(
  $$select item ->> 'error_category', item ->> 'error_code_status'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'signals') item
    where item ->> 'signal_id' = '98360000-0000-4000-8000-000000000002'$$,
  $$values ('import_validation_failed'::text, 'redacted'::text)$$,
  'arbitrary import failure codes become a safe category plus redaction status'
);

select results_eq(
  $$select item ->> 'error_category', item ->> 'error_code_status'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'signals') item
    where item ->> 'signal_id' = '98371000-0000-4000-8000-000000000001'$$,
  $$values ('notification_delivery_failed'::text, 'redacted'::text)$$,
  'arbitrary provider errors become a safe delivery category plus redaction status'
);

select ok(
  not exists (
    select 1 from page83_snapshot_result
    where snapshot_json like any (array[
      '%SYNTHETIC_PRIVATE_FAILURE_CANARY%', '%PROVIDER-SECRET%', '%private@example.invalid%',
      '%SHOULD_NEVER_LEAVE_DB%', '%AUDIT_SECRET%', '%BULK_PRIVATE%',
      '%phone_0912345678_private%', '%recipient_email%', '%raw_value%'
    ])
  ),
  'PII-like values, tokens, provider IDs, payloads, metadata and changed fields never enter the snapshot'
);

select results_eq(
  $$select
      snapshot_json::jsonb ->> 'audit_matching_total',
      jsonb_array_length(snapshot_json::jsonb -> 'audit_events')::text,
      snapshot_json::jsonb ->> 'audit_events_truncated'
    from page83_snapshot_result$$,
  $$values ('214'::text, '200'::text, 'true'::text)$$,
  'audit rows are capped at 200 while full branch-local matching total is exact'
);

select results_eq(
  $$select item ->> 'action', item ->> 'resource_category', item -> 'record_id'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'audit_events') item
    where item ->> 'action' in ('sign','correct','print','export')
    order by item ->> 'action'$$,
  $$values
    ('correct'::text, 'staff'::text,
      '{"kind":"uuid","value":"983c0000-0000-4000-8000-000000000002"}'::jsonb),
    ('export'::text, 'operations'::text,
      '{"kind":"uuid","value":"983c0000-0000-4000-8000-000000000004"}'::jsonb),
    ('print'::text, 'billing'::text,
      '{"kind":"uuid","value":"983c0000-0000-4000-8000-000000000003"}'::jsonb),
    ('sign'::text, 'professional_service'::text,
      '{"kind":"uuid","value":"983c0000-0000-4000-8000-000000000001"}'::jsonb)$$,
  'actual therapy, staff, billing and transport audit writers map to safe exact categories'
);

select results_eq(
  $$select item -> 'record_id', item ->> 'request_id', item ->> 'resource_category'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'audit_events') item
    where item ->> 'action' = 'integration'$$,
  $$values (
    '{"kind":"uuid","value":"98371000-0000-4000-8000-000000000001"}'::jsonb,
    '983a0000-0000-4000-8000-000000000001'::text,
    'notification'::text
  )$$,
  'known UUID-PK audit resources expose only canonical UUID identifiers and categories'
);

select results_eq(
  $$select item -> 'record_id', item ->> 'resource_category'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'audit_events') item
    where item ->> 'action' = 'insert'
      and item ->> 'resource_category' = 'import'$$,
  $$values ('{"kind":"number","value":"123"}'::jsonb, 'import'::text)$$,
  'numeric identifiers are exposed only for a known numeric-PK table'
);

select results_eq(
  $$select item -> 'record_id', item ->> 'request_id', item ->> 'resource_category'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'audit_events') item
    where item ->> 'action' = 'update'
    order by item ->> 'occurred_at' desc, (item ->> 'audit_event_id')::bigint desc limit 1$$,
  $$values ('null'::jsonb, null::text, 'other'::text)$$,
  'phone-like numeric row keys and arbitrary request IDs from unknown tables are fully redacted'
);

select results_eq(
  $$select item -> 'record_id', item ->> 'request_id'
    from page83_snapshot_result snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'audit_events') item
    where item ->> 'action' = 'delete'$$,
  $$values ('null'::jsonb, null::text)$$,
  'a numeric-looking key is still redacted for a UUID-PK allowlisted table'
);

select results_eq(
  $$select
      snapshot_json::jsonb ->> 'inventory_matching_total',
      snapshot_json::jsonb ->> 'signal_matching_total',
      (snapshot_json::jsonb #>> '{filters,integration_key}')
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'claims', 'all', 'all', 'all'
    )$$,
  $$values ('1'::text, '2'::text, 'claims'::text)$$,
  'integration filter returns one inventory source and its complete signal total'
);

select results_eq(
  $$select
      snapshot_json::jsonb ->> 'inventory_matching_total',
      bool_and(item ->> 'activity_state' = 'attention')
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'all', 'attention', 'all', 'all'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'inventory') item
    group by snapshot.snapshot_json$$,
  $$values ('4'::text, true)$$,
  'activity-state filter keeps the four sources with actual attention evidence'
);

select results_eq(
  $$select
      snapshot_json::jsonb ->> 'inventory_matching_total',
      snapshot_json::jsonb ->> 'signal_matching_total',
      snapshot_json::jsonb ->> 'audit_matching_total'
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'all', 'all', 'all', 'all', null,
      '983a0000-0000-4000-8000-000000000001'
    )$$,
  $$values ('7'::text, '0'::text, '1'::text)$$,
  'correlation searches only true source correlation IDs and exact audit request/idempotency UUIDs'
);

select results_eq(
  $$select snapshot_json::jsonb ->> 'inventory_matching_total',
      snapshot_json::jsonb ->> 'signal_matching_total',
      item ->> 'integration_key', item ->> 'signal_id', item ->> 'correlation_id'
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'all', 'all', 'all', 'all', null,
      '98361000-0000-4000-8000-000000000002'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'signals') item$$,
  $$values (
    '7'::text, '1'::text, 'central_html_import'::text,
    '98360000-0000-4000-8000-000000000002'::text,
    '98361000-0000-4000-8000-000000000002'::text
  )$$,
  'persisted import idempotency UUID is an exact safe correlation hit'
);

select results_eq(
  $$select snapshot_json::jsonb ->> 'signal_matching_total',
      jsonb_array_length(snapshot_json::jsonb -> 'signals')::text
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'all', 'all', 'all', 'all', null,
      '983a0000-0000-4000-8000-000000000099'
    )$$,
  $$values ('0'::text, '0'::text)$$,
  'unrelated correlation UUID returns exact zero signals rather than a widened match'
);

select results_eq(
  $$select snapshot_json::jsonb ->> 'audit_matching_total',
      jsonb_array_length(snapshot_json::jsonb -> 'audit_events')::text
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'all', 'all', 'integration', 'notification',
      '98300000-0000-4000-8000-000000000001', null
    )$$,
  $$values ('1'::text, '1'::text)$$,
  'audit action, resource and actor filters compose exactly'
);

select results_eq(
  $$select snapshot_json::jsonb ->> 'audit_matching_total',
      item ->> 'resource_category', item -> 'record_id'
    from public.integrations_audit_snapshot(
      '98310000-0000-4000-8000-000000000001',
      '98320000-0000-4000-8000-000000000001', current_date, current_date,
      'all', 'all', 'insert', 'client'
    ) snapshot
    cross join lateral jsonb_array_elements(snapshot.snapshot_json::jsonb -> 'audit_events') item$$,
  $$values (
    '1'::text, 'client'::text,
    '{"kind":"uuid","value":"983b0000-0000-4000-8000-000000000001"}'::jsonb
  )$$,
  'canonical public.clients audit trigger names map to client and preserve only its UUID PK'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_events event
    where event.table_name = 'integrations_audit_snapshot'
      and event.organization_id = '98310000-0000-4000-8000-000000000001'
      and event.branch_id = '98320000-0000-4000-8000-000000000001'
  ),
  8,
  'each successful Page83 read appends exactly one audit event and rejected reads append none'
);

select ok(
  not exists (
    select 1
    from public.audit_events event
    where event.table_name = 'integrations_audit_snapshot'
      and (
        event.changed_fields <> '{}'::text[]
        or event.metadata::text like any (array[
          '%983a0000-0000-4000-8000-000000000001%',
          '%98300000-0000-4000-8000-000000000001%',
          '%2026-%'
        ])
      )
  ),
  'Page83 read audits record filter presence and counts without filter values or row content'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      (select snapshot_json::jsonb -> 'audit_events' from page83_snapshot_result)
    ) item
    where item ? 'table_name'
      or item ? 'row_pk'
      or item ? 'changed_fields'
      or item ? 'metadata'
  ),
  'audit projection never forwards raw table, row, changed-field, or metadata columns'
);

select ok(
  (
    select snapshot_json::jsonb #>> '{bounds,max_date_window_days}' = '90'
      and snapshot_json::jsonb #>> '{bounds,max_signal_rows}' = '100'
      and snapshot_json::jsonb #>> '{bounds,max_audit_rows}' = '200'
      and snapshot_json::jsonb #>> '{bounds,max_snapshot_bytes}' = '1048576'
      and octet_length(convert_to(snapshot_json, 'UTF8')) <= 1048576
    from page83_snapshot_result
  ),
  'snapshot publishes and obeys its date, row and byte bounds'
);

select * from finish();
rollback;
