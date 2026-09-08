begin;

select plan(53);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'quality_events.%' order by permission_key collate "C"$$,
  $$values ('quality_events.close'::text collate "C"),
    ('quality_events.manage'::text collate "C"), ('quality_events.read'::text collate "C")$$,
  'page 25 reuses the narrow quality-event permission family'
);

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.infection_incidents'::regclass, 'public.infection_clusters'::regclass,
  'public.infection_incident_entries'::regclass, 'private.infection_event_operations'::regclass
)), 'all infection workflow tables force RLS');

select ok(
  not has_table_privilege('authenticated', 'public.infection_incidents', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.infection_clusters', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.infection_incident_entries', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.infection_event_operations', 'select,insert,update,delete'),
  'direct public history and private receipt writes are denied'
);

select ok(
  has_function_privilege('authenticated', 'public.infection_event_snapshot(uuid,uuid,date,date,text,text,uuid,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.report_infection_event(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.link_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.unlink_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.close_infection_event(uuid,uuid,uuid,uuid,timestamptz,text,text,integer,uuid)', 'execute'),
  'only authenticated staff receive wrappers and non-exposed enforcing cores'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.infection_event_snapshot(uuid,uuid,date,date,text,text,uuid,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.link_infection_event_cluster(uuid,uuid,uuid,uuid,timestamptz,uuid,text,integer,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.infection_event_snapshot_response(uuid,uuid,date,date,text,text,uuid,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)'::regprocedure),
  'public wrappers are invoker and private cores are pinned definers'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)'::regprocedure)) > 0
  and position('for update' in lower(pg_get_functiondef(
    'private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)'::regprocedure))) > 0
  and position('infection timeline authority expired' in pg_get_functiondef(
    'private.append_infection_event_entry_atomic(text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,text,text,text,integer,uuid)'::regprocedure)) > 0,
  'append core uses actor-key and chain serialization with a final authority check'
);

select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'infection_incidents_immutable', 'infection_clusters_immutable',
  'infection_incident_entries_immutable', 'infection_event_operations_immutable'
)), 4::bigint, 'all committed infection history is immutable');

select is((select count(*) from pg_trigger where not tgisinternal and tgname in (
  'infection_incidents_audit_row_change', 'infection_clusters_audit_row_change',
  'infection_incident_entries_audit_row_change', 'infection_event_operations_audit_row_change'
)), 4::bigint, 'every infection history table has the exact audit trigger');

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('25000000-0000-4000-8000-000000000001','authenticated','authenticated','manager@example.invalid',now(),now()),
  ('25000000-0000-4000-8000-000000000002','authenticated','authenticated','worker@example.invalid',now(),now()),
  ('25000000-0000-4000-8000-000000000003','authenticated','authenticated','closer@example.invalid',now(),now()),
  ('25000000-0000-4000-8000-000000000004','authenticated','authenticated','unassigned@example.invalid',now(),now()),
  ('25000000-0000-4000-8000-000000000005','authenticated','authenticated','other@example.invalid',now(),now());

insert into public.organizations (id, code, name) values
  ('25100000-0000-4000-8000-000000000001','infection-a','感染測試 A'),
  ('25100000-0000-4000-8000-000000000002','infection-b','感染測試 B');
