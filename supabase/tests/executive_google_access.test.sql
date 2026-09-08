begin;
select plan(115);

-- Full production migration, without the legacy PGlite admission override.
-- No real account, provider subject, token, password, or family data is used.
select set_config('test.executive_amr_at', floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text, true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('90100000-0000-4000-8000-000000000001','authenticated','authenticated','executive@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('90100000-0000-4000-8000-000000000002','authenticated','authenticated','other@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('90200000-0000-4000-8000-000000000001','synthetic-google-executive','90100000-0000-4000-8000-000000000001','{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}','google'),
 ('90200000-0000-4000-8000-000000000002','synthetic-google-other','90100000-0000-4000-8000-000000000002','{"sub":"synthetic-google-other","email":"other@example.invalid","email_verified":true}','google'),
 ('90200000-0000-4000-8000-000000000003','executive@example.invalid','90100000-0000-4000-8000-000000000001','{"email":"executive@example.invalid","email_verified":true}','email');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('90300000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2'),
 ('90300000-0000-4000-8000-000000000002','90100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('90400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (case when n<=2 then '90300000-0000-4000-8000-000000000001' else '90300000-0000-4000-8000-000000000002' end)::uuid,
 to_timestamp(current_setting('test.executive_amr_at')::bigint),to_timestamp(current_setting('test.executive_amr_at')::bigint),
 case when n%2=1 then 'oauth' else 'totp' end from generate_series(1,4) n;
insert into public.organizations(id,code,name) values
 ('90500000-0000-4000-8000-000000000001','executive_gate_test','合成驗證機構'),
 ('90500000-0000-4000-8000-000000000002','executive_gate_other','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('90600000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001','main','合成分支'),
 ('90600000-0000-4000-8000-000000000002','90500000-0000-4000-8000-000000000002','main','合成其他分支');
insert into public.profiles(id,display_name,kind) values
 ('90100000-0000-4000-8000-000000000001','合成執行長','staff'),
 ('90100000-0000-4000-8000-000000000002','合成其他管理員','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values
 ('90700000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('90700000-0000-4000-8000-000000000002','90500000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000002','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
select id,'10000000-0000-4000-8000-000000000002' from public.memberships where organization_id='90500000-0000-4000-8000-000000000001';
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('90800000-0000-4000-8000-000000000001','90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','SYN-GATE-1','合成個案');

create function pg_temp.executive_check(p_overrides jsonb default '{}', p_aal text default 'aal2')
returns boolean language plpgsql security invoker as $$
declare v_amr jsonb;
begin
 v_amr:=jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.executive_amr_at')::bigint));
 if p_aal='aal2' then v_amr:=v_amr||jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.executive_amr_at')::bigint)); end if;
 perform set_config('request.jwt.claims',(jsonb_build_object(
  'sub','90100000-0000-4000-8000-000000000001','session_id','90300000-0000-4000-8000-000000000001',
  'aud','authenticated','role','authenticated','aal',p_aal,'is_anonymous',false,'email','executive@example.invalid',
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',v_amr)||p_overrides)::text,true);
 return public.is_executive_login_allowed();
end;
$$;

select is((select count(*)::integer from private.executive_access_policy),0,'production migration does not seed an executive account');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.executive_access_policy'::regclass),'allowlist has forced RLS');
select ok(not has_table_privilege('authenticated','private.executive_access_policy','select,insert,update,delete')
 and not has_table_privilege('service_role','private.executive_access_policy','select,insert,update,delete'),'API roles cannot read or edit allowlist');
select ok(not has_table_privilege('authenticated','auth.users','select') and not has_table_privilege('authenticated','auth.identities','select')
 and not has_table_privilege('authenticated','auth.sessions','select') and not has_table_privilege('authenticated','auth.mfa_amr_claims','select'),'no direct Auth metadata grants');
select ok(not has_table_privilege('service_role','auth.identities','select') and not has_table_privilege('service_role','auth.mfa_amr_claims','select'),'server role receives no new Auth table grants');
select ok(has_function_privilege('authenticated','public.is_executive_login_allowed()','execute')
 and not has_function_privilege('anon','public.is_executive_login_allowed()','execute')
 and not has_function_privilege('service_role','public.is_executive_login_allowed()','execute'),'only authenticated invokes self-only public admission');
select ok((select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='private.is_executive_login_allowed()'::regprocedure)
 and not (select prosecdef from pg_proc where oid='public.is_executive_login_allowed()'::regprocedure),'private owner helper and public invoker preserve privilege boundary');
set local role anon;
select throws_ok($$select public.is_executive_login_allowed()$$,'42501',null,'anonymous cannot call admission RPC');
reset role;
set local role authenticated;
select is(pg_temp.executive_check(),false,'valid Google identity with no policy fails closed');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('90100000-0000-4000-8000-000000000001','executive@example.invalid','synthetic-google-executive',true,'synthetic focused test approval');
select throws_ok($$insert into private.executive_access_policy(id,allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values(false,'90100000-0000-4000-8000-000000000002','other@example.invalid','synthetic-google-other',true,'invalid second principal')$$,'23514',null,'second singleton slot cannot be provisioned');
select throws_ok($$insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('90100000-0000-4000-8000-000000000002','other@example.invalid','synthetic-google-other',true,'invalid duplicate principal')$$,'23505',null,'second executive cannot be added');
set local role authenticated;
select is(pg_temp.executive_check('{}','aal1'),true,'pinned Google session may enter AAL1 MFA flow despite residual email identity');
select is(public.can_begin_staff_mfa(),true,'eligible executive AAL1 can request existing MFA challenge');
select is((select count(*)::integer from public.active_memberships),0,'AAL1 still cannot read tenant context');
select is(pg_temp.executive_check(),true,'matching Google plus TOTP session is admitted');
select is((select count(*)::integer from public.active_memberships),1,'AAL2 reads only the existing assigned organization');
select throws_ok($$select * from private.executive_access_policy$$,'42501',null,'allowlist cannot be enumerated through SQL role');
select throws_ok($$update private.executive_access_policy set enabled=false$$,'42501',null,'authenticated cannot disable admission enforcement');
select is(public.has_recent_aal2(15),false,'Google admission does not fabricate recent MFA signature evidence');
select is(public.record_aal2_reauth('90900000-0000-4000-8000-000000000001',repeat('a',64)),false,'admitted login cannot consume a fabricated challenge');
select lives_ok($$select public.nursing_assessment_snapshot('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001')$$,'CEO retains permitted nursing read');
select throws_ok($$select public.nursing_assessment_snapshot('90500000-0000-4000-8000-000000000002','90600000-0000-4000-8000-000000000002')$$,'42501',null,'CEO admission does not grant another organization');
select throws_ok($$select public.mutate_nursing_assessment('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001',
 '{"action":"create_draft","clientId":"90800000-0000-4000-8000-000000000001","content":{}}','90900000-0000-4000-8000-000000000002')$$,
 '42501','nursing operation is not permitted','CEO is not silently promoted to an assigned qualified nurse');

-- Direct RPC claim matrix: no browser routing assumptions.
select is(pg_temp.executive_check('{"sub":"90100000-0000-4000-8000-000000000002"}'),false,'JWT subject must be the pinned Auth UUID');
select is(pg_temp.executive_check('{"email":"other@example.invalid"}'),false,'JWT email must match the owner verified allowlist');
select is(pg_temp.executive_check('{"session_id":"90300000-0000-4000-8000-000000000002"}'),false,'JWT session must belong to the pinned user');
select is(pg_temp.executive_check('{"session_id":"90300000-0000-4000-8000-000000000009"}'),false,'unknown session is rejected');
select is(pg_temp.executive_check('{"sub":"malformed"}'),false,'malformed subject denies without exposing a cast error');
select is(pg_temp.executive_check('{"sub":null}'),false,'missing subject denies');
select is(pg_temp.executive_check('{"session_id":"malformed"}'),false,'malformed session denies');
select is(pg_temp.executive_check('{"role":"service_role"}'),false,'service role token cannot enter executive login');
select is(pg_temp.executive_check('{"aud":"other"}'),false,'wrong audience is rejected');
select is(pg_temp.executive_check('{"aal":null}'),false,'missing AAL is rejected');
select is(pg_temp.executive_check('{"is_anonymous":true}'),false,'anonymous claim is rejected');
select is(pg_temp.executive_check('{"is_anonymous":null}'),false,'missing anonymous evidence fails closed');
select is(pg_temp.executive_check('{"is_anonymous":"false"}'),false,'string anonymous flag is not trusted');
select is(pg_temp.executive_check('{"client_id":"synthetic-third-party"}'),false,'OAuth server client tokens are rejected');
select is(pg_temp.executive_check('{"client_id":null}'),false,'even null OAuth client claim is rejected');
select is(pg_temp.executive_check('{"iat":null}'),false,'missing issued time is rejected');
select is(pg_temp.executive_check('{"iat":"123"}'),false,'string issued time is rejected');
select is(pg_temp.executive_check('{"iat":123.5}'),false,'fractional issued time is rejected');
select is(pg_temp.executive_check('{"iat":999999999999999999999}'),false,'oversized issued time is rejected');
select is(pg_temp.executive_check(jsonb_build_object('iat',floor(extract(epoch from clock_timestamp()-interval '2 hours')))),false,'stale access token is rejected');
select is(pg_temp.executive_check(jsonb_build_object('iat',floor(extract(epoch from clock_timestamp()+interval '2 minutes')))),false,'future issued token is rejected');
select is(pg_temp.executive_check(jsonb_build_object('exp',floor(extract(epoch from clock_timestamp()-interval '1 minute')))),false,'expired access token is rejected');
select is(pg_temp.executive_check(jsonb_build_object('iat',floor(extract(epoch from clock_timestamp()+interval '20 seconds')),'exp',floor(extract(epoch from clock_timestamp()+interval '10 seconds')))),false,'expiry before issuance is rejected');
select is(pg_temp.executive_check('{"amr":null}'),false,'missing AMR cannot infer OAuth from Google identity');
select is(pg_temp.executive_check('{"amr":[]}'),false,'empty AMR cannot infer OAuth from Google identity');
select is(pg_temp.executive_check('{"amr":["oauth"]}'),false,'nonobject AMR entry is rejected');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'missing AMR method is rejected');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.executive_amr_at')::bigint-1)))),false,'unverified AMR timestamp is rejected');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.executive_amr_at'))))),false,'string AMR timestamp is rejected');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'AAL2 requires actual TOTP claim');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'TOTP alone does not prove Google login');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'password login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'otp login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','recovery','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'recovery login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','magiclink','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'magiclink login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','sso/saml','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'sso/saml login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','anonymous','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'anonymous login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','invite','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'invite login method is denied even with a linked Google identity');
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','mfa/phone','timestamp',current_setting('test.executive_amr_at')::bigint)))),false,'mfa/phone login method is denied even with a linked Google identity');

