begin;

select plan(36);

-- 1
select ok(
  has_function_privilege(
    'authenticated',
    'public.staff_training_snapshot(uuid,uuid,date,date,uuid,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.append_staff_training_record(uuid,uuid,text,uuid,uuid,integer,uuid,text,date,timestamptz,timestamptz,text,numeric,numeric,text,text,text,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.staff_training_snapshot_bundle(uuid,uuid,timestamptz,date,date,uuid,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.staff_training_current_authority(uuid,uuid,text)',
    'execute'
  ),
  'public invoker boundaries are callable while private helpers stay sealed'
);

-- 2
select ok(
  not has_table_privilege(
    'authenticated', 'public.staff_training_record_versions', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.staff_training_record_versions', 'insert'
  )
  and not has_table_privilege(
    'service_role', 'public.staff_training_record_versions', 'select'
  )
  and not has_table_privilege(
    'service_role', 'public.staff_training_record_versions', 'insert'
  ),
  'direct record access is denied including service_role'
);

-- 3
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.staff_training_record_versions'::regclass)
  and exists (
    select 1 from pg_trigger
    where tgname = 'staff_training_record_versions_append_only'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'staff_training_record_versions_audit_row_change'
      and not tgisinternal
  ),
  'training records force RLS and have exact append-only and audit triggers'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','71010000-0000-4000-8000-000000000001','authenticated','authenticated','training-manager-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','71010000-0000-4000-8000-000000000002','authenticated','authenticated','training-manager-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','71010000-0000-4000-8000-000000000003','authenticated','authenticated','training-worker@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','71010000-0000-4000-8000-000000000004','authenticated','authenticated','training-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','71010000-0000-4000-8000-000000000005','authenticated','authenticated','training-inactive@example.invalid','',now(),'{}','{}',now(),now());

insert into public.organizations (id, code, name) values
  ('71020000-0000-4000-8000-000000000001','training_a','教育訓練測試機構'),
  ('71020000-0000-4000-8000-000000000002','training_b','其他教育訓練機構');
insert into public.branches (id, organization_id, code, name) values
  ('71030000-0000-4000-8000-000000000001','71020000-0000-4000-8000-000000000001','main','主分支'),
  ('71030000-0000-4000-8000-000000000002','71020000-0000-4000-8000-000000000001','other','其他分支'),
  ('71030000-0000-4000-8000-000000000003','71020000-0000-4000-8000-000000000002','main','其他機構分支');
insert into public.profiles (id, display_name, kind, employee_code, is_active) values
  ('71010000-0000-4000-8000-000000000001','訓練主管甲','staff','T-001',true),
  ('71010000-0000-4000-8000-000000000002','訓練主管乙','staff','T-002',true),
  ('71010000-0000-4000-8000-000000000003','受訓員工','staff','T-003',true),
  ('71010000-0000-4000-8000-000000000004','跨分支員工','staff','T-004',true),
  ('71010000-0000-4000-8000-000000000005','離職員工','staff','T-005',false);
insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('71040000-0000-4000-8000-000000000001','71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001','71010000-0000-4000-8000-000000000001','active'),
  ('71040000-0000-4000-8000-000000000002','71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001','71010000-0000-4000-8000-000000000002','active'),
  ('71040000-0000-4000-8000-000000000003','71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001','71010000-0000-4000-8000-000000000003','active'),
  ('71040000-0000-4000-8000-000000000004','71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000002','71010000-0000-4000-8000-000000000004','active'),
  ('71040000-0000-4000-8000-000000000005','71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001','71010000-0000-4000-8000-000000000005','suspended');
