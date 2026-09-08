begin;

select plan(48);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'quality_events.%' order by permission_key collate "C"$$,
  $$values ('quality_events.close'::text collate "C"),
    ('quality_events.manage'::text collate "C"), ('quality_events.read'::text collate "C")$$,
  'page 27 reuses the narrow quality-event permission family'
);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.abnormal_incidents'::regclass, 'public.abnormal_incident_entries'::regclass
)), 'public abnormal history tables force RLS');
select ok(
  not has_table_privilege('authenticated','public.abnormal_incidents','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.abnormal_incident_entries','select,insert,update,delete')
  and not has_table_privilege('service_role','private.abnormal_event_operations','select,insert,update,delete'),
  'direct history and private receipt writes are denied including service role'
);
select ok(
  has_function_privilege('authenticated','public.abnormal_event_snapshot(uuid,uuid,date,date,text,text,text)','execute')
  and has_function_privilege('authenticated','public.report_abnormal_event(uuid,uuid,text,uuid,text,timestamptz,text,text,text,text,text,uuid,date,text,uuid)','execute')
  and has_function_privilege('authenticated','public.add_abnormal_event_manual_notification(uuid,uuid,text,uuid,uuid,timestamptz,text,text,text,integer,uuid)','execute')
  and has_function_privilege('authenticated','private.append_abnormal_event_entry_atomic(text,uuid,uuid,text,uuid,uuid,timestamptz,text,text,text,text,uuid,text,date,text,text,integer,uuid)','execute')
  and not has_function_privilege('service_role','public.close_abnormal_event(uuid,uuid,text,uuid,uuid,timestamptz,text,text,integer,uuid)','execute'),
  'authenticated gets public wrappers and enforcing non-exposed cores only'
);
select ok(
  not (select prosecdef from pg_proc where oid='public.abnormal_event_snapshot(uuid,uuid,date,date,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.abnormal_event_snapshot_core(uuid,uuid,date,date,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.append_abnormal_event_entry_atomic(text,uuid,uuid,text,uuid,uuid,timestamptz,text,text,text,text,uuid,text,date,text,text,integer,uuid)'::regprocedure),
  'public wrappers are invoker and private cores are pinned definers'
);
select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.append_abnormal_event_entry_atomic(text,uuid,uuid,text,uuid,uuid,timestamptz,text,text,text,text,uuid,text,date,text,text,integer,uuid)'::regprocedure)) > 0
  and position('for update' in lower(pg_get_functiondef(
    'private.append_abnormal_event_entry_atomic(text,uuid,uuid,text,uuid,uuid,timestamptz,text,text,text,text,uuid,text,date,text,text,integer,uuid)'::regprocedure))) > 0
  and position('final authority expired' in pg_get_functiondef(
    'private.append_abnormal_event_entry_atomic(text,uuid,uuid,text,uuid,uuid,timestamptz,text,text,text,text,uuid,text,date,text,text,integer,uuid)'::regprocedure)) > 0,
  'append core serializes actor key and chain and performs a final authority recheck'
);
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'abnormal_incidents_immutable','abnormal_incident_entries_immutable','abnormal_event_operations_immutable'
)),3::bigint,'all committed abnormal history is immutable');
select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'abnormal_incidents_audit_row_change','abnormal_incident_entries_audit_row_change',
  'abnormal_event_operations_audit_row_change'
)),3::bigint,'every abnormal history table has the exact audit trigger');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
  ('27000000-0000-4000-8000-000000001001','authenticated','authenticated','manager27@example.invalid',now(),now()),
  ('27000000-0000-4000-8000-000000001002','authenticated','authenticated','worker27@example.invalid',now(),now()),
  ('27000000-0000-4000-8000-000000001003','authenticated','authenticated','closer27@example.invalid',now(),now()),
  ('27000000-0000-4000-8000-000000001004','authenticated','authenticated','unassigned27@example.invalid',now(),now()),
  ('27000000-0000-4000-8000-000000001005','authenticated','authenticated','other27@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
  ('27100000-0000-4000-8000-000000000001','abnormal-a','異常測試 A'),
  ('27100000-0000-4000-8000-000000000002','abnormal-b','異常測試 B');
insert into public.branches(id,organization_id,code,name) values
  ('27200000-0000-4000-8000-000000000001','27100000-0000-4000-8000-000000000001','main','A 主分支'),
  ('27200000-0000-4000-8000-000000000002','27100000-0000-4000-8000-000000000001','second','A 次分支'),
  ('27200000-0000-4000-8000-000000000003','27100000-0000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind) values
  ('27000000-0000-4000-8000-000000001001','異常管理員','staff'),
  ('27000000-0000-4000-8000-000000001002','異常照服員','staff'),
  ('27000000-0000-4000-8000-000000001003','異常護理師','staff'),
  ('27000000-0000-4000-8000-000000001004','未指派人員','staff'),
  ('27000000-0000-4000-8000-000000001005','他機構人員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('27300000-0000-4000-8000-000000000001','27100000-0000-4000-8000-000000000001',null,'27000000-0000-4000-8000-000000001001','active'),
  ('27300000-0000-4000-8000-000000000002','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000001002','active'),
  ('27300000-0000-4000-8000-000000000003','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000001003','active'),
  ('27300000-0000-4000-8000-000000000004','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000001004','active'),
  ('27300000-0000-4000-8000-000000000005','27100000-0000-4000-8000-000000000002',null,'27000000-0000-4000-8000-000000001005','active');
insert into public.membership_roles(membership_id,role_id) values
  ('27300000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  ('27300000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('27300000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000005'),
  ('27300000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006'),
  ('27300000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on) values
  ('27400000-0000-4000-8000-000000000001','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','AB-1','指派個案','active',current_date-90,null),
  ('27400000-0000-4000-8000-000000000002','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','AB-2','歷史個案','closed',current_date-90,current_date-1),
  ('27400000-0000-4000-8000-000000000003','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002','AB-3','他分支個案','active',current_date-90,null),
  ('27400000-0000-4000-8000-000000000004','27100000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000003','AB-4','他機構個案','active',current_date-90,null);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
  ('27500000-0000-4000-8000-000000000001','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','27400000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000001002','daily-care'),
  ('27500000-0000-4000-8000-000000000002','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','27400000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000001003','nursing'),
  ('27500000-0000-4000-8000-000000000003','27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001','27400000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000001002','historical-review');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values ('27600000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000001003',
  '27610000-0000-4000-8000-000000000001',repeat('6',64),
  '27620000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 minutes',
  clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',
  clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds',
  'totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values ('27000000-0000-4000-8000-000000001003','27610000-0000-4000-8000-000000000001',
  '27600000-0000-4000-8000-000000000001','aal2','totp',
  (select factor_verified_at from private.reauth_challenges where id='27600000-0000-4000-8000-000000000001'));

-- Direct fixture proves the exact 24-hour boundary accepts null late evidence.
insert into public.abnormal_incidents(id,organization_id,branch_id,affected_target_kind,
  affected_client_id,affected_target_label_snapshot,occurred_at,location,event_type,
  event_summary,immediate_action,major_state,initial_responsible_membership_id,
  initial_responsible_user_id,initial_responsible_display_name,initial_improvement_due_date,
  late_entry_reason,reported_by,reporter_display_name,reported_at,content_hash)
values ('27700000-0000-4000-8000-000000000001','27100000-0000-4000-8000-000000000001',
  '27200000-0000-4000-8000-000000000001','facility',null,'一樓設備',
  '2026-08-30 00:00:00+00'::timestamptz,'一樓','設備異常','人工事實','停止使用',
  'unclassified','27300000-0000-4000-8000-000000000002',
  '27000000-0000-4000-8000-000000001002','異常照服員',current_date,null,
  '27000000-0000-4000-8000-000000001001','異常管理員',
  '2026-08-31 00:00:00+00'::timestamptz,repeat('a',64));
select ok(exists(select 1 from public.abnormal_incidents
  where id='27700000-0000-4000-8000-000000000001' and late_entry_reason is null),
  'exactly 24 hours is not late and stores no reason');

grant select on public.abnormal_incidents,public.abnormal_incident_entries to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',null,clock_timestamp()-interval '1 hour',
  '活動區','人工類型','不應寫入','確認安全','unclassified',
  '27300000-0000-4000-8000-000000000002',current_date+1,null,
  '27900000-0000-4000-8000-000000000001')$$,
  '42501','abnormal incident scope is not permitted','AAL1 cannot report');
select throws_ok($$select * from public.abnormal_event_snapshot(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001')$$,
  '42501','abnormal incident snapshot is not permitted','AAL1 cannot read snapshot');
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select * from public.abnormal_event_snapshot(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002')$$,
  '42501','abnormal incident snapshot is not permitted','cross-branch snapshot is rejected');
select throws_ok($$select * from public.abnormal_event_snapshot(
  '27100000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000003')$$,
  '42501','abnormal incident snapshot is not permitted','cross-tenant snapshot is rejected');
select is((select items from public.abnormal_event_snapshot(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  null,null,null,'client','all')),'[]'::jsonb,'empty client result is exactly []');
select ok((select event_taxonomy_status='not_configured'
  and major_criteria_status='not_configured' and legal_reporting_status='not_configured'
  and delivery_integration_status='not_implemented'
  from public.abnormal_event_snapshot('27100000-0000-4000-8000-000000000001',
    '27200000-0000-4000-8000-000000000001')),
  'unfrozen taxonomy, major criteria, legal reporting and delivery stay explicit');

reset role;
create temporary table abnormal_report_result as select null::uuid operation_id,
  null::uuid incident_id,null::uuid entry_id,null::text operation_kind,null::text affected_target_kind,
  null::uuid affected_client_id,0::integer chain_version,null::text handling_status,
  null::uuid responsible_membership_id,null::date effective_due_date,
  clock_timestamp() committed_at,false replayed with no data;
create temporary table abnormal_manual_result (like abnormal_report_result);
create temporary table abnormal_improvement_result (like abnormal_report_result);
create temporary table abnormal_close_result (like abnormal_report_result);
create temporary table abnormal_report_input as
select clock_timestamp()-interval '2 hours' as occurred_at;
grant select,insert on abnormal_report_result,abnormal_manual_result,abnormal_improvement_result,
  abnormal_close_result to authenticated;
grant select on abnormal_report_input to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
insert into abnormal_report_result select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',null,
  (select occurred_at from abnormal_report_input),
  '活動區','人工類型 A','個案事件事實','先確認安全','major',
  '27300000-0000-4000-8000-000000000002',current_date+1,null,
  '27900000-0000-4000-8000-000000000010');
select ok((select not replayed and entry_id is null and chain_version=0
  and handling_status='reported' and affected_target_kind='client'
  and affected_client_id='27400000-0000-4000-8000-000000000001'
  from abnormal_report_result),'new client report returns a fully correlated receipt');
select ok((select replayed and incident_id=(select incident_id from abnormal_report_result)
  from public.report_abnormal_event(
    '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
    'client','27400000-0000-4000-8000-000000000001',null,
    (select occurred_at from abnormal_report_input),
    '活動區','人工類型 A','個案事件事實','先確認安全','major',
    '27300000-0000-4000-8000-000000000002',current_date+1,null,
    '27900000-0000-4000-8000-000000000010')),
  'exact report replay returns the stable event');
select throws_ok(format($sql$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',null,%L,
  '不同位置','人工類型 A','個案事件事實','先確認安全','major',
  '27300000-0000-4000-8000-000000000002',current_date+1,null,
  '27900000-0000-4000-8000-000000000010')$sql$,
  (select occurred_at from abnormal_report_input)),
  '23505','abnormal incident idempotency conflict','changed content conflicts on the same actor key');
select throws_ok($$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000002',null,clock_timestamp()-interval '1 hour',
  '歷史區','人工類型','歷史不可新報','確認','not_major',
  '27300000-0000-4000-8000-000000000002',current_date+1,null,
  '27900000-0000-4000-8000-000000000011')$$,
  '42501','active client period is not permitted','closed historical client cannot receive a new report');
select throws_ok($$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000003',null,clock_timestamp()-interval '1 hour',
  '他分支','人工類型','越權','確認','not_major',
  '27300000-0000-4000-8000-000000000002',current_date+1,null,
  '27900000-0000-4000-8000-000000000012')$$,
  '42501','abnormal incident scope is not permitted','cross-branch client is rejected');
