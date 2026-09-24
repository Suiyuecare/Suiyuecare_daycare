begin;
select plan(56);
-- Entirely synthetic Auth metadata; real admission/permission/reauth functions.
select set_config('test.custom_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d8100000-0000-4000-8000-000000000001','authenticated','authenticated','custom-form@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d8200000-0000-4000-8000-000000000001','synthetic-custom-google','d8100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-custom-google","email":"custom-form@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d8300000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('d8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d8300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.custom_amr')::bigint),to_timestamp(current_setting('test.custom_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,2)n;
insert into public.organizations(id,code,name) values
 ('d8500000-0000-4000-8000-000000000001','custom_form_test','合成表單機構'),('d8500000-0000-4000-8000-000000000002','custom_other_test','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('d8600000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','main','合成分支'),
 ('d8600000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000002','other','合成他機構分支');
insert into public.profiles(id,display_name,kind) values ('d8100000-0000-4000-8000-000000000001','合成表單管理員','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values
 ('d8700000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('d8700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values
 ('d8100000-0000-4000-8000-000000000001','custom-form@example.invalid','synthetic-custom-google',true,'synthetic test approval only');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values
 ('d8800000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001',repeat('a',64),
 'd8900000-0000-4000-8000-000000000001',now()-interval '2 minutes','before',now()-interval '1 minute',now()+interval '4 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','after','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('d8100000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','d8800000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');
create function pg_temp.custom_login(p_aal text default 'aal2') returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','d8100000-0000-4000-8000-000000000001','session_id','d8300000-0000-4000-8000-000000000001',
  'role','authenticated','aud','authenticated','aal',p_aal,'is_anonymous',false,'email','custom-form@example.invalid',
  'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.custom_amr')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.custom_amr')::bigint)))::text,true);
end;$$;
select set_config('test.custom_payload','{"formKey":"tenant.custom.daily_check","name":"合成機構表單","category":"行政表單","effectiveFrom":"2026-09-14","effectiveTo":null,"schema":{"builder":"tenant-custom.v1","fields":[{"key":"note","label":"合成文字","required":true,"type":"text","maxLength":500},{"key":"count","label":"合成數字","required":true,"type":"number","minimum":0,"maximum":100},{"key":"day","label":"合成日期","required":false,"type":"date"},{"key":"yes","label":"合成是非","required":true,"type":"boolean"},{"key":"choice","label":"合成選擇","required":false,"type":"select","options":["甲","乙"]}]}}',true);
create function pg_temp.custom_save(p_n integer default 1,p_id uuid default null,p_revision integer default null,p_payload jsonb default null,p_branch uuid default 'd8600000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select public.save_custom_form_draft('d8500000-0000-4000-8000-000000000001',p_branch,p_id,p_revision,
 ('d9000000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,coalesce(p_payload,current_setting('test.custom_payload')::jsonb));$$;
create function pg_temp.custom_id() returns uuid language sql as $$select (current_setting('test.custom_receipt')::jsonb->>'formVersionId')::uuid;$$;
create function pg_temp.custom_read() returns jsonb language sql security invoker as $$
 select public.read_custom_form_draft('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',pg_temp.custom_id());$$;
create function pg_temp.custom_mutation_fingerprint() returns text language sql security invoker as $$
 select md5(jsonb_build_object(
  'definitions',(select jsonb_agg(to_jsonb(d) order by d.id) from public.form_definitions d),
  'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from public.form_versions v),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.organization_id,r.actor_id,r.idempotency_key) from private.custom_form_draft_receipts r),
  'audit_count',(select count(*) from public.audit_events where table_name='custom_form_draft')
 )::text);
$$;
insert into public.form_definitions(id,organization_id,form_key,name,category,is_official) values
 ('d9300000-0000-4000-8000-000000000001',null,'official.synthetic','合成官方表單','官方表單',true),
 ('d9300000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','tenant.custom.historical','合成已發布表單','行政表單',false);
insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json,published_at,published_by) values
 ('d9400000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001',1,'draft','2026-01-01','{"fields":[]}','{}',null,null),
 ('d9400000-0000-4000-8000-000000000002','d9300000-0000-4000-8000-000000000002',1,'published','2026-01-01',current_setting('test.custom_payload')::jsonb->'schema','{}',now(),'d8100000-0000-4000-8000-000000000001');


insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('d9500000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','synthetic','合成個案'),
 ('d9500000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000002','d8600000-0000-4000-8000-000000000002','other','他機構合成個案');
select set_config('test.response_input',jsonb_build_object('action','save','formVersionId','d9400000-0000-4000-8000-000000000002',
 'previousId',null,'baseRevision',null,'serviceDate',(now() at time zone 'Asia/Taipei')::date,'answers','{}'::jsonb,'reason',null)::text,true);
create function pg_temp.response_save(n integer, p_input jsonb default null, client_id uuid default 'd9500000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select public.write_custom_form_response('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',client_id,
 ('d9600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,coalesce(p_input,current_setting('test.response_input')::jsonb));$$;
create function pg_temp.response_read() returns jsonb language sql security invoker as $$
 select public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001');$$;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_form_responses'::regclass),'response ledger forced RLS');
select ok(not has_table_privilege('authenticated','private.custom_form_responses','select,insert,update,delete'),'no direct client DML');
select ok(not has_function_privilege('anon','public.write_custom_form_response(uuid,uuid,uuid,uuid,jsonb)','execute'),'anonymous RPC blocked');
select ok(not (select prosecdef from pg_proc where oid='public.write_custom_form_response(uuid,uuid,uuid,uuid,jsonb)'::regprocedure),'public boundary is invoker');
select pg_temp.custom_login();
set local role authenticated;
select lives_ok($$select set_config('test.response_first',pg_temp.response_save(1)::text,true)$$,'incomplete draft can be saved');
select is(pg_temp.response_save(1)->>'replayed','true','same key replays exact result');
select is((pg_temp.response_read()->>'total')::integer,1,'retry creates no duplicate');
select throws_ok($$select pg_temp.response_save(1,jsonb_set(current_setting('test.response_input')::jsonb,'{answers}','{"note":{"state":"answered","value":"changed"}}'))$$,'23505',null,'same key different payload rejected');
select throws_ok($$select pg_temp.response_save(2,null,'d9500000-0000-4000-8000-000000000002')$$,'42501',null,'cross tenant client denied');
select throws_ok($$select pg_temp.response_save(2,jsonb_set(current_setting('test.response_input')::jsonb,'{formVersionId}','"d9400000-0000-4000-8000-000000000001"'))$$,'42501',null,'official form excluded');
select throws_ok($$select pg_temp.response_save(2,jsonb_set(current_setting('test.response_input')::jsonb,'{answers}','{"injected":{"state":"answered","value":true}}'))$$,'22023',null,'unknown field rejected');
select throws_ok($$select pg_temp.response_save(2,jsonb_set(current_setting('test.response_input')::jsonb,'{answers}','{"count":{"state":"answered","value":101}}'))$$,'22023',null,'server validates numeric range');
select throws_ok($$select pg_temp.response_save(2,jsonb_set(current_setting('test.response_input')::jsonb,'{answers}','{"day":{"state":"answered","value":"2026-02-30"}}'))$$,'22023',null,'server validates true dates');
select throws_ok($$select pg_temp.response_save(2,jsonb_set(current_setting('test.response_input')::jsonb,'{answers}','{"note":{"state":"not_applicable"}}'))$$,'22023',null,'NA needs reason');
select set_config('test.response_update', (current_setting('test.response_input')::jsonb||jsonb_build_object('previousId',current_setting('test.response_first')::jsonb->'record'->'id','baseRevision',1))::text,true);
select throws_ok($$select pg_temp.response_save(2,current_setting('test.response_update')::jsonb||'{"action":"sign","answers":null}')$$,'23514',null,'missing required values block signing');
select lives_ok($$select set_config('test.response_filled',pg_temp.response_save(2,current_setting('test.response_update')::jsonb||
 '{"answers":{"note":{"state":"answered","value":"合成測試"},"count":{"state":"answered","value":0},"yes":{"state":"answered","value":false},"choice":{"state":"not_applicable","reason":"合成情境不適用"}}}')::text,true)$$,'complete draft preserves numeric zero, false and explicit NA');
select throws_ok($$select pg_temp.response_save(3,current_setting('test.response_update')::jsonb)$$,'40001',null,'stale revision cannot overwrite');
select set_config('test.response_sign', (current_setting('test.response_input')::jsonb||jsonb_build_object('action','sign','answers',null,'previousId',current_setting('test.response_filled')::jsonb->'record'->'id','baseRevision',2))::text,true);
select lives_ok($$select set_config('test.response_signed',pg_temp.response_save(3,current_setting('test.response_sign')::jsonb)::text,true)$$,'sign complete response with actual reauth fixture');
select is(current_setting('test.response_signed')::jsonb->'record'->>'status','signed','signed terminal stored');
select ok(current_setting('test.response_signed')::jsonb->'record'->'signatureEvidence'->>'challengeId' is not null,'signature binds immutable challenge');
select is(pg_temp.response_save(3,current_setting('test.response_sign')::jsonb)->>'replayed','true','recent same-session signature retry returns original receipt');
reset role;
update private.reauth_events set revoked_at=now() where challenge_id='d8800000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.response_save(3,current_setting('test.response_sign')::jsonb)$$,'42501',null,'signature replay rejects revoked second-factor evidence before returning receipt');
reset role;
-- Provision already-expired synthetic evidence; never rewrite terminal challenge
-- timestamps or disable the production immutability protections for a fixture.
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values
 ('d8800000-0000-4000-8000-000000000002','d8100000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001',repeat('b',64),
 'd8900000-0000-4000-8000-000000000002',now()-interval '18 minutes','expired-before',now()-interval '17 minutes',now()-interval '12 minutes',
 now()-interval '16 minutes',now()-interval '16 minutes','expired-after','totp',now()-interval '16 minutes');
update private.reauth_events set challenge_id='d8800000-0000-4000-8000-000000000002',
 verified_at=now()-interval '16 minutes',revoked_at=null
 where user_id='d8100000-0000-4000-8000-000000000001' and session_id='d8300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.response_save(3,current_setting('test.response_sign')::jsonb)$$,'42501',null,'signature replay rejects expired second-factor evidence');
reset role;
update private.reauth_events set challenge_id='d8800000-0000-4000-8000-000000000001',
 verified_at=now()-interval '30 seconds',revoked_at=null
 where user_id='d8100000-0000-4000-8000-000000000001' and session_id='d8300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.response_save(3,current_setting('test.response_sign')::jsonb)->'record'->'signatureEvidence',current_setting('test.response_signed')::jsonb->'record'->'signatureEvidence','valid replay retains original signature evidence and time');
select set_config('test.response_correct', (current_setting('test.response_input')::jsonb||jsonb_build_object('action','correct','answers',null,'previousId',current_setting('test.response_signed')::jsonb->'record'->'id','baseRevision',3,'reason','修正合成紀錄'))::text,true);
select throws_ok($$select pg_temp.response_save(4,current_setting('test.response_correct')::jsonb||'{"action":"save","answers":{},"reason":null}')$$,'23514',null,'signed record cannot be overwritten');
select lives_ok($$select set_config('test.response_corrected',pg_temp.response_save(4,current_setting('test.response_correct')::jsonb)::text,true)$$,'correction creates new unsigned version');
select is(current_setting('test.response_corrected')::jsonb->'record'->>'correctionSourceId',current_setting('test.response_signed')::jsonb->'record'->>'id','correction links original signature');
select is((pg_temp.response_read()->>'total')::integer,4,'all versions retained');
select pg_temp.custom_login('aal1');
select throws_ok($$select pg_temp.response_read()$$,'42501',null,'AAL1 not silently promoted for sensitive form responses');
select pg_temp.custom_login();
reset role;
-- A genuinely separate approved Google AAL1 staff session. It has no executive
-- policy, no TOTP AMR and no reauthentication fixture, and is client-assigned.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d8100000-0000-4000-8000-000000000002','authenticated','authenticated','form-worker@care.example.invalid',now(),now(),now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d8200000-0000-4000-8000-000000000002','synthetic-form-worker','d8100000-0000-4000-8000-000000000002',
 '{"sub":"synthetic-form-worker","email":"form-worker@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d8300000-0000-4000-8000-000000000002','d8100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 (gen_random_uuid(),'d8300000-0000-4000-8000-000000000002',to_timestamp(current_setting('test.custom_amr')::bigint),to_timestamp(current_setting('test.custom_amr')::bigint),'oauth');
insert into public.profiles(id,display_name,kind) values ('d8100000-0000-4000-8000-000000000002','合成表單照服員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('d8700000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values ('d8700000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('d8100000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','care.example.invalid','form-worker@care.example.invalid','synthetic-form-worker',true,'Synthetic independent form approval');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000002','synthetic-form',now()-interval '1 day');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('d9500000-0000-4000-8000-000000000003','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','unassigned','合成未指派個案');
create function pg_temp.routine_form_login() returns void language sql security invoker as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','d8100000-0000-4000-8000-000000000002','session_id','d8300000-0000-4000-8000-000000000002',
 'role','authenticated','aud','authenticated','aal','aal1','is_anonymous',false,'email','form-worker@care.example.invalid',
 'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.custom_amr')::bigint)))::text,true); $$;
