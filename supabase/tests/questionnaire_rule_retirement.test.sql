begin;
select plan(73);
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

select pg_temp.rule_login(1);set local role authenticated;
select set_config('test.rule_original',pg_temp.rule_write(1)::text,true);
select pg_temp.rule_login(2);
select set_config('test.rule_original_approved',pg_temp.rule_write(2,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_original')))::text,true);
reset role;
select set_config('test.retire_activation',(current_setting('test.rule_original_approved')::jsonb->'request'->'activation'->>'activationId'),true);
select set_config('test.retire_activation_before',(select to_jsonb(a)::text from private.questionnaire_rule_activations a where a.id=current_setting('test.retire_activation')::uuid),true);
create function pg_temp.retire_payload(p_action text default 'request',p_request uuid default null,p_reason text default 'Synthetic retirement reason',p_end date default null,p_activation uuid default null,p_hash text default null)
returns jsonb language sql as $$select jsonb_build_object('action',p_action,'formKey','spmsq','catalogHash',coalesce(p_hash,current_setting('test.rule_hash')),
 'activationId',coalesce(p_activation,current_setting('test.retire_activation')::uuid),'requestId',p_request,
 'effectiveThrough',case when p_action='request' then coalesce(p_end,(clock_timestamp() at time zone 'Asia/Taipei')::date+5) else null end,
 'reason',case when p_action='approve' then null else p_reason end);$$;
create function pg_temp.retire_write(p_n integer,p_input jsonb default null,p_branch uuid default 'da600000-0000-4000-8000-000000000001',p_org uuid default 'da500000-0000-4000-8000-000000000001')
returns jsonb language sql as $$select public.write_questionnaire_rule_retirement(p_org,p_branch,('dab00000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,coalesce(p_input,pg_temp.retire_payload()));$$;
create function pg_temp.retire_read(p_branch uuid default 'da600000-0000-4000-8000-000000000001',p_org uuid default 'da500000-0000-4000-8000-000000000001')
returns jsonb language sql as $$select public.read_questionnaire_rule_retirement(p_org,p_branch,current_setting('test.retire_activation')::uuid);$$;
create function pg_temp.retire_request(p_setting text default 'test.retire_request')
returns uuid language sql as $$select(current_setting(p_setting)::jsonb->'request'->>'requestId')::uuid;$$;
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('private.questionnaire_rule_retirement_requests'::regclass,'private.questionnaire_rule_retirement_events'::regclass,'private.questionnaire_rule_retirements'::regclass,'private.questionnaire_rule_retirement_operations'::regclass)),'retirement evidence tables force RLS');
select ok(not has_table_privilege('authenticated','private.questionnaire_rule_retirements','select,insert,update,delete'),'browser cannot bypass independent retirement through table writes');
select ok(not has_table_privilege('service_role','private.questionnaire_rule_retirement_requests','select,insert,update,delete'),'service role cannot supply fictitious human retirement');
select ok(not has_function_privilege('anon','public.write_questionnaire_rule_retirement(uuid,uuid,uuid,jsonb)','execute'),'anonymous retirement RPC is closed');
select ok(not has_function_privilege('authenticated','private.questionnaire_rule_effective_through(uuid)','execute'),'internal effective-date lookup has no browser permission');
select ok((select prosrc like '%pg_advisory_xact_lock%' and prosrc like '%questionnaire-rule-scope:%' from pg_proc where oid='private.read_questionnaire_rule_retirement_scoped(uuid,uuid,uuid,timestamptz,uuid)'::regprocedure),'retirement history serializes with normal approvals using the same scope lock');
select ok((select prosrc like '%rule retirement read denied%' and prosrc like '%rule retirement read changed while waiting%' and prosrc like '%rule retirement read changed''%' from pg_proc where oid='private.read_questionnaire_rule_retirement_scoped(uuid,uuid,uuid,timestamptz,uuid)'::regprocedure),'read preserves admission and final revocation checks plus post-lock current authority');
select is((select count(*)::integer from private.questionnaire_rule_retirements),0,'activation alone does not retire or shorten its availability');
select pg_temp.rule_login(1,'aal1');set local role authenticated;
select is(pg_temp.retire_read()->>'effectiveThrough',null,'ordinary Google read correctly reports an unlimited original activation');
select is(pg_temp.retire_read()->>'total','0','empty retirement queue is not a completed retirement');
select throws_ok($$select pg_temp.retire_write(1)$$,'42501',null,'AAL1 cannot silently approve a retirement');
select pg_temp.rule_login(1);
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload()-'reason')$$,'22023',null,'reason key is explicitly required');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload()||'{"approved":true}'::jsonb)$$,'22023',null,'browser cannot supply approval state');
select throws_ok($$select pg_temp.retire_write(1,jsonb_set(pg_temp.retire_payload(),'{effectiveThrough}','"2026-02-30"'))$$,'22023',null,'noncalendar retirement date is rejected');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'bad'))$$,'22023',null,'retirement request requires an adequate human reason');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'<script>Synthetic reason</script>'))$$,'22023',null,'retirement reason cannot include executable markup');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,null))$$,'22023',null,'retirement request reason cannot be null');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'Synthetic reason',(clock_timestamp() at time zone 'Asia/Taipei')::date-1))$$,'22023',null,'retirement cannot be backdated');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'Synthetic reason',(clock_timestamp() at time zone 'Asia/Taipei')::date+1))$$,'22023',null,'retirement cannot end before original activation begins');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'Synthetic reason',null,null,repeat('f',64)))$$,'42501',null,'wrong catalog hash cannot retire an activation');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'Synthetic reason',null,'dac00000-0000-4000-8000-000000000001'))$$,'42501',null,'unknown activation does not reveal cross-scope records');
select throws_ok($$select pg_temp.retire_read('da600000-0000-4000-8000-000000000002')$$,'42501',null,'other branch retirement history is denied');
select throws_ok($$select pg_temp.retire_write(1,null,'da600000-0000-4000-8000-000000000003','da500000-0000-4000-8000-000000000002')$$,'42501',null,'second organization membership cannot expand a pinned approval');
select throws_ok($$select public.write_questionnaire_rule_retirement('da500000-0000-4000-8000-000000000001','da600000-0000-4000-8000-000000000001','daa00000-0000-4000-8000-000000000001',pg_temp.retire_payload())$$,'23505',null,'review operation key cannot be reused for retirement');
select lives_ok($$select set_config('test.retire_request',pg_temp.retire_write(1)::text,true)$$,'scoped requester creates immutable retirement proposal');
select is(current_setting('test.retire_request')::jsonb->'request'->>'status','pending','proposal is pending and does not claim retirement');
select is(pg_temp.retire_read()->>'effectiveThrough',null,'pending request does not change original rule availability');
select ok((select snapshot->'requests'->0->>'status'='pending' and snapshot->'requests'->0->'retirement'='null'::jsonb and snapshot->'effectiveThrough'='null'::jsonb from(select pg_temp.retire_read() snapshot)s),'pending history and unlimited effective cutoff agree in one snapshot');
select is(pg_temp.retire_write(1)->>'eventId',current_setting('test.retire_request')::jsonb->>'eventId','same-key request replay returns the same event');
select is(pg_temp.retire_write(1)->>'replayed','true','same-key retirement request has explicit replay status');
select throws_ok($$select pg_temp.retire_write(1,pg_temp.retire_payload('request',null,'Another synthetic reason'))$$,'23505',null,'same key with different reason conflicts');
select throws_ok($$select public.write_questionnaire_rule_review('da500000-0000-4000-8000-000000000001','da600000-0000-4000-8000-000000000001','dab00000-0000-4000-8000-000000000001',pg_temp.rule_payload())$$,'23505',null,'retirement key cannot be reused for catalog adoption');
select throws_ok($$select pg_temp.retire_write(2)$$,'23514',null,'another retirement proposal for same activation cannot be pending concurrently');
select throws_ok($$select pg_temp.retire_write(2,pg_temp.retire_payload('approve',pg_temp.retire_request()))$$,'42501',null,'requester cannot approve their own retirement');
select throws_ok($$select pg_temp.retire_write(2,pg_temp.retire_payload('return',pg_temp.retire_request(),'Synthetic independent return'))$$,'42501',null,'requester cannot masquerade as second reviewer');
select pg_temp.rule_login(2);
select throws_ok($$select pg_temp.retire_write(2,pg_temp.retire_payload('withdraw',pg_temp.retire_request(),'Synthetic withdraw reason'))$$,'42501',null,'second reviewer cannot withdraw another requester proposal');
select lives_ok($$select pg_temp.retire_write(2,pg_temp.retire_payload('return',pg_temp.retire_request(),'Synthetic independent return'))$$,'independent reviewer can return a retirement proposal');
select is(pg_temp.retire_read()->'requests'->0->>'status','returned','return is retained in scoped history');
select throws_ok($$select pg_temp.retire_write(3,pg_temp.retire_payload('approve',pg_temp.retire_request()))$$,'23514',null,'returned retirement cannot be approved later');
select pg_temp.rule_login(1);
select lives_ok($$select set_config('test.retire_request2',pg_temp.retire_write(3)::text,true)$$,'requester can submit a fresh retirement after return');
select lives_ok($$select pg_temp.retire_write(4,pg_temp.retire_payload('withdraw',pg_temp.retire_request('test.retire_request2'),'Synthetic explicit withdrawal'))$$,'requester may explicitly withdraw a pending retirement');
select is(pg_temp.retire_read()->'requests'->0->>'status','withdrawn','withdrawal remains immutable history');
select lives_ok($$select set_config('test.retire_request3',pg_temp.retire_write(5)::text,true)$$,'new proposal after withdrawal has its own identity');
select pg_temp.rule_login(2);
select lives_ok($$select set_config('test.retire_approved',pg_temp.retire_write(6,pg_temp.retire_payload('approve',pg_temp.retire_request('test.retire_request3')))::text,true)$$,'independent scoped real AAL2 reviewer approves retirement');
select is(current_setting('test.retire_approved')::jsonb->'request'->>'status','approved','retirement approval is explicitly backed by second-person event');
select ok(current_setting('test.retire_approved')::jsonb->'request'->'retirement'->>'retirementId' is not null,'approved retirement has immutable identity');
select is(pg_temp.retire_read()->>'effectiveThrough',((clock_timestamp() at time zone 'Asia/Taipei')::date+5)::text,'derived effective through now matches exact approved cutoff');
select is(pg_temp.retire_read()->>'originalEffectiveTo',null,'original unlimited activation date is unchanged');
select ok((select snapshot->'requests'->0->>'status'='approved' and snapshot->'requests'->0->'retirement'->>'effectiveThrough'=snapshot->>'effectiveThrough' and snapshot->'requests'->0->'decision'->>'action'='approve' from(select pg_temp.retire_read() snapshot)s),'approved history retirement and derived cutoff agree in one snapshot');
select is(pg_temp.retire_write(6,pg_temp.retire_payload('approve',pg_temp.retire_request('test.retire_request3')))->>'eventId',current_setting('test.retire_approved')::jsonb->>'eventId','approval replay preserves original event');
select is(pg_temp.retire_write(6,pg_temp.retire_payload('approve',pg_temp.retire_request('test.retire_request3')))->>'replayed','true','approval replay cannot create second retirement');
select throws_ok($$select pg_temp.retire_write(7,pg_temp.retire_payload('return',pg_temp.retire_request('test.retire_request3'),'Synthetic late return'))$$,'23514',null,'approved retirement cannot be undone with return');
select pg_temp.rule_login(1);
select throws_ok($$select pg_temp.retire_write(8)$$,'23514',null,'already retired activation cannot acquire another retirement');
select throws_ok($$select pg_temp.rule_write(20,pg_temp.rule_payload('request',null,null,current_setting('test.rule_hash2'),(clock_timestamp() at time zone 'Asia/Taipei')::date+5))$$,'23514',null,'new rule starting on cutoff day still overlaps inclusive old availability');
select lives_ok($$select set_config('test.rule_successor',pg_temp.rule_write(20,pg_temp.rule_payload('request',null,null,current_setting('test.rule_hash2'),(clock_timestamp() at time zone 'Asia/Taipei')::date+6))::text,true)$$,'new rule can start the day after independently approved retirement');
select pg_temp.rule_login(2);
select lives_ok($$select pg_temp.rule_write(21,pg_temp.rule_payload('approve',pg_temp.rule_request('test.rule_successor'),null,current_setting('test.rule_hash2')))$$,'successor rule activation is independently approved without period overlap');
select throws_ok($$select public.read_questionnaire_rule_retirement('da500000-0000-4000-8000-000000000001','da600000-0000-4000-8000-000000000001',current_setting('test.retire_activation')::uuid,now(),null)$$,'22023',null,'retirement cursor requires timestamp and ID together');
reset role;
select is((select to_jsonb(a)::text from private.questionnaire_rule_activations a where a.id=current_setting('test.retire_activation')::uuid),current_setting('test.retire_activation_before'),'original activated rule remains byte-equivalent after retirement and successor publication');
select is((select count(*)::integer from private.questionnaire_rule_retirements),1,'one retirement approval produces exactly one final cutoff');
select is((select count(*)::integer from private.questionnaire_rule_retirement_requests),3,'returned withdrawn and approved proposals all remain');
select is((select count(*)::integer from private.questionnaire_rule_retirement_events),6,'request and decision events are retained independently');
select is((select count(*)::integer from private.questionnaire_rule_retirement_operations),6,'successful retirement operations each have one receipt');
select ok((select bool_and(q.requested_by<>e.actor_user_id and q.request_challenge_id<>e.challenge_id) from private.questionnaire_rule_retirement_requests q join private.questionnaire_rule_retirement_events e on e.request_id=q.id where e.action='approve'),'retirement evidence pins different real actors and factor challenges');
select throws_ok($$update private.questionnaire_rule_retirement_requests set effective_through=effective_through+1$$,'55000',null,'proposed cutoff is immutable');
select throws_ok($$delete from private.questionnaire_rule_retirement_events$$,'55000',null,'retirement decisions cannot be deleted');
select throws_ok($$update private.questionnaire_rule_retirements set effective_through=effective_through+1$$,'55000',null,'approved cutoff cannot be silently extended');
select throws_ok($$delete from private.questionnaire_rule_retirement_operations$$,'55000',null,'retirement operation receipt cannot be deleted');
select ok(not exists(select 1 from public.audit_events where table_name='questionnaire_rule_retirement' and(metadata::text like '%Synthetic retirement reason%' or metadata::text like '%factor_verified_at%')),'retirement audit excludes free text and factor secrets');
select is((select count(*)::integer from public.questionnaire_assessment_versions),0,'rule retirement does not rewrite or create clinical records');
update private.reauth_events set revoked_at=clock_timestamp() where user_id='da100000-0000-4000-8000-000000000002';
select pg_temp.rule_login(2);set local role authenticated;
select throws_ok($$select pg_temp.retire_write(6,pg_temp.retire_payload('approve',pg_temp.retire_request('test.retire_request3')))$$,'42501',null,'revoked factor cannot return privileged retirement success replay');
reset role;
update private.reauth_events set revoked_at=null where user_id='da100000-0000-4000-8000-000000000002';
update private.staff_google_access_grants set enabled=false where allowed_user_id='da100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.retire_read()$$,'42501',null,'deactivation revokes retirement history access');
select throws_ok($$select pg_temp.retire_write(6,pg_temp.retire_payload('approve',pg_temp.retire_request('test.retire_request3')))$$,'42501',null,'deactivation revokes exact retirement replay');
reset role;
select is((select count(*)::integer from private.questionnaire_rule_retirements),1,'all negative calls preserve final approved cutoff');
select * from finish();
rollback;
