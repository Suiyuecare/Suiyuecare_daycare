begin;
select plan(68);
set local time zone 'Asia/Taipei';
select set_config('test.rule_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
select set_config('test.rule_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
-- Actual synthetic Auth identities, sessions, AMR and pinned owner approvals.
-- No authorization helper or guard is replaced by this suite.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
 select ('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','rule-'||n||'@rules.example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select ('da200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-rule-google-'||n,('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 jsonb_build_object('sub','synthetic-rule-google-'||n,'email','rule-'||n||'@rules.example.invalid','email_verified',true,'hd','rules.example.invalid'),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
 select ('da300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,3)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('da400000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,('da300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case m when 1 then 'test.rule_oauth' else 'test.rule_totp' end)::bigint),
 to_timestamp(current_setting(case m when 1 then 'test.rule_oauth' else 'test.rule_totp' end)::bigint),case m when 1 then 'oauth' else 'totp' end
 from generate_series(1,3)n cross join generate_series(1,2)m;
insert into public.organizations(id,code,name) values
 ('da500000-0000-4000-8000-000000000001','synthetic_rule_review','Synthetic rule organization'),
 ('da500000-0000-4000-8000-000000000002','synthetic_rule_other','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('da600000-0000-4000-8000-000000000001','da500000-0000-4000-8000-000000000001','main','Synthetic primary branch'),
 ('da600000-0000-4000-8000-000000000002','da500000-0000-4000-8000-000000000001','second','Synthetic second branch'),
 ('da600000-0000-4000-8000-000000000003','da500000-0000-4000-8000-000000000002','other','Synthetic other branch');
insert into public.profiles(id,display_name,kind)
 select ('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic rule reviewer '||n,'staff' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
 select ('da700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'da500000-0000-4000-8000-000000000001','da600000-0000-4000-8000-000000000001',
 ('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,3)n;
insert into public.membership_roles(membership_id,role_id)
 select m.id,r.id from public.memberships m cross join public.roles r where m.id::text like 'da700000-%'
 and r.is_system and r.role_key=case when m.profile_id='da100000-0000-4000-8000-000000000003' then 'nurse' else 'branch_supervisor' end;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 select ('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'da500000-0000-4000-8000-000000000001','rules.example.invalid',
 'rule-'||n||'@rules.example.invalid','synthetic-rule-google-'||n,true,'Synthetic owner-approved rule reviewer' from generate_series(1,3)n;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
 select ('da800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('da300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,encode(sha256(convert_to('synthetic-rule-'||n,'UTF8')),'hex'),('da900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 now()-interval '2 minutes','synthetic-before',now()-interval '1 minute',now()+interval '4 minutes',
 to_timestamp(current_setting('test.rule_totp')::bigint),to_timestamp(current_setting('test.rule_totp')::bigint),'synthetic-after','totp',to_timestamp(current_setting('test.rule_totp')::bigint)
 from generate_series(1,3)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
 select ('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('da300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('da800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aal2','totp',to_timestamp(current_setting('test.rule_totp')::bigint) from generate_series(1,3)n;
-- A second membership does not expand an approval pinned to the first org.
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('da700000-0000-4000-8000-000000000011','da500000-0000-4000-8000-000000000002','da600000-0000-4000-8000-000000000003','da100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) select 'da700000-0000-4000-8000-000000000011',id from public.roles where role_key='branch_supervisor' and is_system;

create function pg_temp.rule_login(p_n integer default 1,p_aal text default 'aal2') returns void language plpgsql security invoker as $$ begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','da100000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'session_id','da300000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
 'role','authenticated','aud','authenticated','aal',p_aal,'is_anonymous',false,'email','rule-'||p_n||'@rules.example.invalid',
 'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.rule_oauth')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.rule_totp')::bigint)))::text,true);
end;$$;
create function pg_temp.rule_manifest(p_revision integer default 1) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion','questionnaire-rule-catalog.v1','formKey','spmsq','formVersion','synthetic-questionnaire-form-v1','ruleVersion','synthetic-questionnaire-rule-v1','ruleRevision',p_revision,
 'form',jsonb_build_object('title','Synthetic rule form','questions','[]'::jsonb),'sourceSnapshot','[]'::jsonb,'rules',jsonb_build_object('items','[]'::jsonb),'testVectors','[]'::jsonb);
$$;
insert into private.questionnaire_rule_catalog(form_key,form_version,rule_version,rule_revision,catalog_hash,canonical_json,manifest_json)
 select 'spmsq','synthetic-questionnaire-form-v1','synthetic-questionnaire-rule-v1',n,encode(sha256(convert_to(pg_temp.rule_manifest(n)::text,'UTF8')),'hex'),pg_temp.rule_manifest(n)::text,pg_temp.rule_manifest(n) from generate_series(1,2)n;
select set_config('test.rule_hash',(select catalog_hash from private.questionnaire_rule_catalog where form_version='synthetic-questionnaire-form-v1' and rule_revision=1),true);
select set_config('test.rule_hash2',(select catalog_hash from private.questionnaire_rule_catalog where form_version='synthetic-questionnaire-form-v1' and rule_revision=2),true);
create function pg_temp.rule_payload(p_action text default 'request',p_request uuid default null,p_reason text default null,p_hash text default null,p_start date default null,p_end date default null)
returns jsonb language sql as $$select jsonb_build_object('action',p_action,'formKey','spmsq','catalogHash',coalesce(p_hash,current_setting('test.rule_hash')),'requestId',p_request,
 'effectiveFrom',case when p_action='request' then coalesce(p_start,(clock_timestamp() at time zone 'Asia/Taipei')::date+3) else null end,'effectiveTo',case when p_action='request' then p_end else null end,'reason',p_reason);$$;
create function pg_temp.rule_write(p_n integer,p_input jsonb default null,p_branch uuid default 'da600000-0000-4000-8000-000000000001',p_org uuid default 'da500000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.write_questionnaire_rule_review(p_org,p_branch,('daa00000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,coalesce(p_input,pg_temp.rule_payload()));$$;
create function pg_temp.rule_read(p_branch uuid default 'da600000-0000-4000-8000-000000000001',p_org uuid default 'da500000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.read_questionnaire_rule_review(p_org,p_branch,'spmsq');$$;
create function pg_temp.rule_request(p_setting text default 'test.rule_request') returns uuid language sql as $$select(current_setting(p_setting)::jsonb->'request'->>'requestId')::uuid;$$;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('private.questionnaire_rule_catalog'::regclass,'private.questionnaire_rule_review_requests'::regclass,'private.questionnaire_rule_review_events'::regclass,'private.questionnaire_rule_activations'::regclass,'private.questionnaire_rule_review_operations'::regclass)),'all governance tables force RLS');
select ok(not has_table_privilege('authenticated','private.questionnaire_rule_catalog','select,insert,update,delete'),'browser cannot read or alter deployment-owned catalog');
select ok(not has_table_privilege('service_role','private.questionnaire_rule_catalog','insert,update,delete'),'service role cannot seed or modify approved content');
select ok(not has_table_privilege('authenticated','private.questionnaire_rule_review_requests','select,insert,update,delete'),'requests have no direct browser table access');
select ok(not has_table_privilege('authenticated','private.questionnaire_rule_activations','insert,update,delete'),'activation cannot be bypassed through table writes');
select ok(not has_function_privilege('anon','public.write_questionnaire_rule_review(uuid,uuid,uuid,jsonb)','execute'),'anonymous rule mutation is closed');
select ok(not has_function_privilege('service_role','public.write_questionnaire_rule_review(uuid,uuid,uuid,jsonb)','execute'),'service-role cannot substitute human approval');
select ok(not has_function_privilege('authenticated','private.require_questionnaire_rule_reauth(uuid,uuid)','execute'),'internal factor helper cannot be called directly');
select is((select count(*)::integer from private.questionnaire_rule_activations),0,'catalog seed never activates a candidate');
select throws_ok($$update private.questionnaire_rule_catalog set rule_revision=9$$,'55000',null,'catalog is append-only even to the owner');
select throws_ok($$delete from private.questionnaire_rule_catalog$$,'55000',null,'catalog cannot be deleted');
select throws_ok($$insert into private.questionnaire_rule_catalog(form_key,form_version,rule_version,rule_revision,catalog_hash,canonical_json,manifest_json) values('spmsq','synthetic-questionnaire-form-v1','synthetic-questionnaire-rule-v1',3,repeat('a',64),pg_temp.rule_manifest(3)::text,pg_temp.rule_manifest(3))$$,'23514',null,'hash cannot diverge from exact canonical bytes');
select throws_ok($$insert into private.questionnaire_rule_catalog(form_key,form_version,rule_version,rule_revision,catalog_hash,canonical_json,manifest_json) select 'spmsq','synthetic-questionnaire-form-v1','synthetic-questionnaire-rule-v1',3,encode(sha256(convert_to(pg_temp.rule_manifest(3)::text,'UTF8')),'hex'),pg_temp.rule_manifest(3)::text,pg_temp.rule_manifest(4)$$,'23514',null,'logical JSON cannot diverge from canonical source');
select pg_temp.rule_login(1,'aal1');set local role authenticated;
select is(pg_temp.rule_read()->>'total','0','approved Google AAL1 can inspect governance without an extra factor');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.rule_read()->'catalogs') item where item->>'formVersion'='synthetic-questionnaire-form-v1'),2,'read exposes both bounded synthetic catalog identity summaries');
select throws_ok($$select pg_temp.rule_write(1)$$,'42501',null,'Google AAL1 is not silently treated as signing AAL2');
select pg_temp.rule_login(1);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}','{}'::jsonb)::text,true);
select throws_ok($$select pg_temp.rule_write(1)$$,'42501',null,'nonarray AMR fails closed instead of an internal server error');
select pg_temp.rule_login(1);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr,1,timestamp}','"not-an-auth-time"'::jsonb)::text,true);
select throws_ok($$select pg_temp.rule_write(1)$$,'42501',null,'malformed AMR timestamp fails closed instead of an internal server error');
select pg_temp.rule_login(1);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{session_id}','"malformed-session"'::jsonb)::text,true);
select throws_ok($$select pg_temp.rule_write(1)$$,'42501',null,'malformed same-session identity fails closed');
select pg_temp.rule_login(1);
select throws_ok($$select pg_temp.rule_write(1,pg_temp.rule_payload()-'reason')$$,'22023',null,'missing explicit null field is rejected');
select throws_ok($$select pg_temp.rule_write(1,pg_temp.rule_payload()||'{"score":1}'::jsonb)$$,'22023',null,'browser cannot provide a score or manifest');
select throws_ok($$select pg_temp.rule_write(1,jsonb_set(pg_temp.rule_payload(),'{effectiveFrom}','"2026-02-30"'))$$,'22023',null,'noncalendar dates are rejected');
select throws_ok($$select pg_temp.rule_write(1,pg_temp.rule_payload('request',null,null,null,(clock_timestamp() at time zone 'Asia/Taipei')::date-1))$$,'22023',null,'published rule cannot be backdated');
select throws_ok($$select pg_temp.rule_write(1,pg_temp.rule_payload('request',null,null,repeat('f',64)))$$,'42501',null,'unregistered hash cannot become a candidate');
select throws_ok($$select pg_temp.rule_read('da600000-0000-4000-8000-000000000002')$$,'42501',null,'other branch read denied');
select throws_ok($$select pg_temp.rule_write(1,null,'da600000-0000-4000-8000-000000000003','da500000-0000-4000-8000-000000000002')$$,'42501',null,'second active membership cannot expand pinned Google approval');
select pg_temp.rule_login(3);
select throws_ok($$select pg_temp.rule_read()$$,'42501',null,'nursing role does not acquire governance rights');
select pg_temp.rule_login(1);
select lives_ok($$select set_config('test.rule_request',pg_temp.rule_write(1)::text,true)$$,'real Google AAL2 requester freezes the selected catalog and dates');
select is(current_setting('test.rule_request')::jsonb->'request'->>'status','pending','request is pending, not formally approved');
select is(pg_temp.rule_write(1)->>'eventId',current_setting('test.rule_request')::jsonb->>'eventId','same-key request replays the exact event');
select is(pg_temp.rule_write(1)->>'replayed','true','repeat operation has explicit replay status');
select throws_ok($$select pg_temp.rule_write(1,pg_temp.rule_payload('request',null,null,current_setting('test.rule_hash2')))$$,'23505',null,'same key changed content conflicts');
select throws_ok($$select pg_temp.rule_write(2)$$,'23514',null,'second concurrent pending proposal is blocked');
select throws_ok($$select pg_temp.rule_write(2,pg_temp.rule_payload('approve',pg_temp.rule_request()))$$,'42501',null,'requester cannot approve their own proposal');
select throws_ok($$select pg_temp.rule_write(2,pg_temp.rule_payload('return',pg_temp.rule_request(),'Synthetic return reason'))$$,'42501',null,'requester cannot supply a fictitious independent return');
select pg_temp.rule_login(2);
select throws_ok($$select pg_temp.rule_write(2,pg_temp.rule_payload('withdraw',pg_temp.rule_request(),'Synthetic withdraw reason'))$$,'42501',null,'only original requester can withdraw');
select throws_ok($$select pg_temp.rule_write(2,pg_temp.rule_payload('return',pg_temp.rule_request(),'bad'))$$,'22023',null,'reason minimum is enforced');
select throws_ok($$select pg_temp.rule_write(2,pg_temp.rule_payload('return',pg_temp.rule_request(),'<script>Synthetic reason</script>'))$$,'22023',null,'markup in human reason is rejected');
select lives_ok($$select set_config('test.rule_return',pg_temp.rule_write(2,pg_temp.rule_payload('return',pg_temp.rule_request(),'Synthetic independent return'))::text,true)$$,'second scoped AAL2 reviewer can return a pending proposal');
select is(current_setting('test.rule_return')::jsonb->'request'->>'status','returned','return has explicit immutable terminal state');
select throws_ok($$select pg_temp.rule_write(3,pg_temp.rule_payload('approve',pg_temp.rule_request()))$$,'23514',null,'returned request cannot be approved afterward');
select pg_temp.rule_login(1);
select lives_ok($$select set_config('test.rule_request2',pg_temp.rule_write(3)::text,true)$$,'requester can make a fresh proposal after a return');
select lives_ok($$select pg_temp.rule_write(4,pg_temp.rule_payload('withdraw',pg_temp.rule_request('test.rule_request2'),'Synthetic reason to withdraw'))$$,'requester can explicitly withdraw');
select is(pg_temp.rule_read()->'requests'->0->>'status','withdrawn','withdrawn proposal is visible in history');
select lives_ok($$select set_config('test.rule_request3',pg_temp.rule_write(5)::text,true)$$,'fresh proposal after withdrawal has its own identity');
select pg_temp.rule_login(2);
select lives_ok($$select set_config('test.rule_approved',pg_temp.rule_write(6,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_request3')))::text,true)$$,'independent reviewer approves exact catalog and frozen dates');
select is(current_setting('test.rule_approved')::jsonb->'request'->>'status','approved','approved state is backed by actual second-person evidence');
select ok(current_setting('test.rule_approved')::jsonb->'request'->'activation'->>'activationId' is not null,'approval creates one immutable activation identity');
select is(pg_temp.rule_write(6,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_request3')))->>'eventId',current_setting('test.rule_approved')::jsonb->>'eventId','approval retry preserves exact original event');
select is(pg_temp.rule_write(6,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_request3')))->>'replayed','true','approval retry does not create a second activation');
select throws_ok($$select pg_temp.rule_write(7,pg_temp.rule_payload('return',pg_temp.rule_request('test.rule_request3'),'Synthetic late return reason'))$$,'23514',null,'approved proposal cannot be withdrawn or returned later');
select pg_temp.rule_login(1);
select throws_ok($$select pg_temp.rule_write(8,pg_temp.rule_payload('request',null,null,current_setting('test.rule_hash2')))$$,'23514',null,'another rule version cannot overlap an approved effective range');
select throws_ok($$select public.read_questionnaire_rule_review('da500000-0000-4000-8000-000000000001','da600000-0000-4000-8000-000000000001','spmsq',now(),null)$$,'22023',null,'cursor fields must be supplied together');
reset role;
select is((select count(*)::integer from private.questionnaire_rule_activations),1,'one approved request produces exactly one activation');
select is((select count(*)::integer from private.questionnaire_rule_review_requests),3,'returned and withdrawn proposals remain as immutable records');
select is((select count(*)::integer from private.questionnaire_rule_review_events),6,'every request and decision preserves its own event');
select is((select count(*)::integer from private.questionnaire_rule_review_operations),6,'all successful operations have one immutable receipt');
select ok((select bool_and(requested_by<>e.actor_user_id and request_challenge_id<>e.challenge_id) from private.questionnaire_rule_review_requests q join private.questionnaire_rule_review_events e on e.request_id=q.id where e.action='approve'),'activation retains different actual users and factor evidence');
select throws_ok($$update private.questionnaire_rule_review_requests set effective_from=effective_from+1$$,'55000',null,'requested dates cannot be silently changed');
select throws_ok($$delete from private.questionnaire_rule_review_events$$,'55000',null,'review decisions cannot be deleted');
select throws_ok($$update private.questionnaire_rule_activations set effective_to=current_date$$,'55000',null,'activation period cannot be silently shortened');
select throws_ok($$delete from private.questionnaire_rule_review_operations$$,'55000',null,'operation evidence cannot be deleted');
select ok(not exists(select 1 from public.audit_events where table_name='questionnaire_rule_review' and(metadata::text like '%Synthetic independent return%' or metadata::text like '%canonical_json%' or metadata::text like '%factor_verified_at%')),'audit metadata excludes reason content and factor secrets');
select is((select count(*)::integer from public.questionnaire_assessment_versions),0,'rule activation does not create or sign clinical assessments');
update private.reauth_events set revoked_at=clock_timestamp() where user_id='da100000-0000-4000-8000-000000000002';
select pg_temp.rule_login(2);set local role authenticated;
select throws_ok($$select pg_temp.rule_write(6,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_request3')))$$,'42501',null,'revoked factor cannot retrieve a privileged success replay');
reset role;
update private.reauth_events set revoked_at=null where user_id='da100000-0000-4000-8000-000000000002';
update private.staff_google_access_grants set enabled=false where allowed_user_id='da100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.rule_read()$$,'42501',null,'staff deactivation revokes read authority immediately');
select throws_ok($$select pg_temp.rule_write(6,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_request3')))$$,'42501',null,'staff deactivation revokes exact replay authority');
reset role;
select is((select count(*)::integer from private.questionnaire_rule_activations),1,'negative calls preserve original activation and create no extra approval');
select * from finish();
rollback;