insert into public.branches (id, organization_id, code, name) values
  ('25200000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001','main','A 主分支'),
  ('25200000-0000-4000-8000-000000000002','25100000-0000-4000-8000-000000000001','second','A 次分支'),
  ('25200000-0000-4000-8000-000000000003','25100000-0000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles (id, display_name, kind) values
  ('25000000-0000-4000-8000-000000000001','感染管理員','staff'),
  ('25000000-0000-4000-8000-000000000002','感染照服員','staff'),
  ('25000000-0000-4000-8000-000000000003','感染護理師','staff'),
  ('25000000-0000-4000-8000-000000000004','未指派照服員','staff'),
  ('25000000-0000-4000-8000-000000000005','他機構管理員','staff');
insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('25300000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001',null,'25000000-0000-4000-8000-000000000001','active'),
  ('25300000-0000-4000-8000-000000000002','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','active'),
  ('25300000-0000-4000-8000-000000000003','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000003','active'),
  ('25300000-0000-4000-8000-000000000004','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000004','active'),
  ('25300000-0000-4000-8000-000000000005','25100000-0000-4000-8000-000000000002',null,'25000000-0000-4000-8000-000000000005','active');
insert into public.membership_roles (membership_id, role_id) values
  ('25300000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  ('25300000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('25300000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000005'),
  ('25300000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006'),
  ('25300000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002');

insert into public.clients (id, organization_id, branch_id, client_code, display_name, status, admitted_on, ended_on) values
  ('25400000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','INF-1','指派個案','active',current_date-60,null),
  ('25400000-0000-4000-8000-000000000002','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','INF-2','歷史結案個案','closed',current_date-90,current_date-1),
  ('25400000-0000-4000-8000-000000000003','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000002','INF-3','他分支個案','active',current_date-60,null),
  ('25400000-0000-4000-8000-000000000004','25100000-0000-4000-8000-000000000002','25200000-0000-4000-8000-000000000003','INF-4','他機構個案','active',current_date-60,null);
insert into public.client_assignments (id, organization_id, branch_id, client_id, assignee_user_id, assignment_kind) values
  ('25500000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','daily-care'),
  ('25500000-0000-4000-8000-000000000002','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000003','nursing');

insert into private.reauth_challenges (id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values ('25600000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000003','25610000-0000-4000-8000-000000000001',repeat('6',64),'25620000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events (user_id,session_id,challenge_id,aal,verification_method,verified_at)
values ('25000000-0000-4000-8000-000000000003','25610000-0000-4000-8000-000000000001','25600000-0000-4000-8000-000000000001','aal2','totp',(select factor_verified_at from private.reauth_challenges where id='25600000-0000-4000-8000-000000000001'));

insert into public.infection_incidents (id,organization_id,branch_id,client_id,occurred_at,location,event_summary,infection_type_state,infection_type_text,reported_by,reporter_display_name,reported_at,content_hash) values
  ('25700000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',clock_timestamp()-interval '3 days','活動區','人工事件一','provided','人工類型 A','25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '3 days'+interval '5 minutes',repeat('a',64)),
  ('25700000-0000-4000-8000-000000000002','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 days','休息區','人工事件二','missing',null,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '2 days'+interval '5 minutes',repeat('b',64)),
  ('25700000-0000-4000-8000-000000000003','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 day','照顧區','人工事件三','not_applicable',null,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '1 day'+interval '5 minutes',repeat('c',64)),
  ('25700000-0000-4000-8000-000000000004','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000002',clock_timestamp()-interval '2 days','歷史區','歷史事件','missing',null,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '2 days'+interval '5 minutes',repeat('d',64));
insert into public.infection_incident_entries (id,organization_id,branch_id,client_id,incident_id,sequence_number,previous_entry_id,entry_type,occurred_at,entry_text,cluster_id,cluster_label,closure_outcome,closure_reason,committed_by,committer_display_name,committed_at,closure_reauth_challenge_id,content_hash) values
  ('25800000-0000-4000-8000-000000000001','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001','25700000-0000-4000-8000-000000000002',1,null,'treatment',clock_timestamp()-interval '2 days'+interval '10 minutes','人工處置',null,null,null,null,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '2 days'+interval '15 minutes',null,repeat('1',64)),
  ('25800000-0000-4000-8000-000000000002','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001','25700000-0000-4000-8000-000000000003',1,null,'follow_up',clock_timestamp()-interval '1 day'+interval '10 minutes','人工追蹤',null,null,null,null,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '1 day'+interval '15 minutes',null,repeat('2',64)),
  ('25800000-0000-4000-8000-000000000003','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001','25700000-0000-4000-8000-000000000003',2,'25800000-0000-4000-8000-000000000002','closure',clock_timestamp()-interval '1 day'+interval '20 minutes',null,null,null,'追蹤完成','人工覆核結案','25000000-0000-4000-8000-000000000003','感染護理師',clock_timestamp()-interval '1 day'+interval '25 minutes','25600000-0000-4000-8000-000000000001',repeat('3',64));

-- Test-only read grants let assertions resolve immutable IDs while forced RLS
-- still enforces the caller's assigned-client scope. The transaction rolls back.
grant select on public.infection_incidents, public.infection_incident_entries,
  public.infection_clusters to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select * from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours','AAL1 區','不應寫入','missing',null,'25900000-0000-4000-8000-000000000020')$$,'42501','infection incident client scope is not permitted','AAL1 cannot report an infection incident');
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);

select is((select item_total from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001')),3::bigint,'assigned worker sees only assigned-client incidents');
select ok((select item_total=jsonb_array_length(items) and matching_total=item_total and awaiting_action_total+awaiting_closure_total+closed_total=matching_total and infection_provided_total=1 from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001')),'full aggregates reconcile without double-counting an incident timeline');
select is((select item_total from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001',null,null,'__missing__','in_progress',null,'all',null)),1::bigint,'missing type remains distinct');
select is((select item_total from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001',null,null,'__not_applicable__','closed',null,'all',null)),1::bigint,'not-applicable type remains distinct from missing');
select ok((select infection_taxonomy_status='not_configured' and cluster_threshold_status='not_configured' and legal_reporting_status='not_configured' from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001')),'taxonomy, cluster threshold and legal reporting remain explicitly unconfigured');
select ok((select (items->0)?'timeline' and (items->0)?'current_cluster_id' from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001')),'single snapshot carries the complete incident-chain projection');
reset role;
select ok(exists(select 1 from public.audit_events where actor_user_id='25000000-0000-4000-8000-000000000002' and table_name='infection_incidents' and action='select' and not(metadata?'client_id')),'snapshot read is audited without sensitive filter values');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select * from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001')$$,'42501','infection incident snapshot is not permitted','AAL1 snapshot is rejected');
select throws_ok($$select * from private.infection_event_snapshot_response('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001',null,null,null,'all',null,'all',null)$$,'42501','infection incident snapshot is not permitted','direct private core still enforces AAL2 and scope');
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$select * from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000002')$$,'42501','infection incident snapshot is not permitted','cross-branch snapshot is rejected');
select throws_ok($$select * from public.infection_event_snapshot('25100000-0000-4000-8000-000000000002','25200000-0000-4000-8000-000000000003')$$,'42501','infection incident snapshot is not permitted','cross-tenant snapshot is rejected');
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select items from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001')),'[]'::jsonb,'unassigned empty snapshot is exactly an empty array');

reset role;
create temporary table infection_report_result as select null::uuid operation_id,null::uuid incident_id,null::uuid client_id,null::uuid entry_id,null::text operation_kind,0::integer chain_version,null::text handling_status,null::uuid cluster_id,null::text cluster_label,clock_timestamp() committed_at,false replayed with no data;
create temporary table infection_link_result (like infection_report_result);
create temporary table infection_unlink_result (like infection_report_result);
create temporary table infection_close_result (like infection_report_result);
grant select,insert on infection_report_result,infection_link_result,infection_unlink_result,infection_close_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into infection_report_result select * from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours','觀察區','新感染人工事件','provided','人工類型 X','25900000-0000-4000-8000-000000000001');
select ok((select not replayed and operation_kind='report' and client_id='25400000-0000-4000-8000-000000000001' and entry_id is null and chain_version=0 and handling_status='reported' and cluster_id is null from infection_report_result),'new report returns a fully correlated receipt');
select ok((select replayed and incident_id=(select incident_id from infection_report_result) from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select occurred_at from public.infection_incidents where id=(select incident_id from infection_report_result)),'觀察區','新感染人工事件','provided','人工類型 X','25900000-0000-4000-8000-000000000001')),'exact report replay returns the original event');
select throws_ok(format($sql$select * from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,'不同位置','新感染人工事件','provided','人工類型 X','25900000-0000-4000-8000-000000000001')$sql$,(select occurred_at from public.infection_incidents where id=(select incident_id from infection_report_result))),'23505','infection incident idempotency conflict','changed content conflicts on the same actor key');
select throws_ok($$select * from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 hour','歷史區','不允許新報','missing',null,'25900000-0000-4000-8000-000000000002')$$,'42501','infection incident client scope is not permitted','closed historical client remains visible but cannot receive a new report');
select throws_ok($$select * from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000003',clock_timestamp()-interval '1 hour','他分支','越權','missing',null,'25900000-0000-4000-8000-000000000003')$$,'42501','infection incident client scope is not permitted','cross-branch client report is rejected');

reset role;
insert into public.infection_clusters(id,organization_id,branch_id,label,created_by,creator_display_name,content_hash) values ('25910000-0000-4000-8000-000000000099','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000002','他分支群聚','25000000-0000-4000-8000-000000000001','感染管理員',repeat('9',64));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select ok((select not replayed from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',clock_timestamp()-interval '90 minutes','管理區','管理員同鍵事件','missing',null,'25900000-0000-4000-8000-000000000001')),'same key is independently scoped to another actor');

select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
insert into infection_link_result select * from public.link_infection_event_cluster('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select incident_id from infection_report_result),clock_timestamp()-interval '80 minutes',null,'人工群聚 A',0,'25900000-0000-4000-8000-000000000004');
select ok((select not replayed and operation_kind='cluster_link' and entry_id is not null and cluster_id is not null and cluster_label='人工群聚 A' and chain_version=1 from infection_link_result),'explicit link creates a stable cluster UUID and timeline entry atomically');
select ok((select replayed and cluster_id=(select cluster_id from infection_link_result) from public.link_infection_event_cluster('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select incident_id from infection_report_result),(select occurred_at from public.infection_incident_entries where id=(select entry_id from infection_link_result)),null,'人工群聚 A',0,'25900000-0000-4000-8000-000000000004')),'cluster-link exact replay preserves the generated UUID');
select throws_ok(format($sql$select * from public.link_infection_event_cluster('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '70 minutes',null,'偷偷換掛',1,'25900000-0000-4000-8000-000000000005')$sql$,(select incident_id from infection_report_result)),'23514','unlink the current cluster before linking another','cluster cannot be silently reassigned');
select is((select item_total from public.infection_event_snapshot('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001',null,null,null,'all',null,'linked',(select cluster_id from infection_link_result))),1::bigint,'exact cluster filter returns the event once');
select throws_ok(format($sql$select * from public.unlink_infection_event_cluster('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '60 minutes','25910000-0000-4000-8000-000000000099','他分支群聚',1,'25900000-0000-4000-8000-000000000006')$sql$,(select incident_id from infection_report_result)),'23514','cluster unlink target does not match the current link','unlink requires the exact current cluster UUID and label');
insert into infection_unlink_result select * from public.unlink_infection_event_cluster('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select incident_id from infection_report_result),clock_timestamp()-interval '60 minutes',(select cluster_id from infection_link_result),'人工群聚 A',1,'25900000-0000-4000-8000-000000000007');
select ok((select not replayed and operation_kind='cluster_unlink' and cluster_id=(select cluster_id from infection_link_result) and chain_version=2 from infection_unlink_result),'explicit unlink appends evidence without deleting the link record');
select throws_ok(format($sql$select * from public.link_infection_event_cluster('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '50 minutes','25910000-0000-4000-8000-000000000099','他分支群聚',2,'25900000-0000-4000-8000-000000000021')$sql$,(select incident_id from infection_report_result)),'42501','exact cluster scope or label is not permitted','cross-branch cluster identity cannot be linked');
select throws_ok(format($sql$select * from public.add_infection_event_follow_up('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '50 minutes','過期鏈版本',1,'25900000-0000-4000-8000-000000000022')$sql$,(select incident_id from infection_report_result)),'40001','infection incident chain version conflict','a stale version cannot fork the immutable incident chain');
select throws_ok(format($sql$select * from public.add_infection_event_treatment('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp()-interval '70 minutes','倒序處置',2,'25900000-0000-4000-8000-000000000008')$sql$,(select incident_id from infection_report_result)),'22023','timeline entry cannot predate the prior entry','timeline time cannot predate the prior entry');
select is((select chain_version from public.add_infection_event_follow_up('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select incident_id from infection_report_result),clock_timestamp()-interval '30 minutes','人工追蹤',2,'25900000-0000-4000-8000-000000000009')),3,'follow-up appends to the same stable incident chain');

select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"25610000-0000-4000-8000-000000000099"}',true);
select throws_ok(format($sql$select * from public.close_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp(),'人工結案結果','人工結案理由',3,'25900000-0000-4000-8000-000000000010')$sql$,(select incident_id from infection_report_result)),'42501','current same-session recent AAL2 evidence is required to close an infection incident','closure rejects another session evidence');
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"25610000-0000-4000-8000-000000000001"}',true);
insert into infection_close_result select * from public.close_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select incident_id from infection_report_result),clock_timestamp(),'人工結案結果','人工結案理由',3,'25900000-0000-4000-8000-000000000010');
select ok((select not replayed and operation_kind='close' and handling_status='closed' and chain_version=4 from infection_close_result),'recent same-session AAL2 closes by appending immutable evidence');
reset role;
select ok(exists(select 1 from public.infection_incident_entries where id=(select entry_id from infection_close_result) and closure_reauth_challenge_id='25600000-0000-4000-8000-000000000001'),'closure persists the exact reauthentication evidence');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"25610000-0000-4000-8000-000000000001"}',true);
select ok((select replayed and chain_version=4 from public.close_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',(select incident_id from infection_report_result),(select occurred_at from public.infection_incident_entries where id=(select entry_id from infection_close_result)),'人工結案結果','人工結案理由',3,'25900000-0000-4000-8000-000000000010')),'exact close replay still requires and preserves recent AAL2');
select throws_ok(format($sql$select * from public.add_infection_event_follow_up('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,clock_timestamp(),'結案後內容',4,'25900000-0000-4000-8000-000000000011')$sql$,(select incident_id from infection_report_result)),'23514','closed infection incident history cannot be extended','nothing can be appended after closure');
reset role;
update private.reauth_events set revoked_at=clock_timestamp() where challenge_id='25600000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"25610000-0000-4000-8000-000000000001"}',true);
select throws_ok(format($sql$select * from public.close_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,%L,'人工結案結果','人工結案理由',3,'25900000-0000-4000-8000-000000000010')$sql$,(select incident_id from infection_report_result),(select occurred_at from public.infection_incident_entries where id=(select entry_id from infection_close_result))),'42501','current same-session recent AAL2 evidence is required to close an infection incident','exact close replay fails closed after AAL2 evidence revocation');

reset role;
select throws_ok($$update public.infection_incidents set event_summary='覆寫' where id='25700000-0000-4000-8000-000000000001'$$,'55000','infection incident history and operation receipts are immutable','incident update is forbidden');
select throws_ok($$delete from public.infection_clusters where id=(select cluster_id from infection_link_result)$$,'55000','infection incident history and operation receipts are immutable','cluster deletion is forbidden');

create temporary table infection_replay_input as
select occurred_at
from public.infection_incidents
where id=(select incident_id from infection_report_result);
grant select on infection_replay_input to authenticated;
update public.memberships set status='suspended' where id='25300000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(format($sql$select * from public.report_infection_event('25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000001',%L,'觀察區','新感染人工事件','provided','人工類型 X','25900000-0000-4000-8000-000000000001')$sql$,(select occurred_at from infection_replay_input)),'42501','infection incident client scope is not permitted','exact replay rechecks current actor authority');

reset role;
update public.memberships set status='active' where id='25300000-0000-4000-8000-000000000002';
create temporary table infection_bulk as select n,gen_random_uuid() client_id,gen_random_uuid() incident_id,gen_random_uuid() cluster_id,gen_random_uuid() entry_id from generate_series(1,201) n;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) select client_id,'25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','INF-B-'||n,'批次個案 '||n,'active',current_date-30 from infection_bulk;
insert into public.infection_clusters(id,organization_id,branch_id,label,created_by,creator_display_name,content_hash) select cluster_id,'25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','人工群聚 '||n,'25000000-0000-4000-8000-000000000001','感染管理員',encode(sha256(convert_to(('cluster'||n)::text,'UTF8')),'hex') from infection_bulk;
insert into public.infection_incidents(id,organization_id,branch_id,client_id,occurred_at,location,event_summary,infection_type_state,infection_type_text,reported_by,reporter_display_name,reported_at,content_hash) select incident_id,'25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001',client_id,clock_timestamp()-interval '10 minutes','批次區','批次事件 '||n,'provided','人工批次類型 '||n,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '9 minutes',encode(sha256(convert_to(('incident'||n)::text,'UTF8')),'hex') from infection_bulk;
insert into public.infection_incident_entries(id,organization_id,branch_id,client_id,incident_id,sequence_number,entry_type,occurred_at,cluster_id,cluster_label,committed_by,committer_display_name,committed_at,content_hash) select entry_id,'25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001',client_id,incident_id,1,'cluster_link',clock_timestamp()-interval '8 minutes',cluster_id,'人工群聚 '||n,'25000000-0000-4000-8000-000000000001','感染管理員',clock_timestamp()-interval '7 minutes',encode(sha256(convert_to(('entry'||n)::text,'UTF8')),'hex') from infection_bulk;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"25000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
create temporary table infection_bulk_snapshot as
select * from public.infection_event_snapshot(
  '25100000-0000-4000-8000-000000000001',
  '25200000-0000-4000-8000-000000000001'
);
select ok((select items_truncated and item_total=200 and matching_total>item_total and jsonb_array_length(items)=200 and (select count(distinct value->>'incident_id') from jsonb_array_elements(items))=200 from infection_bulk_snapshot),'detail cap never changes full unique-incident aggregates');
select ok((select client_options_truncated and client_options_available_total>jsonb_array_length(client_options) and jsonb_array_length(client_options)=200 and infection_options_truncated and infection_options_available_total>jsonb_array_length(infection_type_options) and jsonb_array_length(infection_type_options)=200 and cluster_options_truncated and cluster_options_available_total>jsonb_array_length(cluster_options) and jsonb_array_length(cluster_options)=200 from infection_bulk_snapshot),'all three bounded option sets disclose truthful available totals and truncation');
select ok((select linked_total=201 and awaiting_action_total+awaiting_closure_total+closed_total=matching_total from infection_bulk_snapshot),'cluster-linked aggregate counts each incident once despite timeline joins');
reset role;
insert into public.infection_clusters(id,organization_id,branch_id,label,created_by,creator_display_name,content_hash) values ('25910000-0000-4000-8000-000000000098','25100000-0000-4000-8000-000000000001','25200000-0000-4000-8000-000000000001','人工群聚 A','25000000-0000-4000-8000-000000000001','感染管理員',repeat('8',64));
select ok((select count(*)=2 and count(distinct id)=2 from public.infection_clusters where organization_id='25100000-0000-4000-8000-000000000001' and branch_id='25200000-0000-4000-8000-000000000001' and label='人工群聚 A'),'equal labels remain distinct UUID identities and are never fuzzy-merged');

reset role;
select ok(((length(pg_get_functiondef('private.infection_event_snapshot_response(uuid,uuid,date,date,text,text,uuid,text,uuid)'::regprocedure))-length(replace(pg_get_functiondef('private.infection_event_snapshot_response(uuid,uuid,date,date,text,text,uuid,text,uuid)'::regprocedure),'infection incident snapshot authority expired','')))/length('infection incident snapshot authority expired'))=2,'snapshot rechecks authority before audit and before return');
select ok(exists(select 1 from pg_constraint where conrelid='private.infection_event_operations'::regclass and contype='u' and pg_get_constraintdef(oid) like '%actor_user_id, idempotency_key%'),'operation ledger is actor-scoped');
select is((select count(*) from public.infection_incidents where id=(select incident_id from infection_report_result)),1::bigint,'stable event ID is physically stored once');

select * from finish();
rollback;
