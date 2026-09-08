begin;

select plan(38);

-- 1
select ok(
  has_function_privilege('authenticated',
    'public.staff_lab_report_snapshot(uuid,uuid,uuid,text,text,text,text,date,date,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.append_staff_lab_report(uuid,uuid,text,uuid,uuid,integer,uuid,text,date,text,text,date,text,text,text,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_lab_report_snapshot_bundle(uuid,uuid,timestamptz,uuid,text,text,text,text,date,date,text)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_lab_report_authority(uuid,uuid,text,boolean)', 'execute'),
  'public invoker functions are callable while private health helpers stay sealed'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.staff_lab_report_versions', 'select')
  and not has_table_privilege('authenticated', 'public.staff_lab_report_versions', 'insert')
  and not has_table_privilege('service_role', 'public.staff_lab_report_versions', 'select')
  and not has_table_privilege('authenticated',
    'private.staff_lab_report_operations', 'select'),
  'direct report and operation table access is denied'
);

-- 3
select ok(
  (select count(*) = 4 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private')
    )
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','append_staff_lab_report'),
      ('public','staff_lab_report_snapshot'),
      ('private','append_staff_lab_report_guarded'),
      ('private','staff_lab_report_snapshot_response')
    )),
  'private boundaries are pinned definers and public wrappers are pinned invokers'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.staff_lab_report_versions'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_lab_report_versions_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_lab_report_versions_audit_row_change' and not tgisinternal),
  'report versions force RLS and have append-only and audit triggers'
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
  'independent staff-health permissions are high risk and narrowly defaulted'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','78010000-0000-4000-8000-000000000001','authenticated','authenticated','lab-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','78010000-0000-4000-8000-000000000002','authenticated','authenticated','lab-worker@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','78010000-0000-4000-8000-000000000003','authenticated','authenticated','lab-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','78010000-0000-4000-8000-000000000004','authenticated','authenticated','lab-no-health@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('78020000-0000-4000-8000-000000000001','lab_a','檢驗報告測試機構'),
  ('78020000-0000-4000-8000-000000000002','lab_b','其他檢驗機構');
