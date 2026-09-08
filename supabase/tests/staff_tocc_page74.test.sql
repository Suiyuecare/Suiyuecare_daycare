begin;

select plan(33);

-- 1
select ok(
  has_function_privilege('authenticated',
    'public.staff_tocc_snapshot(uuid,uuid,uuid,text,text,text,date,date,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.append_staff_tocc(uuid,uuid,text,uuid,uuid,integer,uuid,date,date,text,text,boolean,text,text,text,text,text,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_tocc_snapshot_bundle(uuid,uuid,timestamptz,uuid,text,text,text,date,date,text)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_tocc_current_authority(uuid,uuid,text)', 'execute'),
  'public invoker functions are callable while private TOCC helpers stay sealed'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.staff_tocc_versions', 'select')
  and not has_table_privilege('authenticated', 'public.staff_tocc_versions', 'insert')
  and not has_table_privilege('service_role', 'public.staff_tocc_versions', 'select')
  and not has_table_privilege('authenticated', 'private.staff_tocc_operations', 'select'),
  'direct TOCC and operation table access is denied'
);

-- 3
select ok(
  (select count(*) = 4 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private')
    )
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','append_staff_tocc'), ('public','staff_tocc_snapshot'),
      ('private','append_staff_tocc_guarded'),
      ('private','staff_tocc_snapshot_response')
    )),
  'private boundaries are pinned definers and public wrappers are pinned invokers'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.staff_tocc_versions'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_tocc_versions_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_tocc_versions_audit_row_change' and not tgisinternal),
  'TOCC versions force RLS and have append-only and audit triggers'
);

