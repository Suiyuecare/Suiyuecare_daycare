begin;

select plan(32);

-- 1
select ok(
  has_function_privilege('authenticated',
    'public.staff_vaccination_snapshot(uuid,uuid,uuid,text,text,date,date,text,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.append_staff_vaccination(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,text,text,text,text,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_vaccination_snapshot_bundle(uuid,uuid,timestamptz,uuid,text,text,date,date,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_health_current_authority(uuid,uuid,text)', 'execute'),
  'public invoker functions are callable while private health helpers stay sealed'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.staff_vaccination_versions', 'select')
  and not has_table_privilege('authenticated', 'public.staff_vaccination_versions', 'insert')
  and not has_table_privilege('service_role', 'public.staff_vaccination_versions', 'select')
  and not has_table_privilege('authenticated',
    'private.staff_vaccination_operations', 'select'),
  'direct vaccination and operation table access is denied'
);

-- 3
select ok(
  (select count(*) = 4 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private')
    )
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','append_staff_vaccination'),
      ('public','staff_vaccination_snapshot'),
      ('private','append_staff_vaccination_guarded'),
      ('private','staff_vaccination_snapshot_response')
    )),
  'private boundaries are pinned definers and public wrappers are pinned invokers'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.staff_vaccination_versions'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_vaccination_versions_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_vaccination_versions_audit_row_change' and not tgisinternal),
  'vaccination versions force RLS and have append-only and audit triggers'
);

-- 5
select ok(
  (select risk_level = 3 from public.permissions where permission_key = 'staff_health.read')
  and (select risk_level = 3 from public.permissions where permission_key = 'staff_health.manage')
  and not exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where permission.permission_key like 'staff_health.%'
      and role.role_key not in ('organization_manager', 'branch_supervisor')
  ),
  'sensitive staff health permissions are independent and narrowly defaulted'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','73010000-0000-4000-8000-000000000001','authenticated','authenticated','vax-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','73010000-0000-4000-8000-000000000002','authenticated','authenticated','vax-worker@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','73010000-0000-4000-8000-000000000003','authenticated','authenticated','vax-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','73010000-0000-4000-8000-000000000004','authenticated','authenticated','vax-no-scope@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('73020000-0000-4000-8000-000000000001','vax_a','疫苗測試機構'),
  ('73020000-0000-4000-8000-000000000002','vax_b','其他疫苗機構');