-- Owner fixture mutations simulate revocation/provider changes; each is restored.
reset role;
update private.executive_access_policy set enabled=false;
set local role authenticated;
select is(pg_temp.executive_check(),false,'disabled owner policy immediately denies');
reset role;
update private.executive_access_policy set enabled=true;

update private.executive_access_policy set google_subject='different-subject';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed pinned subject denies existing session');
reset role;
update private.executive_access_policy set google_subject='synthetic-google-executive';

update private.executive_access_policy set allowed_email='changed@example.invalid';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed pinned email denies existing session');
reset role;
update private.executive_access_policy set allowed_email='executive@example.invalid';

update private.executive_access_policy set approved_at=now()+interval '1 day';
set local role authenticated;
select is(pg_temp.executive_check(),false,'future approval is not effective');
reset role;
update private.executive_access_policy set approved_at=now()-interval '1 minute';

update private.executive_access_policy set allowed_user_id='90100000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed pinned UUID denies existing session');
reset role;
update private.executive_access_policy set allowed_user_id='90100000-0000-4000-8000-000000000001';

update auth.users set banned_until=now()+interval '1 day' where id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'banned account denies');
reset role;
update auth.users set banned_until=null where id='90100000-0000-4000-8000-000000000001';

update auth.users set deleted_at=now() where id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'deleted account denies');
reset role;
update auth.users set deleted_at=null where id='90100000-0000-4000-8000-000000000001';

