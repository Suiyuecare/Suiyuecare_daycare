begin;

select plan(45);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'case_conferences.%' order by permission_key collate "C"$$,
  $$values
    ('case_conferences.manage'::text collate "C"),
    ('case_conferences.read'::text collate "C"),
    ('case_conferences.sign'::text collate "C")$$,
  'Page 38 exposes three narrow permissions'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class where oid in (
    'public.case_conference_versions'::regclass,
    'private.case_conference_operations'::regclass
  )), 'Page 38 version and operation ledgers force RLS');

select ok(
  not has_table_privilege('authenticated','public.case_conference_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.case_conference_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.case_conference_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass Page 38 RPCs'
);

select ok(
  has_function_privilege('authenticated','public.mutate_case_conference(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)','execute')
  and has_function_privilege('authenticated','public.case_conference_snapshot(uuid,uuid,uuid,text,uuid,text,date,date,text)','execute')
  and not has_function_privilege('anon','public.case_conference_snapshot(uuid,uuid,uuid,text,uuid,text,date,date,text)','execute')
  and not has_function_privilege('service_role','public.mutate_case_conference(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)','execute'),
  'only authenticated callers receive the Page 38 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_case_conference(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.case_conference_snapshot(uuid,uuid,uuid,text,uuid,text,date,date,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.mutate_case_conference_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,timestamptz,timestamptz,text,text,jsonb,jsonb,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.case_conference_snapshot_response(uuid,uuid,uuid,text,uuid,text,date,date,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select ok(
  exists (select 1 from pg_trigger where not tgisinternal and tgname='case_conference_versions_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='case_conference_operations_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='case_conference_versions_audit_row_change'),
  'conference versions and operation receipts are append-only and audited'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','38000000-0000-4000-8000-000000000101','authenticated','authenticated','page38-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','38000000-0000-4000-8000-000000000102','authenticated','authenticated','page38-professional@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','38000000-0000-4000-8000-000000000103','authenticated','authenticated','page38-worker@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('38100000-0000-4000-8000-000000000101','p38','個案研討測試機構');
insert into public.branches(id,organization_id,code,name) values
  ('38200000-0000-4000-8000-000000000101','38100000-0000-4000-8000-000000000101','main','研討主分支'),
  ('38200000-0000-4000-8000-000000000102','38100000-0000-4000-8000-000000000101','other','研討其他分支');
insert into public.profiles(id,display_name,kind) values
  ('38000000-0000-4000-8000-000000000101','合成研討主管','staff'),
  ('38000000-0000-4000-8000-000000000102','合成專業人員','professional'),
  ('38000000-0000-4000-8000-000000000103','合成照服人員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
  ('38300000-0000-4000-8000-000000000101','38100000-0000-4000-8000-000000000101',null,'38000000-0000-4000-8000-000000000101','active',clock_timestamp()-interval '1 minute'),
  ('38300000-0000-4000-8000-000000000102','38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101','38000000-0000-4000-8000-000000000102','active',clock_timestamp()-interval '1 minute'),
  ('38300000-0000-4000-8000-000000000103','38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101','38000000-0000-4000-8000-000000000103','active',clock_timestamp()-interval '1 minute');
insert into public.membership_roles(membership_id,role_id) values
  ('38300000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002'),
  ('38300000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000007'),
  ('38300000-0000-4000-8000-000000000103','10000000-0000-4000-8000-000000000006');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
  ('38400000-0000-4000-8000-000000000101','38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101','P38-A','合成個案甲','active',current_date-30),
  ('38400000-0000-4000-8000-000000000102','38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000102','P38-B','合成個案乙','active',current_date-30);

create temporary table page38_values as select
  date_trunc('minute',clock_timestamp()) - interval '4 days' past_start,
  date_trunc('minute',clock_timestamp()) - interval '4 days' + interval '1 hour' past_end,
  date_trunc('minute',clock_timestamp()) + interval '1 day' future_start,
  date_trunc('minute',clock_timestamp()) + interval '1 day 1 hour' future_end,
  clock_timestamp() - interval '30 seconds' verified_at,
  jsonb_build_array(
    jsonb_build_object('user_id','38000000-0000-4000-8000-000000000101','attendance_status','attended'),
    jsonb_build_object('user_id','38000000-0000-4000-8000-000000000102','attendance_status','remote')
  ) attendees,
  jsonb_build_array(
    jsonb_build_object('action_id','38600000-0000-4000-8000-000000000101','item_order',1,
      'action_text','完成合成專業觀察摘要','responsible_user_id','38000000-0000-4000-8000-000000000102',
      'deadline_state','dated','due_date',(current_date+1)::text,'action_status','open'),
    jsonb_build_object('action_id','38600000-0000-4000-8000-000000000102','item_order',2,
      'action_text','補入合成照顧觀察紀錄','responsible_user_id','38000000-0000-4000-8000-000000000101',
      'deadline_state','missing','due_date',null,'action_status','open'),
    jsonb_build_object('action_id','38600000-0000-4000-8000-000000000103','item_order',3,
      'action_text','確認不需額外外部通知','responsible_user_id','38000000-0000-4000-8000-000000000101',
      'deadline_state','not_applicable','due_date',null,'action_status','completed')
  ) actions;
grant select on page38_values to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select ok((select not replayed and operation_kind='create' and version=1
  and version_kind='created' and conference_status='draft' and signed_at is null
  and attachment_status='not_configured' and export_status='not_configured'
  and notification_status='not_configured' and external_delivery_status='not_configured'
  and delivery_claim='no_external_delivery_claim' and offline_status='not_configured'
  from public.mutate_case_conference(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    'create',null,null,null,null,'38400000-0000-4000-8000-000000000101',
    (select past_start from page38_values),(select past_end from page38_values),
    '移位安全需跨專業共同研討','先建立草稿並確認行動項目',
    (select attendees from page38_values),(select actions from page38_values),null,
    '38800000-0000-4000-8000-000000000101'
  )), 'manager creates a draft without requiring a recent AAL2 challenge');
reset role;

select ok((select count(*)=1 and bool_and(status='draft')
  and bool_and(signed_at is null and signer_user_id is null and reauth_challenge_id is null)
  from public.case_conference_versions),
  'draft preserves unsigned fields and no reauthentication claim');
select ok((select attendees->0->>'display_name'='合成研討主管'
  and attendees->0->'role_keys' ? 'organization_manager'
  and attendees->1->>'attendance_status'='remote'
  from public.case_conference_versions),
  'attendee identity, role and attendance status are frozen');
select ok((select action_items->0->>'responsible_display_name'='合成專業人員'
  and action_items->1->>'deadline_state'='missing'
  and action_items->2->>'deadline_state'='not_applicable'
  from public.case_conference_versions),
  'action owner and three-state manual deadlines are frozen');

create temporary table page38_main as select meeting_key,id version_id,version
  from public.case_conference_versions where client_id='38400000-0000-4000-8000-000000000101';
grant select on page38_main to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select ok((select replayed and version=1 from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'create',null,null,null,null,'38400000-0000-4000-8000-000000000101',
  (select past_start from page38_values),(select past_end from page38_values),
  '移位安全需跨專業共同研討','先建立草稿並確認行動項目',
  (select attendees from page38_values),(select actions from page38_values),null,
  '38800000-0000-4000-8000-000000000101'
)), 'exact retry returns the original receipt');
reset role;
select is((select count(*)::integer from public.case_conference_versions),1,
  'exact retry does not duplicate a version');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'create',null,null,null,null,'38400000-0000-4000-8000-000000000101',
  (select past_start from page38_values),(select past_end from page38_values),
  '不同問題內容不得沿用相同操作鍵','先建立草稿並確認行動項目',
  (select attendees from page38_values),(select actions from page38_values),null,
  '38800000-0000-4000-8000-000000000101')$$,
  '23505','case conference idempotency conflict',
  'changed content cannot reuse an actor-scoped key');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'create',null,null,null,null,'38400000-0000-4000-8000-000000000102',
  (select past_start from page38_values),(select past_end from page38_values),
  '跨分支個案不可建立研討會議','此內容不應寫入',
  (select attendees from page38_values),(select actions from page38_values),null,
  '38800000-0000-4000-8000-000000000102')$$,
  '42501','case conference client is outside current scope',
  'cross-branch client scope fails closed');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'create',null,null,null,null,'38400000-0000-4000-8000-000000000101',
  (select past_start from page38_values),(select past_end from page38_values),
  '期限不得早於會議日期','此內容不應寫入',
  (select attendees from page38_values),jsonb_build_array(jsonb_build_object(
    'action_id','38600000-0000-4000-8000-000000000109','item_order',1,
    'action_text','不合法的早期期限','responsible_user_id','38000000-0000-4000-8000-000000000101',
    'deadline_state','dated','due_date',(current_date-5)::text,'action_status','open'
  )),null,'38800000-0000-4000-8000-000000000103')$$,
  '22023','case conference action, order or manual deadline is invalid',
  'dated due date before the Taipei meeting date is rejected');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'create',null,null,null,null,'38400000-0000-4000-8000-000000000101',
  (select past_start from page38_values),(select past_end from page38_values),
  '出席者不可重複','此內容不應寫入',
  jsonb_build_array(
    jsonb_build_object('user_id','38000000-0000-4000-8000-000000000101','attendance_status','attended'),
    jsonb_build_object('user_id','38000000-0000-4000-8000-000000000101','attendance_status','remote')
  ),(select actions from page38_values),null,'38800000-0000-4000-8000-000000000104')$$,
  '22023','case conference attendee is duplicated or invalid',
  'duplicate attendee snapshot is rejected');