insert into public.branches (id,organization_id,code,name) values
  ('78030000-0000-4000-8000-000000000001','78020000-0000-4000-8000-000000000001','main','主分支'),
  ('78030000-0000-4000-8000-000000000002','78020000-0000-4000-8000-000000000001','other','其他分支'),
  ('78030000-0000-4000-8000-000000000003','78020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('78010000-0000-4000-8000-000000000001','檢驗主管','staff','L-001',true),
  ('78010000-0000-4000-8000-000000000002','受管員工','professional','L-002',true),
  ('78010000-0000-4000-8000-000000000003','跨分支員工','professional','L-003',true),
  ('78010000-0000-4000-8000-000000000004','一般員工','staff','L-004',true);
insert into public.memberships (id,organization_id,branch_id,profile_id,status) values
  ('78040000-0000-4000-8000-000000000001','78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001','78010000-0000-4000-8000-000000000001','active'),
  ('78040000-0000-4000-8000-000000000002','78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001','78010000-0000-4000-8000-000000000002','active'),
  ('78040000-0000-4000-8000-000000000003','78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000002','78010000-0000-4000-8000-000000000003','active'),
  ('78040000-0000-4000-8000-000000000004','78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001','78010000-0000-4000-8000-000000000004','active');
insert into public.membership_roles (membership_id,role_id) values
  ('78040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('78040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('78040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
  ('78040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006');

select set_config('test.lab_today',
  ((clock_timestamp() at time zone 'Asia/Taipei')::date)::text,true);

create temporary table lab_reauth_times as select
  clock_timestamp() - interval '30 seconds' as recent_verified,
  clock_timestamp() - interval '20 minutes' as old_verified;
insert into private.reauth_challenges (
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,
  factor_verified_at
)
select '78060000-0000-4000-8000-000000000001'::uuid,
  '78010000-0000-4000-8000-000000000001'::uuid,
  '78061000-0000-4000-8000-000000000001'::uuid,repeat('a',64),
  '78062000-0000-4000-8000-000000000001'::uuid,recent_verified-interval '1 minute',
  recent_verified-interval '1 minute',recent_verified+interval '5 minutes',
  recent_verified,recent_verified,'totp',recent_verified from lab_reauth_times
union all
select '78060000-0000-4000-8000-000000000002','78010000-0000-4000-8000-000000000001',
  '78061000-0000-4000-8000-000000000002',repeat('b',64),
  '78062000-0000-4000-8000-000000000002',old_verified-interval '1 minute',
  old_verified-interval '1 minute',old_verified+interval '5 minutes',
  old_verified,old_verified,'totp',old_verified from lab_reauth_times
union all
select '78060000-0000-4000-8000-000000000004','78010000-0000-4000-8000-000000000004',
  '78061000-0000-4000-8000-000000000004',repeat('d',64),
  '78062000-0000-4000-8000-000000000004',recent_verified-interval '1 minute',
  recent_verified-interval '1 minute',recent_verified+interval '5 minutes',
  recent_verified,recent_verified,'totp',recent_verified from lab_reauth_times;
insert into private.reauth_events (
  user_id,session_id,challenge_id,aal,verification_method,verified_at
)
select '78010000-0000-4000-8000-000000000001'::uuid,
  '78061000-0000-4000-8000-000000000001'::uuid,
  '78060000-0000-4000-8000-000000000001'::uuid,'aal2','totp',recent_verified
  from lab_reauth_times
union all
select '78010000-0000-4000-8000-000000000001','78061000-0000-4000-8000-000000000002',
  '78060000-0000-4000-8000-000000000002','aal2','totp',old_verified
  from lab_reauth_times
union all
select '78010000-0000-4000-8000-000000000004','78061000-0000-4000-8000-000000000004',
  '78060000-0000-4000-8000-000000000004','aal2','totp',recent_verified
  from lab_reauth_times;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"78061000-0000-4000-8000-000000000001"}',true);

-- 6
select throws_ok(
  $$select * from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff lab report snapshot is not permitted',
  'AAL1 cannot read employee laboratory results'
);

-- 7
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000001',null,0,
    '78040000-0000-4000-8000-000000000002','合成檢驗甲',current_date,
    '合成院所','合成結果',current_date,'合成效期依據','missing',null,null,null,
    '78080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff lab report write is not permitted',
  'AAL1 cannot append an employee laboratory report'
);

select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
-- 8
select throws_ok(
  $$select * from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff lab report snapshot is not permitted',
  'AAL2 without same-session recent evidence cannot read health details'
);

select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"78061000-0000-4000-8000-000000000099"}',true);
-- 9
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000001',null,0,
    '78040000-0000-4000-8000-000000000002','合成檢驗甲',current_date,
    '合成院所','合成結果',current_date,'合成效期依據','missing',null,null,null,
    '78080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff lab report write is not permitted',
  'recent evidence from another session cannot authorize a write'
);

select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"78061000-0000-4000-8000-000000000002"}',true);
-- 10
select throws_ok(
  $$select * from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff lab report snapshot is not permitted',
  'expired same-session AAL2 evidence cannot authorize a read'
);

select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"78061000-0000-4000-8000-000000000001"}',true);

-- 11
select results_eq(
  $$select record_total,validity_rule_status,expiry_reminder_schedule_status,
      expiry_notice_days,expiring_total,medical_interpretation_status,
      attachment_pipeline_status,attachment_scan_status,recent_aal2_max_age_minutes
    from public.staff_lab_report_snapshot(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
    )$$,
  $$values (0::bigint,'not_configured'::text,'not_configured'::text,
    null::integer,null::bigint,'not_evaluated'::text,'not_configured'::text,
    'not_configured'::text,15)$$,
  'empty snapshot does not invent rules, reminders, attachment trust or diagnosis'
);

-- 12
select results_eq(
  $$select version,record_status,completion_status,exact_duplicate_count,
      key_field_duplicate_count,duplicate_warning,duplicate_basis,replayed
    from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'create','78071000-0000-4000-8000-000000000001',null,0,
      '78040000-0000-4000-8000-000000000002','合成檢驗甲',
      current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-ALPHA',
      current_setting('test.lab_today')::date-1,'SENSITIVE-BASIS-ALPHA',
      'missing',null,null,null,'78080000-0000-4000-8000-000000000001'
    )$$,
  $$values (1,'active'::text,'completed'::text,0,0,false,
    'exact_content_or_same_staff_type_tested_on_provider'::text,false)$$,
  'first completed report appends without a duplicate warning'
);
select set_config('test.lab_v1',(select record_version_id::text
  from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000001',null,0,
    '78040000-0000-4000-8000-000000000002','合成檢驗甲',
    current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-ALPHA',
    current_setting('test.lab_today')::date-1,'SENSITIVE-BASIS-ALPHA',
    'missing',null,null,null,'78080000-0000-4000-8000-000000000001'
  )),true);

