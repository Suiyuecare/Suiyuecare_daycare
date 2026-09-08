begin;

select plan(38);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.individual_service_plans'::regclass),
  'monthly plans use forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.individual_service_plan_operations'::regclass),
  'actor replay ledger uses forced RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.individual_service_plans', 'select')
  and not has_table_privilege('authenticated', 'public.individual_service_plans', 'insert')
  and not has_table_privilege('service_role', 'public.individual_service_plans', 'select'),
  'authenticated and service roles have no direct plan table access'
);
select ok(
  not has_table_privilege('authenticated', 'private.individual_service_plan_operations', 'select')
  and not has_table_privilege('service_role', 'private.individual_service_plan_operations', 'select'),
  'replay receipts have no direct authenticated or service access'
);
select ok(
  has_function_privilege('authenticated', 'public.record_individual_service_plan(uuid,uuid,uuid,date,uuid,text,jsonb,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.record_individual_service_plan(uuid,uuid,uuid,date,uuid,text,jsonb,uuid)', 'execute')
  and not (select prosecdef from pg_proc where oid = 'public.record_individual_service_plan(uuid,uuid,uuid,date,uuid,text,jsonb,uuid)'::regprocedure),
  'public writer is authenticated-only SECURITY INVOKER'
);
select ok(
  has_function_privilege('authenticated', 'public.individual_service_plan_snapshot(uuid,uuid,date)', 'execute')
  and not has_function_privilege('anon', 'public.individual_service_plan_snapshot(uuid,uuid,date)', 'execute'),
  'minimal month snapshot is authenticated-only'
);
select ok(
  has_function_privilege('authenticated', 'public.individual_service_plan_responsibles(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.individual_service_plan_responsibles(uuid,uuid)', 'execute'),
  'responsible-person snapshot is authenticated-only'
);
select ok(
  pg_get_function_arguments('public.record_individual_service_plan(uuid,uuid,uuid,date,uuid,text,jsonb,uuid)'::regprocedure)
    !~ '(actor|signed|signature|hash|plan_key|version)',
  'caller cannot supply actor, signing evidence, hash, plan key or version'
);
select ok(
  pg_get_function_result('public.individual_service_plan_snapshot(uuid,uuid,date)'::regprocedure)
    !~ '(signed_by|challenge|content_hash|plan_key|created_by)',
  'month snapshot omits signing evidence, hashes and internal lineage key'
);
select ok(
  position('monthly plan snapshot authority expired after audit' in pg_get_functiondef(
    'private.individual_service_plan_snapshot_core(uuid,uuid,date)'::regprocedure
  )) > 0,
  'month snapshot performs a final post-audit authority recheck'
);
select ok(
  position('v_plan_ids is distinct from' in pg_get_functiondef(
    'private.individual_service_plan_snapshot_core(uuid,uuid,date)'::regprocedure
  )) > 0,
  'month snapshot rechecks the exact buffered plan-id set, not only its count'
);
select ok(
  position('responsible staff snapshot authority expired after audit' in pg_get_functiondef(
    'private.individual_service_plan_responsibles_core(uuid,uuid)'::regprocedure
  )) > 0,
  'responsible snapshot performs a final post-audit authority recheck'
);
select is(
  (select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
    'individual_service_plans_validate_chain',
    'individual_service_plans_prevent_mutation',
    'individual_service_plan_operations_prevent_mutation',
    'individual_service_plans_audit_row_change',
    'individual_service_plan_operations_audit_insert'
  )),
  5,
  'chain, immutability and audit triggers are installed'
);
select ok(
  private.individual_service_plan_items_valid(jsonb_build_array(jsonb_build_object(
    'item_order', 1, 'goal', '維持活動', 'activity', '團體活動',
    'frequency', '每週二次', 'responsible_user_id', '91000000-0000-4000-8000-000000000004',
    'responsible_display_name', '測試負責人', 'progress_status', 'not_started',
    'progress_note', null
  ))),
  'frozen item validator accepts the explicit governed shape'
);
select ok(
  not private.individual_service_plan_items_valid(jsonb_build_array(jsonb_build_object(
    'item_order', 2, 'goal', '錯誤順序', 'activity', '活動', 'frequency', '每週',
    'responsible_user_id', '91000000-0000-4000-8000-000000000004',
    'responsible_display_name', '測試負責人', 'progress_status', 'completed',
    'progress_note', null
  ))),
  'frozen item validator rejects non-contiguous order'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'plan-writer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'plan-unassigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-8000-000000000000', '91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'plan-reader@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'plan-responsible@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.organizations (id, code, name) values
  ('91100000-0000-4000-8000-000000000001', 'plan_org_a', '計畫測試機構 A'),
  ('91100000-0000-4000-8000-000000000002', 'plan_org_b', '計畫測試機構 B');
insert into public.branches (id, organization_id, code, name) values
  ('91200000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('91200000-0000-4000-8000-000000000002', '91100000-0000-4000-8000-000000000001', 'second', 'A 第二分支'),
  ('91200000-0000-4000-8000-000000000003', '91100000-0000-4000-8000-000000000002', 'main', 'B 主分支');
insert into public.profiles (id, display_name, kind) values
  ('91000000-0000-4000-8000-000000000001', '計畫寫入護理師', 'staff'),
  ('91000000-0000-4000-8000-000000000002', '未指派護理師', 'staff'),
  ('91000000-0000-4000-8000-000000000003', '計畫唯讀照服員', 'staff'),
  ('91000000-0000-4000-8000-000000000004', '計畫負責社工', 'professional');
insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('91300000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'active'),
  ('91300000-0000-4000-8000-000000000002', '91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'active'),
  ('91300000-0000-4000-8000-000000000003', '91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000003', 'active'),
  ('91300000-0000-4000-8000-000000000004', '91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004', 'active');
insert into public.membership_roles (membership_id, role_id) values
  ('91300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'),
  ('91300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005'),
  ('91300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006'),
  ('91300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000007');
insert into public.clients (id, organization_id, branch_id, client_code, display_name, status, admitted_on, source_system) values
  ('91400000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', 'PLAN-A-001', '計畫個案一', 'active', '2020-01-01', 'test'),
  ('91400000-0000-4000-8000-000000000002', '91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002', 'PLAN-A2-001', '他分支個案', 'active', '2020-01-01', 'test'),
  ('91400000-0000-4000-8000-000000000003', '91100000-0000-4000-8000-000000000002', '91200000-0000-4000-8000-000000000003', 'PLAN-B-001', '他機構個案', 'active', '2020-01-01', 'test');
insert into public.client_assignments (organization_id, branch_id, client_id, assignee_user_id, assignment_kind) values
  ('91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91400000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'nurse'),
  ('91100000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001', '91400000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000003', 'care');

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  created_at, expires_at, consumed_at, consumed_jwt_iat, factor_method, factor_verified_at
) values
  ('91500000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000001', repeat('1',64), '91700000-0000-4000-8000-000000000001', now()-interval '2 minutes', now()-interval '1 minute', now()+interval '4 minutes', now()-interval '30 seconds', now()-interval '30 seconds', 'totp', now()-interval '30 seconds'),
  ('91500000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '91600000-0000-4000-8000-000000000002', repeat('2',64), '91700000-0000-4000-8000-000000000002', now()-interval '2 minutes', now()-interval '1 minute', now()+interval '4 minutes', now()-interval '30 seconds', now()-interval '30 seconds', 'totp', now()-interval '30 seconds');
insert into private.reauth_events (user_id, session_id, challenge_id, aal, verification_method, verified_at) values
  ('91000000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000001', '91500000-0000-4000-8000-000000000001', 'aal2', 'totp', now()-interval '30 seconds'),
  ('91000000-0000-4000-8000-000000000002', '91600000-0000-4000-8000-000000000002', '91500000-0000-4000-8000-000000000002', 'aal2', 'totp', now()-interval '30 seconds');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"91600000-0000-4000-8000-000000000001"}', true);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"目標","activity":"活動","frequency":"每週","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000001')$$,
  '42501', 'monthly plan write is not permitted', 'AAL1 cannot sign a monthly plan'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"91600000-0000-4000-8000-000000000002"}', true);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"目標","activity":"活動","frequency":"每週","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000002')$$,
  '42501', 'client is outside monthly plan scope', 'unassigned writer cannot sign for a client'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"91600000-0000-4000-8000-000000000001"}', true);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000002','91400000-0000-4000-8000-000000000002','2026-09-01',null,null,'[]','91800000-0000-4000-8000-000000000003')$$,
  '42501', 'monthly plan write is not permitted', 'cross-branch request is rejected before content parsing'
);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-02',null,null,'[]','91800000-0000-4000-8000-000000000004')$$,
  '22023', 'valid monthly plan fields are required', 'plan month must be the first day'
);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"目標","activity":"活動","frequency":"每週","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null,"extra":"no"}]','91800000-0000-4000-8000-000000000005')$$,
  '22023', 'invalid monthly plan item shape', 'unknown item fields fail closed'
);

