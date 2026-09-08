begin;

select plan(34);

-- 1
select ok(
  has_function_privilege('service_role',
    'public.ingest_hand_hygiene_event(uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.ingest_hand_hygiene_event(uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.correct_hand_hygiene_match(uuid,uuid,uuid,integer,text,uuid,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.hand_hygiene_snapshot(uuid,uuid,date,date,uuid,text,text,text,text)', 'execute'),
  'source ingestion is service-only and staff use only public correction and snapshot contracts'
);

-- 2
select ok(
  not has_function_privilege('authenticated',
    'private.ingest_hand_hygiene_event_guarded(uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,text)', 'execute')
  and not has_function_privilege('service_role',
    'private.correct_hand_hygiene_match_guarded(uuid,uuid,uuid,integer,text,uuid,text,uuid)', 'execute')
  and not has_function_privilege('service_role',
    'private.hand_hygiene_snapshot_response(uuid,uuid,date,date,uuid,text,text,text,text)', 'execute'),
  'each application role can execute only the private core needed by its public invoker'
);

-- 3
select ok(
  not has_table_privilege('authenticated', 'public.hand_hygiene_events', 'select')
  and not has_table_privilege('authenticated', 'public.hand_hygiene_match_corrections', 'insert')
  and not has_table_privilege('service_role', 'public.hand_hygiene_events', 'select')
  and not has_table_privilege('authenticated',
    'private.hand_hygiene_correction_operations', 'select'),
  'direct event, correction and operation table access is denied'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.hand_hygiene_events'::regclass)
  and (select relforcerowsecurity from pg_class
    where oid = 'public.hand_hygiene_match_corrections'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'hand_hygiene_events_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'hand_hygiene_match_corrections_audit_row_change' and not tgisinternal),
  'business tables force RLS and keep append-only and audit triggers'
);

-- 5
select ok(
  (select count(*) = 6 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private')
    )
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','ingest_hand_hygiene_event'),
      ('public','correct_hand_hygiene_match'),
      ('public','hand_hygiene_snapshot'),
      ('private','ingest_hand_hygiene_event_guarded'),
      ('private','correct_hand_hygiene_match_guarded'),
      ('private','hand_hygiene_snapshot_response')
    )),
  'public boundaries are pinned invokers and private guarded cores are pinned definers'
);

-- 6
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
    and tablename = 'hand_hygiene_events'
    and indexdef like '%organization_id, branch_id, source_provider, source_event_id%')
  and exists (select 1 from pg_indexes where schemaname = 'private'
    and tablename = 'hand_hygiene_correction_operations'
    and indexdef like '%result_correction_id, organization_id, branch_id%'),
  'deduplication and scoped foreign-key paths are indexed'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','66010000-0000-4000-8000-000000000001','authenticated','authenticated','hh-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','66010000-0000-4000-8000-000000000002','authenticated','authenticated','hh-worker-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','66010000-0000-4000-8000-000000000003','authenticated','authenticated','hh-worker-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','66010000-0000-4000-8000-000000000004','authenticated','authenticated','hh-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('66020000-0000-4000-8000-000000000001','hh_a','洗手測試機構'),
  ('66020000-0000-4000-8000-000000000002','hh_b','其他洗手機構');
