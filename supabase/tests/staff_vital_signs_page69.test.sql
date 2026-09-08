begin;

select plan(38);

-- 1
select ok(
  has_function_privilege('authenticated',
    'public.staff_vital_sign_snapshot(uuid,uuid,uuid,text,text,date,date,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.append_staff_vital_sign(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,text,text,timestamptz,text,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_vital_sign_snapshot_bundle(uuid,uuid,timestamptz,uuid,text,text,date,date,text)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_vital_sign_authority(uuid,uuid,text,boolean)', 'execute'),
  'public invoker functions are callable while private health helpers stay sealed'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.staff_vital_sign_versions', 'select')
  and not has_table_privilege('authenticated', 'public.staff_vital_sign_versions', 'insert')
  and not has_table_privilege('service_role', 'public.staff_vital_sign_versions', 'select')
  and not has_table_privilege('authenticated',
    'private.staff_vital_sign_operations', 'select'),
  'direct vital-sign and operation table access is denied'
);

-- 3
select ok(
  (select count(*) = 4 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private')
    )
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','append_staff_vital_sign'),
      ('public','staff_vital_sign_snapshot'),
      ('private','append_staff_vital_sign_guarded'),
      ('private','staff_vital_sign_snapshot_response')
    )),
  'private boundaries are pinned definers and public wrappers are pinned invokers'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.staff_vital_sign_versions'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_vital_sign_versions_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_vital_sign_versions_audit_row_change' and not tgisinternal),
  'vital-sign versions force RLS and have append-only and audit triggers'
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
  ('00000000-0000-0000-0000-000000000000','69010000-0000-4000-8000-000000000001','authenticated','authenticated','vital-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','69010000-0000-4000-8000-000000000002','authenticated','authenticated','vital-worker@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','69010000-0000-4000-8000-000000000003','authenticated','authenticated','vital-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','69010000-0000-4000-8000-000000000004','authenticated','authenticated','vital-no-health@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('69020000-0000-4000-8000-000000000001','vital_a','生命徵象測試機構'),
  ('69020000-0000-4000-8000-000000000002','vital_b','其他測試機構');
insert into public.branches (id,organization_id,code,name) values
  ('69030000-0000-4000-8000-000000000001','69020000-0000-4000-8000-000000000001','main','主分支'),
  ('69030000-0000-4000-8000-000000000002','69020000-0000-4000-8000-000000000001','other','其他分支'),
  ('69030000-0000-4000-8000-000000000003','69020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('69010000-0000-4000-8000-000000000001','生命徵象主管','staff','V-001',true),
  ('69010000-0000-4000-8000-000000000002','受管員工','professional','V-002',true),
  ('69010000-0000-4000-8000-000000000003','跨分支員工','professional','V-003',true),
  ('69010000-0000-4000-8000-000000000004','一般員工','staff','V-004',true);
insert into public.memberships (id,organization_id,branch_id,profile_id,status) values
  ('69040000-0000-4000-8000-000000000001','69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001','69010000-0000-4000-8000-000000000001','active'),
  ('69040000-0000-4000-8000-000000000002','69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001','69010000-0000-4000-8000-000000000002','active'),
  ('69040000-0000-4000-8000-000000000003','69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000002','69010000-0000-4000-8000-000000000003','active'),
  ('69040000-0000-4000-8000-000000000004','69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001','69010000-0000-4000-8000-000000000004','active');
insert into public.membership_roles (membership_id,role_id) values
  ('69040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('69040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('69040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
  ('69040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006');

create temporary table vital_times as select
  clock_timestamp() - interval '2 hours' as measured_at,
  clock_timestamp() - interval '1 hour' as missing_at,
  clock_timestamp() - interval '30 minutes' as not_applicable_at,
  clock_timestamp() - interval '30 seconds' as recent_verified,
  clock_timestamp() - interval '20 minutes' as old_verified;
grant select on vital_times to authenticated;
insert into private.reauth_challenges (
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,
  factor_verified_at
)
select '69060000-0000-4000-8000-000000000001'::uuid,
  '69010000-0000-4000-8000-000000000001'::uuid,
  '69061000-0000-4000-8000-000000000001'::uuid,repeat('a',64),
  '69062000-0000-4000-8000-000000000001'::uuid,recent_verified-interval '1 minute',
  recent_verified-interval '1 minute',recent_verified+interval '5 minutes',
  recent_verified,recent_verified,'totp',recent_verified from vital_times
union all
select '69060000-0000-4000-8000-000000000002','69010000-0000-4000-8000-000000000001',
  '69061000-0000-4000-8000-000000000002',repeat('b',64),
  '69062000-0000-4000-8000-000000000002',old_verified-interval '1 minute',
  old_verified-interval '1 minute',old_verified+interval '5 minutes',
  old_verified,old_verified,'totp',old_verified from vital_times
union all
select '69060000-0000-4000-8000-000000000004','69010000-0000-4000-8000-000000000004',
  '69061000-0000-4000-8000-000000000004',repeat('d',64),
  '69062000-0000-4000-8000-000000000004',recent_verified-interval '1 minute',
  recent_verified-interval '1 minute',recent_verified+interval '5 minutes',
  recent_verified,recent_verified,'totp',recent_verified from vital_times;
insert into private.reauth_events (
  user_id,session_id,challenge_id,aal,verification_method,verified_at
)
select '69010000-0000-4000-8000-000000000001'::uuid,
  '69061000-0000-4000-8000-000000000001'::uuid,
  '69060000-0000-4000-8000-000000000001'::uuid,'aal2','totp',recent_verified
  from vital_times
union all
select '69010000-0000-4000-8000-000000000001','69061000-0000-4000-8000-000000000002',
  '69060000-0000-4000-8000-000000000002','aal2','totp',old_verified
  from vital_times
union all
select '69010000-0000-4000-8000-000000000004','69061000-0000-4000-8000-000000000004',
  '69060000-0000-4000-8000-000000000004','aal2','totp',recent_verified
  from vital_times;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"69061000-0000-4000-8000-000000000001"}',true);

-- 6
select throws_ok(
  $$select * from public.staff_vital_sign_snapshot(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vital sign snapshot is not permitted',
  'AAL1 cannot read employee vital signs'
);

-- 7
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000001',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類','measured','120.00','展示單位',null,
    clock_timestamp(),'展示來源',null,null,'69080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vital sign write is not permitted',
  'AAL1 cannot append employee vital signs'
);

select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
-- 8
select throws_ok(
  $$select * from public.staff_vital_sign_snapshot(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vital sign snapshot is not permitted',
  'AAL2 without same-session evidence cannot read health details'
);

select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"69061000-0000-4000-8000-000000000099"}',true);
-- 9
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000001',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類','measured','120.00','展示單位',null,
    clock_timestamp(),'展示來源',null,null,'69080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vital sign write is not permitted',
  'recent evidence from another session cannot authorize a write'
);

select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"69061000-0000-4000-8000-000000000002"}',true);
-- 10
select throws_ok(
  $$select * from public.staff_vital_sign_snapshot(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vital sign snapshot is not permitted',
  'expired same-session AAL2 evidence cannot authorize a read'
);

select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"69061000-0000-4000-8000-000000000001"}',true);

-- 11
select results_eq(
  $$select record_total,threshold_rule_status,threshold_version_id,
      threshold_warning_total,threshold_pending_confirmation_total,
      scheduled_missing_rule_status,scheduled_missing_total,
      medical_interpretation_status,attachment_pipeline_status,
      export_status,offline_status,recent_aal2_max_age_minutes
    from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
    )$$,
  $$values (0::bigint,'not_configured'::text,null::uuid,null::bigint,null::bigint,
    'not_configured'::text,null::bigint,'not_evaluated'::text,
    'not_configured'::text,'disabled'::text,'disabled'::text,15)$$,
  'empty snapshot does not invent thresholds, missing schedules, diagnosis, attachment, export, or offline behavior'
);

