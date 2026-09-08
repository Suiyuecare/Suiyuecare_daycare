begin;
set local time zone 'Asia/Taipei';
select plan(38);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
  ('public.nursing_assessment_versions'::regclass,'private.nursing_assessment_operations'::regclass)), 'both nursing streams force RLS');
select ok(not has_table_privilege('authenticated','public.nursing_assessment_versions','select,insert,update,delete')
  and not has_table_privilege('anon','public.nursing_assessment_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','private.nursing_assessment_operations','select,insert,update,delete'), 'no direct nursing table grants');
select ok(has_function_privilege('authenticated','public.mutate_nursing_assessment(uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.mutate_nursing_assessment(uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('service_role','public.mutate_nursing_assessment(uuid,uuid,jsonb,uuid)','execute'), 'only authenticated public RPC access');
select ok(not (select prosecdef from pg_proc where oid='public.mutate_nursing_assessment(uuid,uuid,jsonb,uuid)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.mutate_nursing_assessment(uuid,uuid,jsonb,uuid)'::regprocedure), 'invoker wrapper and pinned private guarded core');

insert into auth.users(id) values('51000000-0000-4000-8000-000000001001'),('51000000-0000-4000-8000-000000001002'),('51000000-0000-4000-8000-000000001003');
insert into public.organizations(id,code,name) values('51100000-0000-4000-8000-000000000001','nursing-a','護理合成機構甲'),('51100000-0000-4000-8000-000000000002','nursing-b','護理合成機構乙');
insert into public.branches(id,organization_id,code,name) values
  ('51200000-0000-4000-8000-000000000001','51100000-0000-4000-8000-000000000001','main','護理合成分支甲'),
  ('51200000-0000-4000-8000-000000000002','51100000-0000-4000-8000-000000000001','other','護理合成分支乙'),
  ('51200000-0000-4000-8000-000000000003','51100000-0000-4000-8000-000000000002','main','其他機構分支');
insert into public.profiles(id,display_name,kind) values
  ('51000000-0000-4000-8000-000000001001','合成指派護理人員','staff'),
  ('51000000-0000-4000-8000-000000001002','合成未指派護理人員','staff'),
  ('51000000-0000-4000-8000-000000001003','合成主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
  ('51300000-0000-4000-8000-000000000001','51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000001001','active',now()-interval '1 day'),
  ('51300000-0000-4000-8000-000000000002','51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000001002','active',now()-interval '1 day'),
  ('51300000-0000-4000-8000-000000000003','51100000-0000-4000-8000-000000000001',null,'51000000-0000-4000-8000-000000001003','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select m.id,r.id from public.memberships m join public.roles r on r.is_system and
  r.role_key=case when m.profile_id='51000000-0000-4000-8000-000000001003' then 'organization_manager' else 'nurse' end
where m.organization_id='51100000-0000-4000-8000-000000000001';
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
  ('51400000-0000-4000-8000-000000000001','51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001','N-1','合成個案甲'),
  ('51400000-0000-4000-8000-000000000002','51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000002','N-2','他分支合成個案');
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
  ('51500000-0000-4000-8000-000000000001','51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001','51400000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000001001','nursing',now()-interval '1 day');
create temporary table nursing_test_data(k text primary key, v jsonb);
insert into nursing_test_data values('content','{"formVersionReference":"manual-nursing-v1","assessedOn":"2026-09-01","domains":{"observations":{"state":"recorded","detail":"合成護理觀察","reason":null},"problems":{"state":"missing","detail":null,"reason":"尚待觀察確認"},"measures":{"state":"recorded","detail":"合成人工措施","reason":null},"response":{"state":"not_applicable","detail":null,"reason":"本次尚無處置後回應"}},"reassessment":{"state":"missing","dueOn":null,"reason":"尚待人工排定"}}');
insert into nursing_test_data select 'create',jsonb_build_object('action','create_draft','clientId','51400000-0000-4000-8000-000000000001','content',v) from nursing_test_data where k='content';
grant select,insert,update on nursing_test_data to authenticated;
select ok(private.nursing_content_valid((select v from nursing_test_data where k='content')), 'explicit recorded, missing and NA accepted');
select ok(not private.nursing_content_valid(jsonb_set((select v from nursing_test_data where k='content'),'{domains,problems,reason}','null')), 'missing reason rejected');
select ok(not private.nursing_content_valid(jsonb_set((select v from nursing_test_data where k='content'),'{domains,response,detail}','"hidden detail"')), 'NA cannot hide clinical detail');
select ok(not private.nursing_content_valid(jsonb_set((select v from nursing_test_data where k='content'),'{reassessment,dueOn}','"2026-09-10"')), 'unknown reassessment cannot carry a date');
select ok(not private.nursing_content_valid((select v from nursing_test_data where k='content')||'{"officialScore":0}'), 'invented official score rejected');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal1","session_id":"51600000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='create'),'51700000-0000-4000-8000-000000000001')$$,'42501','nursing operation is not permitted','AAL1 cannot create nursing draft');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000001002","role":"authenticated","aal":"aal2","session_id":"51600000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='create'),'51700000-0000-4000-8000-000000000001')$$,'42501','nursing operation is not permitted','unassigned nurse denied');
select is(jsonb_array_length(public.nursing_assessment_snapshot('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001')->'clients'),0,'unassigned read returns no clients');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"51600000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.nursing_assessment_snapshot('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000002')$$,'42501','nursing snapshot is not permitted','another branch denied');
select throws_ok($$select public.nursing_assessment_snapshot('51100000-0000-4000-8000-000000000002','51200000-0000-4000-8000-000000000003')$$,'42501','nursing snapshot is not permitted','another organization denied');
insert into nursing_test_data select 'draft', public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='create'),'51700000-0000-4000-8000-000000000001');
select is((select v#>>'{result,state}' from nursing_test_data where k='draft'),'draft','assigned nurse creates persisted draft');
select is((public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='create'),'51700000-0000-4000-8000-000000000001')->>'replayed')::boolean,true,'exact actor replay returns receipt');
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',jsonb_set((select v from nursing_test_data where k='create'),'{content,domains,observations,detail}','"其他內容"'),'51700000-0000-4000-8000-000000000001')$$,'23505','nursing idempotency conflict','same key cannot change payload');
insert into nursing_test_data select 'sign', jsonb_build_object('action','sign','clientId',v#>>'{request,clientId}',
  'assessmentKey',v#>>'{result,assessmentKey}','previousVersionId',v#>>'{result,versionId}',
  'expectedVersion',1,'expectedContentHash',v#>>'{result,contentHash}') from nursing_test_data where k='draft';
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='sign'),'51700000-0000-4000-8000-000000000002')$$,'42501','nursing signing requires recent same-session AAL2','sign requires recent server evidence');
reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values(
 '51610000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000001001','51600000-0000-4000-8000-000000000001',repeat('a',64),'51620000-0000-4000-8000-000000000001',
 clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '3 minutes',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id='51610000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',jsonb_set((select v from nursing_test_data where k='sign'),'{expectedContentHash}',to_jsonb(repeat('0',64))),'51700000-0000-4000-8000-000000000002')$$,'40001','nursing version is stale','sign binds displayed content hash');