select ok((select version=1 and conference_status='draft' from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'create',null,null,null,null,'38400000-0000-4000-8000-000000000101',
  (select future_start from page38_values),(select future_end from page38_values),
  '未來會議草稿用於簽署時間邊界','會議結束前不得簽署',
  (select attendees from page38_values),jsonb_build_array(jsonb_build_object(
    'action_id','38600000-0000-4000-8000-000000000110','item_order',1,
    'action_text','會後完成合成追蹤','responsible_user_id','38000000-0000-4000-8000-000000000101',
    'deadline_state','dated','due_date',(current_date+2)::text,'action_status','open'
  )),null,'38800000-0000-4000-8000-000000000105'
)), 'future conference draft can be prepared without claiming signature');
reset role;

create temporary table page38_future as select meeting_key,id version_id,version
  from public.case_conference_versions where meeting_starts_at > clock_timestamp();
grant select on page38_future to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select ok((select version=2 and version_kind='revised' and conference_status='draft'
  from public.mutate_case_conference(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    'revise',(select meeting_key from page38_main),(select version_id from page38_main),1,null,null,
    (select past_start from page38_values),(select past_end from page38_values),
    '移位安全需跨專業共同研討','修訂草稿並補齊負責人與期限三態',
    (select attendees from page38_values),(select actions from page38_values),null,
    '38800000-0000-4000-8000-000000000106'
  )), 'draft revision appends a second unsigned version');
