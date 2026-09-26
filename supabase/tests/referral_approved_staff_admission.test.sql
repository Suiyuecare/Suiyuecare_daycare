begin;
select plan(63);
set local time zone 'Asia/Taipei';
-- Isolate this suite's referral-MFA acquisition path. Pages 28/29 now have a
-- separately valid MFA path; retaining that unrelated effective sign grant
-- would make a referral-only grant revocation correctly leave MFA available.
-- This changes synthetic grant metadata only, never an authorization helper.
update public.role_permissions set granted_at=clock_timestamp()+interval '1 hour'
 where role_id in(select id from public.roles where role_key='case_manager_social_worker' and is_system)
 and permission_id in(select id from public.permissions where permission_key='social_work_records.sign');
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
create function pg_temp.referral_write(p_key uuid default 'dcd00000-0000-4000-8000-000000000001',p_action text default 'create',p_source jsonb default null,
 p_client uuid default 'dcb00000-0000-4000-8000-000000000001',p_reason text default 'Synthetic professional referral',
 p_org uuid default 'dc500000-0000-4000-8000-000000000001',p_branch uuid default 'dc600000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
 select to_jsonb(result) from public.mutate_referral_management(p_org,p_branch,p_action,
  (p_source->>'referral_key')::uuid,(p_source->>'event_id')::uuid,(p_source->>'event_sequence')::integer,
  case when p_action='create' then p_client end,case when p_action='create' then 'manual_unstandardized' end,
  case when p_action='create' then 'SYNTHETIC-CLINIC' end,case when p_action='create' then 'Synthetic receiving unit' end,
  case when p_action='create' then '2026-09-01T09:00:00+08:00'::timestamptz end,case when p_action='create' then p_reason end,
  case when p_action not in('create','submit') then 'Synthetic human evidence' end,
  case when p_action='correct' then 'Synthetic human correction reason' end,
  case when p_action='correct' then(p_source->>'event_id')::uuid end,p_key) result;
$$;

select ok(not has_table_privilege('authenticated','public.referral_events','select,insert,update,delete'),'no direct clinical grants added');
select ok(not has_function_privilege('authenticated','private.referral_permission(uuid,uuid,text)','execute'),'private module permission not exposed');
select ok(not has_function_privilege('anon','public.referral_recent_aal2_evidence(uuid,uuid)','execute') and not has_function_privilege('service_role','public.referral_recent_aal2_evidence(uuid,uuid)','execute'),'self evidence excludes anonymous and service roles');
select pg_temp.referral_login();set local role authenticated;
select is(public.is_staff_login_allowed(),true,'actual approved Google social worker admitted');
select is(public.can_begin_staff_mfa(),true,'approved social worker can acquire MFA');
select is(public.has_recent_aal2(15),false,'generic CEO recent evidence remains unchanged');
select is((public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')->>'verifiedAt')::timestamptz,to_timestamp(current_setting('test.referral_totp')::bigint),'evidence reports actual consumed verification timestamp');
select is((select count(*) from jsonb_object_keys(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'))),4::bigint,'evidence exactly four nonsensitive fields');
select is(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003'),null::jsonb,'second membership cannot expand pinned approval');
select is((select jsonb_array_length(client_options) from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),1,'assigned client only');
select ok((select can_create and can_submit and can_register_receipt and can_respond and can_close and can_correct from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),'all six actual social-worker action capabilities available');
select lives_ok($$insert into referral_admission_data select 'created',pg_temp.referral_write()$$,'approved non-CEO social worker creates immutable draft');
select is(pg_temp.referral_write()->>'replayed','true','exact original actor/key replays');
select throws_ok($$select pg_temp.referral_write('dcd00000-0000-4000-8000-000000000001','create',null,'dcb00000-0000-4000-8000-000000000001','Changed reason')$$,'23505',null,'same key changed body rejected');
select lives_ok($$insert into referral_admission_data select 'submitted',pg_temp.referral_write('dcd00000-0000-4000-8000-000000000002','submit',(select v from referral_admission_data where k='created'))$$,'authorized submission retains evidence');
select lives_ok($$insert into referral_admission_data select 'received',pg_temp.referral_write('dcd00000-0000-4000-8000-000000000003','register_received',(select v from referral_admission_data where k='submitted'))$$,'manual receipt registration usable');
select lives_ok($$insert into referral_admission_data select 'responded',pg_temp.referral_write('dcd00000-0000-4000-8000-000000000004','respond',(select v from referral_admission_data where k='received'))$$,'professional response usable');
select lives_ok($$insert into referral_admission_data select 'closed',pg_temp.referral_write('dcd00000-0000-4000-8000-000000000005','close',(select v from referral_admission_data where k='responded'))$$,'closure usable');
select lives_ok($$insert into referral_admission_data select 'corrected',pg_temp.referral_write('dcd00000-0000-4000-8000-000000000006','correct',(select v from referral_admission_data where k='closed'))$$,'append-only correction usable');
select is((select matching_total from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),1::bigint,'one chain in source snapshot');
select is((select jsonb_array_length(items->0->'history') from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),6,'all immutable versions visible');
select pg_temp.referral_login(2);
select is((select jsonb_array_length(client_options) from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),0,'unassigned social worker has no other client');
select throws_ok($$select pg_temp.referral_write('dcd00000-0000-4000-8000-000000000010')$$,'22023',null,'unassigned client write rejected');
select pg_temp.referral_login();reset role;
insert into public.membership_roles(membership_id,role_id,assigned_at)
 select 'dc700000-0000-4000-8000-000000000001',id,clock_timestamp()+interval '1 hour' from public.roles where role_key='organization_manager' and is_system;
set local role authenticated;
select is((select jsonb_array_length(client_options) from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),1,'future manager role cannot expand valid worker scope');
reset role;update public.membership_roles set assigned_at=clock_timestamp()-interval '1 minute' where membership_id='dc700000-0000-4000-8000-000000000001';set local role authenticated;
select is((select jsonb_array_length(client_options) from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),2,'effective manager permission union preserved');
reset role;delete from public.membership_roles where membership_id='dc700000-0000-4000-8000-000000000001' and role_id in(select id from public.roles where role_key='organization_manager' and is_system);
update public.role_permissions set granted_at=clock_timestamp()+interval '1 hour' where role_id in(select id from public.roles where role_key='case_manager_social_worker' and is_system) and permission_id in(select id from public.permissions where permission_key like 'referral_management.%' and permission_key<>'referral_management.read');set local role authenticated;
select is(public.can_begin_staff_mfa(),false,'future action grants cannot acquire MFA');
select is(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'future action grants cannot expose write evidence');
select ok((select not can_create and jsonb_array_length(client_options)=1 from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),'read survives future write-grant change without fake capabilities');
select throws_ok($$select pg_temp.referral_write()$$,'42501',null,'future action grants deny exact replay');
reset role;update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute' where role_id in(select id from public.roles where role_key='case_manager_social_worker' and is_system) and permission_id in(select id from public.permissions where permission_key like 'referral_management.%');
update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.referral_write()$$,'42501',null,'revoked assignment denies exact immutable replay');
select is((select matching_total from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),0::bigint,'revoked assigned client no longer counted');
reset role;update public.client_assignments set ends_at=null where id='dcc00000-0000-4000-8000-000000000001';
update private.staff_google_access_grants set enabled=false where allowed_user_id='dc100000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.referral_write()$$,'42501',null,'disabled approval denies replay');
select throws_ok($$select * from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'disabled approval denies reads');
select is(public.can_begin_staff_mfa(),false,'disabled approval denies MFA acquisition');
reset role;update private.staff_google_access_grants set enabled=true where allowed_user_id='dc100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='dc300000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.referral_write()$$,'42501',null,'actual session revocation denies replay');
select is(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'actual session revocation masks evidence');
reset role;update auth.sessions set not_after=null where id='dc300000-0000-4000-8000-000000000001';
update private.reauth_events set revoked_at=clock_timestamp() where user_id='dc100000-0000-4000-8000-000000000001';set local role authenticated;
select throws_ok($$select pg_temp.referral_write()$$,'42501',null,'revoked verification denies replay');
select is(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'revoked verification evidence hidden');
reset role;
select pg_temp.referral_login(1,'aal1');set local role authenticated;
select is(public.can_begin_staff_mfa(),true,'AAL1 can acquire real MFA');
select ok((select not can_create and matching_total=1 from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')),'AAL1 valid read does not confer clinical writes');
select throws_ok($$select pg_temp.referral_write()$$,'42501',null,'AAL1 write remains denied');
select is(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'AAL1 has no signing evidence');
reset role;set local role service_role;
select * from public.issue_aal2_reauth_challenge('dc800000-0000-4000-8000-000000000099','dc100000-0000-4000-8000-000000000001','dc300000-0000-4000-8000-000000000001',repeat('f',64),'dc900000-0000-4000-8000-000000000099',clock_timestamp()-interval '60 seconds','synthetic-prior',300);
reset role;select set_config('test.referral_totp',floor(extract(epoch from clock_timestamp()))::text,true);
update auth.mfa_amr_claims set updated_at=to_timestamp(current_setting('test.referral_totp')::bigint) where session_id='dc300000-0000-4000-8000-000000000001' and authentication_method='totp';
select pg_temp.referral_login();set local role authenticated;
select is(public.record_aal2_reauth('dc800000-0000-4000-8000-000000000099',repeat('f',64)),true,'actual approved social worker consumes freshly verified challenge');
select is((public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')->>'verifiedAt')::timestamptz,to_timestamp(current_setting('test.referral_totp')::bigint),'evidence exact acquired factor time');
select is(public.record_aal2_reauth('dc800000-0000-4000-8000-000000000099',repeat('f',64)),false,'consumed challenge cannot be reused');
reset role;
select is((select count(*) from public.referral_events where organization_id='dc500000-0000-4000-8000-000000000001'),6::bigint,'exact six original events only');
select is((select count(*) from private.referral_operations where actor_user_id='dc100000-0000-4000-8000-000000000001'),6::bigint,'exact six immutable receipts only');
select is((select count(*) from public.referral_notification_outbox where organization_id='dc500000-0000-4000-8000-000000000001'),6::bigint,'six internal-only notification records');
select is((select count(*) from private.executive_access_policy),0::bigint,'no CEO grant introduced');
select pg_temp.referral_login();set local role authenticated;
select throws_ok($$select * from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000002','dc600000-0000-4000-8000-000000000003')$$,'42501',null,'cross-organization membership cannot expand approval');
select throws_ok($$select * from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000002')$$,'42501',null,'branch-limited approval does not expand branches');
reset role;set local role anon;
select throws_ok($$select * from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous snapshot remains denied');
reset role;
-- Genuine post-audit/write fault injection: no auth predicate is replaced.
create function pg_temp.referral_revoke_during_audit() returns trigger language plpgsql as $$begin
 if new.organization_id='dc500000-0000-4000-8000-000000000001' and new.table_name='referral_management_snapshot' then
  update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';
 end if;return new;end;$$;
insert into referral_admission_data select 'audit_before',to_jsonb(count(*)) from public.audit_events where table_name='referral_management_snapshot' and organization_id='dc500000-0000-4000-8000-000000000001';
create trigger synthetic_referral_snapshot_revoke after insert on public.audit_events for each row execute function pg_temp.referral_revoke_during_audit();
select pg_temp.referral_login();set local role authenticated;
select throws_ok($$select * from public.referral_management_snapshot('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001')$$,'42501',null,'post-audit assignment loss returns no old clinical bundle');
reset role;
select is((select to_jsonb(count(*)) from public.audit_events where table_name='referral_management_snapshot' and organization_id='dc500000-0000-4000-8000-000000000001'),(select v from referral_admission_data where k='audit_before'),'denied read rolls back its audit');
select is((select ends_at from public.client_assignments where id='dcc00000-0000-4000-8000-000000000001'),null::timestamptz,'failed read also rolls back injected revoke');
drop trigger synthetic_referral_snapshot_revoke on public.audit_events;
create function pg_temp.referral_revoke_during_event() returns trigger language plpgsql as $$begin
 update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='dcc00000-0000-4000-8000-000000000001';return new;end;$$;
create trigger synthetic_referral_event_revoke after insert on public.referral_events for each row execute function pg_temp.referral_revoke_during_event();
set local role authenticated;
select throws_ok($$select pg_temp.referral_write('dcd00000-0000-4000-8000-000000000070')$$,'42501',null,'post-event assignment revoke denies write');
reset role;
select is((select count(*) from public.referral_events where organization_id='dc500000-0000-4000-8000-000000000001'),6::bigint,'denied post-event write leaves zero extra events');
select is((select count(*) from private.referral_operations where actor_user_id='dc100000-0000-4000-8000-000000000001'),6::bigint,'denied post-event write leaves zero extra receipts');
drop trigger synthetic_referral_event_revoke on public.referral_events;
-- Strict no-future evidence. The factor and event are matching but not yet
-- verified at the server wall clock, unlike the legacy generic +1 minute grace.
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
 created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 values('dc800000-0000-4000-8000-000000000088','dc100000-0000-4000-8000-000000000002','dc300000-0000-4000-8000-000000000002',repeat('e',64),
 'dc900000-0000-4000-8000-000000000088',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '4 minutes',
 clock_timestamp(),clock_timestamp(),'totp',clock_timestamp()+interval '1 second');
update private.reauth_events set challenge_id='dc800000-0000-4000-8000-000000000088',verified_at=(select factor_verified_at from private.reauth_challenges where id='dc800000-0000-4000-8000-000000000088') where user_id='dc100000-0000-4000-8000-000000000002';
select pg_temp.referral_login(2);set local role authenticated;
select is(public.referral_recent_aal2_evidence('dc500000-0000-4000-8000-000000000001','dc600000-0000-4000-8000-000000000001'),null::jsonb,'one-second future matching evidence rejected');
select throws_ok($$select pg_temp.referral_write('dcd00000-0000-4000-8000-000000000088')$$,'42501',null,'future evidence cannot authorize a direct write RPC');
reset role;
-- Original executive path remains genuine, not a replacement auth predicate.
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
 values('dc100000-0000-4000-8000-000000000003','social-worker-3@referral.example.invalid','synthetic-referral-google-3',true,'Synthetic executive control');
select set_config('test.referral_totp',(select floor(extract(epoch from updated_at))::text from auth.mfa_amr_claims where session_id='dc300000-0000-4000-8000-000000000003' and authentication_method='totp'),true);
select pg_temp.referral_login(3);set local role authenticated;
select is(public.is_executive_login_allowed(),true,'genuine original executive control retained');
select is(public.has_recent_aal2(15),true,'original executive generic MFA evidence retained');
select lives_ok($$select pg_temp.referral_write('dcd00000-0000-4000-8000-000000000089')$$,'original executive writes using effective manager permissions');
reset role;
select * from finish();
rollback;
