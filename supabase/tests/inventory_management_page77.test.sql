begin;

select plan(44);

-- 1
select ok(
  has_function_privilege(
    'authenticated',
    'public.inventory_management_snapshot(uuid,uuid,uuid,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.create_inventory_item(uuid,uuid,text,text,text,uuid)', 'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.set_inventory_item_status(uuid,uuid,uuid,text,text,integer,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.record_inventory_movement(uuid,uuid,uuid,uuid,text,date,text,text,numeric,numeric,numeric,uuid,uuid,text,uuid,text,text,text,timestamptz,integer,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.inventory_management_snapshot_bundle(uuid,uuid,timestamptz,uuid,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.inventory_current_authority(uuid,uuid,text)',
    'execute'
  ),
  'authenticated can execute public invoker boundaries but not private helpers'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.inventory_items', 'select')
  and not has_table_privilege('authenticated', 'public.inventory_items', 'insert')
  and not has_table_privilege('authenticated', 'public.inventory_batches', 'select')
  and not has_table_privilege('authenticated', 'public.inventory_movements', 'insert')
  and not has_table_privilege('service_role', 'public.inventory_items', 'select')
  and not has_table_privilege('service_role', 'public.inventory_movements', 'insert'),
  'guarded functions are the only application write/read boundary'
);

-- 3
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.inventory_items'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.inventory_item_status_events'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.inventory_batches'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.inventory_movements'::regclass),
  'all four public inventory tables force RLS'
);

-- 4
select ok(
  exists (select 1 from pg_trigger where tgname = 'inventory_items_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_item_status_events_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_batches_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_movements_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_items_audit_row_change' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_item_status_events_audit_row_change' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_batches_audit_row_change' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'inventory_movements_audit_row_change' and not tgisinternal),
  'committed inventory records have append-only and exact audit triggers'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','77010000-0000-4000-8000-000000000001','authenticated','authenticated','inventory-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','77010000-0000-4000-8000-000000000002','authenticated','authenticated','inventory-reader@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','77010000-0000-4000-8000-000000000003','authenticated','authenticated','inventory-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','77010000-0000-4000-8000-000000000004','authenticated','authenticated','inventory-inactive@example.invalid','',now(),'{}','{}',now(),now());

insert into public.organizations (id, code, name) values
  ('77020000-0000-4000-8000-000000000001','inventory_a','庫存測試機構'),
  ('77020000-0000-4000-8000-000000000002','inventory_b','其他庫存機構');
insert into public.branches (id, organization_id, code, name) values
  ('77030000-0000-4000-8000-000000000001','77020000-0000-4000-8000-000000000001','main','主分支'),
  ('77030000-0000-4000-8000-000000000002','77020000-0000-4000-8000-000000000001','other','其他分支'),
  ('77030000-0000-4000-8000-000000000003','77020000-0000-4000-8000-000000000002','main','其他機構分支');
insert into public.profiles (id, display_name, kind, employee_code, is_active) values
  ('77010000-0000-4000-8000-000000000001','庫存主管','staff','I-001',true),
  ('77010000-0000-4000-8000-000000000002','庫存唯讀','staff','I-002',true),
  ('77010000-0000-4000-8000-000000000003','其他分支員工','staff','I-003',true),
  ('77010000-0000-4000-8000-000000000004','已停用員工','staff','I-004',false);
insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('77040000-0000-4000-8000-000000000001','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001','77010000-0000-4000-8000-000000000001','active'),
  ('77040000-0000-4000-8000-000000000002','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001','77010000-0000-4000-8000-000000000002','active'),
  ('77040000-0000-4000-8000-000000000003','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000002','77010000-0000-4000-8000-000000000003','active'),
  ('77040000-0000-4000-8000-000000000004','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001','77010000-0000-4000-8000-000000000004','suspended');
insert into public.membership_roles (membership_id, role_id) values
  ('77040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  ('77040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('77040000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002'),
  ('77040000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006');
insert into public.role_permissions (role_id, permission_id)
select '10000000-0000-4000-8000-000000000006', id
from public.permissions where permission_key = 'inventory.manage'
on conflict (role_id, permission_id) do nothing;

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, source_system
) values
  ('77050000-0000-4000-8000-000000000001','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001','IC-001','領用個案','active','2026-01-01','local'),
  ('77050000-0000-4000-8000-000000000002','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000002','IC-002','跨分支個案','active','2026-01-01','local'),
  ('77050000-0000-4000-8000-000000000003','77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001','IC-003','未指派個案','active','2026-01-01','local');
insert into public.client_assignments (
  organization_id, branch_id, client_id, assignee_user_id, assignment_kind
) values (
  '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
  '77050000-0000-4000-8000-000000000001','77010000-0000-4000-8000-000000000001','primary'
),(
  '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
  '77050000-0000-4000-8000-000000000001','77010000-0000-4000-8000-000000000002','primary'
);

select set_config('test.inventory_verified_at',(clock_timestamp()-interval '30 seconds')::text,true);
select set_config('test.inventory_occurred_at',(clock_timestamp()-interval '1 minute')::text,true);
insert into private.reauth_challenges (
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,
  consumed_jwt_jti,factor_method,factor_verified_at
) values (
  '77060000-0000-4000-8000-000000000001','77010000-0000-4000-8000-000000000001',
  '77061000-0000-4000-8000-000000000001',repeat('7',64),
  '77062000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 minutes','inventory-before',
  clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',
  current_setting('test.inventory_verified_at')::timestamptz,
  current_setting('test.inventory_verified_at')::timestamptz,'inventory-after','totp',
  current_setting('test.inventory_verified_at')::timestamptz
);
insert into private.reauth_events (
  user_id,session_id,challenge_id,aal,verification_method,verified_at
) values (
  '77010000-0000-4000-8000-000000000001','77061000-0000-4000-8000-000000000001',
  '77060000-0000-4000-8000-000000000001','aal2','totp',
  current_setting('test.inventory_verified_at')::timestamptz
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"77061000-0000-4000-8000-000000000001"}',true);

-- 5
select throws_ok(
  $$select * from public.inventory_management_snapshot(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001'
  )$$,'42501','inventory snapshot is not permitted','AAL1 cannot read inventory'
);
-- 6
select throws_ok(
  $$select * from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    'GLOVE','手套','盒','77070000-0000-4000-8000-000000000001'
  )$$,'42501','inventory item creation is not permitted','AAL1 cannot create an item'
);

