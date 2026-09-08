begin;

select plan(36);

-- 1
select ok(
  has_function_privilege('authenticated',
    'public.staff_certificate_snapshot(uuid,uuid,uuid,text,text,text)', 'execute')
  and has_function_privilege('authenticated',
    'public.append_staff_certificate(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,date,date,text,text,text,text,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_certificate_snapshot_bundle(uuid,uuid,timestamptz,uuid,text,text,text)', 'execute')
  and not has_function_privilege('authenticated',
    'private.staff_certificate_current_authority(uuid,uuid,text)', 'execute'),
  'public invoker functions are callable while private helpers stay sealed'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.staff_certificate_versions', 'select')
  and not has_table_privilege('authenticated', 'public.staff_certificate_versions', 'insert')
  and not has_table_privilege('service_role', 'public.staff_certificate_versions', 'select')
  and not has_table_privilege('authenticated',
    'private.staff_certificate_exception_requests', 'select'),
  'direct certificate and exception table access is denied'
);

-- 3
select ok(
  (select count(*) = 6 and bool_and(
      proconfig = array['search_path=""']::text[]
      and prosecdef = (pg_namespace.nspname = 'private')
    )
    from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where (pg_namespace.nspname, proname) in (
      ('public','append_staff_certificate'),
      ('public','approve_staff_certificate_exception'),
      ('public','request_staff_certificate_exception'),
      ('public','staff_certificate_snapshot'),
      ('private','append_staff_certificate_guarded'),
      ('private','staff_certificate_snapshot_response')
    )),
  'private boundaries are pinned definers and public wrappers are pinned invokers'
);

-- 4
select ok(
  (select relforcerowsecurity from pg_class
    where oid = 'public.staff_certificate_versions'::regclass)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_certificate_versions_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger
    where tgname = 'staff_certificate_versions_audit_row_change' and not tgisinternal),
  'certificate versions force RLS and have append-only and audit triggers'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','72010000-0000-4000-8000-000000000001','authenticated','authenticated','cert-manager-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','72010000-0000-4000-8000-000000000002','authenticated','authenticated','cert-manager-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','72010000-0000-4000-8000-000000000003','authenticated','authenticated','cert-manager-c@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','72010000-0000-4000-8000-000000000004','authenticated','authenticated','cert-worker@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','72010000-0000-4000-8000-000000000005','authenticated','authenticated','cert-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations (id,code,name) values
  ('72020000-0000-4000-8000-000000000001','cert_a','證照測試機構'),
  ('72020000-0000-4000-8000-000000000002','cert_b','其他證照機構');
insert into public.branches (id,organization_id,code,name) values
  ('72030000-0000-4000-8000-000000000001','72020000-0000-4000-8000-000000000001','main','主分支'),
  ('72030000-0000-4000-8000-000000000002','72020000-0000-4000-8000-000000000001','other','其他分支'),
  ('72030000-0000-4000-8000-000000000003','72020000-0000-4000-8000-000000000002','main','跨機構分支');
insert into public.profiles (id,display_name,kind,employee_code,is_active) values
  ('72010000-0000-4000-8000-000000000001','證照主管甲','staff','C-001',true),
  ('72010000-0000-4000-8000-000000000002','證照主管乙','staff','C-002',true),
  ('72010000-0000-4000-8000-000000000003','證照主管丙','staff','C-003',true),
  ('72010000-0000-4000-8000-000000000004','受管員工','professional','C-004',true),
  ('72010000-0000-4000-8000-000000000005','跨分支員工','professional','C-005',true);
insert into public.memberships (id,organization_id,branch_id,profile_id,status) values
  ('72040000-0000-4000-8000-000000000001','72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001','72010000-0000-4000-8000-000000000001','active'),
  ('72040000-0000-4000-8000-000000000002','72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001','72010000-0000-4000-8000-000000000002','active'),
  ('72040000-0000-4000-8000-000000000003','72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001','72010000-0000-4000-8000-000000000003','active'),
  ('72040000-0000-4000-8000-000000000004','72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001','72010000-0000-4000-8000-000000000004','active'),
  ('72040000-0000-4000-8000-000000000005','72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000002','72010000-0000-4000-8000-000000000005','active');
