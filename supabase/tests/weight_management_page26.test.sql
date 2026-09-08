begin;

select plan(62);

select results_eq(
  $$select role.role_key collate "C" from public.role_permissions grant_row
    join public.roles role on role.id = grant_row.role_id
    join public.permissions permission on permission.id = grant_row.permission_id
    where permission.permission_key = 'quality_rules.manage' and role.is_system
    order by role.role_key collate "C"$$,
  $$values ('branch_supervisor'::text collate "C"), ('nurse'::text collate "C"), ('organization_manager'::text collate "C")$$,
  'threshold governance is narrowly seeded'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.weight_observations'::regclass, 'public.weight_observation_corrections'::regclass,
  'public.weight_threshold_rule_requests'::regclass, 'public.weight_threshold_rule_versions'::regclass,
  'public.weight_alert_acknowledgements'::regclass, 'private.weight_management_operations'::regclass
)), 'all weight tables force RLS');

select ok(
  not has_table_privilege('authenticated', 'public.weight_observations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.weight_observations', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.weight_observation_corrections', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.weight_alert_acknowledgements', 'select,insert,update,delete'),
  'direct data access is denied so reads remain audited snapshots'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.weight_management_snapshot(uuid,uuid,date,uuid,text,text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.record_weight_observation(uuid,uuid,uuid,timestamptz,numeric,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""'] from pg_proc where oid = 'private.weight_management_snapshot_response(uuid,uuid,date,uuid,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""'] from pg_proc where oid = 'private.correct_weight_observation_atomic(uuid,uuid,uuid,uuid,integer,text,numeric,text,uuid)'::regprocedure),
  'public wrappers are invoker and private cores pin search path'
);

select ok(
  has_function_privilege('authenticated', 'public.weight_management_snapshot(uuid,uuid,date,uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'private.weight_management_snapshot_response(uuid,uuid,date,uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.weight_management_snapshot(uuid,uuid,date,uuid,text,text)', 'execute'),
  'only authenticated callers receive wrapper and non-exposed core execution'
);

select ok(
  (
    length(pg_get_functiondef(
      'private.weight_management_snapshot_response(uuid,uuid,date,uuid,text,text)'::regprocedure
    )) - length(replace(pg_get_functiondef(
      'private.weight_management_snapshot_response(uuid,uuid,date,uuid,text,text)'::regprocedure
    ), 'weight management snapshot authority expired', ''))
  ) / length('weight management snapshot authority expired') = 2,
  'snapshot rechecks authority before audit and again before returning data'
);

select ok((select count(*) = 6 from pg_trigger where not tgisinternal and tgname in (
  'weight_observations_audit_row_change', 'weight_observation_corrections_audit_row_change',
  'weight_threshold_rule_requests_audit_row_change', 'weight_threshold_rule_versions_audit_row_change',
  'weight_alert_acknowledgements_audit_row_change', 'weight_operations_audit_row_change'
)), 'all Page-26 tables are mutation audited');

select ok((select count(*) = 4 from pg_trigger where not tgisinternal and tgname in (
  'weight_observations_immutable', 'weight_corrections_immutable',
  'weight_threshold_versions_immutable', 'weight_alert_acks_immutable'
)), 'committed weight history is immutable');

insert into auth.users (id, email, created_at, updated_at) values
  ('26000000-0000-4000-8000-000000000001', 'weight-owner@example.invalid', now(), now()),
  ('26000000-0000-4000-8000-000000000002', 'weight-nurse@example.invalid', now(), now()),
  ('26000000-0000-4000-8000-000000000003', 'weight-worker@example.invalid', now(), now());
insert into public.organizations (id, code, name) values ('26100000-0000-4000-8000-000000000001', 'weight_a', '體重測試機構');
insert into public.branches (id, organization_id, code, name) values ('26200000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000001', 'main', '體重分支');
insert into public.profiles (id, display_name, kind) values
  ('26000000-0000-4000-8000-000000000001', '規則提案主管', 'staff'),
  ('26000000-0000-4000-8000-000000000002', '規則核准護理師', 'staff'),
  ('26000000-0000-4000-8000-000000000003', '量測照服員', 'staff');
insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('26300000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000001', null, '26000000-0000-4000-8000-000000000001', 'active'),
  ('26300000-0000-4000-8000-000000000002', '26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000002', 'active'),
  ('26300000-0000-4000-8000-000000000003', '26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000003', 'active');
insert into public.membership_roles (membership_id, role_id) values
  ('26300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('26300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000005'),
  ('26300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006');
insert into public.clients (id, organization_id, branch_id, client_code, display_name, status, admitted_on) values
  ('26400000-0000-4000-8000-000000000001', '26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', 'W-1', '可比較個案', 'active', date_trunc('month', current_date)::date - interval '2 months'),
  ('26400000-0000-4000-8000-000000000002', '26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', 'W-2', '缺測個案', 'active', date_trunc('month', current_date)::date - interval '2 months'),
  ('26400000-0000-4000-8000-000000000003', '26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', 'W-3', '新收案個案', 'active', date_trunc('month', current_date)::date),
  ('26400000-0000-4000-8000-000000000004', '26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', 'W-4', '未指派個案', 'active', date_trunc('month', current_date)::date - interval '2 months');
insert into public.client_assignments (organization_id, branch_id, client_id, assignee_user_id, assignment_kind) values
  ('26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', '26400000-0000-4000-8000-000000000001', '26000000-0000-4000-8000-000000000003', 'daily'),
  ('26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', '26400000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000003', 'daily'),
  ('26100000-0000-4000-8000-000000000001', '26200000-0000-4000-8000-000000000001', '26400000-0000-4000-8000-000000000003', '26000000-0000-4000-8000-000000000003', 'daily');

create temporary table weight_reauth_time as select clock_timestamp() - interval '30 seconds' verified_at;
insert into private.reauth_challenges (id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat, factor_method, factor_verified_at) values
  ('26600000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001','26610000-0000-4000-8000-000000000001',repeat('1',64),'26620000-0000-4000-8000-000000000001',now()-interval '2 min',now()-interval '1 min',now()+interval '4 min',(select verified_at from weight_reauth_time),(select verified_at from weight_reauth_time),'totp',(select verified_at from weight_reauth_time)),
  ('26600000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000002','26610000-0000-4000-8000-000000000002',repeat('2',64),'26620000-0000-4000-8000-000000000002',now()-interval '2 min',now()-interval '1 min',now()+interval '4 min',(select verified_at from weight_reauth_time),(select verified_at from weight_reauth_time),'totp',(select verified_at from weight_reauth_time)),
  ('26600000-0000-4000-8000-000000000003','26000000-0000-4000-8000-000000000003','26610000-0000-4000-8000-000000000003',repeat('3',64),'26620000-0000-4000-8000-000000000003',now()-interval '2 min',now()-interval '1 min',now()+interval '4 min',(select verified_at from weight_reauth_time),(select verified_at from weight_reauth_time),'totp',(select verified_at from weight_reauth_time));
insert into private.reauth_events (user_id, session_id, challenge_id, aal, verification_method, verified_at) values
  ('26000000-0000-4000-8000-000000000001','26610000-0000-4000-8000-000000000001','26600000-0000-4000-8000-000000000001','aal2','totp',(select verified_at from weight_reauth_time)),
  ('26000000-0000-4000-8000-000000000002','26610000-0000-4000-8000-000000000002','26600000-0000-4000-8000-000000000002','aal2','totp',(select verified_at from weight_reauth_time)),
  ('26000000-0000-4000-8000-000000000003','26610000-0000-4000-8000-000000000003','26600000-0000-4000-8000-000000000003','aal2','totp',(select verified_at from weight_reauth_time));

create temporary table weight_expired_reauth_time as
  select clock_timestamp() - interval '20 minutes' verified_at;
insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values (
  '26600000-0000-4000-8000-000000000004',
  '26000000-0000-4000-8000-000000000003',
  '26610000-0000-4000-8000-000000000004', repeat('4', 64),
  '26620000-0000-4000-8000-000000000004',
  now() - interval '22 minutes', now() - interval '21 minutes',
  now() - interval '16 minutes',
  (select verified_at from weight_expired_reauth_time),
  (select verified_at from weight_expired_reauth_time), 'totp',
  (select verified_at from weight_expired_reauth_time)
);
insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '26000000-0000-4000-8000-000000000003',
  '26610000-0000-4000-8000-000000000004',
  '26600000-0000-4000-8000-000000000004', 'aal2', 'totp',
  (select verified_at from weight_expired_reauth_time)
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000001"}', true);
create temporary table weight_request as select * from public.request_weight_threshold_rule(
  '26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',1.00,2.00,'either',date_trunc('month', current_date)::date,null,'26700000-0000-4000-8000-000000000001');
select is((select status from weight_request), 'pending', 'rule request records requester evidence');
select is((select replayed from public.request_weight_threshold_rule(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001', 1.00, 2.00, 'either',
  date_trunc('month', current_date)::date, null,
  '26700000-0000-4000-8000-000000000001'
)), true, 'threshold request exactly replays for the same actor and content');
select throws_ok($$select * from public.request_weight_threshold_rule(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001', 1.50, 2.00, 'either',
  date_trunc('month', current_date)::date, null,
  '26700000-0000-4000-8000-000000000001'
)$$, '23505', null, 'changed threshold request content conflicts with its actor-scoped key');
select throws_ok($$select * from public.approve_weight_threshold_rule('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',(select request_id from weight_request),'26700000-0000-4000-8000-000000000002')$$, '42501', null, 'requester cannot self approve');

select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000002"}', true);
create temporary table weight_rule as select * from public.approve_weight_threshold_rule('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',(select request_id from weight_request),'26700000-0000-4000-8000-000000000003');
select is((select status from weight_rule), 'approved', 'independent nurse publishes rule');
select is((select version_number from weight_rule), 1, 'first published rule is version one');
select is((select replayed from public.approve_weight_threshold_rule('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',(select request_id from weight_request),'26700000-0000-4000-8000-000000000003')), true, 'approval exactly replays');
select ok(position('cannot begin in a past Taipei month' in pg_get_functiondef('private.approve_weight_threshold_rule_atomic(uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'approval prevents retroactive past-month rule publication');
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000001"}', true);
select throws_ok($$select * from public.approve_weight_threshold_rule('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',(select request_id from weight_request),'26700000-0000-4000-8000-000000000004')$$, '23505', null, 'a different actor cannot replay an approved decision');
create temporary table overlap_request as select * from public.request_weight_threshold_rule('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',3.00,4.00,'both',date_trunc('month', current_date)::date,null,'26700000-0000-4000-8000-000000000005');
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000002"}', true);
select throws_ok($$select * from public.approve_weight_threshold_rule('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',(select request_id from overlap_request),'26700000-0000-4000-8000-000000000006')$$, '23P01', null, 'published threshold periods cannot overlap');

select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000003"}', true);
create temporary table weight_times as select
  (date_trunc('month', current_date)-interval '1 month'+interval '10 days 10 hours') at time zone 'Asia/Taipei' as prior_observed,
  clock_timestamp() - interval '1 hour' as current_observed;
create temporary table prior_result as select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select prior_observed from weight_times),70.00,'人工量測','26800000-0000-4000-8000-000000000001');
create temporary table current_result as select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select current_observed from weight_times),65.00,'人工量測','26800000-0000-4000-8000-000000000002');
select is((select replayed from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select current_observed from weight_times),65.00,'人工量測','26800000-0000-4000-8000-000000000002')), true, 'record exactly replays');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select current_observed from weight_times),66.00,'人工量測','26800000-0000-4000-8000-000000000002')$$, '23505', null, 'changed replay conflicts');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',clock_timestamp()+interval '2 hours',65.00,'人工量測','26800000-0000-4000-8000-000000000003')$$, '23514', null, 'future observation is rejected');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000099','26400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',65.00,'人工量測','26800000-0000-4000-8000-000000000004')$$, '42501', null, 'cross-branch write is denied as scope failure');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000099','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',65.00,'人工量測','26800000-0000-4000-8000-000000000005')$$, '42501', null, 'cross-tenant write is denied as scope failure');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000004',clock_timestamp()-interval '2 hours',65.00,'人工量測','26800000-0000-4000-8000-000000000010')$$, '42501', null, 'unassigned client write is denied by current client scope');
select throws_ok($$select * from public.weight_management_snapshot(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  '26400000-0000-4000-8000-000000000004', 'all', 'all'
)$$, '42501', null, 'unassigned client cannot be selected directly for a read snapshot');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',1000000.00,'人工量測','26800000-0000-4000-8000-000000000006')$$, '22023', null, 'technical numeric overflow is rejected before storage');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',65.001,'人工量測','26800000-0000-4000-8000-000000000007')$$, '22023', null, 'more than two decimal places is rejected');
select throws_ok($$select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',65.00,null,'26800000-0000-4000-8000-000000000008')$$, '22023', null, 'NULL source is rejected explicitly');

select * from public.record_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000002',(date_trunc('month', current_date)-interval '2 months'+interval '10 days') at time zone 'Asia/Taipei',50.00,'歷史量測','26800000-0000-4000-8000-000000000009');
select is((select items->0->>'prior_state' from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,'26400000-0000-4000-8000-000000000002','all','all')), 'missing', 'two-month-old value is not carried into the previous calendar month');

