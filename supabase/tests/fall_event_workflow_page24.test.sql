begin;

-- Client service periods and incident dates are Taiwan business dates.  Align
-- current_date fixtures with the production Asia/Taipei occurrence-date guard.
set local time zone 'Asia/Taipei';

select plan(57);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'quality_events.%'
    order by permission_key collate "C"$$,
  $$values
    ('quality_events.close'::text collate "C"),
    ('quality_events.manage'::text collate "C"),
    ('quality_events.read'::text collate "C")$$,
  'page 24 has narrow read, manage and close permissions'
);

select results_eq(
  $$select role.role_key collate "C"
    from public.role_permissions grant_row
    join public.roles role on role.id = grant_row.role_id
    join public.permissions permission on permission.id = grant_row.permission_id
    where permission.permission_key = 'quality_events.close'
      and role.is_system order by role.role_key collate "C"$$,
  $$values
    ('branch_supervisor'::text collate "C"),
    ('case_manager_social_worker'::text collate "C"),
    ('nurse'::text collate "C"),
    ('organization_manager'::text collate "C")$$,
  'closure permission is conservatively seeded'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
     'public.fall_incidents'::regclass,
     'public.fall_incident_entries'::regclass,
     'private.fall_event_operations'::regclass
   )),
  'all fall workflow tables force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.fall_incidents', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.fall_incidents', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.fall_incidents', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.fall_incident_entries', 'select,insert,update,delete'),
  'direct incident and timeline table access is denied'
);

select ok(
  has_function_privilege('authenticated', 'public.fall_event_snapshot(uuid,uuid,date,date,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.report_fall_event(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.add_fall_event_treatment(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.add_fall_event_follow_up(uuid,uuid,uuid,uuid,timestamptz,text,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.close_fall_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.fall_event_snapshot_response(uuid,uuid,date,date,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.report_fall_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.close_fall_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)', 'execute'),
  'authenticated callers receive the public wrappers and their non-exposed private core execution'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.fall_event_snapshot(uuid,uuid,date,date,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.report_fall_event(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.fall_event_snapshot_response(uuid,uuid,date,date,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)'::regprocedure),
  'public wrappers are invoker functions and private boundaries pin search path'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)'::regprocedure
  )) > 0
  and position('for update' in lower(pg_get_functiondef(
    'private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)'::regprocedure
  ))) > 0
  and position('expected_chain_version' in pg_get_functiondef(
    'private.append_fall_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,integer,uuid)'::regprocedure
  )) > 0
  and position('select operation.*' in pg_get_functiondef(
    'private.report_fall_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)'::regprocedure
  )) < position('late-entry reason is required' in pg_get_functiondef(
    'private.report_fall_event_atomic(uuid,uuid,uuid,timestamptz,text,text,text,text,text,uuid)'::regprocedure
  )),
  'timeline append locks optimistically and exact replay precedes time-drift governance checks'
);