insert into public.membership_roles (membership_id, role_id) values
  ('71040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('71040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'),
  ('71040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
  ('71040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003'),
  ('71040000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006');

select set_config(
  'test.training_verified_at',
  (clock_timestamp() - interval '30 seconds')::text, true
);
insert into private.reauth_challenges (
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,
  consumed_jwt_jti,factor_method,factor_verified_at
) values
  ('71060000-0000-4000-8000-000000000001','71010000-0000-4000-8000-000000000001','71061000-0000-4000-8000-000000000001',repeat('1',64),'71062000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 minutes','before-a',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',current_setting('test.training_verified_at')::timestamptz,current_setting('test.training_verified_at')::timestamptz,'after-a','totp',current_setting('test.training_verified_at')::timestamptz),
  ('71060000-0000-4000-8000-000000000002','71010000-0000-4000-8000-000000000002','71061000-0000-4000-8000-000000000002',repeat('2',64),'71062000-0000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes','before-b',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',current_setting('test.training_verified_at')::timestamptz,current_setting('test.training_verified_at')::timestamptz,'after-b','totp',current_setting('test.training_verified_at')::timestamptz);
insert into private.reauth_events (
  user_id,session_id,challenge_id,aal,verification_method,verified_at
) values
  ('71010000-0000-4000-8000-000000000001','71061000-0000-4000-8000-000000000001','71060000-0000-4000-8000-000000000001','aal2','totp',current_setting('test.training_verified_at')::timestamptz),
  ('71010000-0000-4000-8000-000000000002','71061000-0000-4000-8000-000000000002','71060000-0000-4000-8000-000000000002','aal2','totp',current_setting('test.training_verified_at')::timestamptz);

select set_config(
  'test.training_day',
  ((clock_timestamp() at time zone 'Asia/Taipei')::date - 10)::text, true
);
select set_config(
  'test.training_start',
  (current_setting('test.training_day')::date::text || ' 09:00:00+08')::timestamptz::text,
  true
);
select set_config(
  'test.training_end',
  (current_setting('test.training_day')::date::text || ' 12:00:00+08')::timestamptz::text,
  true
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"71010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"71061000-0000-4000-8000-000000000001"}',true);

-- 4
select throws_ok(
  $$select * from public.staff_training_snapshot(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff training snapshot is not permitted',
  'AAL1 cannot read staff training'
);
-- 5
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000001',null,0,
    '71040000-0000-4000-8000-000000000003','基本訓練',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,10,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff training record write is not permitted',
  'AAL1 cannot append a training record'
);

select set_config('request.jwt.claims','{"sub":"71010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"71061000-0000-4000-8000-000000000001"}',true);

-- 6
select results_eq(
  $$select policy_status,record_total,expiring_total,gap_staff_total,
           attachment_pipeline_status
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
    )$$,
  $$values ('not_configured'::text,0::bigint,null::bigint,null::bigint,
    'not_configured'::text)$$,
  'empty snapshot does not invent a points rule or attachment pipeline'
);

-- 7
select results_eq(
  $$select version,record_status,staff_membership_id,replayed
    from public.append_staff_training_record(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
      'create','71070000-0000-4000-8000-000000000001',null,0,
      '71040000-0000-4000-8000-000000000003','基本訓練',current_setting('test.training_day')::date,
      current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
      '機構自訂類型',3,10,'測試單位','missing',null,null,null,
      '71080000-0000-4000-8000-000000000001'
    )$$,
  $$values (1,'active'::text,'71040000-0000-4000-8000-000000000003'::uuid,false)$$,
  'new record persists against a stable membership id'
);
select set_config(
  'test.training_v1',
  (select record_version_id::text from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000001',null,0,
    '71040000-0000-4000-8000-000000000003','基本訓練',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,10,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000001'
  )), true
);

-- 8
select results_eq(
  $$select record_version_id,version,replayed from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000001',null,0,
    '71040000-0000-4000-8000-000000000003','基本訓練',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,10,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000001'
  )$$,
  $$select current_setting('test.training_v1')::uuid,1,true$$,
  'same actor and exact content replay the original record receipt'
);

-- 9
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000001',null,0,
    '71040000-0000-4000-8000-000000000003','變更課程',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,10,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000001'
  )$$, '23505', 'staff training idempotency key reused with different content',
  'changed content under an existing key conflicts'
);

-- 10
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000002',null,0,
    '71040000-0000-4000-8000-000000000003','精度錯誤',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',1.00001,10,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000002'
  )$$, '22023', 'staff training content or attachment evidence is invalid',
  'hours with more than four decimal places are rejected'
);

-- 11
-- Use the same captured day for every field: now + 1 hour can cross midnight
-- in Taipei and accidentally test date/start consistency instead of completion.
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000003',null,0,
    '71040000-0000-4000-8000-000000000003','未完成課程',current_setting('test.training_day')::date + 11,
    current_setting('test.training_start')::timestamptz + interval '11 days',
    current_setting('test.training_start')::timestamptz + interval '11 days 1 hour',
    '機構自訂類型',1,10,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000003'
  )$$, '22023', 'future training completion cannot be recorded',
  'a future course cannot be committed as completed'
);