select is((select measured_total from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,null,'all','all')), 1::bigint, 'only valid current observation is measured');
select is((select missing_total from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,null,'all','all')), 2::bigint, 'missing clients remain missing rather than zero');
select is((select items->0->>'delta_kg' from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,'26400000-0000-4000-8000-000000000001','all','all')), '-5.00', 'kg delta is exact and signed');
select is((select items->0->>'delta_percent' from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,'26400000-0000-4000-8000-000000000001','all','all')), '-7.14', 'percentage uses exact prior-month denominator and DB rounding');
select is((select items->0->>'prior_state' from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,'26400000-0000-4000-8000-000000000003','all','all')), 'not_applicable', 'new admission distinguishes prior month not applicable');
select is((select items from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,null,'gain','all')), '[]'::jsonb, 'empty snapshot items are an exact empty array');
select is((select matching_total from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,null,'all','alert')), 1::bigint, 'full filtered alert aggregate matches drill-down');

create temporary table extreme_weight_times as select
  (date_trunc('month', current_date) - interval '1 month' + interval '11 days 10 hours') at time zone 'Asia/Taipei' as prior_observed,
  clock_timestamp() - interval '30 minutes' as current_observed;
select * from public.record_weight_observation(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  '26400000-0000-4000-8000-000000000002',
  (select prior_observed from extreme_weight_times), 0.01, '極端合法基準',
  '26800000-0000-4000-8000-000000000011'
);
select * from public.record_weight_observation(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  '26400000-0000-4000-8000-000000000002',
  (select current_observed from extreme_weight_times), 999999.99, '極端合法本月值',
  '26800000-0000-4000-8000-000000000012'
);
select is((select items->0->>'delta_kg' from public.weight_management_snapshot(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  '26400000-0000-4000-8000-000000000002', 'all', 'all'
)), '999999.98', 'maximum legal kg values retain exact signed difference');
select is((select items->0->>'delta_percent' from public.weight_management_snapshot(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  '26400000-0000-4000-8000-000000000002', 'all', 'all'
)), '9999999800.00', 'extreme legal percentage does not overflow and keeps DB rounding');