-- 5
select ok(
  (select risk_level = 3 from public.permissions where permission_key = 'staff_tocc.read')
  and (select risk_level = 3 from public.permissions where permission_key = 'staff_tocc.manage')
  and not exists (
    select 1 from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission on permission.id = role_permission.permission_id
    where permission.permission_key like 'staff_tocc.%'
      and role.role_key not in ('organization_manager', 'branch_supervisor')
  )
  and not exists (select 1 from public.permissions
    where permission_key in ('staff_tocc.read','staff_tocc.manage')
      and permission_key like 'clients.%'),
  'employee TOCC uses independent high-risk permissions with narrow defaults'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','74010000-0000-4000-8000-000000000001','authenticated','authenticated','tocc-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','74010000-0000-4000-8000-000000000002','authenticated','authenticated','tocc-worker@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','74010000-0000-4000-8000-000000000003','authenticated','authenticated','tocc-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','74010000-0000-4000-8000-000000000004','authenticated','authenticated','tocc-no-scope@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('74020000-0000-4000-8000-000000000001','tocc_staff_a','員工 TOCC 測試機構'),
  ('74020000-0000-4000-8000-000000000002','tocc_staff_b','其他員工 TOCC 機構');
insert into public.branches (id,organization_id,code,name) values
  ('74030000-0000-4000-8000-000000000001','74020000-0000-4000-8000-000000000001','main','主分支'),
  ('74030000-0000-4000-8000-000000000002','74020000-0000-4000-8000-000000000001','other','其他分支'),
  ('74030000-0000-4000-8000-000000000003','74020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('74010000-0000-4000-8000-000000000001','TOCC 主管','staff','T-001',true),
  ('74010000-0000-4000-8000-000000000002','受管員工','professional','T-002',true),
  ('74010000-0000-4000-8000-000000000003','跨分支員工','professional','T-003',true),
  ('74010000-0000-4000-8000-000000000004','無 TOCC 權限員工','staff','T-004',true);
insert into public.memberships (id,organization_id,branch_id,profile_id,status) values
  ('74040000-0000-4000-8000-000000000001','74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001','74010000-0000-4000-8000-000000000001','active'),
  ('74040000-0000-4000-8000-000000000002','74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001','74010000-0000-4000-8000-000000000002','active'),
  ('74040000-0000-4000-8000-000000000003','74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000002','74010000-0000-4000-8000-000000000003','active'),
  ('74040000-0000-4000-8000-000000000004','74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001','74010000-0000-4000-8000-000000000004','active');
insert into public.membership_roles (membership_id,role_id) values
  ('74040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('74040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('74040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
  ('74040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006');

select set_config('test.staff_tocc_today',
  ((clock_timestamp() at time zone 'Asia/Taipei')::date)::text,true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"74010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- 6
select throws_ok(
  $$select * from public.staff_tocc_snapshot(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff TOCC snapshot is not permitted',
  'AAL1 cannot read sensitive employee TOCC records'
);

-- 7
select throws_ok(
  $$select * from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000001',null,0,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-20,
    current_setting('test.staff_tocc_today')::date-1,
    '合成人工效期來源','合成結果',false,null,'missing',null,null,
    'not_recorded',null,null,'74080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff TOCC write is not permitted',
  'AAL1 cannot append a sensitive employee TOCC record'
);

select set_config('request.jwt.claims',
  '{"sub":"74010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- 8
select results_eq(
  $$select record_total,validity_rule_status,expiry_reminder_schedule_status,
      expiry_notice_days,expiring_total,medical_interpretation_status,
      attachment_pipeline_status
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    )$$,
  $$values (0::bigint,'not_configured'::text,'not_configured'::text,
    null::integer,null::bigint,'not_evaluated'::text,'not_configured'::text)$$,
  'empty snapshot does not invent validity rules, reminders, attachments or diagnoses'
);

-- 9
select results_eq(
  $$select version,record_status,staff_membership_id,evaluated_on,
      expiry_warning,manual_attention_warning,warning_basis,replayed
    from public.append_staff_tocc(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      'create','74071000-0000-4000-8000-000000000001',null,0,
      '74040000-0000-4000-8000-000000000002',
      current_setting('test.staff_tocc_today')::date-20,
      current_setting('test.staff_tocc_today')::date-1,
      '合成人工效期來源','SENSITIVE-EXPIRED-RESULT',false,null,
      'missing',null,null,'not_recorded',null,null,
      '74080000-0000-4000-8000-000000000001'
    )$$,
  $$select 1,'active'::text,'74040000-0000-4000-8000-000000000002'::uuid,
    current_setting('test.staff_tocc_today')::date,true,false,
    'manual_valid_through_and_manual_attention_flag'::text,false$$,
  'manual valid-through produces an exact, non-diagnostic expiry receipt'
);
select set_config('test.staff_tocc_v1',(select record_version_id::text
  from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000001',null,0,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-20,
    current_setting('test.staff_tocc_today')::date-1,
    '合成人工效期來源','SENSITIVE-EXPIRED-RESULT',false,null,
    'missing',null,null,'not_recorded',null,null,
    '74080000-0000-4000-8000-000000000001'
  )),true);

-- 10
select results_eq(
  $$select record_version_id,version,expiry_warning,replayed
    from public.append_staff_tocc(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      'create','74071000-0000-4000-8000-000000000001',null,0,
      '74040000-0000-4000-8000-000000000002',
      current_setting('test.staff_tocc_today')::date-20,
      current_setting('test.staff_tocc_today')::date-1,
      '合成人工效期來源','SENSITIVE-EXPIRED-RESULT',false,null,
      'missing',null,null,'not_recorded',null,null,
      '74080000-0000-4000-8000-000000000001'
    )$$,
  $$select current_setting('test.staff_tocc_v1')::uuid,1,true,true$$,
  'exact retry returns the original evaluated receipt without duplicating a row'
);

-- 11
select throws_ok(
  $$select * from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000001',null,0,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-20,
    current_setting('test.staff_tocc_today')::date-1,
    '不同來源','SENSITIVE-EXPIRED-RESULT',false,null,'missing',null,null,
    'not_recorded',null,null,'74080000-0000-4000-8000-000000000001'
  )$$, '23505', 'staff TOCC idempotency key reused with different content',
  'reusing an operation key with changed content conflicts'
);

-- 12
select throws_ok(
  $$select * from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000009',null,0,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-2,
    current_setting('test.staff_tocc_today')::date+2,
    '附件測試','附件測試結果',false,null,'provided','browser://fake',repeat('a',64),
    'not_recorded',null,null,'74080000-0000-4000-8000-000000000009'
  )$$, '22023', 'staff TOCC content or attachment evidence is invalid',
  'untrusted browser attachment references fail closed'
);

-- 13
select throws_ok(
  $$select * from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000008',null,0,
    '74040000-0000-4000-8000-000000000003',
    current_setting('test.staff_tocc_today')::date-2,
    current_setting('test.staff_tocc_today')::date+2,
    '跨分支來源','跨分支結果',false,null,'missing',null,null,
    'not_recorded',null,null,'74080000-0000-4000-8000-000000000008'
  )$$, '42501', 'target employee is not current in this branch',
  'cross-branch employee writes are rejected'
);

-- 14
select results_eq(
  $$select expiry_warning,manual_attention_warning
    from public.append_staff_tocc(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      'create','74071000-0000-4000-8000-000000000002',null,0,
      '74040000-0000-4000-8000-000000000002',
      current_setting('test.staff_tocc_today')::date-2,
      current_setting('test.staff_tocc_today')::date+20,
      '合成文字來源','結果含 positive-like 字樣但未人工標記',false,null,
      'not_applicable',null,null,'completed','人工流程完成',null,
      '74080000-0000-4000-8000-000000000002'
    )$$,
  $$values (false,false)$$,
  'result wording never creates an automatic positive or abnormal warning'
);
select set_config('test.staff_tocc_v2',(select record_version_id::text
  from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000002',null,0,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-2,
    current_setting('test.staff_tocc_today')::date+20,
    '合成文字來源','結果含 positive-like 字樣但未人工標記',false,null,
    'not_applicable',null,null,'completed','人工流程完成',null,
    '74080000-0000-4000-8000-000000000002'
  )),true);

-- 15
select results_eq(
  $$select expiry_warning,manual_attention_warning
    from public.append_staff_tocc(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      'create','74071000-0000-4000-8000-000000000003',null,0,
      '74040000-0000-4000-8000-000000000001',
      current_setting('test.staff_tocc_today')::date-1,
      current_setting('test.staff_tocc_today')::date+7,
      '人工確認來源','一般來源結果',true,'人工標記需追蹤',
      'missing',null,null,'pending','等待人工處置',null,
      '74080000-0000-4000-8000-000000000003'
    )$$,
  $$values (false,true)$$,
  'an explicit human flag produces an explainable warning without diagnosis'
);
select set_config('test.staff_tocc_v3',(select record_version_id::text
  from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000003',null,0,
    '74040000-0000-4000-8000-000000000001',
    current_setting('test.staff_tocc_today')::date-1,
    current_setting('test.staff_tocc_today')::date+7,
    '人工確認來源','一般來源結果',true,'人工標記需追蹤',
    'missing',null,null,'pending','等待人工處置',null,
    '74080000-0000-4000-8000-000000000003'
  )),true);

