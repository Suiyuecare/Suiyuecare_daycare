begin;

select plan(34);

-- 1
select ok(
  has_function_privilege('service_role',
    'public.ingest_external_health_measurement(uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text)', 'execute')
  and not has_function_privilege('authenticated',
    'public.ingest_external_health_measurement(uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.append_external_health_device_state(uuid,uuid,uuid,text,integer,uuid,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.correct_external_health_measurement_match(uuid,uuid,uuid,integer,text,uuid,text,uuid)', 'execute')
  and has_function_privilege('authenticated',
    'public.external_health_device_snapshot(uuid,uuid,date,date,uuid,uuid,text,text,text,text)', 'execute'),
  'source ingestion is service-only while staff use scoped state, correction and snapshot boundaries'
);

-- 2
select ok(
  not has_function_privilege('authenticated',
    'private.ingest_external_health_measurement_guarded(uuid,uuid,text,text,text,text,text,text,numeric,text,timestamptz,timestamptz,text)', 'execute')
  and not has_function_privilege('service_role',
    'private.append_external_health_device_state_guarded(uuid,uuid,uuid,text,integer,uuid,text,uuid)', 'execute')
  and not has_function_privilege('service_role',
    'private.external_health_device_snapshot_response(uuid,uuid,date,date,uuid,uuid,text,text,text,text)', 'execute'),
  'application roles cannot execute unrelated guarded cores'
);

-- 3
select ok(
  not has_table_privilege('authenticated', 'public.external_health_devices', 'select')
  and not has_table_privilege('authenticated',
    'public.external_health_device_state_events', 'insert')
  and not has_table_privilege('service_role',
    'public.external_health_measurements', 'select')
  and not has_table_privilege('authenticated',
    'private.external_health_device_state_operations', 'select'),
  'direct device, measurement, state, correction and operation-table access is denied'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.external_health_devices'::regclass)
  and (select relforcerowsecurity from pg_class
    where oid = 'public.external_health_measurements'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'external_health_device_states_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'external_health_measurement_match_corrections_audit_row_change'
      and not tgisinternal),
  'business tables force RLS and keep append-only and metadata audit triggers'
);

-- 5
select ok(
  (select count(*) = 8 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private'))
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','ingest_external_health_measurement'),
      ('public','append_external_health_device_state'),
      ('public','correct_external_health_measurement_match'),
      ('public','external_health_device_snapshot'),
      ('private','ingest_external_health_measurement_guarded'),
      ('private','append_external_health_device_state_guarded'),
      ('private','correct_external_health_measurement_match_guarded'),
      ('private','external_health_device_snapshot_response')
    )),
  'public boundaries are pinned invokers and private guarded cores are pinned definers'
);

-- 6
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
    and tablename = 'external_health_measurements'
    and indexdef like '%organization_id, branch_id, source_provider, source_measurement_id%')
  and exists (select 1 from pg_indexes where schemaname = 'public'
    and tablename = 'external_health_measurement_match_corrections'
    and indexdef like '%corrected_by%')
  and exists (select 1 from pg_indexes where schemaname = 'private'
    and tablename = 'external_health_device_state_operations'
    and indexdef like '%result_state_event_id, organization_id, branch_id%'),
  'source deduplication and all scoped foreign-key paths are indexed'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','65010000-0000-4000-8000-000000000001','authenticated','authenticated','device-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','65010000-0000-4000-8000-000000000002','authenticated','authenticated','other-device@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('65020000-0000-4000-8000-000000000001','ehd_a','設備測試機構'),
  ('65020000-0000-4000-8000-000000000002','ehd_b','其他設備機構');