select ok(
  (select count(*) = 3 from pg_trigger
   where not tgisinternal
     and tgname in (
       'fall_incidents_immutable', 'fall_incident_entries_immutable',
       'fall_event_operations_immutable'
     ))
  and (select count(*) = 3 from pg_trigger
   where not tgisinternal
     and tgname in (
       'fall_incidents_audit_row_change', 'fall_incident_entries_audit_row_change',
       'fall_event_operations_audit_row_change'
     )),
  'all committed history is immutable and mutation audited'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'fall-manager@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'fall-worker@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'fall-closer@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'fall-unassigned@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'fall-other@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '24000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'fall-family@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, code, name) values
  ('24100000-0000-4000-8000-000000000001', 'fall_a', '跌倒測試機構 A'),
  ('24100000-0000-4000-8000-000000000002', 'fall_b', '跌倒測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('24200000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', 'main', 'A 主分支'),
  ('24200000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', 'second', 'A 第二分支'),
  ('24200000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000002', 'main', 'B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('24000000-0000-4000-8000-000000000001', '跌倒管理員', 'staff'),
  ('24000000-0000-4000-8000-000000000002', '指派照服員', 'staff'),
  ('24000000-0000-4000-8000-000000000003', '指派護理師', 'staff'),
  ('24000000-0000-4000-8000-000000000004', '未指派照服員', 'staff'),
  ('24000000-0000-4000-8000-000000000005', '他機構管理員', 'staff'),
  ('24000000-0000-4000-8000-000000000006', '測試家屬', 'family');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('24300000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', null, '24000000-0000-4000-8000-000000000001', 'active'),
  ('24300000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000002', 'active'),
  ('24300000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000003', 'active'),
  ('24300000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000004', 'active'),
  ('24300000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000002', null, '24000000-0000-4000-8000-000000000005', 'active'),
  ('24300000-0000-4000-8000-000000000006', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000006', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('24300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('24300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006'),
  ('24300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000005'),
  ('24300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000006'),
  ('24300000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002'),
  ('24300000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000010');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status, admitted_on, ended_on
) values
  ('24400000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', 'FALL-1', '指派個案一', 'active', current_date - 30, null),
  ('24400000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', 'FALL-2', '未指派個案', 'active', current_date - 30, null),
  ('24400000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000002', 'FALL-3', '他分支個案', 'active', current_date - 30, null),
  ('24400000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000002', '24200000-0000-4000-8000-000000000003', 'FALL-4', '他機構個案', 'active', current_date - 30, null),
  ('24400000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', 'FALL-5', '已結案歷史個案', 'closed', current_date - 60, current_date - 1);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values
  ('24500000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000002', 'daily-care'),
  ('24500000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000003', 'nursing');

create temporary table fall_event_reauth_time as
select clock_timestamp() - interval '30 seconds' as verified_at;

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  created_at, expires_at, consumed_at, consumed_jwt_iat, factor_method,
  factor_verified_at
) values (
  '24600000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000003',
  '24610000-0000-4000-8000-000000000001', repeat('6', 64),
  '24620000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '4 minutes',
  (select verified_at from fall_event_reauth_time),
  (select verified_at from fall_event_reauth_time),
  'totp', (select verified_at from fall_event_reauth_time)
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '24000000-0000-4000-8000-000000000003',
  '24610000-0000-4000-8000-000000000001',
  '24600000-0000-4000-8000-000000000001',
  'aal2', 'totp', (select verified_at from fall_event_reauth_time)
);

insert into public.fall_incidents (
  id, organization_id, branch_id, client_id, occurred_at, location,
  event_summary, injury_degree_state, injury_degree_text, reported_by,
  reporter_display_name, reported_at, content_hash
) values
  ('24700000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', clock_timestamp() - interval '3 days', '活動區', '移位時跌倒', 'provided', '機構填寫：擦傷', '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '3 days' + interval '5 minutes', repeat('a', 64)),
  ('24700000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 days', '走廊', '行走時跌倒', 'missing', null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '2 days' + interval '5 minutes', repeat('b', 64)),
  ('24700000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', clock_timestamp() - interval '1 day', '休息區', '坐下時滑落', 'not_applicable', null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '1 day' + interval '5 minutes', repeat('c', 64)),
  ('24700000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000002', clock_timestamp() - interval '1 day', '未指派區', '不可見事件', 'missing', null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '1 day' + interval '5 minutes', repeat('d', 64)),
  ('24700000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000002', '24400000-0000-4000-8000-000000000003', clock_timestamp() - interval '1 day', '他分支', '不可見事件', 'missing', null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '1 day' + interval '5 minutes', repeat('e', 64)),
  ('24700000-0000-4000-8000-000000000006', '24100000-0000-4000-8000-000000000002', '24200000-0000-4000-8000-000000000003', '24400000-0000-4000-8000-000000000004', clock_timestamp() - interval '1 day', '他機構', '不可見事件', 'missing', null, '24000000-0000-4000-8000-000000000005', '他機構管理員', clock_timestamp() - interval '1 day' + interval '5 minutes', repeat('f', 64)),
  ('24700000-0000-4000-8000-000000000007', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000005', clock_timestamp() - interval '2 days', '歷史區', '結案個案歷史事件', 'missing', null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '2 days' + interval '5 minutes', repeat('7', 64));

insert into public.fall_incident_entries (
  id, organization_id, branch_id, client_id, incident_id, sequence_number,
  previous_entry_id, entry_type, occurred_at, entry_text, closure_outcome,
  closure_reason, committed_by, committer_display_name, committed_at,
  closure_reauth_challenge_id, content_hash
) values
  ('24800000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', '24700000-0000-4000-8000-000000000002', 1, null, 'treatment', clock_timestamp() - interval '2 days' + interval '10 minutes', '完成現場處置', null, null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '2 days' + interval '15 minutes', null, repeat('1', 64)),
  ('24800000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', '24700000-0000-4000-8000-000000000003', 1, null, 'follow_up', clock_timestamp() - interval '1 day' + interval '10 minutes', '追蹤狀況', null, null, '24000000-0000-4000-8000-000000000001', '跌倒管理員', clock_timestamp() - interval '1 day' + interval '15 minutes', null, repeat('2', 64)),
  ('24800000-0000-4000-8000-000000000003', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', '24400000-0000-4000-8000-000000000001', '24700000-0000-4000-8000-000000000003', 2, '24800000-0000-4000-8000-000000000002', 'closure', clock_timestamp() - interval '1 day' + interval '20 minutes', null, '完成追蹤並結案', '人工確認追蹤完成', '24000000-0000-4000-8000-000000000003', '指派護理師', clock_timestamp() - interval '1 day' + interval '25 minutes', '24600000-0000-4000-8000-000000000001', repeat('3', 64));

create temporary table fall_event_test_times as
select
  clock_timestamp() - interval '1 hour' as report_occurred_at,
  clock_timestamp() - interval '30 minutes' as treatment_occurred_at,
  clock_timestamp() as closure_occurred_at,
  clock_timestamp() - interval '5 minutes' as revocation_report_occurred_at;

grant select on fall_event_test_times to authenticated;

-- Test-only read grants let later assertions resolve the IDs returned by the
-- RPC while forced RLS still enforces the caller's assigned-client scope. They
-- are revoked before the direct-table denial assertion and rolled back.
grant select on public.fall_incidents, public.fall_incident_entries to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);

select is(
  (select item_total from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
  )), 3::bigint,
  'assigned worker sees only three incidents for the assigned client'
);

select ok(
  (select item_total = jsonb_array_length(items)
    and item_total = injury_provided_total + 2
    and item_total = awaiting_action_total + awaiting_closure_total + closed_total
    and awaiting_action_total = 1
    and awaiting_closure_total = 1
    and closed_total = 1
   from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
   )),
  'bounded snapshot metrics exactly reconcile to its incident details'
);

select is(
  (select item_total from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    null, null, '__missing__', 'in_progress', null
  )), 1::bigint,
  'missing injury information remains distinct and composes with status'
);

select is(
  (select item_total from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    null, null, '__not_applicable__', 'closed', null
  )), 1::bigint,
  'not-applicable injury information remains distinct from missing'
);