select throws_ok($$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'facility',null,'設備 A',clock_timestamp()-interval '25 hours',
  '一樓','設備異常','補登事實','停止使用','unclassified',
  '27300000-0000-4000-8000-000000000002',current_date+1,null,
  '27900000-0000-4000-8000-000000000013')$$,
  '22023','late-entry evidence does not match the final server time','over 24 hours requires an explicit reason');
select ok((select not replayed and affected_target_kind='facility' and affected_client_id is null
  from public.report_abnormal_event(
    '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
    'facility',null,'設備 A',clock_timestamp()-interval '25 hours',
    '一樓','設備異常','補登事實','停止使用','unclassified',
    '27300000-0000-4000-8000-000000000002',current_date+1,'交班後人工補登',
    '27900000-0000-4000-8000-000000000014')),
  'non-client report uses explicit kind and immutable label without fuzzy merge');
select throws_ok($$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'facility',null,'設備 B',clock_timestamp()-interval '1 hour',
  '一樓','設備異常','責任越權','停止使用','unclassified',
  '27300000-0000-4000-8000-000000000005',current_date+1,null,
  '27900000-0000-4000-8000-000000000015')$$,
  '42501','responsible membership is not active in scope','responsible must be active in organization and branch');

insert into abnormal_manual_result select * from public.add_abnormal_event_manual_notification(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',(select incident_id from abnormal_report_result),
  clock_timestamp()-interval '90 minutes','主管','人工電話','承辦人記錄已說明',0,
  '27900000-0000-4000-8000-000000000020');
