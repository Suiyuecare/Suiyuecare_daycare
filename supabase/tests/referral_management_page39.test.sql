begin;

select plan(40);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'referral_management.%' order by permission_key collate "C"$$,
  $$values
    ('referral_management.close'::text collate "C"),
    ('referral_management.correct'::text collate "C"),
    ('referral_management.create'::text collate "C"),
    ('referral_management.read'::text collate "C"),
    ('referral_management.receive'::text collate "C"),
    ('referral_management.respond'::text collate "C"),
    ('referral_management.submit'::text collate "C")$$,
  'Page 39 exposes only its seven narrow permissions'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class where oid in (
    'public.referral_events'::regclass,
    'public.referral_notification_outbox'::regclass,
    'private.referral_operations'::regclass
  )), 'all Page 39 ledgers force RLS');

select ok(
  not has_table_privilege('authenticated','public.referral_events','select,insert,update,delete')
  and not has_table_privilege('service_role','public.referral_events','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.referral_notification_outbox','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.referral_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass Page 39 RPCs'
);

select ok(
  has_function_privilege('authenticated','public.mutate_referral_management(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.referral_management_snapshot(uuid,uuid,uuid,text,text,text,date,date,text)','execute')
  and not has_function_privilege('anon','public.referral_management_snapshot(uuid,uuid,uuid,text,text,text,date,date,text)','execute')
  and not has_function_privilege('service_role','public.mutate_referral_management(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)','execute'),
  'only authenticated callers receive the Page 39 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_referral_management(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.referral_management_snapshot(uuid,uuid,uuid,text,text,text,date,date,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.mutate_referral_management_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,text,text,text,timestamptz,text,text,text,uuid,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.referral_management_snapshot_response(uuid,uuid,uuid,text,text,text,date,date,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select ok(
  exists (select 1 from pg_trigger where not tgisinternal and tgname='referral_events_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='referral_notification_outbox_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='referral_operations_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='referral_events_audit_row_change')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='referral_notification_outbox_audit_row_change'),
  'events, outbox and operation receipts are append-only and audited'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','39000000-0000-4000-8000-000000000101','authenticated','authenticated','page39-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','39000000-0000-4000-8000-000000000102','authenticated','authenticated','page39-professional@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('39100000-0000-4000-8000-000000000101','p39','轉介管理測試機構');
insert into public.branches(id,organization_id,code,name) values
  ('39200000-0000-4000-8000-000000000101','39100000-0000-4000-8000-000000000101','main','轉介主分支'),
  ('39200000-0000-4000-8000-000000000102','39100000-0000-4000-8000-000000000101','other','轉介其他分支');
insert into public.profiles(id,display_name,kind) values
  ('39000000-0000-4000-8000-000000000101','合成轉介主管','staff'),
  ('39000000-0000-4000-8000-000000000102','合成專業人員','professional');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('39300000-0000-4000-8000-000000000101','39100000-0000-4000-8000-000000000101',null,'39000000-0000-4000-8000-000000000101','active'),
  ('39300000-0000-4000-8000-000000000102','39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101','39000000-0000-4000-8000-000000000102','active');
insert into public.membership_roles(membership_id,role_id) values
  ('39300000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002'),
  ('39300000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000007');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
  ('39400000-0000-4000-8000-000000000101','39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101','P39-A','合成個案甲','active',current_date-30),
  ('39400000-0000-4000-8000-000000000102','39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000102','P39-B','合成個案乙','active',current_date-30);

create temporary table page39_times as select
  date_trunc('minute',clock_timestamp()) - interval '3 days' referral_date,
  clock_timestamp() - interval '30 seconds' verified_at;
grant select on page39_times to authenticated;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select '39500000-0000-4000-8000-000000000101','39000000-0000-4000-8000-000000000101','39510000-0000-4000-8000-000000000101',repeat('3',64),'39520000-0000-4000-8000-000000000101',verified_at-interval '1 minute',verified_at-interval '1 minute',verified_at+interval '5 minutes',verified_at,verified_at,'totp',verified_at from page39_times;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select '39000000-0000-4000-8000-000000000101','39510000-0000-4000-8000-000000000101','39500000-0000-4000-8000-000000000101','aal2','totp',verified_at from page39_times;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select ok((select not replayed and operation_kind='create' and event_sequence=1
  and event_kind='created' and referral_status='draft'
  and receiving_unit_state='manual_unstandardized' and notification_count=1
  and notification_queue_status='queued' and notification_provider_status='not_configured'
  and external_delivery_status='not_configured'
  and delivery_claim='no_external_delivery_claim'
  and attachment_status='not_configured' and export_status='not_configured'
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'create',null,null,null,'39400000-0000-4000-8000-000000000101',
    'manual_unstandardized','DEMO-CLINIC','合成復健診所',
    (select referral_date from page39_times),'需要進一步復健專業評估',
    null,null,null,'39600000-0000-4000-8000-000000000101'
  )), 'authorized manager creates an immutable manual-unit draft');
reset role;

select ok((select count(*)=1 and bool_and(receiving_unit_directory_status='not_configured')
  and bool_and(status='draft') from public.referral_events),
  'created event preserves an unstandardized unit and draft status');
select ok((select count(*)=1 and bool_and(queue_status='queued')
  and bool_and(delivery_claim='no_external_delivery_claim')
  and bool_and(provider_status='not_configured')
  and bool_and(external_delivery_status='not_configured')
  from public.referral_notification_outbox),
  'in-app evidence never invents external delivery');
create temporary table page39_manual as select referral_key,id event_id,sequence
  from public.referral_events where receiving_unit_code='DEMO-CLINIC';
grant select on page39_manual to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select ok((select replayed and event_sequence=1 and notification_count=1
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'create',null,null,null,'39400000-0000-4000-8000-000000000101',
    'manual_unstandardized','DEMO-CLINIC','合成復健診所',
    (select referral_date from page39_times),'需要進一步復健專業評估',
    null,null,null,'39600000-0000-4000-8000-000000000101'
  )), 'exact retry returns the same operation receipt');
reset role;
select is((select count(*)::integer from public.referral_events),1,
  'retry does not duplicate the event ledger');
select is((select count(*)::integer from public.referral_notification_outbox),1,
  'retry does not duplicate the queued recipient snapshot');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'create',null,null,null,'39400000-0000-4000-8000-000000000101',
  'missing',null,null,(select referral_date from page39_times),'不同內容重用操作鍵',
  null,null,null,'39600000-0000-4000-8000-000000000101')$$,
  '23505','referral idempotency conflict',
  'changed content cannot reuse an actor-scoped key');