create temporary table vital_measured_receipt as
select * from public.append_staff_vital_sign(
  '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
  'create','69071000-0000-4000-8000-000000000001',null,0,
  '69040000-0000-4000-8000-000000000002','展示種類 A','measured','00120.00','展示單位',null,
  (select measured_at from vital_times),'展示手動來源','展示敏感備註',null,
  '69080000-0000-4000-8000-000000000001'
);

-- 12
select results_eq(
  $$select version,record_status,completion_status,threshold_evaluation_status,replayed
    from vital_measured_receipt$$,
  $$values (1,'active'::text,'completed'::text,'not_configured'::text,false)$$,
  'measured record appends as immutable version one without threshold evaluation'
);

-- 13
select results_eq(
  $$select records->0->>'value_decimal_text',records->0->>'unit',
      records->0->>'warning_status'
    from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
    )$$,
  $$values ('00120.00'::text,'展示單位'::text,null::text)$$,
  'snapshot preserves exact decimal text and does not fabricate a warning'
);

create temporary table vital_missing_receipt as
select * from public.append_staff_vital_sign(
  '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
  'create','69071000-0000-4000-8000-000000000002',null,0,
  '69040000-0000-4000-8000-000000000002','展示種類 B','missing',null,null,'展示缺值原因',
  (select missing_at from vital_times),'展示手動來源',null,null,
  '69080000-0000-4000-8000-000000000002'
);
-- 14
select is((select version from vital_missing_receipt),1,
  'missing record is accepted only as a distinct value status');

