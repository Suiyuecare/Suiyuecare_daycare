begin;
select plan(33);

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
 ('bb120000-0000-4000-8000-000000000002','bb100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('bb130000-0000-4000-8000-000000000001','bb120000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.director_amr')::bigint),to_timestamp(current_setting('test.director_amr')::bigint),'oauth'),
 ('bb130000-0000-4000-8000-000000000002','bb120000-0000-4000-8000-000000000002',
  to_timestamp(current_setting('test.director_amr')::bigint),to_timestamp(current_setting('test.director_amr')::bigint),'oauth'),
 ('bb130000-0000-4000-8000-000000000003','bb120000-0000-4000-8000-000000000002',
  to_timestamp(current_setting('test.director_amr')::bigint),to_timestamp(current_setting('test.director_amr')::bigint),'totp');
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
 source_row_number,identity_sha256,raw_values,row_sha256)
select 'bb180000-0000-4000-8000-000000000001',
 'bb170000-0000-4000-8000-000000000001',
 'bb140000-0000-4000-8000-000000000001',
 'bb150000-0000-4000-8000-000000000001',1,
 encode(sha256(convert_to('SYNTH0001','UTF8')),'hex'),cells.raw_values,
 encode(sha256(convert_to(cells.raw_values::text,'UTF8')),'hex')