-- 12
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000004',null,0,
    '71040000-0000-4000-8000-000000000003','附件測試',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',1,10,'測試單位','provided','client://fake',repeat('a',64),null,
    '71080000-0000-4000-8000-000000000004'
  )$$, '22023', 'staff training content or attachment evidence is invalid',
  'untrusted client attachment references fail closed while pipeline is unconfigured'
);

-- 13
select results_eq(
  $$select version,previous_version_id,record_status from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'correct','71070000-0000-4000-8000-000000000001',current_setting('test.training_v1')::uuid,1,
    '71040000-0000-4000-8000-000000000003','基本訓練（更正）',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,12.5,'測試單位','missing',null,null,'更正積分',
    '71080000-0000-4000-8000-000000000005'
  )$$,
  $$select 2,current_setting('test.training_v1')::uuid,'active'::text$$,
  'correction appends version two and preserves the previous link'
);
select set_config(
  'test.training_v2',
  (select record_version_id::text from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'correct','71070000-0000-4000-8000-000000000001',current_setting('test.training_v1')::uuid,1,
    '71040000-0000-4000-8000-000000000003','基本訓練（更正）',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,12.5,'測試單位','missing',null,null,'更正積分',
    '71080000-0000-4000-8000-000000000005'
  )), true
);

-- 14
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'correct','71070000-0000-4000-8000-000000000001',current_setting('test.training_v1')::uuid,1,
    '71040000-0000-4000-8000-000000000003','分叉更正',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,13,'測試單位','missing',null,null,'錯誤基線',
    '71080000-0000-4000-8000-000000000006'
  )$$, '40001', 'staff training base version is stale',
  'stale correction cannot fork the immutable chain'
);

-- 15
select results_eq(
  $$select version,previous_version_id,record_status from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'void','71070000-0000-4000-8000-000000000001',current_setting('test.training_v2')::uuid,2,
    '71040000-0000-4000-8000-000000000003',null,null,null,null,null,null,null,null,null,null,null,
    '重複登錄作廢','71080000-0000-4000-8000-000000000007'
  )$$,
  $$select 3,current_setting('test.training_v2')::uuid,'voided'::text$$,
  'void appends a terminal version without rewriting prior content'
);
select set_config(
  'test.training_v3',
  (select record_version_id::text from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'void','71070000-0000-4000-8000-000000000001',current_setting('test.training_v2')::uuid,2,
    '71040000-0000-4000-8000-000000000003',null,null,null,null,null,null,null,null,null,null,null,
    '重複登錄作廢','71080000-0000-4000-8000-000000000007'
  )), true
);

-- 16
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'correct','71070000-0000-4000-8000-000000000001',
    current_setting('test.training_v3')::uuid,3,
    '71040000-0000-4000-8000-000000000003','作廢後更正',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',3,13,'測試單位','missing',null,null,'不得更正',
    '71080000-0000-4000-8000-000000000008'
  )$$, '40001', 'staff training base version is stale',
  'a voided chain cannot receive another correction'
);

-- 17
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000005',null,0,
    '71040000-0000-4000-8000-000000000004','跨分支',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',1,1,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000009'
  )$$, '42501', 'target employee is not current in this branch',
  'cross-branch employee target is rejected'
);

-- 18
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000006',null,0,
    '71040000-0000-4000-8000-000000000005','離職後新增',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '機構自訂類型',1,1,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000010'
  )$$, '42501', 'target employee is not current in this branch',
  'inactive employee cannot receive a new training record'
);

-- Create an active manager record with missing credits.
select * from public.append_staff_training_record(
  '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
  'create','71070000-0000-4000-8000-000000000010',null,0,
  '71040000-0000-4000-8000-000000000001','主管課程',current_setting('test.training_day')::date,
  current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
  '管理類',3,null,'測試單位','not_applicable',null,null,null,
  '71080000-0000-4000-8000-000000000011'
);

-- Create an expiring-window worker record.
select set_config(
  'test.training_expiring_day',
  (((clock_timestamp() at time zone 'Asia/Taipei')::date - interval '6 years')::date + 10)::text,
  true
);
select * from public.append_staff_training_record(
  '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
  'create','71070000-0000-4000-8000-000000000011',null,0,
  '71040000-0000-4000-8000-000000000003','視窗積分課程',current_setting('test.training_expiring_day')::date,
  (current_setting('test.training_expiring_day')::date::text || ' 09:00:00+08')::timestamptz,
  (current_setting('test.training_expiring_day')::date::text || ' 11:00:00+08')::timestamptz,
  '照顧類',2,50,'測試單位','not_applicable',null,null,null,
  '71080000-0000-4000-8000-000000000012'
);