reset role;

create temporary table page38_revised as select meeting_key,id version_id,version
  from public.case_conference_versions
  where meeting_key=(select meeting_key from page38_main) order by version desc limit 1;
grant select on page38_revised to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000999"}',true);
select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'revise',(select meeting_key from page38_main),(select version_id from page38_main),1,null,null,
  (select past_start from page38_values),(select past_end from page38_values),
  '過期版本不得覆寫','此內容不應寫入',(select attendees from page38_values),
  (select actions from page38_values),null,'38800000-0000-4000-8000-000000000107')$$,
  '40001','case conference base version is stale or outside scope',
  'expected version rejects stale draft writers');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'sign',(select meeting_key from page38_revised),(select version_id from page38_revised),2,null,
  null,null,null,null,null,null,null,null,'38800000-0000-4000-8000-000000000108')$$,
  '42501','case conference operation is not permitted',
  'signing requires recent same-session AAL2');

reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select '38700000-0000-4000-8000-000000000101','38000000-0000-4000-8000-000000000101','38710000-0000-4000-8000-000000000101',repeat('3',64),'38720000-0000-4000-8000-000000000101',verified_at-interval '1 minute',verified_at-interval '1 minute',verified_at+interval '5 minutes',verified_at,verified_at,'totp',verified_at from page38_values;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select '38000000-0000-4000-8000-000000000101','38710000-0000-4000-8000-000000000101','38700000-0000-4000-8000-000000000101','aal2','totp',verified_at from page38_values;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select ok((select version=3 and version_kind='signed' and conference_status='signed'
  and signed_at is not null and content_hash ~ '^[a-f0-9]{64}$'
  from public.mutate_case_conference(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    'sign',(select meeting_key from page38_revised),(select version_id from page38_revised),2,null,
    null,null,null,null,null,null,null,null,'38800000-0000-4000-8000-000000000109'
  )), 'recent AAL2 signs an unchanged draft as version three');
reset role;