select ok((select not replayed and operation_kind='manual_notification' and chain_version=1
  and handling_status='in_progress' from abnormal_manual_result),
  'manual notification appends evidence to the same incident once');
reset role;
select ok(exists(select 1 from public.abnormal_incident_entries
  where id=(select entry_id from abnormal_manual_result)
    and notification_target='主管' and notification_method='人工電話'
    and notification_result='承辦人記錄已說明' and entry_text is null),
  'manual evidence has no system delivery state or inferred result');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($sql$select * from public.add_abnormal_event_follow_up(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '3 hours',
  '倒序追蹤','27300000-0000-4000-8000-000000000002','keep',null,1,
  '27900000-0000-4000-8000-000000000021')$sql$,(select incident_id from abnormal_report_result)),
  '22023','timeline entry cannot predate incident or prior entry','timeline cannot move backward');
select throws_ok(format($sql$select * from public.add_abnormal_event_follow_up(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '30 minutes',
  '舊鏈追蹤','27300000-0000-4000-8000-000000000002','keep',null,0,
  '27900000-0000-4000-8000-000000000022')$sql$,(select incident_id from abnormal_report_result)),
  '40001','abnormal incident chain version conflict','stale chain version cannot fork history');
insert into abnormal_improvement_result select * from public.add_abnormal_event_improvement(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',(select incident_id from abnormal_report_result),
  clock_timestamp()-interval '30 minutes','改善並轉派','27300000-0000-4000-8000-000000000003',
  'replace',current_date+3,1,'27900000-0000-4000-8000-000000000023');