insert into public.membership_roles (membership_id,role_id) values
  ('72040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('72040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'),
  ('72040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003'),
  ('72040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006'),
  ('72040000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006');

select set_config('test.cert_verified_at',(clock_timestamp()-interval '30 seconds')::text,true);
insert into private.reauth_challenges (
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,
  consumed_jwt_jti,factor_method,factor_verified_at
) values
  ('72060000-0000-4000-8000-000000000001','72010000-0000-4000-8000-000000000001','72061000-0000-4000-8000-000000000001',repeat('1',64),'72062000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 minutes','a-before',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',current_setting('test.cert_verified_at')::timestamptz,current_setting('test.cert_verified_at')::timestamptz,'a-after','totp',current_setting('test.cert_verified_at')::timestamptz),
  ('72060000-0000-4000-8000-000000000002','72010000-0000-4000-8000-000000000002','72061000-0000-4000-8000-000000000002',repeat('2',64),'72062000-0000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes','b-before',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',current_setting('test.cert_verified_at')::timestamptz,current_setting('test.cert_verified_at')::timestamptz,'b-after','totp',current_setting('test.cert_verified_at')::timestamptz),
  ('72060000-0000-4000-8000-000000000003','72010000-0000-4000-8000-000000000003','72061000-0000-4000-8000-000000000003',repeat('3',64),'72062000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 minutes','c-before',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',current_setting('test.cert_verified_at')::timestamptz,current_setting('test.cert_verified_at')::timestamptz,'c-after','totp',current_setting('test.cert_verified_at')::timestamptz);
insert into private.reauth_events (user_id,session_id,challenge_id,aal,verification_method,verified_at) values
  ('72010000-0000-4000-8000-000000000001','72061000-0000-4000-8000-000000000001','72060000-0000-4000-8000-000000000001','aal2','totp',current_setting('test.cert_verified_at')::timestamptz),
  ('72010000-0000-4000-8000-000000000002','72061000-0000-4000-8000-000000000002','72060000-0000-4000-8000-000000000002','aal2','totp',current_setting('test.cert_verified_at')::timestamptz),
  ('72010000-0000-4000-8000-000000000003','72061000-0000-4000-8000-000000000003','72060000-0000-4000-8000-000000000003','aal2','totp',current_setting('test.cert_verified_at')::timestamptz);

select set_config('test.cert_today',((clock_timestamp() at time zone 'Asia/Taipei')::date)::text,true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"72061000-0000-4000-8000-000000000001"}',true);

-- 5
select throws_ok(
  $$select * from public.staff_certificate_snapshot(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff certificate snapshot is not permitted',
  'AAL1 cannot read staff certificates'
);
-- 6
select throws_ok(
  $$select * from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'create','72070000-0000-4000-8000-000000000001',null,0,
    '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
    'registered','verified','missing',null,null,null,
    '72080000-0000-4000-8000-000000000001'
  )$$, '42501', 'staff certificate write is not permitted',
  'AAL1 cannot append a certificate'
);

select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"72061000-0000-4000-8000-000000000001"}',true);

-- 7
select results_eq(
  $$select record_total,expiring_total,expiry_reminder_policy_status,
      restricted_service_policy_status,service_eligibility_scope
    from public.staff_certificate_snapshot(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001'
    )$$,
  $$values (0::bigint,null::bigint,'not_configured'::text,
    'not_configured'::text,'not_evaluated'::text)$$,
  'empty snapshot does not invent reminder or restricted-service rules'
);

-- 8
select results_eq(
  $$select version,record_status,staff_membership_id,replayed
    from public.append_staff_certificate(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      'create','72070000-0000-4000-8000-000000000001',null,0,
      '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
      current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
      'registered','verified','missing',null,null,null,
      '72080000-0000-4000-8000-000000000001'
    )$$,
  $$values (1,'active'::text,'72040000-0000-4000-8000-000000000004'::uuid,false)$$,
  'certificate original binds a stable employee membership'
);
select set_config('test.cert_v1',(select record_version_id::text
  from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'create','72070000-0000-4000-8000-000000000001',null,0,
    '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
    'registered','verified','missing',null,null,null,
    '72080000-0000-4000-8000-000000000001'
  )),true);

-- 9
select results_eq(
  $$select record_version_id,version,replayed from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'create','72070000-0000-4000-8000-000000000001',null,0,
    '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
    'registered','verified','missing',null,null,null,
    '72080000-0000-4000-8000-000000000001'
  )$$,
  $$select current_setting('test.cert_v1')::uuid,1,true$$,
  'same actor and exact body replay the original receipt'
);

-- 10
select throws_ok(
  $$select * from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'create','72070000-0000-4000-8000-000000000001',null,0,
    '72040000-0000-4000-8000-000000000004','不同證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
    'registered','verified','missing',null,null,null,
    '72080000-0000-4000-8000-000000000001'
  )$$, '23505', 'certificate idempotency key reused with different content',
  'same key with changed content conflicts'
);