select is(
  (select item_total from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    null, null, '機構填寫：擦傷', 'reported',
    '24400000-0000-4000-8000-000000000001'
  )), 1::bigint,
  'institution-entered injury text, client and handling status filters compose'
);

select is(
  (select item_total from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    (clock_timestamp() at time zone 'Asia/Taipei')::date - 2,
    (clock_timestamp() at time zone 'Asia/Taipei')::date - 2,
    null, 'all', null
  )), 1::bigint,
  'event-date filter includes both bounds in Taipei time'
);

select ok(
  (select injury_taxonomy_status = 'not_configured'
    and severity_scoring_status = 'not_configured'
    and reporting_threshold_status = 'not_configured'
   from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
   )),
  'snapshot refuses to invent clinical taxonomy, score or reporting threshold'
);

select ok(
  (
    length(pg_get_functiondef(
      'private.fall_event_snapshot_response(uuid,uuid,date,date,text,text,uuid)'::regprocedure
    ))
    - length(replace(pg_get_functiondef(
      'private.fall_event_snapshot_response(uuid,uuid,date,date,text,text,uuid)'::regprocedure
    ), 'fall incident snapshot authority expired', ''))
  ) / length('fall incident snapshot authority expired') = 2,
  'snapshot rechecks authority both before audit and immediately before return'
);

select ok(
  (select (items -> 0) ? 'timeline'
    and (items -> 0) ? 'incident_id'
    and (items -> 0) ? 'chain_version'
   from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
   )),
  'incident and linked immutable timeline are returned in one projection'
);

reset role;
select ok(
  exists (
    select 1 from public.audit_events audit
    where audit.actor_user_id = '24000000-0000-4000-8000-000000000002'
      and audit.table_name = 'fall_incidents'
      and audit.action = 'select'
      and not (audit.metadata ? 'client_id')
      and not (audit.metadata ? 'injury_degree')
  ),
  'snapshot reads are audited without filter values or client identifiers'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select * from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'fall incident snapshot is not permitted',
  'AAL1 cannot read the staff incident snapshot'
);

