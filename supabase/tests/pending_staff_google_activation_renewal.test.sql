begin;
select plan(15);
select set_config('test.renewal_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);

insert into auth.users(id,email,email_confirmed_at) values
 ('dc010000-0000-4000-8000-000000000001','director-renewal@care.example.invalid',now());
insert into auth.identities(id,provider_id,user_id,provider,identity_data) values
 ('dc020000-0000-4000-8000-000000000001','synthetic-renewal','dc010000-0000-4000-8000-000000000001','google',
 '{"sub":"synthetic-renewal","email":"director-renewal@care.example.invalid","email_verified":true}');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('dc030000-0000-4000-8000-000000000001','dc010000-0000-4000-8000-000000000001',now()-interval '2 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 (gen_random_uuid(),'dc030000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.renewal_amr')::bigint),
 to_timestamp(current_setting('test.renewal_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('dc040000-0000-4000-8000-000000000001','renewal-test','Synthetic renewal organization');
insert into public.branches(id,organization_id,code,name) values
 ('dc050000-0000-4000-8000-000000000001','dc040000-0000-4000-8000-000000000001','main','Synthetic renewal branch');
insert into private.pending_staff_google_activations(id,user_id,organization_id,branch_id,role_id,
  allowed_email,display_name,approved_at,expires_at,approval_reference)
select 'dc060000-0000-4000-8000-000000000001','dc010000-0000-4000-8000-000000000001',
 'dc040000-0000-4000-8000-000000000001','dc050000-0000-4000-8000-000000000001',r.id,
 'director-renewal@care.example.invalid','Synthetic director',now()-interval '8 days',
 now()-interval '1 day','Original synthetic approval' from public.roles r
where r.role_key='branch_supervisor' and r.is_system;

select ok((select replaced_at is null and activated_at is null from private.pending_staff_google_activations
 where id='dc060000-0000-4000-8000-000000000001'),'expired approval remains unchanged initially');
select throws_ok($$update private.pending_staff_google_activations
 set role_id=(select id from public.roles where role_key='branch_director' and is_system)
 where id='dc060000-0000-4000-8000-000000000001'$$,'23514',null,
 'old approval role cannot be edited');
select throws_ok($$insert into private.pending_staff_google_activations(user_id,organization_id,branch_id,role_id,
  allowed_email,display_name,approval_reference)
 select 'dc010000-0000-4000-8000-000000000001','dc040000-0000-4000-8000-000000000001',
 'dc050000-0000-4000-8000-000000000001',id,'director-renewal@care.example.invalid',
 'Synthetic director','Unlinked approval' from public.roles where role_key='branch_director' and is_system$$,
 '23505',null,'duplicate live approval cannot be inserted');

update private.pending_staff_google_activations set replaced_at=clock_timestamp()
 where id='dc060000-0000-4000-8000-000000000001';
select ok((select replaced_at is not null and activated_at is null from private.pending_staff_google_activations
 where id='dc060000-0000-4000-8000-000000000001'),'expired unused approval can be marked replaced');
select throws_ok($$update private.pending_staff_google_activations set replaced_at=null
 where id='dc060000-0000-4000-8000-000000000001'$$,'23514',null,
 'replacement timestamp cannot be cleared');
select throws_ok($$insert into private.pending_staff_google_activations(user_id,organization_id,branch_id,role_id,
  allowed_email,display_name,approval_reference)
 select 'dc010000-0000-4000-8000-000000000001','dc040000-0000-4000-8000-000000000001',
 'dc050000-0000-4000-8000-000000000001',id,'director-renewal@care.example.invalid',
 'Synthetic director','Unlinked approval' from public.roles where role_key='branch_director' and is_system$$,
 '23514',null,'replacement must cite prior approval');

insert into private.pending_staff_google_activations(id,user_id,organization_id,branch_id,role_id,
  allowed_email,display_name,approval_reference,replaces_id)
select 'dc060000-0000-4000-8000-000000000002','dc010000-0000-4000-8000-000000000001',
 'dc040000-0000-4000-8000-000000000001','dc050000-0000-4000-8000-000000000001',r.id,
 'director-renewal@care.example.invalid','Synthetic director','Renewed owner approval',
 'dc060000-0000-4000-8000-000000000001' from public.roles r
where r.role_key='branch_director' and r.is_system;
select is((select count(*)::int from private.pending_staff_google_activations
 where user_id='dc010000-0000-4000-8000-000000000001'),2,
 'both old and renewed approvals remain in immutable history');
select is((select r.role_key from private.pending_staff_google_activations a
 join public.roles r on r.id=a.role_id where a.replaced_at is null
 and a.user_id='dc010000-0000-4000-8000-000000000001'),
 'branch_director','current approval has only director role');

select set_config('request.jwt.claims',(jsonb_build_object(
 'sub','dc010000-0000-4000-8000-000000000001',
 'session_id','dc030000-0000-4000-8000-000000000001',
 'aud','authenticated','role','authenticated','aal','aal1',
 'email','director-renewal@care.example.invalid','is_anonymous',false,
 'iat',floor(extract(epoch from clock_timestamp())),
 'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth',
 'timestamp',current_setting('test.renewal_amr')::bigint))))::text,true);
set local role authenticated;
select is(public.activate_approved_staff_google_account(),true,
 'verified Google session consumes only the renewed approval');
select is(public.is_staff_login_allowed(),true,'renewed director may sign in');
select is(public.activate_approved_staff_google_account(),true,'renewed activation is idempotent');
reset role;
select ok((select activated_at is null from private.pending_staff_google_activations
 where id='dc060000-0000-4000-8000-000000000001'),'old approval is never consumed');
select ok((select activated_at is not null and replaced_at is null
 from private.pending_staff_google_activations where id='dc060000-0000-4000-8000-000000000002'),
 'renewed approval records activation');
select is((select count(*)::int from public.membership_roles mr join public.memberships m on m.id=mr.membership_id
 join public.roles r on r.id=mr.role_id where m.profile_id='dc010000-0000-4000-8000-000000000001'
 and r.role_key='branch_director'),1,'exact director role is assigned once');
select ok((select count(*)>=4 from public.audit_events
 where table_name='private.pending_staff_google_activations'
 and organization_id='dc040000-0000-4000-8000-000000000001'),
 'original approval, replacement, renewal and activation are audited');

select * from finish();
rollback;
