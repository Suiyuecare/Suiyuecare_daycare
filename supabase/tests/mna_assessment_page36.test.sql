begin;

select plan(39);

select is(
  (select count(*) from public.permissions where permission_key in (
    'mna_assessments.read', 'mna_assessments.manage', 'mna_assessments.sign'
  )), 3::bigint,
  'page 36 has separate read manage and sign permissions'
);

select ok(
  exists (
    select 1 from public.role_permissions rp
    join public.roles role on role.id = rp.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where role.role_key = 'professional'
      and permission.permission_key = 'mna_assessments.manage'
  ) and exists (
    select 1 from public.role_permissions rp
    join public.roles role on role.id = rp.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where role.role_key = 'branch_supervisor'
      and permission.permission_key = 'mna_assessments.read'
  ) and not exists (
    select 1 from public.role_permissions rp
    join public.roles role on role.id = rp.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where role.role_key <> 'professional'
      and permission.permission_key in (
        'mna_assessments.manage', 'mna_assessments.sign'
      )
  ),
  'oversight roles read while only professional templates manage or sign'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
    'public.mna_assessment_versions'::regclass,
    'private.mna_assessment_operations'::regclass
  )),
  'formal result and operation tables force RLS'
);

select ok(
  not has_table_privilege('authenticated',
    'public.mna_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'public.mna_assessment_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated',
    'private.mna_assessment_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role',
    'private.mna_assessment_operations', 'select,insert,update,delete'),
  'browser and service roles have no direct table privileges'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_mna_assessment_draft(uuid,uuid,uuid,date,text,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.revise_mna_assessment_draft(uuid,uuid,uuid,uuid,uuid,integer,date,text,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.sign_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.correct_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)',
    'execute')
  and has_function_privilege('authenticated',
    'public.mna_assessment_snapshot(uuid,uuid,uuid,text,text)', 'execute')
  and not has_function_privilege('service_role',
    'public.sign_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,uuid)',
    'execute'),
  'authenticated callers have only the exact public RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.create_mna_assessment_draft(uuid,uuid,uuid,date,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.correct_mna_assessment(uuid,uuid,uuid,uuid,uuid,integer,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.mna_assessment_snapshot(uuid,uuid,uuid,text,text)'::regprocedure),
  'public wrappers are SECURITY INVOKER'
);

select ok(
  (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.register_blocked_mna_operation(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
   from pg_proc where oid =
    'private.mna_snapshot_response(uuid,uuid,uuid,text,text)'::regprocedure)
  and not has_function_privilege('public',
    'private.register_blocked_mna_operation(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)',
    'execute'),
  'private guarded cores are pinned and not executable by PUBLIC'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'mna_assessment_versions_append_only',
    'mna_assessment_operations_append_only'
  )), 2::bigint,
  'formal result and operation ledgers are append-only'
);

select is(
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
    'mna_assessment_versions_audit_row_change',
    'mna_assessment_operations_audit_row_change'
  )), 2::bigint,
  'both ledgers have exact audit triggers'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'mna_assessment_versions'
     and column_name in (
       'answers', 'question_items', 'answer_options', 'scoring_formula',
       'official_translation'
     )), 0::bigint,
  'migration embeds no questionnaire items options formula or translation'
);

select ok(
  position('mna-electronic-license-gate-v1' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conname = 'mna_assessment_governance_check'))) > 0
  and position('<>' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conname = 'mna_assessment_governance_check'))) > 0,
  'unconfigured gate version cannot masquerade as an activated form version'
);