select set_config('request.jwt.claims','{"sub":"77010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77061000-0000-4000-8000-000000000001"}',true);

-- 7
select results_eq(
  $$select policy_status, item_total, batch_total, matching_movement_total
    from public.inventory_management_snapshot(
      '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001'
    )$$,
  $$values ('not_configured'::text,0::bigint,0::bigint,0::bigint)$$,
  'empty snapshot is audited and policy-derived thresholds are not configured'
);

-- 8
select results_eq(
  $$select status,status_ledger_version,replayed from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    'GLOVE','手套','盒','77070000-0000-4000-8000-000000000001'
  )$$,$$values ('active'::text,1,false)$$,'item master begins with immutable active status version one'
);
select set_config(
  'test.inventory_item',
  (select item_id::text from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    'GLOVE','手套','盒','77070000-0000-4000-8000-000000000001'
  )),true
);

-- 9
select results_eq(
  $$select item_id,status_ledger_version,replayed from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    'GLOVE','手套','盒','77070000-0000-4000-8000-000000000001'
  )$$,
  $$select current_setting('test.inventory_item')::uuid,1,true$$,
  'same actor and exact request replays the original item receipt'
);
-- 10
select throws_ok(
  $$select * from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    'MASK','口罩','盒','77070000-0000-4000-8000-000000000001'
  )$$,'23505','inventory item idempotency conflict','changed item content under the same key conflicts'
);
-- 11
select throws_ok(
  $$select * from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    'glove','另一手套','盒','77070000-0000-4000-8000-000000000002'
  )$$,'23505','inventory item code already exists','duplicate item code is rejected'
);

