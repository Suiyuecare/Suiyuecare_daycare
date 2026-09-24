begin;
select plan(66);
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


insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d8100000-0000-4000-8000-000000000011','authenticated','authenticated','second@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d8200000-0000-4000-8000-000000000011','synthetic-second-google','d8100000-0000-4000-8000-000000000011',
  '{"sub":"synthetic-second-google","email":"second@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d8300000-0000-4000-8000-000000000011','d8100000-0000-4000-8000-000000000011',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('d8410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d8300000-0000-4000-8000-000000000011',
 to_timestamp(current_setting('test.custom_amr')::bigint),to_timestamp(current_setting('test.custom_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,2)n;

insert into public.profiles(id,display_name,kind) values('d8100000-0000-4000-8000-000000000011','合成第二人','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values('d8700000-0000-4000-8000-000000000011','d8500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000011','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values('d8700000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('d8100000-0000-4000-8000-000000000011','d8500000-0000-4000-8000-000000000001','example.invalid','second@example.invalid','synthetic-second-google',true,'synthetic second approver');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values
 ('d8800000-0000-4000-8000-000000000011','d8100000-0000-4000-8000-000000000011','d8300000-0000-4000-8000-000000000011',repeat('b',64),
 'd8900000-0000-4000-8000-000000000011',now()-interval '2 minutes','before',now()-interval '1 minute',now()+interval '4 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','after','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('d8100000-0000-4000-8000-000000000011','d8300000-0000-4000-8000-000000000011','d8800000-0000-4000-8000-000000000011','aal2','totp',now()-interval '30 seconds');

create function pg_temp.second_login() returns void language plpgsql as $$ begin
 perform pg_temp.custom_login();
 perform set_config('request.jwt.claims',replace(replace(replace(current_setting('request.jwt.claims'),'000000000001','000000000011'),'custom-form@example.invalid','second@example.invalid'),'synthetic-custom-google','synthetic-second-google'),true);
end;$$;
insert into public.branches(id,organization_id,code,name) values('d8600000-0000-4000-8000-000000000003','d8500000-0000-4000-8000-000000000001','second','合成第二分支');
create function pg_temp.lifecycle(p_action text default 'clone',p_n integer default 1,p_request uuid default null,p_reason text default '合成改版原因',p_version uuid default 'd9400000-0000-4000-8000-000000000002',p_branch uuid default 'd8600000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.write_custom_form_lifecycle('d8500000-0000-4000-8000-000000000001',p_branch,
 ('d9900000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,
 jsonb_build_object('action',p_action,'formVersionId',p_version,'requestId',p_request,'reason',p_reason));$$;
create function pg_temp.lifecycle_read() returns jsonb language sql as $$
 select public.read_custom_form_lifecycle('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000002');$$;
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values('db300000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','SYN-1','合成填答個案');
create function pg_temp.lifecycle_response(p_n integer,p_previous uuid default null,p_revision integer default null,p_action text default 'save') returns jsonb language sql as $$
 select public.write_custom_form_response('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',('db400000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,
 jsonb_build_object('action',p_action,'formVersionId','d9400000-0000-4000-8000-000000000002','previousId',p_previous,'baseRevision',p_revision,'serviceDate',(clock_timestamp() at time zone 'Asia/Taipei')::date,
 'answers',case when p_action='save' then '{"note":{"state":"answered","value":"合成填答"},"count":{"state":"answered","value":0},"yes":{"state":"answered","value":false}}'::jsonb else null end,'reason',case when p_action='correct' then '合成更正原因' else null end));$$;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_form_lifecycle_events'::regclass),'lifecycle evidence forced RLS');
select ok(not has_table_privilege('authenticated','private.custom_form_lifecycle_events','select,insert,update,delete'),'no direct lifecycle evidence access');
select ok(not has_function_privilege('anon','public.write_custom_form_lifecycle(uuid,uuid,uuid,jsonb)','execute'),'anonymous writer closed');
select ok(not has_function_privilege('service_role','public.write_custom_form_lifecycle(uuid,uuid,uuid,jsonb)','execute'),'service impersonation closed');
select pg_temp.custom_login();
set local role authenticated;
select lives_ok($$select set_config('test.saved_response',pg_temp.lifecycle_response(1)::text,true)$$,'save actual response before retirement');
select lives_ok($$select set_config('test.clone',pg_temp.lifecycle()::text,true)$$,'published version cloned');
select is(pg_temp.lifecycle()->>'replayed','true','same clone replay uses original result');
select throws_ok($$select pg_temp.lifecycle('clone',2)$$,'23514',null,'second draft not silently created');
select throws_ok($$select pg_temp.lifecycle('clone',1,null,'更改同操作原因')$$,'23505',null,'same key different reason rejected');
select throws_ok($$select pg_temp.lifecycle('clone',2,null,'合成原因文字','d9400000-0000-4000-8000-000000000001')$$,'42501',null,'official source denied');
select is((public.read_custom_form_draft('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',(current_setting('test.clone')::jsonb->'event'->>'newVersionId')::uuid)->>'version')::int,2,'next version is two');
select is(public.read_custom_form_draft('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',(current_setting('test.clone')::jsonb->'event'->>'newVersionId')::uuid)->'payload'->'effectiveFrom','null'::jsonb,'new draft requires explicit dates');
select lives_ok($$select set_config('test.retire',pg_temp.lifecycle('request_retirement',3)::text,true)$$,'retirement requested');
select is(pg_temp.lifecycle('request_retirement',3)->>'replayed','true','retirement request idempotent');
select throws_ok($$select pg_temp.lifecycle('request_retirement',4)$$,'23514',null,'duplicate pending request denied');
select throws_ok($$select pg_temp.lifecycle('approve_retirement',4,(current_setting('test.retire')::jsonb->'event'->>'id')::uuid)$$,'42501',null,'requester cannot self approve');
select is((pg_temp.lifecycle_read()->>'total')::int,2,'audited history shows clone and retirement request');
select pg_temp.custom_login('aal1');
select throws_ok($$select pg_temp.lifecycle()$$,'42501',null,'AAL1 replay is denied');
select pg_temp.second_login();
select is(public.can_begin_staff_mfa(),true,'approved forms-only second manager may begin actual MFA');
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),true,'second Google person has real recent forms-only evidence');
select is(public.has_recent_aal2(15),false,'global evidence root remains executive only');
select is(private.has_permission('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','care_records.sign'),false,'no clinical signing authority acquired');
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000002','d8600000-0000-4000-8000-000000000002',true),false,'forms-only grant cannot cross organization');
select lives_ok($$select * from public.form_governance_snapshot('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001')$$,'actual second person can load page82 governance snapshot');
select lives_ok($$select set_config('test.decision',pg_temp.lifecycle('reject_retirement',5,(current_setting('test.retire')::jsonb->'event'->>'id')::uuid,p_branch=>'d8600000-0000-4000-8000-000000000003')::text,true)$$,'independent org manager can reject request from other branch');
select is(pg_temp.lifecycle('reject_retirement',5,(current_setting('test.retire')::jsonb->'event'->>'id')::uuid,p_branch=>'d8600000-0000-4000-8000-000000000003')->>'replayed','true','rejected decision exact replay');
select is((public.read_custom_form_lifecycle('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000003','d9400000-0000-4000-8000-000000000002')->>'total')::int,3,'same organization sees shared form history across branches');
select is(current_setting('test.decision')::jsonb->'event'->>'branchName','合成第二分支','decision source branch retained in strict receipt');
select pg_temp.custom_login();
select lives_ok($$select set_config('test.retire2',pg_temp.lifecycle('request_retirement',6)::text,true)$$,'new request after rejection allowed');
select pg_temp.second_login();
select lives_ok($$select set_config('test.approved',pg_temp.lifecycle('approve_retirement',7,(current_setting('test.retire2')::jsonb->'event'->>'id')::uuid)::text,true)$$,'independent manager retires');
select is(pg_temp.lifecycle('approve_retirement',7,(current_setting('test.retire2')::jsonb->'event'->>'id')::uuid)->>'replayed','true','retirement approval exact replay');
select throws_ok($$select pg_temp.lifecycle('approve_retirement',8,(current_setting('test.retire2')::jsonb->'event'->>'id')::uuid)$$,'23514',null,'second approval with new key is denied');
reset role;
select is((select status::text from public.form_versions where id='d9400000-0000-4000-8000-000000000002'),'retired','retirement prevents NEW responses via existing status guard');
select is((select effective_to from public.form_versions where id='d9400000-0000-4000-8000-000000000002'),null::date,'original published open period preserved');
select is(private.custom_form_effective_through('d9400000-0000-4000-8000-000000000002',null),(clock_timestamp() at time zone 'Asia/Taipei')::date,'separate nonretroactive cutoff retained');
-- Real two-person publication, not a replaced admission fixture: today overlaps
-- approved retirement; next day is safe without changing old dates or hashes.
update public.form_versions set effective_from=(clock_timestamp() at time zone 'Asia/Taipei')::date where id=(current_setting('test.clone')::jsonb->'event'->>'newVersionId')::uuid;
select pg_temp.custom_login();
set local role authenticated;
select lives_ok($$select set_config('test.overlap_request',(select request_id::text from public.request_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',(current_setting('test.clone')::jsonb->'event'->>'newVersionId')::uuid,'db100000-0000-4000-8000-000000000001')),true)$$,'requester submits replacement dated today');
select pg_temp.second_login();
select throws_ok($$select public.approve_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',current_setting('test.overlap_request')::uuid,'db100000-0000-4000-8000-000000000002')$$,'23P01',null,'replacement cannot overlap final coverage day');
reset role;
insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json) values('db200000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000002',3,'draft',(clock_timestamp() at time zone 'Asia/Taipei')::date+1,current_setting('test.custom_payload')::jsonb->'schema','{}');
select pg_temp.custom_login();
set local role authenticated;
select lives_ok($$select set_config('test.next_request',(select request_id::text from public.request_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','db200000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000003')),true)$$,'next-day replacement can be submitted');
select pg_temp.second_login();
select lives_ok($$select public.approve_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',current_setting('test.next_request')::uuid,'db100000-0000-4000-8000-000000000004')$$,'second authorized Google manager publishes next-day replacement');
reset role;
select is((select status::text from public.form_versions where id='db200000-0000-4000-8000-000000000001'),'published','approved next version really persisted');
select is((select schema_json from public.form_versions where id='d9400000-0000-4000-8000-000000000002'),current_setting('test.custom_payload')::jsonb->'schema','old schema remains exact after retirement and replacement');
select pg_temp.custom_login();
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle_response(2)$$,'23514',null,'retired template rejects genuinely NEW response');
select lives_ok($$select set_config('test.saved_response2',pg_temp.lifecycle_response(2,(current_setting('test.saved_response')::jsonb->'record'->>'id')::uuid,1)::text,true)$$,'retired template allows saved draft continuation');
select lives_ok($$select set_config('test.signed_response',pg_temp.lifecycle_response(3,(current_setting('test.saved_response2')::jsonb->'record'->>'id')::uuid,2,'sign')::text,true)$$,'saved response can still be signed after retirement');
select lives_ok($$select pg_temp.lifecycle_response(4,(current_setting('test.signed_response')::jsonb->'record'->>'id')::uuid,3,'correct')$$,'signed historical response can still create correction after retirement');
select lives_ok($$select public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',null,null)$$,'historical responses still readable');
reset role;
select pg_temp.second_login();
-- Source identity/session/provider and freshness are independently checked.
update auth.identities set provider='email' where user_id='d8100000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),false,'non Google identity cannot use same email');
reset role;
update auth.identities set provider='google' where user_id='d8100000-0000-4000-8000-000000000011';
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='d8100000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),false,'expired actual session denied');
reset role;
update auth.sessions set not_after=null where user_id='d8100000-0000-4000-8000-000000000011';
update public.membership_roles set assigned_at=clock_timestamp()+interval '1 day' where membership_id='d8700000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),false,'future role assignment is not active');
reset role;
update public.membership_roles set assigned_at=clock_timestamp()-interval '1 day' where membership_id='d8700000-0000-4000-8000-000000000011';
update private.reauth_events set revoked_at=clock_timestamp() where user_id='d8100000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),false,'revoked immutable challenge denied');
reset role;
update private.reauth_events set revoked_at=null where user_id='d8100000-0000-4000-8000-000000000011';
-- Obtain fresh evidence through the actual public recording function, rather
-- than pretending a mocked frontend flag is enough for the second approver.
select public.issue_aal2_reauth_challenge('db500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000011','d8300000-0000-4000-8000-000000000011',repeat('c',64),'db600000-0000-4000-8000-000000000001',clock_timestamp()-interval '60 seconds','prior',300);
select set_config('test.fresh_factor',floor(extract(epoch from clock_timestamp()))::text,true);
update auth.mfa_amr_claims set created_at=to_timestamp(current_setting('test.fresh_factor')::bigint),updated_at=to_timestamp(current_setting('test.fresh_factor')::bigint)
 where session_id='d8300000-0000-4000-8000-000000000011' and authentication_method='totp';
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.custom_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.fresh_factor')::bigint)))::text,true);
set local role authenticated;
select is(public.record_aal2_reauth('db500000-0000-4000-8000-000000000001',repeat('c',64)),true,'actual staff Google challenge records fresh AAL2 proof');
select is(public.record_aal2_reauth('db500000-0000-4000-8000-000000000001',repeat('c',64)),false,'consumed MFA challenge cannot be reused');
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),true,'actual newly consumed evidence authorizes forms only');
select is(public.has_recent_aal2(15),false,'recording fresh staff proof still does not expand global evidence authority');
reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 values('db500000-0000-4000-8000-000000000002','d8100000-0000-4000-8000-000000000011','d8300000-0000-4000-8000-000000000011',repeat('d',64),'db600000-0000-4000-8000-000000000002',clock_timestamp()-interval '18 minutes','old',clock_timestamp()-interval '17 minutes',clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '16 minutes','old-consumed','totp',clock_timestamp()-interval '16 minutes');
update private.reauth_events set challenge_id='db500000-0000-4000-8000-000000000002',verified_at=(select factor_verified_at from private.reauth_challenges where id='db500000-0000-4000-8000-000000000002') where user_id='d8100000-0000-4000-8000-000000000011';
set local role authenticated;
select is(public.has_custom_form_governance_access('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',true),false,'matching same-session evidence older than fifteen minutes denied');
select throws_ok($$select pg_temp.lifecycle('approve_retirement',7,(current_setting('test.retire2')::jsonb->'event'->>'id')::uuid)$$,'42501',null,'stale evidence cannot replay a previously successful operation');
reset role;
update private.reauth_events set challenge_id='db500000-0000-4000-8000-000000000001',verified_at=(select factor_verified_at from private.reauth_challenges where id='db500000-0000-4000-8000-000000000001') where user_id='d8100000-0000-4000-8000-000000000011';
-- A retirement must not invalidate the immutable receipt of its earlier publication.
insert into public.form_definitions(id,organization_id,form_key,name,category,is_official) values('db700000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','tenant.custom.replay_check','合成歷史回條表單','行政表單',false);
insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json) values('db800000-0000-4000-8000-000000000001','db700000-0000-4000-8000-000000000001',1,'draft',(clock_timestamp() at time zone 'Asia/Taipei')::date,current_setting('test.custom_payload')::jsonb->'schema','{}');
select pg_temp.custom_login();
set local role authenticated;
select set_config('test.historical_publication',(select request_id::text from public.request_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','db800000-0000-4000-8000-000000000001','db900000-0000-4000-8000-000000000001')),true);
select pg_temp.second_login();
-- Restore the current actual TOTP AMR after the helper builds its older JWT fixture.
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.custom_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.fresh_factor')::bigint)))::text,true);
select public.approve_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',current_setting('test.historical_publication')::uuid,'db900000-0000-4000-8000-000000000002');
select pg_temp.custom_login();
select set_config('test.historical_retire',pg_temp.lifecycle('request_retirement',20,p_version=>'db800000-0000-4000-8000-000000000001')::text,true);
select pg_temp.second_login();
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.custom_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.fresh_factor')::bigint)))::text,true);
select pg_temp.lifecycle('approve_retirement',21,(current_setting('test.historical_retire')::jsonb->'event'->>'id')::uuid,p_version=>'db800000-0000-4000-8000-000000000001');
select is((select replayed from public.approve_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',current_setting('test.historical_publication')::uuid,'db900000-0000-4000-8000-000000000002')),true,'same publication approval replays original receipt after retirement');
reset role;
select is((select status::text from public.form_versions where id='db800000-0000-4000-8000-000000000001'),'retired','replaying publication does not reactivate retired template');
select throws_ok($$update public.form_versions set schema_json='{}' where id='d9400000-0000-4000-8000-000000000002'$$,'55000',null,'retired schema still immutable');
select throws_ok($$delete from private.custom_form_lifecycle_events$$,'23514',null,'lifecycle evidence cannot be deleted');
select throws_ok($$update private.custom_form_lifecycle_events set reason='更改後的原因'$$,'23514',null,'lifecycle evidence cannot be rewritten');
update public.memberships set ends_at=clock_timestamp()-interval '1 second' where profile_id='d8100000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle('approve_retirement',7,(current_setting('test.retire2')::jsonb->'event'->>'id')::uuid)$$,'42501',null,'expired live membership denies successful replay');
select throws_ok($$select pg_temp.lifecycle_read()$$,'42501',null,'expired membership denies history');
reset role;
update public.memberships set ends_at=null where profile_id='d8100000-0000-4000-8000-000000000011';
update private.staff_google_access_grants set enabled=false where allowed_user_id='d8100000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle_read()$$,'42501',null,'revoked Google access denies history');
reset role;
select pg_temp.custom_login();
update public.organizations set is_active=false where id='d8500000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle()$$,'42501',null,'deactivated organization denies clone replay');
select throws_ok($$select pg_temp.lifecycle_read()$$,'42501',null,'deactivated organization denies read');
reset role;
select * from finish();
rollback;
