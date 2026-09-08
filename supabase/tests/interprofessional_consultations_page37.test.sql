begin;

select plan(30);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'interprofessional_consultations.%' order by permission_key collate "C"$$,
  $$values
    ('interprofessional_consultations.assign'::text collate "C"),
    ('interprofessional_consultations.close'::text collate "C"),
    ('interprofessional_consultations.create'::text collate "C"),
    ('interprofessional_consultations.read'::text collate "C"),
    ('interprofessional_consultations.respond'::text collate "C")$$,
  'Page 37 exposes narrow read/create/assign/respond/close permissions'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class where oid in (
    'public.interprofessional_consultation_events'::regclass,
    'public.interprofessional_consultation_outbox'::regclass,
    'private.interprofessional_consultation_operations'::regclass
  )), 'all Page-37 ledgers force RLS');

select ok(
  not has_table_privilege('authenticated','public.interprofessional_consultation_events','select,insert,update,delete')
  and not has_table_privilege('service_role','public.interprofessional_consultation_events','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.interprofessional_consultation_outbox','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.interprofessional_consultation_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass Page-37 RPCs'
);

select ok(
  has_function_privilege('authenticated','public.mutate_interprofessional_consultation(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.interprofessional_consultation_snapshot(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)','execute')
  and not has_function_privilege('anon','public.interprofessional_consultation_snapshot(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)','execute')
  and not has_function_privilege('service_role','public.mutate_interprofessional_consultation(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)','execute'),
  'only authenticated callers receive the Page-37 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_interprofessional_consultation(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.interprofessional_consultation_snapshot(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.mutate_interprofessional_consultation_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,uuid,text,text,text,timestamptz,text,timestamptz,text,text,uuid,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.interprofessional_consultation_snapshot_response(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,date,date,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select ok(
  exists (select 1 from pg_trigger where not tgisinternal and tgname='interprofessional_consultation_events_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='interprofessional_consultation_outbox_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='interprofessional_consultation_operations_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='interprofessional_consultation_events_audit_row_change')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='interprofessional_consultation_outbox_audit_row_change'),
  'events, outbox and receipts are append-only; public inserts are audited'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','37000000-0000-4000-8000-000000000101','authenticated','authenticated','page37-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','37000000-0000-4000-8000-000000000102','authenticated','authenticated','page37-professional-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','37000000-0000-4000-8000-000000000103','authenticated','authenticated','page37-professional-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('37100000-0000-4000-8000-000000000101','p37','跨專業照會測試機構');
insert into public.branches(id,organization_id,code,name) values
  ('37200000-0000-4000-8000-000000000101','37100000-0000-4000-8000-000000000101','main','跨專業主分支'),
  ('37200000-0000-4000-8000-000000000102','37100000-0000-4000-8000-000000000101','other','跨專業其他分支');
insert into public.profiles(id,display_name,kind) values
  ('37000000-0000-4000-8000-000000000101','合成照會主管','staff'),
  ('37000000-0000-4000-8000-000000000102','合成專業人員甲','professional'),
  ('37000000-0000-4000-8000-000000000103','合成專業人員乙','professional');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('37300000-0000-4000-8000-000000000101','37100000-0000-4000-8000-000000000101',null,'37000000-0000-4000-8000-000000000101','active'),
  ('37300000-0000-4000-8000-000000000102','37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000102','active'),
  ('37300000-0000-4000-8000-000000000103','37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000103','active');
insert into public.membership_roles(membership_id,role_id) values
  ('37300000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002'),
  ('37300000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000007'),
  ('37300000-0000-4000-8000-000000000103','10000000-0000-4000-8000-000000000007');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
  ('37400000-0000-4000-8000-000000000101','37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101','P37-A','合成個案甲','active',current_date-30),
  ('37400000-0000-4000-8000-000000000102','37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000102','P37-B','合成個案乙','active',current_date-30);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
  ('37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101','37400000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000102','professional'),
  ('37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101','37400000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000103','professional');

create temporary table page37_times as select
  date_trunc('minute',clock_timestamp()) - interval '1 day' requested_at,
  date_trunc('minute',clock_timestamp()) + interval '2 days' due_at,
  clock_timestamp() - interval '30 seconds' verified_at;
grant select on page37_times to authenticated;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select '37500000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000101','37510000-0000-4000-8000-000000000101',repeat('3',64),'37520000-0000-4000-8000-000000000101',verified_at-interval '1 minute',verified_at-interval '1 minute',verified_at+interval '5 minutes',verified_at,verified_at,'totp',verified_at from page37_times;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select '37000000-0000-4000-8000-000000000101','37510000-0000-4000-8000-000000000101','37500000-0000-4000-8000-000000000101','aal2','totp',verified_at from page37_times;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select ok((select not replayed and operation_kind='create' and event_sequence=1
  and event_kind='created' and consultation_status='assigned'
  and assignment_state='assigned' and assignee_user_id='37000000-0000-4000-8000-000000000102'
  and deadline_state='dated' and notification_count=2
  and notification_queue_status='queued' and notification_delivery_claim='queued_not_delivered'
  and external_provider_status='not_configured'
  from public.mutate_interprofessional_consultation(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    'create',null,null,null,'37400000-0000-4000-8000-000000000101',
    '37000000-0000-4000-8000-000000000102','PT-MANUAL','物理治療','urgent',
    (select requested_at from page37_times),'dated',(select due_at from page37_times),
    '合成個案步態觀察需要跨專業人工回覆',null,null,
    '37600000-0000-4000-8000-000000000101'
  )), 'authorized requester creates an assigned immutable consultation');

reset role;
select ok((select count(*)=1 and bool_and(discipline_taxonomy_status='manual_unstandardized')
  and bool_and(urgency_source='manual') from public.interprofessional_consultation_events),
  'created event keeps manual taxonomy and urgency provenance');
select ok((select count(*)=2 and bool_and(queue_status='queued')
  and bool_and(delivery_claim='queued_not_delivered')
  and bool_and(external_provider_status='not_configured')
  from public.interprofessional_consultation_notification_outbox),
  'requester and assignee receive frozen queued in-app evidence only');
create temporary table page37_base as select consultation_key,id event_id,sequence
  from public.interprofessional_consultation_events;
grant select on page37_base to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select ok((select replayed and event_sequence=1 and notification_count=2
  from public.mutate_interprofessional_consultation(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    'create',null,null,null,'37400000-0000-4000-8000-000000000101',
    '37000000-0000-4000-8000-000000000102','PT-MANUAL','物理治療','urgent',
    (select requested_at from page37_times),'dated',(select due_at from page37_times),
    '合成個案步態觀察需要跨專業人工回覆',null,null,
    '37600000-0000-4000-8000-000000000101'
  )), 'exact retry returns the same receipt');
reset role;
select is((select count(*)::integer from public.interprofessional_consultation_events),1,
  'retry does not duplicate the event ledger');
select is((select count(*)::integer from public.interprofessional_consultation_notification_outbox),2,
  'retry does not duplicate queued recipient evidence');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_interprofessional_consultation(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  'create',null,null,null,'37400000-0000-4000-8000-000000000101',null,
  'OT-MANUAL','不同內容','routine',(select requested_at from page37_times),
  'not_applicable',null,'相同操作鍵不得用於不同內容',null,null,
  '37600000-0000-4000-8000-000000000101')$$,
  '23505','consultation idempotency conflict',
  'changed content cannot reuse an actor-scoped key');

select throws_ok($$select * from public.mutate_interprofessional_consultation(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  'create',null,null,null,'37400000-0000-4000-8000-000000000102',null,
  'OT-MANUAL','職能治療','routine',(select requested_at from page37_times),
  'not_applicable',null,'跨分支個案不得建立照會',null,null,
  '37600000-0000-4000-8000-000000000102')$$,
  '42501','consultation client is outside current scope',
  'cross-branch client scope fails closed');

select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_interprofessional_consultation(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  'create',null,null,null,'37400000-0000-4000-8000-000000000101',null,
  'OT-MANUAL','職能治療','routine',(select requested_at from page37_times),
  'not_applicable',null,'沒有近期雙因素驗證不得建立',null,null,
  '37600000-0000-4000-8000-000000000103')$$,
  '42501','consultation operation is not permitted',
  'create requires recent same-session AAL2');

select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000102","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000102"}',true);
select ok((select not replayed and operation_kind='reply' and event_sequence=2
  and event_kind='reply' and consultation_status='answered' and notification_count=2
  from public.mutate_interprofessional_consultation(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    'reply',(select consultation_key from page37_base),(select event_id from page37_base),1,
    null,null,null,null,null,null,null,null,null,
    '合成專業人員已人工檢視並提供回覆',null,
    '37600000-0000-4000-8000-000000000104'
  )), 'exact current assignee can reply with MFA but without a fresh high-risk reauth challenge');

reset role;
create temporary table page37_reply as select consultation_key,id event_id,sequence
  from public.interprofessional_consultation_events order by sequence desc limit 1;
grant select on page37_reply to authenticated;
select is((select count(*)::integer from public.interprofessional_consultation_events),2,
  'reply appends rather than overwrites');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_interprofessional_consultation(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  'reply',(select consultation_key from page37_reply),(select event_id from page37_reply),2,
  null,null,null,null,null,null,null,null,null,'主管不是精確承辦人不得回覆',null,
  '37600000-0000-4000-8000-000000000105')$$,
  '42501','only the exact assignee can respond',
  'a manager with broad scope still cannot impersonate the exact assignee');