-- 19
select results_eq(
  $$select record_total,hours_total,credits_total,missing_credit_total,
           missing_evidence_total,expiring_total
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,'5.0000'::text,'50.0000'::text,1::bigint,0::bigint,null::bigint)$$,
  'only active terminal records drive valid hours and credits while missing values stay distinct'
);

-- 20
select results_eq(
  $$select record_total,jsonb_array_length(records),credits_total
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
      null,null,null,'管理類','active',null
    )$$,
  $$values (1::bigint,1,null::text)$$,
  'server-side course and status filters apply before aggregates and limits'
);

-- 21
select throws_ok(
  $$select * from public.staff_training_snapshot(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    null,null,null,null,'invented',null
  )$$, '42501', 'staff training snapshot is not permitted',
  'unknown snapshot status fails closed'
);

-- 22
select results_eq(
  $$select action,window_years,required_credits,expiry_notice_days,replayed
    from public.propose_staff_training_rule(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
      (clock_timestamp() at time zone 'Asia/Taipei')::date,null,6,120,30,
      '71090000-0000-4000-8000-000000000001'
    )$$,
  $$values ('propose'::text,6,'120.0000'::text,30,false)$$,
  'rule values are institution-proposed rather than hard-coded'
);
select set_config(
  'test.training_proposal',
  (select proposal_id::text from public.propose_staff_training_rule(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    (clock_timestamp() at time zone 'Asia/Taipei')::date,null,6,120,30,
    '71090000-0000-4000-8000-000000000001'
  )), true
);

-- 23
select results_eq(
  $$select proposal_id,replayed from public.propose_staff_training_rule(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    (clock_timestamp() at time zone 'Asia/Taipei')::date,null,6,120,30,
    '71090000-0000-4000-8000-000000000001'
  )$$,
  $$select current_setting('test.training_proposal')::uuid,true$$,
  'exact rule proposal replay returns the immutable proposal'
);

-- 24
select throws_ok(
  $$select * from public.propose_staff_training_rule(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    (clock_timestamp() at time zone 'Asia/Taipei')::date,null,6,121,30,
    '71090000-0000-4000-8000-000000000001'
  )$$, '23505', 'staff training rule key reused with different content',
  'changed proposal content conflicts under the same key'
);

-- 25
select throws_ok(
  $$select * from public.publish_staff_training_rule(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    current_setting('test.training_proposal')::uuid,
    '71090000-0000-4000-8000-000000000002'
  )$$, '42501', 'staff training rule requires a distinct current approver',
  'a proposer cannot self-publish a rule'
);

select set_config('request.jwt.claims','{"sub":"71010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"71061000-0000-4000-8000-000000000002"}',true);

-- 26
select results_eq(
  $$select action,version,proposal_id,replayed
    from public.publish_staff_training_rule(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
      current_setting('test.training_proposal')::uuid,
      '71090000-0000-4000-8000-000000000003'
    )$$,
  $$select 'publish'::text,1,current_setting('test.training_proposal')::uuid,false$$,
  'a distinct recent-AAL2 actor publishes version one'
);
select set_config(
  'test.training_rule',
  (select rule_version_id::text from public.publish_staff_training_rule(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    current_setting('test.training_proposal')::uuid,
    '71090000-0000-4000-8000-000000000003'
  )), true
);

-- 27
select results_eq(
  $$select version,rule_version_id,replayed
    from public.publish_staff_training_rule(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
      current_setting('test.training_proposal')::uuid,
      '71090000-0000-4000-8000-000000000003'
    )$$,
  $$select 1,current_setting('test.training_rule')::uuid,true$$,
  'published rule exact replay uses current AAL2 without duplicating a version'
);

-- 28
select results_eq(
  $$select policy_status,rule_version,required_credits,expiring_total,
           gap_staff_total,indeterminate_staff_total,progress_total
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
    )$$,
  $$values ('published'::text,1,'120.0000'::text,1::bigint,2::bigint,1::bigint,3::bigint)$$,
  'published rule freezes dynamic progress and expiring totals for current staff'
);

