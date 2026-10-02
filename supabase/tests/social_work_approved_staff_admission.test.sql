begin;
select plan(84);
set local time zone 'Asia/Taipei';
-- Complete synthetic Supabase-owned Google/session/AMR metadata. No admission
-- helper, role predicate, signature challenge guard or RLS function is replaced.
select set_config('test.referral_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
select set_config('test.referral_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'social-worker-'||n||'@referral.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('dc200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-referral-google-'||n,
 ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('sub','synthetic-referral-google-'||n,
 'email','social-worker-'||n||'@referral.example.invalid','email_verified',true),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('dc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 now()-interval '3 minutes','aal2' from generate_series(1,3)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('dc400000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,('dc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case m when 1 then 'test.referral_oauth' else 'test.referral_totp' end)::bigint),
 to_timestamp(current_setting(case m when 1 then 'test.referral_oauth' else 'test.referral_totp' end)::bigint),
 case m when 1 then 'oauth' else 'totp' end from generate_series(1,3)n cross join generate_series(1,2)m;
insert into public.organizations(id,code,name) values
 ('dc500000-0000-4000-8000-000000000001','synthetic_referral_org','Synthetic referral organization'),
 ('dc500000-0000-4000-8000-000000000002','synthetic_referral_other','Synthetic other referral organization');
insert into public.branches(id,organization_id,code,name) values
 ('dc600000-0000-4000-8000-000000000001','dc500000-0000-4000-8000-000000000001','main','Synthetic referral branch'),
 ('dc600000-0000-4000-8000-000000000002','dc500000-0000-4000-8000-000000000001','second','Synthetic second branch'),
 ('dc600000-0000-4000-8000-000000000003','dc500000-0000-4000-8000-000000000002','other','Synthetic other branch');
insert into public.profiles(id,display_name,kind)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic referral employee '||n,'staff' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('dc700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dc500000-0000-4000-8000-000000000001',
 'dc600000-0000-4000-8000-000000000001',('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,3)n;
insert into public.membership_roles(membership_id,role_id)
 select m.id,r.id from public.memberships m cross join public.roles r where m.id::text like 'dc700000-%'
 and r.is_system and r.role_key=case when m.profile_id='dc100000-0000-4000-8000-000000000003' then 'organization_manager' else 'case_manager_social_worker' end;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dc500000-0000-4000-8000-000000000001','referral.example.invalid',
 'social-worker-'||n||'@referral.example.invalid','synthetic-referral-google-'||n,true,'Synthetic owner-approved referral employee' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('dc700000-0000-4000-8000-000000000011','dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003',
 'dc100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
 select 'dc700000-0000-4000-8000-000000000011',id from public.roles where role_key='case_manager_social_worker' and is_system;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('dcb00000-0000-4000-8000-000000000001','dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001','N-1','Synthetic assigned referral client','2026-08-01'),
 ('dcb00000-0000-4000-8000-000000000002','dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003','N-2','Synthetic other-organization client','2026-08-01'),
 ('dcb00000-0000-4000-8000-000000000003','dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001','N-3','Synthetic unassigned same-branch client','2026-08-01');
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values
 ('dcc00000-0000-4000-8000-000000000001','dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001','dcb00000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000001','referral',now()-interval '1 day'),
 ('dcc00000-0000-4000-8000-000000000002','dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003','dcb00000-0000-4000-8000-000000000002','dc100000-0000-4000-8000-000000000001','referral',now()-interval '1 day');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('dc800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('dc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,encode(sha256(convert_to('synthetic-referral-'||n,'UTF8')),'hex'),
 ('dc900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '2 minutes','synthetic-before',now()-interval '1 minute',now()+interval '4 minutes',
 to_timestamp(current_setting('test.referral_totp')::bigint),to_timestamp(current_setting('test.referral_totp')::bigint),'synthetic-after','totp',to_timestamp(current_setting('test.referral_totp')::bigint) from generate_series(1,3)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('dc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('dc800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.referral_totp')::bigint) from generate_series(1,3)n;

create temporary table referral_admission_data(k text primary key,v jsonb);
grant select,insert,update on referral_admission_data to authenticated;
create function pg_temp.referral_login(p_n integer default 1,p_aal text default 'aal2') returns void language plpgsql security invoker as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','dc100000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
 'session_id','dc300000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'role','authenticated','aud','authenticated','aal',p_aal,'is_anonymous',false,
 'email','social-worker-'||p_n||'@referral.example.invalid','iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.referral_oauth')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.referral_totp')::bigint)))::text,true);
end;$$;

create function pg_temp.social_write(p_module text,p_action text default 'create',p_key uuid default 'dcd00000-0000-4000-8000-000000000001',p_source jsonb default null,
 p_client uuid default 'dcb00000-0000-4000-8000-000000000001',p_content text default 'Synthetic human social assessment',
 p_org uuid default 'dc500000-0000-4000-8000-000000000001',p_branch uuid default 'dc600000-0000-4000-8000-000000000001')
returns jsonb language plpgsql as $$
declare dimensions jsonb:='{"family_relationships":{"state":"provided","detail":"Synthetic family evidence"},"social_support":{"state":"missing","detail":null},"social_participation":{"state":"not_applicable","detail":null},"communication_context":{"state":"provided","detail":"Synthetic communication evidence"},"resource_access":{"state":"missing","detail":null}}';
 result jsonb;
begin
 if p_module='ps' then
  case p_action
   when 'create' then select to_jsonb(r) into result from public.create_psychosocial_assessment_draft(p_org,p_branch,p_client,current_date-1,current_date+30,'Synthetic human reassessment scheduling',dimensions,p_content,'manual-psychosocial-v1',p_key)r;
   when 'revise' then select to_jsonb(r) into result from public.revise_psychosocial_assessment_draft(p_org,p_branch,p_client,(p_source->>'assessment_key')::uuid,(p_source->>'version_id')::uuid,(p_source->>'assessment_version')::integer,current_date-1,current_date+30,'Synthetic human reassessment scheduling',dimensions,p_content,'manual-psychosocial-v1',p_key)r;
   when 'sign' then select to_jsonb(r) into result from public.sign_psychosocial_assessment(p_org,p_branch,p_client,(p_source->>'assessment_key')::uuid,(p_source->>'version_id')::uuid,(p_source->>'assessment_version')::integer,p_key)r;
   when 'correct' then select to_jsonb(r) into result from public.correct_psychosocial_assessment(p_org,p_branch,p_client,(p_source->>'assessment_key')::uuid,(p_source->>'version_id')::uuid,(p_source->>'assessment_version')::integer,current_date-1,current_date+30,'Synthetic human reassessment scheduling',dimensions,p_content,'manual-psychosocial-v1','Synthetic correction evidence',p_key)r;
   else raise exception 'Unsupported synthetic action';
  end case;
 elsif p_module='sw' then
  case p_action
   when 'create' then select to_jsonb(r) into result from public.create_social_work_service_draft(p_org,p_branch,p_client,current_date::timestamptz-interval '1 day','Synthetic social service',p_content,'Synthetic human service outcome',p_key)r;
   when 'revise' then select to_jsonb(r) into result from public.revise_social_work_service_draft(p_org,p_branch,p_client,(p_source->>'record_key')::uuid,(p_source->>'version_id')::uuid,(p_source->>'record_version')::integer,current_date::timestamptz-interval '1 day','Synthetic social service',p_content,'Synthetic human service outcome',p_key)r;
   when 'sign' then select to_jsonb(r) into result from public.sign_social_work_service_record(p_org,p_branch,p_client,(p_source->>'record_key')::uuid,(p_source->>'version_id')::uuid,(p_source->>'record_version')::integer,p_key)r;
   when 'correct' then select to_jsonb(r) into result from public.correct_social_work_service_record(p_org,p_branch,p_client,(p_source->>'record_key')::uuid,(p_source->>'version_id')::uuid,(p_source->>'record_version')::integer,current_date::timestamptz-interval '1 day','Synthetic social service',p_content,'Synthetic human service outcome','Synthetic correction evidence',p_key)r;
   else raise exception 'Unsupported synthetic action';
  end case;
 else raise exception 'Unsupported synthetic module';end if;
 return result;
end;$$;
create function pg_temp.social_follow(p_action text,p_key uuid,p_source jsonb,p_sequence integer default 0)
returns jsonb language sql as $$
 select to_jsonb(r) from public.mutate_social_work_follow_up(p_action,'dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001',
 'dcb00000-0000-4000-8000-000000000001',(p_source->>'record_key')::uuid,(p_source->>'version_id')::uuid,p_sequence,
 case when p_action='track' then current_date+3 end,case when p_action='track' then 'Synthetic follow-up plan' end,
 case when p_action='complete_follow_up' then 'Synthetic follow-up result' end,case when p_action='cancel_follow_up' then 'Synthetic cancellation evidence' end,p_key)r;
$$;

select ok(not has_table_privilege('authenticated','public.psychosocial_assessment_versions','select,insert,update,delete') and not has_table_privilege('authenticated','public.social_work_service_record_versions','select,insert,update,delete'),'no direct clinical table grants');
select ok(not has_function_privilege('authenticated','private.social_work_permission(uuid,uuid,text)','execute'),'private capability helper not browser executable');
select ok(not has_function_privilege('anon','public.social_work_recent_aal2_evidence(uuid,uuid)','execute') and not has_function_privilege('service_role','public.social_work_recent_aal2_evidence(uuid,uuid)','execute'),'self evidence excludes anonymous/service roles');
select ok(not(select prosecdef from pg_proc where oid='public.social_work_recent_aal2_evidence(uuid,uuid)'::regprocedure),'evidence public wrapper remains invoker');
select pg_temp.referral_login();set local role authenticated;
select is(public.is_staff_login_allowed(),true,'actual owner-approved non-CEO Google staff admitted');
select is(public.has_recent_aal2(15),false,'global executive recent evidence unchanged');
select is(public.can_begin_staff_mfa(),true,'real approved staff MFA acquisition available');
select is((select count(*) from jsonb_object_keys(public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'))),4::bigint,'strict exact four-field scoped evidence');
select is((public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')->>'verifiedAt')::timestamptz,to_timestamp(current_setting('test.referral_totp')::bigint),'real consumed evidence time retained');
select is(public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003'),null::jsonb,'approval pinned org not widened by second membership');

select is((select jsonb_array_length(client_options) from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001',null,null,null,'all')),1,'ps: assigned clients only');
select lives_ok($$insert into referral_admission_data select 'ps-create',pg_temp.social_write('ps','create','dcd00000-0000-4000-8000-000000000001')$$,'ps: non-CEO draft create');
select is(pg_temp.social_write('ps','create','dcd00000-0000-4000-8000-000000000001')->>'replayed','true','ps: exact key/body replays');
select throws_ok($$select pg_temp.social_write('ps','create','dcd00000-0000-4000-8000-000000000001',null,'dcb00000-0000-4000-8000-000000000001','Changed content')$$,'23505',null,'ps: changed body same key rejected');
select lives_ok($$insert into referral_admission_data select 'ps-revise',pg_temp.social_write('ps','revise','dcd00000-0000-4000-8000-000000000002',(select v from referral_admission_data where k='ps-create'))$$,'ps: draft revision');
select lives_ok($$insert into referral_admission_data select 'ps-sign',pg_temp.social_write('ps','sign','dcd00000-0000-4000-8000-000000000003',(select v from referral_admission_data where k='ps-revise'))$$,'ps: real scoped MFA sign');
select is(pg_temp.social_write('ps','sign','dcd00000-0000-4000-8000-000000000003',(select v from referral_admission_data where k='ps-revise'))->>'replayed','true','ps: sign replay retained');
select lives_ok($$insert into referral_admission_data select 'ps-correct',pg_temp.social_write('ps','correct','dcd00000-0000-4000-8000-000000000004',(select v from referral_admission_data where k='ps-sign'))$$,'ps: append-only correction');
select is((select(v->>'assessment_version')::integer from referral_admission_data where k='ps-correct'),4,'ps: exact four-version chain');
select throws_ok($$select pg_temp.social_write('ps','revise','dcd00000-0000-4000-8000-000000000005',(select v from referral_admission_data where k='ps-create'))$$,'40001',null,'ps: stale predecessor rejected');
select throws_ok($$select pg_temp.social_write('ps','create','dcd00000-0000-4000-8000-000000000006',null,'dcb00000-0000-4000-8000-000000000003')$$,'42501',null,'ps: unassigned client write denied');
select throws_ok($$select * from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003',null,null,null,'all')$$,'42501',null,'ps: second org denied');

select is((select jsonb_array_length(client_options) from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001',null,null,null,null,null)),1,'sw: assigned clients only');
select lives_ok($$insert into referral_admission_data select 'sw-create',pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011')$$,'sw: non-CEO draft create');
select is(pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011')->>'replayed','true','sw: exact key/body replays');
select throws_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011',null,'dcb00000-0000-4000-8000-000000000001','Changed content')$$,'23505',null,'sw: changed body same key rejected');
select lives_ok($$insert into referral_admission_data select 'sw-revise',pg_temp.social_write('sw','revise','dcd00000-0000-4000-8000-000000000012',(select v from referral_admission_data where k='sw-create'))$$,'sw: draft revision');
select lives_ok($$insert into referral_admission_data select 'sw-sign',pg_temp.social_write('sw','sign','dcd00000-0000-4000-8000-000000000013',(select v from referral_admission_data where k='sw-revise'))$$,'sw: real scoped MFA sign');
select is(pg_temp.social_write('sw','sign','dcd00000-0000-4000-8000-000000000013',(select v from referral_admission_data where k='sw-revise'))->>'replayed','true','sw: sign replay retained');
select lives_ok($$insert into referral_admission_data select 'sw-correct',pg_temp.social_write('sw','correct','dcd00000-0000-4000-8000-000000000014',(select v from referral_admission_data where k='sw-sign'))$$,'sw: append-only correction');
select is((select(v->>'record_version')::integer from referral_admission_data where k='sw-correct'),4,'sw: exact four-version chain');
select throws_ok($$select pg_temp.social_write('sw','revise','dcd00000-0000-4000-8000-000000000015',(select v from referral_admission_data where k='sw-create'))$$,'40001',null,'sw: stale predecessor rejected');
select throws_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000016',null,'dcb00000-0000-4000-8000-000000000003')$$,'42501',null,'sw: unassigned client write denied');
select throws_ok($$select * from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003',null,null,null,null,null)$$,'42501',null,'sw: second org denied');

select lives_ok($$insert into referral_admission_data select 'follow-track',pg_temp.social_follow('track','dcd00000-0000-4000-8000-000000000021',(select v from referral_admission_data where k='sw-correct'))$$,'signed record follow-up tracking');
select lives_ok($$select pg_temp.social_follow('complete_follow_up','dcd00000-0000-4000-8000-000000000022',(select v from referral_admission_data where k='sw-correct'),1)$$,'follow-up complete human result');
select lives_ok($$select pg_temp.social_follow('track','dcd00000-0000-4000-8000-000000000023',(select v from referral_admission_data where k='sw-correct'),2)$$,'new follow-up after completed');
select lives_ok($$select pg_temp.social_follow('cancel_follow_up','dcd00000-0000-4000-8000-000000000024',(select v from referral_admission_data where k='sw-correct'),3)$$,'follow-up cancellation needs reason');
select is(pg_temp.social_follow('cancel_follow_up','dcd00000-0000-4000-8000-000000000024',(select v from referral_admission_data where k='sw-correct'),3)->>'replayed','true','follow-up exact replay');
reset role;
insert into public.membership_roles(membership_id,role_id,assigned_at)select 'dc700000-0000-4000-8000-000000000001',id,clock_timestamp()+interval '1 hour' from public.roles where role_key='organization_manager' and is_system;
set local role authenticated;
select is((select jsonb_array_length(client_options) from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),1,'future extra manager cannot expose unassigned PS client');
select is((select jsonb_array_length(client_options) from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),1,'future extra manager cannot expose unassigned SW client');
reset role;update public.membership_roles set assigned_at=clock_timestamp()-interval '1 minute' where membership_id='dc700000-0000-4000-8000-000000000001';set local role authenticated;
select is((select jsonb_array_length(client_options) from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),2,'effective manager union legitimately preserved');
reset role;delete from public.membership_roles where membership_id='dc700000-0000-4000-8000-000000000001' and role_id in(select id from public.roles where role_key='organization_manager' and is_system);
update public.role_permissions set granted_at=clock_timestamp()+interval '1 hour' where role_id in(select id from public.roles where role_key='case_manager_social_worker' and is_system) and permission_id in(select id from public.permissions where permission_key='social_work_records.read');
set local role authenticated;
select throws_ok($$select * from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'future read grant PS denied');
select throws_ok($$select * from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'future read grant SW denied');
reset role;update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute' where permission_id in(select id from public.permissions where permission_key='social_work_records.read');
update public.role_permissions set granted_at=clock_timestamp()+interval '1 hour' where role_id in(select id from public.roles where role_key='case_manager_social_worker' and is_system) and permission_id in(select id from public.permissions where permission_key='social_work_records.sign');set local role authenticated;
select is(public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'future sign grant cannot confer scoped evidence');
select throws_ok($$select pg_temp.social_write('ps','sign','dcd00000-0000-4000-8000-000000000003',(select v from referral_admission_data where k='ps-revise'))$$,'42501',null,'future sign PS replay denied');
select throws_ok($$select pg_temp.social_write('sw','sign','dcd00000-0000-4000-8000-000000000013',(select v from referral_admission_data where k='sw-revise'))$$,'42501',null,'future sign SW replay denied');
reset role;update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute' where permission_id in(select id from public.permissions where permission_key='social_work_records.sign');
update private.reauth_events set revoked_at=clock_timestamp() where user_id='dc100000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.social_write('ps','sign','dcd00000-0000-4000-8000-000000000003',(select v from referral_admission_data where k='ps-revise'))$$,'42501',null,'revoked evidence PS sign replay denied');
select throws_ok($$select pg_temp.social_write('sw','sign','dcd00000-0000-4000-8000-000000000013',(select v from referral_admission_data where k='sw-revise'))$$,'42501',null,'revoked evidence SW sign replay denied');
select is(pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011')->>'replayed','true','draft replay preserves original non-recent AAL2 policy');
reset role;update private.reauth_events set revoked_at=null where user_id='dc100000-0000-4000-8000-000000000001';
reset role;update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.social_write('ps')$$,'42501',null,'assignment revoke PS exact replay denied');
select throws_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011')$$,'42501',null,'assignment revoke SW exact replay denied');
reset role;update public.client_assignments set ends_at=null where id='dcc00000-0000-4000-8000-000000000001';
reset role;update private.staff_google_access_grants set enabled=false where allowed_user_id='dc100000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.social_write('ps')$$,'42501',null,'grant revoke PS exact replay denied');
select throws_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011')$$,'42501',null,'grant revoke SW exact replay denied');
reset role;update private.staff_google_access_grants set enabled=true where allowed_user_id='dc100000-0000-4000-8000-000000000001';
reset role;update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='dc300000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.social_write('ps')$$,'42501',null,'session revoke PS exact replay denied');
select throws_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000011')$$,'42501',null,'session revoke SW exact replay denied');
reset role;update auth.sessions set not_after=null where id='dc300000-0000-4000-8000-000000000001';

select pg_temp.referral_login(1,'aal1');set local role authenticated;
select throws_ok($$select * from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'PS original AAL2 read boundary retained');
select throws_ok($$select * from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'SW original AAL2 read boundary retained');
select is(public.can_begin_staff_mfa(),true,'AAL1 real MFA acquisition possible');
reset role;set local role service_role;
select * from public.issue_aal2_reauth_challenge('dc800000-0000-4000-8000-000000000099','dc100000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',repeat('f',64),'dc900000-0000-4000-8000-000000000099',clock_timestamp()-interval '60 seconds','synthetic-prior',300);
reset role;select set_config('test.referral_totp',floor(extract(epoch from clock_timestamp()))::text,true);
update auth.mfa_amr_claims set updated_at=to_timestamp(current_setting('test.referral_totp')::bigint) where session_id='dc300000-0000-4000-8000-000000000001' and authentication_method='totp';
select pg_temp.referral_login();set local role authenticated;
select is(public.record_aal2_reauth('dc800000-0000-4000-8000-000000000099',repeat('f',64)),true,'actual consumed fresh challenge accepted');
select is(public.record_aal2_reauth('dc800000-0000-4000-8000-000000000099',repeat('f',64)),false,'consumed challenge cannot replay');
select is((public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')->>'verifiedAt')::timestamptz,to_timestamp(current_setting('test.referral_totp')::bigint),'acquired real factor timestamp reaches shared social evidence');
reset role;
select is((select count(*) from public.psychosocial_assessment_versions where organization_id='dc500000-0000-4000-8000-000000000001'),4::bigint,'PS denied writes never append');
select is((select count(*) from public.social_work_service_record_versions where organization_id='dc500000-0000-4000-8000-000000000001'),4::bigint,'SW denied writes never append');
select is((select count(*) from public.social_work_follow_up_events where organization_id='dc500000-0000-4000-8000-000000000001'),4::bigint,'follow-up immutable history complete');

create function pg_temp.ps_revoke_snapshot()returns trigger language plpgsql as $$begin if new.action='select' and new.table_name='psychosocial_assessment_versions' then update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';end if;return new;end;$$;
create trigger synthetic_ps_revoke_snapshot before insert on public.audit_events for each row execute function pg_temp.ps_revoke_snapshot();
set local role authenticated;
select throws_ok($$select * from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'ps: post-audit visibility revoke denies whole snapshot');
reset role;
select is((select ends_at from public.client_assignments where id='dcc00000-0000-4000-8000-000000000001'),null::timestamptz,'ps: failed snapshot rolls back injected revoke');
drop trigger synthetic_ps_revoke_snapshot on public.audit_events;
create function pg_temp.ps_revoke_version()returns trigger language plpgsql as $$begin update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';return new;end;$$;
create trigger synthetic_ps_revoke_version after insert on public.psychosocial_assessment_versions for each row execute function pg_temp.ps_revoke_version();
set local role authenticated;
select throws_ok($$select pg_temp.social_write('ps','create','dcd00000-0000-4000-8000-000000000070')$$,'42501',null,'ps: post-version revoke denies entire transaction');
reset role;
select is((select count(*) from public.psychosocial_assessment_versions where organization_id='dc500000-0000-4000-8000-000000000001'),4::bigint,'ps: no partial clinical version');
drop trigger synthetic_ps_revoke_version on public.psychosocial_assessment_versions;

create function pg_temp.sw_revoke_snapshot()returns trigger language plpgsql as $$begin if new.action='select' and new.table_name='social_work_service_record_versions' then update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';end if;return new;end;$$;
create trigger synthetic_sw_revoke_snapshot before insert on public.audit_events for each row execute function pg_temp.sw_revoke_snapshot();
set local role authenticated;
select throws_ok($$select * from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'sw: post-audit visibility revoke denies whole snapshot');
reset role;
select is((select ends_at from public.client_assignments where id='dcc00000-0000-4000-8000-000000000001'),null::timestamptz,'sw: failed snapshot rolls back injected revoke');
drop trigger synthetic_sw_revoke_snapshot on public.audit_events;
create function pg_temp.sw_revoke_version()returns trigger language plpgsql as $$begin update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';return new;end;$$;
create trigger synthetic_sw_revoke_version after insert on public.social_work_service_record_versions for each row execute function pg_temp.sw_revoke_version();
set local role authenticated;
select throws_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000071')$$,'42501',null,'sw: post-version revoke denies entire transaction');
reset role;
select is((select count(*) from public.social_work_service_record_versions where organization_id='dc500000-0000-4000-8000-000000000001'),4::bigint,'sw: no partial clinical version');
drop trigger synthetic_sw_revoke_version on public.social_work_service_record_versions;

-- Matching factor/event timestamps still cannot provide proof before server
-- wall clock. Reuse the actual stored challenge, not a predicate replacement.
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 values('dc800000-0000-4000-8000-000000000088','dc100000-0000-4000-8000-000000000002','dc300000-0000-4000-8000-000000000002',repeat('e',64),'dc900000-0000-4000-8000-000000000088',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '4 minutes',clock_timestamp(),clock_timestamp(),'totp',clock_timestamp()+interval '30 seconds');
update private.reauth_events set challenge_id='dc800000-0000-4000-8000-000000000088',verified_at=(select factor_verified_at from private.reauth_challenges where id='dc800000-0000-4000-8000-000000000088') where user_id='dc100000-0000-4000-8000-000000000002';
select pg_temp.referral_login(2);set local role authenticated;
select is(public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'matching future factor/event is not current evidence');
reset role;select pg_temp.referral_login(1);
select throws_ok($$update private.reauth_challenges set invalidated_at=clock_timestamp() where id='dc800000-0000-4000-8000-000000000099'$$,'55000',null,'terminal consumed challenge remains immutable');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,invalidated_at,invalidation_reason)
 values('dc800000-0000-4000-8000-000000000087','dc100000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',repeat('d',64),'dc900000-0000-4000-8000-000000000087',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '4 minutes',clock_timestamp(),'Synthetic invalidation');
update private.reauth_events set challenge_id='dc800000-0000-4000-8000-000000000087' where user_id='dc100000-0000-4000-8000-000000000001';set local role authenticated;
select is(public.social_work_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'invalidated unconsumed challenge evidence hidden');
select throws_ok($$select pg_temp.social_write('sw','sign','dcd00000-0000-4000-8000-000000000013',(select v from referral_admission_data where k='sw-revise'))$$,'42501',null,'invalidated challenge denies exact signed replay');
reset role;update private.reauth_events set challenge_id='dc800000-0000-4000-8000-000000000099' where user_id='dc100000-0000-4000-8000-000000000001';
update public.memberships set starts_at=clock_timestamp()+interval '1 hour' where id='dc700000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select * from public.social_work_service_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'future membership cannot enter scope');
reset role;update public.memberships set starts_at=clock_timestamp()-interval '1 minute' where id='dc700000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='dc600000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select * from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'inactive branch cannot return individual assessment');
reset role;update public.branches set is_active=true where id='dc600000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{}',true);
update public.profiles set kind='professional' where id='dc100000-0000-4000-8000-000000000001';select pg_temp.referral_login(1);set local role authenticated;
select lives_ok($$select * from public.psychosocial_assessment_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'professional profile with same actual effective capabilities retained');
reset role;select set_config('request.jwt.claims','{}',true);update public.profiles set kind='staff' where id='dc100000-0000-4000-8000-000000000001';
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)values('dc100000-0000-4000-8000-000000000003','social-worker-3@referral.example.invalid','synthetic-referral-google-3',true,'Synthetic executive control');
select set_config('test.referral_totp',(select floor(extract(epoch from updated_at))::text from auth.mfa_amr_claims where session_id='dc300000-0000-4000-8000-000000000003' and authentication_method='totp'),true);
select pg_temp.referral_login(3);set local role authenticated;
select is(public.is_executive_login_allowed(),true,'original legal executive admission retained');
select is(public.has_recent_aal2(15),true,'original executive generic MFA retained');
select lives_ok($$select pg_temp.social_write('ps','create','dcd00000-0000-4000-8000-000000000089')$$,'executive scoped PS write retained');
select lives_ok($$select pg_temp.social_write('sw','create','dcd00000-0000-4000-8000-000000000090')$$,'executive scoped SW write retained');
reset role;
select * from finish();rollback;
