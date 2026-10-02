begin;
select plan(55);
set local time zone 'Asia/Taipei';
-- Complete synthetic Supabase-owned Google/session/AMR metadata. No admission
-- helper, role predicate, signature challenge guard or RLS function is replaced.
select set_config('test.nursing_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
select set_config('test.nursing_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'nurse-'||n||'@nursing.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('db200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-nursing-google-'||n,
 ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('sub','synthetic-nursing-google-'||n,
 'email','nurse-'||n||'@nursing.example.invalid','email_verified',true),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 now()-interval '3 minutes','aal2' from generate_series(1,3)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('db400000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case m when 1 then 'test.nursing_oauth' else 'test.nursing_totp' end)::bigint),
 to_timestamp(current_setting(case m when 1 then 'test.nursing_oauth' else 'test.nursing_totp' end)::bigint),
 case m when 1 then 'oauth' else 'totp' end from generate_series(1,3)n cross join generate_series(1,2)m;
insert into public.organizations(id,code,name) values
 ('db500000-0000-4000-8000-000000000001','synthetic_nursing_org','Synthetic nursing organization'),
 ('db500000-0000-4000-8000-000000000002','synthetic_nursing_other','Synthetic other nursing organization');
insert into public.branches(id,organization_id,code,name) values
 ('db600000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','main','Synthetic nursing branch'),
 ('db600000-0000-4000-8000-000000000002','db500000-0000-4000-8000-000000000001','second','Synthetic second branch'),
 ('db600000-0000-4000-8000-000000000003','db500000-0000-4000-8000-000000000002','other','Synthetic other branch');
insert into public.profiles(id,display_name,kind)
 select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic nursing employee '||n,'staff' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('db700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'db500000-0000-4000-8000-000000000001',
 'db600000-0000-4000-8000-000000000001',('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,3)n;
insert into public.membership_roles(membership_id,role_id)
 select m.id,r.id from public.memberships m cross join public.roles r where m.id::text like 'db700000-%'
 and r.is_system and r.role_key=case when m.profile_id='db100000-0000-4000-8000-000000000003' then 'organization_manager' else 'nurse' end;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'db500000-0000-4000-8000-000000000001','nursing.example.invalid',
 'nurse-'||n||'@nursing.example.invalid','synthetic-nursing-google-'||n,true,'Synthetic owner-approved nursing employee' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('db700000-0000-4000-8000-000000000011','db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003',
 'db100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select 'db700000-0000-4000-8000-000000000011',id from public.roles where role_key='nurse' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('dbb00000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','N-1','Synthetic assigned nursing client'),
 ('dbb00000-0000-4000-8000-000000000002','db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003','N-2','Synthetic other-organization client'),
 ('dbb00000-0000-4000-8000-000000000003','db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','N-3','Synthetic unassigned same-branch client');
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
 ('dbc00000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000001','nursing',now()-interval '1 day'),
 ('dbc00000-0000-4000-8000-000000000002','db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003','dbb00000-0000-4000-8000-000000000002','db100000-0000-4000-8000-000000000001','nursing',now()-interval '1 day');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('db800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,encode(sha256(convert_to('synthetic-nursing-'||n,'UTF8')),'hex'),
 ('db900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '2 minutes','synthetic-before',now()-interval '1 minute',now()+interval '4 minutes',
 to_timestamp(current_setting('test.nursing_totp')::bigint),to_timestamp(current_setting('test.nursing_totp')::bigint),'synthetic-after','totp',to_timestamp(current_setting('test.nursing_totp')::bigint) from generate_series(1,3)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('db800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.nursing_totp')::bigint) from generate_series(1,3)n;
create temporary table nursing_admission_data(k text primary key,v jsonb);
insert into nursing_admission_data values('content','{"formVersionReference":"manual-nursing-v1","assessedOn":"2026-09-01","domains":{"observations":{"state":"recorded","detail":"Synthetic nursing observation","reason":null},"problems":{"state":"missing","detail":null,"reason":"Pending human review"},"measures":{"state":"recorded","detail":"Synthetic human measures","reason":null},"response":{"state":"not_applicable","detail":null,"reason":"No intervention yet"}},"reassessment":{"state":"missing","dueOn":null,"reason":"Pending human schedule"}}');
insert into nursing_admission_data select 'create',jsonb_build_object('action','create_draft','clientId','dbb00000-0000-4000-8000-000000000001','content',v) from nursing_admission_data where k='content';
grant select,insert,update on nursing_admission_data to authenticated;
create function pg_temp.nursing_login(p_n integer default 1,p_aal text default 'aal2') returns void language plpgsql security invoker as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','db100000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
 'session_id','db300000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'role','authenticated','aud','authenticated','aal',p_aal,'is_anonymous',false,
 'email','nurse-'||p_n||'@nursing.example.invalid','iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.nursing_oauth')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.nursing_totp')::bigint)))::text,true);
end;$$;
create function pg_temp.nursing_write(p_key uuid default 'dbd00000-0000-4000-8000-000000000001',p_request jsonb default null,
 p_org uuid default 'db500000-0000-4000-8000-000000000001',p_branch uuid default 'db600000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.mutate_nursing_assessment(p_org,p_branch,coalesce(p_request,(select v from nursing_admission_data where k='create')),p_key);$$;


-- Only synthetic fixtures above; production admission predicates remain exact.
create function pg_temp.nursing_lookup(
 p_action text default 'create_draft',p_key uuid default 'dbd00000-0000-4000-8000-000000000001',
 p_client uuid default 'dbb00000-0000-4000-8000-000000000001',
 p_org uuid default 'db500000-0000-4000-8000-000000000001',
 p_branch uuid default 'db600000-0000-4000-8000-000000000001',
 p_nonce uuid default 'dbf00000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.nursing_assessment_operation_receipt(p_org,p_branch,p_client,p_action,p_key,p_nonce);$$;
select ok(has_function_privilege('authenticated','public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid)','execute'),'authenticated wrapper executable');
select ok(has_function_privilege('authenticated','private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid)','execute'),'authenticated private core callable through invoker');
select ok(not has_function_privilege('anon','public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid)','execute'),'anon wrapper revoked');
select ok(not has_function_privilege('service_role','public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid)','execute'),'service role wrapper revoked');
select ok(not has_function_privilege('anon','private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid)','execute'),'anon core revoked');
select ok(not has_function_privilege('service_role','private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid)','execute'),'service role core revoked');
select ok(not has_table_privilege('authenticated','private.nursing_assessment_operations','select,insert,update,delete'),'no operation table ACL');
select ok(not has_table_privilege('authenticated','public.nursing_assessment_versions','select,insert,update,delete'),'no clinical table ACL');
select ok((select not prosecdef from pg_proc where oid='public.nursing_assessment_operation_receipt(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure),'public wrapper security invoker');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.nursing_assessment_operation_receipt_core(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure),'private core empty search path definer');
select pg_temp.nursing_login(1);set local role authenticated;
select is(pg_temp.nursing_lookup()->>'status','not_found','absent own operation is not_found, not write failure');
select is(pg_temp.nursing_lookup()->'receipt','null'::jsonb,'absent receipt null');
select is(pg_temp.nursing_lookup()->'persisted','false'::jsonb,'absent not persisted');
insert into nursing_admission_data select 'draft',pg_temp.nursing_write();
insert into nursing_admission_data select 'revise',jsonb_build_object('action','revise_draft','clientId',v->'request'->'clientId',
 'assessmentKey',v->'result'->'assessmentKey','previousVersionId',v->'result'->'versionId',
 'expectedVersion',v->'result'->'version','expectedContentHash',v->'result'->'contentHash',
 'content',jsonb_set(v->'result'->'content','{domains,observations,detail}','"Synthetic revised observation"')) from nursing_admission_data where k='draft';
insert into nursing_admission_data select 'revised',pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000002',(select v from nursing_admission_data where k='revise'));
insert into nursing_admission_data select 'sign',jsonb_build_object('action','sign','clientId',v->'request'->'clientId',
 'assessmentKey',v->'result'->'assessmentKey','previousVersionId',v->'result'->'versionId',
 'expectedVersion',v->'result'->'version','expectedContentHash',v->'result'->'contentHash') from nursing_admission_data where k='revised';
insert into nursing_admission_data select 'signed',pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000003',(select v from nursing_admission_data where k='sign'));
insert into nursing_admission_data select 'correct',jsonb_build_object('action','correct','clientId',v->'request'->'clientId',
 'assessmentKey',v->'result'->'assessmentKey','previousVersionId',v->'result'->'versionId',
 'expectedVersion',v->'result'->'version','expectedContentHash',v->'result'->'contentHash',
 'content',v->'result'->'content','correctionReason','Synthetic human correction') from nursing_admission_data where k='signed';
insert into nursing_admission_data select 'corrected',pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000004',(select v from nursing_admission_data where k='correct'));
select is(pg_temp.nursing_lookup()->'receipt',(select v from nursing_admission_data where k='draft'),'create original immutable receipt exact');
select is(pg_temp.nursing_lookup('revise_draft','dbd00000-0000-4000-8000-000000000002')->'receipt',(select v from nursing_admission_data where k='revised'),'revision original immutable receipt exact');
select is(pg_temp.nursing_lookup('sign','dbd00000-0000-4000-8000-000000000003')->'receipt',(select v from nursing_admission_data where k='signed'),'signature original immutable receipt exact');
select is(pg_temp.nursing_lookup('correct','dbd00000-0000-4000-8000-000000000004')->'receipt',(select v from nursing_admission_data where k='corrected'),'correction original immutable receipt exact');
set local time zone 'UTC';
select is(pg_temp.nursing_lookup()->'receipt',(select v from nursing_admission_data where k='draft'),'Taipei-written draft survives UTC read without changing raw timestamps/hash');
select is(pg_temp.nursing_lookup('revise_draft','dbd00000-0000-4000-8000-000000000002')->'receipt',(select v from nursing_admission_data where k='revised'),'Taipei-written revision survives UTC read');
select is(pg_temp.nursing_lookup('sign','dbd00000-0000-4000-8000-000000000003')->'receipt',(select v from nursing_admission_data where k='signed'),'Taipei-written signature survives UTC read with original signed evidence');
select is(pg_temp.nursing_lookup('correct','dbd00000-0000-4000-8000-000000000004')->'receipt',(select v from nursing_admission_data where k='corrected'),'Taipei-written correction survives UTC read');
set local time zone 'Asia/Taipei';
select is(pg_temp.nursing_lookup()->>'status','committed','found own original operation committed');
select is(pg_temp.nursing_lookup()->'persisted','true'::jsonb,'committed persisted true');
select is(pg_temp.nursing_lookup()->'receipt'->'replayed','false'::jsonb,'lookup is not a replay');
select is(pg_temp.nursing_lookup()->'schemaVersion','1'::jsonb,'versioned wire');
select is(pg_temp.nursing_lookup()->>'nonce','dbf00000-0000-4000-8000-000000000001','exact nonce echo');
select is(pg_temp.nursing_lookup()->>'actorUserId','db100000-0000-4000-8000-000000000001','actor from auth only');
select ok((pg_temp.nursing_lookup()->>'verifiedAt')::timestamptz between statement_timestamp()-interval '1 second' and clock_timestamp()+interval '1 second','server verification time');
select is(pg_temp.nursing_lookup()->'demo','false'::jsonb,'non-demo wire');
select is(pg_temp.nursing_lookup('sign')->>'status','not_found','same key different action non-disclosing');
select is(pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000099')->>'status','not_found','unknown key non-disclosing');
select throws_ok($$select pg_temp.nursing_lookup(null)$$,'22023',null,'null action refused');
select throws_ok($$select pg_temp.nursing_lookup('delete')$$,'22023',null,'invalid action refused');
select throws_ok($$select pg_temp.nursing_lookup('create_draft',null)$$,'22023',null,'null key refused');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001',null)$$,'22023',null,'null client refused');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000001',null)$$,'22023',null,'null organization refused');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001',null)$$,'22023',null,'null branch refused');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',null)$$,'22023',null,'null nonce refused');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000003')$$,'42501',null,'unassigned client rejected');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000002')$$,'42501',null,'cross branch rejected');
select throws_ok($$select pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000002','db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003')$$,'42501',null,'other organization pinned admission rejected');
reset role;
-- Terminal signed evidence is immutable. Install a separate already-expired
-- synthetic consumed challenge instead of modifying the historical signer.
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 values('db800000-0000-4000-8000-000000000098','db100000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',repeat('e',64),
 'db900000-0000-4000-8000-000000000098',clock_timestamp()-interval '18 minutes','synthetic-before-expired',clock_timestamp()-interval '17 minutes',
 clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '16 minutes','synthetic-after-expired','totp',clock_timestamp()-interval '16 minutes');
update private.reauth_events set challenge_id='db800000-0000-4000-8000-000000000098',
 verified_at=(select factor_verified_at from private.reauth_challenges where id='db800000-0000-4000-8000-000000000098') where user_id='db100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.nursing_lookup('sign','dbd00000-0000-4000-8000-000000000003')->'receipt',(select v from nursing_admission_data where k='signed'),'expired signing verification still permits original read-only evidence');
select throws_ok($$select pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000003',(select v from nursing_admission_data where k='sign'))$$,'42501',null,'expired proof still refuses signature replay');
select pg_temp.nursing_login(2);
select throws_ok($$select pg_temp.nursing_lookup()$$,'42501',null,'other unassigned employee denied');
select pg_temp.nursing_login(3);
select is(pg_temp.nursing_lookup()->>'status','not_found','read-only manager cannot read another actor receipt');
select is(pg_temp.nursing_lookup('create_draft','dbd00000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000003')->>'status','not_found','valid read other client cannot leak original receipt');
select pg_temp.nursing_login(1,'aal1');
select throws_ok($$select pg_temp.nursing_lookup()$$,'42501',null,'AAL1 rejected');
select pg_temp.nursing_login(1);reset role;
update private.staff_google_access_grants set enabled=false where allowed_user_id='db100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.nursing_lookup()$$,'42501',null,'disabled approved staff denied');
reset role;update private.staff_google_access_grants set enabled=true where allowed_user_id='db100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='db300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.nursing_lookup()$$,'42501',null,'actual expired session denied');
reset role;update auth.sessions set not_after=null where id='db300000-0000-4000-8000-000000000001';
update public.role_permissions rp set granted_at=clock_timestamp()+interval '1 hour'
 from public.roles r,public.permissions p where r.id=rp.role_id and p.id=rp.permission_id and r.role_key='nurse' and p.permission_key='nursing_assessments.read';
set local role authenticated;
select throws_ok($$select pg_temp.nursing_lookup()$$,'42501',null,'future read permission refused');
reset role;
select is((select count(*)::integer from public.nursing_assessment_versions),4,'lookups add no clinical version');
select is((select count(*)::integer from private.nursing_assessment_operations),4,'lookups add no operation or replay');
select is((select count(*)::integer from private.reauth_events),3,'lookups do not create or consume reauth');
select ok(not exists(select 1 from public.audit_events where table_name='nursing_assessment_operation_receipt'
 and (metadata-array['projection','operation_action','found'])<>'{}'::jsonb),'lookup audit metadata has only sanitized three fields');
select ok(not exists(select 1 from public.audit_events where table_name='nursing_assessment_operation_receipt'
 and (metadata::text like '%dbd00000%' or metadata::text like '%dbf00000%' or metadata::text like '%Synthetic%')),'no nonce key name or clinical body in lookup audit');
select * from finish();rollback;
