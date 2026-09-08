begin;

select plan(32);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'activity.%' order by permission_key collate "C"$$,
  $$values ('activity.cancel'::text collate "C"), ('activity.manage'::text collate "C"), ('activity.read'::text collate "C")$$,
  'page 30 exposes narrow read, manage and cancel permissions'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
    'public.activity_schedule_versions'::regclass,
    'public.activity_status_events'::regclass,
    'private.activity_operations'::regclass
  )), 'all activity workflow tables force RLS'
);

select ok(
  not has_table_privilege('authenticated','public.activity_schedule_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','public.activity_schedule_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.activity_status_events','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.activity_operations','select,insert,update,delete'),
  'direct activity table access is denied'
);

select ok(
  has_function_privilege('authenticated','public.mutate_activity(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)','execute')
  and has_function_privilege('authenticated','private.mutate_activity_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)','execute')
  and has_function_privilege('authenticated','public.activity_management_snapshot(uuid,uuid,date,date,text,text,text)','execute')
  and not has_function_privilege('service_role','public.mutate_activity(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)','execute'),
  'authenticated receives wrappers and non-exposed private cores only as required by invoker wrappers'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_activity(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.activity_management_snapshot(uuid,uuid,date,date,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_proc where oid='private.mutate_activity_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)'::regprocedure),
  'public wrappers are invoker and private mutation core pins an empty search path'
);

select ok(
  (select count(*)=3 from pg_trigger where not tgisinternal and tgname in (
    'activity_schedule_versions_append_only','activity_status_events_append_only','activity_operations_append_only'))
  and (select count(*)=3 from pg_trigger where not tgisinternal and tgname in (
    'activity_schedule_versions_audit_row_change','activity_status_events_audit_row_change','activity_operations_audit_row_change')),
  'all committed activity rows are append-only and audited'
);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','30000000-0000-4000-8000-000000000001','authenticated','authenticated','activity-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','30000000-0000-4000-8000-000000000002','authenticated','authenticated','activity-responsible@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','30000000-0000-4000-8000-000000000003','authenticated','authenticated','activity-other@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('30100000-0000-4000-8000-000000000001','act_a','活動測試機構 A'),
  ('30100000-0000-4000-8000-000000000002','act_b','活動測試機構 B');
insert into public.branches(id,organization_id,code,name) values
  ('30200000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000001','main','活動主分支'),
  ('30200000-0000-4000-8000-000000000002','30100000-0000-4000-8000-000000000001','second','活動第二分支'),
  ('30200000-0000-4000-8000-000000000003','30100000-0000-4000-8000-000000000002','main','他機構分支');
insert into public.profiles(id,display_name,kind) values
  ('30000000-0000-4000-8000-000000000001','活動管理員','staff'),
  ('30000000-0000-4000-8000-000000000002','活動負責人','staff'),
  ('30000000-0000-4000-8000-000000000003','他機構管理員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('30300000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000001',null,'30000000-0000-4000-8000-000000000001','active'),
  ('30300000-0000-4000-8000-000000000002','30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','active'),
  ('30300000-0000-4000-8000-000000000003','30100000-0000-4000-8000-000000000002',null,'30000000-0000-4000-8000-000000000003','active');
insert into public.membership_roles(membership_id,role_id) values
  ('30300000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  ('30300000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004'),
  ('30300000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on) values
  ('30400000-0000-4000-8000-000000000001','30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','ACT-1','活動個案一','active',current_date-30,null),
  ('30400000-0000-4000-8000-000000000002','30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000002','ACT-2','他分支個案','active',current_date-30,null),
  ('30400000-0000-4000-8000-000000000003','30100000-0000-4000-8000-000000000002','30200000-0000-4000-8000-000000000003','ACT-3','他機構個案','active',current_date-30,null);

create temporary table activity_times as select
  date_trunc('minute',clock_timestamp())+interval '2 days' as starts_at,
  date_trunc('minute',clock_timestamp())+interval '2 days 1 hour' as ends_at,
  clock_timestamp()-interval '30 seconds' as verified_at;
grant select on activity_times to authenticated;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select '30500000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','30510000-0000-4000-8000-000000000001',repeat('5',64),'30520000-0000-4000-8000-000000000001',verified_at-interval '1 minute',verified_at-interval '1 minute',verified_at+interval '5 minutes',verified_at,verified_at,'totp',verified_at from activity_times;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select '30000000-0000-4000-8000-000000000001','30510000-0000-4000-8000-000000000001','30500000-0000-4000-8000-000000000001','aal2','totp',verified_at from activity_times;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);

select ok((select not replayed and schedule_version=1 and status='scheduled' and participant_client_ids=array['30400000-0000-4000-8000-000000000001'::uuid]
  from public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','create',null,null,null,null,null,'健康促進','測試活動','只搜尋機構活動內容','一樓活動區',(select starts_at from activity_times),(select ends_at from activity_times),'30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000001'::uuid],12,null,'30600000-0000-4000-8000-000000000001')), 'authorized manager creates an immutable future activity');

select ok((select replayed and schedule_version=1 and status_sequence=1
  from public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','create',null,null,null,null,null,'健康促進','測試活動','只搜尋機構活動內容','一樓活動區',(select starts_at from activity_times),(select ends_at from activity_times),'30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000001'::uuid],12,null,'30600000-0000-4000-8000-000000000001')), 'exact create replay returns original receipt');

select throws_ok($$select * from public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','create',null,null,null,null,null,'健康促進','不同內容','只搜尋機構活動內容','一樓活動區',(select starts_at from activity_times),(select ends_at from activity_times),'30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000001'::uuid],12,null,'30600000-0000-4000-8000-000000000001')$$,'23505','activity idempotency conflict','changed content conflicts on actor-scoped idempotency key');

select throws_ok($$select * from public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','create',null,null,null,null,null,'健康促進','過去活動','治理未設定','一樓',clock_timestamp()-interval '1 day',clock_timestamp()-interval '23 hours','30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000001'::uuid],12,null,'30600000-0000-4000-8000-000000000002')$$,'22023','past activity creation policy is not configured','past activity backfill fails closed while governance is unconfigured');

select throws_ok($$select * from public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','create',null,null,null,null,null,'健康促進','跨分支參與','治理未設定','一樓',(select starts_at from activity_times),(select ends_at from activity_times),'30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000002'::uuid],12,null,'30600000-0000-4000-8000-000000000003')$$,'42501','activity entities are outside current scope','cross-branch participant is denied');

select is((select matching_total from public.activity_management_snapshot('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',null,null,null,'all','測試活動')),1::bigint,'institution-owned title search finds the activity');
select is((select matching_total from public.activity_management_snapshot('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',null,null,null,'all','活動個案一')),0::bigint,'search does not use participant names');
select ok((select matching_total=scheduled_total+in_progress_total+completed_total+cancelled_total and jsonb_array_length(items)=matching_total and past_change_policy_status='not_configured' and cancellation_notification_policy='institution_owned_not_configured' and notification_delivery='none_not_sent' from public.activity_management_snapshot('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001')),'snapshot metrics reconcile and unconfigured governance is explicit');
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select * from public.activity_management_snapshot('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000002')$$,'42501','activity snapshot is not permitted','cross-branch snapshot is denied');
select throws_ok($$select * from public.activity_management_snapshot('30100000-0000-4000-8000-000000000002','30200000-0000-4000-8000-000000000003')$$,'42501','activity snapshot is not permitted','cross-tenant snapshot is denied');
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);

reset role;
create temporary table created_activity as select activity_id,result_schedule_version_id schedule_version_id,result_schedule_version schedule_version,result_status_event_id status_event_id,result_status_sequence status_sequence from private.activity_operations where idempotency_key='30600000-0000-4000-8000-000000000001';
grant select on created_activity to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);

select ok((select result.schedule_version=2 and result.previous_schedule_version_id=(select schedule_version_id from created_activity)
 from created_activity base cross join lateral public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','revise',base.activity_id,base.schedule_version_id,base.schedule_version,base.status_event_id,base.status_sequence,'認知活動','測試活動更正版','更正後機構活動內容','二樓多功能室',(select starts_at+interval '1 hour' from activity_times),(select ends_at+interval '1 hour' from activity_times),'30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000001'::uuid],10,'場地與時間調整','30600000-0000-4000-8000-000000000004') result),'revision appends version two linked to the original');

reset role;
create temporary table revised_activity as select activity_id,result_schedule_version_id schedule_version_id,result_schedule_version schedule_version,result_status_event_id status_event_id,result_status_sequence status_sequence from private.activity_operations where idempotency_key='30600000-0000-4000-8000-000000000004';
grant select on revised_activity to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);
select ok((select result.status='in_progress' and result.status_sequence=2 and result.previous_status_event_id=base.status_event_id from revised_activity base cross join lateral public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','start',base.activity_id,base.schedule_version_id,base.schedule_version,base.status_event_id,base.status_sequence,null,null,null,null,null,null,null,'{}'::uuid[],null,null,'30600000-0000-4000-8000-000000000005') result),'start appends a linked status event');
select throws_ok($$select * from revised_activity base cross join lateral public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','complete',base.activity_id,base.schedule_version_id,base.schedule_version,base.status_event_id,base.status_sequence,null,null,null,null,null,null,null,'{}'::uuid[],null,null,'30600000-0000-4000-8000-000000000006')$$,'40001','activity chain version is stale','stale status chain cannot append concurrently');

reset role;
create temporary table started_activity as select activity_id,result_schedule_version_id schedule_version_id,result_schedule_version schedule_version,result_status_event_id status_event_id,result_status_sequence status_sequence from private.activity_operations where idempotency_key='30600000-0000-4000-8000-000000000005';
grant select on started_activity to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);
select ok((select result.status='cancelled' and result.status_sequence=3 from started_activity base cross join lateral public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','cancel',base.activity_id,base.schedule_version_id,base.schedule_version,base.status_event_id,base.status_sequence,null,null,null,null,null,null,null,'{}'::uuid[],null,'場地臨時不可使用','30600000-0000-4000-8000-000000000007') result),'cancellation appends reason with current AAL2');
select ok((select result.replayed and result.status='cancelled' from started_activity base cross join lateral public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','cancel',base.activity_id,base.schedule_version_id,base.schedule_version,base.status_event_id,base.status_sequence,null,null,null,null,null,null,null,'{}'::uuid[],null,'場地臨時不可使用','30600000-0000-4000-8000-000000000007') result),'exact cancellation replay succeeds only with current evidence');
select throws_ok($$select * from started_activity base cross join lateral public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','cancel',base.activity_id,base.schedule_version_id,base.schedule_version,base.status_event_id,base.status_sequence,null,null,null,null,null,null,null,'{}'::uuid[],null,null,'30600000-0000-4000-8000-000000000008')$$,'22023','activity transition input is invalid','cancellation reason is mandatory');

select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"30510000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.activity_management_snapshot('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001')$$,'42501','activity snapshot is not permitted','AAL1 cannot read staff activity snapshot');
select throws_ok($$select * from private.activity_snapshot_response('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',null,null,null,'all',null)$$,'42501','activity snapshot is not permitted','direct private snapshot core remains fail closed');

reset role;
insert into public.activity_schedule_versions(organization_id,branch_id,activity_id,version,previous_version_id,revision_reason,activity_type,title,search_summary,location,starts_at,ends_at,responsible_user_id,responsible_display_name,capacity,participants,created_by,creator_display_name,created_at,content_hash)
select '30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',gen_random_uuid(),1,null,null,'批次類型','批次活動 '||series,'批次測試內容','批次場地',clock_timestamp()+interval '5 days',clock_timestamp()+interval '5 days 1 hour','30000000-0000-4000-8000-000000000002','活動負責人',10,jsonb_build_array(jsonb_build_object('client_id','30400000-0000-4000-8000-000000000001','display_name','活動個案一','client_status','active')),'30000000-0000-4000-8000-000000000001','活動管理員',clock_timestamp(),repeat('a',64) from generate_series(1,201) series;
insert into public.activity_status_events(organization_id,branch_id,activity_id,schedule_version_id,sequence,previous_event_id,from_status,to_status,transition_note,changed_by,changer_display_name,changed_at,reauth_challenge_id,content_hash)
select schedule.organization_id,schedule.branch_id,schedule.activity_id,schedule.id,1,null,null,'scheduled',null,'30000000-0000-4000-8000-000000000001','活動管理員',clock_timestamp(),null,repeat('b',64) from public.activity_schedule_versions schedule where schedule.title like '批次活動 %';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);
select ok((select matching_total=201 and jsonb_array_length(items)=200 and items_truncated and scheduled_total=201 from public.activity_management_snapshot('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001',null,null,null,'all','批次活動')),'full metrics remain truthful when detail is truncated at 200');

reset role;
select ok(exists(select 1 from public.audit_events where table_name='activity_management_snapshot' and action='select' and metadata->>'query_present'='true' and not metadata ? 'query'),'snapshot search is audited without raw search text');
select throws_ok($$update public.activity_schedule_versions set title='不可覆寫' where title='測試活動'$$,'55000','activity_schedule_versions is append-only','schedule history cannot be updated');
select throws_ok($$delete from public.activity_status_events where activity_id=(select activity_id from created_activity)$$,'55000','activity_status_events is append-only','status history cannot be deleted');

update public.memberships set status='ended', ends_at=clock_timestamp()+interval '1 second' where id='30300000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"30510000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.mutate_activity('30100000-0000-4000-8000-000000000001','30200000-0000-4000-8000-000000000001','create',null,null,null,null,null,'健康促進','測試活動','只搜尋機構活動內容','一樓活動區',(select starts_at from activity_times),(select ends_at from activity_times),'30000000-0000-4000-8000-000000000002',array['30400000-0000-4000-8000-000000000001'::uuid],12,null,'30600000-0000-4000-8000-000000000001')$$,'42501','activity mutation is not permitted','revoked actor cannot use an exact replay');

reset role;
select ok((select count(*)=2 from public.activity_schedule_versions where activity_id=(select activity_id from created_activity)) and (select count(*)=3 from public.activity_status_events where activity_id=(select activity_id from created_activity)),'event schedule, revision, start and cancellation remain linked under one stable activity id');
select ok(position('v_bundle is distinct from v_final' in pg_get_functiondef('private.activity_snapshot_response(uuid,uuid,date,date,text,text,text)'::regprocedure))>0,'snapshot rechecks authority and bounded data after audit');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('private.mutate_activity_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)'::regprocedure))>0 and position('order by schedule.version desc limit 1 for share' in lower(pg_get_functiondef('private.mutate_activity_guarded(uuid,uuid,text,uuid,uuid,integer,uuid,integer,text,text,text,text,timestamptz,timestamptz,uuid,uuid[],integer,text,uuid)'::regprocedure)))>0,'mutation serializes idempotency and activity chains');

select * from finish();
rollback;