insert into public.branches (id,organization_id,code,name) values
  ('73030000-0000-4000-8000-000000000001','73020000-0000-4000-8000-000000000001','main','主分支'),
  ('73030000-0000-4000-8000-000000000002','73020000-0000-4000-8000-000000000001','other','其他分支'),
  ('73030000-0000-4000-8000-000000000003','73020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('73010000-0000-4000-8000-000000000001','疫苗主管','staff','V-001',true),
  ('73010000-0000-4000-8000-000000000002','受管員工','professional','V-002',true),
  ('73010000-0000-4000-8000-000000000003','跨分支員工','professional','V-003',true),
  ('73010000-0000-4000-8000-000000000004','無健康權限員工','staff','V-004',true);
insert into public.memberships (id,organization_id,branch_id,profile_id,status) values
  ('73040000-0000-4000-8000-000000000001','73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001','73010000-0000-4000-8000-000000000001','active'),
  ('73040000-0000-4000-8000-000000000002','73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001','73010000-0000-4000-8000-000000000002','active'),
  ('73040000-0000-4000-8000-000000000003','73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000002','73010000-0000-4000-8000-000000000003','active'),
  ('73040000-0000-4000-8000-000000000004','73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001','73010000-0000-4000-8000-000000000004','active');
insert into public.membership_roles (membership_id,role_id) values
  ('73040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('73040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('73040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
  ('73040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006');

select set_config('test.vax_today',
  ((clock_timestamp() at time zone 'Asia/Taipei')::date)::text,true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"73010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- 6
select throws_ok(
  $$select * from public.staff_vaccination_snapshot(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vaccination snapshot is not permitted',
  'AAL1 cannot read sensitive staff vaccination records'
);

-- 7
select throws_ok(
  $$select * from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'create','73071000-0000-4000-8000-000000000001',null,0,
    '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
    current_setting('test.vax_today')::date-10,'SYNTH-LOT-1','合成院所甲',
    'missing',null,null,null,'73080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vaccination write is not permitted',
  'AAL1 cannot append a sensitive staff vaccination record'
);

select set_config('request.jwt.claims',
  '{"sub":"73010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- 8
select results_eq(
  $$select record_total,reminder_total,reminder_schedule_status,
      medical_interpretation_status,attachment_pipeline_status
    from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
    )$$,
  $$values (0::bigint,null::bigint,'not_configured'::text,
    'not_evaluated'::text,'not_configured'::text)$$,
  'empty snapshot does not invent reminders, attachments or medical interpretation'
);

-- 9
select results_eq(
  $$select version,record_status,staff_membership_id,
      duplicate_warning,duplicate_count,duplicate_basis,replayed
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'create','73071000-0000-4000-8000-000000000001',null,0,
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
      current_setting('test.vax_today')::date-10,'SYNTH-LOT-1','合成院所甲',
      'missing',null,null,null,'73080000-0000-4000-8000-000000000001'
    )$$,
  $$values (1,'active'::text,'73040000-0000-4000-8000-000000000002'::uuid,
    false,0,'same_staff_normalized_vaccine_and_dose'::text,false)$$,
  'first record is appended without a duplicate warning'
);
select set_config('test.vax_v1',(select record_version_id::text
  from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'create','73071000-0000-4000-8000-000000000001',null,0,
    '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
    current_setting('test.vax_today')::date-10,'SYNTH-LOT-1','合成院所甲',
    'missing',null,null,null,'73080000-0000-4000-8000-000000000001'
  )),true);

-- 10
select results_eq(
  $$select record_version_id,version,duplicate_count,replayed
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'create','73071000-0000-4000-8000-000000000001',null,0,
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
      current_setting('test.vax_today')::date-10,'SYNTH-LOT-1','合成院所甲',
      'missing',null,null,null,'73080000-0000-4000-8000-000000000001'
    )$$,
  $$select current_setting('test.vax_v1')::uuid,1,0,true$$,
  'exact retry returns the original receipt and does not duplicate a row'
);

-- 11
select throws_ok(
  $$select * from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'create','73071000-0000-4000-8000-000000000001',null,0,
    '73040000-0000-4000-8000-000000000002','不同內容','第 1 劑',
    current_setting('test.vax_today')::date-10,'SYNTH-LOT-1','合成院所甲',
    'missing',null,null,null,'73080000-0000-4000-8000-000000000001'
  )$$, '23505', 'staff vaccination idempotency key reused with different content',
  'reusing an operation key with changed content conflicts'
);

-- 12
select throws_ok(
  $$select * from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'create','73071000-0000-4000-8000-000000000009',null,0,
    '73040000-0000-4000-8000-000000000002','附件測試','第 1 劑',
    current_setting('test.vax_today')::date-8,'SYNTH-LOT-X','合成院所甲',
    'provided','browser://fake',repeat('a',64),null,
    '73080000-0000-4000-8000-000000000009'
  )$$, '22023', 'staff vaccination content or attachment evidence is invalid',
  'untrusted browser attachment references fail closed'
);

-- 13
select throws_ok(
  $$select * from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'create','73071000-0000-4000-8000-000000000008',null,0,
    '73040000-0000-4000-8000-000000000003','跨分支疫苗','第 1 劑',
    current_setting('test.vax_today')::date-8,null,'合成院所甲',
    'missing',null,null,null,'73080000-0000-4000-8000-000000000008'
  )$$, '42501', 'target employee is not current in this branch',
  'cross-branch employee writes are rejected'
);