select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'create',null,null,null,'39400000-0000-4000-8000-000000000102',
  'missing',null,null,(select referral_date from page39_times),'跨分支個案不得建立轉介',
  null,null,null,'39600000-0000-4000-8000-000000000102')$$,
  '42501','referral client is outside current scope',
  'cross-branch client scope fails closed');

select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'create',null,null,null,'39400000-0000-4000-8000-000000000101',
  'missing',null,null,(select referral_date from page39_times),'沒有近期雙因素驗證不得建立',
  null,null,null,'39600000-0000-4000-8000-000000000103')$$,
  '42501','referral operation is not permitted',
  'all writes require recent same-session AAL2');

select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select ok((select receiving_unit_state='missing' and referral_status='draft'
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'create',null,null,null,'39400000-0000-4000-8000-000000000101',
    'missing',null,null,(select referral_date from page39_times),'來源資料缺少接收單位',
    null,null,null,'39600000-0000-4000-8000-000000000104'
  )), 'missing receiving unit is stored explicitly');
select ok((select receiving_unit_state='not_applicable' and referral_status='draft'
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'create',null,null,null,'39400000-0000-4000-8000-000000000101',
    'not_applicable',null,null,(select referral_date from page39_times),'來源資料明確標示接收單位不適用',
    null,null,null,'39600000-0000-4000-8000-000000000105'
  )), 'not-applicable receiving unit remains distinct from missing');