insert into public.branches (id,organization_id,code,name) values
  ('66030000-0000-4000-8000-000000000001','66020000-0000-4000-8000-000000000001','main','主分支'),
  ('66030000-0000-4000-8000-000000000002','66020000-0000-4000-8000-000000000001','other','其他分支'),
  ('66030000-0000-4000-8000-000000000003','66020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('66010000-0000-4000-8000-000000000001','洗手主管','staff','HH-001',true),
  ('66010000-0000-4000-8000-000000000002','洗手員工甲','staff','HH-002',true),
  ('66010000-0000-4000-8000-000000000003','洗手員工乙','professional','HH-003',true),
  ('66010000-0000-4000-8000-000000000004','跨分支員工','staff','HH-004',true);
insert into public.memberships (
  id,organization_id,branch_id,profile_id,status,starts_at
) values
  ('66040000-0000-4000-8000-000000000001','66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001','66010000-0000-4000-8000-000000000001','active',clock_timestamp()-interval '1 day'),
  ('66040000-0000-4000-8000-000000000002','66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001','66010000-0000-4000-8000-000000000002','active',clock_timestamp()-interval '1 day'),
  ('66040000-0000-4000-8000-000000000003','66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001','66010000-0000-4000-8000-000000000003','active',clock_timestamp()-interval '1 day'),
  ('66040000-0000-4000-8000-000000000004','66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000002','66010000-0000-4000-8000-000000000004','active',clock_timestamp()-interval '1 day');
insert into public.membership_roles (membership_id,role_id) values
  ('66040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('66040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('66040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000007'),
  ('66040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006');

select set_config('test.hh_occurred',(clock_timestamp()-interval '5 minutes')::text,true);
select set_config('test.hh_received',(clock_timestamp()-interval '4 minutes')::text,true);

set local role service_role;
select set_config('test.hh_e1',(select event_id::text
  from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    'test-sensor','EVT-001','WASH-01','hygiene_performed',
    current_setting('test.hh_occurred')::timestamptz,
    current_setting('test.hh_received')::timestamptz,
    '66040000-0000-4000-8000-000000000002',repeat('a',64)
  )),true);

-- 7
select results_eq(
  $$select replayed,deduplicated from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    'test-sensor','EVT-001','WASH-01','hygiene_performed',
    current_setting('test.hh_occurred')::timestamptz,
    current_setting('test.hh_received')::timestamptz,
    '66040000-0000-4000-8000-000000000002',repeat('a',64))$$,
  $$values (true,true)$$,
  'an exact source delivery replays the original event without duplication'
);

-- 8
select throws_ok(
  $$select * from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    'test-sensor','EVT-001','CHANGED','hygiene_performed',
    current_setting('test.hh_occurred')::timestamptz,
    current_setting('test.hh_received')::timestamptz,
    '66040000-0000-4000-8000-000000000002',repeat('a',64))$$,
  '23505', 'hand hygiene source identity conflicts with different content',
  'the same source identity with changed content conflicts'
);

-- 9
select throws_ok(
  $$select * from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    'test-sensor','EVT-X','WASH-X','hygiene_performed',
    current_setting('test.hh_occurred')::timestamptz,
    current_setting('test.hh_received')::timestamptz,
    '66040000-0000-4000-8000-000000000004',repeat('b',64))$$,
  '42501', 'hand hygiene source staff is outside event-time scope',
  'source staff outside the branch is rejected'
);

select set_config('test.hh_e2',(select event_id::text
  from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    'test-sensor','EVT-002','WASH-02','hygiene_performed',
    current_setting('test.hh_occurred')::timestamptz-interval '1 minute',
    current_setting('test.hh_received')::timestamptz-interval '1 minute',
    null,repeat('b',64)
  )),true);
select set_config('test.hh_e3',(select event_id::text
  from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    'test-sensor','EVT-003','DOOR-01','opportunity',
    current_setting('test.hh_occurred')::timestamptz-interval '2 minutes',
    current_setting('test.hh_received')::timestamptz-interval '2 minutes',
    '66040000-0000-4000-8000-000000000002',repeat('c',64)
  )),true);

-- 10
select results_eq(
  $$select replayed from public.ingest_hand_hygiene_event(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000002',
    'test-sensor','EVT-001','WASH-01','hygiene_performed',
    current_setting('test.hh_occurred')::timestamptz,
    current_setting('test.hh_received')::timestamptz,null,repeat('d',64))$$,
  $$values (false)$$,
  'the same provider event id in another branch is a distinct source identity'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"66010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- 11
select throws_ok(
  $$select * from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001')$$,
  '42501', 'hand hygiene snapshot is not permitted',
  'AAL1 cannot read the event projection'
);

-- 12
select throws_ok(
  $$select * from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e2')::uuid,0,'matched',
    '66040000-0000-4000-8000-000000000003','確認當班人員',
    '66050000-0000-4000-8000-000000000001')$$,
  '42501', 'hand hygiene correction is not permitted',
  'AAL1 cannot append a matching correction'
);

