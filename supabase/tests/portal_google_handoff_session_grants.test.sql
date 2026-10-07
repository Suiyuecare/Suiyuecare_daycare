begin;
select plan(58);

-- Synthetic identities only. The real Portal verifies the Google subject and
-- signs the handoff before invoking the service-role claim RPC.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('e9100000-0000-4000-8000-000000000001','authenticated','authenticated','owner@example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('e9100000-0000-4000-8000-000000000002','authenticated','authenticated','director@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('e9100000-0000-4000-8000-000000000003','authenticated','authenticated','stranger@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now()),
 ('e9100000-0000-4000-8000-000000000004','authenticated','authenticated','firstuse@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('e9200000-0000-4000-8000-000000000001','synthetic-google-owner','e9100000-0000-4000-8000-000000000001','{"sub":"synthetic-google-owner","email":"owner@example.invalid","email_verified":true}','google'),
 ('e9200000-0000-4000-8000-000000000002','synthetic-google-director','e9100000-0000-4000-8000-000000000002','{"sub":"synthetic-google-director","email":"director@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google'),
 ('e9200000-0000-4000-8000-000000000003','synthetic-google-stranger','e9100000-0000-4000-8000-000000000003','{"sub":"synthetic-google-stranger","email":"stranger@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into public.organizations(id,code,name) values
 ('e9500000-0000-4000-8000-000000000001','portal_sso_test','Synthetic SSO organization');
insert into public.branches(id,organization_id,code,name) values
 ('e9600000-0000-4000-8000-000000000001','e9500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('e9600000-0000-4000-8000-000000000002','e9500000-0000-4000-8000-000000000001','other','Synthetic other');
insert into public.profiles(id,display_name,kind) values
 ('e9100000-0000-4000-8000-000000000001','Synthetic owner','staff'),
 ('e9100000-0000-4000-8000-000000000002','Synthetic director','staff'),
 ('e9100000-0000-4000-8000-000000000003','Synthetic stranger','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('e9700000-0000-4000-8000-000000000001','e9500000-0000-4000-8000-000000000001',null,'e9100000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
 ('e9700000-0000-4000-8000-000000000002','e9500000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000002','active',now()-interval '1 day'),
 ('e9700000-0000-4000-8000-000000000003','e9500000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000003','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('e9700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
 ('e9700000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004'),
 ('e9700000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004');

create function pg_temp.portal_claims(p_user uuid,p_session uuid,p_aal text default 'aal1',p_overrides jsonb default '{}')
returns boolean language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claims',(jsonb_build_object(
  'sub',p_user,'session_id',p_session,'aud','authenticated','role','authenticated',
  'aal',p_aal,'is_anonymous',false,
  'email',case when p_user='e9100000-0000-4000-8000-000000000001' then 'owner@example.invalid'
    when p_user='e9100000-0000-4000-8000-000000000002' then 'director@care.example.invalid'
    else 'stranger@care.example.invalid' end,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','otp',
    'timestamp',floor(extract(epoch from clock_timestamp()))))
 )||p_overrides)::text,true);
 return public.is_staff_login_allowed();
end; $$;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
 where oid='private.portal_sso_ticket_claims'::regclass),'ticket ledger forces RLS');
select ok(not has_table_privilege('authenticated','private.portal_sso_ticket_claims','select,insert,update,delete')
 and not has_table_privilege('service_role','private.portal_sso_ticket_claims','select,insert,update,delete'),
 'browser and service roles cannot directly edit ticket ledger');
select ok(not has_function_privilege('anon','public.claim_portal_sso_ticket(text,text,text,timestamptz)','execute')
 and not has_function_privilege('authenticated','public.claim_portal_sso_ticket(text,text,text,timestamptz)','execute')
 and has_function_privilege('service_role','public.claim_portal_sso_ticket(text,text,text,timestamptz)','execute'),
 'only trusted server role can claim ticket');
select ok(not has_function_privilege('anon','public.bind_portal_sso_session(text,uuid)','execute')
 and not has_function_privilege('authenticated','public.bind_portal_sso_session(text,uuid)','execute')
 and has_function_privilege('service_role','public.bind_portal_sso_session(text,uuid)','execute'),
 'only trusted server role can bind Daycare session');
