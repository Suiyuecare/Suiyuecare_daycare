begin;

select plan(27);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'reassurance_calendar.%' order by permission_key collate "C"$$,
  $$values
    ('reassurance_calendar.cancel'::text collate "C"),
    ('reassurance_calendar.manage'::text collate "C"),
    ('reassurance_calendar.read'::text collate "C")$$,
  'Page 44 exposes narrow read, manage and cancel permissions'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity)
  from pg_class where oid in (
    'public.reassurance_calendar_event_versions'::regclass,
    'private.reassurance_calendar_operations'::regclass
  )), 'every Page-44 formal and replay table forces RLS');

select ok(
  not has_table_privilege('authenticated','public.reassurance_calendar_event_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.reassurance_calendar_event_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.reassurance_calendar_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass Page-44 RPCs'
);

select ok(
  has_function_privilege('authenticated','public.mutate_reassurance_calendar_event(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)','execute')
  and has_function_privilege('authenticated','public.reassurance_calendar_snapshot(uuid,uuid,date,uuid,text,text,boolean,text)','execute')
  and not has_function_privilege('anon','public.reassurance_calendar_snapshot(uuid,uuid,date,uuid,text,text,boolean,text)','execute')
  and not has_function_privilege('service_role','public.mutate_reassurance_calendar_event(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)','execute'),
  'only authenticated callers receive the Page-44 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_reassurance_calendar_event(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.reassurance_calendar_snapshot(uuid,uuid,date,uuid,text,text,boolean,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.mutate_reassurance_calendar_event_guarded(uuid,uuid,text,uuid,uuid,integer,text,text,text,timestamptz,timestamptz,text,text,uuid[],uuid,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.reassurance_calendar_snapshot_response(uuid,uuid,date,uuid,text,text,boolean,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select ok(
  exists (select 1 from pg_trigger where not tgisinternal and tgname='reassurance_calendar_event_versions_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='reassurance_calendar_operations_prevent_mutation')
  and exists (select 1 from pg_trigger where not tgisinternal and tgname='reassurance_calendar_event_versions_audit_row_change'),
  'formal Page-44 versions and replay receipts are append-only and audited'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','44000000-0000-4000-8000-000000000101','authenticated','authenticated','calendar44-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','44000000-0000-4000-8000-000000000102','authenticated','authenticated','calendar44-responsible@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('44100000-0000-4000-8000-000000000101','cal44','安心行事曆測試機構');
insert into public.branches(id,organization_id,code,name) values
  ('44200000-0000-4000-8000-000000000101','44100000-0000-4000-8000-000000000101','main','安心行事曆主分支'),
  ('44200000-0000-4000-8000-000000000102','44100000-0000-4000-8000-000000000101','other','安心行事曆其他分支');
insert into public.profiles(id,display_name,kind) values
  ('44000000-0000-4000-8000-000000000101','安心行事曆管理員','staff'),
  ('44000000-0000-4000-8000-000000000102','安心行事曆負責人','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('44300000-0000-4000-8000-000000000101','44100000-0000-4000-8000-000000000101',null,'44000000-0000-4000-8000-000000000101','active'),
  ('44300000-0000-4000-8000-000000000102','44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101','44000000-0000-4000-8000-000000000102','active');
insert into public.membership_roles(membership_id,role_id) values
  ('44300000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002'),
  ('44300000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000006');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on) values
  ('44400000-0000-4000-8000-000000000101','44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101','CAL-44-A','合成個案甲','active',current_date-30,null),
  ('44400000-0000-4000-8000-000000000102','44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000102','CAL-44-B','合成個案乙','active',current_date-30,null);

create temporary table page44_times as select
  date_trunc('minute',clock_timestamp()) + interval '2 days' starts_at,
  date_trunc('minute',clock_timestamp()) + interval '2 days 1 hour' ends_at,
  clock_timestamp() - interval '30 seconds' verified_at;
grant select on page44_times to authenticated;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select '44500000-0000-4000-8000-000000000101','44000000-0000-4000-8000-000000000101','44510000-0000-4000-8000-000000000101',repeat('4',64),'44520000-0000-4000-8000-000000000101',verified_at-interval '1 minute',verified_at-interval '1 minute',verified_at+interval '5 minutes',verified_at,verified_at,'totp',verified_at from page44_times;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select '44000000-0000-4000-8000-000000000101','44510000-0000-4000-8000-000000000101','44500000-0000-4000-8000-000000000101','aal2','totp',verified_at from page44_times;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"44510000-0000-4000-8000-000000000101"}',true);

select ok((select not replayed and operation_kind='create' and event_version=1
  and record_kind='original' and event_status='scheduled'
  and event_category='care' and audience_count=1
  and publication_state='published' and signature_status='not_configured'
  and notification_status='not_configured' and notification_delivery='none_not_sent'
  from public.mutate_reassurance_calendar_event(
    '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
    'create',null,null,null,'care','合成照顧行程','僅供測試的合成行程摘要',
    (select starts_at from page44_times),(select ends_at from page44_times),'合成活動室',
    'selected_clients',array['44400000-0000-4000-8000-000000000101'::uuid],
    '44000000-0000-4000-8000-000000000102',null,'44600000-0000-4000-8000-000000000101'
  )), 'authorized manager creates one immutable published event');

reset role;
select ok((select count(*)=1 and bool_and(publication_state='published')
  and bool_and(signature_status='not_configured') and bool_and(notification_delivery='none_not_sent')
  from public.reassurance_calendar_event_versions),
  'formal event stores honest publication, signature and delivery boundaries');
create temporary table page44_base as
  select event_key,id version_id,version from public.reassurance_calendar_event_versions;
grant select on page44_base to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"44510000-0000-4000-8000-000000000101"}',true);
select ok((select replayed and event_version=1
  from public.mutate_reassurance_calendar_event(
    '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
    'create',null,null,null,'care','合成照顧行程','僅供測試的合成行程摘要',
    (select starts_at from page44_times),(select ends_at from page44_times),'合成活動室',
    'selected_clients',array['44400000-0000-4000-8000-000000000101'::uuid],
    '44000000-0000-4000-8000-000000000102',null,'44600000-0000-4000-8000-000000000101'
  )), 'an exact retry returns the original receipt');

reset role;
select is((select count(*)::integer from public.reassurance_calendar_event_versions),1,
  'an exact retry does not duplicate the event');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"44510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_reassurance_calendar_event(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  'create',null,null,null,'care','不同內容','相同操作鍵不得改變內容',
  (select starts_at from page44_times),(select ends_at from page44_times),'合成活動室',
  'selected_clients',array['44400000-0000-4000-8000-000000000101'::uuid],
  '44000000-0000-4000-8000-000000000102',null,'44600000-0000-4000-8000-000000000101')$$,
  '23505','reassurance calendar idempotency conflict',
  'changed content cannot reuse an actor-scoped operation key');

