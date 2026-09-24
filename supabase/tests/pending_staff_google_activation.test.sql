begin;
select plan(37);
select set_config('test.activation_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,email,email_confirmed_at) values
 ('db010000-0000-4000-8000-000000000001','manager@care.example.invalid',now()),
 ('db010000-0000-4000-8000-000000000002','other@care.example.invalid',now());
insert into auth.identities(id,provider_id,user_id,provider,identity_data) values
 ('db020000-0000-4000-8000-000000000001','synthetic-manager','db010000-0000-4000-8000-000000000001','google',
 '{"sub":"synthetic-manager","email":"manager@care.example.invalid","email_verified":true}');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('db030000-0000-4000-8000-000000000001','db010000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 (gen_random_uuid(),'db030000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.activation_amr')::bigint),to_timestamp(current_setting('test.activation_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values ('db040000-0000-4000-8000-000000000001','activation-test','Synthetic organization');
insert into public.branches(id,organization_id,code,name) values
 ('db050000-0000-4000-8000-000000000001','db040000-0000-4000-8000-000000000001','main','Synthetic branch'),
 ('db050000-0000-4000-8000-000000000002','db040000-0000-4000-8000-000000000001','other','Synthetic other branch');
create function pg_temp.activation_claims(p_override jsonb default '{}') returns void language sql as $$
 select set_config('request.jwt.claims',(jsonb_build_object('sub','db010000-0000-4000-8000-000000000001',
 'session_id','db030000-0000-4000-8000-000000000001','aud','authenticated','role','authenticated','aal','aal1',
 'email','manager@care.example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),
 'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.activation_amr')::bigint)))||p_override)::text,true); $$;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.pending_staff_google_activations'::regclass),'activation store forces RLS');
select ok(not has_table_privilege('authenticated','private.pending_staff_google_activations','select,insert,update,delete')
 and not has_table_privilege('service_role','private.pending_staff_google_activations','select,insert,update,delete'),'cannot self-provision approval');
select ok(not has_function_privilege('anon','public.activate_approved_staff_google_account()','execute')
 and not has_function_privilege('service_role','public.activate_approved_staff_google_account()','execute'),'only authenticated self can activate');
set local role authenticated;
select pg_temp.activation_claims();
select is(public.activate_approved_staff_google_account(),false,'uninvited verified company account denied');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into private.pending_staff_google_activations(user_id,organization_id,branch_id,role_id,allowed_email,display_name,approval_reference)
 select 'db010000-0000-4000-8000-000000000001','db040000-0000-4000-8000-000000000001','db050000-0000-4000-8000-000000000001',id,
 'manager@care.example.invalid','Synthetic manager','Synthetic owner approval' from public.roles where role_key='branch_supervisor' and is_system;