-- 12
select results_eq(
  $$select movement_type,ledger_version,quantity,balance_after,replayed
    from public.record_inventory_movement(
      '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
      current_setting('test.inventory_item')::uuid,null,'LOT-1',
      ((clock_timestamp() at time zone 'Asia/Taipei')::date+30),'盒','receipt',10,null,null,
      null,null,null,null,null,null,null,current_setting('test.inventory_occurred_at')::timestamptz,0,
      '77080000-0000-4000-8000-000000000001'
    )$$,
  $$values ('receipt'::text,1,'10.0000'::text,'10.0000'::text,false)$$,
  'receipt creates one immutable batch and authoritative starting balance'
);
select set_config('test.inventory_batch',batch_id::text,true),
       set_config('test.inventory_receipt',movement_id::text,true)
from public.record_inventory_movement(
  '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
  current_setting('test.inventory_item')::uuid,null,'LOT-1',
  ((clock_timestamp() at time zone 'Asia/Taipei')::date+30),'盒','receipt',10,null,null,
  null,null,null,null,null,null,null,current_setting('test.inventory_occurred_at')::timestamptz,0,
  '77080000-0000-4000-8000-000000000001'
);

-- 13
select results_eq(
  $$select movement_id,ledger_version,balance_after,replayed
    from public.record_inventory_movement(
      '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
      current_setting('test.inventory_item')::uuid,null,'LOT-1',
      ((clock_timestamp() at time zone 'Asia/Taipei')::date+30),'盒','receipt',10,null,null,
      null,null,null,null,null,null,null,current_setting('test.inventory_occurred_at')::timestamptz,0,
      '77080000-0000-4000-8000-000000000001'
    )$$,
  $$select current_setting('test.inventory_receipt')::uuid,1,'10.0000'::text,true$$,
  'exact receipt replay returns the original movement and does not duplicate stock'
);
-- 14
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'issue',1.00001,null,null,null,null,null,null,'照顧使用','日照區',null,
    current_setting('test.inventory_occurred_at')::timestamptz,1,'77080000-0000-4000-8000-000000000002'
  )$$,'22023','invalid inventory movement quantity','more than four decimal places is rejected before numeric coercion'
);
-- 15
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'issue',1,null,null,null,null,null,null,null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,1,'77080000-0000-4000-8000-000000000003'
  )$$,'22023','inventory issue purpose is required','general issue requires a purpose and destination'
);
-- 16
select results_eq(
  $$select movement_type,ledger_version,quantity_delta,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'issue',3,null,null,null,null,null,null,'照顧使用','日照區',null,
    current_setting('test.inventory_occurred_at')::timestamptz,1,'77080000-0000-4000-8000-000000000004'
  )$$,$$values ('issue'::text,2,'-3.0000'::text,'7.0000'::text)$$,'general issue decrements the locked authoritative balance'
);
select set_config(
  'test.inventory_issue',
  (select returnable_issue_options->0->>'original_movement_id'
   from public.inventory_management_snapshot(
     '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
     current_setting('test.inventory_item')::uuid,null,null,'all','issue'
   )),true
);

-- 17
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'issue',8,null,null,null,null,null,null,'超額','日照區',null,
    current_setting('test.inventory_occurred_at')::timestamptz,2,'77080000-0000-4000-8000-000000000005'
  )$$,'23514','inventory movement would create an invalid balance','negative inventory is rejected even for an authorized manager'
);
-- 18
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',1,null,null,null,'77050000-0000-4000-8000-000000000002',
    '照顧指示','77010000-0000-4000-8000-000000000001',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,2,'77080000-0000-4000-8000-000000000006'
  )$$,'42501','client issue scope is not permitted','cross-branch client issue is rejected'
);
-- 19
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',1,null,null,null,'77050000-0000-4000-8000-000000000001',
    '照顧指示','77010000-0000-4000-8000-000000000004',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,2,'77080000-0000-4000-8000-000000000007'
  )$$,'42501','client issue scope is not permitted','inactive executing staff cannot receive a client issue'
);
-- 20
select results_eq(
  $$select movement_type,ledger_version,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',2,null,null,null,'77050000-0000-4000-8000-000000000001',
    '依照個案照顧指示','77010000-0000-4000-8000-000000000001',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,2,'77080000-0000-4000-8000-000000000008'
  )$$,$$values ('client_issue'::text,3,'5.0000'::text)$$,'client issue binds active client, instruction and current executing staff'
);