-- 14
select results_eq(
  $$select duplicate_warning,duplicate_count,replayed
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'create','73071000-0000-4000-8000-000000000002',null,0,
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
      current_setting('test.vax_today')::date-20,'SYNTH-LOT-2','合成院所乙',
      'not_applicable',null,null,null,'73080000-0000-4000-8000-000000000002'
    )$$,
  $$values (true,1,false)$$,
  'same employee vaccine and dose appends a distinct row with warning only'
);
select set_config('test.vax_v2',(select record_version_id::text
  from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'create','73071000-0000-4000-8000-000000000002',null,0,
    '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
    current_setting('test.vax_today')::date-20,'SYNTH-LOT-2','合成院所乙',
    'not_applicable',null,null,null,'73080000-0000-4000-8000-000000000002'
  )),true);

-- 15
select results_eq(
  $$select record_version_id,duplicate_count,replayed
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'create','73071000-0000-4000-8000-000000000002',null,0,
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
      current_setting('test.vax_today')::date-20,'SYNTH-LOT-2','合成院所乙',
      'not_applicable',null,null,null,'73080000-0000-4000-8000-000000000002'
    )$$,
  $$select current_setting('test.vax_v2')::uuid,1,true$$,
  'duplicate-warning operation replay stays correlated to the original receipt'
);

-- 16
select results_eq(
  $$select record_total,duplicate_warning_total,
      jsonb_array_length(records),
      records->0->>'duplicate_basis',records->0->>'medical_interpretation_status'
    from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
    )$$,
  $$values (2::bigint,2::bigint,2,'same_staff_normalized_vaccine_and_dose'::text,
    'not_evaluated'::text)$$,
  'snapshot keeps both duplicate candidates and avoids medical interpretation'
);

-- 17
select results_eq(
  $$select (records->0->>'duplicate_count')::integer,
      jsonb_array_length(records->0->'duplicate_matches'),
      records->0->'duplicate_matches'->0->>'vaccinated_on'
    from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
    )$$,
  $$select 1,1,(current_setting('test.vax_today')::date-20)::text$$,
  'duplicate warning explains the other preserved record date'
);

-- 18
select results_eq(
  $$select duplicate_warning,duplicate_count
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'create','73071000-0000-4000-8000-000000000003',null,0,
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 2 劑',
      current_setting('test.vax_today')::date-5,'SYNTH-LOT-3','合成院所甲',
      'missing',null,null,null,'73080000-0000-4000-8000-000000000003'
    )$$,
  $$values (false,0)$$,
  'a different dose is not classified as the configured duplicate key'
);

-- 19
select results_eq(
  $$select duplicate_warning,duplicate_count
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'create','73071000-0000-4000-8000-000000000004',null,0,
      '73040000-0000-4000-8000-000000000001','合成疫苗甲','第 1 劑',
      current_setting('test.vax_today')::date-3,'SYNTH-LOT-4','合成院所甲',
      'missing',null,null,null,'73080000-0000-4000-8000-000000000004'
    )$$,
  $$values (false,0)$$,
  'the same vaccine and dose for another employee is not a duplicate'
);

-- 20
select results_eq(
  $$select record_total,duplicate_warning_total
    from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',null,null,
      'duplicate_warning','SYNTH'
    )$$,
  $$values (2::bigint,2::bigint)$$,
  'staff, vaccine, dose, status and search filters share one exact snapshot'
);

-- 21
select results_eq(
  $$select record_total
    from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      null,null,null,current_setting('test.vax_today')::date-6,
      current_setting('test.vax_today')::date,'all',null
    )$$,
  $$values (2::bigint)$$,
  'inclusive date filters return the exact records in range'
);

-- 22
select results_eq(
  $$select version,previous_version_id,duplicate_warning,duplicate_count
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'correct','73071000-0000-4000-8000-000000000001',
      current_setting('test.vax_v1')::uuid,1,
      '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
      current_setting('test.vax_today')::date-10,'SYNTH-LOT-1C','合成院所甲',
      'missing',null,null,'修正合成批號',
      '73080000-0000-4000-8000-000000000005'
    )$$,
  $$select 2,current_setting('test.vax_v1')::uuid,true,1$$,
  'correction appends version two and recomputes the explainable warning'
);
select set_config('test.vax_v1c',(select record_version_id::text
  from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'correct','73071000-0000-4000-8000-000000000001',
    current_setting('test.vax_v1')::uuid,1,
    '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
    current_setting('test.vax_today')::date-10,'SYNTH-LOT-1C','合成院所甲',
    'missing',null,null,'修正合成批號',
    '73080000-0000-4000-8000-000000000005'
  )),true);