-- 11
select throws_ok(
  $$select * from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'create','72070000-0000-4000-8000-000000000002',null,0,
    '72040000-0000-4000-8000-000000000004','附件測試','SYNTH-002',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
    'registered','verified','provided','browser://fake',repeat('a',64),null,
    '72080000-0000-4000-8000-000000000002'
  )$$, '22023', 'certificate content or attachment evidence is invalid',
  'untrusted browser attachment references fail closed'
);

-- 12
select throws_ok(
  $$select * from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'create','72070000-0000-4000-8000-000000000003',null,0,
    '72040000-0000-4000-8000-000000000005','跨分支證照','SYNTH-003',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+100,
    'registered','verified','missing',null,null,null,
    '72080000-0000-4000-8000-000000000003'
  )$$, '42501', 'target employee is not current in this branch',
  'cross-branch employee writes are rejected'
);

-- 13
select results_eq(
  $$select record_total,valid_total,expired_total,
      records->0->>'validity_status',records->0->>'service_eligibility_status'
    from public.staff_certificate_snapshot(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001'
    )$$,
  $$values (1::bigint,1::bigint,0::bigint,'active'::text,'not_evaluated'::text)$$,
  'snapshot gives exact validity but does not infer service eligibility'
);

reset role;
-- 14
select throws_ok(
  $$update public.staff_certificate_versions set certificate_number='OVERWRITE'
    where id=current_setting('test.cert_v1')::uuid$$,
  '23514', 'staff_certificate_versions is append-only',
  'certificate rows cannot be updated even by table owner'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"72061000-0000-4000-8000-000000000001"}',true);

-- 15
select results_eq(
  $$select version,previous_version_id,record_status from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'correct','72070000-0000-4000-8000-000000000001',current_setting('test.cert_v1')::uuid,1,
    '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date-1,
    'registered','verified','missing',null,null,'修正到期日',
    '72080000-0000-4000-8000-000000000004'
  )$$,
  $$select 2,current_setting('test.cert_v1')::uuid,'active'::text$$,
  'correction appends version two without overwriting version one'
);
select set_config('test.cert_v2',(select record_version_id::text
  from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'correct','72070000-0000-4000-8000-000000000001',current_setting('test.cert_v1')::uuid,1,
    '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date-1,
    'registered','verified','missing',null,null,'修正到期日',
    '72080000-0000-4000-8000-000000000004'
  )),true);

-- 16
select throws_ok(
  $$select * from public.append_staff_certificate(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    'correct','72070000-0000-4000-8000-000000000001',current_setting('test.cert_v1')::uuid,1,
    '72040000-0000-4000-8000-000000000004','專業證照','SYNTH-001',
    current_setting('test.cert_today')::date-100,current_setting('test.cert_today')::date+10,
    'registered','verified','missing',null,null,'過期基準',
    '72080000-0000-4000-8000-000000000005'
  )$$, '40001', 'certificate base version is stale',
  'stale base versions are rejected'
);