select throws_ok(
  $$select * from private.fall_event_snapshot_response(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    null, null, null, 'all', null
  )$$,
  '42501', 'fall incident snapshot is not permitted',
  'direct private-core execution remains fail-closed for an unauthorized AAL1 caller'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select * from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'fall incident snapshot is not permitted',
  'staff cannot switch to an unauthorized branch'
);

select throws_ok(
  $$select * from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000002',
    '24200000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'fall incident snapshot is not permitted',
  'staff cannot switch to another tenant'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select * from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'fall incident snapshot is not permitted',
  'family membership cannot read the staff quality workflow'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);

select is(
  (select handling_status from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    (select report_occurred_at from fall_event_test_times), '交誼區', '測試新事件',
    'provided', '機構填寫：輕微紅腫', null,
    '24900000-0000-4000-8000-000000000001'
  )), 'reported'::text,
  'assigned worker can report a past event with server commit time'
);

select ok(
  (select replayed and chain_version = 0 and handling_status = 'reported'
      and client_id = '24400000-0000-4000-8000-000000000001'
   from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    (select report_occurred_at from fall_event_test_times), '交誼區', '測試新事件',
    'provided', '機構填寫：輕微紅腫', null,
    '24900000-0000-4000-8000-000000000001'
  )),
  'exact report replay returns the original correlated receipt'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    (select report_occurred_at from fall_event_test_times), '不同地點', '測試新事件',
    'provided', '機構填寫：輕微紅腫', null,
    '24900000-0000-4000-8000-000000000001'
  )$$,
  '23505', 'fall incident idempotency conflict',
  'same actor and idempotency key cannot be reused for changed content'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    clock_timestamp() + interval '1 minute', '交誼區', '未來事件',
    'missing', null, null, '24900000-0000-4000-8000-000000000002'
  )$$,
  '22023', 'invalid fall incident report',
  'future event occurrence is rejected'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000002',
    clock_timestamp() - interval '1 hour', '交誼區', '越權事件',
    'missing', null, null, '24900000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'fall incident client scope is not permitted',
  'assigned staff cannot report an unassigned same-branch client event'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '25 hours', '交誼區', '無理由補登',
    'missing', null, null, '24900000-0000-4000-8000-000000000012'
  )$$,
  '22023', 'late-entry reason is required after 24 hours',
  'a report more than 24 hours late requires an explicit backfill reason'
);

select ok(
  (select not replayed from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '25 hours', '交誼區', '有理由補登',
    'missing', null, '紙本紀錄延遲轉錄',
    '24900000-0000-4000-8000-000000000013'
  )),
  'an authorized late report records its explicit governance reason'
);

select ok(
  exists (
    select 1 from public.fall_incidents incident
    where incident.event_summary = '有理由補登'
      and incident.late_entry_reason = '紙本紀錄延遲轉錄'
  ),
  'late-entry reason is committed as immutable incident evidence'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '1 hour', '交誼區', '不必要補登理由',
    'missing', null, '不應接受', '24900000-0000-4000-8000-000000000014'
  )$$,
  '22023', 'late-entry reason is only accepted after 24 hours',
  'a recent report cannot mislabel itself as a late backfill'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '31 days', '交誼區', '收案前事件',
    'missing', null, '歷史資料', '24900000-0000-4000-8000-000000000015'
  )$$,
  '42501', 'fall incident client scope is not permitted',
  'an event outside the client service period cannot be reported'
);

select is(
  (select result.chain_version
   from public.fall_incidents incident
   cross join lateral public.add_fall_event_treatment(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    incident.id, (select treatment_occurred_at from fall_event_test_times), '完成現場處置',
    0, '24900000-0000-4000-8000-000000000004'
  ) result
   where incident.event_summary = '測試新事件'),
  1,
  'treatment appends chain version one'
);

select ok(
  (select result.replayed and result.chain_version = 1
      and result.handling_status = 'in_progress'
   from public.fall_incidents incident
   cross join lateral public.add_fall_event_treatment(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    incident.id, (select treatment_occurred_at from fall_event_test_times), '完成現場處置',
    0, '24900000-0000-4000-8000-000000000004'
  ) result
   where incident.event_summary = '測試新事件'),
  'exact treatment replay returns the original chain receipt'
);