select ok(has_function_privilege('service_role','public.is_portal_sso_first_activation_pending(text,text)','execute')
 and not has_function_privilege('authenticated','public.is_portal_sso_first_activation_pending(text,text)','execute')
 and not has_function_privilege('anon','public.is_portal_sso_first_activation_pending(text,text)','execute'),
 'first-activation classifier is server-only');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']
  and pg_get_userbyid(proowner)='postgres') from pg_proc
  where oid in ('private.claim_portal_sso_ticket(text,text,text,timestamptz)'::regprocedure,
    'private.is_portal_sso_first_activation_pending(text,text)'::regprocedure,
    'private.bind_portal_sso_session(text,uuid)'::regprocedure,
    'private.is_portal_sso_session_allowed(text)'::regprocedure)),
 'all elevated handoff implementations live in private with fixed empty search path and reviewed owner');
select ok((select bool_and(not prosecdef and proconfig @> array['search_path=""'])
  from pg_proc where oid in (
    'public.claim_portal_sso_ticket(text,text,text,timestamptz)'::regprocedure,
    'public.is_portal_sso_first_activation_pending(text,text)'::regprocedure,
    'public.bind_portal_sso_session(text,uuid)'::regprocedure)),
 'public RPC facades are SECURITY INVOKER with fixed empty search path');
select ok(not has_function_privilege('anon','private.claim_portal_sso_ticket(text,text,text,timestamptz)','execute')
 and not has_function_privilege('authenticated','private.claim_portal_sso_ticket(text,text,text,timestamptz)','execute')
 and has_function_privilege('service_role','private.claim_portal_sso_ticket(text,text,text,timestamptz)','execute')
 and not has_function_privilege('anon','private.is_portal_sso_first_activation_pending(text,text)','execute')
 and not has_function_privilege('authenticated','private.is_portal_sso_first_activation_pending(text,text)','execute')
 and has_function_privilege('service_role','private.is_portal_sso_first_activation_pending(text,text)','execute')
 and not has_function_privilege('anon','private.bind_portal_sso_session(text,uuid)','execute')
 and not has_function_privilege('authenticated','private.bind_portal_sso_session(text,uuid)','execute')
 and has_function_privilege('service_role','private.bind_portal_sso_session(text,uuid)','execute'),
 'only service_role can execute private elevated handoff implementations');
select ok(has_schema_privilege('service_role','private','usage')
 and (select proargnames=array['p_jti_sha256','p_google_sub','p_email','p_expires_at']
   and prorettype='uuid'::regtype from pg_proc
   where oid='public.claim_portal_sso_ticket(text,text,text,timestamptz)'::regprocedure)
 and (select proargnames=array['p_email','p_google_sub']
   and prorettype='boolean'::regtype from pg_proc
   where oid='public.is_portal_sso_first_activation_pending(text,text)'::regprocedure)
 and (select proargnames=array['p_jti_sha256','p_session_id']
   and prorettype='boolean'::regtype from pg_proc
   where oid='public.bind_portal_sso_session(text,uuid)'::regprocedure),
 'service_role can reach private implementations and existing named admin.rpc arguments are unchanged');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prosecdef and n.nspname='public' and p.proname in (
   'claim_portal_sso_ticket','is_portal_sso_first_activation_pending','bind_portal_sso_session')),
 'no Portal SSO SECURITY DEFINER implementation remains in public');