-- 21
select results_eq(
  $$select movement_type,ledger_version,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'return',1,null,null,current_setting('test.inventory_issue')::uuid,null,null,null,null,null,'未使用退回',
    current_setting('test.inventory_occurred_at')::timestamptz,3,'77080000-0000-4000-8000-000000000009'
  )$$,$$values ('return'::text,4,'6.0000'::text)$$,'return appends against its original issue and restores stock'
);
-- 22
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'return',3,null,null,current_setting('test.inventory_issue')::uuid,null,null,null,null,null,'超額退回',
    current_setting('test.inventory_occurred_at')::timestamptz,4,'77080000-0000-4000-8000-000000000010'
  )$$,'23514','inventory return exceeds outstanding issued quantity','cumulative return cannot exceed the original issue'
);
-- 23
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'adjustment',null,-7,null,null,null,null,null,null,null,'盤差修正',
    current_setting('test.inventory_occurred_at')::timestamptz,4,'77080000-0000-4000-8000-000000000011'
  )$$,'23514','inventory movement would create an invalid balance','adjust permission never permits a negative balance'
);
-- 24
select results_eq(
  $$select movement_type,ledger_version,quantity_delta,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'adjustment',null,-1,null,null,null,null,null,null,null,'盤差修正',
    current_setting('test.inventory_occurred_at')::timestamptz,4,'77080000-0000-4000-8000-000000000012'
  )$$,$$values ('adjustment'::text,5,'-1.0000'::text,'5.0000'::text)$$,'adjustment records immutable AAL2 evidence and exact signed delta'
);
-- 25
select results_eq(
  $$select movement_type,ledger_version,quantity,quantity_delta,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'stocktake',null,null,5,null,null,null,null,null,null,'實際盤點相符',
    current_setting('test.inventory_occurred_at')::timestamptz,5,'77080000-0000-4000-8000-000000000013'
  )$$,$$values ('stocktake'::text,6,'5.0000'::text,'0.0000'::text,'5.0000'::text)$$,'zero-delta stocktake is preserved as an immutable observation'
);
reset role;
select set_config('test.inventory_verified_at_2',(clock_timestamp()-interval '15 seconds')::text,true);
insert into private.reauth_challenges (
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,
  consumed_jwt_jti,factor_method,factor_verified_at
) values (
  '77060000-0000-4000-8000-000000000002','77010000-0000-4000-8000-000000000001',
  '77061000-0000-4000-8000-000000000001',repeat('8',64),
  '77062000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 minute','inventory-before-2',
  clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '4 minutes',
  current_setting('test.inventory_verified_at_2')::timestamptz,
  current_setting('test.inventory_verified_at_2')::timestamptz,'inventory-after-2','totp',
  current_setting('test.inventory_verified_at_2')::timestamptz
);
update private.reauth_events set
  challenge_id='77060000-0000-4000-8000-000000000002',
  verified_at=current_setting('test.inventory_verified_at_2')::timestamptz
where user_id='77010000-0000-4000-8000-000000000001'
  and session_id='77061000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77061000-0000-4000-8000-000000000001"}',true);
select set_config(
  'test.inventory_stocktake',
  (select movement_id::text from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'stocktake',null,null,5,null,null,null,null,null,null,'實際盤點相符',
    current_setting('test.inventory_occurred_at')::timestamptz,5,'77080000-0000-4000-8000-000000000013'
  )),true
);
-- 26
select results_eq(
  $$select movement_id,ledger_version,replayed from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'stocktake',null,null,5,null,null,null,null,null,null,'實際盤點相符',
    current_setting('test.inventory_occurred_at')::timestamptz,5,'77080000-0000-4000-8000-000000000013'
  )$$,
  $$select current_setting('test.inventory_stocktake')::uuid,6,true$$,
  'high-risk exact replay uses current AAL2 evidence without requiring the historical challenge to remain latest'
);
-- 27
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'issue',1,null,null,null,null,null,null,'版本測試','日照區',null,
    current_setting('test.inventory_occurred_at')::timestamptz,5,'77080000-0000-4000-8000-000000000014'
  )$$,'40001','inventory ledger version conflict','stale expected ledger version is rejected under the batch lock'
);