select ok((select not replayed and chain_version=2
  and responsible_membership_id='27300000-0000-4000-8000-000000000003'
  and effective_due_date=current_date+3 from abnormal_improvement_result),
  'improvement stores explicit responsibility and due-date update evidence');
reset role;
update public.memberships set status='suspended' where id='27300000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
select ok((select replayed and chain_version=2 from public.add_abnormal_event_improvement(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',(select incident_id from abnormal_report_result),
  (select occurred_at from public.abnormal_incident_entries where id=(select entry_id from abnormal_improvement_result)),
  '改善並轉派','27300000-0000-4000-8000-000000000003','replace',current_date+3,1,
  '27900000-0000-4000-8000-000000000023')),
  'exact replay does not re-resolve mutable responsible eligibility');
reset role;
update public.memberships set status='active' where id='27300000-0000-4000-8000-000000000003';
update public.client_assignments
set starts_at=current_timestamp-interval '2 days',
    ends_at=current_timestamp-interval '1 second'
where id='27500000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($sql$select * from public.report_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',null,%L,'活動區','人工類型 A',
  '個案事件事實','先確認安全','major','27300000-0000-4000-8000-000000000002',
  current_date+1,null,'27900000-0000-4000-8000-000000000010')$sql$,
  (select occurred_at from abnormal_report_input)),
  '42501','abnormal incident scope is not permitted','assignment revocation blocks exact replay');