select results_eq(
  $$select plan_month, plan_version, previous_plan_id, replayed from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":" 維持活動 ","activity":" 團體活動 ","frequency":" 每週二次 ","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000010')$$,
  $$values ('2026-09-01'::date,1::integer,null::uuid,false)$$,
  'authorized write creates immutable version one'
);

reset role;
select results_eq(
  $$select status collate "C", signed_by, created_by, signature_purpose collate "C", signature_reauth_challenge_id, content_hash ~ '^[a-f0-9]{64}$', plan_items->0->>'responsible_display_name'
    from public.individual_service_plans where client_id='91400000-0000-4000-8000-000000000001' and plan_version=1$$,
  $$values ('signed'::text collate "C",'91000000-0000-4000-8000-000000000001'::uuid,'91000000-0000-4000-8000-000000000001'::uuid,'個別化服務計畫簽署'::text collate "C",'91500000-0000-4000-8000-000000000001'::uuid,true,'計畫負責社工'::text)$$,
  'server freezes actor, immutable AAL2 evidence, purpose, hash and responsible name'
);
create temporary table page10_test_plan_ids as
select id, plan_version
from public.individual_service_plans
where client_id='91400000-0000-4000-8000-000000000001';
grant select on page10_test_plan_ids to authenticated;
update public.profiles set is_active=false where id='91000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"91600000-0000-4000-8000-000000000001"}', true);
select results_eq(
  $$select plan_version,replayed from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"維持活動","activity":"團體活動","frequency":"每週二次","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000010')$$,
  $$values (1::integer,true)$$,
  'exact replay survives later responsible deactivation without reinterpreting history'
);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-10-01',null,null,
    '[{"goal":"目標","activity":"活動","frequency":"每週","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000011')$$,
  '42501', 'responsible user is outside active branch scope', 'new writes reject an inactive responsible person'
);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"內容不同","activity":"團體活動","frequency":"每週二次","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000010')$$,
  '23505', 'monthly plan idempotency conflict', 'actor-scoped operation key rejects changed content'
);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"91600000-0000-4000-8000-000000000099"}', true);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"維持活動","activity":"團體活動","frequency":"每週二次","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"not_started","progress_note":null}]','91800000-0000-4000-8000-000000000010')$$,
  '42501', 'recent AAL2 evidence is required', 'exact replay still requires fresh same-session AAL2'
);