select throws_ok($$select * from public.mutate_reassurance_calendar_event(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  'create',null,null,null,'activity','跨分支對象','不得跨分支指定個案',
  (select starts_at from page44_times),(select ends_at from page44_times),'合成活動室',
  'selected_clients',array['44400000-0000-4000-8000-000000000102'::uuid],
  '44000000-0000-4000-8000-000000000102',null,'44600000-0000-4000-8000-000000000102')$$,
  '42501','reassurance calendar entities are outside current scope',
  'cross-branch target scope fails closed');

select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal1","session_id":"44510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_reassurance_calendar_event(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  'create',null,null,null,'care','無 AAL2','不得寫入',
  (select starts_at from page44_times),(select ends_at from page44_times),'合成活動室',
  'all_branch_clients','{}'::uuid[],'44000000-0000-4000-8000-000000000102',null,
  '44600000-0000-4000-8000-000000000103')$$,
  '42501','reassurance calendar mutation is not permitted',
  'every write requires recent AAL2');

select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"44510000-0000-4000-8000-000000000101"}',true);
select ok((select matching_total=1 and jsonb_array_length(items)=1
  and (items->0->>'event_key')::uuid=(select event_key from page44_base)
  and jsonb_array_length(items->0->'history')=1
  from public.reassurance_calendar_snapshot(
    '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
    date_trunc('month',(select starts_at from page44_times) at time zone 'Asia/Taipei')::date,
    '44100000-0000-4000-8000-000000000101',null,'all',false,null
  )), 'snapshot returns one current event array with its immutable history');

select ok((select snapshot_token ~ '^[a-f0-9]{64}$' and publication_boundary='published_versions_only'
  and signature_status='not_configured' and notification_status='not_configured'
  from public.reassurance_calendar_snapshot(
    '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
    date_trunc('month',(select starts_at from page44_times) at time zone 'Asia/Taipei')::date,
    '44100000-0000-4000-8000-000000000101',null,'all',false,null
  )), 'snapshot carries a verifiable same-data token and honest boundaries');

select throws_ok($$select * from public.reassurance_calendar_snapshot(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  date_trunc('month',(select starts_at from page44_times) at time zone 'Asia/Taipei')::date,
  '44100000-0000-4000-8000-000000000999',null,'all',false,null)$$,
  '42501','reassurance calendar snapshot is not permitted',
  'an organization filter outside tenant context fails closed');