set local role anon;
select throws_ok($$select public.claim_portal_sso_ticket(repeat('a',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '5 minutes')$$,
 '42501',null,'anonymous cannot self-claim ticket');
reset role;
set local role authenticated;
select throws_ok($$select public.bind_portal_sso_session(repeat('a',64),'e9300000-0000-4000-8000-000000000001')$$,
 '42501',null,'authenticated user cannot self-bind session');
reset role;

-- Login admission remains default-deny even for a verified Google identity.
set local role service_role;
select is(public.is_portal_sso_first_activation_pending('firstuse@care.example.invalid','synthetic-google-firstuse'),false,
 'email alone is not an approved invitation');
select is(public.claim_portal_sso_ticket(repeat('a',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '5 minutes'),
 null::uuid,'unapproved owner identity cannot claim');
select is(public.claim_portal_sso_ticket(repeat('b',64),'synthetic-google-director','director@care.example.invalid',clock_timestamp()+interval '5 minutes'),
 null::uuid,'unapproved director identity cannot claim');
reset role;
insert into private.pending_staff_google_activations(user_id,organization_id,branch_id,role_id,allowed_email,display_name,approval_reference)
values('e9100000-0000-4000-8000-000000000004','e9500000-0000-4000-8000-000000000001',
 'e9600000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
 'firstuse@care.example.invalid','Synthetic first-use director','Synthetic pending approval');
set local role service_role;
select is(public.is_portal_sso_first_activation_pending('firstuse@care.example.invalid','synthetic-google-firstuse'),true,
 'valid unconsumed owner-approved invitation is classified without activation');
select is(public.is_portal_sso_first_activation_pending('firstuse@care.example.invalid',''),false,
 'invalid signed Google subject cannot classify invitation');
reset role;
select is((select count(*)::integer from public.profiles where id='e9100000-0000-4000-8000-000000000004'),0,
 'classification never creates the first-use profile or membership');
update private.pending_staff_google_activations set revoked_at=clock_timestamp()
 where user_id='e9100000-0000-4000-8000-000000000004';
set local role service_role;
select is(public.is_portal_sso_first_activation_pending('firstuse@care.example.invalid','synthetic-google-firstuse'),false,
 'revoked invitation is no longer classified as ready');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('e9100000-0000-4000-8000-000000000001','owner@example.invalid','synthetic-google-owner',true,'Synthetic owner approval');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('e9100000-0000-4000-8000-000000000002','e9500000-0000-4000-8000-000000000001','care.example.invalid','director@care.example.invalid','synthetic-google-director',true,'Synthetic director approval');

set local role service_role;
select is(public.claim_portal_sso_ticket(repeat('c',64),'synthetic-google-stranger','stranger@care.example.invalid',clock_timestamp()+interval '5 minutes'),
 null::uuid,'company email and membership do not self-authorize');
select is(public.claim_portal_sso_ticket(repeat('d',64),'synthetic-google-owner','director@care.example.invalid',clock_timestamp()+interval '5 minutes'),
 null::uuid,'Google subject and signed email must be same approved principal');
select is(public.claim_portal_sso_ticket(repeat('e',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()-interval '1 second'),
 null::uuid,'expired handoff denied');
select is(public.claim_portal_sso_ticket(repeat('f',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '11 minutes'),
 null::uuid,'overlong handoff denied');
select is(public.claim_portal_sso_ticket(repeat('4',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '10 minutes 20 seconds'),
 'e9100000-0000-4000-8000-000000000001'::uuid,
 'verified 600-second ticket with permitted future iat skew is claimable');
select is(public.claim_portal_sso_ticket(repeat('5',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '10 minutes 31 seconds'),
 null::uuid,'expiry beyond 600 seconds plus 30-second skew is denied');
select is(public.claim_portal_sso_ticket('raw-jti','synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '5 minutes'),
 null::uuid,'raw JTI is not accepted in place of SHA-256 digest');
select is(public.claim_portal_sso_ticket(repeat('1',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '5 minutes'),
 'e9100000-0000-4000-8000-000000000001'::uuid,'one approved owner resolves from pinned Google subject');
select is(public.claim_portal_sso_ticket(repeat('1',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '5 minutes'),
 null::uuid,'owner JTI replay cannot claim again');
select is(public.claim_portal_sso_ticket(repeat('2',64),'synthetic-google-director','director@care.example.invalid',clock_timestamp()+interval '5 minutes'),
 'e9100000-0000-4000-8000-000000000002'::uuid,'one approved director resolves from pinned Google subject');
reset role;

set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001'),
 false,'claimed but unbound owner has no session admission');
reset role;
insert into auth.sessions(id,user_id,created_at,aal) values
 ('e9300000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001',clock_timestamp(),'aal1'),
 ('e9300000-0000-4000-8000-000000000002','e9100000-0000-4000-8000-000000000002',clock_timestamp(),'aal1');
set local role service_role;
select is(public.bind_portal_sso_session(repeat('1',64),'e9300000-0000-4000-8000-000000000002'),
 false,'owner claim cannot bind director Auth session');
select is(public.bind_portal_sso_session(repeat('1',64),'e9300000-0000-4000-8000-000000000001'),
 true,'owner claim binds exact live Daycare session');
select is(public.bind_portal_sso_session(repeat('1',64),'e9300000-0000-4000-8000-000000000001'),
 true,'same-session retry remains idempotent');
select is(public.bind_portal_sso_session(repeat('1',64),'e9300000-0000-4000-8000-000000000002'),
 false,'consumed owner claim cannot bind another session');
select is(public.bind_portal_sso_session(repeat('2',64),'e9300000-0000-4000-8000-000000000002'),
 true,'director claim binds own Daycare session');
select is(public.claim_portal_sso_ticket(repeat('3',64),'synthetic-google-owner','owner@example.invalid',clock_timestamp()+interval '5 minutes'),
 'e9100000-0000-4000-8000-000000000001'::uuid,'new signed JTI can independently resolve approved owner');
select is(public.bind_portal_sso_session(repeat('3',64),'e9300000-0000-4000-8000-000000000001'),
 false,'second ticket cannot bind an already-bound Auth session');
reset role;

set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001'),
 true,'bound AAL1 owner enters without another Google prompt');
select is(public.is_executive_login_allowed(),true,'owner retains executive read admission');
select is(private.is_active_user(),false,'AAL1 Portal handoff does not fabricate AAL2 business authority');
select is(public.has_recent_aal2(15),false,'Portal handoff cannot fabricate recent reauthentication');
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000002'),
 true,'bound AAL1 director enters own staff scope');
select is(public.is_executive_login_allowed(),false,'director is not promoted to executive');
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000001'),
 false,'valid JWT subject cannot borrow another principal session ID');
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000002',
 'aal2','{"amr":[]}'),false,'claim-only AAL2 is not accepted');
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000002',
 'aal1','{"role":"service_role"}'),false,'service-role JWT cannot enter as staff');
reset role;

-- Upgrade only on the same session with real Supabase TOTP AMR evidence.
update auth.sessions set aal='aal2' where id='e9300000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','aal2'),
 false,'AAL2 session without TOTP AMR is denied');