reset role;
update public.client_assignments set ends_at=null where id='27500000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2","session_id":"27610000-0000-4000-8000-000000000099"}',true);
select throws_ok(format($sql$select * from public.close_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',%L,clock_timestamp(),
  '結案結果','人工理由',2,'27900000-0000-4000-8000-000000000030')$sql$,
  (select incident_id from abnormal_report_result)),
  '42501','current same-session recent AAL2 evidence is required to close an abnormal incident',
  'closure rejects different-session AAL2');
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2","session_id":"27610000-0000-4000-8000-000000000001"}',true);
insert into abnormal_close_result select * from public.close_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',(select incident_id from abnormal_report_result),
  clock_timestamp(),'結案結果','人工理由',2,'27900000-0000-4000-8000-000000000030');
select ok((select not replayed and handling_status='closed' and chain_version=3
  from abnormal_close_result),'recent same-session AAL2 appends closure');
reset role;
select ok(exists(select 1 from public.abnormal_incident_entries
  where id=(select entry_id from abnormal_close_result)
    and closure_reauth_challenge_id='27600000-0000-4000-8000-000000000001'),
  'closure persists immutable reauthentication evidence');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2","session_id":"27610000-0000-4000-8000-000000000001"}',true);
select ok((select replayed and chain_version=3 from public.close_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',(select incident_id from abnormal_report_result),
  (select occurred_at from public.abnormal_incident_entries where id=(select entry_id from abnormal_close_result)),
  '結案結果','人工理由',2,'27900000-0000-4000-8000-000000000030')),
  'exact close replay rechecks current recent AAL2');
select throws_ok(format($sql$select * from public.add_abnormal_event_follow_up(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',%L,clock_timestamp(),
  '結案後追蹤','27300000-0000-4000-8000-000000000003','keep',null,3,
  '27900000-0000-4000-8000-000000000031')$sql$,(select incident_id from abnormal_report_result)),
  '23514','closed abnormal incident history cannot be extended','closed chain cannot be extended');
reset role;
update private.reauth_events set revoked_at=clock_timestamp()
where challenge_id='27600000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2","session_id":"27610000-0000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.close_abnormal_event(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
  'client','27400000-0000-4000-8000-000000000001',%L,%L,
  '結案結果','人工理由',2,'27900000-0000-4000-8000-000000000030')$sql$,
  (select incident_id from abnormal_report_result),
  (select occurred_at from public.abnormal_incident_entries where id=(select entry_id from abnormal_close_result))),
  '42501','current same-session recent AAL2 evidence is required to close an abnormal incident',
  'revoked AAL2 blocks exact close replay');

reset role;
select throws_ok($$update public.abnormal_incidents set event_summary='覆寫'
  where id='27700000-0000-4000-8000-000000000001'$$,
  '55000','abnormal event history is immutable','incident update is forbidden');
select throws_ok($$delete from public.abnormal_incident_entries
  where id=(select entry_id from abnormal_manual_result)$$,
  '55000','abnormal event history is immutable','timeline delete is forbidden');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2"}',true);
