begin;
select plan(32);

-- Synthetic fixtures only. This test deliberately constructs one reviewed
-- pending link; it neither reads nor writes a hosted Supabase project.
select set_config('test.director_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('bb100000-0000-4000-8000-000000000001','authenticated','authenticated',
  'synthetic-director@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('bb100000-0000-4000-8000-000000000002','authenticated','authenticated',
  'synthetic-manager@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('bb110000-0000-4000-8000-000000000001','synthetic-director-google',
  'bb100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-director-google","email":"synthetic-director@example.invalid","email_verified":true}','google'),
 ('bb110000-0000-4000-8000-000000000002','synthetic-manager-google',
  'bb100000-0000-4000-8000-000000000002',
  '{"sub":"synthetic-manager-google","email":"synthetic-manager@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('bb120000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1'),
 ('bb120000-0000-4000-8000-000000000002','bb100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('bb130000-0000-4000-8000-000000000001','bb120000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.director_amr')::bigint),to_timestamp(current_setting('test.director_amr')::bigint),'oauth'),
 ('bb130000-0000-4000-8000-000000000002','bb120000-0000-4000-8000-000000000002',
  to_timestamp(current_setting('test.director_amr')::bigint),to_timestamp(current_setting('test.director_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('bb140000-0000-4000-8000-000000000001','director_synthetic','合成主任機構'),
 ('bb140000-0000-4000-8000-000000000002','director_foreign','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('bb150000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001','wanhua','合成萬華'),
 ('bb150000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000001','other','合成他點'),
 ('bb150000-0000-4000-8000-000000000003','bb140000-0000-4000-8000-000000000002','foreign','合成他機構');
insert into public.profiles(id,display_name,kind) values
 ('bb100000-0000-4000-8000-000000000001','合成主任','staff'),
 ('bb100000-0000-4000-8000-000000000002','合成單點管理員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('bb160000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('bb160000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('bb160000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011'),
 ('bb160000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003');
insert into private.staff_google_access_grants(
  allowed_user_id,organization_id,company_email_domain,allowed_email,
  google_subject,enabled,approval_reference) values
 ('bb100000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'example.invalid','synthetic-director@example.invalid','synthetic-director-google',true,'synthetic explicit approval'),
 ('bb100000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000001',
  'example.invalid','synthetic-manager@example.invalid','synthetic-manager-google',true,'synthetic explicit approval');

insert into private.jubo_source_batches(id,organization_id,branch_id,source_kind,source_sha256,
 source_filename,storage_path,column_labels,section_labels,declared_row_count,mapping_version) values
 ('bb170000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','client_master',repeat('a',64),
  'synthetic-master.xlsx',
  'organizations/bb140000-0000-4000-8000-000000000001/branches/bb150000-0000-4000-8000-000000000001/jubo/synthetic-master.xlsx',
  (select jsonb_agg('合成欄位'||i order by i) from generate_series(0,94)i),
  (select jsonb_agg('合成區段'||i order by i) from generate_series(0,94)i),1,'synthetic-v1'),
 ('bb170000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','daycare_monthly_summary',repeat('b',64),
  'synthetic-monthly.xlsx',
  'organizations/bb140000-0000-4000-8000-000000000001/branches/bb150000-0000-4000-8000-000000000001/jubo/synthetic-monthly.xlsx',
  (select jsonb_agg('合成欄位'||i order by i) from generate_series(0,190)i),
  (select jsonb_agg('合成區段'||i order by i) from generate_series(0,190)i),1,'synthetic-v1');
insert into private.jubo_source_rows(id,batch_id,organization_id,branch_id,
 source_row_number,identity_sha256,raw_values,row_sha256) values
 ('bb180000-0000-4000-8000-000000000001','bb170000-0000-4000-8000-000000000001',
  'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
  1,repeat('c',64),
  (select jsonb_agg(case when i=25 then to_jsonb('SYNTH0001'::text)
    else 'null'::jsonb end order by i) from generate_series(0,94)i),repeat('d',64));
insert into private.jubo_verified_source_pairs(id,organization_id,branch_id,
 master_batch_id,monthly_batch_id,master_byte_sha256,monthly_byte_sha256,
 master_byte_length,monthly_byte_length,master_rows_sha256,
 master_nonrecord_rows_sha256,monthly_rows_sha256,parser_version) values
 ('bb190000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001',
  'bb170000-0000-4000-8000-000000000001','bb170000-0000-4000-8000-000000000002',
  repeat('a',64),repeat('b',64),32,32,repeat('d',64),repeat('e',64),repeat('f',64),'synthetic-v1');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
 issued_jwt_iat,created_at,expires_at) values
 ('bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001',
  'bb120000-0000-4000-8000-000000000001',repeat('f',64),gen_random_uuid(),
  now()-interval '3 minutes',now()-interval '3 minutes',now()+interval '3 minutes');
insert into private.jubo_pending_master_operations(id,organization_id,branch_id,pair_id,
 actor_user_id,reauth_challenge_id,idempotency_key,request_sha256,receipt) values
 ('bb210000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','bb190000-0000-4000-8000-000000000001',
  'bb100000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001',
  gen_random_uuid(),repeat('a',64),'{}');
insert into private.jubo_pending_master_rows(id,organization_id,branch_id,operation_id,source_row_id,
 identity_sha256,display_name,date_of_birth,sex,source_status)
select
 'bb220000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','bb210000-0000-4000-8000-000000000001',
  'bb180000-0000-4000-8000-000000000001',identity_sha256,
  '合成個案甲',date '1945-01-02','male','服務中'
from private.jubo_source_rows where id='bb180000-0000-4000-8000-000000000001';
insert into private.jubo_public_pending_promotions(id,organization_id,branch_id,pair_id,
 pending_operation_id,actor_user_id,reauth_challenge_id,idempotency_key,
 request_sha256,receipt) values
 ('bb230000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','bb190000-0000-4000-8000-000000000001',
  'bb210000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001',
  'bb200000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),'{}');
select set_config('app.jubo_pending_promotion_id','bb230000-0000-4000-8000-000000000001',true);
insert into public.clients(id,organization_id,branch_id,client_code,display_name,
 date_of_birth,status,source_system) values
 ('bb240000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','SYNTHETIC-JUBO-1',
  '合成個案甲',date '1945-01-02','pending','jubo'),
 ('bb240000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','SYNTHETIC-JUBO-2',
  '合成未連結個案',date '1945-01-02','pending','jubo');
insert into private.jubo_public_pending_links(id,organization_id,branch_id,promotion_id,
 pending_row_id,client_id) values
 ('bb250000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000001',
  'bb150000-0000-4000-8000-000000000001','bb230000-0000-4000-8000-000000000001',
  'bb220000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001');

create function pg_temp.login(p_user integer default 1) returns void
language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub',case p_user when 1 then 'bb100000-0000-4000-8000-000000000001'
    else 'bb100000-0000-4000-8000-000000000002' end,
  'session_id',case p_user when 1 then 'bb120000-0000-4000-8000-000000000001'
    else 'bb120000-0000-4000-8000-000000000002' end,
  'role','authenticated','aud','authenticated','aal','aal1','is_anonymous',false,
  'email',case p_user when 1 then 'synthetic-director@example.invalid'
    else 'synthetic-manager@example.invalid' end,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
    'timestamp',current_setting('test.director_amr')::bigint)))::text,true);
end;
$$;
create function pg_temp.save_local(p_revision integer default 0,
 p_key uuid default 'bb260000-0000-4000-8000-000000000001',
 p_payload jsonb default '{"contactPreference":"phone","visitPlanningNote":"合成到站討論"}')
returns jsonb language sql security invoker as $$
 select public.save_jubo_pending_director_draft(
  'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
  'bb240000-0000-4000-8000-000000000001','local_supplement','intake_local',
  p_revision,p_payload,p_key);
$$;
create function pg_temp.read_draft(p_client uuid default 'bb240000-0000-4000-8000-000000000001')
returns jsonb language sql security invoker as $$
 select public.jubo_pending_director_draft_workspace(
  'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',p_client);
$$;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='private.jubo_pending_director_draft_revisions'::regclass),
 'private revisions have forced RLS');
select ok(not has_table_privilege('authenticated',
 'private.jubo_pending_director_draft_revisions','select,insert,update,delete')
 and not has_table_privilege('service_role',
 'private.jubo_pending_director_draft_revisions','select,insert,update,delete'),
 'browser and service role cannot directly mutate or read draft rows');
select ok(not has_function_privilege('anon',
 'public.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid)','execute')
 and not has_function_privilege('service_role',
 'public.save_jubo_pending_director_draft(uuid,uuid,uuid,text,text,integer,jsonb,uuid)','execute'),
 'anonymous and service role cannot call candidate draft RPC');
select ok(not exists(select 1 from public.role_permissions rp
 join public.permissions p on p.id=rp.permission_id
 where rp.role_id='10000000-0000-4000-8000-000000000011'
 and p.permission_key='clients.manage'),
 'director template remains without clients.manage');

select pg_temp.login();
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'synthetic approved Google director is a real staff session');
select set_config('test.director_receipt',pg_temp.save_local()::text,true);
select is(current_setting('test.director_receipt')::jsonb->>'revision','1',
 'local supplement creates revision one');
select is(pg_temp.read_draft()->'localSupplement'->'payload'->>'visitPlanningNote',
 '合成到站討論','approved director reads only local supplement projection');
select is(pg_temp.save_local()->>'replayed','true','same request replays without duplicate');
select throws_ok($$select pg_temp.save_local(0,'bb260000-0000-4000-8000-000000000001',
 '{"contactPreference":"written"}'::jsonb)$$,'23505','JUBO_PENDING_DRAFT_IDEMPOTENCY_CONFLICT',
 'same key changed payload is rejected');
select throws_ok($$select pg_temp.save_local(0,'bb260000-0000-4000-8000-000000000002')$$,
 '40001','JUBO_PENDING_DRAFT_VERSION_CONFLICT','stale revision never silently overwrites');
select is(pg_temp.save_local(1,'bb260000-0000-4000-8000-000000000003',
 '{"followUpNote":"合成追蹤"}'::jsonb)->>'revision','2',
 'next local revision appends instead of modifying source or first revision');
select is(public.save_jubo_pending_director_draft(
 'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 'bb240000-0000-4000-8000-000000000001','assessment_preparation','abcd',0,
 jsonb_build_object('formVersion','preparation-v1',
  'assessmentDate',(clock_timestamp() at time zone 'Asia/Taipei')::date,
  'answers',jsonb_build_object('a_item_1',true,'note','合成評估草稿'),
  'qualitativeNote','合成待確認觀察'),
 'bb260000-0000-4000-8000-000000000004')->>'formalRecord','false',
 'assessment preparation is explicitly not a formal score or record');
select is(jsonb_array_length(pg_temp.read_draft()->'assessmentPreparations'),1,
 'assessment draft roundtrips through narrow read projection');
select throws_ok($$select pg_temp.save_local(2,'bb260000-0000-4000-8000-000000000005',
 '{"displayName":"偷改來源"}'::jsonb)$$,'22023','JUBO_PENDING_DRAFT_INVALID',
 'central-owned name cannot be sent as a local supplement');
select throws_ok($$select pg_temp.save_local(2,'bb260000-0000-4000-8000-000000000006',
 '{"consent":{"status":"confirmed"}}'::jsonb)$$,'22023','JUBO_PENDING_DRAFT_INVALID',
 'consent cannot be asserted by local supplement');
select throws_ok($$select public.save_jubo_pending_director_draft(
 'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 'bb240000-0000-4000-8000-000000000001','assessment_preparation','abcd',1,
 '{"formVersion":"preparation-v1","assessmentDate":"2026-10-09","answers":{},"score":9}'::jsonb,
 'bb260000-0000-4000-8000-000000000007')$$,'22023','JUBO_PENDING_DRAFT_INVALID',
 'caller cannot submit a score or signed state through draft payload');
select throws_ok($$select pg_temp.read_draft('bb240000-0000-4000-8000-000000000002')$$,
 '42501','JUBO_PENDING_DRAFT_ACCESS_DENIED',
 'unlinked JUBO pending shell does not receive this capability');
select throws_ok($$select public.jubo_pending_director_draft_workspace(
 'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000002',
 'bb240000-0000-4000-8000-000000000001')$$,
 '42501','JUBO_PENDING_DRAFT_ACCESS_DENIED','cross-branch read denied');
select throws_ok($$select public.jubo_pending_director_draft_workspace(
 'bb140000-0000-4000-8000-000000000002','bb150000-0000-4000-8000-000000000003',
 'bb240000-0000-4000-8000-000000000001')$$,
 '42501','JUBO_PENDING_DRAFT_ACCESS_DENIED','cross-tenant read denied');
select throws_ok($$select public.save_jubo_pending_director_draft(
 'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000002',
 'bb240000-0000-4000-8000-000000000001','local_supplement','intake_local',2,
 '{"contactPreference":"phone"}'::jsonb,gen_random_uuid())$$,
 '42501','JUBO_PENDING_DRAFT_ACCESS_DENIED','cross-branch write denied');
select throws_ok($$select public.update_intake_profile(
 'bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 gen_random_uuid(),'bb240000-0000-4000-8000-000000000001',0,1,
 '{"displayName":"偷改來源","clientCode":"X"}'::jsonb)$$,
 '42501',null,'director draft scope is not clients.manage or general profile write');
reset role;
select is((select count(*)::integer from private.jubo_pending_director_draft_revisions),3,
 'two local revisions and one assessment preparation, no duplicate writes');
select is((select count(*)::integer from public.attendance_records),0,
 'drafts did not create formal attendance');
select is((select status::text from public.clients where id='bb240000-0000-4000-8000-000000000001'),
 'pending','drafts did not admit client');
select is((select raw_values->>25 from private.jubo_source_rows
 where id='bb180000-0000-4000-8000-000000000001'),
 'SYNTH0001','original JUBO source payload is unchanged');
select throws_ok($$insert into public.care_records(
 organization_id,branch_id,client_id,record_key,category,occurred_at,data,created_by)
 values('bb140000-0000-4000-8000-000000000001',
 'bb150000-0000-4000-8000-000000000001',
 'bb240000-0000-4000-8000-000000000001',gen_random_uuid(),
 'synthetic/clinical',clock_timestamp(),'{}',
 'bb100000-0000-4000-8000-000000000001')$$,
 '23514','JUBO_PENDING_CLIENT_OPERATION_DENIED',
 'draft permission cannot become a formal care record');
select throws_ok($$update public.clients set status='active'
 where id='bb240000-0000-4000-8000-000000000001'$$,
 '42501','JUBO_PENDING_CLIENT_TRANSITION_DISABLED',
 'candidate draft cannot admit a pending client');
select throws_ok($$insert into private.jubo_pending_director_draft_revisions(
 organization_id,branch_id,client_id,pending_link_id,source_row_id,
 draft_kind,form_key,revision,payload,actor_user_id,idempotency_key,request_sha256)
 values('bb140000-0000-4000-8000-000000000001',
 'bb150000-0000-4000-8000-000000000001',
 'bb240000-0000-4000-8000-000000000001',
 'bb250000-0000-4000-8000-000000000001',
 'bb180000-0000-4000-8000-000000000099',
 'local_supplement','intake_local',3,
 '{"contactPreference":"phone"}',
 'bb100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64))$$,
 '23514','JUBO_PENDING_DRAFT_PROVENANCE_MISMATCH',
 'even an owner-side insert must bind the exact reviewed JUBO source row');
select throws_ok($$update private.jubo_pending_director_draft_revisions
 set payload='{}' where form_key='intake_local'$$,'55000','IMPORT_STAGING_IMMUTABLE',
 'draft revisions cannot be overwritten');
select ok(not exists(select 1 from public.audit_events
 where table_name='private.jubo_pending_director_draft_revisions'
 and metadata::text like '%合成追蹤%'),
 'audit metadata does not copy note content');

select pg_temp.login(2);
set local role authenticated;
select throws_ok($$select pg_temp.read_draft()$$,
 '42501','JUBO_PENDING_DRAFT_ACCESS_DENIED',
 'approved branch_supervisor is not the exact branch_director role');
reset role;
update private.staff_google_access_grants set enabled=false
 where allowed_user_id='bb100000-0000-4000-8000-000000000001';
select pg_temp.login();
set local role authenticated;
select throws_ok($$select pg_temp.save_local()$$,
 '42501','JUBO_PENDING_DRAFT_ACCESS_DENIED',
 'revoked Google approval denies even idempotent replay');
reset role;

select * from finish();
rollback;