select set_config('request.jwt.claims',
  '{"sub":"66010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- 13
select results_eq(
  $$select event_total,performed_event_total,matched_performed_total,
      observed_opportunity_event_total,unmatched_total,excluded_total
    from public.hand_hygiene_snapshot(
      '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001')$$,
  $$values (3::bigint,2::bigint,1::bigint,1::bigint,1::bigint,0::bigint)$$,
  'the initial branch snapshot counts distinct current events exactly'
);

-- 14
select results_eq(
  $$select denominator_total,attainment_rate,numerator_definition,
      denominator_policy_status,source_integration_status,export_status
    from public.hand_hygiene_snapshot(
      '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001')$$,
  $$values (null::bigint,null::numeric,
    'matched_distinct_hygiene_performed_events'::text,'not_configured'::text,
    'database_contract_only'::text,'not_configured'::text)$$,
  'the projection does not invent a denominator, rate, provider adapter or export'
);

-- 15
select results_eq(
  $$select jsonb_array_length(events),event_total,events_truncated,
      jsonb_array_length(staff_options),staff_total,staff_truncated
    from public.hand_hygiene_snapshot(
      '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001')$$,
  $$values (3,3::bigint,false,3,3::bigint,false)$$,
  'returned lists and exact totals share one branch snapshot'
);

-- 16
select results_eq(
  $$select correction_sequence,match_status,staff_membership_id,replayed
    from public.correct_hand_hygiene_match(
      '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
      current_setting('test.hh_e2')::uuid,0,'matched',
      '66040000-0000-4000-8000-000000000003','確認當班人員',
      '66050000-0000-4000-8000-000000000001')$$,
  $$values (1,'matched'::text,'66040000-0000-4000-8000-000000000003'::uuid,false)$$,
  'an authorized correction appends sequence one and binds event-time staff'
);

-- 17
select results_eq(
  $$select correction_sequence,replayed from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e2')::uuid,0,'matched',
    '66040000-0000-4000-8000-000000000003','確認當班人員',
    '66050000-0000-4000-8000-000000000001')$$,
  $$values (1,true)$$,
  'an exact correction retry returns the original receipt'
);

-- 18
select throws_ok(
  $$select * from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e2')::uuid,0,'unmatched',null,'改用相同操作鍵',
    '66050000-0000-4000-8000-000000000001')$$,
  '23505', 'hand hygiene correction idempotency conflict',
  'a changed request cannot reuse the operation key'
);

-- 19
select throws_ok(
  $$select * from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e2')::uuid,0,'unmatched',null,'過期基準序號',
    '66050000-0000-4000-8000-000000000002')$$,
  '40001', 'hand hygiene correction sequence is stale',
  'a stale correction sequence is rejected'
);

-- 20
select throws_ok(
  $$select * from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e2')::uuid,1,'matched',
    '66040000-0000-4000-8000-000000000004','跨分支錯誤配對',
    '66050000-0000-4000-8000-000000000003')$$,
  '42501', 'hand hygiene staff is outside event-time scope',
  'a correction cannot bind staff from another branch'
);

-- 21
select results_eq(
  $$select matched_performed_total,unmatched_total from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001')$$,
  $$values (2::bigint,0::bigint)$$,
  'the terminal matched correction immediately changes exact metrics'
);

-- 22
select results_eq(
  $$select correction_sequence,match_status,staff_membership_id from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e1')::uuid,0,'excluded',null,'設備測試事件，排除候選計數',
    '66050000-0000-4000-8000-000000000004')$$,
  $$values (1,'excluded'::text,null::uuid)$$,
  'an exclusion is appended without retaining a contradictory staff match'
);

-- 23
select results_eq(
  $$select event_total,performed_event_total,matched_performed_total,
      excluded_total,events->0->>'match_status',events->0->>'staff_membership_id'
    from public.hand_hygiene_snapshot(
      '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
      null,null,null,'WASH-01','all','all','search')$$,
  $$values (1::bigint,0::bigint,0::bigint,1::bigint,'excluded'::text,null::text)$$,
  'an excluded event has null terminal staff and is removed from candidate counts'
);