insert into public.branches (id,organization_id,code,name) values
  ('65030000-0000-4000-8000-000000000001','65020000-0000-4000-8000-000000000001','main','主分支'),
  ('65030000-0000-4000-8000-000000000002','65020000-0000-4000-8000-000000000001','other','其他分支'),
  ('65030000-0000-4000-8000-000000000003','65020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('65010000-0000-4000-8000-000000000001','設備主管','staff','EHD-001',true),
  ('65010000-0000-4000-8000-000000000002','其他主管','staff','EHD-002',true);
insert into public.memberships (
  id,organization_id,branch_id,profile_id,status,starts_at
) values
  ('65040000-0000-4000-8000-000000000001','65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001','65010000-0000-4000-8000-000000000001','active',clock_timestamp()-interval '1 day'),
  ('65040000-0000-4000-8000-000000000002','65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000002','65010000-0000-4000-8000-000000000002','active',clock_timestamp()-interval '1 day');
insert into public.membership_roles (membership_id,role_id) values
  ('65040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('65040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
insert into public.clients (
  id,organization_id,branch_id,client_code,display_name,status,admitted_on
) values
  ('65050000-0000-4000-8000-000000000001','65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001','EHD-C1','設備個案一','active',current_date-30),
  ('65050000-0000-4000-8000-000000000002','65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000002','EHD-C2','他分支個案','active',current_date-30);

create temporary table external_health_times as select
  clock_timestamp()-interval '5 minutes' as first_measured_at,
  clock_timestamp()-interval '4 minutes 58 seconds' as first_received_at,
  clock_timestamp()-interval '30 seconds' as verified_at;
grant select on external_health_times to authenticated, service_role;
insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,
  factor_method,factor_verified_at
)
select '65060000-0000-4000-8000-000000000001',
  '65010000-0000-4000-8000-000000000001',
  '65061000-0000-4000-8000-000000000001',repeat('6',64),
  '65062000-0000-4000-8000-000000000001',verified_at-interval '1 minute',
  verified_at-interval '1 minute',verified_at+interval '5 minutes',verified_at,
  verified_at,'totp',verified_at from external_health_times;
insert into private.reauth_events(
  user_id,session_id,challenge_id,aal,verification_method,verified_at
)
select '65010000-0000-4000-8000-000000000001',
  '65061000-0000-4000-8000-000000000001',
  '65060000-0000-4000-8000-000000000001','aal2','totp',verified_at
from external_health_times;

set local role service_role;
select set_config('test.ehd_m1',(select measurement_id::text
  from public.ingest_external_health_measurement(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    'test-provider','DEV-001','BP-01','blood_pressure_monitor',
    'M-001','systolic_bp',128,'mmHg',
    (select first_measured_at from external_health_times),
    (select first_received_at from external_health_times),repeat('a',64)
  )),true);
select set_config('test.ehd_device',(select device_id::text
  from public.ingest_external_health_measurement(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    'test-provider','DEV-001','BP-01','blood_pressure_monitor',
    'M-001','systolic_bp',128,'mmHg',
    (select first_measured_at from external_health_times),
    (select first_received_at from external_health_times),repeat('a',64)
  )),true);

-- 7
select results_eq(
  $$select measurement_id,device_id,replayed,deduplicated
    from public.ingest_external_health_measurement(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
      'test-provider','DEV-001','BP-01','blood_pressure_monitor',
      'M-001','systolic_bp',128,'mmHg',
      (select first_measured_at from external_health_times),
      (select first_received_at from external_health_times),repeat('a',64))$$,
  $$select current_setting('test.ehd_m1')::uuid,
      current_setting('test.ehd_device')::uuid,true,true$$,
  'an exact source delivery replays the original measurement without duplication'
);

-- 8
select throws_ok(
  $$select * from public.ingest_external_health_measurement(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    'test-provider','DEV-001','BP-01','blood_pressure_monitor',
    'M-001','systolic_bp',129,'mmHg',
    (select first_measured_at from external_health_times),
    (select first_received_at from external_health_times),repeat('a',64))$$,
  '23505','external health source identity conflicts with different content',
  'the same source measurement identity with changed content conflicts'
);

-- 9
select throws_ok(
  $$select * from public.ingest_external_health_measurement(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    'test-provider','DEV-001','CHANGED','blood_pressure_monitor',
    'M-CHANGED','systolic_bp',130,'mmHg',
    clock_timestamp(),clock_timestamp(),repeat('b',64))$$,
  '23505','external health device identity conflicts with different metadata',
  'the same source device identity cannot silently change metadata'
);

-- 10
select results_eq(
  $$select replayed from public.ingest_external_health_measurement(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000002',
    'test-provider','DEV-001','BP-01','blood_pressure_monitor',
    'M-001','systolic_bp',128,'mmHg',clock_timestamp(),clock_timestamp(),repeat('c',64))$$,
  $$values (false)$$,
  'the same provider identities in another branch remain distinct'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"65010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"65061000-0000-4000-8000-000000000001"}',true);

-- 11
select throws_ok(
  $$select * from public.external_health_device_snapshot(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001')$$,
  '42501','external health device snapshot is not permitted',
  'AAL1 cannot read sensitive external health measurements'
);

select set_config('request.jwt.claims',
  '{"sub":"65010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"65061000-0000-4000-8000-000000000001"}',true);

-- 12
select results_eq(
  $$select device_total,active_device_total,disabled_device_total,
      assigned_device_total,measurement_total,unmatched_measurement_total,
      source_integration_status,connection_policy_status
    from public.external_health_device_snapshot(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001')$$,
  $$values (1::bigint,1::bigint,0::bigint,0::bigint,1::bigint,1::bigint,
    'database_contract_only'::text,'not_configured'::text)$$,
  'initial snapshot is exact and does not invent an integration or connection policy'
);

select set_config('request.jwt.claims',
  '{"sub":"65010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"65061000-0000-4000-8000-000000000099"}',true);

-- 13
select throws_ok(
  $$select * from public.append_external_health_device_state(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    current_setting('test.ehd_device')::uuid,'assign_device',1,
    '65050000-0000-4000-8000-000000000001','確認設備交付個案',
    '65070000-0000-4000-8000-000000000001')$$,
  '42501','external health device state is not permitted',
  'a current AAL2 claim without same-session recent evidence cannot mutate state'
);

select set_config('request.jwt.claims',
  '{"sub":"65010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"65061000-0000-4000-8000-000000000001"}',true);

-- 14
select results_eq(
  $$select action,state_sequence,operational_status,assigned_client_id,replayed
    from public.append_external_health_device_state(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
      current_setting('test.ehd_device')::uuid,'assign_device',1,
      '65050000-0000-4000-8000-000000000001','確認設備交付個案',
      '65070000-0000-4000-8000-000000000001')$$,
  $$values ('assign_device'::text,2,'active'::text,
    '65050000-0000-4000-8000-000000000001'::uuid,false)$$,
  'authorized assignment appends state sequence two with a client snapshot'
);

-- 15
select results_eq(
  $$select state_sequence,assigned_client_id,replayed
    from public.append_external_health_device_state(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
      current_setting('test.ehd_device')::uuid,'assign_device',1,
      '65050000-0000-4000-8000-000000000001','確認設備交付個案',
      '65070000-0000-4000-8000-000000000001')$$,
  $$values (2,'65050000-0000-4000-8000-000000000001'::uuid,true)$$,
  'an exact state retry returns the original event without appending'
);

-- 16
select throws_ok(
  $$select * from public.append_external_health_device_state(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    current_setting('test.ehd_device')::uuid,'assign_device',1,
    '65050000-0000-4000-8000-000000000001','不同理由',
    '65070000-0000-4000-8000-000000000001')$$,
  '23505','external health device operation key conflicts',
  'reusing a state operation key with changed content conflicts'
);

-- 17
select throws_ok(
  $$select * from public.append_external_health_device_state(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    current_setting('test.ehd_device')::uuid,'disable_device',1,null,'設備送修',
    '65070000-0000-4000-8000-000000000002')$$,
  '40001','external health device state sequence is stale',
  'stale device state bases cannot append concurrently'
);

-- 18
select throws_ok(
  $$select * from public.append_external_health_device_state(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    current_setting('test.ehd_device')::uuid,'assign_device',2,
    '65050000-0000-4000-8000-000000000002','錯誤跨分支配對',
    '65070000-0000-4000-8000-000000000003')$$,
  '42501','external health device client is outside current scope',
  'cross-branch client assignment is rejected'
);

reset role;
create temporary table external_health_second_times as select
  clock_timestamp()+interval '1 second' as measured_at,
  clock_timestamp()+interval '2 seconds' as received_at;
grant select on external_health_second_times to service_role;
set local role service_role;
select set_config('test.ehd_m2',(select measurement_id::text
  from public.ingest_external_health_measurement(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    'test-provider','DEV-001','BP-01','blood_pressure_monitor',
    'M-002','diastolic_bp',76,'mmHg',
    (select measured_at from external_health_second_times),
    (select received_at from external_health_second_times),repeat('d',64)
  )),true);

reset role;
-- 19
select results_eq(
  $$select source_client_id,metric_code,numeric_value,
      measured_at is distinct from received_at
    from public.external_health_measurements
    where id=current_setting('test.ehd_m2')::uuid$$,
  $$values ('65050000-0000-4000-8000-000000000001'::uuid,
    'diastolic_bp'::text,76.000000::numeric,true)$$,
  'post-assignment ingestion freezes the client while preserving distinct source and receipt times'
);

set local role service_role;
-- 20
select results_eq(
  $$select measurement_id,replayed,deduplicated
    from public.ingest_external_health_measurement(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
      'test-provider','DEV-001','BP-01','blood_pressure_monitor',
      'M-002','diastolic_bp',76,'mmHg',
      (select measured_at from external_health_second_times),
      (select received_at from external_health_second_times),repeat('d',64))$$,
  $$select current_setting('test.ehd_m2')::uuid,true,true$$,
  'the second exact source retry is also deduplicated'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"65010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"65061000-0000-4000-8000-000000000001"}',true);

-- 21
select results_eq(
  $$select device_total,assigned_device_total,measurement_total,
      unmatched_measurement_total,excluded_measurement_total,
      jsonb_array_length(devices),jsonb_array_length(measurements)
    from public.external_health_device_snapshot(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001')$$,
  $$values (1::bigint,1::bigint,2::bigint,1::bigint,0::bigint,1,2)$$,
  'snapshot totals and bounded details share the same branch state'
);

-- 22
select ok((
  select (measurements->0->>'measured_at') is distinct from
      (measurements->0->>'received_at')
    and measurements->0 ? 'numeric_value'
    and measurements->0 ? 'unit'
  from public.external_health_device_snapshot(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001')
), 'measurement detail keeps separate source/receipt timestamps, exact value and unit');

-- 23
select ok((
  select bool_and(item->>'connection_status' = 'not_configured')
    from public.external_health_device_snapshot(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001'),
      jsonb_array_elements(devices) item
), 'every device connection state remains explicitly unconfigured');

-- 24
select results_eq(
  $$select action,correction_sequence,match_status,client_id,replayed
    from public.correct_external_health_measurement_match(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
      current_setting('test.ehd_m1')::uuid,0,'matched',
      '65050000-0000-4000-8000-000000000001','核對來源設備標籤',
      '65080000-0000-4000-8000-000000000001')$$,
  $$values ('correct_measurement_match'::text,1,'matched'::text,
    '65050000-0000-4000-8000-000000000001'::uuid,false)$$,
  'authorized measurement correction appends sequence one'
);

-- 25
select results_eq(
  $$select correction_sequence,client_id,replayed
    from public.correct_external_health_measurement_match(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
      current_setting('test.ehd_m1')::uuid,0,'matched',
      '65050000-0000-4000-8000-000000000001','核對來源設備標籤',
      '65080000-0000-4000-8000-000000000001')$$,
  $$values (1,'65050000-0000-4000-8000-000000000001'::uuid,true)$$,
  'an exact correction retry returns the original correction'
);

-- 26
select throws_ok(
  $$select * from public.correct_external_health_measurement_match(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    current_setting('test.ehd_m1')::uuid,0,'matched',
    '65050000-0000-4000-8000-000000000001','不同理由',
    '65080000-0000-4000-8000-000000000001')$$,
  '23505','external health measurement operation key conflicts',
  'reusing a correction key with changed content conflicts'
);

-- 27
select throws_ok(
  $$select * from public.correct_external_health_measurement_match(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    current_setting('test.ehd_m1')::uuid,0,'excluded',null,'錯誤舊序號',
    '65080000-0000-4000-8000-000000000002')$$,
  '40001','external health measurement correction sequence is stale',
  'stale measurement correction bases cannot append concurrently'
);

-- 28
select results_eq(
  $$select measurement_total,unmatched_measurement_total,
      excluded_measurement_total
    from public.external_health_device_snapshot(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001')$$,
  $$values (2::bigint,0::bigint,0::bigint)$$,
  'terminal correction changes the projection without overwriting source rows'
);

-- 29
select results_eq(
  $$select measurement_total from public.external_health_device_snapshot(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    (clock_timestamp() at time zone 'Asia/Taipei')::date,
    (clock_timestamp() at time zone 'Asia/Taipei')::date)$$,
  $$values (2::bigint)$$,
  'Taipei date filters include both start and end dates'
);

-- 30
select results_eq(
  $$select device_total,measurement_total from public.external_health_device_snapshot(
    '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001',
    null,null,'65050000-0000-4000-8000-000000000001')$$,
  $$values (1::bigint,2::bigint)$$,
  'authorized client filter applies consistently to devices and terminal measurements'
);

-- 31
select results_eq(
  $$select source_deduplication,source_integration_status,
      connection_policy_status,attachment_pipeline_status,export_status
    from public.external_health_device_snapshot(
      '65020000-0000-4000-8000-000000000001','65030000-0000-4000-8000-000000000001')$$,
  $$values ('organization_branch_provider_source_measurement_id'::text,
    'database_contract_only'::text,'not_configured'::text,
    'not_applicable'::text,'not_configured'::text)$$,
  'snapshot does not invent provider, heartbeat, attachment or export capabilities'
);

reset role;

-- 32
select throws_ok(
  $$update public.external_health_device_state_events set reason='不可覆寫'
    where device_id=current_setting('test.ehd_device')::uuid$$,
  '23514','external_health_device_state_events is append-only',
  'device state history cannot be overwritten'
);

-- 33
select throws_ok(
  $$delete from public.external_health_measurements
    where id=current_setting('test.ehd_m1')::uuid$$,
  '23514','external_health_measurements is append-only',
  'source measurements cannot be deleted'
);

-- 34
select ok(exists(
  select 1 from public.audit_events
  where table_name = 'external_health_device_snapshot' and action = 'select'
    and metadata->>'projection' = 'page65_external_health_devices_v1'
    and metadata->>'connection_policy_status' = 'not_configured'
    and not metadata ? 'client_id' and not metadata ? 'metric_code'
), 'snapshot audit stores counts and policy state without client or measurement values');

select * from finish();
rollback;