-- 28
select results_eq(
  $$select status,status_ledger_version from public.set_inventory_item_status(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,'inactive','暫停領用',1,
    '77070000-0000-4000-8000-000000000003'
  )$$,$$values ('inactive'::text,2)$$,'deactivation appends a status event instead of changing the master'
);
-- 29
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'issue',1,null,null,null,null,null,null,'停用品測試','日照區',null,
    current_setting('test.inventory_occurred_at')::timestamptz,6,'77080000-0000-4000-8000-000000000015'
  )$$,'23514','inactive inventory item rejects routine movement','inactive items reject new issue movement'
);
-- 30
select results_eq(
  $$select status,status_ledger_version from public.set_inventory_item_status(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,'active','恢復使用',2,
    '77070000-0000-4000-8000-000000000004'
  )$$,$$values ('active'::text,3)$$,'reactivation appends the next terminal status version'
);

-- 31
select throws_ok(
  $$select * from public.create_inventory_item(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000002',
    'OTHER','跨分支','盒','77070000-0000-4000-8000-000000000005'
  )$$,'42501','inventory item creation is not permitted','actor cannot write a different branch'
);

reset role;
insert into public.inventory_batches (
  organization_id,branch_id,item_id,batch_number,expiry_date,unit,
  created_by,created_at,content_hash
) values (
  '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
  current_setting('test.inventory_item')::uuid,'EXPIRED-LOT',
  (clock_timestamp() at time zone 'Asia/Taipei')::date-1,'盒',
  '77010000-0000-4000-8000-000000000001',clock_timestamp()-interval '10 days',repeat('e',64)
);
insert into public.inventory_movements (
  organization_id,branch_id,item_id,batch_id,ledger_version,movement_type,
  quantity,quantity_delta,balance_after,occurred_at,recorded_by,recorded_at,content_hash
) select
  '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
  current_setting('test.inventory_item')::uuid,id,1,'receipt',2,2,2,
  clock_timestamp()-interval '10 days','77010000-0000-4000-8000-000000000001',
  clock_timestamp()-interval '10 days',repeat('f',64)
from public.inventory_batches where batch_number='EXPIRED-LOT';
select set_config('test.inventory_expired_batch',(select id::text from public.inventory_batches where batch_number='EXPIRED-LOT'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"77061000-0000-4000-8000-000000000001"}',true);

-- 32
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_expired_batch')::uuid,
    null,null,null,'issue',1,null,null,null,null,null,null,'回填日期測試','日照區',null,
    clock_timestamp()-interval '10 days',1,'77080000-0000-4000-8000-000000000016'
  )$$,'23514','expired inventory batch rejects receipt or issue','backdated occurredAt cannot bypass current server-date expiry'
);

-- 33
select results_eq(
  $$select policy_status,low_stock_total,near_expiry_total,stocktake_due_total,
           matching_batch_total,matching_item_total,matching_movement_total,
           jsonb_array_length(movement_history)
    from public.inventory_management_snapshot(
      '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
      current_setting('test.inventory_item')::uuid,'手套','LOT-1','all','client_issue'
    )$$,
  $$values ('not_configured'::text,null::bigint,null::bigint,null::bigint,
    1::bigint,1::bigint,1::bigint,1)$$,
  'server-side filters apply before aggregates and policy metrics stay unconfigured'
);
-- 34
select results_eq(
  $$select movement_history->0->>'movement_type',movement_history->0->>'client_id',
           movement_history->0->>'instruction_reference',
           movement_history->0->>'issued_to_display_name'
    from public.inventory_management_snapshot(
      '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
      null,null,null,'all','client_issue'
    )$$,
  $$values ('client_issue'::text,'77050000-0000-4000-8000-000000000001'::text,
    '依照個案照顧指示'::text,'庫存主管'::text)$$,
  'bounded ledger history preserves traceability without placing it in audit metadata'
);
-- 35
select throws_ok(
  $$select * from public.inventory_management_snapshot(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    null,null,null,'invented','all'
  )$$,'22023','inventory expiry filter is invalid','unknown expiry filter fails closed'
);
-- 36
select throws_ok(
  $$select * from public.inventory_management_snapshot(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    null,null,null,'all','purchase_order'
  )$$,'22023','inventory movement filter is invalid','unsupported movement filter fails closed'
);