-- 16
select results_eq(
  $$select record_total,active_total,expired_total,manual_attention_total,
      action_required_total,medical_interpretation_status
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,2::bigint,1::bigint,1::bigint,1::bigint,'not_evaluated'::text)$$,
  'snapshot metrics derive only from terminal facts and explicit human flags'
);

-- 17
select results_eq(
  $$select item->'warning_reasons'
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    ), lateral jsonb_array_elements(records) item
    where item->>'tocc_key'='74071000-0000-4000-8000-000000000001'$$,
  $$values ('["expired_manual_valid_through"]'::jsonb)$$,
  'expired warning identifies the manually supplied valid-through basis'
);

-- 18
select results_eq(
  $$select (item->>'manual_attention_warning')::boolean,item->'warning_reasons',
      item->>'medical_interpretation_status'
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    ), lateral jsonb_array_elements(records) item
    where item->>'tocc_key'='74071000-0000-4000-8000-000000000002'$$,
  $$values (false,'[]'::jsonb,'not_evaluated'::text)$$,
  'positive-like result text stays unclassified and does not trigger a warning'
);

-- 19
select results_eq(
  $$select item->'warning_reasons',(item->>'action_required')::boolean,
      item->>'attention_note',item->>'disposition_status'
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    ), lateral jsonb_array_elements(records) item
    where item->>'tocc_key'='74071000-0000-4000-8000-000000000003'$$,
  $$values ('["manual_attention_flag"]'::jsonb,true,'人工標記需追蹤'::text,'pending'::text)$$,
  'manual warning explains its reason and exact pending disposition'
);

-- 20
select results_eq(
  $$select record_total,expired_total,manual_attention_total
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      '74040000-0000-4000-8000-000000000002','expired','not_flagged',
      'not_recorded',current_setting('test.staff_tocc_today')::date-30,
      current_setting('test.staff_tocc_today')::date,'SENSITIVE-EXPIRED'
    )$$,
  $$values (1::bigint,1::bigint,0::bigint)$$,
  'staff, validity, attention, disposition, dates and search share one snapshot'
);

-- 21
select results_eq(
  $$select record_total from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      null,'active','flagged','pending',null,null,null
    )$$,
  $$values (1::bigint)$$,
  'manual attention and disposition filters return the exact flagged record'
);

-- 22
select results_eq(
  $$select version,previous_version_id,expiry_warning,manual_attention_warning
    from public.append_staff_tocc(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      'correct','74071000-0000-4000-8000-000000000001',
      current_setting('test.staff_tocc_v1')::uuid,1,
      '74040000-0000-4000-8000-000000000002',
      current_setting('test.staff_tocc_today')::date-20,
      current_setting('test.staff_tocc_today')::date+30,
      '更正後人工來源','更正後結果',true,'人工更正後標記',
      'missing',null,null,'completed','人工處置完成','更正人工效期與標記',
      '74080000-0000-4000-8000-000000000005'
    )$$,
  $$select 2,current_setting('test.staff_tocc_v1')::uuid,false,true$$,
  'correction appends a new version and recomputes exact warnings'
);
select set_config('test.staff_tocc_v1c',(select record_version_id::text
  from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'correct','74071000-0000-4000-8000-000000000001',
    current_setting('test.staff_tocc_v1')::uuid,1,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-20,
    current_setting('test.staff_tocc_today')::date+30,
    '更正後人工來源','更正後結果',true,'人工更正後標記',
    'missing',null,null,'completed','人工處置完成','更正人工效期與標記',
    '74080000-0000-4000-8000-000000000005'
  )),true);