-- 17
select results_eq(
  $$select record_total,history_total,expired_total,records->0->>'validity_status'
    from public.staff_certificate_snapshot(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001'
    )$$,
  $$values (1::bigint,2::bigint,1::bigint,'expired'::text)$$,
  'snapshot exposes one terminal record and both immutable history versions'
);

reset role;
-- 18
select throws_ok(
  $$delete from public.staff_certificate_versions
    where id=current_setting('test.cert_v1')::uuid$$,
  '23514', 'staff_certificate_versions is append-only',
  'certificate rows cannot be deleted even by table owner'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"72061000-0000-4000-8000-000000000099"}',true);

-- 19
select throws_ok(
  $$select * from public.request_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    '72070000-0000-4000-8000-000000000001',current_setting('test.cert_v2')::uuid,2,
    current_setting('test.cert_today')::date,current_setting('test.cert_today')::date+10,
    '近期人力調整','72080000-0000-4000-8000-000000000006'
  )$$, '42501', 'recent certificate AAL2 evidence is required',
  'AAL2 without matching recent session evidence cannot request an exception'
);

select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"72061000-0000-4000-8000-000000000001"}',true);
-- 20
select throws_ok(
  $$select * from public.request_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    '72070000-0000-4000-8000-000000000001',current_setting('test.cert_v2')::uuid,2,
    current_setting('test.cert_today')::date-10,current_setting('test.cert_today')::date-1,
    '過期例外','72080000-0000-4000-8000-000000000007'
  )$$, '22023', 'certificate exception must have a finite future end date',
  'an exception cannot already be expired when requested'
);

-- 21
select results_eq(
  $$select action,approval_count,exception_status,replayed
    from public.request_staff_certificate_exception(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      '72070000-0000-4000-8000-000000000001',current_setting('test.cert_v2')::uuid,2,
      current_setting('test.cert_today')::date,current_setting('test.cert_today')::date+10,
      '近期人力調整','72080000-0000-4000-8000-000000000008'
    )$$,
  $$values ('request'::text,0,'pending'::text,false)$$,
  'finite exception request starts with zero approvals'
);
select set_config('test.cert_request',(select request_id::text
  from public.request_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    '72070000-0000-4000-8000-000000000001',current_setting('test.cert_v2')::uuid,2,
    current_setting('test.cert_today')::date,current_setting('test.cert_today')::date+10,
    '近期人力調整','72080000-0000-4000-8000-000000000008'
  )),true);

-- 22
select results_eq(
  $$select request_id,approval_count,replayed
    from public.request_staff_certificate_exception(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      '72070000-0000-4000-8000-000000000001',current_setting('test.cert_v2')::uuid,2,
      current_setting('test.cert_today')::date,current_setting('test.cert_today')::date+10,
      '近期人力調整','72080000-0000-4000-8000-000000000008'
    )$$,
  $$select current_setting('test.cert_request')::uuid,0,true$$,
  'exact exception request replay returns the same request id'
);

-- 23
select throws_ok(
  $$select * from public.request_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    '72070000-0000-4000-8000-000000000001',current_setting('test.cert_v2')::uuid,2,
    current_setting('test.cert_today')::date,current_setting('test.cert_today')::date+9,
    '不同期限','72080000-0000-4000-8000-000000000008'
  )$$, '23505', 'certificate exception key reused with different content',
  'changed exception content under an existing key conflicts'
);

-- 24
select throws_ok(
  $$select * from public.approve_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    current_setting('test.cert_request')::uuid,2,0,
    '72080000-0000-4000-8000-000000000009'
  )$$, '42501', 'certificate exception requires a distinct current approver',
  'requester cannot self-approve'
);

select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"72061000-0000-4000-8000-000000000002"}',true);
-- 25
select throws_ok(
  $$select * from public.approve_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    current_setting('test.cert_request')::uuid,2,1,
    '72080000-0000-4000-8000-000000000010'
  )$$, '40001', 'certificate exception approval count is stale',
  'first approver must submit the exact expected zero approval count'
);