update auth.users set email_confirmed_at=null where id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'unconfirmed account denies');
reset role;
update auth.users set email_confirmed_at=now()-interval '1 day' where id='90100000-0000-4000-8000-000000000001';

update auth.users set email='changed@example.invalid' where id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed Auth email denies despite unchanged token');
reset role;
update auth.users set email='executive@example.invalid' where id='90100000-0000-4000-8000-000000000001';

update auth.users set is_anonymous=true where id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'anonymous Auth account denies despite token claim');
reset role;
update auth.users set is_anonymous=false where id='90100000-0000-4000-8000-000000000001';

update auth.sessions set not_after=now()-interval '1 minute' where id='90300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'session expiry immediately denies');
reset role;
update auth.sessions set not_after=null where id='90300000-0000-4000-8000-000000000001';

update auth.sessions set created_at=null where id='90300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'session with unknown creation denies');
reset role;
update auth.sessions set created_at=now()-interval '3 minutes' where id='90300000-0000-4000-8000-000000000001';

update auth.sessions set created_at=now()+interval '1 day' where id='90300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'future session creation denies');
reset role;
update auth.sessions set created_at=now()-interval '3 minutes' where id='90300000-0000-4000-8000-000000000001';

update auth.sessions set user_id='90100000-0000-4000-8000-000000000002' where id='90300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'session moved to a different user denies');
reset role;
update auth.sessions set user_id='90100000-0000-4000-8000-000000000001' where id='90300000-0000-4000-8000-000000000001';