select throws_ok($$select * from public.mutate_interprofessional_consultation(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  'reassign',(select consultation_key from page37_reply),(select event_id from page37_reply),2,
  null,'37000000-0000-4000-8000-000000000103',null,null,null,null,null,null,null,
  null,null,'37600000-0000-4000-8000-000000000106')$$,
  '22023','consultation action content is invalid',
  'reassignment requires an explicit reason');

select ok((select not replayed and event_sequence=3 and event_kind='reassigned'
  and assignee_user_id='37000000-0000-4000-8000-000000000103' and notification_count=3
  from public.mutate_interprofessional_consultation(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    'reassign',(select consultation_key from page37_reply),(select event_id from page37_reply),2,
    null,'37000000-0000-4000-8000-000000000103',null,null,null,null,null,null,null,
    '因合成人力配置改派並保留舊承辦通知',null,
    '37600000-0000-4000-8000-000000000107'
  )), 'reassignment appends and freezes requester, old and new assignee recipients');

reset role;
create temporary table page37_reassign as select consultation_key,id event_id,sequence
  from public.interprofessional_consultation_events order by sequence desc limit 1;
grant select on page37_reassign to authenticated;
select ok((select count(*)=3 and bool_and(recipient_reasons <@ array['requester','assignee','previous_assignee']::text[])
  from public.interprofessional_consultation_notification_outbox
  where source_event_id=(select event_id from page37_reassign)),
  'reassignment recipient snapshot is exact and deduplicated');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select ok((select matching_total=1 and jsonb_array_length(items)=1
  and jsonb_array_length(items->0->'history')=3
  and (items->0->>'discipline_taxonomy_status')='manual_unstandardized'
  and notification_delivery_claim='queued_not_delivered'
  and external_provider_status='not_configured'
  from public.interprofessional_consultation_snapshot(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    null,null,'all',null,null,'all','all','all',null,null,null
  )), 'snapshot returns current state and complete immutable history');

