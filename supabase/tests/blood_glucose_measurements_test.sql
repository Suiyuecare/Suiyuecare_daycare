begin;

select plan(39);

select ok(
  exists (
    select 1 from pg_constraint definition
    where definition.conrelid = 'public.measurements'::regclass
      and definition.conname = 'measurements_blood_glucose_shape_check'
      and definition.contype = 'c'
      and definition.convalidated
  ),
  'blood-glucose rows have a validated database shape constraint'
);

select ok(
  exists (
    select 1
    from pg_index definition
    join pg_class index_relation on index_relation.oid = definition.indexrelid
    where definition.indrelid = 'public.measurements'::regclass
      and index_relation.relname = 'measurements_blood_glucose_branch_time_idx'
      and pg_get_expr(definition.indpred, definition.indrelid) like '%blood_glucose%'
  ),
  'branch service-day blood-glucose reads have a partial time index'
);

select ok(
  not (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'public.record_blood_glucose(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'public.record_blood_glucose(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_blood_glucose(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)',
    'execute'
  ),
  'the public blood-glucose writer is an authenticated SECURITY INVOKER wrapper'
);

select ok(
  (
    select procedure.prosecdef from pg_proc procedure
    where procedure.oid =
      'private.record_blood_glucose_atomic(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.record_blood_glucose_atomic(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.record_blood_glucose_atomic(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)',
    'execute'
  ),
  'the private transaction is a non-anonymous SECURITY DEFINER'
);

select ok(
  (
    select
      procedure.pronargs = 8
      and procedure.proargnames[1:8] = array[
        'p_expected_organization_id', 'p_expected_branch_id', 'p_client_id',
        'p_measured_at', 'p_meal_context', 'p_numeric_value', 'p_unit',
        'p_idempotency_key'
      ]::text[]
      and not exists (
        select 1
        from unnest(procedure.proargnames[1:procedure.pronargs]) input_name
        where input_name ~ '(actor|source|hash|signature)'
      )
    from pg_proc procedure
    where procedure.oid =
      'public.record_blood_glucose(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)'::regprocedure
  ),
  'the RPC accepts server-selected scope but no actor, source, hash, or signature'
);

select ok(
  has_table_privilege('authenticated', 'public.measurements', 'select')
  and not has_table_privilege('authenticated', 'public.measurements', 'insert')
  and not has_table_privilege('authenticated', 'public.measurements', 'update')
  and not has_table_privilege('authenticated', 'public.measurements', 'delete'),
  'authenticated callers can read through RLS but cannot directly mutate measurements'
);

select ok(
  (
    select
      position('for update' in definition) > 0
      and position('pg_advisory_xact_lock' in definition)
        > position('for update' in definition)
      and position('select measurement.*' in definition)
        > position('pg_advisory_xact_lock' in definition)
      and position('if found then' in definition)
        > position('select measurement.*' in definition)
      and position('if p_measured_at < clock_timestamp()' in definition)
        > position('if found then' in definition)
      and position('if v_client.status <>' in definition)
        > position('if p_measured_at < clock_timestamp()' in definition)
    from (
      select lower(pg_get_functiondef(
        'private.record_blood_glucose_atomic(uuid,uuid,uuid,timestamptz,text,numeric,text,uuid)'::regprocedure
      )) as definition
    ) function_source
  ),
  'exclusive client and replay locks precede exact replay, time, and lifecycle gates'
);

select ok(
  exists (
    select 1 from pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'public.measurements'::regclass
      and trigger_definition.tgname = 'measurements_audit_row_change'
      and not trigger_definition.tgisinternal
  ),
  'blood-glucose inserts use the existing measurement audit trigger'
);

select set_config('test.glucose_now', clock_timestamp()::text, true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'glucose-writer-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'glucose-reader-a@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'glucose-writer-b@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('92000000-0000-4000-8000-000000000001', 'glucose_org_a', '血糖測試機構 A'),
  ('92000000-0000-4000-8000-000000000002', 'glucose_org_b', '血糖測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'main', '血糖 A 主分支'),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'second', '血糖 A 第二分支'),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'main', '血糖 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('91000000-0000-4000-8000-000000000001', '血糖 A 寫入人員', 'staff'),
  ('91000000-0000-4000-8000-000000000002', '血糖 A 唯讀人員', 'professional'),
  ('91000000-0000-4000-8000-000000000003', '血糖 B 寫入人員', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'active'),
  ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'active'),
  ('94000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000003', 'active'),
  ('94000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('94000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003'),
  ('94000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007'),
  ('94000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003'),
  ('94000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'GLU-A-001', '一般血糖個案', 'active', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('95000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'GLU-A-002', '暫停血糖個案', 'suspended', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('95000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'GLU-A-003', '尚未收案個案', 'active', null, null, 'test'),
  ('95000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'GLU-A-004', '已終止血糖個案', 'active', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 1), 'test'),
  ('95000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'GLU-A2-001', '其他分支血糖個案', 'active', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('95000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', 'GLU-B-001', '其他機構血糖個案', 'active', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), null, 'test'),
  ('95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'GLU-A-007', '已結案重送個案', 'closed', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 30), ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date - 1), 'test'),
  ('95000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'GLU-A-008', '未來收案血糖個案', 'active', ((current_setting('test.glucose_now')::timestamptz at time zone 'Asia/Taipei')::date + 1), null, 'test');

insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  'professional'
);

insert into public.measurements (
  organization_id, branch_id, client_id, measurement_kind, measured_at,
  numeric_value, unit, context, source, recorded_by, idempotency_key
) values (
  '92000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000006', 'blood_glucose',
  current_setting('test.glucose_now')::timestamptz - interval '20 minutes',
  118, 'mg/dL', '{"meal_context":"random"}'::jsonb, 'test_fixture',
  '91000000-0000-4000-8000-000000000003',
  '96000000-0000-4000-8000-000000000090'
);

with replay_values as (
  select
    current_setting('test.glucose_now')::timestamptz - interval '25 hours' as measured_at,
    '96000000-0000-4000-8000-000000000009'::uuid as measurement_set_id
), replay_payload as (
  select replay_values.*,
    encode(sha256(convert_to(jsonb_build_object(
      'schema_version', 1,
      'organization_id', '92000000-0000-4000-8000-000000000001'::uuid,
      'branch_id', '93000000-0000-4000-8000-000000000001'::uuid,
      'client_id', '95000000-0000-4000-8000-000000000007'::uuid,
      'measured_at_epoch', extract(epoch from replay_values.measured_at)::text,
      'meal_context', 'fasting', 'numeric_value', '126', 'unit', 'mg/dL'
    )::text, 'UTF8')), 'hex') as request_hash
  from replay_values
)
insert into public.measurements (
  organization_id, branch_id, client_id, measurement_kind, measured_at,
  numeric_value, unit, context, source, recorded_by, idempotency_key,
  measurement_set_id, request_hash
)
select
  '92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000007', 'blood_glucose',
  replay_payload.measured_at, 126, 'mg/dL',
  jsonb_build_object(
    'meal_context', 'fasting',
    '_request', jsonb_build_object(
      'schema_version', 1,
      'measurement_set_id', replay_payload.measurement_set_id,
      'idempotency_hash', replay_payload.request_hash
    )
  ),
  'staff', '91000000-0000-4000-8000-000000000001',
  private.measurement_row_idempotency(
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    replay_payload.measurement_set_id, 'blood_glucose'
  ),
  replay_payload.measurement_set_id, replay_payload.request_hash
from replay_payload;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);

select throws_ok(
  $$select * from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001', now(), 'pre_meal', 126,
      'mg/dL', '96000000-0000-4000-8000-000000000001'
    )$$,
  '42501', 'AAL2 is required for blood-glucose writes',
  'AAL1 cannot record blood glucose through the database RPC'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select results_eq(
  $$select meal_context collate "C", numeric_value, unit collate "C",
           source collate "C", replayed
    from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000007',
      current_setting('test.glucose_now')::timestamptz - interval '25 hours',
      'fasting', 126.0, 'mg/dL', '96000000-0000-4000-8000-000000000009'
    )$$,
  $$values ('fasting'::text collate "C", 126::numeric,
            'mg/dL'::text collate "C", 'staff'::text collate "C", true)$$,
  'exact committed content replays after both time and lifecycle state changes'
);

select results_eq(
  $$select client_id, meal_context collate "C", numeric_value,
           unit collate "C", source collate "C", replayed
    from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      current_setting('test.glucose_now')::timestamptz - interval '30 minutes',
      'pre_meal', 126, 'mg/dL', '96000000-0000-4000-8000-000000000010'
    )$$,
  $$values ('95000000-0000-4000-8000-000000000001'::uuid,
            'pre_meal'::text collate "C", 126::numeric,
            'mg/dL'::text collate "C", 'staff'::text collate "C", false)$$,
  'an authorized AAL2 actor records one integer mg/dL measurement'
);

select results_eq(
  $$select organization_id, branch_id, recorded_by, source collate "C",
           (context ->> 'meal_context') collate "C",
           request_hash ~ '^[a-f0-9]{64}$'
    from public.measurements
    where measurement_set_id = '96000000-0000-4000-8000-000000000010'$$,
  $$values ('92000000-0000-4000-8000-000000000001'::uuid,
            '93000000-0000-4000-8000-000000000001'::uuid,
            '91000000-0000-4000-8000-000000000001'::uuid,
            'staff'::text collate "C", 'pre_meal'::text collate "C", true)$$,
  'scope, actor, source, context, and hash are derived on the server'
);

select results_eq(
  $$select numeric_value, replayed
    from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      current_setting('test.glucose_now')::timestamptz - interval '30 minutes',
      'pre_meal', 126.00, 'mg/dL', '96000000-0000-4000-8000-000000000010'
    )$$,
  $$values (126::numeric, true)$$,
  'exact semantic content replays when numeric scale differs'
);

select is(
  (select count(*)::integer from public.measurements
   where measurement_set_id = '96000000-0000-4000-8000-000000000010'
     and recorded_by = '91000000-0000-4000-8000-000000000001'),
  1,
  'exact replay creates no duplicate row'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      current_setting('test.glucose_now')::timestamptz - interval '30 minutes',
      'pre_meal', 127, 'mg/dL', '96000000-0000-4000-8000-000000000010'
    )$$,
  '23505', 'blood-glucose idempotency conflict',
  'same idempotency key with changed content is rejected'
);

select results_eq(
  $$select meal_context collate "C", numeric_value, unit collate "C", replayed
    from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      current_setting('test.glucose_now')::timestamptz - interval '20 minutes',
      'post_meal', 7.8, 'mmol/L', '96000000-0000-4000-8000-000000000011'
    )$$,
  $$values ('post_meal'::text collate "C", 7.8::numeric,
            'mmol/L'::text collate "C", false)$$,
  'one-decimal mmol/L is accepted as a supported unit'
);

select results_eq(
  $$select numeric_value, unit collate "C", (context ->> 'meal_context') collate "C"
    from public.measurements
    where measurement_set_id = '96000000-0000-4000-8000-000000000011'$$,
  $$values (7.8::numeric, 'mmol/L'::text collate "C",
            'post_meal'::text collate "C")$$,
  'stored mmol/L retains value, unit, and meal context'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'bedtime',126,'mg/dL',
    '96000000-0000-4000-8000-000000000012')$$,
  '22023', 'unsupported blood-glucose meal context',
  'unsupported meal context is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random',126,'mg%',
    '96000000-0000-4000-8000-000000000013')$$,
  '22023', 'blood-glucose value is outside the technical input range',
  'unsupported unit is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random',126.5,'mg/dL',
    '96000000-0000-4000-8000-000000000014')$$,
  '22023', 'blood-glucose value is outside the technical input range',
  'mg/dL rejects fractional precision'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random',19,'mg/dL',
    '96000000-0000-4000-8000-000000000015')$$,
  '22023', 'blood-glucose value is outside the technical input range',
  'mg/dL outside the broad technical range is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random',7.85,'mmol/L',
    '96000000-0000-4000-8000-000000000016')$$,
  '22023', 'blood-glucose value is outside the technical input range',
  'mmol/L rejects more than one decimal place'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random',33.4,'mmol/L',
    '96000000-0000-4000-8000-000000000017')$$,
  '22023', 'blood-glucose value is outside the technical input range',
  'mmol/L outside the corresponding technical range is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random','NaN'::numeric,'mg/dL',
    '96000000-0000-4000-8000-000000000018')$$,
  '22023', 'blood-glucose value is outside the technical input range',
  'non-finite numeric input is rejected explicitly'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now()-interval '24 hours 1 second',
    'fasting',121,'mg/dL','96000000-0000-4000-8000-000000000019')$$,
  '22023', 'blood-glucose time is outside the allowed 24-hour window',
  'new measurement older than twenty-four hours is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now()+interval '5 minutes 1 second',
    'fasting',121,'mg/dL','96000000-0000-4000-8000-000000000020')$$,
  '22023', 'blood-glucose time is outside the allowed 24-hour window',
  'new measurement beyond the five-minute clock allowance is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000002',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000021')$$,
  '42501', 'blood-glucose recording is not permitted for the client lifecycle',
  'suspended client cannot receive a new row'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000003',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000022')$$,
  '42501', 'blood-glucose recording is not permitted for the client lifecycle',
  'active client without admission cannot receive a new row'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000004',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000023')$$,
  '42501', 'blood-glucose recording is not permitted for the client lifecycle',
  'client with an end date cannot receive a new row'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000008',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000024')$$,
  '42501', 'blood-glucose recording is not permitted for the client lifecycle',
  'measurement before admission date is rejected'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000005',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000025')$$,
  '42501', 'blood-glucose client scope is not permitted',
  'selected branch A cannot target branch B even when the actor has both scopes'
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000006',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000026')$$,
  '42501', 'blood-glucose client scope is not permitted',
  'cross-tenant blood-glucose write is denied'
);