select pg_temp.routine_form_login();
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'actual approved Google AAL1 session admitted');
select is(public.is_executive_login_allowed(),false,'routine user is not an executive fixture');
select is(public.has_recent_aal2(15),false,'routine fixture has no recent second-factor evidence');
select is((pg_temp.response_read()->>'total')::integer,4,'assigned routine Google staff may read form response history');
select lives_ok($$select set_config('test.routine_form_draft',pg_temp.response_save(100)::text,true)$$,'assigned routine Google AAL1 staff may save incomplete draft');
select is(pg_temp.response_save(100)->>'replayed','true','routine draft exact replay allowed');
select is(current_setting('test.routine_form_draft')::jsonb->'record'->>'status','draft','routine write never claims signed');
select throws_ok($$select pg_temp.response_save(101,current_setting('test.response_input')::jsonb||jsonb_build_object('action','sign','answers',null,'previousId',current_setting('test.routine_form_draft')::jsonb->'record'->'id','baseRevision',1))$$,'42501',null,'AAL1 staff cannot sign own draft');
select throws_ok($$select pg_temp.response_save(102,null,'d9500000-0000-4000-8000-000000000003')$$,'42501',null,'routine draft cannot cross client assignment');
select throws_ok($$select public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000003')$$,'42501',null,'routine history cannot cross client assignment');
reset role;
-- A separately granted routine view_all permission still allows unassigned
-- clients, without inventing an AAL2 session or relaxing per-action rights.
insert into public.role_permissions(role_id,permission_id)
 select '10000000-0000-4000-8000-000000000006',id from public.permissions where permission_key='clients.view_all';
set local role authenticated;
select is((public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000003')->>'total')::integer,0,'routine view_all authority remains valid without a client assignment');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000006'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
update private.staff_google_access_grants set enabled=false where allowed_user_id='d8100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.response_read()$$,'42501',null,'revoked Google grant denies history');
select throws_ok($$select pg_temp.response_save(100)$$,'42501',null,'revoked Google grant denies exact draft replay');
reset role;
update private.staff_google_access_grants set enabled=true where allowed_user_id='d8100000-0000-4000-8000-000000000002';
update auth.sessions set not_after=now()-interval '1 second' where id='d8300000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.response_read()$$,'42501',null,'expired routine session denies history');
select throws_ok($$select pg_temp.response_save(100)$$,'42501',null,'expired routine session denies replay');
reset role;
update auth.sessions set not_after=null where id='d8300000-0000-4000-8000-000000000002';
update public.client_assignments set ends_at=now()-interval '1 second' where assignee_user_id='d8100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.response_read()$$,'42501',null,'revoked assignment denies history despite valid Google session');
select throws_ok($$select pg_temp.response_save(100)$$,'42501',null,'revoked assignment denies exact draft replay');
reset role;
update public.client_assignments set ends_at=null where assignee_user_id='d8100000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select pg_temp.response_save(n) from generate_series(1000,1051)n$$,'52 more authorized drafts exercise real pagination');
select set_config('test.form_page1',pg_temp.response_read()::text,true);
select is((current_setting('test.form_page1')::jsonb->>'total')::integer,57,'pagination total includes all immutable revisions');
select is(jsonb_array_length(current_setting('test.form_page1')::jsonb->'records'),50,'first page is bounded to 50 records');
select is(current_setting('test.form_page1')::jsonb->>'hasMore','true','first page exposes remaining records');
select set_config('test.form_page2',public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',
 (current_setting('test.form_page1')::jsonb->'records'->49->>'createdAt')::timestamptz,(current_setting('test.form_page1')::jsonb->'records'->49->>'id')::uuid)::text,true);
select is(jsonb_array_length(current_setting('test.form_page2')::jsonb->'records'),7,'cursor retrieves all remaining seven records');
select is(current_setting('test.form_page2')::jsonb->>'hasMore','false','last page has no more flag');
select is((select count(distinct r->>'id')::integer from jsonb_array_elements((current_setting('test.form_page1')::jsonb->'records')||(current_setting('test.form_page2')::jsonb->'records'))r),57,'both pages contain every record once');
select throws_ok($$select public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001',now(),null)$$,'22023',null,'partial cursor rejected');
select pg_temp.custom_login();
reset role;
update public.organizations set is_active=false where id='d8500000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.response_save(1)$$,'42501',null,'deactivated organization also blocks replay');
reset role;
select throws_ok($$update private.custom_form_responses set answers='{}'$$,'23514',null,'append-only enforced even for privileged direct writes');
select * from finish();
rollback;
