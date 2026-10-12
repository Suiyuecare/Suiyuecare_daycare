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
 ('bb120000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2'),
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
  'role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,
  'email',case p_user when 1 then 'synthetic-director@example.invalid'
    else 'synthetic-manager@example.invalid' end,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
    'timestamp',current_setting('test.director_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.director_amr')::bigint)))::text,true);
end;
$$;

-- Genuine native Google/AAL2 fixtures and consumed same-session factor proof.
-- No production predicate is replaced in this suite.
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 values(gen_random_uuid(),'bb120000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.director_amr')::bigint),to_timestamp(current_setting('test.director_amr')::bigint),'totp');
update private.reauth_challenges set consumed_at=now()-interval '1 minute',consumed_jwt_iat=now()-interval '1 minute',
 factor_method='totp',factor_verified_at=now()-interval '1 minute'
 where id in('bb200000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000002');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges
 where id in('bb200000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000002');
-- Explicit synthetic permission assignment: a director role alone is not a
-- grant to manage sensitive profiles.
insert into public.role_permissions(role_id,permission_id)
 select '10000000-0000-4000-8000-000000000011',id from public.permissions
 where permission_key in('clients.read','clients.demographics.read','clients.manage') on conflict do nothing;

create function pg_temp.admission_snapshot(p_branch uuid default 'bb150000-0000-4000-8000-000000000001',
 p_client uuid default 'bb240000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.jubo_admission_preparation_snapshot('bb140000-0000-4000-8000-000000000001',p_branch,p_client);
$$;
create function pg_temp.admission_propose(p_key uuid default 'bb270000-0000-4000-8000-000000000001',
 p_version bigint default 1,p_date date default (clock_timestamp() at time zone 'Asia/Taipei')::date,
 p_reason text default '合成資格契約及收案日期已人工核對但文件尚待驗證') returns jsonb language sql as $$
 select public.propose_jubo_pending_admission('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 'bb240000-0000-4000-8000-000000000001',p_date,'SYNTHETIC-ELIGIBILITY',repeat('a',64),
 (clock_timestamp() at time zone 'Asia/Taipei')::date-1,(clock_timestamp() at time zone 'Asia/Taipei')::date+1,
 'SYNTHETIC-AGREEMENT',repeat('b',64),p_version,p_reason,p_key);
$$;
create function pg_temp.admission_review(p_key uuid default 'bb280000-0000-4000-8000-000000000001',
 p_sha text default null) returns jsonb language sql as $$
 select public.review_jubo_pending_admission('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 'bb240000-0000-4000-8000-000000000001',
 (current_setting('test.admission_proposal')::jsonb->>'proposalId')::uuid,
 coalesce(p_sha,current_setting('test.admission_proposal')::jsonb->>'proposalSha256'),
 'approved','合成獨立主任已核對日期及資格契約但仍待文件驗證',p_key);
$$;

select ok(not has_function_privilege('anon','public.jubo_admission_preparation_snapshot(uuid,uuid,uuid)','execute'),'anonymous cannot read preparation');
select ok(not has_function_privilege('service_role','public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)','execute'),'service role cannot act as a reviewer');
select pg_temp.login(2);
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'approved manager uses real native Google/session admission');
select is(pg_temp.admission_snapshot()->>'admissionEnabled','false','readback never claims final admission');
select is(pg_temp.admission_snapshot()->>'canSubmit','true','source-bound manager can prepare service-status source');
select throws_ok($$select pg_temp.admission_propose('bb270000-0000-4000-8000-000000000002',1,null)$$,'22023','JUBO_PENDING_ADMISSION_INVALID','real admission date is required');
select throws_ok($$select pg_temp.admission_propose('bb270000-0000-4000-8000-000000000002',1,(clock_timestamp() at time zone 'Asia/Taipei')::date+1)$$,'22023','JUBO_PENDING_ADMISSION_INVALID','future Taipei admission date is rejected');
select throws_ok($$select pg_temp.admission_propose('bb270000-0000-4000-8000-000000000002',2)$$,'40001','JUBO_PENDING_ADMISSION_CLIENT_CHANGED','stale client baseline cannot submit');
select set_config('test.admission_proposal',pg_temp.admission_propose()::text,true);
select is(current_setting('test.admission_proposal')::jsonb->>'status','awaiting_second_review','submission is preparation, not admission');
select is(pg_temp.admission_propose()->>'replayed','true','same proposal operation safely replays');
select throws_ok($$select pg_temp.admission_propose('bb270000-0000-4000-8000-000000000001',1,(clock_timestamp() at time zone 'Asia/Taipei')::date,'合成不同的文件核對理由不能覆寫')$$,'23505','JUBO_PENDING_ADMISSION_IDEMPOTENCY_CONFLICT','changed content cannot reuse proposal key');
select throws_ok($$select pg_temp.admission_review()$$,'42501','JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED','requester cannot approve their own proposal');
select throws_ok($$select pg_temp.admission_snapshot('bb150000-0000-4000-8000-000000000002')$$,'42501','JUBO_PENDING_ADMISSION_SCOPE_DENIED','sibling branch cannot read preparation');
select throws_ok($$select pg_temp.admission_snapshot('bb150000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000002')$$,'42501','JUBO_PENDING_ADMISSION_SCOPE_DENIED','unbound JUBO shell cannot claim verified source');
reset role;
select pg_temp.login(1);
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'reviewer has independent native Google identity and AAL2 session');
select is(pg_temp.admission_snapshot()->'proposals'->0->>'canReview','true','another explicitly authorized director can review current source/version');
select throws_ok($$select pg_temp.admission_review('bb280000-0000-4000-8000-000000000002',repeat('c',64))$$,'42501','JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED','a mismatched proposal content hash cannot be reviewed');
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{aal}','"aal1"')::text,true);
select throws_ok($$select pg_temp.admission_review()$$,'42501','JUBO_PENDING_ADMISSION_AAL2_REQUIRED','Google AAL1 cannot serve as factor reauthentication');
select pg_temp.login(1);
select is(pg_temp.admission_review()->>'admissionEnabled','false','independent approval cannot elevate client to admitted');
select is(pg_temp.admission_review()->>'replayed','true','same review replays without duplicating signed evidence');
reset role;
select is((select source_verification_status from private.jubo_pending_admission_proposals limit 1),'unverified','reference/hash declarations are not verified evidence');
select throws_ok($$update private.jubo_pending_admission_proposals set proposed_admitted_on=(clock_timestamp() at time zone 'Asia/Taipei')::date-1$$,'55000','IMPORT_STAGING_IMMUTABLE','submitted proposal cannot be rewritten');
select throws_ok($$update private.jubo_pending_admission_reviews set decision='held'$$,'55000','IMPORT_STAGING_IMMUTABLE','director decision cannot be rewritten');
select ok((select status='pending' and admitted_on is null and ended_on is null from public.clients where id='bb240000-0000-4000-8000-000000000001'),'no preparation action writes a formal admission date');
select throws_ok($$select private.activate_jubo_pending_client_candidate('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001')$$,'42501','JUBO_PENDING_ADMISSION_SOURCE_UNCONFIGURED','even operator cannot supply clinical source verification');
select ok((select source_binding->>'kind'='reviewed_export' and expected_intake_version=1 from private.jubo_pending_admission_proposals limit 1),'submission pins immutable source binding and intake profile version');