-- 13
select results_eq(
  $$select record_version_id,version,exact_duplicate_count,
      key_field_duplicate_count,replayed from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'create','78071000-0000-4000-8000-000000000001',null,0,
      '78040000-0000-4000-8000-000000000002','合成檢驗甲',
      current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-ALPHA',
      current_setting('test.lab_today')::date-1,'SENSITIVE-BASIS-ALPHA',
      'missing',null,null,null,'78080000-0000-4000-8000-000000000001'
    )$$,
  $$select current_setting('test.lab_v1')::uuid,1,0,0,true$$,
  'exact retry returns the immutable original receipt'
);

-- 14
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000001',null,0,
    '78040000-0000-4000-8000-000000000002','不同檢驗',
    current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-ALPHA',
    current_setting('test.lab_today')::date-1,'SENSITIVE-BASIS-ALPHA',
    'missing',null,null,null,'78080000-0000-4000-8000-000000000001'
  )$$, '23505', 'staff lab report idempotency key reused with different content',
  'actor-scoped operation key cannot be reused with changed content'
);

-- 15
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000009',null,0,
    '78040000-0000-4000-8000-000000000002','附件測試',current_date,
    '合成院所','附件結果',current_date,'附件效期依據',
    'provided','browser://fake',repeat('a',64),null,
    '78080000-0000-4000-8000-000000000009'
  )$$, '22023', 'staff lab report content or attachment evidence is invalid',
  'untrusted browser attachment references fail closed'
);

-- 16
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000008',null,0,
    '78040000-0000-4000-8000-000000000002','反向效期',current_date,
    '合成院所','合成結果',current_date-1,'人工效期依據',
    'missing',null,null,null,'78080000-0000-4000-8000-000000000008'
  )$$, '22023', 'staff lab report content or attachment evidence is invalid',
  'manual valid-through cannot precede the tested date'
);

-- 17
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000007',null,0,
    '78040000-0000-4000-8000-000000000003','跨分支檢驗',current_date,
    '合成院所','跨分支結果',current_date,'人工效期依據',
    'missing',null,null,null,'78080000-0000-4000-8000-000000000007'
  )$$, '42501', 'target employee is not current in this branch',
  'cross-branch employee writes are rejected'
);

-- 18
select results_eq(
  $$select exact_duplicate_count,key_field_duplicate_count,duplicate_warning,replayed
    from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'create','78071000-0000-4000-8000-000000000002',null,0,
      '78040000-0000-4000-8000-000000000002',' 合成檢驗甲 ',
      current_setting('test.lab_today')::date-10,' 合成院所甲 ','SENSITIVE-RESULT-ALPHA',
      current_setting('test.lab_today')::date-1,'SENSITIVE-BASIS-ALPHA',
      'missing',null,null,null,'78080000-0000-4000-8000-000000000002'
    )$$,
  $$values (1,1,true,false)$$,
  'identical normalized content appends separately with an exact warning'
);
select set_config('test.lab_v2',(select record_version_id::text
  from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000002',null,0,
    '78040000-0000-4000-8000-000000000002',' 合成檢驗甲 ',
    current_setting('test.lab_today')::date-10,' 合成院所甲 ','SENSITIVE-RESULT-ALPHA',
    current_setting('test.lab_today')::date-1,'SENSITIVE-BASIS-ALPHA',
    'missing',null,null,null,'78080000-0000-4000-8000-000000000002'
  )),true);

-- 19
select results_eq(
  $$select exact_duplicate_count,key_field_duplicate_count,duplicate_warning
    from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'create','78071000-0000-4000-8000-000000000003',null,0,
      '78040000-0000-4000-8000-000000000002','合成檢驗甲',
      current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-BETA',
      current_setting('test.lab_today')::date+20,'SENSITIVE-BASIS-BETA',
      'not_applicable',null,null,null,'78080000-0000-4000-8000-000000000003'
    )$$,
  $$values (0,2,true)$$,
  'same key fields with different content append separately with an explainable warning'
);
select set_config('test.lab_v3',(select record_version_id::text
  from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000003',null,0,
    '78040000-0000-4000-8000-000000000002','合成檢驗甲',
    current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-BETA',
    current_setting('test.lab_today')::date+20,'SENSITIVE-BASIS-BETA',
    'not_applicable',null,null,null,'78080000-0000-4000-8000-000000000003'
  )),true);