select throws_ok(
  format($sql$select * from public.add_fall_event_follow_up(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    (select treatment_occurred_at from fall_event_test_times) - interval '1 minute',
    '早於前筆的追蹤', 1,
    '24900000-0000-4000-8000-000000000017'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '22023', 'timeline entry cannot predate the prior entry',
  'a correct chain version still cannot append an entry before its predecessor'
);

select throws_ok(
  format($sql$select * from public.add_fall_event_follow_up(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    clock_timestamp() - interval '20 minutes', '競態追蹤', 0,
    '24900000-0000-4000-8000-000000000005'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '40001', 'fall incident chain version conflict',
  'a stale competing append cannot fork the linear chain'
);

select throws_ok(
  format($sql$select * from public.add_fall_event_follow_up(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    clock_timestamp() - interval '2 hours', '事件前追蹤', 1,
    '24900000-0000-4000-8000-000000000006'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '22023', 'timeline entry cannot predate the incident',
  'a backdated timeline entry cannot predate its incident'
);

select throws_ok(
  format($sql$select * from public.add_fall_event_follow_up(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    clock_timestamp() + interval '1 minute', '未來追蹤', 1,
    '24900000-0000-4000-8000-000000000007'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '22023', 'invalid fall incident timeline entry',
  'a future timeline timestamp is rejected'
);

select throws_ok(
  format($sql$select * from public.close_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    (select closure_occurred_at from fall_event_test_times), '已完成追蹤', '主管確認結案', 1,
    '24900000-0000-4000-8000-000000000008'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '42501', 'fall incident timeline scope is not permitted',
  'manage permission alone cannot close an incident'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"24610000-0000-4000-8000-000000000099"}', true);
select throws_ok(
  format($sql$select * from public.close_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    (select closure_occurred_at from fall_event_test_times), '已完成追蹤', '主管確認結案', 1,
    '24900000-0000-4000-8000-000000000009'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '42501',
  'current same-session recent AAL2 evidence is required to close a fall incident',
  'closure rejects AAL2 evidence from another session'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"24610000-0000-4000-8000-000000000001"}', true);
select is(
  (select result.handling_status
   from public.fall_incidents incident
   cross join lateral public.close_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', incident.id,
    (select closure_occurred_at from fall_event_test_times),
    '已完成追蹤', '主管確認結案', 1,
    '24900000-0000-4000-8000-000000000009'
  ) result
   where incident.event_summary = '測試新事件'),
  'closed'::text,
  'authorized closer commits an explicit outcome and reason'
);

select ok(
  exists (
    select 1 from public.fall_incident_entries entry
    where entry.incident_id = (
      select id from public.fall_incidents where event_summary = '測試新事件'
    )
      and entry.entry_type = 'closure'
      and entry.closure_outcome = '已完成追蹤'
      and entry.closure_reason = '主管確認結案'
      and entry.closure_reauth_challenge_id = '24600000-0000-4000-8000-000000000001'
  ),
  'closure persists explicit text and exact reauthentication evidence'
);

select ok(
  (select result.replayed and result.chain_version = 2
      and result.handling_status = 'closed'
   from public.fall_incidents incident
   join public.fall_incident_entries entry
     on entry.incident_id = incident.id and entry.entry_type = 'closure'
   cross join lateral public.close_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', incident.id,
    entry.occurred_at, '已完成追蹤', '主管確認結案', 1,
    '24900000-0000-4000-8000-000000000009'
  ) result
   where incident.event_summary = '測試新事件'),
  'exact closure replay remains correlated and requires current recent AAL2'
);

select throws_ok(
  format($sql$select * from public.add_fall_event_follow_up(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001', %L,
    clock_timestamp(), '結案後追加', 2,
    '24900000-0000-4000-8000-000000000010'
  )$sql$, (select id from public.fall_incidents where event_summary = '測試新事件')),
  '23514', 'closed fall incident history cannot be extended',
  'closed history cannot receive another entry'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select ok(
  (select not replayed from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '10 minutes', '管理區', '管理員事件',
    'missing', null, null, '24900000-0000-4000-8000-000000000001'
  )),
  'the same UUID is independently scoped to a different actor'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select ok(
  (select not replayed from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    (select revocation_report_occurred_at from fall_event_test_times), '門口', '撤權測試事件',
    'not_applicable', null, null, '24900000-0000-4000-8000-000000000011'
  )),
  'assigned actor creates the receipt used for revocation testing'
);

reset role;
delete from public.client_assignments
where assignee_user_id = '24000000-0000-4000-8000-000000000002'
  and client_id = '24400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000001',
    (select revocation_report_occurred_at from fall_event_test_times), '門口', '撤權測試事件',
    'not_applicable', null, null, '24900000-0000-4000-8000-000000000011'
  )$$,
  '42501', 'fall incident client scope is not permitted',
  'an exact replay fails closed after client assignment is revoked'
);

select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);
select is(
  (select item_total from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
  )), 0::bigint,
  'same-branch staff without assignments receives an empty snapshot'
);

select is(
  (select items from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
  )), '[]'::jsonb,
  'an empty snapshot contains no synthetic all-null incident row'
);

reset role;
revoke select on public.fall_incidents, public.fall_incident_entries from authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$insert into public.fall_incidents (
    organization_id, branch_id, client_id, occurred_at, location,
    event_summary, injury_degree_state, reported_by, reporter_display_name,
    content_hash
  ) values (
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000002', clock_timestamp(), '直接',
    '直接寫入', 'missing', '24000000-0000-4000-8000-000000000004',
    '未指派照服員', repeat('9',64)
  )$$,
  '42501',
  'permission denied for table fall_incidents',
  'authenticated clients cannot bypass the workflow with a direct insert'
);

reset role;
select throws_ok(
  $$update public.fall_incidents set location = '改寫'
    where id = '24700000-0000-4000-8000-000000000001'$$,
  '55000', 'fall incident history and operation receipts are immutable',
  'even the table owner cannot update committed incident history'
);

select throws_ok(
  $$delete from public.fall_incident_entries
    where id = '24800000-0000-4000-8000-000000000001'$$,
  '55000', 'fall incident history and operation receipts are immutable',
  'even the table owner cannot delete committed timeline history'
);

insert into public.fall_incidents (
  organization_id, branch_id, client_id, occurred_at, location,
  event_summary, injury_degree_state, reported_by, reporter_display_name,
  reported_at, content_hash
)
select
  '24100000-0000-4000-8000-000000000001',
  '24200000-0000-4000-8000-000000000001',
  '24400000-0000-4000-8000-000000000002',
  clock_timestamp() - interval '1 day' - make_interval(secs => series.value),
  '批次區', '批次事件 ' || series.value, 'missing',
  '24000000-0000-4000-8000-000000000001', '跌倒管理員',
  clock_timestamp() - interval '1 day' - make_interval(secs => series.value) + interval '1 minute',
  md5(series.value::text) || md5('fall-' || series.value::text)
from generate_series(1, 200) series(value);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select ok(
  (select item_total = 200
      and matching_total = 201
      and jsonb_array_length(items) = 200
      and items_truncated
      and injury_provided_total = 0
      and awaiting_action_total = 201
      and awaiting_closure_total = 0
      and closed_total = 0
   from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    null, null, null, 'all',
    '24400000-0000-4000-8000-000000000002'
   )),
  'full filtered metrics remain exact while detail is explicitly truncated to 200 rows'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);

select ok(
  (select client_options @> jsonb_build_array(jsonb_build_object(
      'client_id', '24400000-0000-4000-8000-000000000005',
      'display_name', '已結案歷史個案',
      'client_status', 'closed',
      'can_report', false
    ))
   from public.fall_event_snapshot(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001'
   )),
  'a closed client with visible incident history remains available as a filter option'
);

select throws_ok(
  $$select * from public.report_fall_event(
    '24100000-0000-4000-8000-000000000001',
    '24200000-0000-4000-8000-000000000001',
    '24400000-0000-4000-8000-000000000005',
    clock_timestamp(), '交誼區', '結案後新事件',
    'missing', null, null, '24900000-0000-4000-8000-000000000016'
  )$$,
  '42501', 'fall incident client scope is not permitted',
  'a closed client cannot receive a newly reported incident'
);

reset role;

select ok(
  not exists (
    select 1
    from public.audit_events audit
    where audit.table_name in ('fall_incidents', 'fall_incident_entries', 'fall_event_operations')
      and (
        audit.metadata::text like '%移位時跌倒%'
        or audit.metadata::text like '%完成現場處置%'
        or audit.metadata::text like '%已完成追蹤%'
      )
  ),
  'mutation audit metadata does not copy incident, action or closure text'
);

select * from finish();
rollback;