update auth.sessions set oauth_client_id='90900000-0000-4000-8000-000000000001' where id='90300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'OAuth server session denies even with ordinary claims');
reset role;
update auth.sessions set oauth_client_id=null where id='90300000-0000-4000-8000-000000000001';

update auth.sessions set aal='aal1' where id='90300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'JWT AAL2 cannot exceed actual session assurance');
reset role;
update auth.sessions set aal='aal2' where id='90300000-0000-4000-8000-000000000001';

update auth.identities set provider_id='changed-provider-subject' where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed Google provider subject denies');
reset role;
update auth.identities set provider_id='synthetic-google-executive' where id='90200000-0000-4000-8000-000000000001';

update auth.identities set identity_data=jsonb_set(identity_data,'{sub}','"changed-subject"') where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed Google identity sub denies');
reset role;
update auth.identities set identity_data='{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}'::jsonb where id='90200000-0000-4000-8000-000000000001';

update auth.identities set identity_data=jsonb_set(identity_data,'{email}','"changed@example.invalid"') where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'changed verified Google email denies');
reset role;
update auth.identities set identity_data='{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}'::jsonb where id='90200000-0000-4000-8000-000000000001';

update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'unverified Google email denies');
reset role;
update auth.identities set identity_data='{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}'::jsonb where id='90200000-0000-4000-8000-000000000001';

update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','"true"') where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'string Google verified flag denies');
reset role;
update auth.identities set identity_data='{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}'::jsonb where id='90200000-0000-4000-8000-000000000001';