select throws_ok($$select * from public.acknowledge_weight_alert(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  '26400000-0000-4000-8000-000000000001',
  (select observation_id from current_result), 0,
  (select observation_id from prior_result), 0,
  (select rule_version_id from weight_rule), null,
  '26900000-0000-4000-8000-000000000010'
)$$, '22023', null, 'NULL acknowledgement note is rejected explicitly');

create temporary table ack_result as select * from public.acknowledge_weight_alert('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,(select observation_id from prior_result),0,(select rule_version_id from weight_rule),'已人工確認月差與後續追蹤','26900000-0000-4000-8000-000000000001');
select isnt((select acknowledgement_id from ack_result), null::uuid, 'alert acknowledgement stores append-only evidence');
select is((select replayed from public.acknowledge_weight_alert('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,(select observation_id from prior_result),0,(select rule_version_id from weight_rule),'已人工確認月差與後續追蹤','26900000-0000-4000-8000-000000000001')), true, 'acknowledgement exactly replays');

select throws_ok($$select * from public.correct_weight_observation(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  '26400000-0000-4000-8000-000000000001',
  (select observation_id from current_result), 0, 'replace', 69.00, null,
  '26900000-0000-4000-8000-000000000011'
)$$, '22023', null, 'NULL correction reason is rejected explicitly');
create temporary table correction_result as select * from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,'replace',69.00,'原始值輸入錯誤，依紙本更正','26900000-0000-4000-8000-000000000002');
select is((select correction_version from correction_result), 1, 'correction appends optimistic version one');
select is((select replayed from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,'replace',69.00,'原始值輸入錯誤，依紙本更正','26900000-0000-4000-8000-000000000002')), true, 'correction exactly replays only with current authority');
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000099"}', true);
select throws_ok($$select * from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,'replace',69.00,'原始值輸入錯誤，依紙本更正','26900000-0000-4000-8000-000000000002')$$, '42501', null, 'same actor in a different session cannot replay an AAL2 correction');
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000004"}', true);
select throws_ok($$select * from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,'replace',69.00,'原始值輸入錯誤，依紙本更正','26900000-0000-4000-8000-000000000002')$$, '42501', null, 'expired same-session AAL2 evidence cannot replay a correction');
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000003"}', true);
select is((select items->0->>'current_weight_kg' from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,'26400000-0000-4000-8000-000000000001','all','all')), '69.00', 'snapshot uses terminal corrected value');
reset role;
select is((select count(*) from public.weight_alert_acknowledgements), 1::bigint, 'later correction does not rewrite prior acknowledgement evidence');
set local role authenticated;
select throws_ok($$select * from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),0,'replace',68.00,'舊鏈版本','26900000-0000-4000-8000-000000000003')$$, '40001', null, 'stale correction chain is rejected');
create temporary table void_result as select * from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),1,'void',null,'此筆量測不屬於該個案','26900000-0000-4000-8000-000000000004');
select is((select correction_version from void_result), 2, 'void appends a terminal version');
select throws_ok($$select * from public.correct_weight_observation('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001','26400000-0000-4000-8000-000000000001',(select observation_id from current_result),2,'replace',67.00,'不得復活','26900000-0000-4000-8000-000000000005')$$, '23514', null, 'terminal void cannot be revived');
select is((select items->0->>'current_state' from public.weight_management_snapshot('26100000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',date_trunc('month', current_date)::date,'26400000-0000-4000-8000-000000000001','all','all')), 'missing', 'voided latest observation becomes missing, never zero');

