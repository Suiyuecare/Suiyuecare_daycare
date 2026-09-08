begin;

select plan(39);

select is((select count(*) from public.permissions where permission_key in(
  'daily_service_summary.read','daily_service_summary.export')),2::bigint,
  'Page54 publishes exactly two dedicated permissions');

select ok(not exists(select 1 from public.role_permissions rp
  join public.roles role on role.id=rp.role_id
  join public.permissions permission on permission.id=rp.permission_id
  where permission.permission_key='daily_service_summary.export'
    and role.role_key not in('organization_manager','branch_supervisor','finance_claims')),
  'export is limited to management and finance templates');

select ok(not has_table_privilege('authenticated','private.daily_service_summary_snapshots_v2',
  'select,insert,update,delete')
  and not has_table_privilege('service_role','private.daily_service_summary_snapshots_v2',
  'select,insert,update,delete')
  and (select relrowsecurity and relforcerowsecurity from pg_class
    where oid='private.daily_service_summary_snapshots_v2'::regclass),
  'snapshot storage forces RLS without browser or service-role table access');

select ok(has_function_privilege('authenticated',
  'public.daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)','execute')
  and has_function_privilege('authenticated',
  'public.daily_service_summary_export_snapshot_v2(uuid,uuid,uuid)','execute')
  and not has_function_privilege('service_role',
  'public.daily_service_summary_export_snapshot_v2(uuid,uuid,uuid)','execute'),
  'only authenticated callers receive exact public RPC entrypoints');

select ok(not (select prosecdef from pg_proc where oid=
  'public.daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid=
  'public.daily_service_summary_export_snapshot_v2(uuid,uuid,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid=
    'private.create_daily_service_summary_snapshot_v2(uuid,uuid,date,uuid,text)'::regprocedure),
  'public wrappers are invoker and guarded core is pinned definer');

select ok(not has_function_privilege('authenticated',
  'private.daily_service_summary_payload_v2(uuid,uuid,date,uuid,text,timestamptz)','execute')
  and not has_function_privilege('public',
  'private.daily_service_summary_source_authority_v2(uuid,uuid,uuid,text,date)','execute'),
  'raw cross-source payload and source authority are not callable');

select is((select count(*) from pg_trigger where not tgisinternal
  and tgname='daily_service_summary_snapshots_v2_immutable'),1::bigint,
  'one immutable trigger protects updates and deletes');

select ok(not exists(select 1 from pg_constraint constraint_row
  cross join lateral unnest(constraint_row.conkey) fk_attnum
  where constraint_row.contype='f'
    and constraint_row.conrelid='private.daily_service_summary_snapshots_v2'::regclass
    and not exists(select 1 from pg_index index_row
      where index_row.indrelid=constraint_row.conrelid
        and fk_attnum=any(index_row.indkey))),
  'every snapshot foreign key participates in an index');

select ok(position('transport_execution.manage_any' in pg_get_functiondef(
  'private.daily_service_summary_source_authority_v2(uuid,uuid,uuid,text,date)'::regprocedure))>0
  and position('plan.driver_user_id=auth.uid()' in replace(pg_get_functiondef(
  'private.daily_service_summary_source_authority_v2(uuid,uuid,uuid,text,date)'::regprocedure),' ',''))>0,
  'transport source retains assigned-driver or manage-any visibility');

select ok(position('ordinal<=200' in replace(pg_get_functiondef(
  'private.daily_service_summary_payload_v2(uuid,uuid,date,uuid,text,timestamptz)'::regprocedure),' ',''))>0
  and position('ordinal<=50' in replace(pg_get_functiondef(
  'private.daily_service_summary_payload_v2(uuid,uuid,date,uuid,text,timestamptz)'::regprocedure),' ',''))>0,
  'client rows and per-cell source identifiers are server bounded');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