set local role authenticated;
select pg_temp.activation_claims('{"session_id":"db030000-0000-4000-8000-000000000099"}');
select is(public.activate_approved_staff_google_account(),false,'missing live session cannot consume approval');
reset role;
select is((select count(*)::int from private.staff_google_access_grants),0,'invalid session rolls provisional grant back');
select is((select count(*)::int from public.profiles where id='db010000-0000-4000-8000-000000000001'),0,'failed activation creates no profile');
select is((select count(*)::int from public.audit_events where table_name='private.staff_google_access_grants'),0,'failed activation rolls grant audit back');
update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where provider_id='synthetic-manager';
set local role authenticated;
select pg_temp.activation_claims();
select is(public.activate_approved_staff_google_account(),false,'unverified Google email denied');
reset role;
update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','true') where provider_id='synthetic-manager';
set local role authenticated;
select pg_temp.activation_claims('{"email":"other@care.example.invalid"}');
select is(public.activate_approved_staff_google_account(),false,'different email cannot claim invitation');
select pg_temp.activation_claims('{"amr":[{"method":"password","timestamp":1}]}');
select is(public.activate_approved_staff_google_account(),false,'password AMR cannot be treated as Google');
select pg_temp.activation_claims('{"role":"service_role"}');
select is(public.activate_approved_staff_google_account(),false,'service role claim cannot self-activate');
select pg_temp.activation_claims('{"aal":"aal2"}');
select is(public.activate_approved_staff_google_account(),false,'invented AAL2 cannot consume approval');
reset role;
update auth.users set email_confirmed_at=null where id='db010000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.activation_claims();
select is(public.activate_approved_staff_google_account(),false,'Auth user must also have a verified email');
reset role;
update auth.users set email_confirmed_at=now(),banned_until=now()+interval '1 day' where id='db010000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.activate_approved_staff_google_account(),false,'banned account cannot activate');
reset role;
update auth.users set banned_until=null where id='db010000-0000-4000-8000-000000000001';
update auth.identities set identity_data=jsonb_set(identity_data,'{hd}','"other.example.invalid"') where provider_id='synthetic-manager';
set local role authenticated;
select is(public.activate_approved_staff_google_account(),false,'conflicting Google hosted domain denied');
reset role;
update auth.identities set identity_data=identity_data-'hd' where provider_id='synthetic-manager';
update public.branches set is_active=false where id='db050000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.activate_approved_staff_google_account(),false,'inactive approved branch denied');
reset role;
update public.branches set is_active=true where id='db050000-0000-4000-8000-000000000001';
select is((select count(*)::int from private.staff_google_access_grants),0,'all failed activations leave zero grants');
select is((select count(*)::int from private.pending_staff_google_activations where activated_at is not null),0,'all failed activations leave approval unconsumed');
set local role authenticated;
select pg_temp.activation_claims();
select is(public.activate_approved_staff_google_account(),true,'genuine approved Google AAL1 activates atomically');
select is(public.is_staff_login_allowed(),true,'activated staff admitted');
select is(public.is_executive_login_allowed(),false,'activation does not create executive admission');
select is(public.has_recent_aal2(15),false,'no fabricated AAL2 evidence');
select is((select count(*)::int from public.branches),1,'branch manager sees only approved branch');
select is((select count(*)::int from public.active_memberships where branch_id='db050000-0000-4000-8000-000000000001'),1,'fixed single-branch membership');
select is(public.activate_approved_staff_google_account(),true,'repeat activation is safe');
reset role;
select is((select count(*)::int from private.staff_google_access_grants),1,'one grant after repeat');
select is((select count(*)::int from public.memberships where profile_id='db010000-0000-4000-8000-000000000001'),1,'one membership after repeat');
select ok((select activated_at is not null and activated_session_id='db030000-0000-4000-8000-000000000001' from private.pending_staff_google_activations),'actual activation session retained privately');
select is((select count(*)::int from public.membership_roles mr join public.memberships m on mr.membership_id=m.id join public.roles r on r.id=mr.role_id
 where m.profile_id='db010000-0000-4000-8000-000000000001' and r.role_key in ('nurse','case_manager_social_worker','organization_manager')),0,'no implicit clinical or multi-branch roles');
select throws_ok($$update private.pending_staff_google_activations set activated_at=null,activated_session_id=null$$,'23514',null,'cannot reset consumed invitation');
select throws_ok($$update private.pending_staff_google_activations set branch_id='db050000-0000-4000-8000-000000000002'$$,'23514',null,'cannot retarget approval');
update private.staff_google_access_grants set enabled=false where allowed_user_id='db010000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.activate_approved_staff_google_account(),false,'replay cannot reactivate revoked grant');
select is(public.is_staff_login_allowed(),false,'revoked staff is denied immediately');
reset role;
select ok(not exists(select 1 from public.audit_events where table_name='private.pending_staff_google_activations'
 and metadata::text like '%manager@%'),'audit contains no raw email');
select ok((select count(*)=2 from public.audit_events where table_name='private.pending_staff_google_activations'),'approval and activation both audited');
select throws_ok($$delete from private.pending_staff_google_activations$$,'23514',null,'approval history cannot be deleted');
select * from finish();
rollback;