insert into nursing_test_data select 'signed',public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='sign'),'51700000-0000-4000-8000-000000000002');
select is((select v#>>'{result,state}' from nursing_test_data where k='signed'),'signed','exact current draft signs');
select is((select v#>'{result,content}' from nursing_test_data where k='signed'),(select v from nursing_test_data where k='content'),'sign copies exact persisted form content');
select is((select v#>>'{result,signatureChallengeId}' from nursing_test_data where k='signed'),'51610000-0000-4000-8000-000000000001','signature links real recent challenge');
select is((select v#>>'{result,previousContentHash}' from nursing_test_data where k='signed'),(select v#>>'{result,contentHash}' from nursing_test_data where k='draft'),'signature links predecessor hash');
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='sign'),'51700000-0000-4000-8000-000000000009')$$,'40001','nursing version is stale','stale predecessor cannot sign twice');
insert into nursing_test_data select 'correct',jsonb_build_object('action','correct','clientId',v#>>'{request,clientId}',
 'assessmentKey',v#>>'{result,assessmentKey}','previousVersionId',v#>>'{result,versionId}','expectedVersion',2,
 'expectedContentHash',v#>>'{result,contentHash}','content',jsonb_set(v#>'{result,content}','{domains,observations,detail}','"更正後合成護理觀察"'),'correctionReason','補充人工觀察') from nursing_test_data where k='signed';
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select (v-'correctionReason')||'{"action":"revise_draft"}' from nursing_test_data where k='correct'),'51700000-0000-4000-8000-000000000003')$$,'23514','nursing state does not allow this operation','signed record cannot be revised as draft');
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',jsonb_set((select v from nursing_test_data where k='correct'),'{correctionReason}','""'),'51700000-0000-4000-8000-000000000003')$$,'22023','correction reason is required','blank correction reason denied');
insert into nursing_test_data select 'corrected',public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='correct'),'51700000-0000-4000-8000-000000000003');
select is((select v#>>'{result,state}' from nursing_test_data where k='corrected'),'corrected','signed correction appends version');
select is((public.nursing_assessment_snapshot('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001')#>>'{clients,0,versionsTotal}')::integer,3,'snapshot preserves full draft signed correction chain');
select throws_ok($$select * from public.nursing_assessment_versions$$,'42501',null,'authenticated cannot bypass snapshot');
reset role;
select throws_ok($$update public.nursing_assessment_versions set recorder_display_name='overwrite'$$,'55000','nursing assessment history is append-only','even table owner cannot overwrite history');
select throws_ok($$delete from private.nursing_assessment_operations$$,'55000','nursing assessment history is append-only','operation receipts cannot be deleted');
select is((select count(*) from public.audit_events where table_name='public.nursing_assessment_versions' and organization_id='51100000-0000-4000-8000-000000000001'),3::bigint,'one canonical safe audit per new version, no duplicate audit for replay');
update public.client_assignments set ends_at=now()-interval '1 second' where id='51500000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='create'),'51700000-0000-4000-8000-000000000001')$$,'42501','nursing operation is not permitted','revoked assignment blocks replay');
reset role;
update public.client_assignments set ends_at=null where id='51500000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000001001","role":"authenticated","aal":"aal2","session_id":"51600000-0000-4000-8000-000000000099"}',true);
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='sign'),'51700000-0000-4000-8000-000000000002')$$,'42501','nursing signing requires recent same-session AAL2','different-session signature replay is denied');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000001003","role":"authenticated","aal":"aal2","session_id":"51600000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.mutate_nursing_assessment('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001',(select v from nursing_test_data where k='create'),'51700000-0000-4000-8000-000000000001')$$,'42501','nursing operation is not permitted','organization manager cannot act as nurse');
select is((public.nursing_assessment_snapshot('51100000-0000-4000-8000-000000000001','51200000-0000-4000-8000-000000000001')->>'officialScoreStatus'),'not_configured','official scoring explicitly not configured');
reset role;
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='nursing_assessment_versions' and column_name in ('score','risk_level','diagnosis','auto_reassessment_date')), 'no invented score, diagnosis or automatic reassessment columns');
select is((select v#>>'{result,content,domains,observations,detail}' from nursing_test_data where k='signed'),'合成護理觀察','original signed content remains unchanged after correction');
select * from finish();
rollback;