create temporary table abnormal_snapshot as select * from public.abnormal_event_snapshot(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001');
select ok((select item_total=jsonb_array_length(items) and matching_total=item_total
  and awaiting_improvement_total+closed_total=matching_total
  and major_total <= matching_total and overdue_total <= awaiting_improvement_total
  from abnormal_snapshot),'single snapshot aggregates reconcile without timeline double-counting');
select ok((select (items->0)?'timeline' and (items->0)?'current_responsible_membership_id'
  and (items->0)?'current_improvement_due_date' from abnormal_snapshot),
  'single audited snapshot carries timeline responsibility and due evidence');
reset role;
select ok(exists(select 1 from public.audit_events where table_name='abnormal_incidents'
  and action='select' and metadata->>'projection'='page27_abnormal_events_v1'
  and not(metadata?'event_type')),'snapshot access is audited without sensitive filter value');

-- Truthful 200 caps for detail, client, responsibility and type options.
create temporary table abnormal_bulk as
select n,gen_random_uuid() user_id,gen_random_uuid() membership_id,
  gen_random_uuid() client_id,gen_random_uuid() incident_id from generate_series(1,201) n;
insert into auth.users(id,aud,role,email,created_at,updated_at)
select user_id,'authenticated','authenticated','abnormal-bulk-'||n||'@example.invalid',now(),now()
from abnormal_bulk;
insert into public.profiles(id,display_name,kind)
select user_id,'批次責任人 '||n,'staff' from abnormal_bulk;
insert into public.memberships(id,organization_id,branch_id,profile_id,status)
select membership_id,'27100000-0000-4000-8000-000000000001',
  '27200000-0000-4000-8000-000000000001',user_id,'active' from abnormal_bulk;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
select client_id,'27100000-0000-4000-8000-000000000001',
  '27200000-0000-4000-8000-000000000001','AB-B-'||n,'批次個案 '||n,'active',current_date-30
from abnormal_bulk;
insert into public.abnormal_incidents(id,organization_id,branch_id,affected_target_kind,
  affected_client_id,affected_target_label_snapshot,occurred_at,location,event_type,event_summary,
  immediate_action,major_state,initial_responsible_membership_id,initial_responsible_user_id,
  initial_responsible_display_name,initial_improvement_due_date,reported_by,
  reporter_display_name,reported_at,content_hash)
select incident_id,'27100000-0000-4000-8000-000000000001',
  '27200000-0000-4000-8000-000000000001','facility',null,'批次設施 '||n,
  clock_timestamp()-interval '10 minutes','批次區','人工批次類型 '||n,'批次事件 '||n,
  '確認現場','unclassified',membership_id,user_id,'批次責任人 '||n,current_date+1,
  '27000000-0000-4000-8000-000000001001','異常管理員',
  clock_timestamp()-interval '9 minutes',encode(sha256(convert_to(('abnormal'||n)::text,'UTF8')),'hex')
from abnormal_bulk;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2"}',true);
create temporary table abnormal_bulk_snapshot as select * from public.abnormal_event_snapshot(
  '27100000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001');
select ok((select items_truncated and item_total=200 and matching_total>item_total
  and jsonb_array_length(items)=200
  and (select count(distinct value->>'incident_id') from jsonb_array_elements(items))=200
  from abnormal_bulk_snapshot),'detail cap preserves full unique-event aggregates');
select ok((select client_options_truncated and client_options_available_total>200
  and jsonb_array_length(client_options)=200 and responsible_options_truncated
  and responsible_options_available_total>200 and jsonb_array_length(responsible_options)=200
  and event_type_options_truncated and event_type_options_available_total>200
  and jsonb_array_length(event_type_options)=200 from abnormal_bulk_snapshot),
  'all bounded option sets disclose truthful totals and truncation');
select ok((select awaiting_improvement_total+closed_total=matching_total
  and major_total=1 from abnormal_bulk_snapshot),
  'full-set metrics count each stable incident once regardless of detail cap');
reset role;

select ok(((length(pg_get_functiondef(
  'private.abnormal_event_snapshot_core(uuid,uuid,date,date,text,text,text)'::regprocedure))-
  length(replace(pg_get_functiondef(
  'private.abnormal_event_snapshot_core(uuid,uuid,date,date,text,text,text)'::regprocedure),
  'snapshot authority expired','')))/length('snapshot authority expired'))=1
  and position('snapshot final authority expired' in pg_get_functiondef(
  'private.abnormal_event_snapshot_core(uuid,uuid,date,date,text,text,text)'::regprocedure))>0,
  'snapshot rechecks authority before audit and after audit');
select ok(exists(select 1 from pg_constraint where conrelid='private.abnormal_event_operations'::regclass
  and contype='u' and pg_get_constraintdef(oid) like '%actor_user_id, idempotency_key%'),
  'operation ledger is actor scoped');
select is((select count(*) from public.abnormal_incidents
  where id=(select incident_id from abnormal_report_result)),1::bigint,
  'stable report is physically stored once');
select ok(position('v_now := clock_timestamp()' in pg_get_functiondef(
  'private.report_abnormal_event_atomic(uuid,uuid,text,uuid,text,timestamptz,text,text,text,text,text,uuid,date,text,uuid)'::regprocedure))>0
  and position('interval ''24 hours''' in pg_get_functiondef(
  'private.report_abnormal_event_atomic(uuid,uuid,text,uuid,text,timestamptz,text,text,text,text,text,uuid,date,text,uuid)'::regprocedure))>0,
  'late-entry boundary is re-evaluated with final server time after locks');

select * from finish();
rollback;