reset role;
with added as (
  insert into public.clients (
    id, organization_id, branch_id, client_code, display_name, status, admitted_on
  )
  select gen_random_uuid(),
    '26100000-0000-4000-8000-000000000001'::uuid,
    '26200000-0000-4000-8000-000000000001'::uuid,
    'W-BULK-' || series::text,
    '大量個案 ' || lpad(series::text, 3, '0'),
    'active'::public.client_status,
    date_trunc('month', current_date)::date
  from generate_series(1, 201) series
  returning id
)
insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
)
select '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001', added.id,
  '26000000-0000-4000-8000-000000000003', 'daily'
from added;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000003"}', true);
create temporary table large_weight_snapshot as select * from public.weight_management_snapshot(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date, null, 'all', 'all'
);
select is((select jsonb_array_length(items) from large_weight_snapshot), 200,
  'detail payload is bounded to 200 stable client rows');
select is((select client_option_total from large_weight_snapshot), 204::bigint,
  'client option total counts the complete visible set beyond the payload limit');
select is((select client_options_truncated from large_weight_snapshot), true,
  'client options truthfully report truncation');
select ok((select matching_total = 204 and item_total = 200
  and items_truncated and measured_total + missing_total = matching_total
  from large_weight_snapshot),
  'full filtered aggregates remain exact while detail is truncated');

