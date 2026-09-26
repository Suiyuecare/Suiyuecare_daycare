begin;
select plan(64);
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

select ok(not has_table_privilege('authenticated','public.nursing_assessment_versions','select,insert,update,delete'),'no direct clinical table grant added');
select ok(not has_function_privilege('authenticated','private.nursing_authority(uuid,uuid,uuid,text)','execute'),'internal authority remains uncallable directly');
select pg_temp.nursing_login(1);set local role authenticated;
select is(public.is_staff_login_allowed(),true,'genuinely approved Google nurse is admitted');
select is(public.can_begin_staff_mfa(),true,'approved nurse can acquire actual MFA');
select is(public.has_recent_aal2(15),false,'legacy global recent-AAL2 boundary is not broadened');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->>'actorUserId','db100000-0000-4000-8000-000000000001','scoped evidence belongs to authenticated nurse');
select is((public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->>'verifiedAt')::timestamptz,to_timestamp(current_setting('test.nursing_totp')::bigint),'evidence returns actual verified timestamp, not clock');
select is((select count(*) from jsonb_object_keys(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'))),4::bigint,'readonly evidence has exactly four nonsensitive fields');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003'),null::jsonb,'second membership cannot expand evidence scope');
select lives_ok($$select public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')$$,'approved non-CEO nurse can read assigned clients');
reset role;
insert into public.membership_roles(membership_id,role_id,assigned_at)
 select 'db700000-0000-4000-8000-000000000001',id,clock_timestamp()+interval '1 hour' from public.roles where role_key='organization_manager' and is_system;
set local role authenticated;
select is(public.is_staff_login_allowed(),true,'current valid nurse remains admitted with an additional future manager role');
select is(jsonb_array_length(public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->'clients'),1,'future manager view_all must not expose an unassigned same-branch client');
reset role;
update public.membership_roles set assigned_at=clock_timestamp()-interval '1 minute'
 where membership_id='db700000-0000-4000-8000-000000000001' and role_id in(select id from public.roles where role_key='organization_manager' and is_system);
set local role authenticated;
select is(jsonb_array_length(public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->'clients'),2,'current effective manager role still permits scope-wide read');
reset role;
delete from public.membership_roles where membership_id='db700000-0000-4000-8000-000000000001'
 and role_id in(select id from public.roles where role_key='organization_manager' and is_system);
set local role authenticated;
select lives_ok($$insert into nursing_admission_data select 'draft',pg_temp.nursing_write()$$,'approved non-CEO nurse creates draft');
select is((select v#>>'{result,state}' from nursing_admission_data where k='draft'),'draft','draft is actually persisted');
select is(pg_temp.nursing_write()->>'replayed','true','same actor/key replays exact immutable result');
select throws_ok($$select pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000001',jsonb_set((select v from nursing_admission_data where k='create'),'{content,domains,observations,detail}','"Changed clinical content"'))$$,'23505',null,'same key changed payload cannot write');
insert into nursing_admission_data select 'sign',jsonb_build_object('action','sign','clientId',v#>>'{request,clientId}',
 'assessmentKey',v#>>'{result,assessmentKey}','previousVersionId',v#>>'{result,versionId}','expectedVersion',1,'expectedContentHash',v#>>'{result,contentHash}') from nursing_admission_data where k='draft';
select lives_ok($$insert into nursing_admission_data select 'signed',pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000002',(select v from nursing_admission_data where k='sign'))$$,'approved nurse signs with original recent challenge semantics');
select is((select v#>>'{result,state}' from nursing_admission_data where k='signed'),'signed','signature is actually persisted');
select is((select v#>'{result,content}' from nursing_admission_data where k='signed'),(select v from nursing_admission_data where k='content'),'sign retains exact human content');
select is(pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000002',(select v from nursing_admission_data where k='sign'))->>'replayed','true','authorized signature replay has same evidence');
reset role;
update public.role_permissions set granted_at=clock_timestamp()+interval '1 hour'
 where role_id in(select id from public.roles where role_key='nurse' and is_system)
 and permission_id in(select id from public.permissions where permission_key='nursing_assessments.sign');
set local role authenticated;
select lives_ok($$select public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')$$,'future sign grant does not remove valid current read permission');
-- Shared acquisition is a union of separately admitted modules. This nurse
-- retains a current referral capability; that must not grant nursing evidence.
select is(public.can_begin_staff_mfa(),true,'valid alternate referral capability preserves shared MFA acquisition');
select ok(public.referral_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001') is not null,'current referral evidence does not depend on future nursing sign grant');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'future nursing sign grant cannot expose scoped verification evidence');
select throws_ok($$select pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000002',(select v from nursing_admission_data where k='sign'))$$,'42501',null,'future nursing sign grant cannot replay a signed receipt');
reset role;
update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute'
 where role_id in(select id from public.roles where role_key='nurse' and is_system)
 and permission_id in(select id from public.permissions where permission_key='nursing_assessments.sign');
set local role authenticated;
select is(pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000002',(select v from nursing_admission_data where k='sign'))->>'replayed','true','effective sign grant restores original exact authorized receipt');
select pg_temp.nursing_login(2);
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'approved but unassigned nurse cannot write');
select is(jsonb_array_length(public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->'clients'),0,'unassigned nurse cannot read another nurse client');
select pg_temp.nursing_login(3);
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'manager cannot substitute for nurse on write');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'manager role alone cannot acquire nursing evidence');
select pg_temp.nursing_login(1);
select throws_ok($$select public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000002')$$,'42501',null,'branch-limited nurse cannot read another branch');
select throws_ok($$select public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003')$$,'42501',null,'second membership cannot expand approval pinned to first organization');
select throws_ok($$select pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000003',jsonb_set((select v from nursing_admission_data where k='create'),'{clientId}','"dbb00000-0000-4000-8000-000000000002"'),'db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003')$$,'42501',null,'assignment and nurse membership elsewhere cannot bypass pinned approval');
select pg_temp.nursing_login(1,'aal1');
select is(public.can_begin_staff_mfa(),true,'AAL1 nurse can begin MFA without gaining clinical access');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'AAL1 cannot read signature evidence');
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'AAL1 nursing draft boundary is not relaxed');
select pg_temp.nursing_login(1);reset role;
update private.staff_google_access_grants set enabled=false where allowed_user_id='db100000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'disabled Google grant denies exact draft replay');
select throws_ok($$select public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')$$,'42501',null,'disabled grant denies snapshot');
select is(public.can_begin_staff_mfa(),false,'revoked grant cannot begin MFA');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'revoked grant masks existing evidence');
reset role;update private.staff_google_access_grants set enabled=true where allowed_user_id='db100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='db300000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'revoked actual Auth session denies replay');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'revoked actual session masks evidence');
reset role;update auth.sessions set not_after=null where id='db300000-0000-4000-8000-000000000001';
update private.reauth_events set revoked_at=clock_timestamp() where user_id='db100000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.nursing_write('dbd00000-0000-4000-8000-000000000002',(select v from nursing_admission_data where k='sign'))$$,'42501',null,'revoked original recent verification denies signature replay');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'revoked original challenge masks evidence');
reset role;update private.reauth_events set revoked_at=null where user_id='db100000-0000-4000-8000-000000000001';
update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dbc00000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'revoked assignment denies exact draft replay');
select is(jsonb_array_length(public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->'clients'),0,'revoked assignment disappears from snapshot');
reset role;update public.client_assignments set ends_at=null where id='dbc00000-0000-4000-8000-000000000001';
update public.membership_roles set assigned_at=clock_timestamp()+interval '1 hour' where membership_id='db700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.can_begin_staff_mfa(),false,'future nursing role assignment cannot begin MFA');
select is(public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001'),null::jsonb,'future role assignment masks evidence');
select throws_ok($$select pg_temp.nursing_write()$$,'42501',null,'future nursing role assignment cannot write');
reset role;update public.membership_roles set assigned_at=clock_timestamp()-interval '1 minute' where membership_id='db700000-0000-4000-8000-000000000001';
select is((select count(*) from public.nursing_assessment_versions where organization_id='db500000-0000-4000-8000-000000000001'),2::bigint,'rejections and replays produce no extra clinical versions');
select is((select count(*) from private.nursing_assessment_operations where actor_user_id='db100000-0000-4000-8000-000000000001'),2::bigint,'only two original immutable operation receipts');
select is((select count(*) from public.audit_events where organization_id='db500000-0000-4000-8000-000000000001' and table_name='public.nursing_assessment_versions'),2::bigint,'only two canonical version audits');
select ok(not has_table_privilege('service_role','public.nursing_assessment_versions','insert,update,delete'),'service role cannot manufacture clinical history');
set local role anon;
select throws_ok($$select public.nursing_assessment_snapshot('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous snapshot denied');
reset role;
select is((select count(*) from private.executive_access_policy),0::bigint,'no CEO grant or fake approval is seeded by remediation');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='nursing_authority'),'no exposed authority definer endpoint added');
select ok(not has_function_privilege('authenticated','private.nursing_mfa_scope(uuid,uuid)','execute'),'new admission capability not directly exposed');
select ok(not has_function_privilege('anon','public.nursing_recent_aal2_evidence(uuid,uuid)','execute') and not has_function_privilege('service_role','public.nursing_recent_aal2_evidence(uuid,uuid)','execute'),'evidence self lookup rejects anon/service role');
-- Actual acquisition, not a pre-seeded signed timestamp or replaced predicate.
select pg_temp.nursing_login(1,'aal1');set local role authenticated;
select is(public.can_begin_staff_mfa(),true,'approved nurse passes actual pre-MFA admission');
reset role;set local role service_role;
select * from public.issue_aal2_reauth_challenge('db800000-0000-4000-8000-000000000099','db100000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',repeat('f',64),'db900000-0000-4000-8000-000000000099',clock_timestamp()-interval '60 seconds','synthetic-prior',300);
reset role;
select set_config('test.nursing_totp',floor(extract(epoch from clock_timestamp()))::text,true);
update auth.mfa_amr_claims set updated_at=to_timestamp(current_setting('test.nursing_totp')::bigint) where session_id='db300000-0000-4000-8000-000000000001' and authentication_method='totp';
select pg_temp.nursing_login(1);set local role authenticated;
select is(public.record_aal2_reauth('db800000-0000-4000-8000-000000000099',repeat('f',64)),true,'actual fresh same-session challenge consumed by approved nurse');
select is((public.nursing_recent_aal2_evidence('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001')->>'verifiedAt')::timestamptz,to_timestamp(current_setting('test.nursing_totp')::bigint),'new evidence returns exact acquired factor time');
select is(public.record_aal2_reauth('db800000-0000-4000-8000-000000000099',repeat('f',64)),false,'consumed challenge cannot be consumed again');
reset role;
select is((select count(*) from private.reauth_events where user_id='db100000-0000-4000-8000-000000000001'),1::bigint,'acquisition preserves one same-session event');
select * from finish();
rollback;