update auth.identities set provider='email' where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'missing Google identity cannot be replaced by email identity');
reset role;
update auth.identities set provider='google' where id='90200000-0000-4000-8000-000000000001';

update auth.users set raw_user_meta_data='{"provider":"google","email_verified":true,"sub":"synthetic-google-executive"}' where id='90100000-0000-4000-8000-000000000001';
update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where id='90200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(),false,'forged user metadata cannot replace trusted Google verification');
reset role;
update auth.users set raw_user_meta_data=null where id='90100000-0000-4000-8000-000000000001';
update auth.identities set identity_data='{"sub":"synthetic-google-executive","email":"executive@example.invalid","email_verified":true}'::jsonb where id='90200000-0000-4000-8000-000000000001';

insert into auth.identities(id,provider_id,user_id,identity_data,provider) values('90200000-0000-4000-8000-000000000004','synthetic-second-google','90100000-0000-4000-8000-000000000001','{"sub":"synthetic-second-google","email":"executive@example.invalid","email_verified":true}','google');
set local role authenticated;
select is(pg_temp.executive_check(),false,'second Google identity denies ambiguity');
reset role;
delete from auth.identities where id='90200000-0000-4000-8000-000000000004';

insert into auth.identities(id,provider_id,user_id,identity_data,provider) values('90200000-0000-4000-8000-000000000004','synthetic-github','90100000-0000-4000-8000-000000000001','{"sub":"synthetic-github","email":"executive@example.invalid","email_verified":true}','github');
set local role authenticated;
select is(pg_temp.executive_check(),false,'other OAuth identity denies ambiguous current provider');
reset role;
delete from auth.identities where id='90200000-0000-4000-8000-000000000004';

insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values('90400000-0000-4000-8000-000000000005','90300000-0000-4000-8000-000000000001',now(),now(),'password');
set local role authenticated;
select is(pg_temp.executive_check(),false,'stored password AMR denies even when omitted from token');
reset role;
delete from auth.mfa_amr_claims where id='90400000-0000-4000-8000-000000000005';

update auth.mfa_amr_claims set updated_at=updated_at+interval '1 second' where session_id='90300000-0000-4000-8000-000000000001' and authentication_method='oauth';
set local role authenticated;
select is(pg_temp.executive_check(),false,'stale token cannot replay a changed actual OAuth AMR');
reset role;
update auth.mfa_amr_claims set updated_at=to_timestamp(current_setting('test.executive_amr_at')::bigint) where session_id='90300000-0000-4000-8000-000000000001' and authentication_method='oauth';

update auth.mfa_amr_claims set authentication_method='password' where session_id='90300000-0000-4000-8000-000000000001' and authentication_method='oauth';
set local role authenticated;
select is(pg_temp.executive_check(),false,'actual OAuth evidence is required for JWT OAuth');
reset role;
update auth.mfa_amr_claims set authentication_method='oauth' where session_id='90300000-0000-4000-8000-000000000001' and authentication_method='password';

-- Refresh preserves the real OAuth/TOTP origin, without granting other methods.
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values('90400000-0000-4000-8000-000000000005','90300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.executive_amr_at')::bigint),to_timestamp(current_setting('test.executive_amr_at')::bigint),'token_refresh');
update auth.users set raw_app_meta_data='{"provider":"email","providers":["email","google"]}',raw_user_meta_data='{"provider":"not-authoritative"}'
where id='90100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.executive_check(jsonb_build_object('amr',jsonb_build_array(
 jsonb_build_object('method','oauth','timestamp',current_setting('test.executive_amr_at')::bigint),
 jsonb_build_object('method','totp','timestamp',current_setting('test.executive_amr_at')::bigint),
 jsonb_build_object('method','token_refresh','timestamp',current_setting('test.executive_amr_at')::bigint)))),true,
 'real refreshed Google plus TOTP session remains admitted independently of legacy app provider or user metadata');