select pg_temp.login(2);
set local role authenticated;
select set_config('test.admission_proposal',pg_temp.admission_propose('bb270000-0000-4000-8000-000000000003')::text,true);
select public.update_intake_profile('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001',
 'bb290000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001',1,1,
 public.client_intake_snapshot('bb140000-0000-4000-8000-000000000001','bb150000-0000-4000-8000-000000000001','bb240000-0000-4000-8000-000000000001')->'profile'||'{"phone":"0900000000"}'::jsonb);
reset role;
select pg_temp.login(1);
set local role authenticated;
select is(pg_temp.admission_snapshot()->'proposals'->0->>'canReview','false','profile supplement invalidates old review affordance');
select throws_ok($$select pg_temp.admission_review('bb280000-0000-4000-8000-000000000003')$$,'42501','JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED','stale profile/client version cannot be approved');
reset role;
update private.reauth_events set revoked_at=clock_timestamp() where user_id='bb100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.admission_review('bb280000-0000-4000-8000-000000000001')$$,'42501','JUBO_PENDING_ADMISSION_AAL2_REQUIRED','revoked challenge denies even an old review replay');
reset role;
select pg_temp.login(2);
update private.staff_google_access_grants set enabled=false where allowed_user_id='bb100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.admission_snapshot()$$,'42501','JUBO_PENDING_ADMISSION_SCOPE_DENIED','revoked native admission cannot disclose prior proposals');
reset role;
select is((select count(*) from private.jubo_pending_admission_reviews),1::bigint,'failures and replay do not create extra review records');
select is((select count(*) from private.jubo_pending_admission_proposals),2::bigint,'new version appends while replay and failures do not duplicate proposals');
select ok(not has_table_privilege('authenticated','private.jubo_pending_admission_reviews','insert'),'no authenticated direct-review write bypass');
select * from finish();
rollback;
