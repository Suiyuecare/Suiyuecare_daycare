begin;
-- Actual admitted Google identity and recent MFA; no authorization shims.
select plan(32);
reset role;
select set_config('test.weekly_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values('c2100000-0000-4000-8000-000000000001','authenticated','authenticated','weekly-manager@example.invalid',now(),now(),now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values(gen_random_uuid(),'weekly-manager','c2100000-0000-4000-8000-000000000001','{"sub":"weekly-manager","email":"weekly-manager@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values('c2200000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'c2200000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.weekly_amr')::bigint),to_timestamp(current_setting('test.weekly_amr')::bigint),method from unnest(array['oauth','totp'])method;
insert into public.organizations(id,code,name) values('c2300000-0000-4000-8000-000000000001','weekly-synthetic','合成機構');
insert into public.branches(id,organization_id,code,name) values('c2400000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','main','合成分支');
insert into public.profiles(id,display_name,kind) values('c2100000-0000-4000-8000-000000000001','合成主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values('c2500000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values('c2500000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values('c2600000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-1','合成個案',(now() at time zone 'Asia/Taipei')::date);
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('c2700000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001','c2200000-0000-4000-8000-000000000001',repeat('1',64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values('c2100000-0000-4000-8000-000000000001','c2200000-0000-4000-8000-000000000001','c2700000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');
select set_config('request.jwt.claims',jsonb_build_object('sub','c2100000-0000-4000-8000-000000000001','session_id','c2200000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,'email','weekly-manager@example.invalid','iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.weekly_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.weekly_amr')::bigint)))::text,true);

insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('c2100000-0000-4000-8000-000000000001','weekly-manager@example.invalid','weekly-manager',true,'synthetic lifecycle active scope test');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
('c2600000-0000-4000-8000-000000000002','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-2','合成待收案一',null),
('c2600000-0000-4000-8000-000000000003','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-3','合成待收案二',null);
create function pg_temp.lifecycle_action(p_client uuid default 'c2600000-0000-4000-8000-000000000002',p_kind public.client_transition_kind default 'admit',p_key uuid default 'cb100000-0000-4000-8000-000000000001',p_version bigint default 1) returns jsonb language sql as $$
 select to_jsonb(t) from public.transition_client(
 'c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',p_client,p_kind,
 (now() at time zone 'Asia/Taipei')::date,'合成明確生命週期操作',null,p_version,p_key)t;
$$;
create function pg_temp.lifecycle_insert() returns void language sql as $$
 insert into public.client_transitions(client_id,event_kind,effective_on,reason,base_row_version,idempotency_key,actor_user_id)
 values('c2600000-0000-4000-8000-000000000003','admit',(now() at time zone 'Asia/Taipei')::date,'合成內部觸發器防線',1,gen_random_uuid(),auth.uid());
$$;
select ok(not (select prosecdef from pg_proc where oid='public.transition_client(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)'::regprocedure),'public lifecycle RPC remains security invoker');
select ok(not (select prosecdef from pg_proc where oid='private.validate_client_transition()'::regprocedure),'validation trigger remains security invoker');
select ok(not has_function_privilege('anon','public.transition_client(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)','execute'),'anonymous transition execution remains denied');
select ok(not has_table_privilege('authenticated','public.client_transitions','insert,update,delete'),'staff cannot bypass transition RPC');
select ok(not has_table_privilege('service_role','public.client_transitions','insert,update,delete'),'service key cannot forge transitions');
set local role authenticated;
select is(pg_temp.lifecycle_action()->>'replayed','false','live scope plus admitted Google and MFA can explicitly admit');
select is(pg_temp.lifecycle_action()->>'replayed','true','live scope replays the same receipt');
reset role;
select is((select count(*)::integer from public.client_transitions),1,'one original receipt is one immutable transition');
select is((select row_version from public.clients where client_code='C-2'),2::bigint,'explicit admission advanced client version exactly once');
update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle_action()$$,'42501',null,'disabled organization rejects fast receipt replay');
select throws_ok($$select pg_temp.lifecycle_action('c2600000-0000-4000-8000-000000000003','admit',gen_random_uuid())$$,'42501',null,'disabled organization rejects new admission');
select throws_ok($$select pg_temp.lifecycle_action('c2600000-0000-4000-8000-000000000001','suspend',gen_random_uuid())$$,'42501',null,'disabled organization rejects other lifecycle writes');
reset role;
select throws_ok($$select pg_temp.lifecycle_insert()$$,'42501',null,'trigger blocks internal ledger insertion for disabled organization');
select is((select count(*)::integer from public.client_transitions),1,'disabled organization attempts create zero transitions');
select is((select row_version from public.clients where client_code='C-3'),1::bigint,'disabled organization leaves pending client version unchanged');
select is((select admitted_on from public.clients where client_code='C-3'),null::date,'disabled organization does not admit pending client');
select is((select status::text from public.clients where client_code='C-1'),'active','disabled organization failure does not suspend active client');
update public.organizations set is_active=true where id='c2300000-0000-4000-8000-000000000001';
update public.branches set is_active=false where id='c2400000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle_action()$$,'42501',null,'disabled branch rejects fast receipt replay');
select throws_ok($$select pg_temp.lifecycle_action('c2600000-0000-4000-8000-000000000003','admit',gen_random_uuid())$$,'42501',null,'disabled branch rejects new admission');
select throws_ok($$select pg_temp.lifecycle_action('c2600000-0000-4000-8000-000000000001','suspend',gen_random_uuid())$$,'42501',null,'disabled branch rejects other lifecycle writes');
reset role;
select throws_ok($$select pg_temp.lifecycle_insert()$$,'42501',null,'trigger blocks internal ledger insertion for disabled branch');
select is((select count(*)::integer from public.client_transitions),1,'disabled branch attempts create zero transitions');
select is((select row_version from public.clients where client_code='C-3'),1::bigint,'disabled branch leaves pending client version unchanged');
select is((select admitted_on from public.clients where client_code='C-3'),null::date,'disabled branch does not admit pending client');
select is((select row_version from public.clients where client_code='C-1'),1::bigint,'blocked suspension leaves active client version unchanged');
update public.branches set is_active=true where id='c2400000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.lifecycle_action()->>'replayed','true','restoring live scope permits receipt replay without a new admission');
select throws_ok($$select * from public.transition_client('c2300000-0000-4000-8000-000000000001',gen_random_uuid(),'c2600000-0000-4000-8000-000000000003','admit',current_date,'合成跨分支請求',null,1,gen_random_uuid())$$,'42501',null,'fake branch cannot borrow active organization');
reset role;
select set_config('test.active_scope_claims',current_setting('request.jwt.claims'),true);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{aal}','"aal1"')::text,true);
set local role authenticated;
select is(pg_temp.lifecycle_action()->>'replayed','true','approved Google AAL1 may replay explicit admission under its separate routine policy');
reset role;
select set_config('request.jwt.claims',current_setting('test.active_scope_claims'),true);
update public.memberships set status='suspended' where id='c2500000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle_action()$$,'42501',null,'revoked membership cannot replay old receipt');
reset role;
select is((select count(*)::integer from public.client_transitions),1,'all denied writes and all replays leave exactly one transition');
select is((select sum(row_version)::bigint from public.clients where organization_id='c2300000-0000-4000-8000-000000000001'),4::bigint,'denied operations advance no client row versions');
select is((select count(*)::integer from public.attendance_records where organization_id='c2300000-0000-4000-8000-000000000001'),0,'lifecycle validation creates no attendance evidence');
select * from finish();
rollback;