reset role;
update public.profiles set is_active=true where id='91000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"91600000-0000-4000-8000-000000000001"}', true);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',null,null,
    '[{"goal":"新版","activity":"活動","frequency":"每週","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"in_progress","progress_note":null}]','91800000-0000-4000-8000-000000000012')$$,
  '23514', 'correction must extend the latest monthly plan', 'an existing month cannot be overwritten as another first version'
);
select results_eq(
  $$select plan_version,replayed from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',
    (select id from page10_test_plan_ids where plan_version=1),'進度更新',
    '[{"goal":"維持活動","activity":"團體活動","frequency":"每週二次","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"in_progress","progress_note":"已執行"}]','91800000-0000-4000-8000-000000000013')$$,
  $$values (2::integer,false)$$,
  'a correction appends version two'
);
select is(
  (select count(*)::integer from public.individual_service_plan_snapshot('91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','2026-09-01') where plan_version=2),
  1,
  'snapshot returns only the latest month version'
);
select throws_ok(
  $$select * from public.record_individual_service_plan(
    '91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','91400000-0000-4000-8000-000000000001','2026-09-01',
    (select id from page10_test_plan_ids where plan_version=1),'分支舊版',
    '[{"goal":"錯誤分支","activity":"活動","frequency":"每週","responsible_user_id":"91000000-0000-4000-8000-000000000004","progress_status":"completed","progress_note":null}]','91800000-0000-4000-8000-000000000014')$$,
  '23514', 'correction must extend the latest monthly plan', 'an old version cannot branch after a newer version exists'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select is(
  (select plan_version from public.individual_service_plan_snapshot('91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001','2026-09-01')),
  2,
  'assigned read-only staff can read the latest authorized projection'
);
select throws_ok(
  $$select * from public.individual_service_plan_responsibles('91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000001')$$,
  '42501', 'responsible staff snapshot is not permitted', 'read-only staff cannot enumerate write candidates'
);
select throws_ok(
  $$select * from public.individual_service_plan_snapshot('91100000-0000-4000-8000-000000000001','91200000-0000-4000-8000-000000000002','2026-09-01')$$,
  '42501', 'monthly plan snapshot is not permitted', 'cross-branch month snapshot is denied'
);
select throws_ok(
  $$select * from public.individual_service_plans$$,
  '42501', null, 'authenticated direct plan reads are denied'
);

reset role;
select throws_ok(
  $$update public.individual_service_plans set correction_reason='rewrite' where client_id='91400000-0000-4000-8000-000000000001'$$,
  '55000', 'signed individual service plans and replay receipts are immutable', 'owner-level trigger blocks signed plan updates'
);
select throws_ok(
  $$delete from public.individual_service_plans where client_id='91400000-0000-4000-8000-000000000001'$$,
  '55000', 'signed individual service plans and replay receipts are immutable', 'owner-level trigger blocks signed plan deletes'
);
select ok(
  exists (select 1 from public.audit_events where table_name='individual_service_plans' and action='select' and metadata ? 'result_count')
  and not exists (select 1 from public.audit_events where table_name='individual_service_plans' and metadata::text ~ '(目標|團體活動|計畫個案)'),
  'read audit records counts without plan contents or names'
);
select is(
  (select count(*)::integer from private.individual_service_plan_operations where actor_user_id='91000000-0000-4000-8000-000000000001'),
  2,
  'exact replay and rejected branches create no duplicate receipts'
);

select * from finish();
rollback;