select ok(
  position('correction_reason_hash' in pg_get_functiondef(
    'private.register_blocked_mna_operation(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)) > 0
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mna_assessment_operations'
      and column_name = 'correction_reason'
  ),
  'blocked operation ledger hashes but never stores correction narrative'
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('13003600-0000-4000-8000-000000000001', 'authenticated',
   'authenticated', 'mna-page36@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('13103600-0000-4000-8000-000000000001', 'mna_page36', 'MNA 合成測試機構');

insert into public.branches (id, organization_id, code, name) values
  ('13203600-0000-4000-8000-000000000001', '13103600-0000-4000-8000-000000000001', 'main', '合成主分支'),
  ('13203600-0000-4000-8000-000000000002', '13103600-0000-4000-8000-000000000001', 'other', '合成其他分支');

insert into public.profiles (id, display_name, kind) values
  ('13003600-0000-4000-8000-000000000001', '合成 MNA 專業人員', 'professional');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values (
  '13303600-0000-4000-8000-000000000001',
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13003600-0000-4000-8000-000000000001', 'active'
);

insert into public.membership_roles (membership_id, role_id) values
  ('13303600-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000007');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('13403600-0000-4000-8000-000000000001', '13103600-0000-4000-8000-000000000001', '13203600-0000-4000-8000-000000000001', 'mna-1', '合成指派個案甲', 'active', current_date - 100, null),
  ('13403600-0000-4000-8000-000000000002', '13103600-0000-4000-8000-000000000001', '13203600-0000-4000-8000-000000000001', 'mna-2', '合成指派個案乙', 'suspended', current_date - 80, null),
  ('13403600-0000-4000-8000-000000000003', '13103600-0000-4000-8000-000000000001', '13203600-0000-4000-8000-000000000001', 'mna-3', '合成未指派個案', 'active', current_date - 60, null),
  ('13403600-0000-4000-8000-000000000004', '13103600-0000-4000-8000-000000000001', '13203600-0000-4000-8000-000000000002', 'mna-4', '合成其他分支個案', 'active', current_date - 40, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id,
  assignment_kind
) values
  ('13503600-0000-4000-8000-000000000001', '13103600-0000-4000-8000-000000000001', '13203600-0000-4000-8000-000000000001', '13403600-0000-4000-8000-000000000001', '13003600-0000-4000-8000-000000000001', 'mna-assessment'),
  ('13503600-0000-4000-8000-000000000002', '13103600-0000-4000-8000-000000000001', '13203600-0000-4000-8000-000000000001', '13403600-0000-4000-8000-000000000002', '13003600-0000-4000-8000-000000000001', 'mna-assessment');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '13603600-0000-4000-8000-000000000001',
  '13003600-0000-4000-8000-000000000001',
  '13613600-0000-4000-8000-000000000001', repeat('3', 64),
  '13623600-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() + interval '6 minutes',
  clock_timestamp() - interval '30 seconds',
  clock_timestamp() - interval '30 seconds',
  'totp', clock_timestamp() - interval '30 seconds'
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '13003600-0000-4000-8000-000000000001',
  '13613600-0000-4000-8000-000000000001',
  '13603600-0000-4000-8000-000000000001', 'aal2', 'totp',
  (select factor_verified_at from private.reauth_challenges
   where id = '13603600-0000-4000-8000-000000000001')
);

create temporary table mna_operation_result as
select null::uuid operation_id, null::text action, null::uuid client_id,
  null::uuid actor_user_id, null::uuid idempotency_key, null::text status,
  false::boolean replayed with no data;
create temporary table mna_snapshot_result as
select * from public.mna_assessment_snapshot(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001') with no data;
grant select, insert, delete on mna_operation_result, mna_snapshot_result
  to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"13003600-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"13613600-0000-4000-8000-000000000001"}', true);

select throws_ok($$select * from public.mna_assessment_snapshot(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001')$$,
  '42501', 'MNA snapshot is not permitted',
  'AAL1 read fails closed'
);

select set_config('request.jwt.claims',
  '{"sub":"13003600-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"13613600-0000-4000-8000-000000000099"}', true);

select throws_ok($$select * from public.mna_assessment_snapshot(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000002')$$,
  '42501', 'MNA snapshot is not permitted',
  'cross-branch read fails closed'
);

select throws_ok($$select * from public.create_mna_assessment_draft(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000003', current_date,
  'mna_sf', 'mna-electronic-license-gate-v1',
  '13703600-0000-4000-8000-000000000001')$$,
  '42501', 'MNA operation is not permitted',
  'unassigned client write fails closed'
);

select throws_ok($$select * from public.create_mna_assessment_draft(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000001', current_date,
  'mna_sf', 'mna-electronic-license-gate-v1',
  '13703600-0000-4000-8000-000000000002')$$,
  '42501', 'MNA operation is not permitted',
  'AAL2 without same-session recent evidence cannot write'
);

select set_config('request.jwt.claims',
  '{"sub":"13003600-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"13613600-0000-4000-8000-000000000001"}', true);

insert into mna_operation_result
select * from public.create_mna_assessment_draft(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000001', current_date,
  'mna_sf', 'mna-electronic-license-gate-v1',
  '13703600-0000-4000-8000-000000000010');

select ok(
  (select not replayed and action = 'create_draft'
      and client_id = '13403600-0000-4000-8000-000000000001'
      and actor_user_id = '13003600-0000-4000-8000-000000000001'
      and idempotency_key = '13703600-0000-4000-8000-000000000010'
      and status = 'blocked_license_not_configured'
   from mna_operation_result),
  'valid request commits only a strict blocked receipt'
);

reset role;

select is((select count(*) from public.mna_assessment_versions), 0::bigint,
  'blocked request creates no assessment version');

select ok(
  (select replayed and operation_id =
      (select operation_id from mna_operation_result limit 1)
   from public.create_mna_assessment_draft(
    '13103600-0000-4000-8000-000000000001',
    '13203600-0000-4000-8000-000000000001',
    '13403600-0000-4000-8000-000000000001', current_date,
    'mna_sf', 'mna-electronic-license-gate-v1',
    '13703600-0000-4000-8000-000000000010')),
  'exact actor-scoped idempotent replay returns the original blocked receipt'
);

select throws_ok($$select * from public.create_mna_assessment_draft(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000001', current_date - 1,
  'mna_sf', 'mna-electronic-license-gate-v1',
  '13703600-0000-4000-8000-000000000010')$$,
  '23505', 'MNA idempotency key was used for different content',
  'same key with changed content conflicts'
);

delete from mna_operation_result;
insert into mna_operation_result
select * from public.revise_mna_assessment_draft(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000001',
  '13803600-0000-4000-8000-000000000001',
  '13903600-0000-4000-8000-000000000001', 1, current_date,
  'full_mna', 'mna-electronic-license-gate-v1',
  '13703600-0000-4000-8000-000000000011');

select ok(
  (select action = 'revise_draft' and status =
    'blocked_license_not_configured' from mna_operation_result),
  'revision boundary remains idempotently blocked'
);

delete from mna_operation_result;
insert into mna_operation_result
select * from public.sign_mna_assessment(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000001',
  '13803600-0000-4000-8000-000000000001',
  '13903600-0000-4000-8000-000000000001', 1,
  '13703600-0000-4000-8000-000000000012');

select ok(
  (select action = 'sign' and status =
    'blocked_license_not_configured' from mna_operation_result),
  'sign boundary remains idempotently blocked'
);

delete from mna_operation_result;
insert into mna_operation_result
select * from public.correct_mna_assessment(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000001',
  '13803600-0000-4000-8000-000000000001',
  '13903600-0000-4000-8000-000000000001', 1,
  '合成測試：正式授權前不得建立更正版。',
  '13703600-0000-4000-8000-000000000013');

select ok(
  (select action = 'correct' and status =
    'blocked_license_not_configured' from mna_operation_result),
  'correction boundary remains idempotently blocked'
);

reset role;

select is((select count(*) from public.mna_assessment_versions), 0::bigint,
  'all four formal boundaries leave version count at zero');

select is((select count(*) from private.mna_assessment_operations), 4::bigint,
  'four unique attempts persist as immutable blocked receipts');

select throws_ok($$update private.mna_assessment_operations
  set status = 'changed' where action = 'sign'$$,
  '55000', 'MNA assessment history is append-only',
  'blocked operation receipts cannot be updated'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"13003600-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"13613600-0000-4000-8000-000000000001"}', true);

insert into mna_snapshot_result
select * from public.mna_assessment_snapshot(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001');

select ok(
  (select item_total = 2 and matching_total = 2
      and not_assessed_total = 2 and normal_total = 0
      and at_risk_total = 0 and malnourished_total = 0
      and follow_up_pending_total = 0
   from mna_snapshot_result),
  'snapshot counts the complete assigned-client set before bounding'
);

select ok(
  (select jsonb_array_length(items) = 2
      and not exists (
        select 1 from jsonb_array_elements(items) item
        where item -> 'version_id' <> 'null'::jsonb
           or item -> 'short_form_score' <> 'null'::jsonb
           or item -> 'full_score' <> 'null'::jsonb
      )
   from mna_snapshot_result),
  'formal snapshot returns no score or result while license is absent'
);

select ok(
  (select license_status = 'license_required_not_configured'
      and questionnaire_content_status = 'not_configured'
      and scoring_algorithm_status = 'not_configured'
      and risk_classification_status = 'not_configured'
      and formal_draft_status = 'blocked_license_not_configured'
      and formal_sign_status = 'blocked_license_not_configured'
      and formal_correction_status = 'blocked_license_not_configured'
   from mna_snapshot_result),
  'snapshot distinguishes license state from no assessment data'
);

select is(
  (select matching_total from public.mna_assessment_snapshot(
    '13103600-0000-4000-8000-000000000001',
    '13203600-0000-4000-8000-000000000001', null, 'normal', 'all')),
  0::bigint,
  'formal risk filter returns zero rather than fabricated classifications'
);

select is(
  (select matching_total from public.mna_assessment_snapshot(
    '13103600-0000-4000-8000-000000000001',
    '13203600-0000-4000-8000-000000000001',
    '13403600-0000-4000-8000-000000000001', 'all', 'all')),
  1::bigint,
  'exact assigned-client filter returns only that client'
);

select throws_ok($$select * from public.mna_assessment_snapshot(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001', null, 'invented', 'all')$$,
  '42501', 'MNA snapshot is not permitted',
  'unknown database filter fails closed'
);

select throws_ok($$select * from public.mna_assessment_snapshot(
  '13103600-0000-4000-8000-000000000001',
  '13203600-0000-4000-8000-000000000001',
  '13403600-0000-4000-8000-000000000003', 'all', 'all')$$,
  '42501', 'MNA client filter is not permitted',
  'unassigned client filter fails closed'
);

reset role;

select ok(
  exists (select 1 from public.audit_events
    where table_name = 'private.mna_assessment_operations'
      and action = 'insert')
  and exists (select 1 from public.audit_events
    where table_name = 'mna_assessment_versions'
      and action = 'select'),
  'blocked writes and reads are audited'
);

select ok(
  not exists (
    select 1 from public.audit_events
    where table_name in (
      'private.mna_assessment_operations', 'mna_assessment_versions'
    ) and metadata::text ~ '(合成測試|correction_reason|display_name|score)'
  ),
  'audit metadata contains no narrative search text or clinical values'
);

select ok(
  (select changed_fields @> array['request_hash']
      and changed_fields @> array['idempotency_key']
   from public.audit_events
   where table_name = 'private.mna_assessment_operations'
   order by occurred_at desc limit 1),
  'audit records changed field names without values'
);

select is(
  (select count(*) from pg_constraint constraint_row
   join pg_class relation on relation.oid = constraint_row.conrelid
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname = 'mna_assessment_versions'
     and constraint_row.contype = 'f'),
  6::bigint,
  'formal ledger fixes tenant client author signature and chain references'
);

select ok(
  position('v_after is distinct from v_bundle' in pg_get_functiondef(
    'private.mna_snapshot_response(uuid,uuid,uuid,text,text)'::regprocedure)) > 0
  and position('private.has_recent_aal2(15)' in pg_get_functiondef(
    'private.register_blocked_mna_operation(text,uuid,uuid,uuid,uuid,uuid,integer,date,text,text,text,uuid)'::regprocedure)) > 0,
  'snapshot rechecks authority and writes require recent AAL2'
);

select ok(
  obj_description('public.mna_assessment_versions'::regclass, 'pg_class')
    ilike '%No row can be created%'
  and col_description('public.mna_assessment_versions'::regclass,
    (select attnum from pg_attribute
     where attrelid = 'public.mna_assessment_versions'::regclass
       and attname = 'governance_snapshot'))
    ilike '%not installed%',
  'schema comments disclose the unlicensed boundary'
);

select * from finish();
rollback;