reset role;

create temporary table page39_missing as select referral_key,id event_id,sequence
  from public.referral_events where receiving_unit_state='missing';
grant select on page39_missing to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select ok((select matching_total=3 and draft_total=3
  and unit_missing_total=1 and unit_not_applicable_total=1
  from public.referral_management_snapshot(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    null,'all',null,'draft',null,null,null
  )), 'snapshot metrics keep missing and not-applicable units separate');

select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'submit',(select referral_key from page39_missing),(select event_id from page39_missing),1,
  null,null,null,null,null,null,null,null,null,'39600000-0000-4000-8000-000000000106')$$,
  '22023','submission requires an explicit manual receiving unit',
  'a missing-unit draft cannot pretend to be submitted');

select ok((select event_kind='submitted' and referral_status='submitted' and event_sequence=2
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'submit',(select referral_key from page39_manual),(select event_id from page39_manual),1,
    null,null,null,null,null,null,'院內版本已凍結但不代表外部送達',null,null,
    '39600000-0000-4000-8000-000000000107'
  )), 'manual-unit draft advances to submitted without claiming delivery');
reset role;

create temporary table page39_submitted as select referral_key,id event_id,sequence
  from public.referral_events where receiving_unit_code='DEMO-CLINIC' order by sequence desc limit 1;
grant select on page39_submitted to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'respond',(select referral_key from page39_submitted),(select event_id from page39_submitted),2,
  null,null,null,null,null,null,'尚未人工登記收件不得回覆',null,null,
  '39600000-0000-4000-8000-000000000108')$$,
  '40001','only a received referral can record response',
  'linear workflow rejects response before receipt');

select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'submit',(select referral_key from page39_submitted),(select event_id from page39_manual),1,
  null,null,null,null,null,null,null,null,null,
  '39600000-0000-4000-8000-000000000109')$$,
  '40001','referral base event is stale or outside scope',
  'expected sequence rejects stale writers');

select ok((select event_kind='receipt_registered' and referral_status='received'
  and external_delivery_status='not_configured'
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'register_received',(select referral_key from page39_submitted),(select event_id from page39_submitted),2,
    null,null,null,null,null,null,'員工人工登記收件，並非 provider 回執',null,null,
    '39600000-0000-4000-8000-000000000110'
  )), 'manual receipt registration appends explicit non-provider evidence');
reset role;

create temporary table page39_received as select referral_key,id event_id,sequence
  from public.referral_events where receiving_unit_code='DEMO-CLINIC' order by sequence desc limit 1;
grant select on page39_received to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'close',(select referral_key from page39_received),(select event_id from page39_received),3,
  null,null,null,null,null,null,'未取得回覆不得結案',null,null,
  '39600000-0000-4000-8000-000000000111')$$,
  '40001','only a responded referral can close',
  'linear workflow rejects close before response');

select ok((select event_kind='response_recorded' and referral_status='responded'
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'respond',(select referral_key from page39_received),(select event_id from page39_received),3,
    null,null,null,null,null,null,'人工登錄接收單位回覆內容',null,null,
    '39600000-0000-4000-8000-000000000112'
  )), 'response appends after manual receipt');
reset role;

create temporary table page39_responded as select referral_key,id event_id,sequence
  from public.referral_events where receiving_unit_code='DEMO-CLINIC' order by sequence desc limit 1;
grant select on page39_responded to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select ok((select event_kind='closed' and referral_status='closed'
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'close',(select referral_key from page39_responded),(select event_id from page39_responded),4,
    null,null,null,null,null,null,'授權人員人工確認轉介結案',null,null,
    '39600000-0000-4000-8000-000000000113'
  )), 'responded referral appends a terminal close event');
reset role;

create temporary table page39_closed as select referral_key,id event_id,sequence
  from public.referral_events where receiving_unit_code='DEMO-CLINIC' order by sequence desc limit 1;