-- 23
select throws_ok(
  $$select * from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'correct','74071000-0000-4000-8000-000000000001',
    current_setting('test.staff_tocc_v1')::uuid,1,
    '74040000-0000-4000-8000-000000000002',
    current_setting('test.staff_tocc_today')::date-20,
    current_setting('test.staff_tocc_today')::date+40,
    '過期基準來源','過期基準結果',false,null,'missing',null,null,
    'not_recorded',null,'使用過期版本','74080000-0000-4000-8000-000000000006'
  )$$, '40001', 'staff TOCC base version is stale',
  'stale correction bases are rejected'
);

-- 24
select results_eq(
  $$select record_total,history_total,active_total,expired_total,
      manual_attention_total,action_required_total
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,4::bigint,3::bigint,0::bigint,2::bigint,1::bigint)$$,
  'snapshot exposes terminal records and all immutable history versions'
);

-- 25
select results_eq(
  $$select version,previous_version_id,record_status,expiry_warning,
      manual_attention_warning
    from public.append_staff_tocc(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
      'void','74071000-0000-4000-8000-000000000002',
      current_setting('test.staff_tocc_v2')::uuid,1,
      '74040000-0000-4000-8000-000000000002',null,null,null,null,null,null,
      null,null,null,null,null,'作廢合成誤植紀錄',
      '74080000-0000-4000-8000-000000000007'
    )$$,
  $$select 2,current_setting('test.staff_tocc_v2')::uuid,'voided'::text,false,false$$,
  'void appends a terminal version and suppresses current warnings without overwrite'
);

-- 26
select results_eq(
  $$select record_total,history_total,
      (select item->>'record_status' from jsonb_array_elements(records) item
        where item->>'tocc_key'='74071000-0000-4000-8000-000000000002'),
      (select item->'warning_reasons' from jsonb_array_elements(records) item
        where item->>'tocc_key'='74071000-0000-4000-8000-000000000002')
    from public.staff_tocc_snapshot(
      '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,5::bigint,'voided'::text,'[]'::jsonb)$$,
  'void terminal remains visible with complete history and no active warning'
);

reset role;
-- 27
select throws_ok(
  $$update public.staff_tocc_versions set result_text='OVERWRITE'
    where id=current_setting('test.staff_tocc_v1')::uuid$$,
  '23514', 'staff_tocc_versions is append-only',
  'TOCC versions cannot be updated even by the owner'
);

-- 28
select throws_ok(
  $$delete from public.staff_tocc_versions
    where id=current_setting('test.staff_tocc_v1')::uuid$$,
  '23514', 'staff_tocc_versions is append-only',
  'TOCC versions cannot be deleted even by the owner'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"74010000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
-- 29
select throws_ok(
  $$select * from public.staff_tocc_snapshot(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff TOCC snapshot is not permitted',
  'AAL2 without the independent employee-TOCC permission cannot read details'
);

-- 30
select throws_ok(
  $$select * from public.append_staff_tocc(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000001',
    'create','74071000-0000-4000-8000-000000000010',null,0,
    '74040000-0000-4000-8000-000000000004',current_date,current_date,
    '無權限來源','無權限結果',false,null,'missing',null,null,
    'not_recorded',null,null,'74080000-0000-4000-8000-000000000010'
  )$$, '42501', 'staff TOCC write is not permitted',
  'general staff access cannot append employee TOCC details'
);

select set_config('request.jwt.claims',
  '{"sub":"74010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
-- 31
select throws_ok(
  $$select * from public.staff_tocc_snapshot(
    '74020000-0000-4000-8000-000000000001','74030000-0000-4000-8000-000000000002'
  )$$, '42501', 'staff TOCC snapshot is not permitted',
  'current branch scope cannot be bypassed by a function argument'
);

-- 32
select throws_ok(
  $$select * from private.staff_tocc_operations$$,
  '42501', 'permission denied for table staff_tocc_operations',
  'private idempotency receipts cannot be read directly'
);

reset role;
-- 33
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'staff_tocc_snapshot' and action = 'select'
      and metadata ->> 'workflow' = 'page74_staff_tocc_v1')
  and not exists (select 1 from public.audit_events
    where table_name in ('staff_tocc_snapshot','public.staff_tocc_versions')
      and (metadata::text like '%SENSITIVE-EXPIRED%'
        or metadata::text like '%positive-like%'
        or metadata::text like '%人工標記需追蹤%')),
  'every read is audited without result, search, flag-note or disposition content'
);

select * from finish();
rollback;