-- 24
select results_eq(
  $$select event_total,excluded_total from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    null,null,null,null,'excluded','all','search')$$,
  $$values (1::bigint,1::bigint)$$,
  'terminal match-status filtering is exact'
);

-- 25
select results_eq(
  $$select event_total,events->0->>'staff_membership_id' from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    null,null,'66040000-0000-4000-8000-000000000003',null,'all','all','search')$$,
  $$values (1::bigint,'66040000-0000-4000-8000-000000000003'::text)$$,
  'staff filtering uses the current corrected membership'
);

-- 26
select results_eq(
  $$select event_total,observed_opportunity_event_total from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    null,null,null,null,'all','opportunity','search')$$,
  $$values (1::bigint,1::bigint)$$,
  'event-kind filtering is exact'
);

-- 27
-- The three fixture events span occurred_at - 2 minutes through occurred_at;
-- this can cross Taipei midnight, so use both actual endpoint dates.
select results_eq(
  $$select event_total from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    ((current_setting('test.hh_occurred')::timestamptz-interval '2 minutes') at time zone 'Asia/Taipei')::date,
    (current_setting('test.hh_occurred')::timestamptz at time zone 'Asia/Taipei')::date,
    null,null,'all','all','search')$$,
  $$values (3::bigint)$$,
  'Taipei-local inclusive date filtering is exact'
);

-- 28
select throws_ok(
  $$select * from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    date '2026-09-03',date '2026-09-02')$$,
  '22023', 'hand hygiene snapshot filters are invalid',
  'invalid date filters fail closed'
);

-- 29
select throws_ok(
  $$select * from public.hand_hygiene_snapshot(
    '66020000-0000-4000-8000-000000000002','66030000-0000-4000-8000-000000000001')$$,
  '42501', 'hand hygiene snapshot is not permitted',
  'a mismatched organization and branch cannot be queried'
);

-- 30
select throws_ok(
  $$select count(*) from public.hand_hygiene_events$$,
  '42501', 'permission denied for table hand_hygiene_events',
  'authenticated callers cannot bypass the snapshot through direct table access'
);

reset role;

-- 31
select throws_ok(
  $$update public.hand_hygiene_events set device_code='OVERWRITE'
    where id=current_setting('test.hh_e1')::uuid$$,
  '23514', 'hand_hygiene_events is append-only',
  'source events cannot be overwritten even by the table owner'
);

-- 32
select throws_ok(
  $$update public.hand_hygiene_match_corrections set correction_reason='OVERWRITE'
    where event_id=current_setting('test.hh_e1')::uuid$$,
  '23514', 'hand_hygiene_match_corrections is append-only',
  'matching corrections cannot be overwritten even by the table owner'
);

-- 33
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'hand_hygiene_snapshot'
      and metadata->>'denominator_policy_status' = 'not_configured'
      and metadata->>'source_integration_status' = 'database_contract_only')
  and not exists (select 1 from public.audit_events
    where table_name = 'hand_hygiene_snapshot'
      and metadata::text ~ '(EVT-00|確認當班人員|HH-00)'),
  'snapshot audit metadata records the contract without source ids, staff codes or narratives'
);

delete from public.role_permissions mapping
using public.roles role, public.permissions permission
where mapping.role_id=role.id and mapping.permission_id=permission.id
  and role.role_key='branch_supervisor'
  and permission.permission_key='hand_hygiene.manage';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"66010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- 34
select throws_ok(
  $$select * from public.correct_hand_hygiene_match(
    '66020000-0000-4000-8000-000000000001','66030000-0000-4000-8000-000000000001',
    current_setting('test.hh_e2')::uuid,0,'matched',
    '66040000-0000-4000-8000-000000000003','確認當班人員',
    '66050000-0000-4000-8000-000000000001')$$,
  '42501', 'hand hygiene correction is not permitted',
  'permission revocation blocks even an exact idempotent replay'
);

reset role;
select * from finish();
rollback;