select throws_ok($$select * from public.interprofessional_consultation_snapshot(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  null,null,'all',null,null,'all','all','all',current_date,current_date-1,null)$$,
  '42501','consultation snapshot is not permitted',
  'reversed due-date ranges fail closed');

select throws_ok($$select * from public.mutate_interprofessional_consultation(
  '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
  'close',(select consultation_key from page37_reassign),(select event_id from page37_base),1,
  null,null,null,null,null,null,null,null,null,'過期事件不得結案',null,
  '37600000-0000-4000-8000-000000000108')$$,
  '40001','consultation base event is stale or outside scope',
  'expected sequence blocks stale writers');

select ok((select not replayed and event_kind='closed' and consultation_status='closed'
  from public.mutate_interprofessional_consultation(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    'close',(select consultation_key from page37_reassign),(select event_id from page37_reassign),3,
    null,null,null,null,null,null,null,null,null,'授權主管人工確認合成照會結案',null,
    '37600000-0000-4000-8000-000000000109'
  )), 'close appends a terminal event with AAL2 evidence');

reset role;
create temporary table page37_close as select consultation_key,id event_id,sequence
  from public.interprofessional_consultation_events order by sequence desc limit 1;
grant select on page37_close to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"37510000-0000-4000-8000-000000000101"}',true);
select ok((select not replayed and event_kind='reopened' and consultation_status='assigned'
  from public.mutate_interprofessional_consultation(
    '37100000-0000-4000-8000-000000000101','37200000-0000-4000-8000-000000000101',
    'reopen',(select consultation_key from page37_close),(select event_id from page37_close),4,
    null,null,null,null,null,null,null,null,null,'新增合成資訊後需重開照會',null,
    '37600000-0000-4000-8000-000000000110'
  )), 'reopen appends and restores the assigned state');

reset role;
select throws_ok($$update public.interprofessional_consultation_events set problem_summary='覆寫'$$,
  '55000','interprofessional_consultation_events is append-only',
  'completed consultation content cannot be updated');
select throws_ok($$delete from public.interprofessional_consultation_notification_outbox$$,
  '55000','interprofessional_consultation_outbox is append-only',
  'queued notification evidence cannot be deleted');

select ok((select count(*) >= 1 and bool_and(
  not (metadata ? 'query') and not (metadata ? 'problem_summary')
  and not (metadata ? 'discipline_code')
) from public.audit_events where table_name='interprofessional_consultation_snapshot'),
  'snapshot audit stores only minimized filter-presence metadata');

select ok((select bool_and(queue_status='queued'
  and delivery_claim='queued_not_delivered'
  and external_provider_status='not_configured')
  from public.interprofessional_consultation_notification_outbox),
  'no transition invents external sent, delivered, read or confirmed claims');

select * from finish();
rollback;