-- 29
select results_eq(
  $$select value->>'progress_status',value->>'credit_gap',
           value->>'missing_credit_count'
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
    ), lateral jsonb_array_elements(staff_progress) value
    where value->>'staff_membership_id'='71040000-0000-4000-8000-000000000001'$$,
  $$values ('indeterminate'::text,null::text,'1'::text)$$,
  'a missing credit remains indeterminate and never becomes a zero-point gap'
);

select set_config('request.jwt.claims','{"sub":"71010000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"71061000-0000-4000-8000-000000000003"}',true);

-- 30
select results_eq(
  $$select record_total,progress_total,staff_total
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
    )$$,
  $$values (2::bigint,1::bigint,1::bigint)$$,
  'ordinary reader sees only their stable staff membership history and progress'
);

-- 31
select throws_ok(
  $$select * from public.append_staff_training_record(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001',
    'create','71070000-0000-4000-8000-000000000020',null,0,
    '71040000-0000-4000-8000-000000000003','自行新增',current_setting('test.training_day')::date,
    current_setting('test.training_start')::timestamptz,current_setting('test.training_end')::timestamptz,
    '自訂',1,1,'測試單位','missing',null,null,null,
    '71080000-0000-4000-8000-000000000020'
  )$$, '42501', 'staff training record write is not permitted',
  'read-only employee cannot write even their own record'
);

select set_config('request.jwt.claims','{"sub":"71010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"71061000-0000-4000-8000-000000000001"}',true);

-- 32
select throws_ok(
  $$select * from public.staff_training_snapshot(
    '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000002'
  )$$, '42501', 'staff training snapshot is not permitted',
  'cross-branch snapshot is rejected'
);

reset role;
-- 33
select throws_ok(
  $$update public.staff_training_record_versions set hours=999 where version=1$$,
  '23514', 'staff_training_record_versions is append-only',
  'committed records cannot be updated directly'
);
-- 34
select throws_ok(
  $$delete from private.staff_training_rule_versions$$,
  '23514', 'staff_training_rule_versions is append-only',
  'published rule versions cannot be deleted'
);

-- Add enough immutable fixture history to exercise bounded truthfulness.
insert into public.staff_training_record_versions (
  organization_id,branch_id,training_key,version,record_status,
  staff_membership_id,staff_user_id,staff_display_name,staff_employee_code,
  course_title,training_date,starts_at,ends_at,course_type,hours,credits,
  provider_name,evidence_status,recorded_by,recorded_at,content_hash
)
select '71020000-0000-4000-8000-000000000001'::uuid,
  '71030000-0000-4000-8000-000000000001'::uuid,
  ('7107' || lpad(to_hex(series),4,'0') || '-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
  1,'active','71040000-0000-4000-8000-000000000001'::uuid,
  '71010000-0000-4000-8000-000000000001'::uuid,'訓練主管甲','T-001',
  '批次測試 ' || series,current_date-20,
  (current_date-20)::timestamp at time zone 'Asia/Taipei',
  ((current_date-20)::timestamp + interval '1 hour') at time zone 'Asia/Taipei',
  '大量測試',1,1,'測試單位','not_applicable',
  '71010000-0000-4000-8000-000000000001'::uuid,clock_timestamp(),repeat('b',64)
from generate_series(1,201) series;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"71010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"71061000-0000-4000-8000-000000000001"}',true);

-- 35
select results_eq(
  $$select records_truncated,record_total,jsonb_array_length(records)
    from public.staff_training_snapshot(
      '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
    )$$,
  $$values (true,204::bigint,200)$$,
  'full-set totals remain truthful when record detail is bounded to 200'
);

-- 36
reset role;
select ok(
  (select records::text not ilike '%attachment_reference%'
      and records::text not ilike '%attachment_sha256%'
      and metadata::text not ilike '%基本訓練%'
   from public.staff_training_snapshot(
     '71020000-0000-4000-8000-000000000001','71030000-0000-4000-8000-000000000001'
   ) snapshot
   cross join lateral (
     select audit.metadata from public.audit_events audit
     where audit.table_name='staff_training_snapshot'
     order by audit.occurred_at desc limit 1
   ) latest_audit),
  'snapshot and audit metadata minimize attachment and course details'
);

select * from finish();
rollback;