-- 23
select throws_ok(
  $$select * from public.append_staff_vaccination(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
    'correct','73071000-0000-4000-8000-000000000001',
    current_setting('test.vax_v1')::uuid,1,
    '73040000-0000-4000-8000-000000000002','合成疫苗甲','第 1 劑',
    current_setting('test.vax_today')::date-10,'STALE','合成院所甲',
    'missing',null,null,'過期基準',
    '73080000-0000-4000-8000-000000000006'
  )$$, '40001', 'staff vaccination base version is stale',
  'stale correction bases are rejected'
);

-- 24
select results_eq(
  $$select record_total,history_total from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
    )$$,
  $$values (4::bigint,5::bigint)$$,
  'snapshot exposes terminal records and all immutable history versions'
);

-- 25
select results_eq(
  $$select version,previous_version_id,record_status,duplicate_warning,duplicate_count
    from public.append_staff_vaccination(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001',
      'void','73071000-0000-4000-8000-000000000001',
      current_setting('test.vax_v1c')::uuid,2,
      '73040000-0000-4000-8000-000000000002',
      null,null,null,null,null,null,null,null,'作廢合成誤植紀錄',
      '73080000-0000-4000-8000-000000000007'
    )$$,
  $$select 3,current_setting('test.vax_v1c')::uuid,'voided'::text,false,0$$,
  'void appends a terminal version and copies prior content without overwriting it'
);

-- 26
select results_eq(
  $$select history_total,duplicate_warning_total,
      (select item->>'record_status' from jsonb_array_elements(records) item
        where item->>'vaccination_key'='73071000-0000-4000-8000-000000000001')
    from public.staff_vaccination_snapshot(
      '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
    )$$,
  $$values (6::bigint,0::bigint,'voided'::text)$$,
  'void terminal remains visible while duplicate warnings recompute from active terminals'
);

reset role;
-- 27
select throws_ok(
  $$update public.staff_vaccination_versions set lot_number='OVERWRITE'
    where id=current_setting('test.vax_v1')::uuid$$,
  '23514', 'staff_vaccination_versions is append-only',
  'vaccination versions cannot be updated even by the owner'
);

-- 28
select throws_ok(
  $$delete from public.staff_vaccination_versions
    where id=current_setting('test.vax_v1')::uuid$$,
  '23514', 'staff_vaccination_versions is append-only',
  'vaccination versions cannot be deleted even by the owner'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"73010000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
-- 29
select throws_ok(
  $$select * from public.staff_vaccination_snapshot(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vaccination snapshot is not permitted',
  'AAL2 without the independent staff-health permission cannot read details'
);

select set_config('request.jwt.claims',
  '{"sub":"73010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
-- 30
select throws_ok(
  $$select * from public.staff_vaccination_snapshot(
    '73020000-0000-4000-8000-000000000001','73030000-0000-4000-8000-000000000002'
  )$$, '42501', 'staff vaccination snapshot is not permitted',
  'current branch scope cannot be bypassed by a function argument'
);

-- 31
select throws_ok(
  $$select * from private.staff_vaccination_operations$$,
  '42501', 'permission denied for table staff_vaccination_operations',
  'private idempotency receipts cannot be read directly'
);

reset role;
-- 32
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'staff_vaccination_snapshot'
      and action = 'select'
      and metadata ->> 'workflow' = 'page73_staff_vaccinations_v1')
  and not exists (select 1 from public.audit_events
    where table_name in (
      'staff_vaccination_snapshot','public.staff_vaccination_versions'
    ) and metadata::text like '%SYNTH-LOT%'),
  'reads and writes are audited without health values in metadata'
);

select * from finish();
rollback;