create temporary table vital_na_receipt as
select * from public.append_staff_vital_sign(
  '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
  'create','69071000-0000-4000-8000-000000000003',null,0,
  '69040000-0000-4000-8000-000000000002','展示種類 C','not_applicable',null,null,'展示不適用原因',
  (select not_applicable_at from vital_times),'展示手動來源',null,null,
  '69080000-0000-4000-8000-000000000003'
);
-- 15
select is((select version from vital_na_receipt),1,
  'not-applicable record remains distinct from a missing value');

-- 16
select results_eq(
  $$select record_total,measured_total,missing_total,not_applicable_total,voided_total
    from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,1::bigint,1::bigint,1::bigint,0::bigint)$$,
  'snapshot separates measured, missing, not-applicable, and voided totals'
);

-- 17
select results_eq(
  $$select record_total,missing_total,measured_total
    from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
      null,null,'missing'
    )$$,
  $$values (1::bigint,1::bigint,0::bigint)$$,
  'value-state filter uses the same snapshot totals and list'
);

-- 18
select results_eq(
  $$select record_total from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
      null,'展示種類 B','all',null,null,'展示缺值原因'
    )$$,
  $$values (1::bigint)$$,
  'type and search filters identify the expected scoped terminal record'
);

-- 19
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000004',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類','measured','1e2','展示單位',null,
    clock_timestamp(),'展示來源',null,null,'69080000-0000-4000-8000-000000000004'
  )$$, '22023', 'staff vital sign content or value-state contract is invalid',
  'exponential notation is rejected instead of changing decimal representation'
);

-- 20
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000004',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類','missing','120.00',null,'展示原因',
    clock_timestamp(),'展示來源',null,null,'69080000-0000-4000-8000-000000000004'
  )$$, '22023', 'staff vital sign content or value-state contract is invalid',
  'missing cannot secretly carry a measurement value'
);

-- 21
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000004',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類','not_applicable',null,null,null,
    clock_timestamp(),'展示來源',null,null,'69080000-0000-4000-8000-000000000004'
  )$$, '22023', 'staff vital sign content or value-state contract is invalid',
  'not-applicable requires an explicit reason'
);

-- 22
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000004',null,0,
    '69040000-0000-4000-8000-000000000003','展示種類','measured','120.00','展示單位',null,
    clock_timestamp(),'展示來源',null,null,'69080000-0000-4000-8000-000000000004'
  )$$, '42501', 'target employee is not current in this branch',
  'cross-branch target membership fails closed'
);

-- 23
select throws_ok(
  $$select * from public.staff_vital_sign_snapshot(
    '69020000-0000-4000-8000-000000000002','69030000-0000-4000-8000-000000000003'
  )$$, '42501', 'staff vital sign snapshot is not permitted',
  'cross-organization read fails at the health authority boundary'
);

select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"69061000-0000-4000-8000-000000000004"}',true);
-- 24
select throws_ok(
  $$select * from public.staff_vital_sign_snapshot(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff vital sign snapshot is not permitted',
  'recent AAL2 without staff-health permission cannot read values'
);

select set_config('request.jwt.claims',
  '{"sub":"69010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"69061000-0000-4000-8000-000000000001"}',true);

-- 25
select results_eq(
  $$select version,replayed from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000001',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類 A','measured','00120.00','展示單位',null,
    (select measured_at from vital_times),'展示手動來源','展示敏感備註',null,
    '69080000-0000-4000-8000-000000000001'
  )$$,
  $$values (1,true)$$,
  'same actor and same request replays the original immutable result'
);

-- 26
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'create','69071000-0000-4000-8000-000000000001',null,0,
    '69040000-0000-4000-8000-000000000002','展示種類 A','measured','121.00','展示單位',null,
    (select measured_at from vital_times),'展示手動來源','展示敏感備註',null,
    '69080000-0000-4000-8000-000000000001'
  )$$, '23505', 'staff vital sign idempotency key reused with different content',
  'actor-scoped idempotency key cannot be reused for changed health content'
);

create temporary table vital_correction_receipt as
select * from public.append_staff_vital_sign(
  '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
  'correct','69071000-0000-4000-8000-000000000001',
  (select record_version_id from vital_measured_receipt),1,
  '69040000-0000-4000-8000-000000000002','展示種類 A','measured','120.10','展示單位',null,
  (select measured_at from vital_times),'展示手動來源','展示更正備註','照錄來源更正',
  '69080000-0000-4000-8000-000000000005'
);
-- 27
select results_eq(
  $$select version,previous_version_id,record_status,replayed
    from vital_correction_receipt$$,
  $$select 2,record_version_id,'active'::text,false from vital_measured_receipt$$,
  'correction appends version two and links the immutable prior version'
);