select ok((select not replayed and operation_kind='revise' and event_version=2
  and previous_version_id=(select version_id from page44_base)
  and record_kind='revision' and event_status='scheduled'
  from public.mutate_reassurance_calendar_event(
    '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
    'revise',(select event_key from page44_base),(select version_id from page44_base),1,
    'appointment','合成照顧行程（更正）','更新後的合成行程摘要',
    (select starts_at+interval '1 hour' from page44_times),(select ends_at+interval '1 hour' from page44_times),
    '合成諮詢室','all_branch_clients','{}'::uuid[],
    '44000000-0000-4000-8000-000000000102','調整行程地點與時段',
    '44600000-0000-4000-8000-000000000104'
  )), 'revision appends a published child instead of overwriting');

reset role;
select is((select count(*)::integer from public.reassurance_calendar_event_versions),2,
  'revision retains both immutable versions');
create temporary table page44_revision as select event_key,id version_id,version
  from public.reassurance_calendar_event_versions order by version desc limit 1;
grant select on page44_revision to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"44510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_reassurance_calendar_event(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  'revise',(select event_key from page44_base),(select version_id from page44_base),1,
  'care','過期版本','不得延伸非終端版本',(select starts_at from page44_times),(select ends_at from page44_times),
  '合成活動室','all_branch_clients','{}'::uuid[],'44000000-0000-4000-8000-000000000102',
  '嘗試延伸過期版本','44600000-0000-4000-8000-000000000105')$$,
  '40001','reassurance calendar base version is stale',
  'a stale version cannot create a second child');

select throws_ok($$select * from public.mutate_reassurance_calendar_event(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  'cancel',(select event_key from page44_revision),(select version_id from page44_revision),2,
  null,null,null,null,null,null,null,'{}'::uuid[],null,null,
  '44600000-0000-4000-8000-000000000106')$$,
  '22023','reassurance calendar version lineage is invalid',
  'cancellation reason is mandatory');

select ok((select not replayed and operation_kind='cancel' and event_version=3
  and previous_version_id=(select version_id from page44_revision)
  and record_kind='cancellation' and event_status='cancelled'
  and event_category='appointment' and audience_count=1
  from public.mutate_reassurance_calendar_event(
    '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
    'cancel',(select event_key from page44_revision),(select version_id from page44_revision),2,
    null,null,null,null,null,null,null,'{}'::uuid[],null,'家屬另約時間，取消本次行程',
    '44600000-0000-4000-8000-000000000107'
  )), 'cancellation appends a reasoned terminal version');

reset role;
select ok((select count(*)=3 and max(version)=3
  and (array_agg(title order by version desc))[1]='合成照顧行程（更正）'
  and (array_agg(cancellation_reason order by version desc))[1]='家屬另約時間，取消本次行程'
  from public.reassurance_calendar_event_versions),
  'cancellation copies the latest event fields and preserves its explicit reason');
create temporary table page44_cancel as select event_key,id version_id,version
  from public.reassurance_calendar_event_versions order by version desc limit 1;
grant select on page44_cancel to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44000000-0000-4000-8000-000000000101","role":"authenticated","aal":"aal2","session_id":"44510000-0000-4000-8000-000000000101"}',true);
select throws_ok($$select * from public.mutate_reassurance_calendar_event(
  '44100000-0000-4000-8000-000000000101','44200000-0000-4000-8000-000000000101',
  'revise',(select event_key from page44_cancel),(select version_id from page44_cancel),3,
  'care','取消後更改','不得更改已取消行程',(select starts_at from page44_times),(select ends_at from page44_times),
  '合成活動室','all_branch_clients','{}'::uuid[],'44000000-0000-4000-8000-000000000102',
  '取消後嘗試更改','44600000-0000-4000-8000-000000000108')$$,
  '40001','reassurance calendar base version is stale',
  'cancelled event is terminal');

reset role;
select throws_ok($$update public.reassurance_calendar_event_versions set title='覆寫'$$,
  '55000','reassurance_calendar_event_versions is append-only',
  'published versions cannot be updated in place');
select throws_ok($$delete from public.reassurance_calendar_event_versions$$,
  '55000','reassurance_calendar_event_versions is append-only',
  'published versions cannot be deleted');

select ok((select count(*) >= 2 and bool_and(
  not (metadata ? 'query') and not (metadata ? 'title') and not (metadata ? 'summary')
) from public.audit_events where table_name='reassurance_calendar_snapshot'),
  'snapshot audit records interaction metadata without narrative content');

select ok((select bool_and(notification_status='not_configured'
  and notification_delivery='none_not_sent' and signature_status='not_configured')
  from public.reassurance_calendar_event_versions),
  'no version invents an external delivery or signature claim');

select * from finish();
rollback;