('54000000-0000-4000-8000-000000000001','authenticated','authenticated','p54-a@example.invalid',now(),now()),
('54000000-0000-4000-8000-000000000002','authenticated','authenticated','p54-b@example.invalid',now(),now());
insert into public.organizations(id,code,name) values
('54100000-0000-4000-8000-000000000001','p54_org','合成每日彙整機構');
insert into public.branches(id,organization_id,code,name) values
('54200000-0000-4000-8000-000000000001','54100000-0000-4000-8000-000000000001','main','合成主分支'),
('54200000-0000-4000-8000-000000000002','54100000-0000-4000-8000-000000000001','other','合成其他分支');
insert into public.profiles(id,display_name,kind) values
('54000000-0000-4000-8000-000000000001','合成主管甲','staff'),
('54000000-0000-4000-8000-000000000002','合成主管乙','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
('54300000-0000-4000-8000-000000000001','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','active'),
('54300000-0000-4000-8000-000000000002','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000002','active');
insert into public.membership_roles(membership_id,role_id) values
('54300000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
('54300000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,
  admitted_on,ended_on) values
('54400000-0000-4000-8000-000000000001','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','P54-1','合成彙整個案','active',current_date-90,null),
('54400000-0000-4000-8000-000000000002','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000002','P54-2','合成他分支個案','active',current_date-90,null);

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,
  factor_verified_at) values
('54500000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
 '54510000-0000-4000-8000-000000000001',repeat('1',64),
 '54520000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',
 now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
('54500000-0000-4000-8000-000000000002','54000000-0000-4000-8000-000000000002',
 '54510000-0000-4000-8000-000000000002',repeat('2',64),
 '54520000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',
 now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
('54000000-0000-4000-8000-000000000001','54510000-0000-4000-8000-000000000001',
 '54500000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
('54000000-0000-4000-8000-000000000002','54510000-0000-4000-8000-000000000002',
 '54500000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds');

create temporary table p54_day as select
  (now() at time zone 'Asia/Taipei')::date service_on;
grant select on p54_day to authenticated;

insert into public.attendance_records(id,organization_id,branch_id,client_id,service_date,
  status,source,idempotency_key,recorded_by)
select '54600000-0000-4000-8000-000000000001','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','54400000-0000-4000-8000-000000000001',
 service_on,'present','staff','54610000-0000-4000-8000-000000000001',
 '54000000-0000-4000-8000-000000000001' from p54_day;
insert into public.measurements(id,organization_id,branch_id,client_id,measurement_kind,
  measured_at,numeric_value,unit,source,recorded_by,idempotency_key,measurement_set_id,request_hash)
select '54600000-0000-4000-8000-000000000002','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','54400000-0000-4000-8000-000000000001',
 'pulse',(service_on::text||' 09:00:00+08')::timestamptz,72,'bpm','staff',
 '54000000-0000-4000-8000-000000000001','54610000-0000-4000-8000-000000000002',
 '54620000-0000-4000-8000-000000000001',repeat('a',64) from p54_day;
insert into public.care_records(id,organization_id,branch_id,client_id,record_key,version,
  category,status,occurred_at,data,created_by)
select '54600000-0000-4000-8000-000000000003','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','54400000-0000-4000-8000-000000000001',
 '54630000-0000-4000-8000-000000000001',1,'staff/daily-care/care-diary','draft',
 (service_on::text||' 10:00:00+08')::timestamptz,'{"hasAbnormalFlag":false}',
 '54000000-0000-4000-8000-000000000001' from p54_day;
insert into public.service_events(id,organization_id,branch_id,client_id,service_code,status,
  started_at,staff_user_id,evidence,idempotency_key)
select '54600000-0000-4000-8000-000000000004','54100000-0000-4000-8000-000000000001',
 '54200000-0000-4000-8000-000000000001','54400000-0000-4000-8000-000000000001',
 'SYN-P54','planned',(service_on::text||' 11:00:00+08')::timestamptz,
 '54000000-0000-4000-8000-000000000001','{}','54610000-0000-4000-8000-000000000004'
from p54_day;

create temporary table p54_result(snapshot_id uuid,snapshot_hash text,
  expires_at timestamptz,payload jsonb);
create temporary table p54_limited(like p54_result);
create temporary table p54_incomplete(like p54_result);
create temporary table p54_complete(like p54_result);
create temporary table p54_export(like p54_result);
grant select,insert on p54_result,p54_limited,p54_incomplete,p54_complete,p54_export to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"54510000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
  (select service_on from p54_day))$$,'42501','daily service summary snapshot is not permitted',
  'snapshot read requires employee AAL2');

select set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"54510000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000002',
  (select service_on from p54_day))$$,'42501','daily service summary snapshot is not permitted',
  'branch scope rejects another branch');