select ok((select signer_user_id='38000000-0000-4000-8000-000000000101'
  and signer_membership_id='38300000-0000-4000-8000-000000000101'
  and signer_role_keys @> array['organization_manager']::text[]
  and reauth_challenge_id='38700000-0000-4000-8000-000000000101'
  and signature_purpose='個案研討會議紀錄簽署'
  from public.case_conference_versions
  where meeting_key=(select meeting_key from page38_main) and version=3),
  'signed DB version preserves signer user, membership, roles, reauth and purpose');

create temporary table page38_signed as select meeting_key,id version_id,version
  from public.case_conference_versions
  where meeting_key=(select meeting_key from page38_main) order by version desc limit 1;
grant select on page38_signed to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'sign',(select meeting_key from page38_future),(select version_id from page38_future),1,null,
  null,null,null,null,null,null,null,null,'38800000-0000-4000-8000-000000000110')$$,
  '22023','case conference cannot be signed before meeting end',
  'server time cannot sign before the meeting ends');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'revise',(select meeting_key from page38_signed),(select version_id from page38_signed),3,null,null,
  (select past_start from page38_values),(select past_end from page38_values),
  '簽後不得修訂','此內容不應寫入',(select attendees from page38_values),
  (select actions from page38_values),null,'38800000-0000-4000-8000-000000000111')$$,
  '40001','only a draft case conference can be revised',
  'a signed version cannot be revised in place');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'correct',(select meeting_key from page38_signed),(select version_id from page38_signed),3,
  (select version_id from page38_signed),null,(select past_start from page38_values),(select past_end from page38_values),
  '更正需理由','更正需理由',(select attendees from page38_values),(select actions from page38_values),null,
  '38800000-0000-4000-8000-000000000112')$$,
  '40001','case conference correction target is invalid',
  'signed correction requires an explicit reason');

select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'correct',(select meeting_key from page38_signed),(select version_id from page38_signed),3,
  (select version_id from page38_main),null,(select past_start from page38_values),(select past_end from page38_values),
  '更正目標必須是目前簽署版','此內容不應寫入',(select attendees from page38_values),(select actions from page38_values),'錯誤目標',
  '38800000-0000-4000-8000-000000000113')$$,
  '40001','case conference correction target is invalid',
  'correction cannot point at an older version');

select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000999"}',true);
select throws_ok($$select * from public.mutate_case_conference(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  'correct',(select meeting_key from page38_signed),(select version_id from page38_signed),3,
  (select version_id from page38_signed),null,(select past_start from page38_values),(select past_end from page38_values),
  '更正仍需近期雙因素','此內容不應寫入',(select attendees from page38_values),(select actions from page38_values),'人工更正理由',
  '38800000-0000-4000-8000-000000000114')$$,
  '42501','case conference operation is not permitted',
  'correction requires recent same-session AAL2');

select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select ok((select version=4 and version_kind='corrected' and conference_status='signed'
  and corrects_version_id=(select version_id from page38_signed)
  from public.mutate_case_conference(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    'correct',(select meeting_key from page38_signed),(select version_id from page38_signed),3,
    (select version_id from page38_signed),null,(select past_start from page38_values),(select past_end from page38_values),
    '移位安全需跨專業共同研討','更正決議並保留原簽署版本',
    (select attendees from page38_values),jsonb_build_array(
      jsonb_build_object('action_id','38600000-0000-4000-8000-000000000101','item_order',1,
        'action_text','完成合成專業觀察摘要','responsible_user_id','38000000-0000-4000-8000-000000000102',
        'deadline_state','dated','due_date',(current_date-1)::text,'action_status','open'),
      jsonb_build_object('action_id','38600000-0000-4000-8000-000000000102','item_order',2,
        'action_text','補入合成照顧觀察紀錄','responsible_user_id','38000000-0000-4000-8000-000000000101',
        'deadline_state','missing','due_date',null,'action_status','open'),
      jsonb_build_object('action_id','38600000-0000-4000-8000-000000000103','item_order',3,
        'action_text','確認不需額外外部通知','responsible_user_id','38000000-0000-4000-8000-000000000101',
        'deadline_state','not_applicable','due_date',null,'action_status','completed')
    ),'原決議漏列人工追蹤責任','38800000-0000-4000-8000-000000000115'
  )), 'reasoned correction appends a newly signed version four');
reset role;

create temporary table page38_corrected as select meeting_key,id version_id,version
  from public.case_conference_versions
  where meeting_key=(select meeting_key from page38_main) order by version desc limit 1;
grant select on page38_corrected to authenticated;