-- 20
select results_eq(
  $$select record_total,active_total,expired_total,missing_evidence_total,
      duplicate_warning_total,medical_interpretation_status
    from public.staff_lab_report_snapshot(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,1::bigint,2::bigint,2::bigint,3::bigint,
    'not_evaluated'::text)$$,
  'terminal metrics derive only from manual dates, evidence and duplicate facts'
);

-- 21
select results_eq(
  $$select (item->>'exact_duplicate_count')::integer,
      (item->>'key_field_duplicate_count')::integer,item->'duplicate_bases',
      jsonb_array_length(item->'duplicate_matches')
    from public.staff_lab_report_snapshot(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
    ), lateral jsonb_array_elements(records) item
    where item->>'report_key'='78071000-0000-4000-8000-000000000001'$$,
  $$values (1,2,'["exact_content", "same_staff_type_tested_on_provider"]'::jsonb,2)$$,
  'each exact duplicate includes both exact and key-only match evidence'
);

-- 22
select results_eq(
  $$select (item->>'exact_duplicate_count')::integer,
      (item->>'key_field_duplicate_count')::integer,item->'duplicate_bases',
      jsonb_array_length(item->'duplicate_matches'),
      bool_and(match->>'tested_on'=(current_setting('test.lab_today')::date-10)::text)
    from public.staff_lab_report_snapshot(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
    ), lateral jsonb_array_elements(records) item,
      lateral jsonb_array_elements(item->'duplicate_matches') match
    where item->>'report_key'='78071000-0000-4000-8000-000000000003'
    group by item$$,
  $$values (0,2,'["same_staff_type_tested_on_provider"]'::jsonb,2,true)$$,
  'key-only duplicate evidence names both preserved records and the shared test date'
);

-- 23
select results_eq(
  $$select record_total,duplicate_warning_total from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    null,null,'all','exact','all',null,null,null
  )$$,
  $$values (2::bigint,2::bigint)$$,
  'exact-content filter returns only the exact pair without merging it'
);

-- 24
select results_eq(
  $$select record_total,duplicate_warning_total from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    '78040000-0000-4000-8000-000000000002','合成檢驗甲','expired','key_fields',
    'missing',current_setting('test.lab_today')::date-10,
    current_setting('test.lab_today')::date-10,'SENSITIVE-RESULT'
  )$$,
  $$values (2::bigint,2::bigint)$$,
  'staff, type, manual validity, duplicate, evidence, inclusive dates and search share one snapshot'
);

-- 25
select results_eq(
  $$select exact_duplicate_count,key_field_duplicate_count
    from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'create','78071000-0000-4000-8000-000000000004',null,0,
      '78040000-0000-4000-8000-000000000001','合成檢驗甲',
      current_setting('test.lab_today')::date-10,'合成院所甲','SENSITIVE-RESULT-ALPHA',
      current_setting('test.lab_today')::date+30,'其他員工人工依據',
      'missing',null,null,null,'78080000-0000-4000-8000-000000000004'
    )$$,
  $$values (0,0)$$,
  'the same report fields for another employee are not duplicate candidates'
);

-- 26
select results_eq(
  $$select version,previous_version_id,record_status,exact_duplicate_count,
      key_field_duplicate_count from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'correct','78071000-0000-4000-8000-000000000001',
      current_setting('test.lab_v1')::uuid,1,
      '78040000-0000-4000-8000-000000000002','合成檢驗甲',
      current_setting('test.lab_today')::date-10,'合成院所甲','更正後人工照錄結果',
      current_setting('test.lab_today')::date+30,'更正後人工效期依據',
      'missing',null,null,'更正來源文字與效期',
      '78080000-0000-4000-8000-000000000005'
    )$$,
  $$select 2,current_setting('test.lab_v1')::uuid,'active'::text,0,2$$,
  'correction appends version two and recomputes exact duplicate evidence'
);
select set_config('test.lab_v1c',(select record_version_id::text
  from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'correct','78071000-0000-4000-8000-000000000001',
    current_setting('test.lab_v1')::uuid,1,
    '78040000-0000-4000-8000-000000000002','合成檢驗甲',
    current_setting('test.lab_today')::date-10,'合成院所甲','更正後人工照錄結果',
    current_setting('test.lab_today')::date+30,'更正後人工效期依據',
    'missing',null,null,'更正來源文字與效期',
    '78080000-0000-4000-8000-000000000005'
  )),true);