reset role;
delete from auth.mfa_amr_claims where id='90400000-0000-4000-8000-000000000005';

-- An otherwise valid administrator with a different Google principal is denied
-- at every independent authorization root and directly through public APIs/RLS.
set local role authenticated;
select is(pg_temp.executive_check('{"sub":"90100000-0000-4000-8000-000000000002","session_id":"90300000-0000-4000-8000-000000000002","email":"other@example.invalid"}'),false,
 'another active organization manager with valid Google and TOTP is not admitted');
select is(public.can_begin_staff_mfa(),false,'nonexecutive cannot begin MFA through direct callback RPC');
select is(public.has_recent_aal2(15),false,'nonexecutive cannot claim recent MFA evidence');
select is(public.record_aal2_reauth('90900000-0000-4000-8000-000000000001',repeat('a',64)),false,'nonexecutive cannot consume reauth through direct RPC');
select is((select count(*)::integer from public.active_memberships),0,'nonexecutive cannot enumerate tenant context');
select throws_ok($$select * from public.clients$$,'42501',null,'nonexecutive direct client table access is not granted');
select throws_ok($$select public.nursing_assessment_snapshot('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001')$$,'42501',null,'nonexecutive direct nursing API denies');
select throws_ok($$select public.body_assessment_snapshot('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001')$$,'42501',null,'nonexecutive direct body assessment API denies');
select throws_ok($$select public.data_inventory_snapshot('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001')$$,'42501',null,'nonexecutive direct data inventory API denies');
select throws_ok($$select public.staff_management_snapshot('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001')$$,'42501',null,'nonexecutive direct staff management API denies');
reset role;
select is(private.is_active_user(),false,'shared authorization root rejects nonexecutive');
select is(private.staff_management_current_authority('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001','staff.employment.manage'),false,'independent staff authority rejects nonexecutive');
select is(private.nursing_authority('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001',null,'read'),false,'independent nursing authority rejects nonexecutive');
select is(private.body_assessment_authority('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001',null,'read'),false,'independent body authority rejects nonexecutive');
select is(private.data_inventory_authorized('90500000-0000-4000-8000-000000000001','90600000-0000-4000-8000-000000000001'),false,'independent inventory authority rejects nonexecutive');
select is(private.can_begin_staff_mfa(),false,'pre-MFA authority rejects nonexecutive');
select ok(not has_function_privilege('authenticated','private.nursing_authority(uuid,uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.body_assessment_authority(uuid,uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.staff_management_current_authority(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.data_inventory_authorized(uuid,uuid)','execute'),'replaced authority functions retain private ACLs');

-- Admission is not bootstrap: it never creates users, memberships, role grants,
-- qualifications, or reauthentication evidence. Revocation is checked live.
set local role authenticated;
select is(pg_temp.executive_check(),true,'restored executive fixture is still valid');
reset role;
select is((select count(*)::integer from public.profiles where id in('90100000-0000-4000-8000-000000000001','90100000-0000-4000-8000-000000000002')),2,'admission did not create profiles');
select is((select count(*)::integer from public.membership_roles where membership_id in('90700000-0000-4000-8000-000000000001','90700000-0000-4000-8000-000000000002')),2,'admission did not add role grants');
update private.executive_access_policy set enabled=false;
set local role authenticated;
select is((select count(*)::integer from public.active_memberships),0,'revoking the singleton blocks an already admitted session');
select is(public.can_begin_staff_mfa(),false,'revoked executive cannot start a new MFA challenge');
reset role;
delete from private.executive_access_policy;
set local role authenticated;
select is(pg_temp.executive_check(),false,'deleting policy fails closed again');
select throws_ok($$select * from public.clients$$,'42501',null,'missing policy does not grant direct client table reads after earlier admission');
reset role;
select * from finish();
rollback;