grant select on page39_closed to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"39000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"39510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_referral_management(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  'correct',(select referral_key from page39_closed),(select event_id from page39_closed),5,
  null,null,null,null,null,null,'更正後內容',null,(select event_id from page39_responded),
  '39600000-0000-4000-8000-000000000114')$$,
  '22023','referral action content is invalid',
  'narrow correction requires an explicit reason');

select ok((select event_kind='corrected' and referral_status='closed' and event_sequence=6
  from public.mutate_referral_management(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    'correct',(select referral_key from page39_closed),(select event_id from page39_closed),5,
    null,null,null,null,null,null,'更正後的人工回覆摘要','原登錄摘要文字誤植',
    (select event_id from page39_responded),'39600000-0000-4000-8000-000000000115'
  )), 'narrow correction appends without changing the closed state');

select ok((select matching_total=1 and jsonb_array_length(items)=1
  and jsonb_array_length(items->0->'history')=6
  and receiving_unit_directory_status='not_configured'
  and attachment_status='not_configured' and export_status='not_configured'
  and notification_provider_status='not_configured'
  and external_delivery_status='not_configured'
  and delivery_claim='no_external_delivery_claim'
  and can_create and can_submit and can_register_receipt and can_respond and can_close and can_correct
  from public.referral_management_snapshot(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    null,'specific','DEMO-CLINIC','all',null,null,null
  )), 'snapshot returns exact manual unit, complete history and fail-closed capabilities');

select ok((select matching_total=1 and (items->0->>'receiving_unit_code')='DEMO-CLINIC'
  from public.referral_management_snapshot(
    '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
    null,'specific','DEMO-CLINIC','all',null,null,null
  )), 'specific receiving-unit filtering is exact');

select throws_ok($$select * from public.referral_management_snapshot(
  '39100000-0000-4000-8000-000000000101','39200000-0000-4000-8000-000000000101',
  null,'all',null,'all',current_date,current_date-1,null)$$,
  '42501','referral snapshot is not permitted',
  'reversed recent-event dates fail closed');
reset role;

select throws_ok($$update public.referral_events set referral_reason='覆寫內容'$$,
  '55000','referral_events is append-only',
  'event narratives cannot be overwritten');
select throws_ok($$delete from public.referral_notification_outbox$$,
  '55000','referral_notification_outbox is append-only',
  'queued recipient evidence cannot be deleted');
select throws_ok($$update private.referral_operations set result_status='draft'$$,
  '55000','referral_operations is append-only',
  'operation receipts cannot be overwritten');

select ok((select count(*) >= 1 and bool_and(
  not (metadata ? 'query') and not (metadata ? 'referral_reason')
  and not (metadata ? 'receiving_unit_code')
) from public.audit_events where table_name='referral_management_snapshot'),
  'snapshot audit stores only minimized filter-presence metadata');

select ok((select bool_and(queue_status='queued'
  and delivery_claim='no_external_delivery_claim'
  and provider_status='not_configured'
  and external_delivery_status='not_configured')
  from public.referral_notification_outbox),
  'no transition invents external sent, delivered, read or confirmed claims');

select ok((select count(*)=6 and max(sequence)=6
  from public.referral_events where receiving_unit_code='DEMO-CLINIC'),
  'manual workflow remains one immutable linear six-event stream');

select is((select count(*)::integer from private.referral_operations),8,
  'only successful writes persist actor-scoped operation receipts');

select ok((select bool_and(reauth_challenge_id is not null) from public.referral_events),
  'every persisted write carries recent AAL2 evidence');

select ok((select count(*)=3 and count(*) filter (where receiving_unit_state='missing')=1
  and count(*) filter (where receiving_unit_state='not_applicable')=1
  from (select distinct on (referral_key) * from public.referral_events
    order by referral_key,sequence desc) current),
  'three current referrals preserve manual, missing and not-applicable unit states');

select * from finish();
rollback;