select ok((select count(*)=4 and max(version)=4
  from public.case_conference_versions where meeting_key=(select meeting_key from page38_main)),
  'signed conference remains one immutable four-version linear chain');
select ok((select signed_at >= meeting_ends_at and author_user_id=signer_user_id
  and content_hash ~ '^[a-f0-9]{64}$' from public.case_conference_versions
  where id=(select version_id from page38_corrected)),
  'corrected version carries server-time signature and content hash');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select ok((select matching_total=2 and draft_total=1 and signed_total=1
  and corrected_total=1 and action_total=4 and open_action_total=3
  and overdue_action_total=1 and deadline_missing_total=1
  and deadline_not_applicable_total=1 and jsonb_array_length(items)=2
  and can_manage and can_sign and can_correct
  and attachment_status='not_configured' and export_status='not_configured'
  and notification_status='not_configured' and external_delivery_status='not_configured'
  and delivery_claim='no_external_delivery_claim' and offline_status='not_configured'
  from public.case_conference_snapshot(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    null,'all',null,'all',null,null,null
  )), 'snapshot computes full collection metrics and fail-closed integrations');

select ok((select matching_total=1 and overdue_action_total=1
  and jsonb_array_length(items->0->'history')=4
  from public.case_conference_snapshot(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    null,'signed',null,'overdue',null,null,null
  )), 'overdue filter uses only explicit dated open actions and preserves full history');

select ok((select matching_total=1 and action_total=3
  from public.case_conference_snapshot(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    null,'all','38000000-0000-4000-8000-000000000102','all',null,null,null
  )), 'responsible-person filter is exact');

select ok((select matching_total=1 and draft_total=1 and signed_total=0
  from public.case_conference_snapshot(
    '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
    null,'draft',null,'all',null,null,null
  )), 'draft status filter remains separate from signed conferences');

select throws_ok($$select * from public.case_conference_snapshot(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  null,'all',null,'all',current_date,current_date-1,null)$$,
  '42501','case conference snapshot is not permitted',
  'reversed meeting dates fail closed');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"38000000-0000-4000-8000-000000000103","role":"authenticated","aal":"aal2","session_id":"38710000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.case_conference_snapshot(
  '38100000-0000-4000-8000-000000000101','38200000-0000-4000-8000-000000000101',
  null,'all',null,'all',null,null,null)$$,
  '42501','case conference snapshot is not permitted',
  'staff without Page 38 permission receives no partial snapshot');
reset role;

select throws_ok($$update public.case_conference_versions set decision_summary='覆寫簽署內容'$$,
  '55000','case_conference_versions is append-only',
  'signed and draft versions cannot be overwritten');
select throws_ok($$delete from private.case_conference_operations$$,
  '55000','case_conference_operations is append-only',
  'actor-scoped operation receipts cannot be deleted');

select ok((select count(*) >= 1 and bool_and(
  not (metadata ? 'query') and not (metadata ? 'problem_statement')
  and not (metadata ? 'decision_summary') and not (metadata ? 'responsible_user_id')
) from public.audit_events where table_name='case_conference_snapshot'),
  'snapshot audit stores only minimized filter-presence metadata');

select is((select count(*)::integer from private.case_conference_operations),5,
  'only five successful create, revise, sign and correction writes persist receipts');
select is((select count(*)::integer from public.case_conference_versions),5,
  'two conference streams contain five immutable versions total');
select ok((select count(*)=2 from public.case_conference_versions
  where status='signed' and signer_user_id is not null
    and cardinality(signer_role_keys)>0 and reauth_challenge_id is not null),
  'every signed and corrected version retains full signer evidence');
select ok((select count(*)=3 from public.case_conference_versions
  where status='draft' and signer_user_id is null and reauth_challenge_id is null),
  'draft and revised versions never claim signature evidence');
select ok((select action_items->0->>'deadline_state'='dated'
  and action_items->1->>'deadline_state'='missing'
  and action_items->2->>'deadline_state'='not_applicable'
  from public.case_conference_versions where id=(select version_id from page38_corrected)),
  'corrected snapshot preserves dated, missing and not-applicable separately');
select ok((select previous_version_id=(select version_id from page38_signed)
  and corrects_version_id=(select version_id from page38_signed)
  and correction_reason='原決議漏列人工追蹤責任'
  from public.case_conference_versions where id=(select version_id from page38_corrected)),
  'correction links its source and reason without modifying source content');

select * from finish();
rollback;