select throws_ok($$select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
  (select service_on from p54_day),null,'invented')$$,'42501',
  'daily service summary snapshot is not permitted','unknown completeness filter fails closed');

insert into p54_result select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
  (select service_on from p54_day));
select is((select count(*) from p54_result),1::bigint,'valid read creates one snapshot');
select ok((select snapshot_id is not null and snapshot_hash~'^[a-f0-9]{64}$'
  and expires_at>clock_timestamp() from p54_result),'snapshot returns id hash and expiry');
select ok((select payload->>'organization_id'='54100000-0000-4000-8000-000000000001'
  and payload->>'branch_id'='54200000-0000-4000-8000-000000000001'
  and payload->>'service_date'=(select service_on::text from p54_day) from p54_result),
  'payload repeats tenant branch and Taipei service day');
select is((select jsonb_array_length(payload->'rows') from p54_result),1,
  'only the requested branch client appears');
select is((select jsonb_array_length(payload#>'{rows,0,cells}') from p54_result),8,
  'each client row contains all eight source cells');
select ok((select payload#>>'{rows,0,authorized_source_count}'='8'
  and payload#>>'{rows,0,covered_source_count}'='4'
  and payload#>>'{rows,0,not_authorized_source_count}'='0'
  and payload#>>'{rows,0,completeness_percent}'='50' from p54_result),
  'completeness counts four recorded sources over eight authorized configured sources');
select ok((select payload#>>'{metrics,recorded_attendance_clients}'='1'
  and payload#>>'{metrics,recorded_vital_clients}'='1'
  and payload#>>'{metrics,activity_participant_clients}'='0'
  and payload#>>'{metrics,abnormal_event_total}'='0' from p54_result),
  'metrics distinguish recorded sources from authorized known-zero sources');
select ok((select every(cell->>'source_href' like '/app/staff/%')
  from p54_result cross join lateral jsonb_array_elements(payload#>'{rows,0,cells}') cell),
  'every cell exposes only an internal source drilldown');
select ok((select (cell->>'source_hash')~'^[a-f0-9]{64}$'
  and jsonb_array_length(cell->'source_record_ids')=1
  from p54_result cross join lateral jsonb_array_elements(payload#>'{rows,0,cells}') cell
  where cell->>'source_kind'='attendance'),
  'recorded source preserves bounded IDs and source hash');
select ok((select cell->>'evidence_status'='no_record'
  and (cell->>'record_count')::integer=0 and cell->'source_hash'='null'::jsonb
  from p54_result cross join lateral jsonb_array_elements(payload#>'{rows,0,cells}') cell
  where cell->>'source_kind'='meals'),
  'authorized absent meal source is explicit known zero');
select ok((select jsonb_array_length(payload->'client_options')=1
  and payload#>>'{client_options,0,client_id}'='54400000-0000-4000-8000-000000000001'
  from p54_result),'client options stay inside branch and current access');
select ok((select payload->>'consistency_status'='single_database_statement_snapshot'
  and payload->>'offline_status'='not_configured'
  and payload->>'export_status'='immutable_snapshot_available' from p54_result),
  'snapshot states single-statement consistency export and honest offline gap');

insert into p54_incomplete select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
  (select service_on from p54_day),null,'incomplete');
select is((select (payload->>'row_total')::bigint from p54_incomplete),1::bigint,
  'incomplete filter uses the same row denominator');
insert into p54_complete select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
  (select service_on from p54_day),null,'complete');
select is((select (payload->>'row_total')::bigint from p54_complete),0::bigint,
  'complete filter does not invent absent evidence');

reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
  and permission_id=(select id from public.permissions where permission_key='activity.read');
set local role authenticated;
insert into p54_limited select * from public.daily_service_summary_snapshot_v2(
  '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
  (select service_on from p54_day),null,'limited_access');
select ok((select payload#>>'{rows,0,authorized_source_count}'='7'
  and payload#>>'{rows,0,not_authorized_source_count}'='1' from p54_limited),
  'unavailable activity permission is removed from completeness denominator');
select ok((select cell->>'access_status'='not_authorized'
  and cell->>'evidence_status'='unknown' and cell->'record_count'='null'::jsonb
  and jsonb_array_length(cell->'source_record_ids')=0
  from p54_limited cross join lateral jsonb_array_elements(payload#>'{rows,0,cells}') cell
  where cell->>'source_kind'='activities'),
  'unavailable source remains unknown and is never numeric zero');

reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000002',id from public.permissions
where permission_key='activity.read';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"54510000-0000-4000-8000-000000000002"}',true);
select throws_ok(format('select * from public.daily_service_summary_export_snapshot_v2(%L,%L,%L)',
 '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
 (select snapshot_id from p54_result)),'42501','daily service summary export is not permitted',
 'another authorized actor cannot export the first actor snapshot');
select set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"54510000-0000-4000-8000-000000000099"}',true);
select throws_ok(format('select * from public.daily_service_summary_export_snapshot_v2(%L,%L,%L)',
 '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
 (select snapshot_id from p54_result)),'42501','daily service summary export is not permitted',
 'export rejects AAL2 evidence from another session');
select set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"54510000-0000-4000-8000-000000000001"}',true);
insert into p54_export select * from public.daily_service_summary_export_snapshot_v2(
 '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
 (select snapshot_id from p54_result));
select is((select count(*) from p54_export),1::bigint,
  'recent same-session AAL2 exports one stored snapshot');
select ok((select exported.snapshot_id=source.snapshot_id
  and exported.snapshot_hash=source.snapshot_hash and exported.payload=source.payload
  from p54_export exported cross join p54_result source),
  'export returns the exact UI payload and hash without recomputation');

reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
  and permission_id=(select id from public.permissions where permission_key='health.read');
set local role authenticated;
select throws_ok(format('select * from public.daily_service_summary_export_snapshot_v2(%L,%L,%L)',
 '54100000-0000-4000-8000-000000000001','54200000-0000-4000-8000-000000000001',
 (select snapshot_id from p54_result)),'42501','daily service summary source authority changed',
 'export revalidates every source previously disclosed as authorized');

reset role;
select ok((select snapshot.actor_user_id='54000000-0000-4000-8000-000000000001'
  and snapshot.payload_hash=result.snapshot_hash and snapshot.payload=result.payload
  and snapshot.expires_at<=snapshot.created_at+interval '15 minutes'
  from private.daily_service_summary_snapshots_v2 snapshot join p54_result result
    on result.snapshot_id=snapshot.id),'stored snapshot is actor bound hashed and short lived');
select ok(exists(select 1 from public.audit_events audit join p54_result result
  on result.snapshot_id::text=audit.row_pk where audit.action='select'
  and audit.metadata->>'snapshot_hash'=result.snapshot_hash
  and audit.metadata->>'filter_values_logged'='false'
  and audit.metadata->>'client_names_logged'='false'
  and audit.metadata::text not like '%合成彙整個案%'),
  'read audit records identity and counts without names or filter values');
select ok(exists(select 1 from public.audit_events audit join p54_result result
  on result.snapshot_id::text=audit.row_pk where audit.action='export'
  and audit.metadata->>'snapshot_hash'=result.snapshot_hash
  and audit.metadata->>'client_names_logged'='false'),
  'export audit binds the same hash without client names');
select throws_ok(format('update private.daily_service_summary_snapshots_v2
  set expires_at=expires_at+interval ''1 second'' where id=%L',
  (select snapshot_id from p54_result)),'55000','daily service summary snapshot is immutable',
  'even owner cannot update the snapshot');
select throws_ok(format('delete from private.daily_service_summary_snapshots_v2 where id=%L',
  (select snapshot_id from p54_result)),'55000','daily service summary snapshot is immutable',
  'even owner cannot delete the snapshot');

select * from finish();
rollback;