-- 37
select results_eq(
  $$select movement_type,ledger_version,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',1,null,null,null,'77050000-0000-4000-8000-000000000003',
    '未指派個案指示','77010000-0000-4000-8000-000000000001',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,6,'77080000-0000-4000-8000-000000000017'
  )$$,$$values ('client_issue'::text,7,'4.0000'::text)$$,
  'manager may record an in-scope client issue without broadening ordinary staff scope'
);
select set_config(
  'test.inventory_unassigned_issue',
  (select movement_id::text from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',1,null,null,null,'77050000-0000-4000-8000-000000000003',
    '未指派個案指示','77010000-0000-4000-8000-000000000001',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,6,'77080000-0000-4000-8000-000000000017'
  )),true
);

select set_config('request.jwt.claims','{"sub":"77010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"77061000-0000-4000-8000-000000000002"}',true);
-- 38
select results_eq(
  $$select movement_history->0->>'client_scope_visible',
           movement_history->0->>'client_id',
           movement_history->0->>'instruction_reference',
           returnable_issue_options @> jsonb_build_array(jsonb_build_object(
             'original_movement_id',current_setting('test.inventory_unassigned_issue')::uuid
           ))
    from public.inventory_management_snapshot(
      '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
      null,null,null,'all','client_issue'
    )$$,
  $$values ('false'::text,null::text,null::text,false)$$,
  'ordinary staff sees numeric ledger history but unassigned client identity and instruction are redacted'
);
-- 39
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'return',1,null,null,current_setting('test.inventory_unassigned_issue')::uuid,
    null,null,null,null,null,'未用退回',current_setting('test.inventory_occurred_at')::timestamptz,7,
    '77080000-0000-4000-8000-000000000018'
  )$$,'42501','inventory return client scope is not permitted',
  'ordinary staff cannot return an unassigned client issue'
);
-- 40
select results_eq(
  $$select movement_type,ledger_version,balance_after from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',1,null,null,null,'77050000-0000-4000-8000-000000000001',
    '已指派個案指示','77010000-0000-4000-8000-000000000002',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,7,'77080000-0000-4000-8000-000000000019'
  )$$,$$values ('client_issue'::text,8,'3.0000'::text)$$,
  'assigned ordinary staff can record a scoped client issue'
);

reset role;
delete from public.client_assignments
where client_id='77050000-0000-4000-8000-000000000001'
  and assignee_user_id='77010000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"77061000-0000-4000-8000-000000000002"}',true);
-- 41
select throws_ok(
  $$select * from public.record_inventory_movement(
    '77020000-0000-4000-8000-000000000001','77030000-0000-4000-8000-000000000001',
    current_setting('test.inventory_item')::uuid,current_setting('test.inventory_batch')::uuid,
    null,null,null,'client_issue',1,null,null,null,'77050000-0000-4000-8000-000000000001',
    '已指派個案指示','77010000-0000-4000-8000-000000000002',null,null,null,
    current_setting('test.inventory_occurred_at')::timestamptz,7,'77080000-0000-4000-8000-000000000019'
  )$$,'42501','inventory movement replay is not permitted',
  'exact replay rechecks current client authority after assignment revocation'
);

reset role;
-- 42
select throws_ok(
  $$update public.inventory_movements set balance_after=999 where movement_type='receipt'$$,
  '23514','inventory_movements is append-only','committed ledger rows cannot be changed directly'
);
-- 43
select throws_ok(
  $$delete from public.inventory_batches where batch_number='LOT-1'$$,
  '23514','inventory_batches is append-only','committed batch rows cannot be deleted directly'
);
-- 44
select ok(
  (select balance_after = sum(quantity_delta) over (
     partition by batch_id order by ledger_version rows unbounded preceding
   ) from public.inventory_movements
   where batch_id=current_setting('test.inventory_batch')::uuid
   order by ledger_version desc limit 1)
  and not exists (
    select 1 from public.audit_events
    where table_name='inventory_management_snapshot'
      and (metadata ? 'client_id' or metadata ? 'instruction_reference')
  ),
  'terminal balance reconciles exactly and snapshot audits contain no client instruction data'
);

select * from finish();
rollback;