from (select jsonb_agg(case i
  when 2 then to_jsonb('合成個案甲'::text)
  when 3 then to_jsonb('男性'::text)
  when 23 then to_jsonb('1945/01/02'::text)
  when 25 then to_jsonb('SYNTH0001'::text)
  else 'null'::jsonb end order by i) as raw_values
  from generate_series(0,94)i) cells;
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
  now()-interval '3 minutes',now()-interval '3 minutes',now()+interval '3 minutes'),
 ('bb200000-0000-4000-8000-000000000002','bb100000-0000-4000-8000-000000000002',
  'bb120000-0000-4000-8000-000000000002',repeat('e',64),gen_random_uuid(),
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
-- The profile-link trigger now requires an independently reviewed v2 mapping.
-- Seed only this synthetic fixture; production review uses the governed RPC.
insert into private.jubo_profile_mapping_v2_previews(
 id,organization_id,branch_id,pair_id,master_source_row_id,actor_user_id,
 actor_session_id,reauth_challenge_id,review_purpose,source_row_sha256,
 mapping_review_sha256,presented_payload_sha256,presented_at,expires_at)
select 'bb250000-0000-4000-8000-000000000001',pending.organization_id,
 pending.branch_id,'bb190000-0000-4000-8000-000000000001',master.id,
 'bb100000-0000-4000-8000-000000000002',
 'bb120000-0000-4000-8000-000000000002',
 'bb200000-0000-4000-8000-000000000002',
 'jubo_intake_profile_mapping_v2',master.row_sha256,
 private.jubo_profile_mapping_fingerprint(master.raw_values,pending),repeat('c',64),
 now(),now()+interval '5 minutes'
from private.jubo_pending_master_rows pending
join private.jubo_source_rows master on master.id=pending.source_row_id
where pending.id='bb220000-0000-4000-8000-000000000001';
insert into private.jubo_profile_mapping_v2_reviews(
 organization_id,branch_id,pair_id,master_source_row_id,review_version,
 source_row_sha256,mapping_review_sha256,mapping_version,decision,
 review_reason,reviewer_user_id,reauth_challenge_id,review_purpose,preview_id,
 presented_payload_sha256,idempotency_key,request_sha256)
select pending.organization_id,pending.branch_id,
 'bb190000-0000-4000-8000-000000000001',master.id,1,
 master.row_sha256,private.jubo_profile_mapping_fingerprint(master.raw_values,pending),
 'jubo-master-monthly-202610-v2','approved',
 '合成測試已逐欄確認來源與新版顯示映射',
 'bb100000-0000-4000-8000-000000000002',
 'bb200000-0000-4000-8000-000000000002',
 'jubo_intake_profile_mapping_v2','bb250000-0000-4000-8000-000000000001',
 repeat('c',64),gen_random_uuid(),repeat('d',64)
from private.jubo_pending_master_rows pending
join private.jubo_source_rows master on master.id=pending.source_row_id
where pending.id='bb220000-0000-4000-8000-000000000001';
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

-- This fixture is a synthetic independently reviewed source, never a real file.
create temporary table supplement_original as
 select v.profile,source_link.profile_sha256,source_link.master_source_row_sha256
 from private.client_intake_versions v join private.jubo_intake_profile_sources source_link on source_link.intake_version_id=v.id
 where v.client_id='bb240000-0000-4000-8000-000000000001';
grant select on supplement_original to authenticated;
create function pg_temp.supplement(expected_version bigint default 1,expected_client bigint default 1,
 operation uuid default 'bb270000-0000-4000-8000-000000000001',override jsonb default '{}') returns jsonb language sql as $$
 select public.update_intake_profile('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 operation,'bb240000-0000-4000-8000-000000000001',expected_version,expected_client,
 (select profile from supplement_original)||'{"phone":"0900000000","notes":"合成待補聯絡"}'::jsonb||override);
$$;
create function pg_temp.ids(ids uuid[] default array['bb240000-0000-4000-8000-000000000001'::uuid,'bb240000-0000-4000-8000-000000000002'::uuid]) returns jsonb language sql as $$
 select public.authorized_pending_questionnaire_client_ids('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',ids);
$$;

select ok(not has_function_privilege('authenticated','private.write_jubo_pending_intake_supplement(uuid,uuid,uuid,uuid,bigint,bigint,jsonb)','execute'),'private supplement is not an additional public write endpoint');
select ok(not has_function_privilege('service_role','public.authorized_pending_questionnaire_client_ids(uuid,uuid,uuid[])','execute'),'service role cannot query actor draft authorization');
select pg_temp.login(2);
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'non-CEO manager has a genuine native Google fixture');
select is(public.has_routine_intake_access('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001','profile.update','bb240000-0000-4000-8000-000000000001'),true,'manager still needs original sensitive profile permission');
select is(pg_temp.ids(),'["bb240000-0000-4000-8000-000000000001"]'::jsonb,'source-bound draft ID projection excludes the unbound pending shell');
select is(pg_temp.supplement()->>'profileVersion','2','audited routine RPC appends pending supplement');
select is(public.client_intake_snapshot('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001')->'profile'->>'phone','0900000000','latest profile includes the saved local phone');
select ok(public.client_intake_snapshot('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001')->'protectedFieldKeys' @> '["clientCode","displayName","identityNumber"]'::jsonb,'immutable source fields are explicitly readonly after a local supplement');
select ok(not (public.client_intake_snapshot('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001')->'protectedFieldKeys' ? 'phone'),'editable contact supplement is not presented as a protected source field');
select is(pg_temp.supplement()->>'replayed','true','same operation is safe to resend');
select throws_ok($$select pg_temp.supplement(1,1,'bb270000-0000-4000-8000-000000000001','{"notes":"改變內容"}')$$,'23505','INTAKE_IDEMPOTENCY_CONFLICT','different content cannot reuse operation key');
select throws_ok($$select pg_temp.supplement(1,1,'bb270000-0000-4000-8000-000000000002')$$,'40001','INTAKE_VERSION_CONFLICT','stale profile and client version cannot overwrite');
select throws_ok($$select pg_temp.supplement(2,2,'bb270000-0000-4000-8000-000000000003','{"displayName":"改變來源姓名"}')$$,'42501','JUBO_PENDING_SOURCE_FIELD_PROTECTED','JUBO source name stays protected');
select throws_ok($$select pg_temp.supplement(2,2,'bb270000-0000-4000-8000-000000000004','{"identityNumber":"SYNTH0002"}')$$,'42501','JUBO_PENDING_SOURCE_FIELD_PROTECTED','source identity cannot be changed');
select throws_ok($$select pg_temp.supplement(2,2,'bb270000-0000-4000-8000-000000000005','{"admitted_on":"2026-10-01"}')$$,'22023','INTAKE_INVALID_PROFILE','admission date is never a supplement field');
select throws_ok($$select public.update_intake_profile('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 'bb270000-0000-4000-8000-000000000006','bb240000-0000-4000-8000-000000000002',0,1,(select profile from supplement_original))$$,'42501','JUBO_PENDING_SUPPLEMENT_DENIED','unbound pending person has no supplement authorization');
select throws_ok($$select public.update_intake_profile('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000002',
 'bb270000-0000-4000-8000-000000000007','bb240000-0000-4000-8000-000000000001',2,2,(select profile from supplement_original))$$,'42501',null,'other branch remains denied');
select set_config('app.jubo_pending_profile_operation','bb270000-0000-4000-8000-000000000001',true);
select throws_ok($$update public.clients set status='active',admitted_on=current_date where id='bb240000-0000-4000-8000-000000000001'$$,'42501',null,'borrowed operation ID cannot admit or elevate status');
select throws_ok($$update public.clients set display_name='未經稽核',row_version=row_version+1 where id='bb240000-0000-4000-8000-000000000001'$$,'42501',null,'direct table update cannot borrow an audited receipt');

reset role;
select is((select count(*) from private.client_intake_operations where operation_kind='update_profile'),1::bigint,'replay and failures create no extra audit operation');
select is((select count(*) from private.client_intake_versions where client_id='bb240000-0000-4000-8000-000000000001'),2::bigint,'one immutable source version and one supplement only');
select ok((select c.status='pending' and c.admitted_on is null and c.ended_on is null and c.row_version=2
 from public.clients c where c.id='bb240000-0000-4000-8000-000000000001'),'supplement stays pending and advances only projection version');
select ok((select s.profile_sha256=o.profile_sha256 and s.master_source_row_sha256=o.master_source_row_sha256 and v.profile=o.profile
 from private.jubo_intake_profile_sources s join private.client_intake_versions v on v.id=s.intake_version_id cross join supplement_original o
 where s.client_id='bb240000-0000-4000-8000-000000000001'),'original mapped source and row hashes are unchanged');
select ok((select auth_context->>'method'='google_oauth' and auth_context->>'assuranceLevel'='aal1' and actor_user_id='bb100000-0000-4000-8000-000000000002'
 from private.client_intake_operations where idempotency_key='bb270000-0000-4000-8000-000000000001'),'real actor and native AAL1 audit evidence are captured without fabricated MFA');
select ok(not exists(select 1 from public.audit_events where table_name='private.client_intake_operations' and metadata::text like '%合成待補聯絡%'),'audit metadata never copies supplement note');
select throws_ok($$update private.client_intake_versions set profile='{}' where client_id='bb240000-0000-4000-8000-000000000001'$$,'55000','IMPORT_STAGING_IMMUTABLE','saved source and supplement versions cannot be overwritten');

select pg_temp.login(1);
set local role authenticated;
select is(pg_temp.ids(),'["bb240000-0000-4000-8000-000000000001"]'::jsonb,'source-authorized director gets nine-questionnaire draft IDs');
select throws_ok($$select pg_temp.supplement(2,2,'bb270000-0000-4000-8000-000000000008')$$,'42501','JUBO_PENDING_SUPPLEMENT_DENIED','director without sensitive profile manage is not silently overgranted');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000011' and permission_id in(select id from public.permissions where permission_key like 'questionnaire_%.manage');
set local role authenticated;
select is(pg_temp.ids(),'[]'::jsonb,'read-only director receives no draft permission flag');
select throws_ok($$select public.authorized_pending_questionnaire_client_ids('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000002',array['bb240000-0000-4000-8000-000000000001'::uuid])$$,'42501','QUESTIONNAIRE_ACCESS_DENIED','authorization ID RPC rejects another branch');
select throws_ok($$select pg_temp.ids(array[null::uuid])$$,'22023','QUESTIONNAIRE_CLIENT_IDS_INVALID','malformed caller identifiers rejected');

reset role;
update private.staff_google_access_grants set enabled=false where allowed_user_id='bb100000-0000-4000-8000-000000000002';
select pg_temp.login(2);
set local role authenticated;
select throws_ok($$select pg_temp.supplement()$$,'42501','JUBO_PENDING_SUPPLEMENT_DENIED','revoked native Google authority denies replay too');
select throws_ok($$select pg_temp.ids()$$,'42501','QUESTIONNAIRE_ACCESS_DENIED','revoked authority cannot disclose draft IDs');
reset role;
select * from finish();
rollback;