-- 28
select throws_ok(
  $$select * from public.append_staff_vital_sign(
    '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
    'correct','69071000-0000-4000-8000-000000000001',
    (select record_version_id from vital_measured_receipt),1,
    '69040000-0000-4000-8000-000000000002','展示種類 A','measured','120.20','展示單位',null,
    (select measured_at from vital_times),'展示手動來源',null,'再次更正',
    '69080000-0000-4000-8000-000000000006'
  )$$, '40001', 'staff vital sign base version is stale',
  'stale base version cannot overwrite a later correction'
);

create temporary table vital_void_receipt as
select * from public.append_staff_vital_sign(
  '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
  'void','69071000-0000-4000-8000-000000000001',
  (select record_version_id from vital_correction_receipt),2,
  '69040000-0000-4000-8000-000000000002',null,null,null,null,null,null,null,null,
  '來源確認撤回','69080000-0000-4000-8000-000000000007'
);
-- 29
select results_eq(
  $$select version,previous_version_id,record_status from vital_void_receipt$$,
  $$select 3,record_version_id,'voided'::text from vital_correction_receipt$$,
  'void appends a third version without deleting prior measurements'
);

-- 30
select results_eq(
  $$select record_total,measured_total,missing_total,not_applicable_total,voided_total
    from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001'
    )$$,
  $$values (3::bigint,0::bigint,1::bigint,1::bigint,1::bigint)$$,
  'voided terminal record is separated from active value-state totals'
);

-- 31
select results_eq(
  $$select history_total from public.staff_vital_sign_snapshot(
      '69020000-0000-4000-8000-000000000001','69030000-0000-4000-8000-000000000001',
      '69040000-0000-4000-8000-000000000002',null,'voided'
    )$$,
  $$values (3::bigint)$$,
  'filtered terminal record returns its complete three-version history'
);

reset role;
-- 32
select throws_ok(
  $$update public.staff_vital_sign_versions set value_decimal_text = '999.00'
    where id = (select record_version_id from vital_measured_receipt)$$,
  '23514', 'staff_vital_sign_versions is append-only',
  'completed vital-sign versions cannot be updated even by a table owner'
);

-- 33
select throws_ok(
  $$delete from public.staff_vital_sign_versions
    where id = (select record_version_id from vital_measured_receipt)$$,
  '23514', 'staff_vital_sign_versions is append-only',
  'completed vital-sign versions cannot be deleted even by a table owner'
);

-- 34
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'staff_vital_sign_snapshot'
      and metadata ->> 'search_present' = 'true')
  and not exists (select 1 from public.audit_events
    where table_name = 'staff_vital_sign_snapshot'
      and metadata::text like '%展示缺值原因%'),
  'search audit records presence but never the sensitive search string'
);

-- 35
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'public.staff_vital_sign_versions'
      and changed_fields @> array['value_decimal_text'])
  and not exists (select 1 from public.audit_events
    where table_name in ('public.staff_vital_sign_versions','staff_vital_sign_snapshot')
      and metadata::text ~ '(00120.00|展示敏感備註|120.10)'),
  'write and read audits contain field names and counts but no health values or notes'
);

-- 36
select ok(
  not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_vital_sign_versions'
      and column_name like 'attachment%')
  and not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_vital_sign_versions'
      and column_name in ('threshold_value','warning_status')),
  'schema has no browser attachment path or invented threshold columns'
);

-- 37
select ok(
  exists (select 1 from pg_indexes
    where indexname = 'staff_vital_sign_membership_idx')
  and exists (select 1 from pg_indexes
    where indexname = 'staff_vital_sign_reauth_idx')
  and exists (select 1 from pg_indexes
    where indexname = 'staff_vital_sign_operation_result_idx'),
  'sensitive-scope and foreign-key lookup paths are indexed'
);

-- 38
select ok(
  (select count(*) = 3 from public.staff_vital_sign_versions
    where vital_sign_key = '69071000-0000-4000-8000-000000000001')
  and (select count(distinct content_hash) = 3 from public.staff_vital_sign_versions
    where vital_sign_key = '69071000-0000-4000-8000-000000000001')
  and (select bool_and(reauth_challenge_id =
      '69060000-0000-4000-8000-000000000001')
    from public.staff_vital_sign_versions
    where vital_sign_key = '69071000-0000-4000-8000-000000000001'),
  'each immutable version has distinct content hash and concrete recent reauth evidence'
);

select * from finish();
rollback;