-- 26
select results_eq(
  $$select action,approval_count,exception_status,replayed
    from public.approve_staff_certificate_exception(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      current_setting('test.cert_request')::uuid,2,0,
      '72080000-0000-4000-8000-000000000011'
    )$$,
  $$values ('approve'::text,1,'pending'::text,false)$$,
  'first distinct recent-AAL2 approver appends approval one'
);
select set_config('test.cert_approval1',(select approval_id::text
  from public.approve_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    current_setting('test.cert_request')::uuid,2,0,
    '72080000-0000-4000-8000-000000000011'
  )),true);

-- 27
select results_eq(
  $$select approval_id,approval_count,replayed
    from public.approve_staff_certificate_exception(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      current_setting('test.cert_request')::uuid,2,0,
      '72080000-0000-4000-8000-000000000011'
    )$$,
  $$select current_setting('test.cert_approval1')::uuid,1,true$$,
  'same approver exact replay returns approval one'
);

-- 28
select throws_ok(
  $$select * from public.approve_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    current_setting('test.cert_request')::uuid,2,1,
    '72080000-0000-4000-8000-000000000012'
  )$$, '40001', 'certificate exception approval count is stale',
  'one actor cannot append both approvals'
);

select set_config('request.jwt.claims','{"sub":"72010000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"72061000-0000-4000-8000-000000000003"}',true);
-- 29
select throws_ok(
  $$select * from public.approve_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    current_setting('test.cert_request')::uuid,2,0,
    '72080000-0000-4000-8000-000000000013'
  )$$, '40001', 'certificate exception approval count is stale',
  'second approver must use the current expected approval count'
);

-- 30
select results_eq(
  $$select approval_count,exception_status,replayed
    from public.approve_staff_certificate_exception(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      current_setting('test.cert_request')::uuid,2,1,
      '72080000-0000-4000-8000-000000000014'
    )$$,
  $$values (2,'approved'::text,false)$$,
  'second independent recent-AAL2 approver completes the exception'
);

-- 31
select results_eq(
  $$select exception_request_total,
      exception_requests->0->>'exception_status',
      exception_requests->0->>'approval_count',
      records->0->>'has_active_exception',
      records->0->>'service_eligibility_status',
      restricted_service_policy_status
    from public.staff_certificate_snapshot(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001'
    )$$,
  $$values (1::bigint,'approved'::text,'2'::text,'true'::text,
    'not_evaluated'::text,'not_configured'::text)$$,
  'two approvals are visible but do not invent service eligibility'
);

-- 32
select throws_ok(
  $$select * from public.approve_staff_certificate_exception(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
    current_setting('test.cert_request')::uuid,2,1,
    '72080000-0000-4000-8000-000000000015'
  )$$, '40001', 'certificate exception approval count is stale',
  'a third approval cannot be appended'
);

-- 33
select throws_ok(
  $$select * from public.staff_certificate_snapshot(
    '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000002'
  )$$, '42501', 'staff certificate snapshot is not permitted',
  'current branch scope cannot be bypassed by a function argument'
);

-- 34
select throws_ok(
  $$select * from private.staff_certificate_exception_requests$$,
  '42501', 'permission denied for table staff_certificate_exception_requests',
  'private exception reasons cannot be read directly'
);

-- 35
select results_eq(
  $$select record_total,expired_total,records->0->>'certificate_number'
    from public.staff_certificate_snapshot(
      '72020000-0000-4000-8000-000000000001','72030000-0000-4000-8000-000000000001',
      null,'專業證照','expired','SYNTH-001'
    )$$,
  $$values (1::bigint,1::bigint,'SYNTH-001'::text)$$,
  'type, status and search filters share the same exact snapshot projection'
);

reset role;
-- 36
select ok(
  exists (select 1 from public.audit_events
    where table_name = 'staff_certificate_snapshot'
      and action = 'select'
      and metadata ->> 'workflow' = 'page72_staff_certificates_v1')
  and not exists (select 1 from public.audit_events
    where table_name in ('staff_certificate_snapshot','staff_certificate_versions')
      and metadata::text like '%SYNTH-001%'),
  'read and write audits exist without certificate numbers in metadata'
);

select * from finish();
rollback;