select throws_ok($$insert into public.weight_observations default values$$,
  '42501', null, 'authenticated cannot bypass the audited RPC with a direct write');
reset role;
set local role service_role;
select throws_ok($$insert into public.weight_observations default values$$,
  '42501', null, 'service role cannot bypass the audited RPC with a direct write');

reset role;
select throws_ok($$update public.weight_observations set weight_kg = 10 where id = (select observation_id from current_result)$$, '55000', null, 'raw observations cannot be updated');
select throws_ok($$delete from public.weight_observation_corrections where observation_id = (select observation_id from current_result)$$, '55000', null, 'correction history cannot be deleted');

update public.memberships set status = 'suspended'
where id = '26300000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000003"}', true);
select throws_ok($$select * from public.record_weight_observation(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  '26400000-0000-4000-8000-000000000001',
  (select current_observed from weight_times), 65.00, '人工量測',
  '26800000-0000-4000-8000-000000000002'
)$$, '42501', null, 'exact record replay still requires current actor authority');
reset role;
update public.memberships set status = 'suspended'
where id = '26300000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"26610000-0000-4000-8000-000000000002"}', true);
select throws_ok($$select * from public.approve_weight_threshold_rule(
  '26100000-0000-4000-8000-000000000001',
  '26200000-0000-4000-8000-000000000001',
  (select request_id from weight_request),
  '26700000-0000-4000-8000-000000000003'
)$$, '42501', null, 'exact rule approval replay still requires current governor authority');

select * from finish();
rollback;