reset role;
select set_config('test.portal_totp',floor(extract(epoch from clock_timestamp()-interval '1 minute'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values('e9400000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.portal_totp')::bigint),to_timestamp(current_setting('test.portal_totp')::bigint),'totp');
set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','aal2',
 jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.portal_totp')::bigint)))),
 true,'real same-session TOTP upgrades owner to AAL2');
select is(private.is_active_user(),true,'upgraded owner has original AAL2 business predicate');
select is(public.has_recent_aal2(15),false,'TOTP upgrade alone still does not forge recent reauth evidence');
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000001','e9300000-0000-4000-8000-000000000001','aal2',
 '{"amr":[{"method":"totp","timestamp":1}]}'),false,'wrong TOTP timestamp cannot assert same-session MFA');
reset role;

update private.staff_google_access_grants set enabled=false where allowed_user_id='e9100000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000002'),
 false,'director revocation immediately denies bound portal session');
reset role;
update private.staff_google_access_grants set enabled=true where allowed_user_id='e9100000-0000-4000-8000-000000000002';
update public.branches set is_active=false where id='e9600000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000002'),
 false,'inactive assigned branch immediately denies bound portal session');
reset role;
update public.branches set is_active=true where id='e9600000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='e9300000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.portal_claims('e9100000-0000-4000-8000-000000000002','e9300000-0000-4000-8000-000000000002'),
 false,'expired true Auth session immediately denies portal admission');
reset role;
select ok((select count(*)=2 from private.portal_sso_ticket_claims where bound_session_id is not null),
 'only two unique handoffs were consumed and bound');
select ok((select count(*)=4 from public.audit_events where table_name='private.portal_sso_ticket_claims' and action='insert'),
 'claims have immutable audit events');
select ok((select count(*)=2 from public.audit_events where table_name='private.portal_sso_ticket_claims' and action='update'),
 'session bindings have immutable audit events');
select ok(not exists(select 1 from public.audit_events
 where table_name='private.portal_sso_ticket_claims'
   and (metadata::text like '%owner@example.invalid%'
      or metadata::text like '%synthetic-google%')),
 'handoff audit metadata does not expose email, subject or token');

select * from finish();
rollback;