select is(
  (select count(*)::integer from public.measurements
   where idempotency_key = '96000000-0000-4000-8000-000000000090'),
  0,
  'measurement RLS hides an existing foreign-tenant blood-glucose row'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.record_blood_glucose(
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',now(),'random',121,'mg/dL',
    '96000000-0000-4000-8000-000000000027')$$,
  '42501', 'blood-glucose client scope is not permitted',
  'assigned professional without health.write cannot record blood glucose'
);

select throws_ok(
  $$insert into public.measurements (
    organization_id,branch_id,client_id,measurement_kind,measured_at,
    numeric_value,unit,context,source,recorded_by,idempotency_key
  ) values (
    '92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001','blood_glucose',now(),120,
    'mg/dL','{"meal_context":"random"}'::jsonb,'staff',
    '91000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000030'
  )$$,
  '42501', null, 'direct authenticated insert is denied'
);

select throws_ok(
  $$update public.measurements set numeric_value=999
    where measurement_set_id='96000000-0000-4000-8000-000000000010'$$,
  '42501', null, 'direct authenticated update is denied'
);

select throws_ok(
  $$delete from public.measurements
    where measurement_set_id='96000000-0000-4000-8000-000000000010'$$,
  '42501', null, 'direct authenticated delete is denied'
);

reset role;
select ok(
  exists (
    select 1 from public.audit_events event
    where event.table_name = 'public.measurements'
      and event.action = 'insert'
      and event.actor_user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'successful blood-glucose inserts leave measurement audit events'
);

update public.memberships
set status = 'ended', ends_at = clock_timestamp()
where id = '94000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select * from public.record_blood_glucose(
      '92000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '95000000-0000-4000-8000-000000000001',
      current_setting('test.glucose_now')::timestamptz - interval '30 minutes',
      'pre_meal', 126, 'mg/dL', '96000000-0000-4000-8000-000000000010'
    )$$,
  '42501', 'blood-glucose client scope is not permitted',
  'exact replay still revalidates current health.write permission'
);

select * from finish();
rollback;