-- 27
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'correct','78071000-0000-4000-8000-000000000001',
    current_setting('test.lab_v1')::uuid,1,
    '78040000-0000-4000-8000-000000000002','合成檢驗甲',
    current_date,'合成院所甲','過期基準結果',current_date,'過期基準',
    'missing',null,null,'使用過期基準','78080000-0000-4000-8000-000000000006'
  )$$, '40001', 'staff lab report base version is stale',
  'stale correction bases are rejected'
);

-- 28
select results_eq(
  $$select record_total,history_total from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
  )$$,
  $$values (4::bigint,5::bigint)$$,
  'snapshot returns four terminal reports and all five immutable versions'
);

-- 29
select results_eq(
  $$select version,previous_version_id,record_status,exact_duplicate_count,
      key_field_duplicate_count,duplicate_warning from public.append_staff_lab_report(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
      'void','78071000-0000-4000-8000-000000000003',
      current_setting('test.lab_v3')::uuid,1,
      '78040000-0000-4000-8000-000000000002',null,null,null,null,null,null,
      null,null,null,'作廢合成誤植報告','78080000-0000-4000-8000-000000000007'
    )$$,
  $$select 2,current_setting('test.lab_v3')::uuid,'voided'::text,0,0,false$$,
  'void appends a terminal version and copies prior content without overwriting it'
);

-- 30
select results_eq(
  $$select history_total,duplicate_warning_total,
      (select item->>'record_status' from jsonb_array_elements(records) item
        where item->>'report_key'='78071000-0000-4000-8000-000000000003')
    from public.staff_lab_report_snapshot(
      '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
    )$$,
  $$values (6::bigint,2::bigint,'voided'::text)$$,
  'void terminal remains visible while active duplicate warnings recompute'
);

reset role;
-- 31
select throws_ok(
  $$update public.staff_lab_report_versions set result_text='OVERWRITE'
    where id=current_setting('test.lab_v1')::uuid$$,
  '23514', 'staff_lab_report_versions is append-only',
  'completed report versions cannot be updated'
);

-- 32
select throws_ok(
  $$delete from public.staff_lab_report_versions
    where id=current_setting('test.lab_v1')::uuid$$,
  '23514', 'staff_lab_report_versions is append-only',
  'completed report versions cannot be deleted'
);

-- 33
select ok(
  (select reauth_challenge_id='78060000-0000-4000-8000-000000000001'
    from public.staff_lab_report_versions where id=current_setting('test.lab_v1')::uuid)
  and (select reauth_challenge_id='78060000-0000-4000-8000-000000000001'
    from private.staff_lab_report_operations
    where result_record_version_id=current_setting('test.lab_v1')::uuid),
  'version and actor-scoped receipt preserve the concrete same-session AAL2 evidence'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"78061000-0000-4000-8000-000000000004"}',true);
-- 34
select throws_ok(
  $$select * from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff lab report snapshot is not permitted',
  'general staff permission does not substitute for independent staff-health read'
);

-- 35
select throws_ok(
  $$select * from public.append_staff_lab_report(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000001',
    'create','78071000-0000-4000-8000-000000000010',null,0,
    '78040000-0000-4000-8000-000000000004','無權限檢驗',current_date,
    '合成院所','無權限結果',current_date,'人工依據','missing',null,null,null,
    '78080000-0000-4000-8000-000000000010'
  )$$, '42501', 'staff lab report write is not permitted',
  'general staff permission does not substitute for independent health manage'
);

select set_config('request.jwt.claims',
  '{"sub":"78010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"78061000-0000-4000-8000-000000000001"}',true);
-- 36
select throws_ok(
  $$select * from public.staff_lab_report_snapshot(
    '78020000-0000-4000-8000-000000000001','78030000-0000-4000-8000-000000000002'
  )$$, '42501', 'staff lab report snapshot is not permitted',
  'current branch scope cannot be bypassed by function arguments'
);

-- 37
select throws_ok(
  $$select * from private.staff_lab_report_operations$$,
  '42501', 'permission denied for table staff_lab_report_operations',
  'private actor-scoped idempotency receipts cannot be read directly'
);

reset role;
-- 38
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'staff_lab_report_snapshot' and action = 'select'
      and metadata ->> 'workflow' = 'page78_staff_lab_reports_v1')
  and not exists (select 1 from public.audit_events
    where table_name in ('staff_lab_report_snapshot','public.staff_lab_report_versions')
      and (metadata::text like '%SENSITIVE-RESULT%'
        or metadata::text like '%SENSITIVE-BASIS%'
        or metadata::text like '%合成院所甲%')),
  'every view and write is audited without result, search, basis or provider content'
);

select * from finish();
rollback;
